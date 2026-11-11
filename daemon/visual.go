package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	vncAddr    = "127.0.0.1:5900"
	ssPlist    = "/System/Library/LaunchDaemons/com.apple.screensharing.plist"
	ticketLife = 30 * time.Second
)

var vncUp = websocket.Upgrader{
	ReadBufferSize:  32 << 10,
	WriteBufferSize: 32 << 10,
	Subprotocols:    []string{"binary"},
	CheckOrigin:     func(*http.Request) bool { return true },
}

type Visual struct {
	ttl time.Duration

	mu      sync.Mutex
	on      bool
	owned   bool
	until   time.Time
	timer   *time.Timer
	tickets map[string]time.Time
	conns   map[net.Conn]struct{}
}

func newVisual(ttl time.Duration) *Visual {
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	return &Visual{ttl: ttl, tickets: map[string]time.Time{}, conns: map[net.Conn]struct{}{}}
}

func listening() bool {
	conn, err := net.DialTimeout("tcp", vncAddr, 300*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func screenSharing(verb string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "/usr/bin/sudo", "-n", "/bin/launchctl", verb, "-w", ssPlist).CombinedOutput()
	if err != nil {
		return fmt.Errorf("launchctl %s: %v: %s", verb, err, strings.TrimSpace(string(output)))
	}
	return nil
}

func randomTicket() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func (v *Visual) Start() (string, time.Duration, error) {
	v.mu.Lock()
	defer v.mu.Unlock()

	if !v.on {
		if listening() {
			v.owned = false
		} else {
			if err := screenSharing("load"); err != nil {
				slog.Error("enable Screen Sharing", "err", err)
				return "", 0, errors.New("Screen Sharing couldn't be turned on. Re-run install.sh")
			}
			for attempt := 0; attempt < 15 && !listening(); attempt++ {
				time.Sleep(200 * time.Millisecond)
			}
			if !listening() {
				_ = screenSharing("unload")
				return "", 0, errors.New("Screen Sharing didn't start listening")
			}
			v.owned = true
		}
		v.on = true
	}

	v.until = time.Now().Add(v.ttl)
	if v.timer != nil {
		v.timer.Stop()
	}
	v.timer = time.AfterFunc(v.ttl, v.expire)
	now := time.Now()
	for ticket, expiry := range v.tickets {
		if !now.Before(expiry) {
			delete(v.tickets, ticket)
		}
	}
	ticket, err := randomTicket()
	if err != nil {
		return "", 0, err
	}
	v.tickets[ticket] = now.Add(ticketLife)
	slog.Info("visual on", "until", v.until.Format(time.RFC3339), "owned", v.owned)
	return ticket, v.ttl, nil
}

func (v *Visual) Stop() {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.stopLocked()
}

func (v *Visual) Shutdown() {
	if v != nil {
		v.Stop()
	}
}

func (v *Visual) expire() {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.on && !time.Now().Before(v.until) {
		v.stopLocked()
	}
}

func (v *Visual) stopLocked() {
	if !v.on {
		return
	}
	v.on = false
	if v.timer != nil {
		v.timer.Stop()
		v.timer = nil
	}
	for conn := range v.conns {
		_ = conn.Close()
	}
	v.conns = map[net.Conn]struct{}{}
	v.tickets = map[string]time.Time{}
	if v.owned {
		if err := screenSharing("unload"); err != nil {
			slog.Warn("Screen Sharing may still be on; run sudo launchctl unload -w "+ssPlist, "err", err)
		}
	}
	v.owned = false
	slog.Info("visual off")
}

func (v *Visual) Status() (bool, time.Duration) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if !v.on {
		return false, 0
	}
	return true, time.Until(v.until)
}

func (v *Visual) redeem(ticket string) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	expires, ok := v.tickets[ticket]
	delete(v.tickets, ticket)
	return ok && v.on && time.Now().Before(expires)
}

func (v *Visual) track(conn net.Conn) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	if !v.on {
		return false
	}
	v.conns[conn] = struct{}{}
	return true
}

func (v *Visual) untrack(conn net.Conn) {
	v.mu.Lock()
	delete(v.conns, conn)
	v.mu.Unlock()
}

func (v *Visual) bridge(w http.ResponseWriter, r *http.Request) {
	if !v.redeem(r.URL.Query().Get("ticket")) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	ws, err := vncUp.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	tcp, err := net.DialTimeout("tcp", vncAddr, 2*time.Second)
	if err != nil {
		_ = ws.Close()
		return
	}
	if !v.track(tcp) {
		_ = tcp.Close()
		_ = ws.Close()
		return
	}
	defer v.untrack(tcp)
	ws.SetReadLimit(16 << 20)

	done := make(chan struct{}, 2)
	go func() {
		buffer := make([]byte, 32<<10)
		for {
			n, readErr := tcp.Read(buffer)
			if n > 0 {
				_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if ws.WriteMessage(websocket.BinaryMessage, buffer[:n]) != nil {
					break
				}
			}
			if readErr != nil {
				break
			}
		}
		done <- struct{}{}
	}()
	go func() {
		for {
			_, message, readErr := ws.ReadMessage()
			if readErr != nil {
				break
			}
			if _, writeErr := tcp.Write(message); writeErr != nil {
				break
			}
		}
		done <- struct{}{}
	}()
	<-done
	_ = tcp.Close()
	_ = ws.Close()
}
