package pokeidle

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	ColorGreen = 0x22c55e
	ColorRed   = 0xef4444
	ColorGold  = 0xf59e0b
	ColorBlue  = 0x3b82f6
)

type DiscordEmbed struct {
	Title       string              `json:"title,omitempty"`
	Description string              `json:"description,omitempty"`
	Color       int                 `json:"color,omitempty"`
	Fields      []DiscordEmbedField `json:"fields,omitempty"`
	Timestamp   string              `json:"timestamp,omitempty"`
}

type DiscordEmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

type Notifier struct {
	mu      sync.RWMutex
	webhook string
	queue   chan DiscordEmbed
	client  *http.Client
}

func NewNotifier(webhook string) *Notifier {
	n := &Notifier{
		webhook: strings.TrimSpace(webhook),
		queue:   make(chan DiscordEmbed, 200),
		client:  &http.Client{Timeout: 15 * time.Second},
	}
	return n
}

func (n *Notifier) SetWebhook(url string) {
	n.mu.Lock()
	n.webhook = strings.TrimSpace(url)
	n.mu.Unlock()
}

func (n *Notifier) Webhook() string {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return n.webhook
}

func (n *Notifier) Send(embed DiscordEmbed) {
	if n.Webhook() == "" {
		return
	}
	if embed.Timestamp == "" {
		embed.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	select {
	case n.queue <- embed:
	default:
	}
}

func (n *Notifier) SendSync(ctx context.Context, webhookURL string, embed DiscordEmbed) error {
	url := strings.TrimSpace(webhookURL)
	if url == "" {
		url = n.Webhook()
	}
	if url == "" {
		return fmt.Errorf("webhook do Discord não configurado")
	}
	if embed.Timestamp == "" {
		embed.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	body, err := json.Marshal(map[string]any{"embeds": []DiscordEmbed{embed}})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("discord retornou HTTP %d", resp.StatusCode)
	}
	return nil
}

func (n *Notifier) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case embed := <-n.queue:
			url := n.Webhook()
			if url == "" {
				continue
			}
			_ = n.deliverWithRetry(ctx, url, embed)
			select {
			case <-ctx.Done():
				return
			case <-time.After(500 * time.Millisecond):
			}
		}
	}
}

func (n *Notifier) deliverWithRetry(ctx context.Context, url string, embed DiscordEmbed) error {
	body, _ := json.Marshal(map[string]any{"embeds": []DiscordEmbed{embed}})
	for attempt := 0; attempt < 3; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := n.client.Do(req)
		if err != nil {
			return err
		}
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(2 * time.Second):
			}
			continue
		}
		return nil
	}
	return nil
}
