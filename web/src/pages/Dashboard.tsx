import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, CardHeader, Button, Chip, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Play, Square, RefreshCw, Cpu, HardDrive, Wifi, Info, Activity, Copy, ClipboardCheck, Link, Globe, QrCode, Search, Stethoscope } from 'lucide-react';
import { useStore } from '../store';
import { serviceApi, configApi, proxyApi } from '../api';
import { toast } from '../components/Toast';

export default function Dashboard() {
  const { serviceStatus, probeStatus, subscriptions, manualNodes, systemInfo, settings, proxyGroups, fetchServiceStatus, fetchProbeStatus, stopProbe, fetchSubscriptions, fetchManualNodes, fetchSystemInfo, fetchSettings, fetchUnsupportedNodes, fetchProxyGroups, switchProxy } = useStore();

  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [qrLink, setQrLink] = useState<string | null>(null);
  const [proxySearch, setProxySearch] = useState('');
  const [activeProxyDelay, setActiveProxyDelay] = useState<number | null>(null);
  const [checkingActiveProxyDelay, setCheckingActiveProxyDelay] = useState(false);
  const activeProxyDelayRequestRef = useRef(0);

  // Error modal state
  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: '',
    message: ''
  });

  // Helper function to display errors
  const showError = (title: string, error: any) => {
    const message = error.response?.data?.error || error.message || 'Operation failed';
    setErrorModal({
      isOpen: true,
      title,
      message
    });
  };

  useEffect(() => {
    fetchServiceStatus();
    fetchProbeStatus();
    fetchSubscriptions();
    fetchManualNodes();
    fetchSystemInfo();
    fetchSettings();
    fetchProxyGroups();

    // Refresh status, system info, proxy groups, and probe status every 5 seconds
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

  const totalNodes = subscriptions.reduce((sum, sub) => sum + sub.node_count, 0) + manualNodes.length;
  const enabledSubs = subscriptions.filter(sub => sub.enabled).length;
  const enabledManualNodes = manualNodes.filter(mn => mn.enabled).length;
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
                <Button
                  size="sm"
                  color="danger"
                  variant="flat"
                  startContent={<Square className="w-4 h-4" />}
                  onPress={handleStop}
                >
                  Stop
                </Button>
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  startContent={<RefreshCw className="w-4 h-4" />}
                  onPress={handleRestart}
                >
                  Restart
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                color="success"
                startContent={<Play className="w-4 h-4" />}
                onPress={handleStart}
              >
                Start
              </Button>
            )}
            <Button
              size="sm"
              color="primary"
              onPress={handleApplyConfig}
            >
              Apply Config
            </Button>
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
                  <Tooltip
                    content={
                      <div className="max-w-xs whitespace-pre-wrap text-xs p-1">
                        {serviceStatus.version}
                      </div>
                    }
                    placement="bottom"
                  >
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
              <p className="font-medium">
                {serviceStatus?.running ? 'Running normally' : 'Not running'}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Probe sing-box status */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <Stethoscope className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Probe sing-box</h2>
            <Chip
              color={probeStatus?.running ? 'success' : 'default'}
              variant="flat"
              size="sm"
            >
              {probeStatus?.running ? 'Running' : 'Stopped'}
            </Chip>
          </div>
          {probeStatus?.running && (
            <Button
              size="sm"
              color="danger"
              variant="flat"
              startContent={<Square className="w-4 h-4" />}
              onPress={stopProbe}
            >
              Stop
            </Button>
          )}
        </CardHeader>
        {probeStatus?.running && (
          <CardBody>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-gray-500">PID</p>
                <p className="font-medium">{probeStatus.pid}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Clash API Port</p>
                <p className="font-medium">{probeStatus.port}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Nodes</p>
                <p className="font-medium">{probeStatus.node_count}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Uptime</p>
                <p className="font-medium">
                  {probeStatus.started_at
                    ? (() => {
                        const seconds = Math.floor((Date.now() - new Date(probeStatus.started_at).getTime()) / 1000);
                        if (seconds < 60) return `${seconds}s`;
                        const minutes = Math.floor(seconds / 60);
                        if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
                        const hours = Math.floor(minutes / 60);
                        return `${hours}h ${minutes % 60}m`;
                      })()
                    : '-'}
                </p>
              </div>
            </div>
          </CardBody>
        )}
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
                    color={
                      activeProxyDelay === null
                        ? 'default'
                        : activeProxyDelay > 0
                          ? (activeProxyDelay < 300 ? 'success' : 'warning')
                          : 'danger'
                    }
                  >
                    {activeProxyDelay === null ? 'Ping: N/A' : activeProxyDelay > 0 ? `Ping: ${activeProxyDelay}ms` : 'Ping: Timeout'}
                  </Chip>
                  <Button
                    size="sm"
                    variant="flat"
                    isIconOnly
                    isLoading={checkingActiveProxyDelay}
                    onPress={() => checkActiveProxyDelay(mainProxyGroup.now)}
                    aria-label="Recheck active proxy ping"
                  >
                    <Activity className="w-4 h-4" />
                  </Button>
                </div>
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
                classNames={{
                  trigger: 'min-h-14',
                  value: 'text-base',
                }}
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

      {/* Proxy Links */}
      {proxyLinks.length === 0 ? (
        <Card>
          <CardBody className="flex flex-row items-center gap-2 py-3">
            <Link className="w-5 h-5 text-gray-400" />
            <span className="font-semibold">Proxy Links</span>
            <span className="text-gray-500 text-sm">— Set proxy addresses in Settings to generate links.</span>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Link className="w-5 h-5" />
              <h2 className="text-lg font-semibold">Proxy Links</h2>
            </div>
          </CardHeader>
          <CardBody>
            <div className="space-y-2">
              {proxyLinks.map((item) => (
                <div
                  key={item.key}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                >
                  <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
                    <Chip size="sm" variant="flat" color="primary">{item.label}</Chip>
                    <code className="text-sm text-gray-600 dark:text-gray-300 truncate">{item.link}</code>
                  </div>
                  <div className="flex items-center gap-1 self-end sm:self-auto">
                    {item.key === 'ss' && (
                      <Button
                        size="sm"
                        variant="light"
                        isIconOnly
                        onPress={() => setQrLink(item.link)}
                        aria-label="Show Shadowsocks QR code"
                      >
                        <QrCode className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="light"
                      isIconOnly
                      onPress={() => handleCopyLink(item.key, item.link)}
                    >
                      {copiedLink === item.key ? (
                        <ClipboardCheck className="w-4 h-4 text-success" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

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
            <div className="p-3 bg-cyan-100 dark:bg-cyan-900 rounded-lg">
              <HardDrive className="w-6 h-6 text-cyan-600 dark:text-cyan-300" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Manual Nodes</p>
              <p className="text-2xl font-bold">{enabledManualNodes} / {manualNodes.length}</p>
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

      {/* Subscription list preview */}
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
                <div
                  key={sub.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Chip
                      size="sm"
                      color={sub.enabled ? 'success' : 'default'}
                      variant="dot"
                    >
                      {sub.name}
                    </Chip>
                    <span className="text-sm text-gray-500">
                      {sub.node_count} nodes
                    </span>
                  </div>
                  <span className="text-sm text-gray-400">
                    Updated {new Date(sub.updated_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Manual nodes list preview */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Manual Nodes Overview</h2>
        </CardHeader>
        <CardBody>
          {manualNodes.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No manual nodes yet. Go to the Nodes page to add one.</p>
          ) : (
            <div className="space-y-3">
              {manualNodes.map((mn) => (
                <div
                  key={mn.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Chip
                      size="sm"
                      color={mn.enabled ? 'success' : 'default'}
                      variant="dot"
                    >
                      {mn.node.country_emoji && `${mn.node.country_emoji} `}{mn.node.tag}
                    </Chip>
                    <span className="text-sm text-gray-500">
                      {mn.node.type}
                    </span>
                  </div>
                  <span className="text-sm text-gray-400 truncate max-w-full">
                    {mn.node.server}:{mn.node.server_port}
                  </span>
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
            <Button color="primary" onPress={() => setErrorModal({ ...errorModal, isOpen: false })}>
              OK
            </Button>
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
                <img
                  src={qrImageUrl}
                  alt="Shadowsocks QR code"
                  className="w-64 h-64 rounded-md border border-gray-200 dark:border-gray-700"
                  loading="lazy"
                />
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
            <Button color="primary" onPress={() => setQrLink(null)}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
