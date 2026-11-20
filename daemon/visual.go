package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const ticketLife = 30 * time.Second

var visualUpgrader = websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

type Visual struct {
	ttl     time.Duration
	mu      sync.Mutex
	on      bool
	until   time.Time
	timer   *time.Timer
	tickets map[string]time.Time
	conns   map[*websocket.Conn]struct{}
}

func newVisual(ttl time.Duration) *Visual {
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	return &Visual{ttl: ttl, tickets: map[string]time.Time{}, conns: map[*websocket.Conn]struct{}{}}
}
func randomTicket() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
func (v *Visual) Start() (string, time.Duration, error) {
	if err := visualPermission(); err != nil {
		return "", 0, err
	}
	ticket, err := randomTicket()
	if err != nil {
		return "", 0, err
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	now := time.Now()
	for key, expiry := range v.tickets {
		if !now.Before(expiry) {
			delete(v.tickets, key)
		}
	}
	v.on = true
	v.until = now.Add(v.ttl)
	if v.timer != nil {
		v.timer.Stop()
	}
	v.timer = time.AfterFunc(v.ttl, v.expire)
	v.tickets[ticket] = now.Add(ticketLife)
	return ticket, v.ttl, nil
}
func (v *Visual) Stop() { v.mu.Lock(); defer v.mu.Unlock(); v.stopLocked() }
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
	v.on = false
	if v.timer != nil {
		v.timer.Stop()
		v.timer = nil
	}
	for conn := range v.conns {
		_ = conn.Close()
	}
	v.conns = map[*websocket.Conn]struct{}{}
	v.tickets = map[string]time.Time{}
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

type visualInput struct {
	Type   string  `json:"type"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Down   bool    `json:"down"`
	DeltaY float64 `json:"deltaY"`
	Text   string  `json:"text"`
	Key    string  `json:"key"`
}

func (v *Visual) bridge(w http.ResponseWriter, r *http.Request) {
	if !v.redeem(r.URL.Query().Get("ticket")) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	ws, err := visualUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	v.mu.Lock()
	if !v.on {
		v.mu.Unlock()
		_ = ws.Close()
		return
	}
	v.conns[ws] = struct{}{}
	v.mu.Unlock()
	defer func() { v.mu.Lock(); delete(v.conns, ws); v.mu.Unlock(); _ = ws.Close() }()
	ws.SetReadLimit(4096)
	done := make(chan error, 1)
	go func() {
		pressed := false
		lastX, lastY := 0.0, 0.0
		defer func() {
			if pressed {
				visualPointer(lastX, lastY, 2)
			}
		}()
		for {
			var input visualInput
			if err := ws.ReadJSON(&input); err != nil {
				done <- err
				return
			}
			if (input.Type == "mouse" || input.Type == "move") && input.X >= 0 && input.X <= 1 && input.Y >= 0 && input.Y <= 1 {
				kind := 0
				switch input.Type {
				case "mouse":
					kind = 2
					if input.Down {
						kind = 1
					}
				case "move":
					if input.Down {
						kind = 3
					}
				}
				if !visualPointer(input.X, input.Y, kind) {
					done <- errors.New("Allow Accessibility access for termd in macOS System Settings to control the screen.")
					return
				}
				lastX, lastY = input.X, input.Y
				if input.Type == "mouse" {
					pressed = input.Down
				}
			}
			if input.Type == "scroll" {
				if input.DeltaY < -2400 {
					input.DeltaY = -2400
				} else if input.DeltaY > 2400 {
					input.DeltaY = 2400
				}
				if !visualScroll(input.DeltaY) {
					done <- errors.New("Allow Accessibility access for termd in macOS System Settings to control the screen.")
					return
				}
			}
			if input.Type == "key" && len(input.Text) <= 1024 && len(input.Key) <= 32 && !visualType(input.Text, input.Key) {
				done <- errors.New("Allow Accessibility access for termd in macOS System Settings to control the screen.")
				return
			}
		}
	}()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		frame, err := visualFrame()
		if err != nil {
			_ = ws.WriteJSON(map[string]string{"error": err.Error()})
			return
		}
		_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if err = ws.WriteMessage(websocket.BinaryMessage, frame); err != nil {
			return
		}
		select {
		case err = <-done:
			if err != nil && !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				_ = ws.WriteJSON(map[string]string{"error": err.Error()})
			}
			return
		case <-ticker.C:
		}
	}
}
