import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardBody, CardHeader, Chip, Spinner } from '@nextui-org/react';
import { ArrowLeft, ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { monitoringApi } from '../api';

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

interface ClientHistoryPoint {
  timestamp: string;
  upload_bytes: number;
  download_bytes: number;
  active_connections: number;
}

interface ClientResourceHistory {
  host: string;
  total_upload: number;
  total_download: number;
  proxy_chain: string;
  first_seen: string;
  last_seen: string;
}

type SortKey = 'host' | 'total_upload' | 'total_download' | 'total' | 'last_seen';
type SortDir = 'asc' | 'desc';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
  const idx = Math.min(i, units.length - 1);
  return `${(bytes / Math.pow(1024, idx)).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatDateTime(ts?: string): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

const PERIOD_OPTIONS = [
  { label: '1h', hours: 1, points: 120 },
  { label: '6h', hours: 6, points: 360 },
  { label: '24h', hours: 24, points: 500 },
  { label: '7d', hours: 168, points: 1000 },
];

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
  return sortDir === 'desc'
    ? <ChevronDown className="w-3 h-3" />
    : <ChevronUp className="w-3 h-3" />;
}

export default function ClientDetail() {
  const { sourceIp } = useParams<{ sourceIp: string }>();
  const navigate = useNavigate();
  const ip = sourceIp || '';

  const [client, setClient] = useState<MonitoringClient | null>(null);
  const [history, setHistory] = useState<ClientHistoryPoint[]>([]);
  const [resources, setResources] = useState<ClientResourceHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodIdx, setPeriodIdx] = useState(2); // default 24h
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Load client info and resources once per IP
  useEffect(() => {
    if (!ip) return;
    let cancelled = false;
    setLoading(true);

    Promise.all([
      monitoringApi.getRecentClients(300, 24 * 30),
      monitoringApi.getClientResourcesHistory(ip, 1000),
    ]).then(([clientsRes, resourcesRes]) => {
      if (cancelled) return;
      const clients: MonitoringClient[] = clientsRes.data?.data || [];
      setClient(clients.find((c) => c.source_ip === ip) || null);
      setResources(resourcesRes.data?.data || []);
    }).catch((err) => {
      if (!cancelled) console.error('Failed to load client detail:', err);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [ip]);

  // Load history separately — depends on period
  useEffect(() => {
    if (!ip) return;
    let cancelled = false;
    const period = PERIOD_OPTIONS[periodIdx];

    monitoringApi.getClientHistory(ip, period.points)
      .then((res) => {
        if (!cancelled) setHistory(res.data?.data || []);
      })
      .catch((err) => {
        if (!cancelled) console.error('Failed to load client history:', err);
      });

    return () => { cancelled = true; };
  }, [ip, periodIdx]);

  // Chart data with deltas
  const chartData = useMemo(() => {
    if (history.length < 2) return [];

    const period = PERIOD_OPTIONS[periodIdx];
    const cutoff = Date.now() - period.hours * 3600 * 1000;

    const filtered = history.filter((p) => new Date(p.timestamp).getTime() >= cutoff);

    return filtered.map((point, idx) => {
      const prev = idx > 0 ? filtered[idx - 1] : point;
      const uploadDelta = point.upload_bytes >= prev.upload_bytes
        ? point.upload_bytes - prev.upload_bytes
        : point.upload_bytes;
      const downloadDelta = point.download_bytes >= prev.download_bytes
        ? point.download_bytes - prev.download_bytes
        : point.download_bytes;

      return {
        time: new Date(point.timestamp).toLocaleTimeString([], { hour12: false }),
        fullTime: new Date(point.timestamp).toLocaleString(),
        upload: uploadDelta,
        download: downloadDelta,
        connections: point.active_connections,
      };
    });
  }, [history, periodIdx]);

  // Sorted resources
  const sortedResources = useMemo(() => {
    const sorted = [...resources];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'host':
          cmp = a.host.localeCompare(b.host);
          break;
        case 'total_upload':
          cmp = a.total_upload - b.total_upload;
          break;
        case 'total_download':
          cmp = a.total_download - b.total_download;
          break;
        case 'total':
          cmp = (a.total_upload + a.total_download) - (b.total_upload + b.total_download);
          break;
        case 'last_seen':
          cmp = new Date(a.last_seen).getTime() - new Date(b.last_seen).getTime();
          break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [resources, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // Summary stats
  const { totalUpload, totalDownload } = useMemo(() => ({
    totalUpload: resources.reduce((s, r) => s + r.total_upload, 0),
    totalDownload: resources.reduce((s, r) => s + r.total_download, 0),
  }), [resources]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/clients')}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white font-mono">{ip}</h1>
          {client && (
            <Chip size="sm" variant="flat" color={client.online ? 'success' : 'default'}>
              {client.online ? 'online' : 'offline'}
            </Chip>
          )}
        </div>
        {client?.last_seen && (
          <span className="text-sm text-gray-500 ml-auto">
            Last seen: {formatDateTime(client.last_seen)}
          </span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card shadow="sm">
          <CardBody className="p-3">
            <p className="text-xs text-gray-500">Upload</p>
            <p className="text-lg font-bold text-primary">{formatBytes(totalUpload)}</p>
          </CardBody>
        </Card>
        <Card shadow="sm">
          <CardBody className="p-3">
            <p className="text-xs text-gray-500">Download</p>
            <p className="text-lg font-bold text-secondary">{formatBytes(totalDownload)}</p>
          </CardBody>
        </Card>
        <Card shadow="sm">
          <CardBody className="p-3">
            <p className="text-xs text-gray-500">Total Traffic</p>
            <p className="text-lg font-bold">{formatBytes(totalUpload + totalDownload)}</p>
          </CardBody>
        </Card>
        <Card shadow="sm">
          <CardBody className="p-3">
            <p className="text-xs text-gray-500">Hosts</p>
            <p className="text-lg font-bold">{resources.length}</p>
          </CardBody>
        </Card>
      </div>

      {/* Traffic chart */}
      <Card shadow="sm">
        <CardHeader className="flex items-center justify-between pb-0">
          <h3 className="text-sm font-semibold">Traffic History</h3>
          <div className="flex gap-1">
            {PERIOD_OPTIONS.map((opt, idx) => (
              <button
                key={opt.label}
                onClick={() => setPeriodIdx(idx)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  periodIdx === idx
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardBody>
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height={256}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="uploadGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="downloadGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatBytes(v)} width={60} />
                <Tooltip
                  contentStyle={{ fontSize: 12, backgroundColor: 'rgba(0,0,0,0.85)', border: 'none', borderRadius: 8, color: '#fff' }}
                  formatter={(value, name) => [formatBytes(Number(value ?? 0)), name === 'upload' ? 'Upload' : 'Download']}
                  labelFormatter={(label) => String(label)}
                />
                <Area type="monotone" dataKey="upload" stroke="#6366f1" fill="url(#uploadGrad)" strokeWidth={1.5} dot={false} />
                <Area type="monotone" dataKey="download" stroke="#06b6d4" fill="url(#downloadGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
              Not enough data for chart
            </div>
          )}
        </CardBody>
      </Card>

      {/* Resources table */}
      <Card shadow="sm">
        <CardHeader className="pb-0">
          <h3 className="text-sm font-semibold">Resources ({resources.length} hosts)</h3>
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs text-gray-500">
                  <th className="pb-2 pr-3 cursor-pointer select-none" onClick={() => toggleSort('host')}>
                    <span className="inline-flex items-center gap-1">Host <SortIcon col="host" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className="pb-2 pr-3 cursor-pointer select-none" onClick={() => toggleSort('total_upload')}>
                    <span className="inline-flex items-center gap-1">Upload <SortIcon col="total_upload" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className="pb-2 pr-3 cursor-pointer select-none" onClick={() => toggleSort('total_download')}>
                    <span className="inline-flex items-center gap-1">Download <SortIcon col="total_download" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className="pb-2 pr-3 cursor-pointer select-none" onClick={() => toggleSort('total')}>
                    <span className="inline-flex items-center gap-1">Total <SortIcon col="total" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className="pb-2 pr-3 hidden md:table-cell">Chain</th>
                  <th className="pb-2 pr-3 cursor-pointer select-none hidden sm:table-cell" onClick={() => toggleSort('last_seen')}>
                    <span className="inline-flex items-center gap-1">Last Seen <SortIcon col="last_seen" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedResources.map((r) => (
                  <tr key={r.host} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="py-2 pr-3 font-mono text-xs truncate max-w-[300px]" title={r.host}>{r.host}</td>
                    <td className="py-2 pr-3 text-xs">{formatBytes(r.total_upload)}</td>
                    <td className="py-2 pr-3 text-xs">{formatBytes(r.total_download)}</td>
                    <td className="py-2 pr-3 text-xs font-semibold">{formatBytes(r.total_upload + r.total_download)}</td>
                    <td className="py-2 pr-3 text-xs truncate max-w-[150px] hidden md:table-cell" title={r.proxy_chain}>
                      {r.proxy_chain || 'direct'}
                    </td>
                    <td className="py-2 pr-3 text-xs hidden sm:table-cell">{formatDateTime(r.last_seen)}</td>
                  </tr>
                ))}
                {resources.length === 0 && (
                  <tr>
                    <td className="py-6 text-center text-gray-500" colSpan={6}>No resources history</td>
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
