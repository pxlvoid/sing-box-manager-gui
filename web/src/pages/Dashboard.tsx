import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, CardHeader, Button, Chip, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tooltip, Select, SelectItem, Spinner, Progress } from '@nextui-org/react';
import { Play, Square, RefreshCw, Cpu, HardDrive, Wifi, Info, Activity, Copy, ClipboardCheck, Link, Globe, QrCode, Search, Stethoscope, ShieldCheck, Clock, CheckCircle, Archive } from 'lucide-react';
import { useStore } from '../store';
import type { NodeSiteCheckResult } from '../store';
import { shortSiteLabel } from '../features/nodes/types';
import { serviceApi, configApi } from '../api';
import { toast } from '../components/Toast';


export default function Dashboard() {
  const {
    serviceStatus, probeStatus, subscriptions, nodeCounts, systemInfo, settings, proxyGroups,
    pendingNodes, verifiedNodes, archivedNodes, countryGroups,
    verificationStatus, verificationRunning,
    healthResults, siteCheckResults,
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

    const interval = setInterval(() => {
      fetchServiceStatus();
      fetchProbeStatus();
      fetchSystemInfo();
      fetchProxyGroups();
    }, 5000);
    return () => clearInterval(interval);
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

  const totalNodes = nodeCounts.pending + nodeCounts.verified + nodeCounts.archived;
  const enabledSubs = subscriptions.filter(sub => sub.enabled).length;
  const mainProxyGroup = proxyGroups.find((group) => group.name.toLowerCase() === 'proxy');
  const allKnownNodes = useMemo(
    () => [...verifiedNodes, ...pendingNodes, ...archivedNodes],
    [verifiedNodes, pendingNodes, archivedNodes],
  );
  const knownNodesByTag = useMemo(() => {
    const map = new Map<string, (typeof allKnownNodes)[number]>();
    for (const node of allKnownNodes) {
      if (!map.has(node.tag)) {
        map.set(node.tag, node);
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

  const getServerPortLabel = (tag: string): string => {
    const node = knownNodesByTag.get(tag);
    return node ? `${node.server}:${node.server_port}` : '';
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

  const getSiteCheckSummary = (tag: string): { avg: number; count: number; failed: number; details: { label: string; delay: number }[] } | null => {
    const serverPortLabel = getServerPortLabel(tag);
    const siteResult: NodeSiteCheckResult | undefined = siteCheckResults[tag] || (serverPortLabel ? siteCheckResults[serverPortLabel] : undefined);
    if (!siteResult || !siteResult.sites) return null;
    const entries = Object.entries(siteResult.sites);
    if (entries.length === 0) return null;
    const details = entries.map(([site, delay]) => ({ label: shortSiteLabel(site), delay }));
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
  const hasSearchMatches = !normalizedProxySearch || selectableMainProxyOptions.some((item) =>
    item.toLowerCase().includes(normalizedProxySearch),
  );
  const filteredMainProxyOptions = useMemo(() => {
    if (!mainProxyGroup) return [];
    const matchedOptions = normalizedProxySearch
      ? selectableMainProxyOptions.filter((item) => item.toLowerCase().includes(normalizedProxySearch))
      : selectableMainProxyOptions;

    if (mainProxyGroup.now && !matchedOptions.includes(mainProxyGroup.now)) {
      return [mainProxyGroup.now, ...matchedOptions];
    }
    return matchedOptions;
  }, [mainProxyGroup, normalizedProxySearch, selectableMainProxyOptions]);

  const handleRefreshActiveProxy = async () => {
    const activeTag = resolvedActiveProxyTag;
    if (!activeTag) {
      toast.error('Active proxy is not resolved yet');
      return;
    }
    if (activeProxyRefreshing) return;

    await runVerificationForTags([activeTag]);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Dashboard</h1>

      {/* Service status card */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">sing-box Service</h2>
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
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-500">Version</p>
              <div className="flex items-center gap-1">
                <p className="font-medium">
                  {serviceStatus?.version?.match(/version\s+([\d.]+)/)?.[1] || serviceStatus?.version || '-'}
                </p>
                {serviceStatus?.version && (
                  <Tooltip content={<div className="max-w-xs whitespace-pre-wrap text-xs p-1">{serviceStatus.version}</div>} placement="bottom">
                    <Info className="w-3.5 h-3.5 text-gray-400 cursor-help" />
                  </Tooltip>
                )}
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-500">Process ID</p>
              <p className="font-medium">{serviceStatus?.pid || '-'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <p className="font-medium">{serviceStatus?.running ? 'Running normally' : 'Not running'}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Pipeline: Scheduler + Probe + Verification — unified block */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
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
                    ? `Health check: ${verificationProgress.current}/${verificationProgress.total}`
                    : verificationProgress.phase === 'site_check'
                    ? `Site check: ${verificationProgress.current}/${verificationProgress.total}`
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
                  : 'success'
                }
                className="w-full"
              />
            </div>
          )}

          {/* Run counters */}
          {(runCounters.promoted > 0 || runCounters.demoted > 0 || runCounters.archived > 0 || verificationRunning) && (
            <div className="flex gap-2 flex-wrap">
              <Chip size="sm" variant="flat" color="success">Promoted: {runCounters.promoted}</Chip>
              <Chip size="sm" variant="flat" color="warning">Demoted: {runCounters.demoted}</Chip>
              <Chip size="sm" variant="flat" color="default">Archived: {runCounters.archived}</Chip>
            </div>
          )}

          {/* Scheduler tasks */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Subscription auto-update */}
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-blue-500" />
                <span className="font-medium text-sm">Subscription Update</span>
                <Chip size="sm" variant="flat" color={verificationStatus?.sub_update_enabled ? 'success' : 'default'}>
                  {verificationStatus?.sub_update_enabled ? `Every ${verificationStatus.sub_update_interval_min}min` : 'Disabled'}
                </Chip>
                {verificationStatus?.auto_apply && (
                  <Chip size="sm" variant="flat" color="primary">Auto-apply</Chip>
                )}
              </div>
              <div className="text-sm text-gray-500">
                Next update: {verificationStatus?.sub_next_update_at
                  ? new Date(verificationStatus.sub_next_update_at).toLocaleString()
                  : '-'}
              </div>
            </div>

            {/* Verification */}
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-green-500" />
                <span className="font-medium text-sm">Verification</span>
                <Chip size="sm" variant="flat" color={verificationStatus?.enabled ? 'success' : 'default'}>
                  {verificationStatus?.enabled ? `Every ${verificationStatus.interval_min}min` : 'Disabled'}
                </Chip>
              </div>
              <div className="grid grid-cols-2 gap-1 text-sm text-gray-500">
                <div>Last: {verificationStatus?.last_run_at ? new Date(verificationStatus.last_run_at).toLocaleString() : 'Never'}</div>
                <div>Next: {verificationStatus?.next_run_at ? new Date(verificationStatus.next_run_at).toLocaleString() : '-'}</div>
                <div>Threshold: {settings?.archive_threshold || 10} failures</div>
              </div>
            </div>
          </div>

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
      {serviceStatus?.running && mainProxyGroup && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5" />
              <h2 className="text-lg font-semibold">Active Proxy</h2>
            </div>
          </CardHeader>
          <CardBody>
            <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="font-semibold text-base truncate">{resolvedActiveProxyTag || mainProxyGroup.now}</span>
                    {getServerPortLabel(resolvedActiveProxyTag || mainProxyGroup.now) && (
                      <span className="text-xs text-gray-500 truncate">{getServerPortLabel(resolvedActiveProxyTag || mainProxyGroup.now)}</span>
                    )}
                    {getLatestMeasuredDelay(resolvedActiveProxyTag || mainProxyGroup.now) !== null && (
                      <Chip size="sm" variant="flat" color={delayChipColor(getLatestMeasuredDelay(resolvedActiveProxyTag || mainProxyGroup.now))}>
                        {formatDelayLabel(getLatestMeasuredDelay(resolvedActiveProxyTag || mainProxyGroup.now))}
                      </Chip>
                    )}
                    {(() => {
                      const summary = getSiteCheckSummary(resolvedActiveProxyTag || mainProxyGroup.now);
                      if (!summary) return null;
                      return (
                        <Tooltip
                          placement="top-start"
                          showArrow
                          delay={100}
                          content={
                            <div className="flex flex-col gap-1 py-1">
                              {summary.details.map((d) => (
                                <div key={d.label} className="flex items-center justify-between gap-4 text-xs min-w-[180px]">
                                  <span className="text-default-600">{d.label}</span>
                                  <span className={d.delay > 0 ? (d.delay < 800 ? 'text-success' : 'text-warning') : 'text-danger'}>
                                    {d.delay > 0 ? `${d.delay}ms` : 'Fail'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          }
                        >
                          <Chip size="sm" variant="flat" color={siteChipColor(summary)} className="cursor-help">
                            {summary.failed > 0 ? `Fail (${summary.failed}/${summary.count})` : `${summary.avg}ms (${summary.count})`}
                          </Chip>
                        </Tooltip>
                      );
                    })()}
                  </div>
                  {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
                    <p className="text-xs text-gray-500 mt-1">via {mainProxyGroup.now}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  startContent={!activeProxyRefreshing ? <RefreshCw className="w-4 h-4" /> : undefined}
                  isLoading={activeProxyRefreshing}
                  isDisabled={!resolvedActiveProxyTag || verificationRunning}
                  onPress={handleRefreshActiveProxy}
                >
                  Run Pipeline
                </Button>
              </div>

              <Input
                size="lg"
                value={proxySearch}
                onChange={(e) => setProxySearch(e.target.value)}
                placeholder="Search proxy by name"
                startContent={<Search className="w-4 h-4 text-gray-400" />}
                aria-label="Search proxy by name"
                className="max-w-2xl"
              />

              <Select
                size="lg"
                selectedKeys={[mainProxyGroup.now]}
                onChange={(e) => {
                  if (e.target.value) {
                    switchProxy(mainProxyGroup.name, e.target.value);
                    setProxySearch('');
                  }
                }}
                className="w-full max-w-2xl"
                aria-label="Select main proxy"
                classNames={{ trigger: 'min-h-14', value: 'text-base' }}
              >
                {filteredMainProxyOptions.map((item) => {
                  const siteSummary = getSiteCheckSummary(item);
                  return (
                    <SelectItem key={item} textValue={item}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm truncate">{item}</p>
                          {getServerPortLabel(item) && (
                            <p className="text-xs text-gray-500 truncate">{getServerPortLabel(item)}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {getLatestMeasuredDelay(item) !== null && (
                            <Chip size="sm" variant="flat" color={delayChipColor(getLatestMeasuredDelay(item))}>
                              {formatDelayLabel(getLatestMeasuredDelay(item))}
                            </Chip>
                          )}
                          {siteSummary && (
                            <Tooltip
                              placement="left"
                              showArrow
                              delay={100}
                              content={
                                <div className="flex flex-col gap-1 py-1">
                                  {siteSummary.details.map((d) => (
                                    <div key={d.label} className="flex items-center justify-between gap-4 text-xs min-w-[180px]">
                                      <span className="text-default-600">{d.label}</span>
                                      <span className={d.delay > 0 ? (d.delay < 800 ? 'text-success' : 'text-warning') : 'text-danger'}>
                                        {d.delay > 0 ? `${d.delay}ms` : 'Fail'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              }
                            >
                              <Chip size="sm" variant="flat" color={siteChipColor(siteSummary)} className="cursor-help">
                                {siteSummary.failed > 0 ? `Fail (${siteSummary.failed}/${siteSummary.count})` : `${siteSummary.avg}ms (${siteSummary.count})`}
                              </Chip>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    </SelectItem>
                  );
                })}
              </Select>

              {!hasSearchMatches && (
                <p className="text-sm text-gray-500">No proxies found for "{proxySearch.trim()}"</p>
              )}
            </div>
          </CardBody>
        </Card>
      )}

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

      {/* Statistics cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <Wifi className="w-6 h-6 text-blue-600 dark:text-blue-300" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Subscriptions</p>
              <p className="text-2xl font-bold">{enabledSubs} / {subscriptions.length}</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-yellow-100 dark:bg-yellow-900 rounded-lg">
              <Clock className="w-6 h-6 text-yellow-600 dark:text-yellow-300" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Pending</p>
              <p className="text-2xl font-bold">{nodeCounts.pending}</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-300" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Verified</p>
              <p className="text-2xl font-bold">{nodeCounts.verified}</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <Archive className="w-6 h-6 text-gray-600 dark:text-gray-300" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Archived</p>
              <p className="text-2xl font-bold">{nodeCounts.archived}</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg">
              <HardDrive className="w-6 h-6 text-green-600 dark:text-green-300" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Nodes</p>
              <p className="text-2xl font-bold">{totalNodes}</p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* System Resources */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-lg">
              <Cpu className="w-6 h-6 text-purple-600 dark:text-purple-300" />
            </div>
            <div>
              <p className="text-sm text-gray-500">sbm Resources</p>
              <p className="text-lg font-bold">
                {systemInfo?.sbm ? (
                  <>
                    <span className="text-sm font-normal text-gray-500">CPU </span>
                    {systemInfo.sbm.cpu_percent.toFixed(1)}%
                    <span className="text-sm font-normal text-gray-500 ml-2">Mem </span>
                    {systemInfo.sbm.memory_mb.toFixed(1)}MB
                  </>
                ) : '-'}
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-orange-100 dark:bg-orange-900 rounded-lg">
              <Activity className="w-6 h-6 text-orange-600 dark:text-orange-300" />
            </div>
            <div>
              <p className="text-sm text-gray-500">sing-box Resources</p>
              <p className="text-lg font-bold">
                {serviceStatus?.running && systemInfo?.singbox ? (
                  <>
                    <span className="text-sm font-normal text-gray-500">CPU </span>
                    {systemInfo.singbox.cpu_percent.toFixed(1)}%
                    <span className="text-sm font-normal text-gray-500 ml-2">Mem </span>
                    {systemInfo.singbox.memory_mb.toFixed(1)}MB
                  </>
                ) : (
                  <span className="text-gray-400">Not running</span>
                )}
              </p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Subscription overview */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Subscription Overview</h2>
        </CardHeader>
        <CardBody>
          {subscriptions.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No subscriptions yet. Go to the Nodes page to add one.</p>
          ) : (
            <div className="space-y-3">
              {subscriptions.map((sub) => (
                <div key={sub.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Chip size="sm" color={sub.enabled ? 'success' : 'default'} variant="dot">{sub.name}</Chip>
                    <span className="text-sm text-gray-500">{sub.node_count} nodes</span>
                  </div>
                  <span className="text-sm text-gray-400">Updated {new Date(sub.updated_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

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
