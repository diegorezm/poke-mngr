package pokeidle

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
	_ "time/tzdata"

	"poke-mngr/internal/store"
)

const dailyPeriodSettingKey = "daily_current_period"

var defaultBrazilTZ = time.FixedZone("America/Sao_Paulo", -3*3600)

// LoadReportLocation resolves an IANA timezone name (embedded via time/tzdata) with UTC-3 fallback.
func LoadReportLocation(tzName string) *time.Location {
	name := strings.TrimSpace(tzName)
	if name == "" {
		name = "America/Sao_Paulo"
	}
	if loc, err := time.LoadLocation(name); err == nil {
		return loc
	}
	return defaultBrazilTZ
}

// CurrentDailyPeriod computes the logical reporting date (YYYY-MM-DD) shifted by reportHour in tzName.
func CurrentDailyPeriod(now time.Time, reportHour int, tzName string) string {
	h := ((reportHour % 24) + 24) % 24
	loc := LoadReportLocation(tzName)
	return now.In(loc).Add(-time.Duration(h) * time.Hour).Format("2006-01-02")
}

func formatBRDate(period string) string {
	parts := strings.Split(period, "-")
	if len(parts) == 3 {
		return fmt.Sprintf("%s/%s/%s", parts[2], parts[1], parts[0])
	}
	return period
}

func formatIntPT(n int64) string {
	neg := n < 0
	if neg {
		n = -n
	}
	s := fmt.Sprintf("%d", n)
	if len(s) <= 3 {
		if neg {
			return "-" + s
		}
		return s
	}
	var b strings.Builder
	if neg {
		b.WriteByte('-')
	}
	rem := len(s) % 3
	if rem > 0 {
		b.WriteString(s[:rem])
		if len(s) > rem {
			b.WriteByte('.')
		}
	}
	for i := rem; i < len(s); i += 3 {
		if i > rem {
			b.WriteByte('.')
		}
		b.WriteString(s[i : i+3])
	}
	return b.String()
}

func formatDurationPT(d time.Duration) string {
	s := int(d.Seconds())
	if s < 0 {
		s = 0
	}
	h := s / 3600
	m := (s % 3600) / 60
	sec := s % 60
	if h > 0 {
		return fmt.Sprintf("%dh%02dmin", h, m)
	}
	if m > 0 {
		return fmt.Sprintf("%dmin%02ds", m, sec)
	}
	return fmt.Sprintf("%ds", sec)
}

var rareReportOrder = []string{"boss", "key", "shinyStone", "bike"}

func formatRareItemsSummary(items map[string]int) string {
	var parts []string
	seen := map[string]bool{}
	for _, k := range rareReportOrder {
		if v := items[k]; v > 0 {
			label := RareLabels[k]
			if label == "" {
				label = k
			}
			parts = append(parts, fmt.Sprintf("%s ×%d", label, v))
			seen[k] = true
		}
	}
	var extraKeys []string
	for k, v := range items {
		if v > 0 && !seen[k] {
			extraKeys = append(extraKeys, k)
		}
	}
	sort.Strings(extraKeys)
	for _, k := range extraKeys {
		label := RareLabels[k]
		if label == "" {
			label = k
		}
		parts = append(parts, fmt.Sprintf("%s ×%d", label, items[k]))
	}
	if len(parts) == 0 {
		return "nenhum"
	}
	return strings.Join(parts, ", ")
}

func hasDailyActivity(rows []store.DailyAccountStats) bool {
	for _, r := range rows {
		if r.Kills > 0 {
			return true
		}
		for _, v := range r.Items {
			if v > 0 {
				return true
			}
		}
	}
	return false
}

// BuildDailyReportEmbed formats a period's SQLite daily_state rows into a Discord embed.
func BuildDailyReportEmbed(period string, rows []store.DailyAccountStats) DiscordEmbed {
	sorted := make([]store.DailyAccountStats, len(rows))
	copy(sorted, rows)
	sort.Slice(sorted, func(i, j int) bool {
		return strings.ToLower(sorted[i].Nick) < strings.ToLower(sorted[j].Nick)
	})

	var fields []DiscordEmbedField
	var totXP, totGold, totKills int64
	totItems := map[string]int{}

	for _, r := range sorted {
		totXP += r.XP
		totGold += r.Gold
		totKills += r.Kills
		for k, v := range r.Items {
			totItems[k] += v
		}
		fields = append(fields, DiscordEmbedField{
			Name: r.Nick,
			Value: fmt.Sprintf(
				"⭐ XP: **%s**\n💰 Ouro: **%s**\n⚔️ Kills: %s\n💎 Raros: %s",
				formatIntPT(r.XP),
				formatIntPT(r.Gold),
				formatIntPT(r.Kills),
				formatRareItemsSummary(r.Items),
			),
			Inline: true,
		})
	}

	if len(sorted) > 1 {
		fields = append(fields, DiscordEmbedField{
			Name: "Total",
			Value: fmt.Sprintf(
				"⭐ XP: **%s**\n💰 Ouro: **%s**\n⚔️ Kills: %s\n💎 Raros: %s",
				formatIntPT(totXP),
				formatIntPT(totGold),
				formatIntPT(totKills),
				formatRareItemsSummary(totItems),
			),
			Inline: false,
		})
	}

	desc := "Resumo do dia por conta."
	if len(fields) == 0 {
		desc = "Sem atividade no período."
	}

	return DiscordEmbed{
		Title:       fmt.Sprintf("📊 Relatório diário — %s", formatBRDate(period)),
		Description: desc,
		Color:       ColorBlue,
		Fields:      fields,
	}
}

// CheckDailyRollover checks if the current logical reporting period changed since the last persisted period.
// If it rolled over and the previous period had recorded activity, it queues the Discord daily report.
func (m *AccountManager) CheckDailyRollover(now time.Time) bool {
	gs := m.Settings()
	nowPeriod := CurrentDailyPeriod(now, gs.DailyReportHour, gs.ReportTZ)

	lastPeriod, ok := m.store.GetSetting(dailyPeriodSettingKey)
	if !ok || strings.TrimSpace(lastPeriod) == "" {
		_ = m.store.SetSetting(dailyPeriodSettingKey, nowPeriod)
		return false
	}
	if lastPeriod == nowPeriod {
		return false
	}

	rows, err := m.store.LoadDailyPeriod(lastPeriod)
	if err == nil && hasDailyActivity(rows) {
		m.notifier.Send(BuildDailyReportEmbed(lastPeriod, rows))
	}
	_ = m.store.SetSetting(dailyPeriodSettingKey, nowPeriod)
	return true
}

// SendDailyReportNow sends the current logical day's report synchronously to the configured Discord webhook.
func (m *AccountManager) SendDailyReportNow(ctx context.Context, webhookOverride string) error {
	gs := m.Settings()
	period := CurrentDailyPeriod(time.Now(), gs.DailyReportHour, gs.ReportTZ)
	rows, err := m.store.LoadDailyPeriod(period)
	if err != nil {
		return err
	}
	embed := BuildDailyReportEmbed(period, rows)
	return m.notifier.SendSync(ctx, webhookOverride, embed)
}

func (m *AccountManager) dailyReportLoop(ctx context.Context) {
	// Check immediately on startup in case the app was closed during the day rollover.
	m.CheckDailyRollover(time.Now())

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.CheckDailyRollover(time.Now())
		}
	}
}
