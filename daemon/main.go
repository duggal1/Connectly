package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

type Config struct {
	Listen        string
	TokenFile     string
	Shell         string
	Cert, Key     string
	IdleTTL       time.Duration
	MaxSessions   int
	NoWake        bool
	Lid           bool
	LidMinBattery int
	Actions       string
	AgentSocket   string
	NoVisual      bool
	VisualTTL     time.Duration
}

func configDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "connectly-termd")
	}
	return filepath.Join(home, ".config", "connectly-termd")
}

func defaultTokenPath() string {
	home, err := os.UserHomeDir()
	if err == nil {
		legacy := filepath.Join(home, ".config", "lumen-termd", "token")
		if _, statErr := os.Stat(legacy); statErr == nil {
			return legacy
		}
	}
	return filepath.Join(configDir(), "token")
}

func loadToken(path string) (string, error) {
	if v := strings.TrimSpace(os.Getenv("LUMEN_TOKEN")); v != "" {
		return v, nil
	}
	if v := strings.TrimSpace(os.Getenv("CONNECTLY_TOKEN")); v != "" {
		return v, nil
	}
	if path == "" {
		path = defaultTokenPath()
	}
	if b, err := os.ReadFile(path); err == nil {
		if v := strings.TrimSpace(string(b)); v != "" {
			return v, nil
		}
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	v := hex.EncodeToString(raw)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	if err := os.WriteFile(path, []byte(v+"\n"), 0o600); err != nil {
		return "", err
	}
	return v, nil
}

func isTailscaleIP(host string) bool {
	requestedIP := net.ParseIP(host)
	if requestedIP == nil {
		return false
	}
	output, err := exec.Command("tailscale", "ip", "-4").Output()
	if err != nil {
		return false
	}
	return requestedIP.Equal(net.ParseIP(strings.TrimSpace(string(output))))
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "mcp" {
		os.Exit(runMCP(os.Args[2:]))
	}

	var cfg Config
	printToken := flag.Bool("print-token", false, "print the auth token and exit")
	flag.StringVar(&cfg.Listen, "listen", "127.0.0.1:7681", "address to listen on")
	flag.StringVar(&cfg.TokenFile, "token-file", "", "token file (default existing ~/.config/lumen-termd/token or ~/.config/connectly-termd/token)")
	flag.StringVar(&cfg.Shell, "shell", "", "login shell (default $SHELL, else /bin/zsh)")
	flag.StringVar(&cfg.Cert, "cert", "", "TLS certificate file")
	flag.StringVar(&cfg.Key, "key", "", "TLS key file")
	flag.DurationVar(&cfg.IdleTTL, "idle-ttl", 24*time.Hour, "kill detached sessions after this long")
	flag.IntVar(&cfg.MaxSessions, "max-sessions", 16, "maximum concurrent sessions")
	flag.BoolVar(&cfg.NoWake, "no-wake", false, "never hold a wake assertion")
	flag.BoolVar(&cfg.Lid, "lid-hold", true, "stay awake with the lid closed (needs the sudoers rule from install.sh)")
	flag.IntVar(&cfg.LidMinBattery, "lid-min-battery", 15, "release the lid hold below this battery percent when unplugged")
	flag.StringVar(&cfg.Actions, "actions", "", "actions file (default ~/.config/connectly-termd/actions.json)")
	flag.StringVar(&cfg.AgentSocket, "agent-socket", filepath.Join(configDir(), "agent.sock"), "Unix socket for local agents; empty disables it")
	flag.BoolVar(&cfg.NoVisual, "no-visual", false, "disable on-demand Screen Sharing")
	flag.DurationVar(&cfg.VisualTTL, "visual-ttl", 5*time.Minute, "auto-stop Screen Sharing after this long")
	flag.Parse()

	token, err := loadToken(cfg.TokenFile)
	if err != nil {
		fmt.Fprintln(os.Stderr, "token:", err)
		os.Exit(1)
	}
	if *printToken {
		fmt.Println(token)
		return
	}
	if cfg.Shell == "" {
		cfg.Shell = os.Getenv("SHELL")
		if cfg.Shell == "" {
			cfg.Shell = "/bin/zsh"
		}
	}

	host, _, _ := net.SplitHostPort(cfg.Listen)
	ip := net.ParseIP(host)
	isLoopback := (ip != nil && ip.IsLoopback()) || strings.EqualFold(host, "localhost")
	if cfg.Cert == "" && !isLoopback && !isTailscaleIP(host) {
		slog.Warn("listening off loopback without TLS. Use Tailscale or --cert/--key.", "listen", cfg.Listen)
	}

	actions, err := loadActions(cfg.Actions, cfg.Shell)
	if err != nil {
		slog.Error("actions config invalid; nothing is enabled until it is fixed", "err", err)
	}
	var visual *Visual
	if !cfg.NoVisual {
		visual = newVisual(cfg.VisualTTL)
	}
	stats := &StatsSource{}
	wake := newWake(!cfg.NoWake, cfg.Lid, cfg.LidMinBattery, stats)
	mgr := newManager(cfg.Shell, cfg.MaxSessions, wake)
	srv := newServer(cfg, token, mgr, stats, actions, visual)
	hs := &http.Server{Addr: cfg.Listen, Handler: srv.routes(), ReadHeaderTimeout: 10 * time.Second}
	listener, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		slog.Error("server listen failed", "listen", cfg.Listen, "err", err)
		os.Exit(1)
	}
	wake.Init()

	errc := make(chan error, 1)
	go func() {
		var err error
		if cfg.Cert != "" && cfg.Key != "" {
			err = hs.ServeTLS(listener, cfg.Cert, cfg.Key)
		} else {
			err = hs.Serve(listener)
		}
		errc <- err
	}()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if cfg.AgentSocket != "" {
		go func() {
			if err := serveAgent(ctx, cfg.AgentSocket, srv.localRoutes()); err != nil {
				slog.Error("agent socket failed", "path", cfg.AgentSocket, "err", err)
			}
		}()
	}
	go mgr.reapLoop(ctx, cfg.IdleTTL)
	go wake.loop(ctx)
	slog.Info("termd listening", "listen", cfg.Listen, "shell", cfg.Shell, "tls", cfg.Cert != "", "lidHold", cfg.Lid,
		"actions", len(actions.order), "visual", visual != nil, "agentSocket", cfg.AgentSocket)

	select {
	case err := <-errc:
		slog.Error("server stopped unexpectedly", "listen", cfg.Listen, "err", err)
		mgr.killAll()
		visual.Shutdown()
		wake.Shutdown()
		os.Exit(1)
	case <-ctx.Done():
	}

	slog.Info("shutting down")
	mgr.killAll()
	sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = hs.Shutdown(sctx)
	visual.Shutdown()
	wake.Shutdown()
}
