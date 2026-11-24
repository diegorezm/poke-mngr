package pokeidle

import (
	"encoding/json"
	"strconv"
	"strings"

	"poke-mngr/internal/sysmem"
)

type ConnectionState string

const (
	StateDisconnected   ConnectionState = "DISCONNECTED"
	StateConnecting     ConnectionState = "CONNECTING"
	StateAuthenticating ConnectionState = "AUTHENTICATING"
	StateOnline         ConnectionState = "ONLINE"
	StatePausedCooldown ConnectionState = "PAUSED_COOLDOWN"
	StateBlocked        ConnectionState = "BLOCKED"
)

type BlockInfo struct {
	Kind   string `json:"kind"`
	Detail string `json:"detail"`
}

type BlockingRule struct {
	Kind   string
	Detail string
}

var BlockingKeys = map[string]BlockingRule{
	"auth.sessaoInvalida": {Kind: "invalid", Detail: "Sessão inválida ou expirada: reimporte a conta"},
	"auth.precisaLogin":   {Kind: "invalid", Detail: "Sessão inválida ou expirada: reimporte a conta"},
	"auth.contaBanida":    {Kind: "banned", Detail: "Conta banida pelo jogo"},
	"auth.ipBanido":       {Kind: "net_banned", Detail: "Rede (IP) banida pelo jogo"},
	"auth.provedorBanido": {Kind: "net_banned", Detail: "Provedor de rede banido pelo jogo"},
	"auth.contaExcluida":  {Kind: "deleted", Detail: "Conta excluída"},
	"login.precisaNick":   {Kind: "needs_nick", Detail: "A conta precisa escolher um nick dentro do jogo"},
}

var NetworkFullKeys = map[string]bool{
	"login.limiteOnlineIp":      true,
	"login.limiteOnlineIpLista": true,
}

type PokemonSummary struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	Species    string `json:"species"`
	Level      int    `json:"level"`
	HP         int    `json:"hp"`
	MaxHP      int    `json:"maxHp"`
	XP         int64  `json:"xp"`
	XPNext     int64  `json:"xpNext"`
	Shiny      bool   `json:"shiny"`
	Looktype   int    `json:"looktype"`
	HeldItemID int    `json:"heldItemId"`
}

type EquippedItem struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Stock int    `json:"stock"`
}

type PassSnapshot struct {
	CanClaim bool           `json:"canClaim"`
	Raw      map[string]any `json:"raw,omitempty"`
}

type SessionTelemetry struct {
	StartedAt     int64          `json:"startedAt"`
	Gained        map[string]int `json:"gained"`
	ShiniesSeen   int            `json:"shiniesSeen"`
	ShiniesCaught int            `json:"shiniesCaught"`
	ShowShinies   bool           `json:"showShinies"`
}

type HuntTelemetry struct {
	Slug          string  `json:"slug"`
	Name          string  `json:"name"`
	PendingSlug   string  `json:"pendingSlug,omitempty"`
	CombatLockMs  int64   `json:"combatLockMs"`
	OutlandTier   int     `json:"outlandTier"`
	IsOutland     bool    `json:"isOutland"`
	ElapsedSec    int64   `json:"elapsedSec"`
	Kills         int64   `json:"kills"`
	KillsPerHour  float64 `json:"killsPerHour"`
	XPPerHour     float64 `json:"xpPerHour"`
	GoldPerHour   float64 `json:"goldPerHour"`
	XPGained      int64   `json:"xpGained"`
	GoldGained    int64   `json:"goldGained"`
}

type AccountTelemetry struct {
	ID             int               `json:"id"`
	UUID           string            `json:"uuid"`
	Nick           string            `json:"nick"`
	Enabled        bool              `json:"enabled"`
	OrderIndex     int               `json:"orderIndex"`
	State          ConnectionState   `json:"state"`
	Block          *BlockInfo        `json:"block,omitempty"`
	LastReason     string            `json:"lastReason,omitempty"`
	CooldownUntil  int64             `json:"cooldownUntil,omitempty"`
	ExitIP         string            `json:"exitIp"`
	ProxyLabel     string            `json:"proxyLabel,omitempty"`
	BridgeAttached bool              `json:"bridgeAttached"`
	DirectMode     bool              `json:"directMode"`
	Level          int               `json:"level"`
	XP             int64             `json:"xp"`
	XPLevel        int64             `json:"xpLevel"`
	XPNext         int64             `json:"xpNext"`
	Gold           int64             `json:"gold"`
	Orbs           int64             `json:"orbs"`
	Diamonds       int64             `json:"diamonds"`
	ActivePokemon  *PokemonSummary   `json:"activePokemon,omitempty"`
	EquippedPotion *EquippedItem     `json:"equippedPotion,omitempty"`
	EquippedBall   *EquippedItem     `json:"equippedBall,omitempty"`
	Hunt           HuntTelemetry     `json:"hunt"`
	BallsCaught    int               `json:"ballsCaught"`
	BallsFailed    int               `json:"ballsFailed"`
	PokemonCount   int               `json:"pokemonCount"`
	PokedexCount   int               `json:"pokedexCount"`
	Session        SessionTelemetry  `json:"session"`
	Pass           PassSnapshot      `json:"pass"`
	PvpAuto        bool              `json:"pvpAuto"`
	ServerOffsetMs int64             `json:"serverOffsetMs"`
	UpdatedAt      int64             `json:"updatedAt"`
}

type TelemetrySnapshot struct {
	ServerTimeMs int64              `json:"serverTimeMs"`
	BridgePort   int                `json:"bridgePort"`
	Memory       *sysmem.Stats      `json:"memory,omitempty"`
	Accounts     []AccountTelemetry `json:"accounts"`
}

type ProbeResult struct {
	OK     bool     `json:"ok"`
	Kind   string   `json:"kind"`
	Detail string   `json:"detail"`
	Nick   string   `json:"nick,omitempty"`
	Level  int      `json:"level,omitempty"`
	Hunts  []string `json:"hunts,omitempty"`
}

// --- Dynamic JSON helpers ---

func asMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}

func asSlice(v any) []any {
	if s, ok := v.([]any); ok {
		return s
	}
	return nil
}

func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func asBool(v any) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}

func asInt(v any) int {
	return int(asInt64(v))
}

func asInt64(v any) int64 {
	switch t := v.(type) {
	case float64:
		return int64(t)
	case int:
		return int64(t)
	case int64:
		return t
	case json.Number:
		i, _ := t.Int64()
		return i
	case string:
		i, err := strconv.ParseInt(strings.TrimSpace(t), 10, 64)
		if err == nil {
			return i
		}
		f, _ := strconv.ParseFloat(strings.TrimSpace(t), 64)
		return int64(f)
	}
	return 0
}

func asFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case json.Number:
		f, _ := t.Float64()
		return f
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(t), 64)
		return f
	}
	return 0
}

func mapIntValue(m map[string]any, id int) int {
	if m == nil {
		return 0
	}
	key := strconv.Itoa(id)
	if v, ok := m[key]; ok {
		return asInt(v)
	}
	return 0
}

func asIntSlice(v any) []int {
	raw := asSlice(v)
	if len(raw) == 0 {
		return nil
	}
	out := make([]int, 0, len(raw))
	for _, x := range raw {
		out = append(out, asInt(x))
	}
	return out
}

func lookOf(pk map[string]any) int {
	if pk == nil {
		return 0
	}
	if asBool(pk["shiny"]) {
		if ls := asInt(pk["lookShiny"]); ls > 0 {
			return ls
		}
	}
	return asInt(pk["looktype"])
}

func deepCloneMap(src map[string]any) map[string]any {
	if src == nil {
		return map[string]any{}
	}
	b, err := json.Marshal(src)
	if err != nil {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		return map[string]any{}
	}
	return out
}
