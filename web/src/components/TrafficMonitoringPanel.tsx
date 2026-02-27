import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, CardHeader, Chip, Spinner } from '@nextui-org/react';
import { ChevronDown, ChevronRight, Clock, Users, Database } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { monitoringApi } from '../api';

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

  const clientsMap = new Map<string, ClientAcc>();
  const resourcesMap = new Map<string, MonitoringResource>();

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
    const existing = merged.get(item.source_ip);
    // Use live connection/status data but preserve cumulative traffic from API
    // because API values track traffic from closed connections while WebSocket
    // only sees currently active connections.
    const keepApiTraffic = existing &&
      (existing.upload_bytes + existing.download_bytes) > (item.upload_bytes + item.download_bytes);
    merged.set(item.source_ip, {
      ...item,
      upload_bytes: keepApiTraffic ? existing!.upload_bytes : item.upload_bytes,
      download_bytes: keepApiTraffic ? existing!.download_bytes : item.download_bytes,
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
  const [lifetime, setLifetime] = useState<MonitoringLifetimeStats>(defaultLifetime);
  const [activeClients, setActiveClients] = useState<MonitoringClient[]>([]);
  const [recentClients, setRecentClients] = useState<MonitoringClient[]>([]);
  const [resources, setResources] = useState<MonitoringResource[]>([]);
  const [expandedClientIP, setExpandedClientIP] = useState<string>('');
  const [connectionsConnected, setConnectionsConnected] = useState(false);

  // Resource cache: keep last known resources per client IP so they don't disappear
  const resourceCacheRef = useRef(new Map<string, MonitoringResource[]>());

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
      const [lifetimeRes, recentClientsRes, resourcesRes] = await Promise.all([
        monitoringApi.getLifetime(),
        monitoringApi.getRecentClients(400, 24),
        monitoringApi.getResources(300),
      ]);

      setLifetime({ ...defaultLifetime, ...(lifetimeRes.data?.data || {}) });
      setRecentClients(recentClientsRes.data?.data || []);
      const initialResources: MonitoringResource[] = resourcesRes.data?.data || [];
      setResources(initialResources);
      // Seed resource cache from initial data
      const cache = resourceCacheRef.current;
      for (const r of initialResources) {
        const existing = cache.get(r.source_ip) || [];
        existing.push(r);
        cache.set(r.source_ip, existing);
      }
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

  // Connections WS — needed for live client data
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

          // Update resource cache for all live clients
          const cache = resourceCacheRef.current;
          const liveIPs = new Set(liveClients.map((c) => c.source_ip));
          for (const ip of liveIPs) {
            cache.set(ip, liveResources.filter((r) => r.source_ip === ip));
          }

          setRecentClients((prev) => mergeClients(prev, liveClients, ts));
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

  const clients = useMemo(
    () => mergeClients(recentClients, activeClients, new Date().toISOString()),
    [recentClients, activeClients],
  );

  // Fetch resources for offline expanded client from API, then cache
  useEffect(() => {
    if (!expandedClientIP) return;
    const client = clients.find((c) => c.source_ip === expandedClientIP);
    if (!client || client.online) return;
    // Already have cached data
    if (resourceCacheRef.current.has(expandedClientIP)) return;

    let cancelled = false;
    monitoringApi
      .getResources(300, expandedClientIP)
      .then((res) => {
        if (cancelled) return;
        const data = res.data?.data || [];
        resourceCacheRef.current.set(expandedClientIP, data);
        // Force re-render
        setResources((prev) => [...prev]);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to fetch client resources:', error);
      });

    return () => { cancelled = true; };
  }, [expandedClientIP, clients]);

  const getClientResources = useCallback((ip: string, online?: boolean): MonitoringResource[] => {
    if (online) {
      const live = resources.filter((r) => r.source_ip === ip);
      if (live.length > 0) return live;
    }
    return resourceCacheRef.current.get(ip) || [];
  }, [resources]);

  const toggleExpanded = useCallback((ip: string) => {
    setExpandedClientIP((prev) => (prev === ip ? '' : ip));
  }, []);

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
        <Chip size="sm" variant="flat" color={connectionsConnected ? 'success' : 'warning'}>
          connections: {connectionsConnected ? 'live' : 'offline'}
        </Chip>
      </div>

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

      {/* Clients table with split-view */}
      <Card className="shadow-sm">
        <CardHeader className="pb-0">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-gray-500" />
            <h3 className="font-semibold">Clients</h3>
            <span className="text-xs text-gray-400">({clients.length})</span>
          </div>
        </CardHeader>
        <CardBody>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900">
                <tr>
                  <th className="py-2 pr-2 w-6"></th>
                  <th className="py-2 pr-3">IP</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 hidden sm:table-cell">Last Seen</th>
                  <th className="py-2 pr-3">Conn</th>
                  <th className="py-2 pr-3">Traffic</th>
                  <th className="py-2 pr-3 hidden md:table-cell">Duration</th>
                  <th className="py-2 hidden lg:table-cell">Top Host</th>
                </tr>
              </thead>
              <tbody>
                {clients.slice(0, 50).map((client) => {
                  const isExpanded = client.source_ip === expandedClientIP;
                  const clientResources = isExpanded ? getClientResources(client.source_ip, client.online) : [];

                  return (
                    <ClientRow
                      key={client.source_ip}
                      client={client}
                      isExpanded={isExpanded}
                      clientResources={clientResources}
                      onToggle={toggleExpanded}
                    />
                  );
                })}
                {clients.length === 0 && (
                  <tr>
                    <td className="py-6 text-center text-gray-500" colSpan={8}>No clients in recent history</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

interface ClientHistoryPoint {
  timestamp: string;
  upload_bytes: number;
  download_bytes: number;
  active_connections: number;
}

function ClientRow({
  client,
  isExpanded,
  clientResources,
  onToggle,
}: {
  client: MonitoringClient;
  isExpanded: boolean;
  clientResources: MonitoringResource[];
  onToggle: (ip: string) => void;
}) {
  const [historyData, setHistoryData] = useState<ClientHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const fetchedRef = useRef<string>('');

  useEffect(() => {
    if (!isExpanded) return;
    if (fetchedRef.current === client.source_ip) return;

    let cancelled = false;
    setHistoryLoading(true);
    monitoringApi
      .getClientHistory(client.source_ip, 500)
      .then((res) => {
        if (cancelled) return;
        setHistoryData(res.data?.data || []);
        fetchedRef.current = client.source_ip;
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to fetch client history:', err);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => { cancelled = true; };
  }, [isExpanded, client.source_ip]);

  const miniChartData = useMemo(() => {
    if (historyData.length < 2) return [];

    return historyData.map((point, idx) => {
      // Compute deltas between consecutive snapshots to show traffic rate
      const prev = idx > 0 ? historyData[idx - 1] : point;
      const uploadDelta = point.upload_bytes >= prev.upload_bytes
        ? point.upload_bytes - prev.upload_bytes
        : point.upload_bytes;
      const downloadDelta = point.download_bytes >= prev.download_bytes
        ? point.download_bytes - prev.download_bytes
        : point.download_bytes;

      return {
        time: new Date(point.timestamp).toLocaleTimeString([], { hour12: false }),
        upload: uploadDelta / 1024,
        download: downloadDelta / 1024,
        connections: point.active_connections,
      };
    });
  }, [historyData]);

  return (
    <>
      <tr
        className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors ${
          isExpanded
            ? 'bg-primary-50 dark:bg-primary-900/20'
            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
        onClick={() => onToggle(client.source_ip)}
      >
        <td className="py-2 pr-2 text-gray-400">
          {isExpanded
            ? <ChevronDown className="w-4 h-4" />
            : <ChevronRight className="w-4 h-4" />
          }
        </td>
        <td className="py-2 pr-3 font-mono text-xs">{client.source_ip}</td>
        <td className="py-2 pr-3">
          <Chip size="sm" variant="flat" color={client.online ? 'success' : 'default'}>
            {client.online ? 'online' : 'offline'}
          </Chip>
        </td>
        <td className="py-2 pr-3 hidden sm:table-cell text-xs">{formatDateTime(client.last_seen)}</td>
        <td className="py-2 pr-3">{client.active_connections}</td>
        <td className="py-2 pr-3">{formatBytes(client.upload_bytes + client.download_bytes)}</td>
        <td className="py-2 pr-3 hidden md:table-cell">{formatDuration(client.duration_seconds)}</td>
        <td className="py-2 truncate max-w-[200px] hidden lg:table-cell" title={client.top_host || '-'}>
          {client.top_host || '-'}
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-gray-50 dark:bg-gray-800/30">
          <td colSpan={8} className="p-0">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              {/* Client detail summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 text-xs">
                <div className="bg-white dark:bg-gray-800 rounded-lg p-2">
                  <span className="text-gray-400 block">Upload</span>
                  <span className="font-semibold">{formatBytes(client.upload_bytes)}</span>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-2">
                  <span className="text-gray-400 block">Download</span>
                  <span className="font-semibold">{formatBytes(client.download_bytes)}</span>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-2">
                  <span className="text-gray-400 block">Hosts</span>
                  <span className="font-semibold">{client.host_count}</span>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-2">
                  <span className="text-gray-400 block">Chain</span>
                  <span className="font-semibold truncate block" title={client.proxy_chain}>{client.proxy_chain || 'direct'}</span>
                </div>
              </div>

              {/* Client traffic history chart */}
              {historyLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Spinner size="sm" />
                </div>
              ) : miniChartData.length > 2 ? (
                <div className="mb-3">
                  <p className="text-xs text-gray-500 mb-1">Traffic history (delta per sample)</p>
                  <div className="h-36 w-full bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={miniChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" minTickGap={40} tick={{ fontSize: 10 }} />
                        <YAxis tickFormatter={(v) => `${Math.round(v)} KB`} tick={{ fontSize: 10 }} width={50} />
                        <Tooltip
                          formatter={(value, name) => {
                            const numeric = Number(value);
                            if (name === 'connections') return [numeric, 'Connections'];
                            return [formatBytes(numeric * 1024), name === 'upload' ? 'Upload' : 'Download'];
                          }}
                          labelFormatter={(label) => `Time: ${label}`}
                        />
                        <Area type="monotone" dataKey="upload" stroke="#16a34a" fill="#16a34a22" strokeWidth={1.5} />
                        <Area type="monotone" dataKey="download" stroke="#2563eb" fill="#2563eb22" strokeWidth={1.5} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : null}

              {/* Resources table */}
              {clientResources.length > 0 ? (
                <div className="max-h-60 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  <table className="w-full text-xs">
                    <thead className="text-left text-gray-500 bg-gray-100 dark:bg-gray-800 sticky top-0">
                      <tr>
                        <th className="py-1.5 px-3">Host</th>
                        <th className="py-1.5 px-3">Conn</th>
                        <th className="py-1.5 px-3">Upload</th>
                        <th className="py-1.5 px-3">Download</th>
                        <th className="py-1.5 px-3 hidden sm:table-cell">Chain</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientResources.slice(0, 30).map((resource) => (
                        <tr
                          key={`${resource.source_ip}-${resource.host}`}
                          className="border-t border-gray-100 dark:border-gray-700/50"
                        >
                          <td className="py-1.5 px-3 truncate max-w-[250px]" title={resource.host}>
                            {resource.host}
                          </td>
                          <td className="py-1.5 px-3">{resource.active_connections}</td>
                          <td className="py-1.5 px-3">{formatBytes(resource.upload_bytes)}</td>
                          <td className="py-1.5 px-3">{formatBytes(resource.download_bytes)}</td>
                          <td className="py-1.5 px-3 truncate max-w-[150px] hidden sm:table-cell" title={resource.proxy_chain}>
                            {resource.proxy_chain}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-gray-400 py-2">No resource data available</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
