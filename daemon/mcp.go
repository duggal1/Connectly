package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var mcpVersions = []string{"2025-06-18", "2025-03-26", "2024-11-05"}

type rpcReq struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcErr struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcResp struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcErr         `json:"error,omitempty"`
}

func rerr(code int, message string) *rpcErr { return &rpcErr{Code: code, Message: message} }

type mcpTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	run         func(*mcp, json.RawMessage) (string, error)
}

type mcp struct {
	client *http.Client
	tools  []mcpTool
}

func schema(required []string, properties map[string]any) map[string]any {
	result := map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
	if len(required) > 0 {
		result["required"] = required
	}
	return result
}

func prop(kind, description string) map[string]any {
	return map[string]any{"type": kind, "description": description}
}

func decodeToolArgs(raw json.RawMessage, target any) error {
	if len(raw) == 0 || string(raw) == "null" {
		return errors.New("arguments are required")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	return ensureJSONEOF(decoder)
}

func (m *mcp) do(method, path string, body any) (string, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return "", err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, "http://agent"+path, reader)
	if err != nil {
		return "", err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := m.client.Do(request)
	if err != nil {
		return "", fmt.Errorf("termd isn't reachable on the agent socket: %w", err)
	}
	defer response.Body.Close()
	content, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", err
	}
	text := strings.TrimSpace(string(content))
	if response.StatusCode >= http.StatusMultipleChoices {
		if text == "" {
			text = response.Status
		}
		return "", errors.New(text)
	}
	if text == "" {
		text = "ok"
	}
	return text, nil
}

func buildMCPTools() []mcpTool {
	return []mcpTool{
		{
			Name: "mac_status", Description: "Battery, charging state, lid state and load of this Mac.",
			InputSchema: schema(nil, map[string]any{}),
			run:         func(agent *mcp, _ json.RawMessage) (string, error) { return agent.do("GET", "/api/stats", nil) },
		},
		{
			Name: "list_sessions", Description: "Terminal sessions on this Mac and whether a phone is attached.",
			InputSchema: schema(nil, map[string]any{}),
			run:         func(agent *mcp, _ json.RawMessage) (string, error) { return agent.do("GET", "/api/sessions", nil) },
		},
		{
			Name: "list_actions", Description: "Allow-listed actions and enabled built-in controls.",
			InputSchema: schema(nil, map[string]any{}),
			run:         func(agent *mcp, _ json.RawMessage) (string, error) { return agent.do("GET", "/api/capabilities", nil) },
		},
		{
			Name: "run_action", Description: "Run one configured action by id. Arguments cannot be supplied.",
			InputSchema: schema([]string{"id"}, map[string]any{"id": prop("string", "Action id from list_actions")}),
			run: func(agent *mcp, raw json.RawMessage) (string, error) {
				var args struct {
					ID string `json:"id"`
				}
				if err := decodeToolArgs(raw, &args); err != nil || args.ID == "" {
					return "", errors.New("id is required")
				}
				return agent.do("POST", "/api/actions/"+url.PathEscape(args.ID), nil)
			},
		},
		{
			Name: "clipboard_get", Description: "Read Mac clipboard text when clipboard access is enabled.",
			InputSchema: schema(nil, map[string]any{}),
			run:         func(agent *mcp, _ json.RawMessage) (string, error) { return agent.do("GET", "/api/clipboard", nil) },
		},
		{
			Name: "clipboard_set", Description: "Replace Mac clipboard text (up to 64 KB).",
			InputSchema: schema([]string{"text"}, map[string]any{"text": prop("string", "Text, up to 64 KB")}),
			run: func(agent *mcp, raw json.RawMessage) (string, error) {
				var args struct {
					Text *string `json:"text"`
				}
				if err := decodeToolArgs(raw, &args); err != nil || args.Text == nil {
					return "", errors.New("text is required")
				}
				return agent.do("PUT", "/api/clipboard", args)
			},
		},
		{
			Name: "open_path", Description: "Open a file or folder inside a configured actions.json root.",
			InputSchema: schema([]string{"path"}, map[string]any{"path": prop("string", "Absolute path")}),
			run: func(agent *mcp, raw json.RawMessage) (string, error) {
				var args struct {
					Path string `json:"path"`
				}
				if err := decodeToolArgs(raw, &args); err != nil || args.Path == "" {
					return "", errors.New("path is required")
				}
				return agent.do("POST", "/api/open", args)
			},
		},
		{
			Name: "set_volume", Description: "Set Mac output volume from 0 to 100 when volume control is enabled.",
			InputSchema: schema([]string{"level"}, map[string]any{"level": prop("integer", "0 to 100")}),
			run: func(agent *mcp, raw json.RawMessage) (string, error) {
				var args struct {
					Level *int `json:"level"`
				}
				if err := decodeToolArgs(raw, &args); err != nil || args.Level == nil {
					return "", errors.New("level is required")
				}
				return agent.do("PUT", "/api/volume", args)
			},
		},
	}
}

func toolResult(text string, isError bool) map[string]any {
	return map[string]any{
		"content": []map[string]string{{"type": "text", "text": text}},
		"isError": isError,
	}
}

func (m *mcp) handle(request rpcReq) (any, *rpcErr) {
	switch request.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(request.Params, &params)
		version := mcpVersions[0]
		for _, supported := range mcpVersions {
			if supported == params.ProtocolVersion {
				version = supported
				break
			}
		}
		return map[string]any{
			"protocolVersion": version,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "connectly", "version": "0.2.0"},
			"instructions":    "Safe, allow-listed controls for this Mac. Call list_actions first.",
		}, nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		return map[string]any{"tools": m.tools}, nil
	case "tools/call":
		var params struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(request.Params, &params); err != nil || params.Name == "" {
			return nil, rerr(-32602, "invalid params")
		}
		for _, tool := range m.tools {
			if tool.Name == params.Name {
				text, err := tool.run(m, params.Arguments)
				if err != nil {
					return toolResult(err.Error(), true), nil
				}
				return toolResult(text, false), nil
			}
		}
		return nil, rerr(-32602, "unknown tool")
	default:
		return nil, rerr(-32601, "method not found")
	}
}

func unixClient(path string) *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "unix", path)
			},
		},
		Timeout: 11 * time.Minute,
	}
}

func runMCP(args []string) int {
	flags := flag.NewFlagSet("mcp", flag.ContinueOnError)
	socketPath := flags.String("socket", filepath.Join(configDir(), "agent.sock"), "termd agent socket")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	server := &mcp{client: unixClient(*socketPath), tools: buildMCPTools()}
	input := bufio.NewScanner(os.Stdin)
	input.Buffer(make([]byte, 1<<20), 8<<20)
	output := json.NewEncoder(os.Stdout)
	for input.Scan() {
		line := bytes.TrimSpace(input.Bytes())
		if len(line) == 0 {
			continue
		}
		var request rpcReq
		if err := json.Unmarshal(line, &request); err != nil {
			_ = output.Encode(rpcResp{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: rerr(-32700, "parse error")})
			continue
		}
		if request.JSONRPC != "2.0" || request.Method == "" {
			if len(request.ID) != 0 {
				_ = output.Encode(rpcResp{JSONRPC: "2.0", ID: request.ID, Error: rerr(-32600, "invalid request")})
			}
			continue
		}
		result, rpcError := server.handle(request)
		if len(request.ID) == 0 {
			continue
		}
		response := rpcResp{JSONRPC: "2.0", ID: request.ID, Result: result, Error: rpcError}
		_ = output.Encode(response)
	}
	if input.Err() != nil {
		return 1
	}
	return 0
}
