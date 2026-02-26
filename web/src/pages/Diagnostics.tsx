import { useEffect, useState, useCallback } from 'react';
import { Card, CardBody, CardHeader, Button, Chip, Spinner } from '@nextui-org/react';
import {
  Stethoscope, RefreshCw, Activity, Wifi, Shield, Server,
  Radio, FileCheck, Ear, ScrollText, Zap, Globe,
} from 'lucide-react';
import { diagnosticApi, proxyApi, nodeApi } from '../api';
import { toast } from '../components/Toast';

const countryCodeToEmoji = (code: string): string => {
  const upper = code.toUpperCase();
  if (upper.length !== 2) return '🌐';
  return String.fromCodePoint(
    0x1F1E6 + upper.charCodeAt(0) - 65,
    0x1F1E6 + upper.charCodeAt(1) - 65,
  );
};

interface DiagnosticData {
  service: {
    status: string;
    running: boolean;
    pid: number;
    version: string;
    sbm_version: string;
  };
  proxy_mode: {
    settings_mode: string;
    runtime_mode: string;
    match: boolean;
    source: string;
  };
  config: {
    valid: boolean;
    error?: string;
    outbound_count?: number;
    inbound_count?: number;
    shadowsocks_nodes?: number;
  };
  active_proxy: {
    available: boolean;
    selector?: string;
    selected?: string;
    selected_type?: string;
    total_nodes?: number;
  };
  connectivity: {
    tested: boolean;
    node?: string;
    delay_ms?: number;
    status?: string;
  };
  dns: {
    proxy_dns: string;
    direct_dns: string;
  };
  listeners: {
    items: Array<{
      type: string;
      port: string;
      bind: string;
      method?: string;
    }>;
    count: number;
  };
  logs: {
    lines: string[];
    total_recent?: number;
    error_warn_count?: number;
    error?: string;
    by_inbound?: Record<string, { lines: string[]; count: number }>;
  };
}

type StatusColor = 'success' | 'warning' | 'danger' | 'default';

function StatusChip({ status, label }: { status: StatusColor; label: string }) {
  return (
    <Chip
      size="sm"
      variant="flat"
      color={status}
      classNames={{ content: 'font-medium text-xs' }}
    >
      {label}
    </Chip>
  );
}

function SectionCard({
  icon: Icon,
  title,
  status,
  statusLabel,
  children,
}: {
  icon: React.ElementType;
  title: string;
  status: StatusColor;
  statusLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
      <CardHeader className="flex justify-between items-center pb-2">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span className="font-semibold text-sm text-gray-800 dark:text-white">{title}</span>
        </div>
        <StatusChip status={status} label={statusLabel} />
      </CardHeader>
      <CardBody className="pt-0">
        {children}
      </CardBody>
    </Card>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string | number | undefined; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`text-xs text-gray-800 dark:text-gray-200 ${mono ? 'font-mono' : ''}`}>
        {value ?? '-'}
      </span>
    </div>
  );
}

interface GeoSummary {
  total: number;
  checked: number;
  mismatchCount: number;
  countries: Record<string, number>;
  lastChecked: string | null;
}

export default function Diagnostics() {
  const [data, setData] = useState<DiagnosticData | null>(null);
  const [loading, setLoading] = useState(true);
  const [testingDelay, setTestingDelay] = useState(false);
  const [geoSummary, setGeoSummary] = useState<GeoSummary | null>(null);

  const fetchGeoSummary = useCallback(async () => {
    try {
      const resp = await nodeApi.getGeoData();
      const geoList = resp.data.data || [];
      const countries: Record<string, number> = {};
      let lastChecked: string | null = null;
      for (const g of geoList) {
        if (g.status === 'success') {
          countries[g.country_code] = (countries[g.country_code] || 0) + 1;
          if (!lastChecked || g.timestamp > lastChecked) {
            lastChecked = g.timestamp;
          }
        }
      }
      setGeoSummary({
        total: geoList.length,
        checked: geoList.filter((g: any) => g.status === 'success').length,
        mismatchCount: 0, // Would need node data to compute; shown as 0 for now
        countries,
        lastChecked,
      });
    } catch {
      // Silently fail — geo summary is optional
    }
  }, []);

  const fetchDiagnostics = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await diagnosticApi.getAll();
      setData(resp.data.data);
    } catch (err: any) {
      toast.error('Failed to load diagnostics: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDiagnostics();
    fetchGeoSummary();
  }, [fetchDiagnostics, fetchGeoSummary]);

  const handleTestConnectivity = async () => {
    if (!data?.active_proxy?.selected) return;
    setTestingDelay(true);
    try {
      const resp = await proxyApi.checkDelay(data.active_proxy.selected);
      const delay = resp.data?.data?.delay;
      if (delay && delay > 0) {
        toast.success(`Delay: ${delay}ms`);
      } else {
        toast.error('Connectivity test failed (timeout or error)');
      }
      await fetchDiagnostics();
    } catch {
      toast.error('Connectivity test failed');
    } finally {
      setTestingDelay(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!data) return null;

  // Determine statuses
  const serviceStatusColor: StatusColor = data.service.running ? 'success' : 'danger';
  const serviceStatusLabel = data.service.running ? 'Running' : 'Stopped';

  const modeMatch = data.proxy_mode.match || !data.service.running;
  const modeStatusColor: StatusColor = !data.service.running ? 'default' : modeMatch ? 'success' : 'warning';
  const modeStatusLabel = !data.service.running
    ? 'Offline'
    : modeMatch
      ? data.proxy_mode.runtime_mode || data.proxy_mode.settings_mode
      : 'Mismatch';

  const configStatusColor: StatusColor = data.config.valid ? 'success' : 'danger';
  const configStatusLabel = data.config.valid ? 'Valid' : 'Error';

  const proxyStatusColor: StatusColor = data.active_proxy.available ? 'success' : 'default';
  const proxyStatusLabel = data.active_proxy.available ? data.active_proxy.selected_type || 'Active' : 'N/A';

  const connStatusColor: StatusColor = !data.connectivity.tested
    ? 'default'
    : data.connectivity.status === 'ok'
      ? 'success'
      : 'danger';
  const connStatusLabel = !data.connectivity.tested
    ? 'Not tested'
    : data.connectivity.status === 'ok'
      ? `${data.connectivity.delay_ms}ms`
      : 'Failed';

  const dnsStatusColor: StatusColor = data.dns.proxy_dns ? 'success' : 'warning';
  const dnsStatusLabel = data.dns.proxy_dns ? 'Configured' : 'Default';

  const listenerStatusColor: StatusColor = data.listeners.count > 0 ? 'success' : 'warning';
  const listenerStatusLabel = `${data.listeners.count} active`;

  const logStatusColor: StatusColor = (data.logs.error_warn_count ?? 0) === 0 ? 'success' : (data.logs.error_warn_count ?? 0) > 5 ? 'danger' : 'warning';
  const logStatusLabel = (data.logs.error_warn_count ?? 0) === 0 ? 'Clean' : `${data.logs.error_warn_count} issues`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Stethoscope className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Diagnostics</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.active_proxy.available && (
            <Button
              size="sm"
              variant="flat"
              color="primary"
              startContent={testingDelay ? <Spinner size="sm" /> : <Zap className="w-4 h-4" />}
              onClick={handleTestConnectivity}
              isDisabled={testingDelay || !data.service.running}
            >
              Test Connectivity
            </Button>
          )}
          <Button
            size="sm"
            variant="flat"
            startContent={loading ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />}
            onClick={fetchDiagnostics}
            isDisabled={loading}
          >
            Refresh All
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Service Status */}
        <SectionCard icon={Server} title="Service Status" status={serviceStatusColor} statusLabel={serviceStatusLabel}>
          <InfoRow label="PID" value={data.service.pid || '-'} mono />
          <InfoRow label="sing-box version" value={data.service.version || '-'} />
          <InfoRow label="SBM version" value={data.service.sbm_version} />
        </SectionCard>

        {/* Proxy Mode */}
        <SectionCard icon={Shield} title="Proxy Mode" status={modeStatusColor} statusLabel={modeStatusLabel}>
          <InfoRow label="Settings" value={data.proxy_mode.settings_mode} />
          <InfoRow label="Runtime" value={data.proxy_mode.runtime_mode || (data.service.running ? 'unknown' : '-')} />
          <InfoRow label="Source" value={data.proxy_mode.source} />
          {!modeMatch && data.service.running && (
            <div className="mt-1 text-xs text-warning-500">Settings and runtime modes differ</div>
          )}
        </SectionCard>

        {/* Config Validation */}
        <SectionCard icon={FileCheck} title="Config Validation" status={configStatusColor} statusLabel={configStatusLabel}>
          {data.config.valid ? (
            <>
              <InfoRow label="Outbounds" value={data.config.outbound_count} />
              <InfoRow label="Inbounds" value={data.config.inbound_count} />
              <InfoRow label="Shadowsocks nodes" value={data.config.shadowsocks_nodes} />
              {data.config.shadowsocks_nodes === 0 && (
                <div className="mt-1 text-xs text-warning-500">No Shadowsocks nodes in config</div>
              )}
            </>
          ) : (
            <div className="text-xs text-danger-500 break-all mt-1">{data.config.error}</div>
          )}
        </SectionCard>

        {/* Active Proxy */}
        <SectionCard icon={Radio} title="Active Proxy" status={proxyStatusColor} statusLabel={proxyStatusLabel}>
          {data.active_proxy.available ? (
            <>
              <InfoRow label="Selector" value={data.active_proxy.selector} />
              <InfoRow label="Selected" value={data.active_proxy.selected} />
              <InfoRow label="Type" value={data.active_proxy.selected_type} />
              <InfoRow label="Total nodes" value={data.active_proxy.total_nodes} />
            </>
          ) : (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {data.service.running ? 'No proxy selector found' : 'Service not running'}
            </div>
          )}
        </SectionCard>

        {/* Connectivity */}
        <SectionCard icon={Wifi} title="Connectivity Test" status={connStatusColor} statusLabel={connStatusLabel}>
          {data.connectivity.tested ? (
            <>
              <InfoRow label="Node" value={data.connectivity.node} />
              <InfoRow label="Delay" value={data.connectivity.delay_ms ? `${data.connectivity.delay_ms}ms` : 'timeout'} />
            </>
          ) : (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {data.service.running ? 'Click "Test Connectivity" to check' : 'Service not running'}
            </div>
          )}
        </SectionCard>

        {/* DNS */}
        <SectionCard icon={Activity} title="DNS Check" status={dnsStatusColor} statusLabel={dnsStatusLabel}>
          <InfoRow label="Proxy DNS" value={data.dns.proxy_dns || 'not set'} mono />
          <InfoRow label="Direct DNS" value={data.dns.direct_dns || 'not set'} mono />
        </SectionCard>

        {/* GeoIP Summary */}
        <SectionCard
          icon={Globe}
          title="GeoIP Data"
          status={geoSummary && geoSummary.checked > 0 ? 'success' : 'default'}
          statusLabel={geoSummary ? `${geoSummary.checked} checked` : 'N/A'}
        >
          {geoSummary && geoSummary.checked > 0 ? (
            <>
              <InfoRow label="Nodes checked" value={geoSummary.checked} />
              <InfoRow label="Unique countries" value={Object.keys(geoSummary.countries).length} />
              <InfoRow
                label="Last checked"
                value={geoSummary.lastChecked ? new Date(geoSummary.lastChecked).toLocaleString() : '-'}
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(geoSummary.countries)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 10)
                  .map(([code, count]) => (
                    <Chip key={code} size="sm" variant="flat" className="text-xs">
                      {countryCodeToEmoji(code)} {code}: {count}
                    </Chip>
                  ))}
              </div>
            </>
          ) : (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              No GeoIP data available. Run verification or manual GeoIP check.
            </div>
          )}
        </SectionCard>

        {/* Inbound Listeners */}
        <SectionCard icon={Ear} title="Inbound Listeners" status={listenerStatusColor} statusLabel={listenerStatusLabel}>
          {data.listeners.items && data.listeners.items.length > 0 ? (
            <div className="space-y-1">
              {data.listeners.items.map((l, i) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <Chip size="sm" variant="flat" color="default" classNames={{ content: 'text-xs font-mono' }}>
                    {l.type}
                  </Chip>
                  <span className="text-xs font-mono text-gray-700 dark:text-gray-300">
                    {l.bind || '0.0.0.0'}:{l.port}
                    {l.method ? ` (${l.method})` : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-warning-500">No inbound listeners configured</div>
          )}
        </SectionCard>

        {/* Recent Logs */}
        <SectionCard icon={ScrollText} title="Recent Logs (ERROR/WARN)" status={logStatusColor} statusLabel={logStatusLabel}>
          {data.logs.lines && data.logs.lines.length > 0 ? (
            <div className="max-h-48 overflow-y-auto">
              {data.logs.lines.map((line, i) => (
                <div
                  key={i}
                  className={`text-xs font-mono py-0.5 break-all ${
                    line.toUpperCase().includes('ERROR')
                      ? 'text-danger-500'
                      : 'text-warning-500'
                  }`}
                >
                  {line}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {data.logs.error ? data.logs.error : 'No errors or warnings in recent logs'}
            </div>
          )}
          {data.logs.total_recent !== undefined && (
            <div className="mt-2 text-xs text-gray-400">
              Scanned {data.logs.total_recent} recent log lines
            </div>
          )}
        </SectionCard>
      </div>

      {/* Logs by Inbound — full width */}
      {data.logs.by_inbound && Object.keys(data.logs.by_inbound).length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-gray-500" />
            Logs by Inbound Type
          </h2>
          <div className="grid grid-cols-1 gap-4">
            {Object.entries(data.logs.by_inbound).map(([inboundType, inboundData]) => {
              const hasErrors = inboundData.lines.some((l: string) => l.toUpperCase().includes('ERROR'));
              const color: StatusColor = hasErrors ? 'danger' : inboundData.count > 0 ? 'success' : 'default';
              const label = `${inboundData.count} entries`;

              return (
                <Card key={inboundType} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <CardHeader className="flex justify-between items-center pb-2">
                    <div className="flex items-center gap-2">
                      <Chip size="sm" variant="flat" color={inboundType === 'shadowsocks' ? 'secondary' : 'default'}
                        classNames={{ content: 'text-xs font-mono font-medium' }}>
                        {inboundType}
                      </Chip>
                      <span className="text-sm text-gray-600 dark:text-gray-400">inbound</span>
                    </div>
                    <StatusChip status={color} label={label} />
                  </CardHeader>
                  <CardBody className="pt-0">
                    {inboundData.lines.length > 0 ? (
                      <div className="max-h-56 overflow-y-auto">
                        {inboundData.lines.map((line: string, i: number) => {
                          const upper = line.toUpperCase();
                          const lineColor = upper.includes('ERROR')
                            ? 'text-danger-500'
                            : upper.includes('WARN')
                              ? 'text-warning-500'
                              : 'text-gray-600 dark:text-gray-300';
                          return (
                            <div key={i} className={`text-xs font-mono py-0.5 break-all ${lineColor}`}>
                              {line}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 dark:text-gray-400">No recent activity</div>
                    )}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
