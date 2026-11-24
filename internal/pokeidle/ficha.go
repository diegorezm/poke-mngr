package pokeidle

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"
)

const (
	fichaCacheTTL  = 60 * time.Second
	fichaWaitLimit = 8 * time.Second
	fichaCacheMax  = 200
)

type fichaCacheEntry struct {
	pk  map[string]any
	exp time.Time
}

// PublicFichaHub requests `chat.verPokemon` via an online account and delivers the matching `ranking.ficha` frame.
type PublicFichaHub struct {
	mu      sync.Mutex
	cache   map[int]fichaCacheEntry
	waiters map[int][]chan map[string]any
}

func NewPublicFichaHub() *PublicFichaHub {
	return &PublicFichaHub{
		cache:   map[int]fichaCacheEntry{},
		waiters: map[int][]chan map[string]any{},
	}
}

func (h *PublicFichaHub) HandleFrame(msg map[string]any) {
	if msg == nil || msg["dica"] != nil {
		return
	}
	pk := asMap(msg["pokemon"])
	if pk == nil {
		return
	}
	pid := asInt(pk["id"])
	if pid <= 0 {
		return
	}
	cloned := deepCloneMap(pk)

	h.mu.Lock()
	if len(h.cache) >= fichaCacheMax {
		for k := range h.cache {
			delete(h.cache, k)
			break
		}
	}
	h.cache[pid] = fichaCacheEntry{pk: cloned, exp: time.Now().Add(fichaCacheTTL)}
	list := h.waiters[pid]
	delete(h.waiters, pid)
	h.mu.Unlock()

	for _, ch := range list {
		select {
		case ch <- cloned:
		default:
		}
	}
}

func (h *PublicFichaHub) Get(ctx context.Context, conn *AccountConnection, nick string, pokemonID int) (map[string]any, error) {
	if pokemonID <= 0 || strings.TrimSpace(nick) == "" {
		return nil, errors.New("jogador ou Pokémon inválido")
	}

	h.mu.Lock()
	if hit, ok := h.cache[pokemonID]; ok && time.Now().Before(hit.exp) {
		h.mu.Unlock()
		return deepCloneMap(hit.pk), nil
	}
	ch := make(chan map[string]any, 1)
	h.waiters[pokemonID] = append(h.waiters[pokemonID], ch)
	h.mu.Unlock()

	cleanup := func() {
		h.mu.Lock()
		list := h.waiters[pokemonID]
		for i, c := range list {
			if c == ch {
				list = append(list[:i], list[i+1:]...)
				break
			}
		}
		if len(list) == 0 {
			delete(h.waiters, pokemonID)
		} else {
			h.waiters[pokemonID] = list
		}
		h.mu.Unlock()
	}

	if err := conn.sendJSON(ctx, map[string]any{
		"t":         "chat.verPokemon",
		"nick":      strings.TrimSpace(nick),
		"pokemonId": pokemonID,
	}); err != nil {
		cleanup()
		return nil, err
	}

	wctx, cancel := context.WithTimeout(ctx, fichaWaitLimit)
	defer cancel()
	select {
	case pk := <-ch:
		return pk, nil
	case <-wctx.Done():
		cleanup()
		return nil, errors.New("o jogo não respondeu: o Pokémon pode ter sido vendido ou liberado")
	}
}

// GetPublicPokemonSheet returns a complete PokemonDetail for a Pokémon shared/captured in chat.
func (m *AccountManager) GetPublicPokemonSheet(ctx context.Context, nick string, pokemonID int) (*PokemonDetail, error) {
	nick = strings.TrimSpace(nick)
	if nick == "" || pokemonID <= 0 {
		return nil, errors.New("faltou o jogador ou ID do Pokémon")
	}
	m.creatures.EnsureLoaded(ctx)

	// Fast path: if the Pokémon belongs to one of our own accounts, use our full live state.
	m.mu.RLock()
	var conns []*AccountConnection
	for _, c := range m.conns {
		conns = append(conns, c)
	}
	m.mu.RUnlock()

	var onlineConn *AccountConnection
	for _, c := range conns {
		c.mu.RLock()
		isOnline := c.state == StateOnline
		accID := c.acc.ID
		accNick := c.acc.Nick
		activeID := asInt(c.hunt.Estado["activeId"])
		var found map[string]any
		if strings.EqualFold(accNick, nick) {
			for _, raw := range asSlice(c.hunt.Estado["pokemons"]) {
				if pm := asMap(raw); pm != nil && asInt(pm["id"]) == pokemonID {
					found = deepCloneMap(pm)
					break
				}
			}
		}
		c.mu.RUnlock()
		if isOnline && onlineConn == nil {
			onlineConn = c
		}
		if found != nil {
			det := BuildPokemonDetailWithCatalog(accID, accNick, activeID, found, m.creatures)
			det.Owner = accNick
			return &det, nil
		}
	}

	if onlineConn == nil {
		return nil, errors.New("nenhuma conta online para consultar o jogo")
	}
	pk, err := m.fichas.Get(ctx, onlineConn, nick, pokemonID)
	if err != nil {
		return nil, err
	}
	det := BuildPokemonDetailWithCatalog(0, nick, 0, pk, m.creatures)
	det.Owner = nick
	return &det, nil
}
