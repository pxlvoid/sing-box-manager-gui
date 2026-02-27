import type { NodeHealthResult, HealthCheckMode } from '../../store';

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export const nodeTypeOptions = [
  { value: 'shadowsocks', label: 'Shadowsocks' },
  { value: 'vmess', label: 'VMess' },
  { value: 'vless', label: 'VLESS' },
  { value: 'trojan', label: 'Trojan' },
  { value: 'hysteria2', label: 'Hysteria2' },
  { value: 'tuic', label: 'TUIC' },
  { value: 'socks', label: 'SOCKS' },
];

export const countryOptions = [
  { code: 'UNKNOWN', name: 'Unknown', emoji: '🌐' },
  { code: 'HK', name: 'Hong Kong', emoji: '🇭🇰' },
  { code: 'TW', name: 'Taiwan', emoji: '🇹🇼' },
  { code: 'JP', name: 'Japan', emoji: '🇯🇵' },
  { code: 'KR', name: 'South Korea', emoji: '🇰🇷' },
  { code: 'SG', name: 'Singapore', emoji: '🇸🇬' },
  { code: 'US', name: 'United States', emoji: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', emoji: '🇬🇧' },
  { code: 'DE', name: 'Germany', emoji: '🇩🇪' },
  { code: 'FR', name: 'France', emoji: '🇫🇷' },
  { code: 'NL', name: 'Netherlands', emoji: '🇳🇱' },
  { code: 'AU', name: 'Australia', emoji: '🇦🇺' },
  { code: 'CA', name: 'Canada', emoji: '🇨🇦' },
  { code: 'RU', name: 'Russia', emoji: '🇷🇺' },
  { code: 'IN', name: 'India', emoji: '🇮🇳' },
];

export const defaultNode = {
  tag: '',
  type: 'shadowsocks',
  server: '',
  server_port: 443,
  country: 'HK',
  country_emoji: '🇭🇰',
  extra: {},
} as const;

export const ssMethodOptions = [
  'aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305',
  'none',
];

export const vmessSecurityOptions = ['auto', 'aes-128-gcm', 'chacha20-poly1305', 'none', 'zero'];

export const flowOptions = ['', 'xtls-rprx-vision'];

export const transportTypeOptions = ['tcp', 'ws', 'http', 'h2', 'grpc', 'quic'];

export const utlsFingerprintOptions = [
  '', 'chrome', 'firefox', 'safari', 'ios', 'android', 'edge', '360', 'qq', 'random', 'randomized',
];

export const congestionControlOptions = ['bbr', 'cubic', 'new_reno'];

export const protocolsWithTls = ['vmess', 'vless', 'trojan', 'hysteria2', 'tuic'];
export const protocolsWithTransport = ['vmess', 'vless', 'trojan'];
export const SITE_CHECK_TARGETS = [
  'https://chatgpt.com',
  'https://2ip.ru',
  'https://www.youtube.com/generate_204',
  'https://i.ytimg.com/generate_204',
  'https://instagram.com',
];

export const knownExtraKeys: Record<string, string[]> = {
  shadowsocks: ['method', 'password', 'network'],
  vmess: ['uuid', 'alter_id', 'security', 'tls', 'transport'],
  vless: ['uuid', 'flow', 'packet_encoding', 'tls', 'transport'],
  trojan: ['password', 'flow', 'tls', 'transport'],
  hysteria2: ['password', 'up_mbps', 'down_mbps', 'obfs', 'tls', 'ports', 'hop_interval'],
  tuic: ['uuid', 'password', 'congestion_control', 'udp_relay_mode', 'zero_rtt_handshake', 'heartbeat', 'tls'],
  socks: ['version', 'username', 'password', 'udp_over_tcp'],
};

export const UNIFIED_PAGE_SIZE = 50;

export interface UnifiedNode {
  key: string;
  node: import('../../store').Node;
  source: 'manual' | 'subscription';
  sourceName: string;
  sourceId: string;
  enabled: boolean;
  groupTag?: string;
  manualNodeId?: string;
  isUnsupported: boolean;
}

export interface NodeStabilityStats {
  server: string;
  server_port: number;
  total_checks: number;
  alive_checks: number;
  uptime_percent: number;
  avg_latency_ms: number;
  latency_trend: 'up' | 'down' | 'stable';
}

export type HealthFilter = 'all' | 'alive' | 'timeout' | 'unchecked' | 'stale';
export type SortColumn = 'name' | 'type' | 'source' | 'latency' | 'stability' | 'avgLatency';
export type SortDirection = 'asc' | 'desc';
export interface SortConfig {
  column: SortColumn | null;
  direction: SortDirection;
}

export function getNodeLatency(key: string, healthResults: Record<string, NodeHealthResult>, healthMode: HealthCheckMode | null): number | null {
  const result = healthResults[key];
  if (!result) return null;
  if ((healthMode === 'clash_api' || healthMode === 'clash_api_temp') && Object.keys(result.groups).length > 0) {
    const delays = Object.values(result.groups).filter(d => d > 0);
    if (delays.length === 0) return -1;
    return Math.min(...delays);
  }
  return -1;
}

export function spKey(node: { server: string; server_port: number }): string {
  return `${node.server}:${node.server_port}`;
}

export function shortSiteLabel(site: string): string {
  const host = site.toLowerCase();
  if (host.includes('chatgpt')) return 'chatgpt';
  if (host.includes('ytimg')) return 'yt-cdn';
  if (host.includes('youtube')) return 'yt-web';
  if (host.includes('instagram')) return 'instagram';
  if (host.includes('2ip')) return '2ip';
  return host.split('.')[0];
}
