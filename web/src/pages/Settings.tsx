import { useEffect, useState, useRef } from 'react';
import { Card, CardBody, CardHeader, Input, Button, Switch, Chip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Select, SelectItem, Progress, Textarea, useDisclosure } from '@nextui-org/react';
import { Save, Download, Upload, Terminal, CheckCircle, AlertCircle, Plus, Pencil, Trash2, Server, Eye, EyeOff, Copy, RefreshCw, Wifi } from 'lucide-react';
import { useStore } from '../store';
import type { Settings as SettingsType, HostEntry } from '../store';
import { daemonApi, kernelApi, settingsApi } from '../api';
import { toast } from '../components/Toast';

// Kernel info type
interface KernelInfo {
  installed: boolean;
  version: string;
  path: string;
  os: string;
  arch: string;
}

// Download progress type
interface DownloadProgress {
  status: 'idle' | 'preparing' | 'downloading' | 'extracting' | 'installing' | 'completed' | 'error';
  progress: number;
  message: string;
  downloaded?: number;
  total?: number;
}

// GitHub Release type
interface GithubRelease {
  tag_name: string;
  name: string;
}

export default function Settings() {
  const { settings, fetchSettings, updateSettings } = useStore();
  const [formData, setFormData] = useState<SettingsType | null>(null);
  const [daemonStatus, setDaemonStatus] = useState<{ installed: boolean; running: boolean; supported: boolean } | null>(null);

  // Kernel related state
  const [kernelInfo, setKernelInfo] = useState<KernelInfo | null>(null);
  const [releases, setReleases] = useState<GithubRelease[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hosts related state
  const [systemHosts, setSystemHosts] = useState<HostEntry[]>([]);
  const { isOpen: isHostModalOpen, onOpen: onHostModalOpen, onClose: onHostModalClose } = useDisclosure();
  const [editingHost, setEditingHost] = useState<HostEntry | null>(null);
  const [hostFormData, setHostFormData] = useState({ domain: '', enabled: true });
  const [ipsText, setIpsText] = useState('');

  // Secret visibility state
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchDaemonStatus();
    fetchKernelInfo();
    fetchSystemHosts();
  }, []);

  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

  // Cleanup polling timer
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const fetchKernelInfo = async () => {
    try {
      const res = await kernelApi.getInfo();
      setKernelInfo(res.data.data);
    } catch (error) {
      console.error('Failed to fetch kernel info:', error);
    }
  };

  const fetchSystemHosts = async () => {
    try {
      const res = await settingsApi.getSystemHosts();
      setSystemHosts(res.data.data || []);
    } catch (error) {
      console.error('Failed to fetch system hosts:', error);
    }
  };

  // Hosts handler functions
  const handleAddHost = () => {
    setEditingHost(null);
    setHostFormData({ domain: '', enabled: true });
    setIpsText('');
    onHostModalOpen();
  };

  const handleEditHost = (host: HostEntry) => {
    setEditingHost(host);
    setHostFormData({ domain: host.domain, enabled: host.enabled });
    setIpsText(host.ips.join('\n'));
    onHostModalOpen();
  };

  const handleDeleteHost = (id: string) => {
    if (!formData?.hosts) return;
    setFormData({
      ...formData,
      hosts: formData.hosts.filter(h => h.id !== id)
    });
  };

  const handleToggleHost = (id: string, enabled: boolean) => {
    if (!formData?.hosts) return;
    setFormData({
      ...formData,
      hosts: formData.hosts.map(h => h.id === id ? { ...h, enabled } : h)
    });
  };

  const handleSubmitHost = () => {
    const ips = ipsText.split('\n').map(ip => ip.trim()).filter(ip => ip);

    // Validate IP format
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([a-fA-F0-9:]+)$/;
    const invalidIps = ips.filter(ip => !ipv4Regex.test(ip) && !ipv6Regex.test(ip));
    if (invalidIps.length > 0) {
      toast.error(`Invalid IP address: ${invalidIps.join(', ')}`);
      return;
    }

    // Validate domain format
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
    if (!domainRegex.test(hostFormData.domain)) {
      toast.error('Invalid domain format');
      return;
    }

    if (ips.length === 0) {
      toast.error('Please enter at least one IP address');
      return;
    }

    const hosts = formData?.hosts || [];

    if (editingHost) {
      // Edit mode
      setFormData({
        ...formData!,
        hosts: hosts.map(h => h.id === editingHost.id
          ? { ...h, domain: hostFormData.domain, ips, enabled: hostFormData.enabled }
          : h
        )
      });
    } else {
      // Add mode
      const newHost: HostEntry = {
        id: crypto.randomUUID(),
        domain: hostFormData.domain,
        ips,
        enabled: hostFormData.enabled,
      };
      setFormData({
        ...formData!,
        hosts: [...hosts, newHost]
      });
    }

    onHostModalClose();
  };

  const fetchDaemonStatus = async () => {
    try {
      const res = await daemonApi.status();
      setDaemonStatus(res.data.data);
    } catch (error) {
      console.error('Failed to fetch daemon status:', error);
    }
  };

  const fetchReleases = async () => {
    try {
      const res = await kernelApi.getReleases();
      setReleases(res.data.data || []);
      if (res.data.data && res.data.data.length > 0) {
        setSelectedVersion(res.data.data[0].tag_name);
      }
    } catch (error) {
      console.error('Failed to fetch release list:', error);
    }
  };

  // Copy secret to clipboard (compatible with non-HTTPS environments)
  const handleCopySecret = () => {
    if (!formData?.clash_api_secret) return;

    const text = formData.clash_api_secret;

    // Try modern API first
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        toast.success('Secret copied to clipboard');
      }).catch(() => {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  };

  // Fallback copy method (supports non-HTTPS environments)
  const fallbackCopy = (text: string) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      const success = document.execCommand('copy');
      if (success) {
        toast.success('Secret copied to clipboard');
      } else {
        toast.error('Copy failed');
      }
    } catch {
      toast.error('Copy failed');
    } finally {
      document.body.removeChild(textarea);
    }
  };

  // Generate new random secret
  const handleGenerateSecret = () => {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let secret = '';
    for (let i = 0; i < 16; i++) {
      secret += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    setFormData({ ...formData!, clash_api_secret: secret });
    toast.success('New secret generated, please save settings');
  };

  const handleSave = async () => {
    if (formData) {
      try {
        await updateSettings(formData);
        toast.success('Settings saved');
      } catch (error: any) {
        toast.error(error.response?.data?.error || 'Failed to save settings');
      }
    }
  };

  const handleInstallDaemon = async () => {
    try {
      const res = await daemonApi.install();
      const data = res.data;
      if (data.action === 'exit') {
        toast.success(data.message);
      } else if (data.action === 'manual') {
        toast.info(data.message);
      } else {
        toast.success(data.message || 'Service installed');
      }
      await fetchDaemonStatus();
    } catch (error: any) {
      console.error('Failed to install daemon service:', error);
      toast.error(error.response?.data?.error || 'Failed to install service');
    }
  };

  const handleUninstallDaemon = async () => {
    if (confirm('Are you sure you want to uninstall the background service? After uninstalling, sbm will no longer start on boot.')) {
      try {
        await daemonApi.uninstall();
        toast.success('Service uninstalled');
        await fetchDaemonStatus();
      } catch (error: any) {
        console.error('Failed to uninstall daemon service:', error);
        toast.error(error.response?.data?.error || 'Failed to uninstall service');
      }
    }
  };

  const handleRestartDaemon = async () => {
    try {
      await daemonApi.restart();
      toast.success('Service restarted');
      await fetchDaemonStatus();
    } catch (error: any) {
      console.error('Failed to restart daemon service:', error);
      toast.error(error.response?.data?.error || 'Failed to restart service');
    }
  };

  const openDownloadModal = async () => {
    await fetchReleases();
    setDownloadProgress(null);
    setShowDownloadModal(true);
  };

  const startDownload = async () => {
    if (!selectedVersion) return;

    setDownloading(true);
    setDownloadProgress({ status: 'preparing', progress: 0, message: 'Preparing download...' });

    try {
      await kernelApi.download(selectedVersion);

      // Start polling progress
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await kernelApi.getProgress();
          const progress = res.data.data;
          setDownloadProgress(progress);

          if (progress.status === 'completed' || progress.status === 'error') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setDownloading(false);

            if (progress.status === 'completed') {
              await fetchKernelInfo();
              setTimeout(() => setShowDownloadModal(false), 1500);
            }
          }
        } catch (error) {
          console.error('Failed to fetch progress:', error);
        }
      }, 500);
    } catch (error: any) {
      setDownloading(false);
      setDownloadProgress({
        status: 'error',
        progress: 0,
        message: error.response?.data?.error || 'Download failed',
      });
    }
  };

  if (!formData) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Settings</h1>
        <Button
          color="primary"
          startContent={<Save className="w-4 h-4" />}
          onPress={handleSave}
        >
          Save Settings
        </Button>
      </div>

      {/* sing-box Configuration */}
      <Card>
        <CardHeader>
          <Terminal className="w-5 h-5 mr-2" />
          <h2 className="text-lg font-semibold">sing-box Configuration</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          {/* Kernel Status */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-default-100">
            <div className="flex items-center gap-3">
              {kernelInfo?.installed ? (
                <>
                  <CheckCircle className="w-5 h-5 text-success" />
                  <div>
                    <p className="font-medium">sing-box Installed</p>
                    <p className="text-sm text-gray-500">
                      Version: {kernelInfo.version || 'Unknown'} | Platform: {kernelInfo.os}/{kernelInfo.arch}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle className="w-5 h-5 text-warning" />
                  <div>
                    <p className="font-medium text-warning">sing-box Not Installed</p>
                    <p className="text-sm text-gray-500">
                      You need to download the sing-box kernel to use proxy features
                    </p>
                  </div>
                </>
              )}
            </div>
            <Button
              color={kernelInfo?.installed ? 'default' : 'primary'}
              variant={kernelInfo?.installed ? 'flat' : 'solid'}
              startContent={<Download className="w-4 h-4" />}
              onPress={openDownloadModal}
            >
              {kernelInfo?.installed ? 'Update Kernel' : 'Download Kernel'}
            </Button>
          </div>

          <Input
            label="Config File Path"
            placeholder="generated/config.json"
            value={formData.config_path}
            onChange={(e) => setFormData({ ...formData, config_path: e.target.value })}
          />
          <Input
            label="GitHub Proxy URL"
            placeholder="e.g. https://ghproxy.com/"
            description="Used to accelerate GitHub downloads, leave empty for direct connection"
            value={formData.github_proxy || ''}
            onChange={(e) => setFormData({ ...formData, github_proxy: e.target.value })}
          />
        </CardBody>
      </Card>

      {/* Inbound Configuration */}
      <Card>
        <CardHeader>
          <Download className="w-5 h-5 mr-2" />
          <h2 className="text-lg font-semibold">Inbound Configuration</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <Input
            type="number"
            label="Mixed Proxy Port"
            placeholder="2080"
            value={String(formData.mixed_port)}
            onChange={(e) => setFormData({ ...formData, mixed_port: parseInt(e.target.value) || 2080 })}
          />
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">TUN Mode</p>
              <p className="text-sm text-gray-500">Enable TUN mode for transparent proxying</p>
            </div>
            <Switch
              isSelected={formData.tun_enabled}
              onValueChange={(enabled) => setFormData({ ...formData, tun_enabled: enabled })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium flex items-center gap-2">
                <Wifi className="w-4 h-4" />
                Allow LAN Access
              </p>
              <p className="text-sm text-gray-500">Allow other devices on the LAN to access the internet through this proxy</p>
            </div>
            <Switch
              isSelected={formData.allow_lan}
              onValueChange={(enabled) => {
                const updates: Partial<typeof formData> = { allow_lan: enabled };
                if (enabled) {
                  // Auto-generate secret when enabling LAN access and secret is empty
                  if (!formData.clash_api_secret) {
                    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                    let secret = '';
                    for (let i = 0; i < 16; i++) {
                      secret += charset.charAt(Math.floor(Math.random() * charset.length));
                    }
                    updates.clash_api_secret = secret;
                  }
                } else {
                  // Clear secret when disabling LAN access
                  updates.clash_api_secret = '';
                }
                setFormData({ ...formData, ...updates });
              }}
            />
          </div>

          {/* ClashAPI Secret - only shown when LAN access is enabled */}
          {formData.allow_lan && (
            <div className="p-4 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
              <div className="flex items-center gap-2 mb-2">
                <p className="font-medium text-warning-700 dark:text-warning-400">ClashAPI Secret</p>
                <Chip size="sm" color="warning" variant="flat">Security</Chip>
              </div>
              <p className="text-sm text-warning-600 dark:text-warning-500 mb-3">
                This secret is used for authentication when connecting external UIs. Please keep it safe.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type={showSecret ? "text" : "password"}
                  value={formData.clash_api_secret || ''}
                  onChange={(e) => setFormData({ ...formData, clash_api_secret: e.target.value })}
                  placeholder="Will be auto-generated after saving settings"
                  size="sm"
                  className="flex-1"
                  endContent={
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      onPress={() => setShowSecret(!showSecret)}
                    >
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  }
                />
                <Button
                  isIconOnly
                  size="sm"
                  variant="flat"
                  onPress={handleCopySecret}
                  isDisabled={!formData.clash_api_secret}
                  title="Copy Secret"
                >
                  <Copy className="w-4 h-4" />
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="flat"
                  onPress={handleGenerateSecret}
                  title="Regenerate"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* DNS Configuration */}
      <Card>
        <CardHeader>
          <Upload className="w-5 h-5 mr-2" />
          <h2 className="text-lg font-semibold">DNS Configuration</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <Input
            label="Proxy DNS"
            placeholder="https://1.1.1.1/dns-query"
            value={formData.proxy_dns}
            onChange={(e) => setFormData({ ...formData, proxy_dns: e.target.value })}
          />
          <Input
            label="Direct DNS"
            placeholder="https://dns.alidns.com/dns-query"
            value={formData.direct_dns}
            onChange={(e) => setFormData({ ...formData, direct_dns: e.target.value })}
          />

          {/* Hosts Mapping */}
          <div className="mt-6 pt-4 border-t border-divider">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-medium">Hosts Mapping</h3>
                <p className="text-sm text-gray-500">Custom domain resolution (only applies to Sing-Box)</p>
              </div>
              <Button
                color="primary"
                size="sm"
                startContent={<Plus className="w-4 h-4" />}
                onPress={handleAddHost}
              >
                Add
              </Button>
            </div>

            {/* User custom hosts */}
            {formData.hosts && formData.hosts.length > 0 && (
              <div className="mb-4">
                <p className="text-sm text-gray-500 mb-2">Custom Mappings</p>
                {formData.hosts.map((host) => (
                  <div
                    key={host.id}
                    className="flex items-center justify-between p-3 bg-default-100 rounded-lg mb-2"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Server className="w-4 h-4 text-gray-500" />
                        <span className="font-medium">{host.domain}</span>
                        {!host.enabled && <Chip size="sm" variant="flat">Disabled</Chip>}
                      </div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {host.ips.map((ip, idx) => (
                          <Chip key={idx} size="sm" variant="bordered">{ip}</Chip>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button isIconOnly size="sm" variant="light" onPress={() => handleEditHost(host)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => handleDeleteHost(host.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                      <Switch
                        size="sm"
                        isSelected={host.enabled}
                        onValueChange={(enabled) => handleToggleHost(host.id, enabled)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* System hosts (read-only) */}
            {systemHosts.length > 0 && (
              <div>
                <p className="text-sm text-gray-500 mb-2">
                  System hosts <Chip size="sm" variant="flat">Read-only</Chip>
                </p>
                {systemHosts.map((host) => (
                  <div
                    key={host.id}
                    className="flex items-center justify-between p-3 bg-default-100 rounded-lg mb-2"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Server className="w-4 h-4 text-gray-500" />
                        <span className="font-medium">{host.domain}</span>
                        <Chip size="sm" color="secondary" variant="flat">System</Chip>
                      </div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {host.ips.map((ip, idx) => (
                          <Chip key={idx} size="sm" variant="bordered">{ip}</Chip>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {(!formData.hosts || formData.hosts.length === 0) && systemHosts.length === 0 && (
              <p className="text-gray-500 text-center py-4">No hosts mappings</p>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Control Panel Configuration */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Control Panel</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <Input
            type="number"
            label="Web Management Port"
            placeholder="9090"
            disabled
            value={String(formData.web_port)}
            onChange={(e) => setFormData({ ...formData, web_port: parseInt(e.target.value) || 9090 })}
          />
          <Input
            type="number"
            label="Clash API Port"
            placeholder="9091"
            value={String(formData.clash_api_port)}
            onChange={(e) => setFormData({ ...formData, clash_api_port: parseInt(e.target.value) || 9091 })}
          />
          <Input
            label="Final Outbound"
            placeholder="Proxy"
            value={formData.final_outbound}
            onChange={(e) => setFormData({ ...formData, final_outbound: e.target.value })}
          />
        </CardBody>
      </Card>

      {/* Automation Settings */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Automation</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Auto-apply after config changes</p>
              <p className="text-sm text-gray-500">Automatically restart sing-box after subscription refresh or rule changes</p>
            </div>
            <Switch
              isSelected={formData.auto_apply}
              onValueChange={(enabled) => setFormData({ ...formData, auto_apply: enabled })}
            />
          </div>
          <Input
            type="number"
            label="Subscription Auto-update Interval (minutes)"
            placeholder="60"
            description="Set to 0 to disable auto-update"
            value={String(formData.subscription_interval)}
            onChange={(e) => setFormData({ ...formData, subscription_interval: parseInt(e.target.value) || 0 })}
          />
        </CardBody>
      </Card>

      {/* Background Service Management */}
      {daemonStatus?.supported && (
        <Card>
          <CardHeader className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Background Service</h2>
            {daemonStatus && (
              <Chip
                color={daemonStatus.installed ? 'success' : 'default'}
                variant="flat"
                size="sm"
              >
                {daemonStatus.installed ? 'Installed' : 'Not Installed'}
              </Chip>
            )}
          </CardHeader>
          <CardBody>
            <p className="text-sm text-gray-500 mb-4">
              Installing the background service allows the sbm manager to run in the background. The web management interface remains accessible after closing the terminal. The service will auto-start on boot and automatically restart after crashes.
            </p>
            <div className="flex gap-2">
              {daemonStatus?.installed ? (
                <>
                  <Button
                    color="primary"
                    variant="flat"
                    onPress={handleRestartDaemon}
                  >
                    Restart Service
                  </Button>
                  <Button
                    color="danger"
                    variant="flat"
                    onPress={handleUninstallDaemon}
                  >
                    Uninstall Service
                  </Button>
                </>
              ) : (
                <Button
                  color="primary"
                  onPress={handleInstallDaemon}
                >
                  Install Background Service
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Download Kernel Modal */}
      <Modal isOpen={showDownloadModal} onClose={() => !downloading && setShowDownloadModal(false)}>
        <ModalContent>
          <ModalHeader>Download sing-box Kernel</ModalHeader>
          <ModalBody>
            <Select
              label="Select Version"
              placeholder="Select the version to download"
              selectedKeys={selectedVersion ? [selectedVersion] : []}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as string;
                if (selected) setSelectedVersion(selected);
              }}
              isDisabled={downloading}
            >
              {releases.map((release) => (
                <SelectItem key={release.tag_name} textValue={release.tag_name}>
                  {release.tag_name} {release.name && `- ${release.name}`}
                </SelectItem>
              ))}
            </Select>

            {kernelInfo && (
              <p className="text-sm text-gray-500">
                Will download the version for {kernelInfo.os}/{kernelInfo.arch}
              </p>
            )}

            {downloadProgress && (
              <div className="mt-4 space-y-2">
                <Progress
                  value={downloadProgress.progress}
                  color={downloadProgress.status === 'error' ? 'danger' : downloadProgress.status === 'completed' ? 'success' : 'primary'}
                  showValueLabel
                />
                <p className={`text-sm ${downloadProgress.status === 'error' ? 'text-danger' : downloadProgress.status === 'completed' ? 'text-success' : 'text-gray-600'}`}>
                  {downloadProgress.message}
                </p>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => setShowDownloadModal(false)}
              isDisabled={downloading}
            >
              Cancel
            </Button>
            <Button
              color="primary"
              onPress={startDownload}
              isLoading={downloading}
              isDisabled={!selectedVersion || downloading}
            >
              Start Download
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Hosts Edit Modal */}
      <Modal isOpen={isHostModalOpen} onClose={onHostModalClose}>
        <ModalContent>
          <ModalHeader>{editingHost ? 'Edit Host' : 'Add Host'}</ModalHeader>
          <ModalBody className="gap-4">
            <Input
              label="Domain"
              placeholder="e.g. example.com"
              value={hostFormData.domain}
              onChange={(e) => setHostFormData({ ...hostFormData, domain: e.target.value })}
            />
            <Textarea
              label="IP Addresses"
              placeholder={"One IP address per line\ne.g.:\n192.168.1.1\n192.168.1.2"}
              value={ipsText}
              onChange={(e) => setIpsText(e.target.value)}
              minRows={3}
            />
            <div className="flex items-center justify-between">
              <span>Enabled</span>
              <Switch
                isSelected={hostFormData.enabled}
                onValueChange={(enabled) => setHostFormData({ ...hostFormData, enabled })}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onHostModalClose}>Cancel</Button>
            <Button
              color="primary"
              onPress={handleSubmitHost}
              isDisabled={!hostFormData.domain || !ipsText.trim()}
            >
              {editingHost ? 'Save' : 'Add'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
