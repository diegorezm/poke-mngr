package pokeidle

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"poke-mngr/internal/config"
	"poke-mngr/internal/store"
)

const (
	marketReqTimeout  = 12 * time.Second
	marketBuyTimeout  = 20 * time.Second
	marketMinGap      = 500 * time.Millisecond
	marketFireMargin  = 20 * time.Millisecond
)

type MarketBuyResult struct {
	Status string `json:"status"` // comprado | perdeu_sorteio | recusado | timeout
	Detail string `json:"detail"`
	Total  int64  `json:"total,omitempty"`
	Moeda  string `json:"moeda,omitempty"`
}

type pendingBuy struct {
	listingID int
	qty       int
	price     int64
	state     string // "enviada" | "sorteio"
	ch        chan MarketBuyResult
}

type marketWaiter struct {
	match func(map[string]any) bool
	ch    chan map[string]any
}

type MarketClient struct {
	accName string
	sendFn  func(context.Context, any) error

	reqMu    sync.Mutex
	lastSent time.Time

	mu     sync.Mutex
	waiter *marketWaiter
	buys   []*pendingBuy
	seq    int

	clockMu  sync.Mutex
	samples  []clockSample
	offsetMs int64
}

type clockSample struct {
	at     time.Time
	offset int64
}

func NewMarketClient(accName string, sendFn func(context.Context, any) error) *MarketClient {
	return &MarketClient{
		accName: accName,
		sendFn:  sendFn,
	}
}

func (mc *MarketClient) Reset(reason string) {
	mc.mu.Lock()
	defer mc.mu.Unlock()
	if mc.waiter != nil {
		close(mc.waiter.ch)
		mc.waiter = nil
	}
	for _, b := range mc.buys {
		select {
		case b.ch <- MarketBuyResult{Status: "recusado", Detail: reason}:
		default:
		}
	}
	mc.buys = nil
}

func (mc *MarketClient) NoteServerTime(agoraMs int64) {
	if agoraMs <= 0 {
		return
	}
	now := time.Now()
	off := agoraMs - now.UnixMilli()
	mc.clockMu.Lock()
	defer mc.clockMu.Unlock()
	cutoff := now.Add(-5 * time.Minute)
	kept := mc.samples[:0]
	maxOff := off
	for _, s := range mc.samples {
		if s.at.After(cutoff) {
			kept = append(kept, s)
			if s.offset > maxOff {
				maxOff = s.offset
			}
		}
	}
	kept = append(kept, clockSample{at: now, offset: off})
	mc.samples = kept
	mc.offsetMs = maxOff
}

func (mc *MarketClient) ServerNowMs() int64 {
	mc.clockMu.Lock()
	off := mc.offsetMs
	mc.clockMu.Unlock()
	return time.Now().UnixMilli() + off
}

func (mc *MarketClient) SleepUntilServer(ctx context.Context, targetMs int64) error {
	goal := targetMs + marketFireMargin.Milliseconds()
	for {
		rem := goal - mc.ServerNowMs()
		if rem <= 0 {
			return nil
		}
		sleep := time.Duration(rem) * time.Millisecond
		if sleep > 600*time.Millisecond {
			sleep -= 300 * time.Millisecond
			if sleep > 5*time.Second {
				sleep = 5 * time.Second
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(sleep):
		}
	}
}

func (mc *MarketClient) HandleFrame(msg map[string]any) {
	t := asString(msg["t"])
	switch t {
	case "market", "orbs":
		mc.mu.Lock()
		w := mc.waiter
		if w != nil && w.match(msg) {
			mc.waiter = nil
			mc.mu.Unlock()
			select {
			case w.ch <- msg:
			default:
			}
			return
		}
		mc.mu.Unlock()
	case "erro":
		mc.settleOldest("enviada", MarketBuyResult{
			Status: "recusado",
			Detail: asString(msg["chave"]),
		})
	case "batalha":
		for _, raw := range asSlice(msg["ev"]) {
			ev := asMap(raw)
			if ev == nil {
				continue
			}
			k := asString(ev["k"])
			switch k {
			case "marketComprado":
				mc.settleOldest("sorteio", MarketBuyResult{
					Status: "comprado",
					Detail: asString(ev["descricao"]),
					Total:  asInt64(ev["total"]),
					Moeda:  asString(ev["moeda"]),
				})
			case "mktSorteio":
				if asString(ev["tipo"]) == "fim" && !asBool(ev["levou"]) {
					mc.settleOldest("sorteio", MarketBuyResult{
						Status: "perdeu_sorteio",
						Detail: "Perdeu o sorteio da liberação",
					})
				}
			case "aviso":
				m := asString(ev["msg"])
				low := strings.ToLower(m)
				if m == "market.sorteio" {
					mc.markSorteio()
				} else if m == "market.sorteioPerdeu" {
					mc.settleOldest("sorteio", MarketBuyResult{Status: "perdeu_sorteio", Detail: "Perdeu o sorteio"})
				} else if strings.HasPrefix(m, "market.") || strings.Contains(low, "anúncio já saiu") || strings.Contains(low, "só restam") {
					mc.settleOldest("enviada", MarketBuyResult{Status: "recusado", Detail: m})
				}
			}
		}
	}
}

func (mc *MarketClient) markSorteio() {
	mc.mu.Lock()
	defer mc.mu.Unlock()
	for _, b := range mc.buys {
		if b.state == "enviada" {
			b.state = "sorteio"
			return
		}
	}
}

func (mc *MarketClient) settleOldest(preferredState string, res MarketBuyResult) {
	mc.mu.Lock()
	defer mc.mu.Unlock()
	if len(mc.buys) == 0 {
		return
	}
	idx := -1
	for i, b := range mc.buys {
		if b.state == preferredState {
			idx = i
			break
		}
	}
	if idx == -1 {
		idx = 0
	}
	b := mc.buys[idx]
	mc.buys = append(mc.buys[:idx], mc.buys[idx+1:]...)
	select {
	case b.ch <- res:
	default:
	}
}

func (mc *MarketClient) request(ctx context.Context, payload map[string]any, match func(map[string]any) bool) (map[string]any, error) {
	mc.reqMu.Lock()
	defer mc.reqMu.Unlock()

	if gap := marketMinGap - time.Since(mc.lastSent); gap > 0 {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(gap):
		}
	}

	ch := make(chan map[string]any, 1)
	mc.mu.Lock()
	mc.waiter = &marketWaiter{match: match, ch: ch}
	mc.mu.Unlock()

	mc.lastSent = time.Now()
	if err := mc.sendFn(ctx, payload); err != nil {
		mc.mu.Lock()
		mc.waiter = nil
		mc.mu.Unlock()
		return nil, err
	}

	rctx, cancel := context.WithTimeout(ctx, marketReqTimeout)
	defer cancel()
	select {
	case res, ok := <-ch:
		if !ok {
			return nil, errors.New("conexão encerrada durante consulta ao mercado")
		}
		return res, nil
	case <-rctx.Done():
		mc.mu.Lock()
		mc.waiter = nil
		mc.mu.Unlock()
		return nil, errors.New("tempo esgotado consultando o mercado")
	}
}

func matchMarketAba(aba string) func(map[string]any) bool {
	return func(m map[string]any) bool {
		return asString(m["t"]) == "market" && asString(m["aba"]) == aba
	}
}

func (mc *MarketClient) QueryItems(ctx context.Context) (map[string]any, error) {
	return mc.request(ctx, map[string]any{"t": "market.itens", "elemento": ""}, matchMarketAba("itens"))
}

func (mc *MarketClient) QueryAverages(ctx context.Context) (map[string]any, error) {
	return mc.request(ctx, map[string]any{"t": "market.medias"}, matchMarketAba("medias"))
}

func (mc *MarketClient) QueryItemListings(ctx context.Context, itemID int, moeda string) (map[string]any, error) {
	if moeda != "orb" {
		moeda = "gold"
	}
	return mc.request(ctx, map[string]any{
		"t":      "market.item",
		"itemId": itemID,
		"moeda":  moeda,
	}, func(m map[string]any) bool {
		return asString(m["t"]) == "market" && asString(m["aba"]) == "item" && asInt(m["itemId"]) == itemID
	})
}

func (mc *MarketClient) QueryVitrine(ctx context.Context, filters map[string]any) (map[string]any, error) {
	req := map[string]any{
		"t":      "market.listar",
		"tipo":   "pokemon",
		"moeda":  "gold",
		"pagina": 1,
	}
	for k, v := range filters {
		req[k] = v
	}
	return mc.request(ctx, req, matchMarketAba("vitrine"))
}

func (mc *MarketClient) QueryTape(ctx context.Context, mode string, page int) (map[string]any, error) {
	mc.mu.Lock()
	mc.seq++
	seq := mc.seq
	mc.mu.Unlock()

	if page < 1 {
		page = 1
	}
	cmd := "market.historicoGlobal"
	aba := "historicoGlobal"
	switch mode {
	case "sales":
		cmd = "market.historico"
		aba = "historico"
	case "buys":
		cmd = "market.historicoCompras"
		aba = "historicoCompras"
	}
	return mc.request(ctx, map[string]any{
		"t":      cmd,
		"pagina": page,
		"seq":    seq,
	}, matchMarketAba(aba))
}

func (mc *MarketClient) QueryMyListings(ctx context.Context) (map[string]any, error) {
	return mc.request(ctx, map[string]any{"t": "market.meus"}, matchMarketAba("meus"))
}

// QueryWallet is strictly READ-ONLY (orbs.painel). Never sends orbs.sacar or banco.coins.
func (mc *MarketClient) QueryWallet(ctx context.Context) (map[string]any, error) {
	return mc.request(ctx, map[string]any{"t": "orbs.painel"}, func(m map[string]any) bool {
		return asString(m["t"]) == "orbs"
	})
}

// Buy sends urgent market.comprar (bypassing the 500ms query throttle).
func (mc *MarketClient) Buy(ctx context.Context, listingID, qty int, price int64, moeda string) (MarketBuyResult, error) {
	if moeda != "orb" {
		moeda = "gold"
	}
	if qty <= 0 {
		qty = 1
	}
	pb := &pendingBuy{
		listingID: listingID,
		qty:       qty,
		price:     price,
		state:     "enviada",
		ch:        make(chan MarketBuyResult, 1),
	}
	mc.mu.Lock()
	mc.buys = append(mc.buys, pb)
	mc.mu.Unlock()

	err := mc.sendFn(ctx, map[string]any{
		"t":     "market.comprar",
		"id":    listingID,
		"qtd":   qty,
		"preco": price,
		"moeda": moeda,
	})
	if err != nil {
		mc.removeBuy(pb)
		return MarketBuyResult{Status: "recusado", Detail: err.Error()}, err
	}

	bctx, cancel := context.WithTimeout(ctx, marketBuyTimeout)
	defer cancel()
	select {
	case res := <-pb.ch:
		return res, nil
	case <-bctx.Done():
		mc.removeBuy(pb)
		return MarketBuyResult{Status: "timeout", Detail: "Sem confirmação do mercado em 20s"}, nil
	}
}

func (mc *MarketClient) removeBuy(pb *pendingBuy) {
	mc.mu.Lock()
	defer mc.mu.Unlock()
	for i, b := range mc.buys {
		if b == pb {
			mc.buys = append(mc.buys[:i], mc.buys[i+1:]...)
			return
		}
	}
}

// --- MarketService (shared across accounts + pokeidleguide.io analytics + Sniper) ---

type MarketService struct {
	mgr    *AccountManager
	store  *store.Store
	client *http.Client

	cacheMu     sync.Mutex
	guideCache  map[string]guideCacheEntry
	seenAlerted map[string]time.Time
	snipedIDs   map[int]time.Time
}

type guideCacheEntry struct {
	data map[string]any
	exp  time.Time
}

func NewMarketService(mgr *AccountManager, st *store.Store) *MarketService {
	return &MarketService{
		mgr:         mgr,
		store:       st,
		client:      &http.Client{Timeout: 10 * time.Second},
		guideCache:  map[string]guideCacheEntry{},
		seenAlerted: map[string]time.Time{},
		snipedIDs:   map[int]time.Time{},
	}
}

func (ms *MarketService) pickOnlineConn(preferredID int) *AccountConnection {
	if preferredID > 0 {
		if c := ms.mgr.GetConnection(preferredID); c != nil && c.Snapshot().State == StateOnline {
			return c
		}
	}
	ms.mgr.mu.RLock()
	defer ms.mgr.mu.RUnlock()
	for _, c := range ms.mgr.conns {
		if c.Snapshot().State == StateOnline {
			return c
		}
	}
	return nil
}

func (ms *MarketService) Overview(ctx context.Context) (map[string]any, error) {
	conn := ms.pickOnlineConn(0)
	if conn == nil {
		return nil, errors.New("nenhuma conta online para consultar o mercado")
	}
	itens, err := conn.market.QueryItems(ctx)
	if err != nil {
		return nil, err
	}
	medias, _ := conn.market.QueryAverages(ctx)
	favs, _ := ms.store.ListMarketFavs()

	resumo := asMap(itens["resumo"])
	mediasMap := asMap(itens["medias"])
	if medias != nil && asMap(medias["medias"]) != nil {
		mediasMap = asMap(medias["medias"])
	}
	return map[string]any{
		"resumo":        resumo,
		"medias":        mediasMap,
		"favs":          favs,
		"sniperEnabled": ms.mgr.Settings().SniperEnabled,
		"accountNick":   conn.Account().Nick,
	}, nil
}

func (ms *MarketService) ItemListings(ctx context.Context, itemID int, moeda string, accID int) (map[string]any, error) {
	conn := ms.pickOnlineConn(accID)
	if conn == nil {
		return nil, errors.New("nenhuma conta online")
	}
	return conn.market.QueryItemListings(ctx, itemID, moeda)
}

func (ms *MarketService) Vitrine(ctx context.Context, filters map[string]any, accID int) (map[string]any, error) {
	conn := ms.pickOnlineConn(accID)
	if conn == nil {
		return nil, errors.New("nenhuma conta online")
	}
	return conn.market.QueryVitrine(ctx, filters)
}

func (ms *MarketService) Tape(ctx context.Context, mode string, page int, accID int) (map[string]any, error) {
	conn := ms.pickOnlineConn(accID)
	if conn == nil {
		return nil, errors.New("nenhuma conta online")
	}
	return conn.market.QueryTape(ctx, mode, page)
}

func (ms *MarketService) MyListings(ctx context.Context, accID int) (map[string]any, error) {
	conn := ms.pickOnlineConn(accID)
	if conn == nil {
		return nil, errors.New("conta offline")
	}
	return conn.market.QueryMyListings(ctx)
}

func (ms *MarketService) Wallet(ctx context.Context, accID int) (map[string]any, error) {
	conn := ms.pickOnlineConn(accID)
	if conn == nil {
		return nil, errors.New("conta offline")
	}
	return conn.market.QueryWallet(ctx)
}

func (ms *MarketService) BuyListing(ctx context.Context, accID, listingID, qty int, price int64, moeda string) (MarketBuyResult, error) {
	conn := ms.pickOnlineConn(accID)
	if conn == nil {
		return MarketBuyResult{Status: "recusado", Detail: "conta offline"}, errors.New("conta offline")
	}
	res, err := conn.market.Buy(ctx, listingID, qty, price, moeda)
	_ = ms.store.AppendMarketLog(conn.Account().ID, 0, res.Status, fmt.Sprintf("Compra manual #%d (%dx @ %d %s): %s", listingID, qty, price, moeda, res.Detail))
	return res, err
}

func (ms *MarketService) GuideStats(ctx context.Context, days int) (map[string]any, error) {
	if days < 1 {
		days = 7
	}
	if days > 30 {
		days = 30
	}
	key := fmt.Sprintf("resumo:%d", days)
	ms.cacheMu.Lock()
	if e, ok := ms.guideCache[key]; ok && time.Now().Before(e.exp) {
		ms.cacheMu.Unlock()
		return e.data, nil
	}
	ms.cacheMu.Unlock()

	u := fmt.Sprintf("%s/api/mercado/resumo?dias=%d", config.GuideOrigin, days)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "PokeMngr")
	resp, err := ms.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("pokeidleguide.io retornou HTTP %d", resp.StatusCode)
	}
	var data map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	ms.cacheMu.Lock()
	ms.guideCache[key] = guideCacheEntry{data: data, exp: time.Now().Add(5 * time.Minute)}
	ms.cacheMu.Unlock()
	return data, nil
}

func (ms *MarketService) GuideSeries(ctx context.Context, name, moeda string, days int) (map[string]any, error) {
	m := "ouro"
	if moeda == "orb" {
		m = "gema"
	}
	q := url.Values{}
	q.Set("nome", name)
	q.Set("moeda", m)
	q.Set("dias", fmt.Sprintf("%d", days))
	u := fmt.Sprintf("%s/api/mercado/serie?%s", config.GuideOrigin, q.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "PokeMngr")
	resp, err := ms.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var data map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	return data, nil
}

// RunRuleLoop checks Alert & Sniper rules every 6 seconds whenever enabled rules exist.
func (ms *MarketService) RunRuleLoop(ctx context.Context) {
	ticker := time.NewTicker(6 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			ms.tickRules(ctx)
		}
	}
}

func (ms *MarketService) tickRules(ctx context.Context) {
	rules, err := ms.store.ListMarketRules()
	if err != nil || len(rules) == 0 {
		return
	}
	sniperMaster := ms.mgr.Settings().SniperEnabled
	var active []store.MarketRule
	for _, r := range rules {
		if !r.Enabled {
			continue
		}
		if r.Kind == "snipe" && !sniperMaster {
			continue
		}
		active = append(active, r)
	}
	if len(active) == 0 {
		return
	}
	conn := ms.pickOnlineConn(0)
	if conn == nil {
		return
	}

	ownNicks := map[string]bool{}
	ms.mgr.mu.RLock()
	for _, c := range ms.mgr.conns {
		ownNicks[strings.ToLower(c.Account().Nick)] = true
	}
	ms.mgr.mu.RUnlock()

	today := time.Now().Format("2006-01-02")

	for _, rule := range active {
		if rule.Spec.Target != "item" || rule.Spec.ItemID <= 0 || rule.Spec.MaxPrice <= 0 {
			continue
		}
		resp, err := conn.market.QueryItemListings(ctx, rule.Spec.ItemID, rule.Spec.Moeda)
		if err != nil {
			continue
		}
		for _, raw := range asSlice(resp["linhas"]) {
			ad := asMap(raw)
			if ad == nil {
				continue
			}
			adID := asInt(ad["id"])
			price := asInt64(ad["preco"])
			qty := asInt(ad["qtd"])
			if qty <= 0 {
				qty = 1
			}
			seller := strings.ToLower(asString(ad["vendedor"]))
			if seller != "" && ownNicks[seller] {
				continue // never buy from own accounts
			}
			if price <= 0 || price > rule.Spec.MaxPrice {
				continue
			}

			alertKey := fmt.Sprintf("%d:%d", rule.ID, adID)
			ms.cacheMu.Lock()
			_, alreadyAlerted := ms.seenAlerted[alertKey]
			ms.cacheMu.Unlock()

			if rule.Kind == "alert" {
				if alreadyAlerted {
					continue
				}
				ms.cacheMu.Lock()
				ms.seenAlerted[alertKey] = time.Now()
				ms.cacheMu.Unlock()
				msg := fmt.Sprintf("Item #%d (%s) por %d %s (x%d) — alvo <= %d",
					rule.Spec.ItemID, rule.Spec.ItemName, price, rule.Spec.Moeda, qty, rule.Spec.MaxPrice)
				_ = ms.store.AppendMarketLog(0, rule.ID, "alerta", msg)
				ms.mgr.Notifier().Send(DiscordEmbed{
					Title:       "🔔 Alerta de Mercado",
					Description: msg,
					Color:       ColorBlue,
				})
				continue
			}

			// Sniper execution (multi-account synchronized to compravelEm + 20ms)
			ms.cacheMu.Lock()
			_, alreadySniped := ms.snipedIDs[adID]
			if !alreadySniped {
				ms.snipedIDs[adID] = time.Now()
			}
			ms.cacheMu.Unlock()
			if alreadySniped {
				continue
			}

			buyableAt := asInt64(ad["compravelEm"])
			targetIDs := rule.Spec.AccountIDs
			if len(targetIDs) == 0 {
				targetIDs = []int{conn.Account().ID}
			}

			for _, accID := range targetIDs {
				c := ms.mgr.GetConnection(accID)
				if c == nil || c.Snapshot().State != StateOnline {
					continue
				}
				spent := ms.store.GetRuleDailySpend(rule.ID, accID, today)
				maxBudget := rule.Spec.DailyBudget
				buyQty := qty
				if maxBudget > 0 {
					rem := maxBudget - spent
					if rem < price {
						continue
					}
					maxQ := int(rem / price)
					if buyQty > maxQ {
						buyQty = maxQ
					}
				}
				if buyQty <= 0 {
					continue
				}
				go ms.fireSnipe(ctx, c, rule, adID, buyQty, price, buyableAt, today)
			}
		}
	}
}

func (ms *MarketService) fireSnipe(ctx context.Context, c *AccountConnection, rule store.MarketRule, adID, qty int, price, buyableAt int64, today string) {
	if buyableAt > c.market.ServerNowMs() {
		if err := c.market.SleepUntilServer(ctx, buyableAt); err != nil {
			return
		}
	}
	res, err := c.market.Buy(ctx, adID, qty, price, rule.Spec.Moeda)
	if err != nil {
		log.Printf("[sniper] acc=%s ad=#%d err=%v", c.Account().Nick, adID, err)
	}
	text := fmt.Sprintf("[%s] Sniper #%d (%dx @ %d %s): %s", c.Account().Nick, adID, qty, price, rule.Spec.Moeda, res.Detail)
	_ = ms.store.AppendMarketLog(c.Account().ID, rule.ID, res.Status, text)
	if res.Status == "comprado" {
		total := res.Total
		if total <= 0 {
			total = price * int64(qty)
		}
		_ = ms.store.AddRuleDailySpend(rule.ID, c.Account().ID, today, total)
		ms.mgr.Notifier().Send(DiscordEmbed{
			Title:       fmt.Sprintf("🎯 Sniper Comprou — %s", c.Account().Nick),
			Description: text,
			Color:       ColorGreen,
		})
	}
}
