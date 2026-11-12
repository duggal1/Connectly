package main

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
)

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func readJSON(w http.ResponseWriter, r *http.Request, value any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 512<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return false
	}
	if err := ensureJSONEOF(decoder); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return false
	}
	return true
}

func fail(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, errDisabled):
		status = http.StatusForbidden
	case errors.Is(err, errNoAction):
		status = http.StatusNotFound
	case errors.Is(err, errBusy):
		status = http.StatusConflict
	case errors.Is(err, errBadInput):
		status = http.StatusBadRequest
	}
	http.Error(w, err.Error(), status)
}

func (s *Server) audit(r *http.Request, remote bool, operation string, fields ...any) {
	caller := "local"
	if remote {
		caller = clientIP(r)
	}
	values := append([]any{"op", operation, "from", caller}, fields...)
	slog.Info("api", values...)
}

func (s *Server) mountActions(mux *http.ServeMux, wrap func(http.HandlerFunc) http.HandlerFunc, remote bool) {
	mux.HandleFunc("GET /api/capabilities", wrap(func(w http.ResponseWriter, r *http.Request) {
		caps := s.act.Capabilities()
		caps.Visual = remote && s.vis != nil
		s.audit(r, remote, "capabilities.list")
		writeJSON(w, http.StatusOK, caps)
	}))

	mux.HandleFunc("POST /api/actions/{id}", wrap(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		result, err := s.act.Run(id)
		if err != nil {
			s.audit(r, remote, "action", "id", id, "ok", false, "error", err.Error())
			fail(w, err)
			return
		}
		s.audit(r, remote, "action", "id", id, "ok", result.OK, "ms", result.Ms)
		writeJSON(w, http.StatusOK, result)
	}))

	mux.HandleFunc("GET /api/clipboard", wrap(func(w http.ResponseWriter, r *http.Request) {
		text, err := s.act.ClipboardGet()
		if err != nil {
			s.audit(r, remote, "clipboard.get", "ok", false, "error", err.Error())
			fail(w, err)
			return
		}
		s.audit(r, remote, "clipboard.get", "bytes", len(text))
		writeJSON(w, http.StatusOK, map[string]string{"text": text})
	}))

	mux.HandleFunc("PUT /api/clipboard", wrap(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Text string `json:"text"`
		}
		if !readJSON(w, r, &body) {
			s.audit(r, remote, "clipboard.set", "ok", false, "error", "bad request")
			return
		}
		if err := s.act.ClipboardSet(body.Text); err != nil {
			s.audit(r, remote, "clipboard.set", "ok", false, "bytes", len(body.Text), "error", err.Error())
			fail(w, err)
			return
		}
		s.audit(r, remote, "clipboard.set", "bytes", len(body.Text))
		w.WriteHeader(http.StatusNoContent)
	}))

	mux.HandleFunc("PUT /api/volume", wrap(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Level *int `json:"level"`
		}
		if !readJSON(w, r, &body) {
			s.audit(r, remote, "volume", "ok", false, "error", "bad request")
			return
		}
		if body.Level == nil {
			s.audit(r, remote, "volume", "ok", false, "error", "missing level")
			http.Error(w, "level is required", http.StatusBadRequest)
			return
		}
		if err := s.act.SetVolume(*body.Level); err != nil {
			s.audit(r, remote, "volume", "level", *body.Level, "ok", false, "error", err.Error())
			fail(w, err)
			return
		}
		s.audit(r, remote, "volume", "level", *body.Level)
		w.WriteHeader(http.StatusNoContent)
	}))

	mux.HandleFunc("POST /api/open", wrap(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Path string `json:"path"`
		}
		if !readJSON(w, r, &body) {
			s.audit(r, remote, "open", "ok", false, "error", "bad request")
			return
		}
		if err := s.act.OpenPath(body.Path); err != nil {
			s.audit(r, remote, "open", "path", body.Path, "ok", false, "error", err.Error())
			fail(w, err)
			return
		}
		s.audit(r, remote, "open", "path", body.Path)
		w.WriteHeader(http.StatusNoContent)
	}))
}

func (s *Server) mountVisual(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/visual", s.auth(func(w http.ResponseWriter, r *http.Request) {
		if s.vis == nil {
			s.audit(r, true, "visual.status", "ok", false, "error", "disabled")
			fail(w, errDisabled)
			return
		}
		active, remaining := s.vis.Status()
		s.audit(r, true, "visual.status", "active", active, "ttlSec", int(remaining.Seconds()))
		writeJSON(w, http.StatusOK, map[string]any{"active": active, "ttlSec": int(remaining.Seconds())})
	}))

	mux.HandleFunc("POST /api/visual/start", s.auth(func(w http.ResponseWriter, r *http.Request) {
		if s.vis == nil {
			s.audit(r, true, "visual.start", "ok", false, "error", "disabled")
			fail(w, errDisabled)
			return
		}
		ticket, ttl, err := s.vis.Start()
		if err != nil {
			s.audit(r, true, "visual.start", "ok", false, "error", err.Error())
			fail(w, err)
			return
		}
		s.audit(r, true, "visual.start", "ok", true)
		writeJSON(w, http.StatusOK, map[string]any{"ticket": ticket, "ttlSec": int(ttl.Seconds())})
	}))

	mux.HandleFunc("POST /api/visual/stop", s.auth(func(w http.ResponseWriter, r *http.Request) {
		if s.vis != nil {
			s.vis.Stop()
			s.audit(r, true, "visual.stop")
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	mux.HandleFunc("GET /vnc", func(w http.ResponseWriter, r *http.Request) {
		s.audit(r, true, "visual.bridge.request")
		if s.vis == nil {
			http.NotFound(w, r)
			return
		}
		s.vis.bridge(w, r)
	})
}
