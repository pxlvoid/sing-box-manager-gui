import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardBody, CardHeader, Chip, Spinner } from '@nextui-org/react';
import { Activity, ArrowDownToLine, ArrowUpToLine, Network, Users } from 'lucide-react';
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
  if (next.length <= 120) return next;
  return next.slice(next.length - 120);
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
        monitoringApi.getHistory(120),
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

  const chartData = useMemo(() => {
    let emaUp = 0;
    let emaDown = 0;

    return history.map((point, idx) => {
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
  }, [history]);

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

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Network className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Traffic Monitoring</h2>
        </div>
        <div className="flex items-center gap-2">
          <Chip size="sm" variant="flat" color={trafficConnected ? 'success' : 'warning'}>
            traffic: {trafficConnected ? 'live' : 'offline'}
          </Chip>
          <Chip size="sm" variant="flat" color={connectionsConnected ? 'success' : 'warning'}>
            connections: {connectionsConnected ? 'live' : 'offline'}
          </Chip>
        </div>
      </CardHeader>
      <CardBody className="space-y-6">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Card className="bg-green-50 dark:bg-green-900/20 shadow-none">
                <CardBody className="py-3">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <ArrowUpToLine className="w-4 h-4 text-green-600 dark:text-green-300" />
                    Upload
                  </div>
                  <p className="text-xl font-semibold">{formatRate(overview.up_bps)}</p>
                </CardBody>
              </Card>
              <Card className="bg-blue-50 dark:bg-blue-900/20 shadow-none">
                <CardBody className="py-3">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <ArrowDownToLine className="w-4 h-4 text-blue-600 dark:text-blue-300" />
                    Download
                  </div>
                  <p className="text-xl font-semibold">{formatRate(overview.down_bps)}</p>
                </CardBody>
              </Card>
              <Card className="bg-orange-50 dark:bg-orange-900/20 shadow-none">
                <CardBody className="py-3">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Activity className="w-4 h-4 text-orange-600 dark:text-orange-300" />
                    Active Connections
                  </div>
                  <p className="text-xl font-semibold">{overview.active_connections}</p>
                </CardBody>
              </Card>
              <Card className="bg-purple-50 dark:bg-purple-900/20 shadow-none">
                <CardBody className="py-3">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Users className="w-4 h-4 text-purple-600 dark:text-purple-300" />
                    Active Clients
                  </div>
                  <p className="text-xl font-semibold">{overview.client_count}</p>
                </CardBody>
              </Card>
            </div>

            <Card className="shadow-none border border-gray-200 dark:border-gray-700">
              <CardHeader>
                <h3 className="font-semibold">System Totals (all time)</h3>
              </CardHeader>
              <CardBody className="pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Clients seen</p>
                    <p className="font-semibold">{lifetime.total_clients}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total upload</p>
                    <p className="font-semibold">{formatBytes(lifetime.total_upload_bytes)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total download</p>
                    <p className="font-semibold">{formatBytes(lifetime.total_download_bytes)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total traffic</p>
                    <p className="font-semibold">{formatBytes(lifetime.total_traffic_bytes)}</p>
                  </div>
                </div>
                <div className="mt-3 text-xs text-gray-500">
                  Window: {formatDateTime(lifetime.first_sample_at)} → {formatDateTime(lifetime.last_sample_at)} · samples: {lifetime.sample_count}
                </div>
              </CardBody>
            </Card>

            <div className="h-72 w-full rounded-lg border border-gray-200 dark:border-gray-700 p-3">
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

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <Card className="shadow-none border border-gray-200 dark:border-gray-700">
                <CardHeader>
                  <h3 className="font-semibold">Clients (active + recently disconnected)</h3>
                </CardHeader>
                <CardBody className="pt-0">
                  <div className="max-h-72 overflow-auto">
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
                              className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer ${isSelected ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}
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

              <Card className="shadow-none border border-gray-200 dark:border-gray-700">
                <CardHeader className="flex flex-col gap-2">
                  <h3 className="font-semibold">Client Details</h3>
                  {selectedClient ? (
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
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
                <CardBody className="pt-0">
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

            <div className="text-xs text-gray-500 dark:text-gray-400">
              Totals: upload {formatBytes(overview.upload_total)} · download {formatBytes(overview.download_total)}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
