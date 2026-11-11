package main

import (
	"crypto/subtle"
	"encoding/binary"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Client struct {
	conn *websocket.Conn
	send chan []byte
	done chan struct{}
	once sync.Once
}

func newClient(conn *websocket.Conn) *Client {
	return &Client{conn: conn, send: make(chan []byte, 1024), done: make(chan struct{})}
}

// enqueue never blocks. If the client can't keep up it is dropped;
// it reconnects and the ring buffer replays what it missed.
func (c *Client) enqueue(b []byte) {
	select {
	case <-c.done:
		return
	default:
	}
	select {
	case c.send <- b:
	default:
		c.close()
	}
}

func (c *Client) close() {
	c.once.Do(func() {
		close(c.done)
		_ = c.conn.Close()
	})
}

func (c *Client) writer() {
	for {
		select {
		case b := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.BinaryMessage, b); err != nil {
				c.close()
				return
			}
		case <-c.done:
			return
		}
	}
}

// ---------------------------------------------------------------------

type Server struct {
	cfg   Config
	token []byte
	mgr   *Manager
	stats *StatsSource
	act   *Actions
	vis   *Visual
	lim   *limiter
	up    websocket.Upgrader
}

func newServer(cfg Config, token string, mgr *Manager, stats *StatsSource, actions *Actions, visual *Visual) *Server {
	return &Server{
		cfg: cfg, token: []byte(token), mgr: mgr, stats: stats, act: actions, vis: visual, lim: newLimiter(),
		// Native clients send no Origin. Token auth is the gate, not origin.
		up: websocket.Upgrader{ReadBufferSize: 64 << 10, WriteBufferSize: 64 << 10, CheckOrigin: func(*http.Request) bool { return true }},
	}
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		slog.Info("health check", "request_id", r.Header.Get("X-Request-ID"), "remote_ip", clientIP(r))
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("GET /ws", s.handleWS)
	mux.HandleFunc("GET /api/sessions", s.auth(s.listSessions))
	mux.HandleFunc("GET /api/stats", s.auth(s.getStats))
	mux.HandleFunc("DELETE /api/sessions/{id}", s.auth(s.deleteSession))
	s.mountActions(mux, s.auth, true)
	s.mountVisual(mux)
	return mux
}

func clientIP(r *http.Request) string {
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

func (s *Server) checkToken(t string) bool {
	return subtle.ConstantTimeCompare([]byte(t), s.token) == 1
}

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		requestID := r.Header.Get("X-Request-ID")
		slog.Info("http request received", "request_id", requestID, "method", r.Method, "path", r.URL.Path, "remote_ip", ip)
		if s.lim.blocked(ip) {
			slog.Warn("http request rejected", "request_id", requestID, "remote_ip", ip, "path", r.URL.Path, "reason", "rate_limited")
			http.Error(w, "locked", http.StatusTooManyRequests)
			return
		}
		h := r.Header.Get("Authorization")
		tok := strings.TrimPrefix(h, "Bearer ")
		if h == tok || !s.checkToken(tok) {
			s.lim.fail(ip)
			slog.Warn("http auth failed", "request_id", requestID, "remote_ip", ip, "path", r.URL.Path)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		s.lim.ok(ip)
		slog.Info("http auth accepted", "request_id", requestID, "remote_ip", ip, "path", r.URL.Path)
		next(w, r)
	}
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	sessions := s.mgr.list()
	slog.Info("sessions listed", "request_id", r.Header.Get("X-Request-ID"), "remote_ip", clientIP(r), "count", len(sessions))
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(sessions)
}

func (s *Server) getStats(w http.ResponseWriter, r *http.Request) {
	slog.Info("Mac stats requested", "request_id", r.Header.Get("X-Request-ID"), "remote_ip", clientIP(r))
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s.stats.Get())
}

func (s *Server) deleteSession(w http.ResponseWriter, r *http.Request) {
	sess := s.mgr.get(r.PathValue("id"))
	if sess == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	slog.Info("session killed via api", "ip", clientIP(r), "session", sess.ID)
	sess.kill()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) pushStats(c *Client) {
	send := func() {
		st := s.stats.Get()
		st.Op = "stats"
		if j, err := json.Marshal(st); err == nil {
			c.enqueue(encode(TControl, j))
		}
	}
	send()
	t := time.NewTicker(10 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-t.C:
			send()
		}
	}
}

// ---------------------------------------------------------------------

type hello struct {
	Op      string `json:"op"`
	V       int    `json:"v"`
	Token   string `json:"token"`
	Session string `json:"session"`
	Cols    uint16 `json:"cols"`
	Rows    uint16 `json:"rows"`
	Offset  uint64 `json:"offset"`
}

func reject(conn *websocket.Conn, msg string) {
	_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
	_ = conn.WriteMessage(websocket.BinaryMessage, controlFrame(map[string]any{"op": "error", "message": msg, "fatal": true}))
	_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, msg))
	_ = conn.Close()
}

func gone(conn *websocket.Conn) {
	_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
	_ = conn.WriteMessage(websocket.BinaryMessage, controlFrame(map[string]any{"op": "gone"}))
	_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "gone"))
	_ = conn.Close()
}

func clampSize(c, r uint16) (uint16, uint16) {
	if c == 0 {
		c = 80
	}
	if r == 0 {
		r = 24
	}
	if c > 500 {
		c = 500
	}
	if r > 300 {
		r = 300
	}
	return c, r
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	traceID := r.URL.Query().Get("trace_id")
	slog.Info("websocket request received", "trace_id", traceID, "remote_ip", ip)
	conn, err := s.up.Upgrade(w, r, nil)
	if err != nil {
		slog.Warn("websocket upgrade failed", "trace_id", traceID, "remote_ip", ip, "err", err)
		return
	}
	conn.SetReadLimit(maxPayload + 5)

	if s.lim.blocked(ip) {
		slog.Warn("websocket request rejected", "trace_id", traceID, "remote_ip", ip, "reason", "rate_limited")
		reject(conn, "Too many attempts. Try again in 5 minutes.")
		return
	}

	// The first frame must be a hello with the token, within 5 seconds.
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		slog.Warn("websocket hello read failed", "trace_id", traceID, "remote_ip", ip, "err", err)
		_ = conn.Close()
		return
	}
	t, p, err := decode(msg)
	var h hello
	if err != nil || t != TControl || json.Unmarshal(p, &h) != nil || h.Op != "hello" {
		slog.Warn("websocket handshake rejected", "trace_id", traceID, "remote_ip", ip, "reason", "bad_handshake")
		reject(conn, "Bad handshake.")
		return
	}
	if !s.checkToken(h.Token) {
		s.lim.fail(ip)
		slog.Warn("websocket auth failed", "trace_id", traceID, "remote_ip", ip)
		reject(conn, "Wrong token.")
		return
	}
	s.lim.ok(ip)

	cols, rows := clampSize(h.Cols, h.Rows)
	var sess *Session
	resumed := false
	if h.Session != "" {
		sess = s.mgr.get(h.Session)
		if sess == nil {
			slog.Info("websocket session is gone", "trace_id", traceID, "remote_ip", ip, "session", h.Session)
			gone(conn)
			return
		}
		resumed = true
	} else {
		sess, err = s.mgr.create(cols, rows)
		if err != nil {
			slog.Error("create session failed", "trace_id", traceID, "remote_ip", ip, "err", err)
			reject(conn, "Couldn't start a shell.")
			return
		}
	}

	c := newClient(conn)
	go c.writer()
	if resumed {
		sess.resize(cols, rows)
	}
	reset := sess.attach(c, resumed, h.Offset)
	if resumed && reset {
		go sess.redraw()
	}
	go s.pushStats(c)
	slog.Info("websocket attached", "trace_id", traceID, "remote_ip", ip, "session", sess.ID, "resumed", resumed, "reset", reset, "offset", h.Offset)

	for {
		_ = conn.SetReadDeadline(time.Now().Add(25 * time.Second))
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		t, p, err := decode(msg)
		if err != nil {
			break
		}
		switch t {
		case TStdin:
			sess.write(p)
		case TResize:
			if len(p) == 4 {
				sess.resize(binary.BigEndian.Uint16(p[0:2]), binary.BigEndian.Uint16(p[2:4]))
			}
		case THeartbeat:
			c.enqueue(encode(THeartbeat, p))
		case TControl:
			var m struct {
				Op string `json:"op"`
			}
			if json.Unmarshal(p, &m) == nil && m.Op == "kill" {
				sess.kill()
			}
		}
	}
	sess.detach(c)
	c.close()
	slog.Info("websocket detached", "trace_id", traceID, "remote_ip", ip, "session", sess.ID, "read_error", err)
}
