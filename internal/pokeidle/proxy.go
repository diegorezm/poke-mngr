package pokeidle

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	xproxy "golang.org/x/net/proxy"

	"poke-mngr/internal/config"
)

// BuildHTTPClient returns an *http.Client routed exclusively through proxyCfg if active.
// If proxyCfg is configured, there is NO fallback to direct IP.
func BuildHTTPClient(proxyCfg *config.ProxyConfig, timeout time.Duration) (*http.Client, error) {
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	tr := &http.Transport{
		TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
		ForceAttemptHTTP2:     false,
		ResponseHeaderTimeout: timeout,
	}

	if proxyCfg != nil && proxyCfg.Active() {
		dialer, err := buildProxyDialContext(proxyCfg)
		if err != nil {
			return nil, err
		}
		tr.DialContext = dialer
		tr.Proxy = nil
	} else {
		d := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
		tr.DialContext = d.DialContext
	}

	return &http.Client{
		Transport: tr,
		Timeout:   timeout,
	}, nil
}

func buildProxyDialContext(p *config.ProxyConfig) (func(ctx context.Context, network, addr string) (net.Conn, error), error) {
	scheme := strings.ToLower(strings.TrimSpace(p.Scheme))
	if scheme == "" {
		scheme = "socks5"
	}
	if !config.ValidProxySchemes[scheme] {
		return nil, fmt.Errorf("esquema de proxy inválido: %s", scheme)
	}
	proxyAddr := fmt.Sprintf("%s:%d", strings.TrimSpace(p.Host), p.Port)

	switch scheme {
	case "socks5", "socks5h":
		var auth *xproxy.Auth
		if p.Username != "" {
			auth = &xproxy.Auth{User: p.Username, Password: p.Password}
		}
		base := &net.Dialer{Timeout: 20 * time.Second, KeepAlive: 30 * time.Second}
		d, err := xproxy.SOCKS5("tcp", proxyAddr, auth, base)
		if err != nil {
			return nil, fmt.Errorf("socks5 proxy init: %w", err)
		}
		return func(ctx context.Context, network, addr string) (net.Conn, error) {
			if cd, ok := d.(xproxy.ContextDialer); ok {
				return cd.DialContext(ctx, network, addr)
			}
			return d.Dial(network, addr)
		}, nil

	case "http", "https":
		return func(ctx context.Context, network, addr string) (net.Conn, error) {
			return dialHTTPConnect(ctx, scheme == "https", proxyAddr, p.Username, p.Password, addr)
		}, nil

	default:
		// socks4 via URL dialer fallback
		u, err := url.Parse(p.URL())
		if err != nil {
			return nil, err
		}
		d, err := xproxy.FromURL(u, &net.Dialer{Timeout: 20 * time.Second})
		if err != nil {
			return nil, err
		}
		return func(ctx context.Context, network, addr string) (net.Conn, error) {
			if cd, ok := d.(xproxy.ContextDialer); ok {
				return cd.DialContext(ctx, network, addr)
			}
			return d.Dial(network, addr)
		}, nil
	}
}

func dialHTTPConnect(ctx context.Context, useTLS bool, proxyAddr, user, pass, targetAddr string) (net.Conn, error) {
	d := &net.Dialer{Timeout: 20 * time.Second, KeepAlive: 30 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", proxyAddr)
	if err != nil {
		return nil, fmt.Errorf("proxy connect: %w", err)
	}
	if useTLS {
		host, _, _ := net.SplitHostPort(proxyAddr)
		tlsConn := tls.Client(conn, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("proxy tls: %w", err)
		}
		conn = tlsConn
	}

	req := &http.Request{
		Method: http.MethodConnect,
		URL:    &url.URL{Opaque: targetAddr},
		Host:   targetAddr,
		Header: make(http.Header),
	}
	req.Header.Set("Proxy-Connection", "Keep-Alive")
	if user != "" {
		cred := base64.StdEncoding.EncodeToString([]byte(user + ":" + pass))
		req.Header.Set("Proxy-Authorization", "Basic "+cred)
	}
	if err := req.Write(conn); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("proxy write CONNECT: %w", err)
	}

	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, req)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("proxy read CONNECT: %w", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_ = conn.Close()
		return nil, fmt.Errorf("proxy CONNECT recusado: HTTP %d", resp.StatusCode)
	}
	return conn, nil
}

// ProbeExitIP returns the real outbound IP (through proxy if provided, else direct).
func ProbeExitIP(ctx context.Context, proxyCfg *config.ProxyConfig) (string, error) {
	client, err := BuildHTTPClient(proxyCfg, 15*time.Second)
	if err != nil {
		return "", err
	}
	defer client.CloseIdleConnections()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.ipify.org", nil)
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 128))
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}
