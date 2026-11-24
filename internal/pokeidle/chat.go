package pokeidle

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var ChatChannels = []string{"mundo", "comercio", "duvidas"}

const (
	chatBufferMax     = 200
	chatMinLevel      = 10
	chatMaxLen        = 200
	chatSendGap       = 3 * time.Second
	chatDupWindow     = 30 * time.Second
	chatHistoryRetry  = 60 * time.Second
)

var (
	chatLinkRe  = regexp.MustCompile(`(?i)(https?://|www\.|\b[a-z0-9-]+\.(com|net|org|io|gg|br|app|dev|xyz|gl|ly|me|co|tv)\b|discord\.gg/)`)
	chatHexRe   = regexp.MustCompile(`^#[0-9a-fA-F]{3,8}$`)
	chatCargoRe = regexp.MustCompile(`[^a-z]`)
)

type ChatAdLink struct {
	ID    int    `json:"id"`
	Qty   int    `json:"qtd"`
	Name  string `json:"nome"`
	Price string `json:"preco"`
	Moeda string `json:"moeda"`
}

type ChatPokemonLink struct {
	Nick  string `json:"nick"`
	ID    int    `json:"id"`
	Label string `json:"label"`
}

type ChatMessage struct {
	ID         any              `json:"id"`
	IDKey      string           `json:"-"`
	TS         int64            `json:"ts"`
	Canal      string           `json:"canal"`
	De         string           `json:"de"`
	Nivel      int              `json:"nivel"`
	Cargo      string           `json:"cargo,omitempty"`
	Guild      string           `json:"guild,omitempty"`
	GuildColor string           `json:"guildColor,omitempty"`
	Kind       string           `json:"kind"` // msg | shiny | rare | share | ad
	Text       string           `json:"text"`
	Ad         *ChatAdLink      `json:"ad,omitempty"`
	PK         *ChatPokemonLink `json:"pk,omitempty"`
}

type ChatEvent struct {
	Type    string        `json:"type"` // chat | history | del | notice
	Canal   string        `json:"canal,omitempty"`
	Msg     *ChatMessage  `json:"msg,omitempty"`
	Msgs    []ChatMessage `json:"msgs,omitempty"`
	DelID   string        `json:"delId,omitempty"`
	Notice  string        `json:"notice,omitempty"`
	Account int           `json:"account,omitempty"`
}

type ChatHub struct {
	mu       sync.RWMutex
	buffers  map[string][]ChatMessage
	ids      map[string]map[string]bool
	asked    map[string]time.Time
	lastSent map[int]time.Time
	lastText map[int]struct {
		text string
		at   time.Time
	}
	onEvent func(ChatEvent)
}

func NewChatHub() *ChatHub {
	h := &ChatHub{
		buffers:  map[string][]ChatMessage{},
		ids:      map[string]map[string]bool{},
		asked:    map[string]time.Time{},
		lastSent: map[int]time.Time{},
		lastText: map[int]struct {
			text string
			at   time.Time
		}{},
	}
	for _, c := range ChatChannels {
		h.buffers[c] = []ChatMessage{}
		h.ids[c] = map[string]bool{}
	}
	return h
}

func (h *ChatHub) SetEventHandler(fn func(ChatEvent)) {
	h.mu.Lock()
	h.onEvent = fn
	h.mu.Unlock()
}

func (h *ChatHub) emit(ev ChatEvent) {
	h.mu.RLock()
	fn := h.onEvent
	h.mu.RUnlock()
	if fn != nil {
		fn(ev)
	}
}

func (h *ChatHub) Messages(canal string) []ChatMessage {
	h.mu.RLock()
	defer h.mu.RUnlock()
	list := h.buffers[canal]
	out := make([]ChatMessage, len(list))
	copy(out, list)
	return out
}

func (h *ChatHub) OnAccountOnline(ctx context.Context, conn *AccountConnection) {
	now := time.Now()
	var toAsk []string
	h.mu.Lock()
	for _, c := range ChatChannels {
		if len(h.buffers[c]) == 0 && now.Sub(h.asked[c]) >= chatHistoryRetry {
			h.asked[c] = now
			toAsk = append(toAsk, c)
		}
	}
	h.mu.Unlock()
	for _, c := range toAsk {
		_ = conn.sendJSON(ctx, map[string]any{"t": "chat.historico", "canal": c})
	}
}

func (h *ChatHub) HandleFrame(accID int, nick string, msg map[string]any) {
	t := asString(msg["t"])
	switch t {
	case "chat":
		row := normalizeChatMsg(msg, "")
		if row == nil {
			return
		}
		if h.addLocked(*row) {
			h.emit(ChatEvent{Type: "chat", Canal: row.Canal, Msg: row})
		}
	case "chat.historico":
		canal := asString(msg["canal"])
		if !isValidChatChannel(canal) {
			return
		}
		var rows []ChatMessage
		for _, raw := range asSlice(msg["mensagens"]) {
			if m := asMap(raw); m != nil {
				if r := normalizeChatMsg(m, canal); r != nil {
					rows = append(rows, *r)
				}
			}
		}
		sort.Slice(rows, func(i, j int) bool { return rows[i].TS < rows[j].TS })
		added := 0
		h.mu.Lock()
		for _, r := range rows {
			if h.addUnsafe(r) {
				added++
			}
		}
		if added > 0 {
			sort.Slice(h.buffers[canal], func(i, j int) bool { return h.buffers[canal][i].TS < h.buffers[canal][j].TS })
		}
		snap := make([]ChatMessage, len(h.buffers[canal]))
		copy(snap, h.buffers[canal])
		h.mu.Unlock()
		if added > 0 {
			h.emit(ChatEvent{Type: "history", Canal: canal, Msgs: snap})
		}
	case "chat.del":
		idKey := fmt.Sprint(msg["id"])
		h.mu.Lock()
		for _, c := range ChatChannels {
			if h.ids[c][idKey] {
				delete(h.ids[c], idKey)
				kept := h.buffers[c][:0]
				for _, m := range h.buffers[c] {
					if m.IDKey != idKey {
						kept = append(kept, m)
					}
				}
				h.buffers[c] = kept
				h.mu.Unlock()
				h.emit(ChatEvent{Type: "del", Canal: c, DelID: idKey})
				return
			}
		}
		h.mu.Unlock()
	case "chat.mute":
		h.emit(ChatEvent{
			Type:    "notice",
			Account: accID,
			Notice:  fmt.Sprintf("%s: o chat está silenciado nesta conta.", nick),
		})
	case "chat.aviso":
		h.emit(ChatEvent{
			Type:    "notice",
			Account: accID,
			Notice:  fmt.Sprintf("%s: mensagem recusada (%s).", nick, asString(msg["chave"])),
		})
	}
}

func (h *ChatHub) addLocked(row ChatMessage) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.addUnsafe(row)
}

func (h *ChatHub) addUnsafe(row ChatMessage) bool {
	if h.ids[row.Canal][row.IDKey] {
		return false
	}
	buf := h.buffers[row.Canal]
	if len(buf) >= chatBufferMax {
		delete(h.ids[row.Canal], buf[0].IDKey)
		buf = buf[1:]
	}
	buf = append(buf, row)
	h.buffers[row.Canal] = buf
	h.ids[row.Canal][row.IDKey] = true
	return true
}

func (h *ChatHub) Send(ctx context.Context, conn *AccountConnection, canal, texto string) error {
	if !isValidChatChannel(canal) {
		return fmt.Errorf("canal inválido: %s", canal)
	}
	txt := strings.TrimSpace(texto)
	if txt == "" {
		return fmt.Errorf("mensagem vazia")
	}
	if len([]rune(txt)) > chatMaxLen {
		return fmt.Errorf("mensagem excede %d caracteres", chatMaxLen)
	}
	if chatLinkRe.MatchString(txt) {
		return fmt.Errorf("links não são permitidos no chat")
	}

	snap := conn.Snapshot()
	if snap.State != StateOnline {
		return fmt.Errorf("conta %s está offline", snap.Nick)
	}
	if snap.Level < chatMinLevel {
		return fmt.Errorf("conta precisa ser nível %d+ para falar no chat", chatMinLevel)
	}

	now := time.Now()
	h.mu.Lock()
	if last, ok := h.lastSent[snap.ID]; ok && now.Sub(last) < chatSendGap {
		wait := (chatSendGap - now.Sub(last)).Seconds()
		h.mu.Unlock()
		return fmt.Errorf("aguarde %.1fs antes de enviar novamente", wait)
	}
	if prev, ok := h.lastText[snap.ID]; ok && strings.EqualFold(prev.text, txt) && now.Sub(prev.at) < chatDupWindow {
		h.mu.Unlock()
		return fmt.Errorf("mensagem duplicada recente — evite spam")
	}
	h.lastSent[snap.ID] = now
	h.lastText[snap.ID] = struct {
		text string
		at   time.Time
	}{text: txt, at: now}
	h.mu.Unlock()

	return conn.sendJSON(ctx, map[string]any{
		"t":      "chat.send",
		"canal":  canal,
		"idioma": "pt",
		"texto":  txt,
	})
}

func isValidChatChannel(c string) bool {
	return c == "mundo" || c == "comercio" || c == "duvidas"
}

func normalizeChatMsg(m map[string]any, fallbackCanal string) *ChatMessage {
	if m == nil || m["id"] == nil || asBool(m["apagada"]) {
		return nil
	}
	canal := fallbackCanal
	if canal == "" {
		canal = asString(m["canal"])
	}
	if !isValidChatChannel(canal) {
		return nil
	}
	idioma := asString(m["idioma"])
	if idioma != "" && idioma != "pt" {
		return nil
	}

	kind := "msg"
	text := ""
	var ad *ChatAdLink

	if sc := asMap(m["shinyCaptura"]); sc != nil {
		kind = "shiny"
		verb := "capturou"
		if asBool(sc["ovo"]) {
			verb = "chocou um ovo e veio"
		}
		text = fmt.Sprintf("✨ %s %s um %s shiny!", asString(sc["nick"]), verb, asString(sc["nome"]))
	} else if lc := asMap(m["lendarioCaptura"]); lc != nil {
		kind = "rare"
		raro := "lendário"
		if asBool(lc["mitico"]) {
			raro = "mítico"
		}
		sh := ""
		if asBool(lc["shiny"]) {
			sh = " shiny"
		}
		text = fmt.Sprintf("🌟 %s capturou o %s%s %s!", asString(lc["nick"]), raro, sh, asString(lc["nome"]))
	} else if drop := asMap(m["dropLendario"]); drop != nil {
		kind = "rare"
		item := "uma casa"
		if asString(drop["tipo"]) == "bicicleta" {
			item = "uma bicicleta"
		}
		text = fmt.Sprintf("🎁 %s ganhou %s lendário!", asString(drop["nick"]), item)
	} else if drop := asMap(m["dropMitico"]); drop != nil {
		kind = "rare"
		item := "uma casa"
		if asString(drop["tipo"]) == "bicicleta" {
			item = "uma bicicleta"
		}
		text = fmt.Sprintf("🎁 %s ganhou %s mítico!", asString(drop["nick"]), item)
	} else if ps := asMap(m["pkShare"]); ps != nil {
		kind = "share"
		nm := asString(ps["apelido"])
		if nm == "" {
			nm = asString(ps["nome"])
		}
		text = fmt.Sprintf("mostrou o Pokémon %s", nm)
	} else if ds := asMap(m["dexShare"]); ds != nil {
		kind = "share"
		text = fmt.Sprintf("mostrou a Pokédex de %s", asString(ds["nome"]))
	} else if ac := asMap(m["anuncioChat"]); ac != nil && asInt(ac["id"]) > 0 {
		kind = "ad"
		moeda := "gold"
		moedaLbl := "Gold"
		if asString(ac["moeda"]) == "orb" {
			moeda = "gemas"
			moedaLbl = "Gemas"
		}
		qtd := asInt(ac["qtd"])
		if qtd <= 0 {
			qtd = 1
		}
		preco := fmt.Sprintf("%d", asInt64(ac["preco"]))
		ad = &ChatAdLink{
			ID:    asInt(ac["id"]),
			Qty:   qtd,
			Name:  asString(ac["nome"]),
			Price: preco,
			Moeda: moeda,
		}
		cada := ""
		if qtd > 1 {
			cada = " cada"
		}
		text = fmt.Sprintf("estou anunciando %dx %s por %s %s%s!", qtd, ad.Name, preco, moedaLbl, cada)
	} else if txt := strings.TrimSpace(asString(m["texto"])); txt != "" {
		text = txt
	} else {
		return nil
	}

	var pkLink *ChatPokemonLink
	for _, key := range []string{"pkShare", "shinyCaptura", "lendarioCaptura"} {
		if s := asMap(m[key]); s != nil {
			pid := asInt(s["pokemonId"])
			nick := asString(s["nick"])
			lbl := asString(s["apelido"])
			if lbl == "" {
				lbl = asString(s["nome"])
			}
			if pid > 0 && nick != "" && lbl != "" {
				pkLink = &ChatPokemonLink{Nick: nick, ID: pid, Label: lbl}
				break
			}
		}
	}

	ts := asInt64(m["ts"])
	if ts == 0 {
		ts = time.Now().UnixMilli()
	}
	cargo := chatCargoRe.ReplaceAllString(strings.ToLower(asString(m["cargo"])), "")
	gCol := asString(m["guildTagCor"])
	if !chatHexRe.MatchString(gCol) {
		gCol = ""
	}

	return &ChatMessage{
		ID:         m["id"],
		IDKey:      fmt.Sprint(m["id"]),
		TS:         ts,
		Canal:      canal,
		De:         asString(m["de"]),
		Nivel:      asInt(m["nivel"]),
		Cargo:      cargo,
		Guild:      asString(m["guildTag"]),
		GuildColor: gCol,
		Kind:       kind,
		Text:       text,
		Ad:         ad,
		PK:         pkLink,
	}
}
