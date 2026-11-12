package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

type localRequestKey struct{}

func localRequest(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), localRequestKey{}, true)
		handler(w, r.WithContext(ctx))
	}
}

func isLocalRequest(r *http.Request) bool {
	isLocal, _ := r.Context().Value(localRequestKey{}).(bool)
	return isLocal
}

func (s *Server) localRoutes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/sessions", localRequest(s.listSessions))
	mux.HandleFunc("GET /api/stats", localRequest(s.getStats))
	s.mountActions(mux, func(handler http.HandlerFunc) http.HandlerFunc { return handler }, false)
	return mux
}

func prepareSocketPath(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSocket == 0 {
		return fmt.Errorf("agent socket path exists and is not a socket: %s", path)
	}
	conn, dialErr := net.DialTimeout("unix", path, 250*time.Millisecond)
	if dialErr == nil {
		_ = conn.Close()
		return fmt.Errorf("agent socket is already in use: %s", path)
	}
	if errors.Is(dialErr, os.ErrNotExist) {
		return nil
	}
	if !errors.Is(dialErr, syscall.ECONNREFUSED) {
		return fmt.Errorf("could not determine whether agent socket is stale: %w", dialErr)
	}
	current, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !os.SameFile(info, current) {
		return fmt.Errorf("agent socket path changed while checking it: %s", path)
	}
	return os.Remove(path)
}

func serveAgent(ctx context.Context, path string, handler http.Handler) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := prepareSocketPath(path); err != nil {
		return err
	}
	listener, err := net.Listen("unix", path)
	if err != nil {
		return err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		_ = listener.Close()
		_ = os.Remove(path)
		return err
	}
	socketInfo, err := os.Lstat(path)
	if err != nil {
		_ = listener.Close()
		_ = os.Remove(path)
		return err
	}
	defer func() {
		if current, statErr := os.Lstat(path); statErr == nil && os.SameFile(socketInfo, current) {
			_ = os.Remove(path)
		}
	}()

	serveContext, cancel := context.WithCancel(ctx)
	defer cancel()
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		<-serveContext.Done()
		_ = server.Close()
	}()
	err = server.Serve(listener)
	cancel()
	<-stopped
	if ctx.Err() != nil {
		return nil
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
