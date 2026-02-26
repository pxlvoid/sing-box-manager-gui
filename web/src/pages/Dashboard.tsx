import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, CardHeader, Button, Chip, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tooltip, Select, SelectItem, Spinner, Progress } from '@nextui-org/react';
import { Play, Square, RefreshCw, Cpu, HardDrive, Wifi, Info, Activity, Copy, ClipboardCheck, Link, Globe, QrCode, Search, Stethoscope, ShieldCheck, Clock, CheckCircle, Archive } from 'lucide-react';
import { useStore } from '../store';
import type { NodeSiteCheckResult } from '../store';
import { shortSiteLabel } from '../features/nodes/types';
import { serviceApi, configApi, proxyApi } from '../api';
import { toast } from '../components/Toast';

export default function Dashboard() {
  const {
    serviceStatus, probeStatus, subscriptions, nodeCounts, systemInfo, settings, proxyGroups,
    verificationStatus, verificationRunning,
    healthResults, siteCheckResults,
    pipelineEvents, verificationProgress, runCounters,
    fetchServiceStatus, fetchProbeStatus, stopProbe, fetchSubscriptions,
    fetchNodeCounts, fetchSystemInfo, fetchSettings, fetchUnsupportedNodes,
    fetchProxyGroups, switchProxy, runVerification, fetchVerificationStatus,
    startVerificationScheduler, stopVerificationScheduler,
    fetchLatestMeasurements, fetchPipelineEvents,
  } = useStore();

  const activityFeedRef = useRef<HTMLDivElement>(null);

  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [qrLink, setQrLink] = useState<string | null>(null);
  const [proxyLinksOpen, setProxyLinksOpen] = useState(false);
  const [proxySearch, setProxySearch] = useState('');
  const [activeProxyDelay, setActiveProxyDelay] = useState<number | null>(null);
  const [checkingActiveProxyDelay, setCheckingActiveProxyDelay] = useState(false);
  const activeProxyDelayRequestRef = useRef(0);

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
  const qrImageUrl = qrLink ? `https://quickchart.io/qr?text=${encodeURIComponent(qrLink)}&size=260` : '';

  const normalizedProxySearch = proxySearch.trim().toLowerCase();
  const hasSearchMatches = !normalizedProxySearch || !!mainProxyGroup?.all.some((item) =>
    item.toLowerCase().includes(normalizedProxySearch),
  );
  const filteredMainProxyOptions = useMemo(() => {
    if (!mainProxyGroup) return [];
    const matchedOptions = normalizedProxySearch
      ? mainProxyGroup.all.filter((item) => item.toLowerCase().includes(normalizedProxySearch))
      : mainProxyGroup.all;

    if (mainProxyGroup.now && !matchedOptions.includes(mainProxyGroup.now)) {
      return [mainProxyGroup.now, ...matchedOptions];
    }
    return matchedOptions;
  }, [mainProxyGroup, normalizedProxySearch]);

  const checkActiveProxyDelay = useCallback(async (proxyName: string) => {
    const requestId = ++activeProxyDelayRequestRef.current;
    setCheckingActiveProxyDelay(true);
    try {
      const res = await proxyApi.checkDelay(proxyName);
      const delay = Number(res.data?.data?.delay) || 0;
      if (requestId === activeProxyDelayRequestRef.current) {
        setActiveProxyDelay(delay);
      }
    } catch (error) {
      if (requestId === activeProxyDelayRequestRef.current) {
        setActiveProxyDelay(null);
      }
      console.error('Failed to check proxy delay:', error);
    } finally {
      if (requestId === activeProxyDelayRequestRef.current) {
        setCheckingActiveProxyDelay(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!serviceStatus?.running || !mainProxyGroup?.now) {
      activeProxyDelayRequestRef.current += 1;
      setActiveProxyDelay(null);
      setCheckingActiveProxyDelay(false);
      return;
    }
    checkActiveProxyDelay(mainProxyGroup.now);
  }, [serviceStatus?.running, mainProxyGroup?.now, checkActiveProxyDelay]);

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
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-base whitespace-nowrap">Main</span>
                  <Chip size="sm" variant="flat">{mainProxyGroup.now}</Chip>
                </div>
                <div className="flex items-center gap-2">
                  <Chip
                    size="sm"
                    variant="flat"
                    color={activeProxyDelay === null ? 'default' : activeProxyDelay > 0 ? (activeProxyDelay < 300 ? 'success' : 'warning') : 'danger'}
                  >
                    {activeProxyDelay === null ? 'Ping: N/A' : activeProxyDelay > 0 ? `Ping: ${activeProxyDelay}ms` : 'Ping: Timeout'}
                  </Chip>
                  <Button size="sm" variant="flat" isIconOnly isLoading={checkingActiveProxyDelay} onPress={() => checkActiveProxyDelay(mainProxyGroup.now)} aria-label="Recheck active proxy ping">
                    <Activity className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Health & Site check results for active proxy */}
              {(() => {
                const activeTag = mainProxyGroup.now;
                const health = healthResults[activeTag];
                const siteResult: NodeSiteCheckResult | undefined = siteCheckResults[activeTag];
                if (!health && !siteResult) return null;
                return (
                  <div className="flex flex-wrap gap-1">
                    {health && (
                      <Chip size="sm" variant="flat" color={health.alive ? 'success' : 'danger'}>
                        {health.alive ? (health.tcp_latency_ms > 0 ? `Health: ${health.tcp_latency_ms}ms` : 'Health: OK') : 'Health: Fail'}
                      </Chip>
                    )}
                    {siteResult && Object.entries(siteResult.sites).map(([site, delay]) => (
                      <Chip
                        key={site}
                        size="sm"
                        variant="flat"
                        color={delay > 0 ? (delay < 800 ? 'success' : 'warning') : 'danger'}
                      >
                        {shortSiteLabel(site)}: {delay > 0 ? `${delay}ms` : 'Fail'}
                      </Chip>
                    ))}
                  </div>
                );
              })()}

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
                {filteredMainProxyOptions.map((item) => (
                  <SelectItem key={item}>{item}</SelectItem>
                ))}
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
