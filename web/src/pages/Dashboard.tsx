import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, CardHeader, Button, ButtonGroup, Chip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tooltip, Spinner, Progress } from '@nextui-org/react';
import { Play, Square, RefreshCw, Cpu, HardDrive, Wifi, Activity, Copy, ClipboardCheck, Link, QrCode, Stethoscope, ShieldCheck, Network, ArrowUp, ArrowDown, Users, Cable, ChevronDown, ChevronRight } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { timeSecond, timeMinute } from 'd3-time';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { nodeDisplayTag, nodeInternalTag, nodeSourceTag } from '../store';
import type { NodeSiteCheckResult } from '../store';
import { shortSiteLabel } from '../features/nodes/types';
import { serviceApi, configApi, monitoringApi } from '../api';
import ActiveProxyBlock from '../components/ActiveProxyBlock';
import { toast } from '../components/Toast';

interface WSTrafficPayload {
  up?: number | string;
  down?: number | string;
  error?: unknown;
}

interface WSConnectionsPayload {
  connections?: Array<{ metadata?: { sourceIP?: string } }>;
  error?: unknown;
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

const defaultMonitoringLifetime: MonitoringLifetimeStats = {
  sample_count: 0,
  total_clients: 0,
  total_upload_bytes: 0,
  total_download_bytes: 0,
  total_traffic_bytes: 0,
};

interface TrafficHistoryPoint {
  timestamp: string;
  up_bps: number;
  down_bps: number;
  active_connections: number;
  client_count: number;
}

const CHART_PERIODS = [
  { key: '1m', label: '1 мин', seconds: 60, throttleMs: 1000 },
  { key: '5m', label: '5 мин', seconds: 300, throttleMs: 3000 },
  { key: '15m', label: '15 мин', seconds: 900, throttleMs: 8000 },
  { key: '1h', label: '1 час', seconds: 3600, throttleMs: 20000 },
] as const;

const MAX_HISTORY_POINTS = 3600;
const CHART_EMA_ALPHA = 0.28;

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

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    serviceStatus, probeStatus, subscriptions, nodeCounts, systemInfo, settings, proxyGroups,
    pendingNodes, verifiedNodes, archivedNodes, countryGroups,
    verificationStatus, verificationRunning,
    healthResults, siteCheckResults,
    geoData, fetchGeoData,
    pipelineEvents, verificationProgress, runCounters,
    fetchServiceStatus, fetchProbeStatus, stopProbe, fetchSubscriptions,
    fetchNodeCounts, fetchSystemInfo, fetchSettings, fetchUnsupportedNodes, fetchNodes, fetchCountryGroups,
    fetchProxyGroups, switchProxy, runVerification, runVerificationForTags, fetchVerificationStatus,
    startVerificationScheduler, stopVerificationScheduler,
    fetchLatestMeasurements, fetchPipelineEvents,
  } = useStore();

  const activityFeedRef = useRef<HTMLDivElement>(null);

  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [qrLink, setQrLink] = useState<string | null>(null);
  const [proxyLinksOpen, setProxyLinksOpen] = useState(false);
  const [proxySearch, setProxySearch] = useState('');
  const [trafficOverview, setTrafficOverview] = useState({
    up_bps: 0,
    down_bps: 0,
    active_connections: 0,
    client_count: 0,
  });
  const [trafficLifetime, setTrafficLifetime] = useState<MonitoringLifetimeStats>(defaultMonitoringLifetime);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<string>('5m');
  const historyRef = useRef<TrafficHistoryPoint[]>([]);
  const [displayHistory, setDisplayHistory] = useState<TrafficHistoryPoint[]>([]);
  const lastChartFlushRef = useRef(0);

  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: '',
    message: ''
  });

  const showError = (title: string, error: any) => {
    const message = error.response?.data?.error || error.message || 'Operation failed';
    setErrorModal({ isOpen: true, title, message });
  };

  const fetchTrafficOverview = async () => {
    try {
      const res = await monitoringApi.getOverview();
      if (res.data?.data) {
        setTrafficOverview({
          up_bps: Number(res.data.data.up_bps || 0),
          down_bps: Number(res.data.data.down_bps || 0),
          active_connections: Number(res.data.data.active_connections || 0),
          client_count: Number(res.data.data.client_count || 0),
        });
      }
    } catch (error) {
      console.error('Failed to fetch traffic overview:', error);
    }
  };

  const fetchTrafficLifetime = async () => {
    try {
      const res = await monitoringApi.getLifetime();
      setTrafficLifetime({ ...defaultMonitoringLifetime, ...(res.data?.data || {}) });
    } catch (error) {
      console.error('Failed to fetch traffic lifetime stats:', error);
    }
  };

  const selectedPeriod = useMemo(
    () => CHART_PERIODS.find((p) => p.key === chartPeriod) || CHART_PERIODS[1],
    [chartPeriod],
  );

  // Flush chart display on throttle interval
  useEffect(() => {
    const flush = () => {
      setDisplayHistory([...historyRef.current]);
      lastChartFlushRef.current = Date.now();
    };
    flush();
    const timer = window.setInterval(flush, selectedPeriod.throttleMs);
    return () => window.clearInterval(timer);
  }, [selectedPeriod]);

  const appendHistory = useCallback((point: TrafficHistoryPoint) => {
    const buf = historyRef.current;
    buf.push(point);
    if (buf.length > MAX_HISTORY_POINTS) {
      historyRef.current = buf.slice(buf.length - MAX_HISTORY_POINTS);
    }
    if (Date.now() - lastChartFlushRef.current >= CHART_PERIODS[0].throttleMs) {
      setDisplayHistory([...historyRef.current]);
      lastChartFlushRef.current = Date.now();
    }
  }, []);

  const chartData = useMemo(() => {
    const now = Date.now();
    const cutoff = now - selectedPeriod.seconds * 1000;
    const filtered = displayHistory.filter((p) => {
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
        epoch: Date.parse(point.timestamp),
        up_kbps: emaUp / 1024,
        down_kbps: emaDown / 1024,
      };
    });
  }, [displayHistory, selectedPeriod]);

  const chartXTicks = useMemo(() => {
    if (chartData.length < 2) return [];
    const start = chartData[0].epoch;
    const end = chartData[chartData.length - 1].epoch;
    const interval = selectedPeriod.seconds <= 60
      ? timeSecond.every(10)
      : selectedPeriod.seconds <= 300
        ? timeMinute.every(1)
        : selectedPeriod.seconds <= 900
          ? timeMinute.every(3)
          : timeMinute.every(10);
    if (!interval) return [];
    return interval.range(new Date(start), new Date(end)).map((d) => d.getTime());
  }, [chartData, selectedPeriod]);

  // Auto-scroll activity feed
  useEffect(() => {
    if (activityFeedRef.current) {
      activityFeedRef.current.scrollTop = activityFeedRef.current.scrollHeight;
    }
  }, [pipelineEvents]);

  useEffect(() => {
    fetchServiceStatus();
    fetchProbeStatus();
    fetchSubscriptions();
    fetchNodeCounts();
    fetchNodes();
    fetchCountryGroups();
    fetchSystemInfo();
    fetchSettings();
    fetchProxyGroups();
    fetchVerificationStatus();
    fetchLatestMeasurements();
    fetchPipelineEvents();
    fetchGeoData();
    fetchTrafficOverview();
    fetchTrafficLifetime();
    // Load initial chart history
    monitoringApi.getHistory(MAX_HISTORY_POINTS).then((res) => {
      const initial: TrafficHistoryPoint[] = res.data?.data || [];
      historyRef.current = initial;
      setDisplayHistory(initial);
    }).catch((err) => console.error('Failed to fetch chart history:', err));

    const interval = setInterval(() => {
      fetchServiceStatus();
      fetchProbeStatus();
      fetchSystemInfo();
      fetchProxyGroups();
      fetchTrafficOverview();
      fetchTrafficLifetime();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimer: number | null = null;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(toWebSocketURL('/api/monitoring/ws/traffic'));
      ws.onclose = () => {
        if (!closed) {
          retryTimer = window.setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WSTrafficPayload;
          if (!data || typeof data !== 'object' || 'error' in data) return;
          if (!('up' in data) || !('down' in data)) return;

          const up = toNumber(data.up);
          const down = toNumber(data.down);
          const ts = new Date().toISOString();
          setTrafficOverview((prev) => {
            appendHistory({
              timestamp: ts,
              up_bps: up,
              down_bps: down,
              active_connections: prev.active_connections,
              client_count: prev.client_count,
            });
            return { ...prev, up_bps: up, down_bps: down };
          });
        } catch (error) {
          console.error('Failed to parse dashboard traffic websocket payload:', error);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, [appendHistory]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimer: number | null = null;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(toWebSocketURL('/api/monitoring/ws/connections?interval=1000'));
      ws.onclose = () => {
        if (!closed) {
          retryTimer = window.setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WSConnectionsPayload;
          if (!data || typeof data !== 'object' || 'error' in data) return;

          const connections = Array.isArray(data.connections) ? data.connections : [];
          const clients = new Set<string>();
          for (const conn of connections) {
            const sourceIP = conn?.metadata?.sourceIP?.trim();
            clients.add(sourceIP || 'unknown');
          }

          setTrafficOverview((prev) => ({
            ...prev,
            active_connections: connections.length,
            client_count: clients.size,
          }));
        } catch (error) {
          console.error('Failed to parse dashboard connections websocket payload:', error);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);

  const handleStart = async () => {
    try {
      await serviceApi.start();
      await fetchServiceStatus();
      toast.success('Service started');
    } catch (error) {
      showError('Failed to start', error);
    }
  };

  const handleStop = async () => {
    try {
      await serviceApi.stop();
      await fetchServiceStatus();
      toast.success('Service stopped');
    } catch (error) {
      showError('Failed to stop', error);
    }
  };

  const handleRestart = async () => {
    try {
      await serviceApi.restart();
      await fetchServiceStatus();
      toast.success('Service restarted');
    } catch (error) {
      showError('Failed to restart', error);
    }
  };

  const handleApplyConfig = async () => {
    try {
      const res = await configApi.apply();
      await fetchServiceStatus();
      await fetchUnsupportedNodes();
      if (res.data.warning) {
        toast.info(res.data.warning);
      } else {
        toast.success('Configuration applied');
      }
    } catch (error) {
      showError('Failed to apply configuration', error);
    }
  };

  const handleCopyLink = async (key: string, link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(key);
      setTimeout(() => setCopiedLink(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const proxyLinks: { key: string; label: string; link: string }[] = [];
  if (settings) {
    if (settings.mixed_port > 0 && settings.mixed_address) {
      proxyLinks.push({
        key: 'mixed-socks',
        label: 'Mixed SOCKS5',
        link: `socks5://${settings.mixed_address}:${settings.mixed_port}`,
      });
      proxyLinks.push({
        key: 'mixed-http',
        label: 'Mixed HTTP',
        link: `http://${settings.mixed_address}:${settings.mixed_port}`,
      });
    }
    if (settings.socks_port > 0 && settings.socks_address) {
      const auth = settings.socks_auth && settings.socks_username
        ? `${settings.socks_username}:${settings.socks_password}@`
        : '';
      proxyLinks.push({
        key: 'socks',
        label: 'SOCKS5',
        link: `socks5://${auth}${settings.socks_address}:${settings.socks_port}`,
      });
    }
    if (settings.http_port > 0 && settings.http_address) {
      const auth = settings.http_auth && settings.http_username
        ? `${settings.http_username}:${settings.http_password}@`
        : '';
      proxyLinks.push({
        key: 'http',
        label: 'HTTP',
        link: `http://${auth}${settings.http_address}:${settings.http_port}`,
      });
    }
    if (settings.shadowsocks_port > 0 && settings.shadowsocks_address && settings.shadowsocks_password) {
      const encoded = btoa(`${settings.shadowsocks_method}:${settings.shadowsocks_password}`);
      proxyLinks.push({
        key: 'ss',
        label: 'Shadowsocks',
        link: `ss://${encoded}@${settings.shadowsocks_address}:${settings.shadowsocks_port}#SBM`,
      });
    }
  }

  const totalNodes = nodeCounts.pending + nodeCounts.verified;
  const enabledSubs = subscriptions.filter(sub => sub.enabled).length;

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };
  const formatTimeUntil = (dateStr: string) => {
    const diff = Math.round((new Date(dateStr).getTime() - Date.now()) / 60000);
    if (diff <= 0) return 'now';
    if (diff < 60) return `in ${diff}min`;
    return `in ${Math.floor(diff / 60)}h ${diff % 60}m`;
  };

  const formatTimeShort = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const mainProxyGroup = proxyGroups.find((group) => group.name.toLowerCase() === 'proxy');
  const allKnownNodes = useMemo(
    () => [...verifiedNodes, ...pendingNodes, ...archivedNodes],
    [verifiedNodes, pendingNodes, archivedNodes],
  );
  const knownNodesByTag = useMemo(() => {
    const map = new Map<string, (typeof allKnownNodes)[number]>();
    for (const node of allKnownNodes) {
      for (const alias of [nodeInternalTag(node), nodeDisplayTag(node), nodeSourceTag(node), node.tag]) {
        const key = alias.trim();
        if (!key || map.has(key)) continue;
        map.set(key, node);
      }
    }
    return map;
  }, [allKnownNodes]);
  const countryGroupTags = useMemo(
    () => new Set(countryGroups.map((country) => `${country.emoji} ${country.name}`)),
    [countryGroups],
  );
  const proxyGroupsByName = useMemo(
    () => new Map(proxyGroups.map((group) => [group.name, group])),
    [proxyGroups],
  );
  const selectedMainProxyGroup = useMemo(() => {
    if (!mainProxyGroup?.now) return null;
    return proxyGroupsByName.get(mainProxyGroup.now) || null;
  }, [mainProxyGroup?.now, proxyGroupsByName]);
  const resolvedActiveProxyTag = useMemo(() => {
    if (!mainProxyGroup?.now) return '';
    let current = mainProxyGroup.now;
    const visited = new Set<string>();

    while (current && !visited.has(current)) {
      visited.add(current);
      const group = proxyGroupsByName.get(current);
      if (!group?.now || group.now === current) break;
      current = group.now;
    }
    return current;
  }, [mainProxyGroup?.now, proxyGroupsByName]);
  const isAutoMode = (selectedMainProxyGroup?.type || '').toLowerCase() === 'urltest'
    || (mainProxyGroup?.now || '').toLowerCase() === 'auto';
  const activeProxyRefreshing = verificationRunning;
  const qrImageUrl = qrLink ? `https://quickchart.io/qr?text=${encodeURIComponent(qrLink)}&size=260` : '';

  const getProxyDisplayTag = (tag: string): string => {
    const node = knownNodesByTag.get(tag);
    return node ? nodeDisplayTag(node) : tag;
  };

  const getProxySourceTag = (tag: string): string => {
    const node = knownNodesByTag.get(tag);
    return node ? nodeSourceTag(node) : '';
  };

  const getServerPortLabel = (tag: string): string => {
    const node = knownNodesByTag.get(tag);
    return node ? `${node.server}:${node.server_port}` : '';
  };

  const countryCodeToEmoji = (code: string): string => {
    const upper = code.toUpperCase();
    if (upper.length !== 2) return '';
    return String.fromCodePoint(0x1F1E6 + upper.charCodeAt(0) - 65, 0x1F1E6 + upper.charCodeAt(1) - 65);
  };

  const getGeoLabel = (tag: string): { emoji: string; country: string } | null => {
    const spLabel = getServerPortLabel(tag);
    if (!spLabel) return null;
    const geo = geoData[spLabel];
    if (!geo || geo.status !== 'success' || !geo.country_code) return null;
    return { emoji: countryCodeToEmoji(geo.country_code), country: `${geo.country} (${geo.country_code})` };
  };

  const getLatestMeasuredDelay = (tag: string): number | null => {
    const node = knownNodesByTag.get(tag);
    const serverPortKey = node ? `${node.server}:${node.server_port}` : '';
    const health = healthResults[tag] || (serverPortKey ? healthResults[serverPortKey] : undefined);
    if (!health) return null;

    if (!health.alive || health.tcp_latency_ms <= 0) {
      return 0;
    }
    return health.tcp_latency_ms;
  };

  const formatDelayLabel = (delay: number | null): string => {
    if (delay === null) return '-';
    if (delay <= 0) return 'fail';
    return `${delay}ms`;
  };

  const delayChipColor = (delay: number | null): 'default' | 'success' | 'warning' | 'danger' => {
    if (delay === null) return 'default';
    if (delay <= 0) return 'danger';
    if (delay < 300) return 'success';
    if (delay < 800) return 'warning';
    return 'danger';
  };

  const getSiteCheckSummary = (tag: string): { avg: number; count: number; failed: number; details: { label: string; delay: number; errorType?: string }[] } | null => {
    const serverPortLabel = getServerPortLabel(tag);
    const siteResult: NodeSiteCheckResult | undefined = siteCheckResults[tag] || (serverPortLabel ? siteCheckResults[serverPortLabel] : undefined);
    if (!siteResult || !siteResult.sites) return null;
    const entries = Object.entries(siteResult.sites);
    if (entries.length === 0) return null;
    const details = entries.map(([site, delay]) => ({ label: shortSiteLabel(site), delay, errorType: siteResult.errors?.[site] || '' }));
    const alive = details.filter((d) => d.delay > 0);
    const failed = details.filter((d) => d.delay <= 0).length;
    const avg = alive.length > 0 ? Math.round(alive.reduce((sum, d) => sum + d.delay, 0) / alive.length) : 0;
    return { avg, count: details.length, failed, details };
  };

  const siteChipColor = (summary: { avg: number; failed: number }): 'success' | 'warning' | 'danger' => {
    if (summary.failed > 0) return 'danger';
    if (summary.avg >= 800) return 'warning';
    return 'success';
  };

  const selectableMainProxyOptions = useMemo(() => {
    if (!mainProxyGroup) return [];
    return mainProxyGroup.all.filter((item) => !countryGroupTags.has(item) || item === mainProxyGroup.now);
  }, [mainProxyGroup, countryGroupTags]);

  const normalizedProxySearch = proxySearch.trim().toLowerCase();
  const matchesProxySearch = (item: string): boolean => {
    if (!normalizedProxySearch) return true;
    const display = getProxyDisplayTag(item).toLowerCase();
    const source = getProxySourceTag(item).toLowerCase();
    return item.toLowerCase().includes(normalizedProxySearch)
      || display.includes(normalizedProxySearch)
      || source.includes(normalizedProxySearch);
  };
  const hasSearchMatches = !normalizedProxySearch || selectableMainProxyOptions.some(matchesProxySearch);
  const filteredMainProxyOptions = useMemo(() => {
    if (!mainProxyGroup) return [];
    const matchedOptions = normalizedProxySearch
      ? selectableMainProxyOptions.filter(matchesProxySearch)
      : selectableMainProxyOptions;

    if (mainProxyGroup.now && !matchedOptions.includes(mainProxyGroup.now)) {
      return [mainProxyGroup.now, ...matchedOptions];
    }
    return matchedOptions;
  }, [mainProxyGroup, normalizedProxySearch, selectableMainProxyOptions, knownNodesByTag]);

  const handleRefreshActiveProxy = async () => {
    const activeTag = resolvedActiveProxyTag;
    if (!activeTag) {
      toast.error('Active proxy is not resolved yet');
      return;
    }
    if (activeProxyRefreshing) return;

    await runVerificationForTags([activeTag]);
  };

  const formatRate = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) return '0 B/s';
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let v = value;
    let idx = 0;
    while (v >= 1024 && idx < units.length - 1) {
      v /= 1024;
      idx += 1;
    }
    return `${v.toFixed(v >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
  };

  const formatBytes = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = value;
    let idx = 0;
    while (v >= 1024 && idx < units.length - 1) {
      v /= 1024;
      idx += 1;
    }
    return `${v.toFixed(v >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Dashboard</h1>
        <Button size="sm" color="primary" variant="flat" startContent={<Users className="w-4 h-4" />} onPress={() => navigate('/clients')}>
          Clients
        </Button>
      </div>

      {/* Traffic monitoring cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card>
          <CardBody className="flex flex-row items-center gap-3 p-3 sm:p-4">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900 rounded-lg">
              <ArrowUp className="w-5 h-5 text-emerald-600 dark:text-emerald-300" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Upload</p>
              <p className="text-lg font-bold">{formatRate(trafficOverview.up_bps)}</p>
              <p className="text-xs text-gray-400">{formatBytes(trafficLifetime.total_upload_bytes)} total</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-row items-center gap-3 p-3 sm:p-4">
            <div className="p-2 bg-sky-100 dark:bg-sky-900 rounded-lg">
              <ArrowDown className="w-5 h-5 text-sky-600 dark:text-sky-300" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Download</p>
              <p className="text-lg font-bold">{formatRate(trafficOverview.down_bps)}</p>
              <p className="text-xs text-gray-400">{formatBytes(trafficLifetime.total_download_bytes)} total</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-row items-center gap-3 p-3 sm:p-4">
            <div className="p-2 bg-violet-100 dark:bg-violet-900 rounded-lg">
              <Cable className="w-5 h-5 text-violet-600 dark:text-violet-300" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Connections</p>
              <p className="text-lg font-bold">{trafficOverview.active_connections}</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-row items-center gap-3 p-3 sm:p-4">
            <div className="p-2 bg-amber-100 dark:bg-amber-900 rounded-lg">
              <Users className="w-5 h-5 text-amber-600 dark:text-amber-300" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Clients</p>
              <p className="text-lg font-bold">{trafficOverview.client_count}</p>
              <p className="text-xs text-gray-400">{trafficLifetime.total_clients} seen total</p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Traffic chart (collapsible) */}
      <Card>
        <CardHeader
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 cursor-pointer select-none"
          onClick={() => setChartExpanded((prev) => !prev)}
        >
          <div className="flex items-center gap-2">
            {chartExpanded
              ? <ChevronDown className="w-4 h-4 text-gray-400" />
              : <ChevronRight className="w-4 h-4 text-gray-400" />
            }
            <Network className="w-5 h-5 text-gray-500" />
            <h3 className="font-semibold">Traffic</h3>
          </div>
          {chartExpanded && (
            <ButtonGroup size="sm" variant="flat" onClick={(e) => e.stopPropagation()}>
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
          )}
        </CardHeader>
        {chartExpanded && (
          <CardBody className="pt-0">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="epoch"
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    ticks={chartXTicks}
                    tickFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: selectedPeriod.seconds <= 60 ? '2-digit' : undefined, hour12: false })}
                    minTickGap={24}
                  />
                  <YAxis tickFormatter={(value) => `${Math.round(value)} KB/s`} />
                  <RechartsTooltip
                    formatter={(value, name) => {
                      const raw = Array.isArray(value) ? value[0] : value;
                      const numeric = Number(raw);
                      const bytesPerSecond = Number.isFinite(numeric) ? numeric * 1024 : 0;
                      return [formatRate(Math.round(bytesPerSecond)), name === 'up_kbps' ? 'Upload' : 'Download'];
                    }}
                    labelFormatter={(ts) => `Time: ${new Date(Number(ts)).toLocaleTimeString([], { hour12: false })}`}
                  />
                  <Legend formatter={(value) => (value === 'up_kbps' ? 'Upload' : 'Download')} />
                  <Area type="monotone" dataKey="up_kbps" stroke="#16a34a" fill="#16a34a33" strokeWidth={2} isAnimationActive={false} />
                  <Area type="monotone" dataKey="down_kbps" stroke="#2563eb" fill="#2563eb33" strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        )}
      </Card>

      {/* Nodes summary card */}
      <Card>
        <CardBody className="p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                <HardDrive className="w-5 h-5 text-green-600 dark:text-green-300" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Nodes</p>
                <p className="text-xl font-bold">{totalNodes} <span className="text-sm font-normal text-gray-400">total</span></p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <Wifi className="w-4 h-4 text-blue-600 dark:text-blue-300" />
              </div>
              <span className="text-sm text-gray-500">Subscriptions</span>
              <span className="text-sm font-bold">{enabledSubs} / {subscriptions.length}</span>
            </div>
          </div>
          {totalNodes > 0 && (
            <div className="space-y-2">
              <div className="flex w-full h-2.5 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
                {nodeCounts.verified > 0 && (
                  <div
                    className="bg-green-500 h-full"
                    style={{ width: `${(nodeCounts.verified / totalNodes) * 100}%` }}
                  />
                )}
                {nodeCounts.pending > 0 && (
                  <div
                    className="bg-yellow-400 h-full"
                    style={{ width: `${(nodeCounts.pending / totalNodes) * 100}%` }}
                  />
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
                  Verified: <span className="font-semibold text-gray-700 dark:text-gray-200">{nodeCounts.verified}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" />
                  Pending: <span className="font-semibold text-gray-700 dark:text-gray-200">{nodeCounts.pending}</span>
                </span>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* System Resources */}
      <Card>
        <CardBody className="p-4 sm:p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
              <Cpu className="w-5 h-5 text-purple-600 dark:text-purple-300" />
            </div>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">System Resources</p>
          </div>
          <div className="flex flex-col gap-2">
            {/* sbm */}
            <div className="flex items-center gap-3 text-xs px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              <div className="flex items-center gap-2 min-w-[110px]">
                <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                <span className="font-medium text-sm">sbm</span>
              </div>
              {systemInfo?.sbm ? (
                <div className="flex items-center gap-4 flex-wrap text-gray-500 dark:text-gray-400">
                  <span>CPU <span className="font-semibold text-gray-700 dark:text-gray-200">{systemInfo.sbm.cpu_percent.toFixed(1)}%</span></span>
                  <span>Mem <span className="font-semibold text-gray-700 dark:text-gray-200">{systemInfo.sbm.memory_mb.toFixed(1)} MB</span></span>
                  <span>Uptime <span className="font-semibold text-gray-700 dark:text-gray-200">{formatUptime(systemInfo.sbm.uptime_seconds)}</span></span>
                  <span>Threads <span className="font-semibold text-gray-700 dark:text-gray-200">{systemInfo.sbm.num_threads}</span></span>
                  <span className="text-gray-300 dark:text-gray-600">PID {systemInfo.sbm.pid}</span>
                  {serviceStatus?.sbm_version && <span className="text-gray-300 dark:text-gray-600">{serviceStatus.sbm_version}</span>}
                </div>
              ) : (
                <span className="text-gray-400">No data</span>
              )}
            </div>

            {/* sing-box */}
            <div className="flex items-center gap-3 text-xs px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              <div className="flex items-center gap-2 min-w-[110px]">
                <div className={`w-2 h-2 rounded-full shrink-0 ${serviceStatus?.running ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                <span className="font-medium text-sm">sing-box</span>
              </div>
              {serviceStatus?.running && systemInfo?.singbox ? (
                <div className="flex items-center gap-4 flex-wrap text-gray-500 dark:text-gray-400">
                  <span>CPU <span className="font-semibold text-gray-700 dark:text-gray-200">{systemInfo.singbox.cpu_percent.toFixed(1)}%</span></span>
                  <span>Mem <span className="font-semibold text-gray-700 dark:text-gray-200">{systemInfo.singbox.memory_mb.toFixed(1)} MB</span></span>
                  <span>Uptime <span className="font-semibold text-gray-700 dark:text-gray-200">{formatUptime(systemInfo.singbox.uptime_seconds)}</span></span>
                  <span>Threads <span className="font-semibold text-gray-700 dark:text-gray-200">{systemInfo.singbox.num_threads}</span></span>
                  <span className="text-gray-300 dark:text-gray-600">PID {systemInfo.singbox.pid}</span>
                  {serviceStatus?.version && <span className="text-gray-300 dark:text-gray-600">v{serviceStatus.version.match(/version\s+([\d.]+)/)?.[1] || serviceStatus.version}</span>}
                </div>
              ) : (
                <span className="text-gray-400">Not running</span>
              )}
            </div>

            {/* Probe */}
            <div className="flex items-center gap-3 text-xs px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              <div className="flex items-center gap-2 min-w-[110px]">
                <div className={`w-2 h-2 rounded-full shrink-0 ${probeStatus?.running ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                <span className="font-medium text-sm">Probe</span>
              </div>
              {probeStatus?.running && systemInfo?.probe ? (
                <div className="flex items-center gap-4 flex-wrap text-gray-500 dark:text-gray-400">
                  <span>CPU <span className="font-semibold text-gray-700 dark:text-gray-200">{systemInfo.probe.cpu_percent.toFixed(1)}%</span></span>
                  <span>Mem <span className="font-semibold text-gray-700 dark:text-gray-200">{systemInfo.probe.memory_mb.toFixed(1)} MB</span></span>
                  <span>Uptime <span className="font-semibold text-gray-700 dark:text-gray-200">{formatUptime(systemInfo.probe.uptime_seconds)}</span></span>
                  <span>Threads <span className="font-semibold text-gray-700 dark:text-gray-200">{systemInfo.probe.num_threads}</span></span>
                  <span className="text-gray-300 dark:text-gray-600">PID {systemInfo.probe.pid}</span>
                  {probeStatus?.port && <span className="text-gray-300 dark:text-gray-600">Port {probeStatus.port}</span>}
                  {probeStatus?.node_count != null && <span className="text-gray-300 dark:text-gray-600">Nodes {probeStatus.node_count}</span>}
                </div>
              ) : (
                <span className="text-gray-400">Not running</span>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Service controls */}
      <Card>
        <CardBody className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">sing-box Service</h2>
            <Chip
              color={serviceStatus?.running ? 'success' : 'danger'}
              variant="flat"
              size="sm"
            >
              {serviceStatus?.running ? 'Running' : 'Stopped'}
            </Chip>
          </div>
          <div className="flex flex-wrap gap-2">
            {serviceStatus?.running ? (
              <>
                <Button size="sm" color="danger" variant="flat" startContent={<Square className="w-4 h-4" />} onPress={handleStop}>Stop</Button>
                <Button size="sm" color="primary" variant="flat" startContent={<RefreshCw className="w-4 h-4" />} onPress={handleRestart}>Restart</Button>
              </>
            ) : (
              <Button size="sm" color="success" startContent={<Play className="w-4 h-4" />} onPress={handleStart}>Start</Button>
            )}
            <Button size="sm" color="primary" onPress={handleApplyConfig}>Apply Config</Button>
            {proxyLinks.length > 0 && (
              <Button size="sm" variant="flat" startContent={<Link className="w-4 h-4" />} onPress={() => setProxyLinksOpen(true)}>
                Proxy Links
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Pipeline: Scheduler + Probe + Verification — unified block */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <Stethoscope className="w-5 h-5" />
              <h2 className="text-lg font-semibold">Pipeline</h2>
              <Chip
                color={verificationStatus?.scheduler_running ? 'success' : 'default'}
                variant="flat"
                size="sm"
              >
                {verificationStatus?.scheduler_running ? 'Running' : 'Stopped'}
              </Chip>
              {probeStatus?.running && (
                <Tooltip
                  content={
                    <div className="text-xs space-y-1 p-1">
                      <div>PID: {probeStatus.pid || '-'}</div>
                      <div>Port: {probeStatus.port}</div>
                      <div>Nodes: {probeStatus.node_count}</div>
                      {probeStatus.started_at && (
                        <div>Uptime: {Math.round((Date.now() - new Date(probeStatus.started_at).getTime()) / 60000)} min</div>
                      )}
                      {systemInfo?.probe && (
                        <>
                          <div>CPU: {systemInfo.probe.cpu_percent.toFixed(1)}%</div>
                          <div>Mem: {systemInfo.probe.memory_mb.toFixed(1)} MB</div>
                        </>
                      )}
                    </div>
                  }
                  placement="bottom"
                >
                  <Chip size="sm" variant="flat" color="warning" className="cursor-help">Probe: port {probeStatus.port}</Chip>
                </Tooltip>
              )}
            </div>
            {verificationStatus?.scheduler_running && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Subs: {verificationStatus.sub_update_enabled
                  ? <>{verificationStatus.sub_update_interval_min}min{verificationStatus.auto_apply && ' (auto-apply)'}{verificationStatus.sub_next_update_at && <> · next {formatTimeShort(verificationStatus.sub_next_update_at)} ({formatTimeUntil(verificationStatus.sub_next_update_at)})</>}</>
                  : 'disabled'}
                <span className="mx-2 text-gray-300 dark:text-gray-600">|</span>
                Verify: {verificationStatus.enabled
                  ? <>{verificationStatus.interval_min}min{verificationStatus.last_run_at && <> · last {formatTimeShort(verificationStatus.last_run_at)}</>}{verificationStatus.next_run_at && <> · next {formatTimeShort(verificationStatus.next_run_at)} ({formatTimeUntil(verificationStatus.next_run_at)})</>}</>
                  : 'disabled'}
                {(() => {
                  const r = (runCounters.promoted > 0 || runCounters.demoted > 0 || runCounters.archived > 0)
                    ? runCounters
                    : verificationStatus?.last_run_results;
                  return r && (r.promoted > 0 || r.demoted > 0 || r.archived > 0) ? (
                    <>
                      <span className="mx-2 text-gray-300 dark:text-gray-600">|</span>
                      Last run: <span className="text-green-600 dark:text-green-400">+{r.promoted}</span>
                      {' '}<span className="text-yellow-600 dark:text-yellow-400">-{r.demoted}</span>
                      {' '}<span className="text-gray-400">x{r.archived}</span>
                    </>
                  ) : null;
                })()}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {verificationStatus?.scheduler_running ? (
              <Button size="sm" color="danger" variant="flat" startContent={<Square className="w-4 h-4" />} onPress={() => stopVerificationScheduler()}>
                Stop
              </Button>
            ) : (
              <Button size="sm" color="success" variant="flat" startContent={<Play className="w-4 h-4" />} onPress={() => startVerificationScheduler()}>
                Start
              </Button>
            )}
            <Button
              size="sm"
              color="primary"
              variant="flat"
              startContent={verificationRunning ? <Spinner size="sm" /> : <ShieldCheck className="w-4 h-4" />}
              onPress={() => runVerification()}
              isDisabled={verificationRunning}
            >
              Verify Now
            </Button>
            {probeStatus?.running && (
              <Button size="sm" color="danger" variant="flat" startContent={<Square className="w-4 h-4" />} onPress={stopProbe}>
                Stop Probe
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {/* Progress bar — visible during verification */}
          {verificationProgress && (
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">
                  {verificationProgress.phase === 'health_check'
                    ? 'Health check'
                    : verificationProgress.phase === 'site_check'
                    ? 'Site check'
                    : verificationProgress.phase === 'geo'
                    ? 'GEO detection'
                    : `Checking ${verificationProgress.phase} nodes`}
                </span>
                <span className="font-medium">
                  {verificationProgress.phase === 'health_check' || verificationProgress.phase === 'site_check'
                    ? `${verificationProgress.current}/${verificationProgress.total}`
                    : `${verificationProgress.current}/${verificationProgress.total}`}
                </span>
              </div>
              <Progress
                size="md"
                value={verificationProgress.current}
                maxValue={verificationProgress.total || 1}
                color={
                  verificationProgress.phase === 'pending' ? 'warning'
                  : verificationProgress.phase === 'health_check' ? 'primary'
                  : verificationProgress.phase === 'site_check' ? 'secondary'
                  : verificationProgress.phase === 'geo' ? 'success'
                  : 'default'
                }
                className="w-full"
              />
            </div>
          )}



          {/* Activity feed */}
          {pipelineEvents.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-gray-500" />
                <span className="font-medium text-sm text-gray-600 dark:text-gray-400">Activity</span>
              </div>
              <div
                ref={activityFeedRef}
                className="max-h-48 overflow-y-auto bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-1 text-xs font-mono"
              >
                {pipelineEvents.map((event) => {
                  let color = 'text-gray-500';
                  let icon = '';
                  if (event.type.includes('promoted')) { color = 'text-green-600 dark:text-green-400'; icon = '+'; }
                  else if (event.type.includes('demoted')) { color = 'text-yellow-600 dark:text-yellow-400'; icon = '-'; }
                  else if (event.type.includes('archived')) { color = 'text-red-600 dark:text-red-400'; icon = 'x'; }
                  else if (event.type.includes('complete')) { color = 'text-blue-600 dark:text-blue-400'; icon = '*'; }
                  else if (event.type.includes('start')) { color = 'text-blue-500'; icon = '>'; }
                  else if (event.type.includes('stop')) { color = 'text-gray-500'; icon = '|'; }
                  else if (event.type.includes('refresh') || event.type.includes('synced')) { color = 'text-purple-500'; icon = '~'; }
                  else { icon = '.'; }

                  const time = new Date(event.timestamp).toLocaleTimeString();
                  return (
                    <div key={event.id} className={`${color} leading-tight`}>
                      <span className="text-gray-400">[{time}]</span> {icon} {event.message}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Active Proxy */}
      <ActiveProxyBlock
        mainProxyGroup={mainProxyGroup || null}
        resolvedActiveProxyTag={resolvedActiveProxyTag}
        isAutoMode={isAutoMode}
        activeProxyRefreshing={activeProxyRefreshing}
        verificationRunning={verificationRunning}
        proxySearch={proxySearch}
        setProxySearch={setProxySearch}
        filteredMainProxyOptions={filteredMainProxyOptions}
        hasSearchMatches={hasSearchMatches}
        switchProxy={switchProxy}
        handleRefreshActiveProxy={handleRefreshActiveProxy}
        getProxyDisplayTag={getProxyDisplayTag}
        getProxySourceTag={getProxySourceTag}
        getServerPortLabel={getServerPortLabel}
        getLatestMeasuredDelay={getLatestMeasuredDelay}
        getSiteCheckSummary={getSiteCheckSummary}
        getGeoLabel={getGeoLabel}
        delayChipColor={delayChipColor}
        siteChipColor={siteChipColor}
        formatDelayLabel={formatDelayLabel}
      />

      {/* Proxy Links Modal */}
      <Modal isOpen={proxyLinksOpen} onClose={() => setProxyLinksOpen(false)} size="lg">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Link className="w-5 h-5" />
            Proxy Links
          </ModalHeader>
          <ModalBody>
            <div className="space-y-2">
              {proxyLinks.map((item) => (
                <div key={item.key} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
                    <Chip size="sm" variant="flat" color="primary">{item.label}</Chip>
                    <code className="text-sm text-gray-600 dark:text-gray-300 truncate">{item.link}</code>
                  </div>
                  <div className="flex items-center gap-1 self-end sm:self-auto">
                    {item.key === 'ss' && (
                      <Button size="sm" variant="light" isIconOnly onPress={() => setQrLink(item.link)} aria-label="Show Shadowsocks QR code">
                        <QrCode className="w-4 h-4" />
                      </Button>
                    )}
                    <Button size="sm" variant="light" isIconOnly onPress={() => handleCopyLink(item.key, item.link)}>
                      {copiedLink === item.key ? <ClipboardCheck className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button color="primary" variant="flat" onPress={() => setProxyLinksOpen(false)}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Error modal */}
      <Modal isOpen={errorModal.isOpen} onClose={() => setErrorModal({ ...errorModal, isOpen: false })}>
        <ModalContent>
          <ModalHeader className="text-danger">{errorModal.title}</ModalHeader>
          <ModalBody>
            <p className="whitespace-pre-wrap text-sm">{errorModal.message}</p>
          </ModalBody>
          <ModalFooter>
            <Button color="primary" onPress={() => setErrorModal({ ...errorModal, isOpen: false })}>OK</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Shadowsocks QR modal */}
      <Modal isOpen={Boolean(qrLink)} onClose={() => setQrLink(null)}>
        <ModalContent>
          <ModalHeader>Shadowsocks QR</ModalHeader>
          <ModalBody>
            {qrLink && (
              <div className="flex flex-col items-center gap-3">
                <img src={qrImageUrl} alt="Shadowsocks QR code" className="w-64 h-64 rounded-md border border-gray-200 dark:border-gray-700" loading="lazy" />
                <code className="text-xs text-gray-600 dark:text-gray-300 break-all">{qrLink}</code>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            {qrLink && (
              <Button variant="flat" onPress={() => handleCopyLink('ss-qr', qrLink)}>
                {copiedLink === 'ss-qr' ? 'Copied' : 'Copy Link'}
              </Button>
            )}
            <Button color="primary" onPress={() => setQrLink(null)}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
