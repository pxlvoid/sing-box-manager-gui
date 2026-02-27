import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardBody, CardHeader, Chip, Button, ButtonGroup, Spinner } from '@nextui-org/react';
import { Activity, ArrowDownToLine, ArrowUpToLine, Clock, Network, Users, Database } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { monitoringApi } from '../api';

interface TrafficHistoryPoint {
  timestamp: string;
  up_bps: number;
  down_bps: number;
  active_connections: number;
  client_count: number;
}

interface MonitoringOverview {
  running: boolean;
  timestamp: string;
  up_bps: number;
  down_bps: number;
  upload_total: number;
  download_total: number;
  active_connections: number;
  client_count: number;
  memory_inuse: number;
  memory_oslimit: number;
}

interface MonitoringLifetimeStats {
  sample_count: number;
  total_clients: number;
  total_upload_bytes: number;
  total_download_bytes: number;
  total_traffic_bytes: number;
  first_sample_at?: string;
  last_sample_at?: string;
}

interface MonitoringClient {
  source_ip: string;
  last_seen?: string;
  online?: boolean;
  active_connections: number;
  upload_bytes: number;
  download_bytes: number;
  duration_seconds: number;
  proxy_chain: string;
  host_count: number;
  top_host: string;
}

interface MonitoringResource {
  source_ip: string;
  host: string;
  active_connections: number;
  upload_bytes: number;
  download_bytes: number;
  proxy_chain: string;
}

interface ClashConnection {
  metadata?: {
    sourceIP?: string;
    destinationIP?: string;
    host?: string;
  };
  upload?: number;
  download?: number;
  start?: string;
  chains?: string[];
}

interface ClashConnectionsSnapshot {
  uploadTotal?: number;
  downloadTotal?: number;
  connections?: ClashConnection[];
  memory?: {
    inuse?: number;
    oslimit?: number;
  };
}

const defaultOverview: MonitoringOverview = {
  running: false,
  timestamp: new Date().toISOString(),
  up_bps: 0,
  down_bps: 0,
  upload_total: 0,
  download_total: 0,
  active_connections: 0,
  client_count: 0,
  memory_inuse: 0,
  memory_oslimit: 0,
};

const defaultLifetime: MonitoringLifetimeStats = {
  sample_count: 0,
  total_clients: 0,
  total_upload_bytes: 0,
  total_download_bytes: 0,
  total_traffic_bytes: 0,
};

const CHART_PERIODS = [
  { key: '1m', label: '1 мин', seconds: 60 },
  { key: '5m', label: '5 мин', seconds: 300 },
  { key: '15m', label: '15 мин', seconds: 900 },
  { key: '1h', label: '1 час', seconds: 3600 },
] as const;

const MAX_HISTORY_POINTS = 3600;

function toWebSocketURL(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeProxyChain(chains?: string[]): string {
  if (!chains || chains.length === 0) return 'direct';
  const cleaned = chains.map((item) => item.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join(' -> ') : 'direct';
}

function normalizeHost(host?: string, destinationIP?: string): string {
  const h = (host || '').trim().toLowerCase();
  if (h) return h;
  return (destinationIP || '').trim();
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

function formatDateTime(value?: string): string {
  if (!value) return '-';
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return '-';
  return new Date(ts).toLocaleString();
}

function appendPoint(history: TrafficHistoryPoint[], point: TrafficHistoryPoint): TrafficHistoryPoint[] {
  const next = [...history, point];
  if (next.length <= MAX_HISTORY_POINTS) return next;
  return next.slice(next.length - MAX_HISTORY_POINTS);
}

const CHART_EMA_ALPHA = 0.28;

function aggregateConnections(connections: ClashConnection[]): { clients: MonitoringClient[]; resources: MonitoringResource[] } {
  type ClientAcc = {
    source_ip: string;
    active_connections: number;
    upload_bytes: number;
    download_bytes: number;
    earliestStart: number;
    chainCounter: Record<string, number>;
    hosts: Set<string>;
  };
  type ResourceAcc = MonitoringResource;

  const clientsMap = new Map<string, ClientAcc>();
  const resourcesMap = new Map<string, ResourceAcc>();

  for (const conn of connections) {
    const sourceIP = (conn.metadata?.sourceIP || '').trim() || 'unknown';
    const host = normalizeHost(conn.metadata?.host, conn.metadata?.destinationIP);
    const chain = normalizeProxyChain(conn.chains);
    const upload = toNumber(conn.upload);
    const download = toNumber(conn.download);

    const client = clientsMap.get(sourceIP) || {
      source_ip: sourceIP,
      active_connections: 0,
      upload_bytes: 0,
      download_bytes: 0,
      earliestStart: 0,
      chainCounter: {},
      hosts: new Set<string>(),
    };

    client.active_connections += 1;
    client.upload_bytes += upload;
    client.download_bytes += download;
    client.chainCounter[chain] = (client.chainCounter[chain] || 0) + 1;
    if (host) client.hosts.add(host);

    if (conn.start) {
      const ts = Date.parse(conn.start);
      if (!Number.isNaN(ts)) {
        if (client.earliestStart === 0 || ts < client.earliestStart) {
          client.earliestStart = ts;
        }
      }
    }
    clientsMap.set(sourceIP, client);

    if (host) {
      const key = `${sourceIP}\u0000${host}`;
      const resource = resourcesMap.get(key) || {
        source_ip: sourceIP,
        host,
        active_connections: 0,
        upload_bytes: 0,
        download_bytes: 0,
        proxy_chain: chain,
      };
      resource.active_connections += 1;
      resource.upload_bytes += upload;
      resource.download_bytes += download;
      if (resource.proxy_chain === 'direct') {
        resource.proxy_chain = chain;
      }
      resourcesMap.set(key, resource);
    }
  }

  const topHostByIP = new Map<string, string>();
  const topHostTrafficByIP = new Map<string, number>();
  for (const resource of resourcesMap.values()) {
    const traffic = resource.upload_bytes + resource.download_bytes;
    if (traffic > (topHostTrafficByIP.get(resource.source_ip) || 0)) {
      topHostTrafficByIP.set(resource.source_ip, traffic);
      topHostByIP.set(resource.source_ip, resource.host);
    }
  }

  const now = Date.now();
  const clients: MonitoringClient[] = [...clientsMap.values()].map((client) => {
    let topChain = 'direct';
    let topChainCount = -1;
    for (const [chain, count] of Object.entries(client.chainCounter)) {
      if (count > topChainCount) {
        topChain = chain;
        topChainCount = count;
      }
    }

    const durationSeconds = client.earliestStart > 0
      ? Math.max(0, Math.round((now - client.earliestStart) / 1000))
      : 0;

    return {
      source_ip: client.source_ip,
      active_connections: client.active_connections,
      upload_bytes: client.upload_bytes,
      download_bytes: client.download_bytes,
      duration_seconds: durationSeconds,
      proxy_chain: topChain,
      host_count: client.hosts.size,
      top_host: topHostByIP.get(client.source_ip) || '',
    };
  });

  clients.sort((a, b) => {
    const tA = a.upload_bytes + a.download_bytes;
    const tB = b.upload_bytes + b.download_bytes;
    if (tA === tB) return b.active_connections - a.active_connections;
    return tB - tA;
  });

  const resources = [...resourcesMap.values()];
  resources.sort((a, b) => {
    const tA = a.upload_bytes + a.download_bytes;
    const tB = b.upload_bytes + b.download_bytes;
    if (tA === tB) return b.active_connections - a.active_connections;
    return tB - tA;
  });

  return { clients, resources };
}

function mergeClients(recent: MonitoringClient[], active: MonitoringClient[], nowISO: string): MonitoringClient[] {
  const merged = new Map<string, MonitoringClient>();

  for (const item of recent) {
    merged.set(item.source_ip, {
      ...item,
      online: Boolean(item.online),
      last_seen: item.last_seen || nowISO,
    });
  }

  for (const item of active) {
    merged.set(item.source_ip, {
      ...item,
      online: true,
      last_seen: nowISO,
    });
  }

  const list = [...merged.values()];
  list.sort((a, b) => {
    if (Boolean(a.online) !== Boolean(b.online)) {
      return a.online ? -1 : 1;
    }
    const aTime = Date.parse(a.last_seen || '') || 0;
    const bTime = Date.parse(b.last_seen || '') || 0;
    return bTime - aTime;
  });
  return list;
}

export default function TrafficMonitoringPanel() {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<MonitoringOverview>(defaultOverview);
  const [lifetime, setLifetime] = useState<MonitoringLifetimeStats>(defaultLifetime);
  const [history, setHistory] = useState<TrafficHistoryPoint[]>([]);
  const [activeClients, setActiveClients] = useState<MonitoringClient[]>([]);
  const [recentClients, setRecentClients] = useState<MonitoringClient[]>([]);
  const [resources, setResources] = useState<MonitoringResource[]>([]);
  const [selectedClientIP, setSelectedClientIP] = useState<string>('');
  const [fallbackResources, setFallbackResources] = useState<MonitoringResource[]>([]);
  const [fallbackResourcesFor, setFallbackResourcesFor] = useState<string>('');
  const [trafficConnected, setTrafficConnected] = useState(false);
  const [connectionsConnected, setConnectionsConnected] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<string>('5m');

  const fetchRecentClients = useCallback(async () => {
    try {
      const res = await monitoringApi.getRecentClients(400, 24);
      setRecentClients(res.data?.data || []);
    } catch (error) {
      console.error('Failed to fetch recent monitoring clients:', error);
    }
  }, []);

  const fetchLifetime = useCallback(async () => {
    try {
      const res = await monitoringApi.getLifetime();
      setLifetime({ ...defaultLifetime, ...(res.data?.data || {}) });
    } catch (error) {
      console.error('Failed to fetch lifetime monitoring stats:', error);
    }
  }, []);

  const fetchInitial = useCallback(async () => {
    try {
      setLoading(true);
      const [overviewRes, lifetimeRes, historyRes, recentClientsRes, resourcesRes] = await Promise.all([
        monitoringApi.getOverview(),
        monitoringApi.getLifetime(),
        monitoringApi.getHistory(MAX_HISTORY_POINTS),
        monitoringApi.getRecentClients(400, 24),
        monitoringApi.getResources(300),
      ]);

      setOverview({ ...defaultOverview, ...(overviewRes.data?.data || {}) });
      setLifetime({ ...defaultLifetime, ...(lifetimeRes.data?.data || {}) });
      setHistory(historyRes.data?.data || []);
      setRecentClients(recentClientsRes.data?.data || []);
      setResources(resourcesRes.data?.data || []);
    } catch (error) {
      console.error('Failed to fetch monitoring data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      fetchRecentClients();
      fetchLifetime();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [fetchRecentClients, fetchLifetime]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimer: number | null = null;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(toWebSocketURL('/api/monitoring/ws/traffic'));
      ws.onopen = () => setTrafficConnected(true);
      ws.onclose = () => {
        setTrafficConnected(false);
        if (!closed) {
          retryTimer = window.setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => {
        ws?.close();
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (typeof data !== 'object' || data === null || !('up' in data) || !('down' in data)) {
            return;
          }
          const up = toNumber(data.up);
          const down = toNumber(data.down);
          const ts = new Date().toISOString();

          setOverview((prev) => {
            const next = { ...prev, running: true, up_bps: up, down_bps: down, timestamp: ts };
            setHistory((prevHistory) => appendPoint(prevHistory, {
              timestamp: ts,
              up_bps: up,
              down_bps: down,
              active_connections: next.active_connections,
              client_count: next.client_count,
            }));
            return next;
          });
        } catch (error) {
          console.error('Failed to parse traffic stream payload:', error);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      ws?.close();
    };
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimer: number | null = null;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(toWebSocketURL('/api/monitoring/ws/connections?interval=1000'));
      ws.onopen = () => setConnectionsConnected(true);
      ws.onclose = () => {
        setConnectionsConnected(false);
        if (!closed) {
          retryTimer = window.setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => {
        ws?.close();
      };
      ws.onmessage = (event) => {
        try {
          const snapshot = JSON.parse(event.data) as ClashConnectionsSnapshot;
          if (!snapshot || typeof snapshot !== 'object' || 'error' in (snapshot as Record<string, unknown>)) {
            return;
          }
          const liveConnections = Array.isArray(snapshot.connections) ? snapshot.connections : [];
          const { clients: liveClients, resources: liveResources } = aggregateConnections(liveConnections);
          const ts = new Date().toISOString();

          setActiveClients(liveClients.map((client) => ({ ...client, online: true, last_seen: ts })));
          setResources(liveResources);
          setRecentClients((prev) => mergeClients(prev, liveClients, ts));
          setOverview((prev) => ({
            ...prev,
            running: true,
            timestamp: ts,
            upload_total: toNumber(snapshot.uploadTotal),
            download_total: toNumber(snapshot.downloadTotal),
            active_connections: liveConnections.length,
            client_count: liveClients.length,
            memory_inuse: toNumber(snapshot.memory?.inuse),
            memory_oslimit: toNumber(snapshot.memory?.oslimit),
          }));
        } catch (error) {
          console.error('Failed to parse connections stream payload:', error);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      ws?.close();
    };
  }, []);

  const selectedPeriod = useMemo(
    () => CHART_PERIODS.find((p) => p.key === chartPeriod) || CHART_PERIODS[1],
    [chartPeriod],
  );

  const chartData = useMemo(() => {
    const now = Date.now();
    const cutoff = now - selectedPeriod.seconds * 1000;
    const filtered = history.filter((p) => {
      const ts = Date.parse(p.timestamp);
      return !Number.isNaN(ts) && ts >= cutoff;
    });

    let emaUp = 0;
    let emaDown = 0;

    return filtered.map((point, idx) => {
      const rawUp = Math.max(0, toNumber(point.up_bps));
      const rawDown = Math.max(0, toNumber(point.down_bps));

      if (idx === 0) {
        emaUp = rawUp;
        emaDown = rawDown;
      } else {
        emaUp = (rawUp * CHART_EMA_ALPHA) + (emaUp * (1 - CHART_EMA_ALPHA));
        emaDown = (rawDown * CHART_EMA_ALPHA) + (emaDown * (1 - CHART_EMA_ALPHA));
      }

      return {
        ...point,
        time: new Date(point.timestamp).toLocaleTimeString([], { hour12: false }),
        up_kbps: emaUp / 1024,
        down_kbps: emaDown / 1024,
      };
    });
  }, [history, selectedPeriod]);

  const clients = useMemo(
    () => mergeClients(recentClients, activeClients, new Date().toISOString()),
    [recentClients, activeClients],
  );

  useEffect(() => {
    if (clients.length === 0) {
      setSelectedClientIP('');
      return;
    }
    if (!selectedClientIP || !clients.some((client) => client.source_ip === selectedClientIP)) {
      setSelectedClientIP(clients[0].source_ip);
    }
  }, [clients, selectedClientIP]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.source_ip === selectedClientIP) || null,
    [clients, selectedClientIP],
  );

  useEffect(() => {
    if (!selectedClient || selectedClient.online) {
      setFallbackResources([]);
      setFallbackResourcesFor('');
      return;
    }
    if (fallbackResourcesFor === selectedClient.source_ip) {
      return;
    }

    let cancelled = false;
    monitoringApi
      .getResources(300, selectedClient.source_ip)
      .then((res) => {
        if (cancelled) return;
        setFallbackResources(res.data?.data || []);
        setFallbackResourcesFor(selectedClient.source_ip);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to fetch fallback client resources:', error);
        setFallbackResources([]);
        setFallbackResourcesFor(selectedClient.source_ip);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedClient, fallbackResourcesFor]);

  const liveSelectedResources = useMemo(
    () => (selectedClient ? resources.filter((resource) => resource.source_ip === selectedClient.source_ip) : []),
    [resources, selectedClient],
  );

  const selectedResources = useMemo(
    () => (selectedClient?.online ? liveSelectedResources : fallbackResources),
    [selectedClient, liveSelectedResources, fallbackResources],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Connection status */}
      <div className="flex items-center gap-2">
        <Chip size="sm" variant="flat" color={trafficConnected ? 'success' : 'warning'}>
          traffic: {trafficConnected ? 'live' : 'offline'}
        </Chip>
        <Chip size="sm" variant="flat" color={connectionsConnected ? 'success' : 'warning'}>
          connections: {connectionsConnected ? 'live' : 'offline'}
        </Chip>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="shadow-sm">
          <CardBody className="py-4 px-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <ArrowUpToLine className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <span className="text-sm text-gray-500 dark:text-gray-400">Upload</span>
            </div>
            <p className="text-2xl font-bold">{formatRate(overview.up_bps)}</p>
            <p className="text-xs text-gray-400 mt-1">Total: {formatBytes(overview.upload_total)}</p>
          </CardBody>
        </Card>

        <Card className="shadow-sm">
          <CardBody className="py-4 px-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <ArrowDownToLine className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-sm text-gray-500 dark:text-gray-400">Download</span>
            </div>
            <p className="text-2xl font-bold">{formatRate(overview.down_bps)}</p>
            <p className="text-xs text-gray-400 mt-1">Total: {formatBytes(overview.download_total)}</p>
          </CardBody>
        </Card>

        <Card className="shadow-sm">
          <CardBody className="py-4 px-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                <Activity className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              </div>
              <span className="text-sm text-gray-500 dark:text-gray-400">Connections</span>
            </div>
            <p className="text-2xl font-bold">{overview.active_connections}</p>
            <p className="text-xs text-gray-400 mt-1">Memory: {formatBytes(overview.memory_inuse)}</p>
          </CardBody>
        </Card>

        <Card className="shadow-sm">
          <CardBody className="py-4 px-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <Users className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              </div>
              <span className="text-sm text-gray-500 dark:text-gray-400">Clients</span>
            </div>
            <p className="text-2xl font-bold">{overview.client_count}</p>
            <p className="text-xs text-gray-400 mt-1">All time: {lifetime.total_clients}</p>
          </CardBody>
        </Card>
      </div>

      {/* Traffic chart */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-0">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-gray-500" />
            <h3 className="font-semibold">Traffic</h3>
          </div>
          <ButtonGroup size="sm" variant="flat">
            {CHART_PERIODS.map((period) => (
              <Button
                key={period.key}
                color={chartPeriod === period.key ? 'primary' : 'default'}
                onPress={() => setChartPeriod(period.key)}
              >
                {period.label}
              </Button>
            ))}
          </ButtonGroup>
        </CardHeader>
        <CardBody>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" minTickGap={24} />
                <YAxis tickFormatter={(value) => `${Math.round(value)} KB/s`} />
                <Tooltip
                  formatter={(value, name) => {
                    const raw = Array.isArray(value) ? value[0] : value;
                    const numeric = Number(raw);
                    const bytesPerSecond = Number.isFinite(numeric) ? numeric * 1024 : 0;
                    return [formatRate(Math.round(bytesPerSecond)), name === 'up_kbps' ? 'Upload' : 'Download'];
                  }}
                  labelFormatter={(label) => `Time: ${label}`}
                />
                <Legend formatter={(value) => (value === 'up_kbps' ? 'Upload' : 'Download')} />
                <Area type="monotone" dataKey="up_kbps" stroke="#16a34a" fill="#16a34a33" strokeWidth={2} />
                <Area type="monotone" dataKey="down_kbps" stroke="#2563eb" fill="#2563eb33" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>

      {/* Lifetime stats */}
      <Card className="shadow-sm">
        <CardHeader className="pb-0">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-gray-500" />
            <h3 className="font-semibold">System Totals</h3>
          </div>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Clients seen</p>
              <p className="text-lg font-semibold">{lifetime.total_clients}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Total upload</p>
              <p className="text-lg font-semibold">{formatBytes(lifetime.total_upload_bytes)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Total download</p>
              <p className="text-lg font-semibold">{formatBytes(lifetime.total_download_bytes)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Total traffic</p>
              <p className="text-lg font-semibold">{formatBytes(lifetime.total_traffic_bytes)}</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400">
            <Clock className="w-3 h-3 inline mr-1" />
            {formatDateTime(lifetime.first_sample_at)} — {formatDateTime(lifetime.last_sample_at)} · {lifetime.sample_count} samples
          </div>
        </CardBody>
      </Card>

      {/* Clients + Details */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-0">
            <h3 className="font-semibold">Clients</h3>
          </CardHeader>
          <CardBody>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="py-2 pr-3">IP</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Last Seen</th>
                    <th className="py-2 pr-3">Conn</th>
                    <th className="py-2 pr-3">Traffic</th>
                    <th className="py-2">Top Host</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.slice(0, 25).map((client) => {
                    const isSelected = client.source_ip === selectedClientIP;
                    return (
                      <tr
                        key={client.source_ip}
                        className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors ${isSelected ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
                        onClick={() => setSelectedClientIP(client.source_ip)}
                      >
                        <td className="py-2 pr-3 font-mono">{client.source_ip}</td>
                        <td className="py-2 pr-3">
                          <Chip size="sm" variant="flat" color={client.online ? 'success' : 'default'}>
                            {client.online ? 'online' : 'offline'}
                          </Chip>
                        </td>
                        <td className="py-2 pr-3">{formatDateTime(client.last_seen)}</td>
                        <td className="py-2 pr-3">{client.active_connections}</td>
                        <td className="py-2 pr-3">{formatBytes(client.upload_bytes + client.download_bytes)}</td>
                        <td className="py-2 truncate max-w-[160px]" title={client.top_host || '-'}>
                          {client.top_host || '-'}
                        </td>
                      </tr>
                    );
                  })}
                  {clients.length === 0 && (
                    <tr>
                      <td className="py-3 text-gray-500" colSpan={6}>No clients in recent history</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-col gap-2 pb-0">
            <h3 className="font-semibold w-full">Client Details</h3>
            {selectedClient ? (
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300 w-full">
                <div><span className="text-gray-500">IP:</span> <span className="font-mono">{selectedClient.source_ip}</span></div>
                <div><span className="text-gray-500">Status:</span> {selectedClient.online ? 'online' : 'offline'}</div>
                <div><span className="text-gray-500">Last seen:</span> {formatDateTime(selectedClient.last_seen)}</div>
                <div><span className="text-gray-500">Connections:</span> {selectedClient.active_connections}</div>
                <div><span className="text-gray-500">Duration:</span> {formatDuration(selectedClient.duration_seconds)}</div>
                <div><span className="text-gray-500">Hosts:</span> {selectedClient.host_count}</div>
                <div className="col-span-2"><span className="text-gray-500">Traffic:</span> {formatBytes(selectedClient.upload_bytes + selectedClient.download_bytes)}</div>
                <div className="col-span-2 truncate" title={selectedClient.proxy_chain}>
                  <span className="text-gray-500">Chain:</span> {selectedClient.proxy_chain || 'direct'}
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-500">Select a client on the left</div>
            )}
          </CardHeader>
          <CardBody>
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="py-2 pr-3">Host</th>
                    <th className="py-2 pr-3">Client</th>
                    <th className="py-2 pr-3">Conn</th>
                    <th className="py-2">Traffic</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedResources.slice(0, 30).map((resource) => (
                    <tr key={`${resource.source_ip}-${resource.host}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2 pr-3 truncate max-w-[180px]" title={resource.host}>{resource.host}</td>
                      <td className="py-2 pr-3 font-mono">{resource.source_ip}</td>
                      <td className="py-2 pr-3">{resource.active_connections}</td>
                      <td className="py-2">{formatBytes(resource.upload_bytes + resource.download_bytes)}</td>
                    </tr>
                  ))}
                  {selectedResources.length === 0 && (
                    <tr>
                      <td className="py-3 text-gray-500" colSpan={4}>
                        {selectedClient ? 'No resources in current snapshot' : 'Select a client to see resource details'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
