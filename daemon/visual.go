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
	timer   *time.Timer
	leases  map[string]time.Time
	tickets map[string]visualTicket
	conns   map[net.Conn]string
}

type visualTicket struct {
	lease   string
	expires time.Time
}

func newVisual(ttl time.Duration) *Visual {
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	return &Visual{
		ttl: ttl, leases: map[string]time.Time{}, tickets: map[string]visualTicket{}, conns: map[net.Conn]string{},
	}
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

func (v *Visual) Start(existingLease string) (ticket, lease string, ttl time.Duration, err error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	now := time.Now()
	v.expireLeasesLocked(now)
	ticket, err = randomTicket()
	if err != nil {
		return "", "", 0, err
	}
	lease = existingLease
	if expires, ok := v.leases[lease]; lease == "" || !ok || !now.Before(expires) {
		lease, err = randomTicket()
		if err != nil {
			return "", "", 0, err
		}
	}

	if !v.on {
		if listening() {
			v.owned = false
		} else {
			if err := screenSharing("load"); err != nil {
				slog.Error("enable Screen Sharing", "err", err)
				return "", "", 0, errors.New("Screen Sharing couldn't be turned on. Re-run install.sh")
			}
			for attempt := 0; attempt < 15 && !listening(); attempt++ {
				time.Sleep(200 * time.Millisecond)
			}
			if !listening() {
				_ = screenSharing("unload")
				return "", "", 0, errors.New("Screen Sharing didn't start listening")
			}
			v.owned = true
		}
		v.on = true
	}

	for currentTicket, grant := range v.tickets {
		if grant.lease == lease {
			delete(v.tickets, currentTicket)
		}
	}
	v.leases[lease] = now.Add(v.ttl)
	v.tickets[ticket] = visualTicket{lease: lease, expires: now.Add(ticketLife)}
	v.scheduleExpiryLocked()
	slog.Info("visual on", "leaseCount", len(v.leases), "owned", v.owned)
	return ticket, lease, v.ttl, nil
}

func (v *Visual) Stop(lease string) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	if _, ok := v.leases[lease]; !ok || lease == "" {
		return false
	}
	delete(v.leases, lease)
	v.closeLeaseLocked(lease)
	for ticket, grant := range v.tickets {
		if grant.lease == lease {
			delete(v.tickets, ticket)
		}
	}
	if len(v.leases) == 0 {
		v.stopLocked()
	} else {
		v.scheduleExpiryLocked()
	}
	return true
}

func (v *Visual) Shutdown() {
	if v != nil {
		v.mu.Lock()
		v.stopLocked()
		v.mu.Unlock()
	}
}

func (v *Visual) expire() {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.expireLeasesLocked(time.Now())
	v.scheduleExpiryLocked()
}

func (v *Visual) expireLeasesLocked(now time.Time) {
	for lease, expiry := range v.leases {
		if !now.Before(expiry) {
			delete(v.leases, lease)
			v.closeLeaseLocked(lease)
			for ticket, grant := range v.tickets {
				if grant.lease == lease {
					delete(v.tickets, ticket)
				}
			}
		}
	}
	for ticket, grant := range v.tickets {
		if !now.Before(grant.expires) {
			delete(v.tickets, ticket)
		}
	}
	if v.on && len(v.leases) == 0 {
		v.stopLocked()
	}
}

func (v *Visual) scheduleExpiryLocked() {
	if v.timer != nil {
		v.timer.Stop()
		v.timer = nil
	}
	if !v.on || len(v.leases) == 0 {
		return
	}
	var earliest time.Time
	for _, expiry := range v.leases {
		if earliest.IsZero() || expiry.Before(earliest) {
			earliest = expiry
		}
	}
	delay := time.Until(earliest)
	if delay < 0 {
		delay = 0
	}
	v.timer = time.AfterFunc(delay, v.expire)
}

func (v *Visual) closeLeaseLocked(lease string) {
	for conn, owner := range v.conns {
		if owner == lease {
			_ = conn.Close()
			delete(v.conns, conn)
		}
	}
}

func (v *Visual) stopLocked() {
	if !v.on && len(v.leases) == 0 {
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
	v.conns = map[net.Conn]string{}
	v.tickets = map[string]visualTicket{}
	v.leases = map[string]time.Time{}
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
	if !v.on || len(v.leases) == 0 {
		return false, 0
	}
	var latest time.Time
	for _, expiry := range v.leases {
		if expiry.After(latest) {
			latest = expiry
		}
	}
	remaining := time.Until(latest)
	if remaining < 0 {
		remaining = 0
	}
	return true, remaining
}

func (v *Visual) redeem(ticket string) (string, bool) {
	v.mu.Lock()
	defer v.mu.Unlock()
	grant, ok := v.tickets[ticket]
	delete(v.tickets, ticket)
	leaseExpiry, leaseOK := v.leases[grant.lease]
	valid := ok && leaseOK && v.on && time.Now().Before(grant.expires) && time.Now().Before(leaseExpiry)
	return grant.lease, valid
}

func (v *Visual) track(conn net.Conn, lease string) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	if !v.on {
		return false
	}
	if expiry, ok := v.leases[lease]; !ok || !time.Now().Before(expiry) {
		return false
	}
	v.conns[conn] = lease
	return true
}

func (v *Visual) untrack(conn net.Conn) {
	v.mu.Lock()
	delete(v.conns, conn)
	v.mu.Unlock()
}

func (v *Visual) bridge(w http.ResponseWriter, r *http.Request) {
	lease, valid := v.redeem(r.URL.Query().Get("ticket"))
	if !valid {
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
	if !v.track(tcp, lease) {
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
