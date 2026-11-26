package pokeidle

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strconv"
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

type MarketActionResult struct {
	Status string `json:"status"` // ok | recusado | limite | timeout
	Detail string `json:"detail"`
}

type pendingMarketAction struct {
	kind string // "create" | "edit" | "cancel"
	ch   chan MarketActionResult
}

type CreateListingRequest struct {
	Tipo      string `json:"tipo"` // "item" | "pokemon"
	ItemID    int    `json:"itemId,omitempty"`
	PokemonID int    `json:"pokemonId,omitempty"`
	Qty       int    `json:"qtd"`
	Price     int64  `json:"preco"`
	Moeda     string `json:"moeda"` // "gold" | "orb"
	Days      int    `json:"dias,omitempty"`
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
	actionMu sync.Mutex

	mu            sync.Mutex
	waiter        *marketWaiter
	buys          []*pendingBuy
	pendingAction *pendingMarketAction
	seq           int

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
	if mc.pendingAction != nil {
		select {
		case mc.pendingAction.ch <- MarketActionResult{Status: "recusado", Detail: reason}:
		default:
		}
		mc.pendingAction = nil
	}
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
		detail := asString(msg["msg"])
		if detail == "" {
			detail = asString(msg["chave"])
		}
		if mc.settleAnyAction(MarketActionResult{Status: "recusado", Detail: detail}) {
			return
		}
		mc.settleOldest("enviada", MarketBuyResult{
			Status: "recusado",
			Detail: detail,
		})
	case "batalha":
		for _, raw := range asSlice(msg["ev"]) {
			ev := asMap(raw)
			if ev == nil {
				continue
			}
			k := asString(ev["k"])
			switch k {
			case "marketCriado":
				mc.settleActionKind("create", MarketActionResult{
					Status: "ok",
					Detail: asString(ev["descricao"]),
				})
			case "marketCancelado":
				mc.settleActionKind("cancel", MarketActionResult{
					Status: "ok",
					Detail: "Anúncio cancelado",
				})
			case "marketLimitePokemon":
				mc.settleActionKind("create", MarketActionResult{
					Status: "limite",
					Detail: fmt.Sprintf("Limite de anúncios de Pokémon atingido (%d)", asInt(ev["max"])),
				})
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
				} else if m == "market.editado" || strings.Contains(low, "preço atualizado") || strings.Contains(low, "anúncio atualizado") {
					mc.settleActionKind("edit", MarketActionResult{Status: "ok", Detail: m})
				} else if strings.HasPrefix(m, "market.") || strings.Contains(low, "anúncio já saiu") || strings.Contains(low, "só restam") || strings.Contains(low, "espera") || strings.Contains(low, "retenção") {
					if !mc.settleAnyAction(MarketActionResult{Status: "recusado", Detail: m}) {
						mc.settleOldest("enviada", MarketBuyResult{Status: "recusado", Detail: m})
					}
				}
			}
		}
	}
}

func (mc *MarketClient) settleActionKind(kind string, res MarketActionResult) bool {
	mc.mu.Lock()
	defer mc.mu.Unlock()
	if mc.pendingAction == nil || mc.pendingAction.kind != kind {
		return false
	}
	act := mc.pendingAction
	mc.pendingAction = nil
	select {
	case act.ch <- res:
	default:
	}
	return true
}

func (mc *MarketClient) settleAnyAction(res MarketActionResult) bool {
	mc.mu.Lock()
	defer mc.mu.Unlock()
	if mc.pendingAction == nil {
		return false
	}
	act := mc.pendingAction
	mc.pendingAction = nil
	select {
	case act.ch <- res:
	default:
	}
	return true
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
		"t":             "market.listar",
		"tipo":          "pokemon",
		"moeda":         "gold",
		"busca":         "",
		"ordem":         "baratos",
		"criterios":     []any{},
		"elemento":      "",
		"categoria":     "",
		"soShiny":       false,
		"soP5":          false,
		"soTmElemental": false,
		"soTmAoe":       false,
		"ivMin":         "",
		"potenciaMin":   "",
		"qualidadeMin":  "",
		"nivelMin":      "",
		"pagina":        0,
	}
	for k, v := range filters {
		req[k] = v
	}
	return mc.request(ctx, req, matchMarketAba("vitrine"))
}

func (mc *MarketClient) QueryTape(ctx context.Context, mode string, page int) (map[string]any, error) {
	return mc.QueryTapeFiltered(ctx, mode, page, nil)
}

func (mc *MarketClient) QueryTapeFiltered(ctx context.Context, mode string, page int, filters map[string]any) (map[string]any, error) {
	mc.mu.Lock()
	mc.seq++
	seq := mc.seq
	mc.mu.Unlock()

	if page < 0 {
		page = 0
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
	req := map[string]any{
		"t":      cmd,
		"pagina": page,
		"seq":    seq,
	}
	for k, v := range filters {
		req[k] = v
	}
	return mc.request(ctx, req, func(m map[string]any) bool {
		return asString(m["t"]) == "market" && asString(m["aba"]) == aba && asInt(m["seq"]) == seq
	})
}

func (mc *MarketClient) QueryListing(ctx context.Context, listingID int) (map[string]any, error) {
	return mc.request(ctx, map[string]any{
		"t":  "market.anuncio",
		"id": listingID,
	}, func(m map[string]any) bool {
		return asString(m["t"]) == "market" && asString(m["aba"]) == "anuncio" && asInt(m["id"]) == listingID
	})
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

// CreateListing publishes an item or Pokémon on the community market (market.criar).
func (mc *MarketClient) CreateListing(ctx context.Context, req CreateListingRequest) (MarketActionResult, error) {
	mc.actionMu.Lock()
	defer mc.actionMu.Unlock()

	moeda := req.Moeda
	if moeda != "orb" {
		moeda = "gold"
	}
	qty := req.Qty
	if req.Tipo == "pokemon" || qty <= 0 {
		qty = 1
	}
	if req.Price < 2 {
		return MarketActionResult{Status: "recusado", Detail: "preço unitário abaixo do mínimo"}, errors.New("preço inválido")
	}

	payload := map[string]any{
		"t":           "market.criar",
		"tipo":        req.Tipo,
		"itemId":      nil,
		"pokemonId":   nil,
		"casaId":      nil,
		"bicicletaId": nil,
		"qtd":         qty,
		"preco":       req.Price,
		"moeda":       moeda,
		"dias":        nil,
	}
	if req.Tipo == "pokemon" {
		if req.PokemonID <= 0 {
			return MarketActionResult{Status: "recusado", Detail: "pokemonId inválido"}, errors.New("pokemonId inválido")
		}
		days := req.Days
		if days < 1 {
			days = 3
		}
		if days > 30 {
			days = 30
		}
		payload["pokemonId"] = req.PokemonID
		payload["dias"] = days
	} else {
		if req.ItemID <= 0 {
			return MarketActionResult{Status: "recusado", Detail: "itemId inválido"}, errors.New("itemId inválido")
		}
		payload["tipo"] = "item"
		payload["itemId"] = req.ItemID
	}

	return mc.sendActionAndWait(ctx, "create", payload, marketReqTimeout)
}

// CancelListing cancels an open market listing (market.cancelar).
func (mc *MarketClient) CancelListing(ctx context.Context, listingID int) (MarketActionResult, error) {
	mc.actionMu.Lock()
	defer mc.actionMu.Unlock()
	if listingID <= 0 {
		return MarketActionResult{Status: "recusado", Detail: "ID inválido"}, errors.New("ID inválido")
	}
	return mc.sendActionAndWait(ctx, "cancel", map[string]any{
		"t":  "market.cancelar",
		"id": listingID,
	}, marketReqTimeout)
}

// EditListing updates the price/currency of an existing listing (market.editar) and verifies via market.meus if silent.
func (mc *MarketClient) EditListing(ctx context.Context, listingID int, price int64, moeda string) (MarketActionResult, error) {
	mc.actionMu.Lock()
	defer mc.actionMu.Unlock()
	if listingID <= 0 || price < 2 {
		return MarketActionResult{Status: "recusado", Detail: "parâmetros inválidos"}, errors.New("parâmetros inválidos")
	}
	if moeda != "orb" {
		moeda = "gold"
	}

	res, err := mc.sendActionAndWait(ctx, "edit", map[string]any{
		"t":     "market.editar",
		"id":    listingID,
		"preco": price,
		"moeda": moeda,
	}, 3*time.Second)
	if err != nil {
		return res, err
	}
	if res.Status == "ok" || res.Status == "recusado" {
		return res, nil
	}

	// Server may apply market.editar silently without a battle toast; confirm via market.meus.
	meus, qErr := mc.QueryMyListings(ctx)
	if qErr != nil {
		return MarketActionResult{Status: "timeout", Detail: "sem confirmação após editar anúncio"}, qErr
	}
	for _, raw := range asSlice(meus["linhas"]) {
		ad := asMap(raw)
		if ad == nil || asInt(ad["id"]) != listingID {
			continue
		}
		adMoeda := asString(ad["moeda"])
		if adMoeda == "" {
			adMoeda = "gold"
		}
		if asInt64(ad["preco"]) == price && adMoeda == moeda {
			return MarketActionResult{Status: "ok", Detail: "Preço atualizado"}, nil
		}
		return MarketActionResult{Status: "recusado", Detail: "O servidor manteve o preço anterior (pode estar em cooldown de edição)"}, nil
	}
	return MarketActionResult{Status: "recusado", Detail: "Anúncio não encontrado (pode ter sido vendido ou encerrado)"}, nil
}

func (mc *MarketClient) sendActionAndWait(ctx context.Context, kind string, payload map[string]any, timeout time.Duration) (MarketActionResult, error) {
	act := &pendingMarketAction{
		kind: kind,
		ch:   make(chan MarketActionResult, 1),
	}
	mc.mu.Lock()
	mc.pendingAction = act
	mc.mu.Unlock()

	cleanup := func() {
		mc.mu.Lock()
		if mc.pendingAction == act {
			mc.pendingAction = nil
		}
		mc.mu.Unlock()
	}

	if err := mc.sendFn(ctx, payload); err != nil {
		cleanup()
		return MarketActionResult{Status: "recusado", Detail: err.Error()}, err
	}

	wctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	select {
	case res := <-act.ch:
		return res, nil
	case <-wctx.Done():
		cleanup()
		if ctx.Err() != nil {
			return MarketActionResult{Status: "timeout", Detail: ctx.Err().Error()}, ctx.Err()
		}
		return MarketActionResult{Status: "timeout", Detail: "Sem confirmação do mercado"}, nil
	}
}

// --- MarketService (shared across accounts + pokeidleguide.io analytics + Valuation + Sniper) ---

type ListingDetail struct {
	ID        int            `json:"id"`
	Kind      string         `json:"kind"` // item | pokemon
	Name      string         `json:"nome"`
	Qty       int            `json:"qtd"`
	Price     int64          `json:"preco"`
	Moeda     string         `json:"moeda"`
	Seller    string         `json:"vendedor"`
	Status    string         `json:"estado"`
	BuyableAt int64          `json:"compravelEm,omitempty"`
	ItemID    int            `json:"itemId,omitempty"`
	ItemIcon  string         `json:"itemIcon,omitempty"`
	Pokemon   *PokemonDetail `json:"pokemon,omitempty"`
}

type ValuationItem struct {
	Key       string  `json:"key"`
	Kind      string  `json:"kind"` // rare | item | shiny
	Name      string  `json:"nome"`
	Icon      string  `json:"icon,omitempty"`
	Looktype  int     `json:"looktype,omitempty"`
	Qty       int     `json:"qty"`
	UnitGems  float64 `json:"unitGems"`
	TotalGems float64 `json:"totalGems"`
	TotalUSD  float64 `json:"totalUsd"`
}

type InventoryValuation struct {
	USDPerGem      float64         `json:"usdPerGem"`
	OrbsBalance    int64           `json:"orbsBalance"`
	RareItemsGems  float64         `json:"rareItemsGems"`
	OtherItemsGems float64         `json:"otherItemsGems"`
	ShiniesGems    float64         `json:"shiniesGems"`
	TotalGems      float64         `json:"totalGems"`
	TotalUSD       float64         `json:"totalUsd"`
	PricedShinies  int             `json:"pricedShinies"`
	TotalShinies   int             `json:"totalShinies"`
	PendingShinies int             `json:"pendingShinies"`
	TopEntries     []ValuationItem `json:"topEntries"`
}

type shinyPriceCacheEntry struct {
	gems float64
	ok   bool
	exp  time.Time
}

type sellAlertEntry struct {
	at      time.Time
	premium float64
}

type MarketService struct {
	mgr    *AccountManager
	store  *store.Store
	client *http.Client

	cacheMu      sync.Mutex
	guideCache   map[string]guideCacheEntry
	seenAlerted  map[string]time.Time
	snipedIDs    map[int]time.Time
	resumoCache  map[string]any
	resumoAt     time.Time
	mediasCache  map[string]any
	mediasAt     time.Time
	usdPerGem    float64
	usdPerGemAt  time.Time
	shinyCache   map[string]shinyPriceCacheEntry
	sellAlerted      map[string]sellAlertEntry
	lastSellTick     time.Time
	lastAutoSellTick time.Time
	pokeMedianCache  map[string]shinyPriceCacheEntry
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
		shinyCache:      map[string]shinyPriceCacheEntry{},
		sellAlerted:     map[string]sellAlertEntry{},
		pokeMedianCache: map[string]shinyPriceCacheEntry{},
	}
}

// EffectiveThreshold returns the maximum acceptable unit price given rule maxPrice and/or % below 7d avg.
// When both are positive, the stricter (lower) cap wins. Returns 0 if neither yields a usable cap.
func EffectiveThreshold(spec store.MarketRuleSpec, avg float64) int64 {
	var best int64
	if spec.MaxPrice > 0 {
		best = spec.MaxPrice
	}
	if spec.MaxPctBelow > 0 && spec.MaxPctBelow < 100 && avg > 0 {
		pctCap := int64(avg * (1.0 - spec.MaxPctBelow/100.0))
		if pctCap > 0 && (best == 0 || pctCap < best) {
			best = pctCap
		}
	}
	return best
}

// SellPremium computes how far above the 7d average a listing floor is (e.g. 0.35 = +35%).
// Rejects spoof prices (<10% of avg), thin markets (<3 units sold), or premiums below minPct.
func SellPremium(floor, avg float64, sold int, minPct float64) (float64, bool) {
	if floor <= 0 || avg <= 0 || floor < avg*0.1 || sold < 3 {
		return 0, false
	}
	prem := floor/avg - 1.0
	if prem < minPct {
		return 0, false
	}
	return prem, true
}

func (ms *MarketService) pickOnlineConn(preferredID int) *AccountConnection {
	return ms.mgr.PickOnlineConnection(preferredID)
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
	ms.mgr.catalog.EnsureLoaded(ctx)
	itemsMeta := ms.mgr.catalog.AllDisplay()
	conn.mu.RLock()
	for id, srv := range conn.itensNossos {
		key := fmt.Sprintf("%d", id)
		cur := itemsMeta[key]
		if cur.ID == 0 {
			cur.ID = id
		}
		if n := asString(srv["nome"]); n != "" && cur.Name == "" {
			cur.Name = formatItemDisplayName(n)
		}
		if ic := asString(srv["icone"]); ic != "" && cur.Icon == "" {
			cur.Icon = fullAssetURL(ic)
		}
		itemsMeta[key] = cur
	}
	conn.mu.RUnlock()

	gs := ms.mgr.Settings()
	return map[string]any{
		"resumo":          resumo,
		"medias":          mediasMap,
		"itemsMeta":       itemsMeta,
		"favs":            favs,
		"sniperEnabled":   gs.SniperEnabled,
		"autoSellEnabled": gs.AutoSellEnabled,
		"autoSellDryRun":  gs.AutoSellDryRun,
		"accountNick":     conn.Account().Nick,
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
	res, err := conn.market.QueryVitrine(ctx, filters)
	if err != nil {
		return nil, err
	}
	ms.mgr.creatures.EnsureLoaded(ctx)

	out := deepCloneMap(res)
	rawRows := asSlice(out["linhas"])
	for _, raw := range rawRows {
		ad := asMap(raw)
		if ad == nil {
			continue
		}
		ficha := asMap(ad["ficha"])
		if ficha == nil {
			ficha = asMap(ad["pokemon"])
		}
		pkSrc := ficha
		if pkSrc == nil {
			pkSrc = ad
		}
		cloned := deepCloneMap(pkSrc)
		if asInt(cloned["id"]) == 0 {
			if pid := asInt(ad["pokemonId"]); pid > 0 {
				cloned["id"] = pid
			}
		}
		seller := asString(ad["vendedor"])
		pkDet := BuildPokemonDetailWithCatalog(0, seller, 0, cloned, ms.mgr.creatures)
		pkDet.Owner = seller

		ad["pokemonDetail"] = pkDet
		if asString(ad["nome"]) == "" && pkDet.Name != "" {
			ad["nome"] = pkDet.Name
		}
		if asInt(ad["level"]) == 0 && pkDet.Level > 0 {
			ad["level"] = pkDet.Level
		}
		if asInt(ad["looktype"]) == 0 && pkDet.Looktype > 0 {
			ad["looktype"] = pkDet.Looktype
		}
		ad["shiny"] = pkDet.Shiny
		ad["tipos"] = pkDet.Types
		ad["tmElemental"] = asString(pkSrc["tmElemental"])
		if ad["tmElemental"] == "" {
			ad["tmElemental"] = asString(ad["tmElemental"])
		}
		ad["tmAoe"] = asBool(pkSrc["tmAoe"]) || asBool(ad["tmAoe"])
	}
	return out, nil
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
	if days < 1 {
		days = 7
	}
	if days > 30 {
		days = 30
	}
	m := "ouro"
	if moeda == "orb" {
		m = "gema"
	}
	key := fmt.Sprintf("serie:%s:%s:%d", strings.ToLower(strings.TrimSpace(name)), m, days)
	ms.cacheMu.Lock()
	if e, ok := ms.guideCache[key]; ok && time.Now().Before(e.exp) {
		ms.cacheMu.Unlock()
		return e.data, nil
	}
	ms.cacheMu.Unlock()

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
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("pokeidleguide.io retornou HTTP %d", resp.StatusCode)
	}
	var data map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	ms.cacheMu.Lock()
	ms.guideCache[key] = guideCacheEntry{data: data, exp: time.Now().Add(30 * time.Minute)}
	ms.cacheMu.Unlock()
	return data, nil
}

func (ms *MarketService) refreshResumo(ctx context.Context, conn *AccountConnection, maxAge time.Duration) (map[string]any, error) {
	ms.cacheMu.Lock()
	if ms.resumoCache != nil && time.Since(ms.resumoAt) < maxAge {
		cp := ms.resumoCache
		ms.cacheMu.Unlock()
		return cp, nil
	}
	ms.cacheMu.Unlock()

	res, err := conn.market.QueryItems(ctx)
	if err != nil {
		return nil, err
	}
	resumo := asMap(res["resumo"])
	medias := asMap(res["medias"])
	ms.cacheMu.Lock()
	if resumo != nil {
		ms.resumoCache = resumo
		ms.resumoAt = time.Now()
	}
	if len(medias) > 0 {
		ms.mediasCache = medias
		ms.mediasAt = time.Now()
	}
	ms.cacheMu.Unlock()
	return resumo, nil
}

func (ms *MarketService) refreshMedias(ctx context.Context, conn *AccountConnection, maxAge time.Duration) (map[string]any, error) {
	ms.cacheMu.Lock()
	if ms.mediasCache != nil && time.Since(ms.mediasAt) < maxAge {
		cp := ms.mediasCache
		ms.cacheMu.Unlock()
		return cp, nil
	}
	ms.cacheMu.Unlock()

	res, err := conn.market.QueryAverages(ctx)
	if err != nil {
		return nil, err
	}
	medias := asMap(res["medias"])
	ms.cacheMu.Lock()
	if medias != nil {
		ms.mediasCache = medias
		ms.mediasAt = time.Now()
	}
	ms.cacheMu.Unlock()
	return medias, nil
}

func (ms *MarketService) avgInfo(itemID int, moeda string) (avg float64, sold int) {
	ms.cacheMu.Lock()
	medias := ms.mediasCache
	ms.cacheMu.Unlock()
	if medias == nil {
		return 0, 0
	}
	entry := asMap(medias[strconv.Itoa(itemID)])
	if entry == nil {
		return 0, 0
	}
	m := asMap(entry[moeda])
	if m == nil {
		return 0, 0
	}
	return asFloat(m["media"]), asInt(m["unidades"])
}

// GetListingDetail resolves a single market listing by ID (used by clickable chat ad links).
func (ms *MarketService) GetListingDetail(ctx context.Context, listingID int) (*ListingDetail, error) {
	if listingID <= 0 {
		return nil, errors.New("ID do anúncio inválido")
	}
	conn := ms.pickOnlineConn(0)
	if conn == nil {
		return nil, errors.New("nenhuma conta online para consultar o mercado")
	}
	res, err := conn.market.QueryListing(ctx, listingID)
	if err != nil {
		return nil, err
	}
	ad := asMap(res["anuncio"])
	if ad == nil {
		return nil, errors.New("esse anúncio já saiu do mercado")
	}
	st := asString(ad["estado"])
	if st != "" && st != "aberto" {
		return nil, errors.New("esse anúncio já foi vendido ou encerrado")
	}
	moeda := "gold"
	if asString(ad["moeda"]) == "orb" {
		moeda = "orb"
	}
	qty := asInt(ad["qtd"])
	if qty <= 0 {
		qty = 1
	}
	kind := asString(ad["tipo"])
	if kind == "" {
		if asMap(ad["ficha"]) != nil {
			kind = "pokemon"
		} else {
			kind = "item"
		}
	}
	det := &ListingDetail{
		ID:        asInt(ad["id"]),
		Kind:      kind,
		Name:      asString(ad["nome"]),
		Qty:       qty,
		Price:     asInt64(ad["preco"]),
		Moeda:     moeda,
		Seller:    asString(ad["vendedor"]),
		Status:    st,
		BuyableAt: asInt64(ad["compravelEm"]),
		ItemID:    asInt(ad["itemId"]),
	}
	if det.ID == 0 {
		det.ID = listingID
	}
	if kind == "pokemon" {
		if ficha := asMap(ad["ficha"]); ficha != nil {
			ms.mgr.creatures.EnsureLoaded(ctx)
			cloned := deepCloneMap(ficha)
			if asInt(cloned["id"]) == 0 {
				cloned["id"] = asInt(ad["pokemonId"])
			}
			pkDet := BuildPokemonDetailWithCatalog(0, det.Seller, 0, cloned, ms.mgr.creatures)
			pkDet.Owner = det.Seller
			det.Pokemon = &pkDet
			if det.Name == "" {
				det.Name = pkDet.Name
			}
		}
	} else if det.ItemID > 0 {
		ms.mgr.catalog.EnsureLoaded(ctx)
		if dm, ok := ms.mgr.catalog.Display(det.ItemID); ok {
			if det.Name == "" {
				det.Name = dm.Name
			}
			det.ItemIcon = dm.Icon
		}
	}
	return det, nil
}

func (ms *MarketService) getUSDPerGem(ctx context.Context, conn *AccountConnection) float64 {
	ms.cacheMu.Lock()
	if ms.usdPerGem > 0 && time.Since(ms.usdPerGemAt) < 30*time.Minute {
		v := ms.usdPerGem
		ms.cacheMu.Unlock()
		return v
	}
	ms.cacheMu.Unlock()

	if conn == nil {
		return 0
	}
	w, err := conn.market.QueryWallet(ctx)
	if err != nil {
		return 0
	}
	precos := asMap(w["precos"])
	val := asFloat(precos["saque"])
	if val <= 0 {
		val = asFloat(precos["compra"])
	}
	ms.cacheMu.Lock()
	if val > 0 {
		ms.usdPerGem = val
	}
	ms.usdPerGemAt = time.Now()
	ms.cacheMu.Unlock()
	return val
}

func (ms *MarketService) lookupShinyGems(ctx context.Context, conn *AccountConnection, speciesName string) (float64, bool) {
	key := strings.ToLower(strings.TrimSpace(speciesName))
	if key == "" {
		return 0, false
	}
	ms.cacheMu.Lock()
	if hit, ok := ms.shinyCache[key]; ok && time.Now().Before(hit.exp) {
		ms.cacheMu.Unlock()
		return hit.gems, hit.ok
	}
	ms.cacheMu.Unlock()

	if conn == nil {
		return 0, false
	}
	res, err := conn.market.QueryTapeFiltered(ctx, "global", 0, map[string]any{
		"tipo":    "pokemon",
		"moeda":   "orb",
		"busca":   speciesName,
		"soShiny": 1,
	})
	if err != nil {
		return 0, false
	}
	var prices []float64
	for _, raw := range asSlice(res["linhas"]) {
		r := asMap(raw)
		if r == nil {
			continue
		}
		if m := asString(r["moeda"]); m != "" && m != "orb" {
			continue
		}
		p := asFloat(r["bruto"])
		if p <= 0 {
			p = asFloat(r["preco"])
		}
		if p > 0 {
			prices = append(prices, p)
		}
	}
	var median float64
	ok := false
	if len(prices) > 0 {
		sort.Float64s(prices)
		median = prices[len(prices)/2]
		ok = true
	}
	ms.cacheMu.Lock()
	ms.shinyCache[key] = shinyPriceCacheEntry{gems: median, ok: ok, exp: time.Now().Add(time.Hour)}
	ms.cacheMu.Unlock()
	return median, ok
}

// Valuation estimates the total inventory value (orbs wallet + items + shinies) in Gems and USD.
func (ms *MarketService) Valuation(ctx context.Context, accountID int) (*InventoryValuation, error) {
	conn := ms.pickOnlineConn(accountID)
	if conn == nil {
		return nil, errors.New("nenhuma conta online para calcular valoração")
	}
	_, _ = ms.refreshResumo(ctx, conn, 2*time.Minute)
	medias, err := ms.refreshMedias(ctx, conn, 5*time.Minute)
	if err != nil && len(medias) == 0 {
		return nil, err
	}
	usdPerGem := ms.getUSDPerGem(ctx, conn)

	inv := ms.mgr.BuildInventory(accountID)
	pks := ms.mgr.ListPokemons(accountID, "level")

	out := &InventoryValuation{
		USDPerGem:   usdPerGem,
		OrbsBalance: inv.TotalOrbs,
	}

	var entries []ValuationItem
	for _, it := range inv.Items {
		if it.Kind == "ball" || it.Total <= 0 {
			continue
		}
		avgGems, _ := ms.avgInfo(it.ID, "orb")
		if avgGems <= 0 {
			continue
		}
		tot := avgGems * float64(it.Total)
		if it.Kind == "rare" {
			out.RareItemsGems += tot
		} else {
			out.OtherItemsGems += tot
		}
		entries = append(entries, ValuationItem{
			Key:       fmt.Sprintf("item:%d", it.ID),
			Kind:      it.Kind,
			Name:      it.Name,
			Icon:      it.Icon,
			Qty:       it.Total,
			UnitGems:  avgGems,
			TotalGems: tot,
			TotalUSD:  tot * usdPerGem,
		})
	}

	// Collect shinies grouped by species name; price up to 6 uncached species per call.
	type shinyGroup struct {
		name     string
		looktype int
		qty      int
	}
	shinyMap := map[string]*shinyGroup{}
	var speciesOrder []string
	for _, pk := range pks {
		if !pk.Shiny {
			continue
		}
		out.TotalShinies++
		nm := strings.TrimSpace(pk.Name)
		if nm == "" {
			continue
		}
		k := strings.ToLower(nm)
		g := shinyMap[k]
		if g == nil {
			g = &shinyGroup{name: nm, looktype: pk.Looktype}
			shinyMap[k] = g
			speciesOrder = append(speciesOrder, k)
		}
		g.qty++
	}

	queried := 0
	const maxShinyQueries = 6
	for _, k := range speciesOrder {
		g := shinyMap[k]
		ms.cacheMu.Lock()
		hit, hasCache := ms.shinyCache[k]
		fresh := hasCache && time.Now().Before(hit.exp)
		ms.cacheMu.Unlock()

		var unit float64
		var ok bool
		if fresh {
			unit, ok = hit.gems, hit.ok
		} else if queried < maxShinyQueries {
			queried++
			unit, ok = ms.lookupShinyGems(ctx, conn, g.name)
		} else {
			out.PendingShinies += g.qty
			continue
		}
		if ok && unit > 0 {
			out.PricedShinies += g.qty
			tot := unit * float64(g.qty)
			out.ShiniesGems += tot
			entries = append(entries, ValuationItem{
				Key:       "shiny:" + k,
				Kind:      "shiny",
				Name:      "Shiny " + g.name,
				Looktype:  g.looktype,
				Qty:       g.qty,
				UnitGems:  unit,
				TotalGems: tot,
				TotalUSD:  tot * usdPerGem,
			})
		}
	}

	out.TotalGems = float64(out.OrbsBalance) + out.RareItemsGems + out.OtherItemsGems + out.ShiniesGems
	out.TotalUSD = out.TotalGems * usdPerGem

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].TotalGems > entries[j].TotalGems
	})
	if len(entries) > 12 {
		entries = entries[:12]
	}
	out.TopEntries = entries
	return out, nil
}

// RunRuleLoop checks Alert & Sniper rules every 6 seconds and rare-item sell alerts every 2 minutes.
func (ms *MarketService) RunRuleLoop(ctx context.Context) {
	ticker := time.NewTicker(6 * time.Second)
	pruneTicker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	defer pruneTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-pruneTicker.C:
			ms.pruneCaches(time.Now())
		case <-ticker.C:
			ms.tickSellAlerts(ctx)
			ms.tickRules(ctx)
			ms.tickAutoSell(ctx)
		}
	}
}

func (ms *MarketService) pruneCaches(now time.Time) {
	const dedupeTTL = 24 * time.Hour
	ms.cacheMu.Lock()
	defer ms.cacheMu.Unlock()
	for k, e := range ms.guideCache {
		if !now.Before(e.exp) {
			delete(ms.guideCache, k)
		}
	}
	for k, e := range ms.shinyCache {
		if !now.Before(e.exp) {
			delete(ms.shinyCache, k)
		}
	}
	for k, at := range ms.seenAlerted {
		if now.Sub(at) > dedupeTTL {
			delete(ms.seenAlerted, k)
		}
	}
	for id, at := range ms.snipedIDs {
		if now.Sub(at) > dedupeTTL {
			delete(ms.snipedIDs, id)
		}
	}
	for k, e := range ms.sellAlerted {
		if now.Sub(e.at) > dedupeTTL {
			delete(ms.sellAlerted, k)
		}
	}
	for k, e := range ms.pokeMedianCache {
		if !now.Before(e.exp) {
			delete(ms.pokeMedianCache, k)
		}
	}
}

func (ms *MarketService) tickSellAlerts(ctx context.Context) {
	gs := ms.mgr.Settings()
	if !gs.MarketSellAlert || strings.TrimSpace(gs.DiscordWebhookURL) == "" {
		return
	}
	ms.cacheMu.Lock()
	if !ms.lastSellTick.IsZero() && time.Since(ms.lastSellTick) < 2*time.Minute {
		ms.cacheMu.Unlock()
		return
	}
	ms.lastSellTick = time.Now()
	ms.cacheMu.Unlock()

	conn := ms.pickOnlineConn(0)
	if conn == nil {
		return
	}
	inv := ms.mgr.BuildInventory(0)
	var rares []InventoryItemEntry
	for _, it := range inv.Items {
		if it.Kind == "rare" && it.Total > 0 {
			rares = append(rares, it)
		}
	}
	if len(rares) == 0 {
		return
	}
	resumo, err := ms.refreshResumo(ctx, conn, time.Minute)
	if err != nil || resumo == nil {
		return
	}
	_, _ = ms.refreshMedias(ctx, conn, 5*time.Minute)

	pct := float64(gs.MarketSellAlertPct)
	if pct < 5 {
		pct = 30
	}
	minPrem := pct / 100.0
	now := time.Now()

	for _, it := range rares {
		r := asMap(resumo[strconv.Itoa(it.ID)])
		if r == nil {
			continue
		}
		floor := asFloat(r["minOrb"])
		avg, sold := ms.avgInfo(it.ID, "orb")
		prem, ok := SellPremium(floor, avg, sold, minPrem)
		if !ok {
			continue
		}
		key := fmt.Sprintf("%d:orb", it.ID)
		ms.cacheMu.Lock()
		prev, seen := ms.sellAlerted[key]
		if seen && now.Sub(prev.at) < 6*time.Hour && prem < prev.premium+0.25 {
			ms.cacheMu.Unlock()
			continue
		}
		ms.sellAlerted[key] = sellAlertEntry{at: now, premium: prem}
		ms.cacheMu.Unlock()

		var holders []string
		for _, a := range it.Accounts {
			holders = append(holders, fmt.Sprintf("%s: %d", a.Nick, a.Qty))
		}
		desc := fmt.Sprintf("Menor preço **%s** Gemas — **+%.0f%%** acima da média 7d (%s).",
			formatIntPT(int64(floor)), prem*100, formatIntPT(int64(avg)))
		ms.mgr.Notifier().Send(DiscordEmbed{
			Title:       fmt.Sprintf("💰 Ótimo para vender: %s", it.Name),
			Description: desc,
			Color:       ColorGreen,
			Fields: []DiscordEmbedField{
				{Name: "Você tem", Value: fmt.Sprintf("%d un.", it.Total), Inline: true},
				{Name: "Valor no piso", Value: fmt.Sprintf("%s Gemas", formatIntPT(int64(floor)*int64(it.Total))), Inline: true},
				{Name: "Contas", Value: strings.Join(holders, " · "), Inline: false},
			},
		})
		_ = ms.store.AppendMarketLog(0, 0, "venda_alta", fmt.Sprintf("Ótimo para vender %s: +%d%% (%d Gemas vs média %d)", it.Name, int(prem*100), int64(floor), int64(avg)))
	}
}

func describeMarketRule(spec store.MarketRuleSpec) string {
	if spec.Target == "pokemon" {
		parts := []string{}
		if strings.TrimSpace(spec.Query) != "" {
			parts = append(parts, strings.TrimSpace(spec.Query))
		} else {
			parts = append(parts, "Qualquer Pokémon")
		}
		if spec.OnlyShiny {
			parts = append(parts, "Shiny")
		}
		if spec.OnlyP5 {
			parts = append(parts, "P5")
		}
		if spec.OnlyZMove {
			parts = append(parts, "Z-Move")
		}
		if spec.OnlyTmAoe {
			parts = append(parts, "AoE")
		}
		if spec.MinIV > 0 {
			parts = append(parts, fmt.Sprintf("IV≥%d", spec.MinIV))
		}
		if spec.MinLevel > 0 {
			parts = append(parts, fmt.Sprintf("Lv≥%d", spec.MinLevel))
		}
		return strings.Join(parts, " · ")
	}
	if spec.ItemName != "" {
		return spec.ItemName
	}
	return fmt.Sprintf("Item #%d", spec.ItemID)
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
		moeda := rule.Spec.Moeda
		if moeda != "orb" {
			moeda = "gold"
		}

		var avg float64
		if rule.Spec.Target == "item" && rule.Spec.MaxPctBelow > 0 {
			_, _ = ms.refreshMedias(ctx, conn, 5*time.Minute)
			avg, _ = ms.avgInfo(rule.Spec.ItemID, moeda)
		}
		thr := EffectiveThreshold(rule.Spec, avg)
		if thr <= 0 {
			continue
		}

		var rows []any
		if rule.Spec.Target == "pokemon" {
			filters := map[string]any{
				"tipo":          "pokemon",
				"moeda":         moeda,
				"ordem":         "baratos",
				"busca":         strings.TrimSpace(rule.Spec.Query),
				"elemento":      strings.TrimSpace(rule.Spec.Elemento),
				"soShiny":       rule.Spec.OnlyShiny,
				"soP5":          rule.Spec.OnlyP5,
				"soTmElemental": rule.Spec.OnlyZMove,
				"soTmAoe":       rule.Spec.OnlyTmAoe,
				"pagina":        0,
			}
			if rule.Spec.MinIV > 0 {
				filters["ivMin"] = rule.Spec.MinIV
			}
			if rule.Spec.MinLevel > 0 {
				filters["nivelMin"] = rule.Spec.MinLevel
			}
			resp, err := conn.market.QueryVitrine(ctx, filters)
			if err != nil {
				continue
			}
			rows = asSlice(resp["linhas"])
		} else if rule.Spec.Target == "item" && rule.Spec.ItemID > 0 {
			// Cheap pre-filter via cached resumo before requesting per-item listings.
			if resumo, err := ms.refreshResumo(ctx, conn, 8*time.Second); err == nil && resumo != nil {
				if r := asMap(resumo[strconv.Itoa(rule.Spec.ItemID)]); r != nil {
					floorKey := "minGold"
					if moeda == "orb" {
						floorKey = "minOrb"
					}
					floor := asInt64(r[floorKey])
					if floor <= 0 || floor > thr {
						continue
					}
				}
			}
			resp, err := conn.market.QueryItemListings(ctx, rule.Spec.ItemID, moeda)
			if err != nil {
				continue
			}
			rows = asSlice(resp["linhas"])
		} else {
			continue
		}

		label := describeMarketRule(rule.Spec)
		moedaLabel := "Gold"
		if moeda == "orb" {
			moedaLabel = "Gemas"
		}

		for _, raw := range rows {
			ad := asMap(raw)
			if ad == nil {
				continue
			}
			adID := asInt(ad["id"])
			price := asInt64(ad["preco"])
			qty := asInt(ad["qtd"])
			if rule.Spec.Target == "pokemon" || qty <= 0 {
				qty = 1
			}
			estado := asString(ad["estado"])
			if estado != "" && estado != "aberto" {
				continue
			}
			if asString(ad["comprador"]) != "" {
				continue
			}
			seller := strings.ToLower(asString(ad["vendedor"]))
			if seller != "" && ownNicks[seller] {
				continue // never buy from own accounts
			}
			if price <= 0 || price > thr {
				continue
			}

			adName := asString(ad["nome"])
			if adName == "" {
				if ficha := asMap(ad["ficha"]); ficha != nil {
					adName = asString(ficha["nome"])
				}
			}
			if adName == "" {
				if pk := asMap(ad["pokemon"]); pk != nil {
					adName = asString(pk["nome"])
				}
			}
			if adName == "" {
				adName = label
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
				msg := fmt.Sprintf("**%dx %s** por **%s %s** (vendedor: %s) — teto ≤ %s",
					qty, adName, formatIntPT(price), moedaLabel, asString(ad["vendedor"]), formatIntPT(thr))
				_ = ms.store.AppendMarketLog(0, rule.ID, "alerta", fmt.Sprintf("%s: %dx @ %d %s (teto %d)", adName, qty, price, moedaLabel, thr))
				ms.mgr.Notifier().Send(DiscordEmbed{
					Title:       fmt.Sprintf("🔔 Alerta de Mercado — %s", label),
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
				if c == nil || !c.IsOnline() {
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
