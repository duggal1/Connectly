package main

import (
	"errors"
	"net/http"
	"strconv"
)

func (s *Server) mountRemote(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/remote/info", s.auth(s.handleRemoteInfo))
	mux.HandleFunc("GET /api/remote/sessions", s.auth(s.handleRemoteList))
	mux.HandleFunc("POST /api/remote/sessions", s.auth(s.handleRemoteCreate))
	mux.HandleFunc("POST /api/remote/sessions/{id}/interrupt", s.auth(s.handleRemoteInterrupt))
	mux.HandleFunc("POST /api/remote/sessions/{id}/rename", s.auth(s.handleRemoteRename))
	mux.HandleFunc("POST /api/remote/sessions/{id}/detach-others", s.auth(s.handleRemoteDetachOthers))
	mux.HandleFunc("POST /api/remote/sessions/{id}/keys", s.auth(s.handleRemoteKeys))
	mux.HandleFunc("DELETE /api/remote/sessions/{id}", s.auth(s.handleRemoteDelete))
	mux.HandleFunc("POST /api/remote/loose/{pid}/stop", s.auth(s.handleLooseStop))
}

func (s *Server) handleRemoteInfo(w http.ResponseWriter, r *http.Request) {
	socket := s.cfg.TmuxSocket
	if socket == "" {
		socket = defaultTmuxSocket()
	}
	bin := s.cfg.TmuxBin
	if s.remote != nil {
		bin = s.remote.tmux.bin
	}
	s.audit(r, true, "remote.info")
	writeJSON(w, http.StatusOK, map[string]any{
		"available": s.remote != nil,
		"socket":    socket,
		"tmux":      bin,
		"hook":      tmuxHook(socket),
	})
}

func (s *Server) handleRemoteList(w http.ResponseWriter, r *http.Request) {
	if s.remote == nil {
		s.audit(r, true, "remote.list", "ok", false, "error", "tmux unavailable")
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Install tmux on the Mac, then restart termd."})
		return
	}
	snapshot, err := s.remote.listSessions()
	if err != nil {
		s.audit(r, true, "remote.list", "ok", false, "error", err.Error())
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}
	s.audit(r, true, "remote.list", "count", len(snapshot.Sessions), "outside", len(snapshot.Loose))
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) handleRemoteCreate(w http.ResponseWriter, r *http.Request) {
	if s.remote == nil {
		s.audit(r, true, "remote.create", "ok", false, "error", "tmux unavailable")
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Install tmux on the Mac, then restart termd."})
		return
	}
	var body struct {
		Name    string `json:"name"`
		Command string `json:"command"`
		Cwd     string `json:"cwd"`
		Cols    int    `json:"cols"`
		Rows    int    `json:"rows"`
	}
	if !readJSON(w, r, &body) {
		s.audit(r, true, "remote.create", "ok", false, "error", "bad request")
		return
	}
	if len(body.Name) > 128 || len(body.Command) > 512 || len(body.Cwd) > 4096 {
		s.audit(r, true, "remote.create", "ok", false, "error", "input too long")
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Session details are too long."})
		return
	}
	id, name, err := s.remote.create(body.Name, body.Cwd, body.Command, body.Cols, body.Rows)
	if err != nil {
		s.audit(r, true, "remote.create", "ok", false, "name", safeSessionName(body.Name), "error", err.Error())
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.audit(r, true, "remote.create", "ok", true, "id", id, "name", name)
	writeJSON(w, http.StatusCreated, map[string]string{"id": id, "name": name})
}

func (s *Server) remoteID(w http.ResponseWriter, r *http.Request) (string, bool) {
	if s.remote == nil {
		s.audit(r, true, "remote.request.rejected", "method", r.Method, "path", r.URL.Path, "error", "tmux unavailable")
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Install tmux on the Mac, then restart termd."})
		return "", false
	}
	id := r.PathValue("id")
	if !validTmuxSessionID(id) {
		s.audit(r, true, "remote.request.rejected", "method", r.Method, "path", r.URL.Path, "error", "invalid session id")
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid remote session id."})
		return "", false
	}
	return id, true
}

func (s *Server) handleRemoteInterrupt(w http.ResponseWriter, r *http.Request) {
	id, ok := s.remoteID(w, r)
	if !ok {
		return
	}
	if err := s.remote.interrupt(id); err != nil {
		remoteError(w, err)
		s.audit(r, true, "remote.interrupt", "id", id, "ok", false, "error", err.Error())
		return
	}
	s.audit(r, true, "remote.interrupt", "id", id)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRemoteRename(w http.ResponseWriter, r *http.Request) {
	id, ok := s.remoteID(w, r)
	if !ok {
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &body) {
		s.audit(r, true, "remote.rename", "id", id, "ok", false, "error", "bad request")
		return
	}
	if len(body.Name) > 128 {
		s.audit(r, true, "remote.rename", "id", id, "ok", false, "error", "name too long")
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Session name is too long."})
		return
	}
	name, err := s.remote.rename(id, body.Name)
	if err != nil {
		remoteError(w, err)
		s.audit(r, true, "remote.rename", "id", id, "ok", false, "error", err.Error())
		return
	}
	s.audit(r, true, "remote.rename", "id", id, "name", name)
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "name": name})
}

func (s *Server) handleRemoteDetachOthers(w http.ResponseWriter, r *http.Request) {
	id, ok := s.remoteID(w, r)
	if !ok {
		return
	}
	if err := s.remote.detachOthers(id); err != nil {
		remoteError(w, err)
		s.audit(r, true, "remote.detach_others", "id", id, "ok", false, "error", err.Error())
		return
	}
	s.audit(r, true, "remote.detach_others", "id", id)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRemoteKeys(w http.ResponseWriter, r *http.Request) {
	id, ok := s.remoteID(w, r)
	if !ok {
		return
	}
	var body struct {
		Keys []string `json:"keys"`
	}
	if !readJSON(w, r, &body) {
		s.audit(r, true, "remote.keys", "id", id, "ok", false, "error", "bad request")
		return
	}
	if err := s.remote.sendKeys(id, body.Keys); err != nil {
		remoteError(w, err)
		s.audit(r, true, "remote.keys", "id", id, "ok", false, "error", err.Error())
		return
	}
	s.audit(r, true, "remote.keys", "id", id, "count", len(body.Keys))
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRemoteDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := s.remoteID(w, r)
	if !ok {
		return
	}
	if err := s.remote.kill(id); err != nil {
		remoteError(w, err)
		s.audit(r, true, "remote.end", "id", id, "ok", false, "error", err.Error())
		return
	}
	s.audit(r, true, "remote.end", "id", id)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleLooseStop(w http.ResponseWriter, r *http.Request) {
	if s.remote == nil {
		s.audit(r, true, "remote.loose_stop", "ok", false, "error", "tmux unavailable")
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Install tmux on the Mac, then restart termd."})
		return
	}
	pid, err := strconv.Atoi(r.PathValue("pid"))
	if err != nil || pid <= 1 {
		s.audit(r, true, "remote.loose_stop", "ok", false, "error", "invalid process id")
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid process id."})
		return
	}
	var body struct {
		StartedAt int64  `json:"startedAt"`
		How       string `json:"how"`
	}
	if !readJSON(w, r, &body) {
		s.audit(r, true, "remote.loose_stop", "pid", pid, "ok", false, "error", "bad request")
		return
	}
	if err := s.remote.stopLoose(pid, body.StartedAt, body.How); err != nil {
		remoteError(w, err)
		s.audit(r, true, "remote.loose_stop", "pid", pid, "ok", false, "error", err.Error())
		return
	}
	s.audit(r, true, "remote.loose_stop", "pid", pid, "how", body.How)
	w.WriteHeader(http.StatusNoContent)
}

func remoteError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	if errors.Is(err, errBadSessionID) {
		status = http.StatusBadRequest
	} else if errors.Is(err, errRemoteSession) {
		status = http.StatusNotFound
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
