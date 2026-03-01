package api

import "testing"

func TestIsAutoProxySelection(t *testing.T) {
	tests := []struct {
		name    string
		proxies map[string]clashProxySnapshot
		root    clashProxySnapshot
		want    bool
	}{
		{
			name: "proxy points to Auto selector",
			proxies: map[string]clashProxySnapshot{
				"Proxy": {Type: "Selector", Now: "Auto"},
			},
			root: clashProxySnapshot{Type: "Selector", Now: "Auto"},
			want: true,
		},
		{
			name: "proxy points to urltest group",
			proxies: map[string]clashProxySnapshot{
				"Proxy":     {Type: "Selector", Now: "JP Auto"},
				"JP Auto":   {Type: "urltest", Now: "node_1"},
				"node_1":    {Type: "vmess", Now: ""},
				"something": {Type: "selector", Now: ""},
			},
			root: clashProxySnapshot{Type: "Selector", Now: "JP Auto"},
			want: true,
		},
		{
			name: "proxy points to manual selector group",
			proxies: map[string]clashProxySnapshot{
				"Proxy":     {Type: "Selector", Now: "US Manual"},
				"US Manual": {Type: "selector", Now: "node_2"},
			},
			root: clashProxySnapshot{Type: "Selector", Now: "US Manual"},
			want: false,
		},
		{
			name: "empty current selection",
			proxies: map[string]clashProxySnapshot{
				"Proxy": {Type: "Selector", Now: ""},
			},
			root: clashProxySnapshot{Type: "Selector", Now: ""},
			want: false,
		},
		{
			name: "selected group missing from snapshot",
			proxies: map[string]clashProxySnapshot{
				"Proxy": {Type: "Selector", Now: "Missing Group"},
			},
			root: clashProxySnapshot{Type: "Selector", Now: "Missing Group"},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isAutoProxySelection(tt.proxies, tt.root)
			if got != tt.want {
				t.Fatalf("isAutoProxySelection() = %v, want %v", got, tt.want)
			}
		})
	}
}
