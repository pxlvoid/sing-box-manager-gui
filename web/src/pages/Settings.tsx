import { useEffect, useState, useRef, useCallback } from 'react';
import { Accordion, AccordionItem, Input, Button, Switch, Chip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Select, SelectItem, Progress, Textarea, useDisclosure } from '@nextui-org/react';
import { Download, Upload, Terminal, CheckCircle, AlertCircle, Plus, Pencil, Trash2, Server, Eye, EyeOff, Copy, RefreshCw, Wifi, Undo2, Loader2, Check, Database, HardDriveDownload, HardDriveUpload } from 'lucide-react';
import { useStore } from '../store';
import type { Settings as SettingsType, HostEntry } from '../store';
import { daemonApi, databaseApi, kernelApi, settingsApi } from '../api';
import { toast } from '../components/Toast';

// Section definitions for navigation
const SECTIONS = [
  { id: 'singbox', label: 'sing-box', icon: Terminal },
  { id: 'inbound', label: 'Inbound', icon: Download },
  { id: 'dns', label: 'DNS', icon: Upload },
  { id: 'panel', label: 'Control Panel' },
  { id: 'automation', label: 'Automation' },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'debug', label: 'Debug API' },
  { id: 'daemon', label: 'Service' },
] as const;

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

// Undo button component
function UndoButton({ field, formData: _formData, previousSettings, settings, onUndo }: {
  field: keyof SettingsType;
  formData: SettingsType;
  previousSettings: SettingsType | null;
  settings: SettingsType | null;
  onUndo: (field: keyof SettingsType, value: any) => void;
}) {
  if (!previousSettings || !settings) return null;
  // Show undo if the current saved value differs from previous
  if (JSON.stringify(settings[field]) === JSON.stringify(previousSettings[field])) return null;

  return (
    <Button
      isIconOnly
      size="sm"
      variant="light"
      color="warning"
      title="Undo to previous value"
      onPress={() => onUndo(field, previousSettings[field])}
    >
      <Undo2 className="w-3.5 h-3.5" />
    </Button>
  );
}

export default function Settings() {
  const { settings, previousSettings, fetchSettings, updateSettings } = useStore();
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

  // Database import state
  const [dbImporting, setDbImporting] = useState(false);
  const [dbExportSize, setDbExportSize] = useState<string>('');
  const dbFileInputRef = useRef<HTMLInputElement>(null);

  // Secret visibility state
  const [showSecret, setShowSecret] = useState(false);

  // Autosave state
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const initializedRef = useRef(false);

  // Navigation state
  const [activeSection, setActiveSection] = useState<string>('singbox');
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Accordion state persisted in localStorage
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('settings-sections');
      return saved ? new Set(JSON.parse(saved)) : new Set(SECTIONS.map(s => s.id));
    } catch {
      return new Set(SECTIONS.map(s => s.id));
    }
  });

  useEffect(() => {
    localStorage.setItem('settings-sections', JSON.stringify([...expandedKeys]));
  }, [expandedKeys]);

  useEffect(() => {
    fetchSettings();
    fetchDaemonStatus();
    fetchKernelInfo();
    fetchSystemHosts();
    fetchDatabaseStats();
  }, []);

  useEffect(() => {
    if (settings && !initializedRef.current) {
      setFormData(settings);
      initializedRef.current = true;
    } else if (settings && initializedRef.current) {
      // Update formData from server if it changed externally
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

  // Autosave with debounce
  useEffect(() => {
    if (!formData || !settings) return;
    if (!initializedRef.current) return;
    // Don't save if nothing changed
    if (JSON.stringify(formData) === JSON.stringify(settings)) return;

    setSaveStatus('idle');
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await updateSettings(formData);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    }, 1500);

    return () => clearTimeout(saveTimeoutRef.current);
  }, [formData]);

  // IntersectionObserver for active section tracking
  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    const callback = (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const sectionId = entry.target.getAttribute('data-section');
          if (sectionId) setActiveSection(sectionId);
        }
      }
    };

    const observer = new IntersectionObserver(callback, { threshold: 0.3, rootMargin: '-80px 0px 0px 0px' });

    for (const section of SECTIONS) {
      const el = sectionRefs.current[section.id];
      if (el) observer.observe(el);
    }
    observers.push(observer);

    return () => observers.forEach(o => o.disconnect());
  }, [formData, daemonStatus]);

  const scrollToSection = useCallback((sectionId: string) => {
    const el = sectionRefs.current[sectionId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleUndo = useCallback((field: keyof SettingsType, value: any) => {
    if (!formData) return;
    setFormData({ ...formData, [field]: value });
  }, [formData]);

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

  const fetchDatabaseStats = async () => {
    try {
      const res = await databaseApi.stats();
      setDbExportSize(res.data?.data?.export_size_human || '');
    } catch (error) {
      console.error('Failed to fetch database stats:', error);
      setDbExportSize('');
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
      setFormData({
        ...formData!,
        hosts: hosts.map(h => h.id === editingHost.id
          ? { ...h, domain: hostFormData.domain, ips, enabled: hostFormData.enabled }
          : h
        )
      });
    } else {
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

  const handleGenerateSecret = () => {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let secret = '';
    for (let i = 0; i < 16; i++) {
      secret += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    setFormData({ ...formData!, clash_api_secret: secret });
    toast.success('New secret generated');
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

  const handleExportDatabase = () => {
    window.location.href = databaseApi.exportUrl;
  };

  const handleImportDatabase = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm('Importing a database will replace ALL current data (nodes, subscriptions, rules, settings, etc.). Continue?')) {
      e.target.value = '';
      return;
    }

    setDbImporting(true);
    try {
      const res = await databaseApi.import(file);
      toast.success(res.data.message || 'Database imported successfully');
      // Reload the page to reflect new data
      setTimeout(() => window.location.reload(), 1500);
    } catch (error: any) {
      console.error('Failed to import database:', error);
      toast.error(error.response?.data?.error || 'Failed to import database');
    } finally {
      setDbImporting(false);
      e.target.value = '';
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

  // Save status indicator
  const SaveStatusIndicator = () => {
    if (saveStatus === 'saving') {
      return (
        <div className="flex items-center gap-1.5 text-sm text-default-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Saving...</span>
        </div>
      );
    }
    if (saveStatus === 'saved') {
      return (
        <div className="flex items-center gap-1.5 text-sm text-success">
          <Check className="w-3.5 h-3.5" />
          <span>Saved</span>
        </div>
      );
    }
    if (saveStatus === 'error') {
      return (
        <div className="flex items-center gap-1.5 text-sm text-danger">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>Error saving</span>
        </div>
      );
    }
    return null;
  };

  // Filter sections: hide daemon if not supported
  const visibleSections = SECTIONS.filter(s => s.id !== 'daemon' || daemonStatus?.supported);

  return (
    <div className="flex gap-4 sm:gap-6">
      {/* Sticky sidebar navigation — desktop */}
      <nav className="hidden lg:block w-48 shrink-0">
        <div className="sticky top-4 space-y-1">
          {visibleSections.map((section) => {
            const Icon = 'icon' in section ? section.icon : null;
            return (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                  activeSection === section.id
                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-medium'
                    : 'text-default-600 hover:bg-default-100 dark:hover:bg-default-50/10'
                }`}
              >
                {Icon && <Icon className="w-4 h-4" />}
                {section.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile horizontal nav */}
      <div className="lg:hidden fixed top-14 left-0 right-0 z-30 bg-background/80 backdrop-blur-md border-b border-divider px-4 py-2 md:left-64">
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {visibleSections.map((section) => (
            <Chip
              key={section.id}
              variant={activeSection === section.id ? 'solid' : 'flat'}
              color={activeSection === section.id ? 'primary' : 'default'}
              className="cursor-pointer shrink-0"
              onClick={() => scrollToSection(section.id)}
            >
              {section.label}
            </Chip>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-2 lg:pt-0 pt-14">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Settings</h1>
          <SaveStatusIndicator />
        </div>

        <Accordion
          selectionMode="multiple"
          selectedKeys={expandedKeys}
          onSelectionChange={(keys) => setExpandedKeys(new Set(keys as unknown as Iterable<string>))}
          variant="bordered"
          className="gap-3"
          itemClasses={{
            base: 'mb-3',
          }}
        >
          {/* sing-box Configuration */}
          <AccordionItem
            key="singbox"
            aria-label="sing-box Configuration"
            data-section="singbox"
            title={
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5" />
                <span className="font-semibold">sing-box Configuration</span>
              </div>
            }
          >
            <div ref={(el) => { sectionRefs.current['singbox'] = el; }} data-section="singbox" className="space-y-4 pb-2">
              {/* Kernel Status */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-lg bg-default-100">
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

              <div className="flex items-end gap-2">
                <Input
                  label="Config File Path"
                  placeholder="generated/config.json"
                  value={formData.config_path}
                  onChange={(e) => setFormData({ ...formData, config_path: e.target.value })}
                  className="flex-1"
                />
                <UndoButton field="config_path" formData={formData} previousSettings={previousSettings} settings={settings} onUndo={handleUndo} />
              </div>
              <div className="flex items-end gap-2">
                <Input
                  label="GitHub Proxy URL"
                  placeholder="e.g. https://ghproxy.com/"
                  description="Used to accelerate GitHub downloads, leave empty for direct connection"
                  value={formData.github_proxy || ''}
                  onChange={(e) => setFormData({ ...formData, github_proxy: e.target.value })}
                  className="flex-1"
                />
                <UndoButton field="github_proxy" formData={formData} previousSettings={previousSettings} settings={settings} onUndo={handleUndo} />
              </div>
            </div>
          </AccordionItem>

          {/* Inbound Configuration */}
          <AccordionItem
            key="inbound"
            aria-label="Inbound Configuration"
            title={
              <div className="flex items-center gap-2">
                <Download className="w-5 h-5" />
                <span className="font-semibold">Inbound Configuration</span>
              </div>
            }
          >
            <div ref={(el) => { sectionRefs.current['inbound'] = el; }} data-section="inbound" className="space-y-6 pb-2">
              {/* Mixed Inbound */}
              <div>
                <h3 className="font-medium mb-2">Mixed (HTTP+SOCKS5)</h3>
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex items-end gap-2 flex-1">
                      <Input
                        type="number"
                        label="Port"
                        placeholder="2080"
                        description="HTTP+SOCKS5 on one port. Set to 0 to disable."
                        value={String(formData.mixed_port)}
                        onChange={(e) => setFormData({ ...formData, mixed_port: parseInt(e.target.value) || 0 })}
                        className="flex-1"
                      />
                      <UndoButton field="mixed_port" formData={formData} previousSettings={previousSettings} settings={settings} onUndo={handleUndo} />
                    </div>
                    <Input
                      label="Address"
                      placeholder="example.com"
                      description="Server address for proxy link"
                      value={formData.mixed_address || ''}
                      onChange={(e) => setFormData({ ...formData, mixed_address: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* SOCKS5 Inbound */}
              <div className="pt-4 border-t border-divider">
                <h3 className="font-medium mb-2">SOCKS5</h3>
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Input
                      type="number"
                      label="Port"
                      placeholder="0"
                      description="Set to 0 to disable"
                      value={String(formData.socks_port)}
                      onChange={(e) => setFormData({ ...formData, socks_port: parseInt(e.target.value) || 0 })}
                    />
                    <Input
                      label="Address"
                      placeholder="example.com"
                      description="Server address for proxy link"
                      value={formData.socks_address || ''}
                      onChange={(e) => setFormData({ ...formData, socks_address: e.target.value })}
                    />
                  </div>
                  {formData.socks_port > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-sm">Authentication</p>
                        <Switch
                          size="sm"
                          isSelected={formData.socks_auth}
                          onValueChange={(enabled) => setFormData({ ...formData, socks_auth: enabled })}
                        />
                      </div>
                      {formData.socks_auth && (
                        <div className="flex flex-col sm:flex-row gap-3">
                          <Input
                            label="Username"
                            size="sm"
                            value={formData.socks_username || ''}
                            onChange={(e) => setFormData({ ...formData, socks_username: e.target.value })}
                          />
                          <Input
                            label="Password"
                            size="sm"
                            type="password"
                            value={formData.socks_password || ''}
                            onChange={(e) => setFormData({ ...formData, socks_password: e.target.value })}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* HTTP Inbound */}
              <div className="pt-4 border-t border-divider">
                <h3 className="font-medium mb-2">HTTP</h3>
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Input
                      type="number"
                      label="Port"
                      placeholder="0"
                      description="Set to 0 to disable"
                      value={String(formData.http_port)}
                      onChange={(e) => setFormData({ ...formData, http_port: parseInt(e.target.value) || 0 })}
                    />
                    <Input
                      label="Address"
                      placeholder="example.com"
                      description="Server address for proxy link"
                      value={formData.http_address || ''}
                      onChange={(e) => setFormData({ ...formData, http_address: e.target.value })}
                    />
                  </div>
                  {formData.http_port > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-sm">Authentication</p>
                        <Switch
                          size="sm"
                          isSelected={formData.http_auth}
                          onValueChange={(enabled) => setFormData({ ...formData, http_auth: enabled })}
                        />
                      </div>
                      {formData.http_auth && (
                        <div className="flex flex-col sm:flex-row gap-3">
                          <Input
                            label="Username"
                            size="sm"
                            value={formData.http_username || ''}
                            onChange={(e) => setFormData({ ...formData, http_username: e.target.value })}
                          />
                          <Input
                            label="Password"
                            size="sm"
                            type="password"
                            value={formData.http_password || ''}
                            onChange={(e) => setFormData({ ...formData, http_password: e.target.value })}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Shadowsocks Inbound */}
              <div className="pt-4 border-t border-divider">
                <h3 className="font-medium mb-2">Shadowsocks</h3>
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Input
                      type="number"
                      label="Port"
                      placeholder="0"
                      description="Set to 0 to disable"
                      value={String(formData.shadowsocks_port)}
                      onChange={(e) => setFormData({ ...formData, shadowsocks_port: parseInt(e.target.value) || 0 })}
                    />
                    <Input
                      label="Address"
                      placeholder="example.com"
                      description="Server address for proxy link"
                      value={formData.shadowsocks_address || ''}
                      onChange={(e) => setFormData({ ...formData, shadowsocks_address: e.target.value })}
                    />
                  </div>
                  {formData.shadowsocks_port > 0 && (
                    <>
                      <Select
                        label="Encryption Method"
                        selectedKeys={formData.shadowsocks_method ? [formData.shadowsocks_method] : ['aes-256-gcm']}
                        onSelectionChange={(keys) => {
                          const selected = Array.from(keys)[0] as string;
                          if (selected) setFormData({ ...formData, shadowsocks_method: selected });
                        }}
                      >
                        <SelectItem key="aes-256-gcm">aes-256-gcm</SelectItem>
                        <SelectItem key="aes-128-gcm">aes-128-gcm</SelectItem>
                        <SelectItem key="chacha20-ietf-poly1305">chacha20-ietf-poly1305</SelectItem>
                        <SelectItem key="2022-blake3-aes-256-gcm">2022-blake3-aes-256-gcm</SelectItem>
                        <SelectItem key="2022-blake3-aes-128-gcm">2022-blake3-aes-128-gcm</SelectItem>
                        <SelectItem key="2022-blake3-chacha20-poly1305">2022-blake3-chacha20-poly1305</SelectItem>
                      </Select>
                      <Input
                        label="Password"
                        type="password"
                        value={formData.shadowsocks_password || ''}
                        onChange={(e) => setFormData({ ...formData, shadowsocks_password: e.target.value })}
                      />
                    </>
                  )}
                </div>
              </div>

              {/* TUN Mode */}
              <div className="pt-4 border-t border-divider">
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
              </div>

              {/* Allow LAN */}
              <div className="pt-4 border-t border-divider">
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
                        if (!formData.clash_api_secret) {
                          const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                          let secret = '';
                          for (let i = 0; i < 16; i++) {
                            secret += charset.charAt(Math.floor(Math.random() * charset.length));
                          }
                          updates.clash_api_secret = secret;
                        }
                      } else {
                        updates.clash_api_secret = '';
                      }
                      setFormData({ ...formData, ...updates });
                    }}
                  />
                </div>

                {formData.allow_lan && (
                  <div className="mt-3 p-4 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
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
              </div>
            </div>
          </AccordionItem>

          {/* DNS Configuration */}
          <AccordionItem
            key="dns"
            aria-label="DNS Configuration"
            title={
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                <span className="font-semibold">DNS Configuration</span>
              </div>
            }
          >
            <div ref={(el) => { sectionRefs.current['dns'] = el; }} data-section="dns" className="space-y-4 pb-2">
              <div className="flex items-end gap-2">
                <Input
                  label="Proxy DNS"
                  placeholder="https://1.1.1.1/dns-query"
                  value={formData.proxy_dns}
                  onChange={(e) => setFormData({ ...formData, proxy_dns: e.target.value })}
                  className="flex-1"
                />
                <UndoButton field="proxy_dns" formData={formData} previousSettings={previousSettings} settings={settings} onUndo={handleUndo} />
              </div>
              <div className="flex items-end gap-2">
                <Input
                  label="Direct DNS"
                  placeholder="https://dns.alidns.com/dns-query"
                  value={formData.direct_dns}
                  onChange={(e) => setFormData({ ...formData, direct_dns: e.target.value })}
                  className="flex-1"
                />
                <UndoButton field="direct_dns" formData={formData} previousSettings={previousSettings} settings={settings} onUndo={handleUndo} />
              </div>

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

                {formData.hosts && formData.hosts.length > 0 && (
                  <div className="mb-4">
                    <p className="text-sm text-gray-500 mb-2">Custom Mappings</p>
                    {formData.hosts.map((host) => (
                      <div
                        key={host.id}
                        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-3 bg-default-100 rounded-lg mb-2"
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

                {systemHosts.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-500 mb-2">
                      System hosts <Chip size="sm" variant="flat">Read-only</Chip>
                    </p>
                    {systemHosts.map((host) => (
                      <div
                        key={host.id}
                        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-3 bg-default-100 rounded-lg mb-2"
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

                {(!formData.hosts || formData.hosts.length === 0) && systemHosts.length === 0 && (
                  <p className="text-gray-500 text-center py-4">No hosts mappings</p>
                )}
              </div>
            </div>
          </AccordionItem>

          {/* Control Panel Configuration */}
          <AccordionItem
            key="panel"
            aria-label="Control Panel"
            title={<span className="font-semibold">Control Panel</span>}
          >
            <div ref={(el) => { sectionRefs.current['panel'] = el; }} data-section="panel" className="space-y-4 pb-2">
              <div className="flex items-end gap-2">
                <Input
                  type="number"
                  label="Web Management Port"
                  placeholder="9090"
                  disabled
                  value={String(formData.web_port)}
                  onChange={(e) => setFormData({ ...formData, web_port: parseInt(e.target.value) || 9090 })}
                  className="flex-1"
                />
              </div>
              <div className="flex items-end gap-2">
                <Input
                  type="number"
                  label="Clash API Port"
                  placeholder="9091"
                  value={String(formData.clash_api_port)}
                  onChange={(e) => setFormData({ ...formData, clash_api_port: parseInt(e.target.value) || 9091 })}
                  className="flex-1"
                />
                <UndoButton field="clash_api_port" formData={formData} previousSettings={previousSettings} settings={settings} onUndo={handleUndo} />
              </div>
              <div className="flex items-end gap-2">
                <Input
                  label="Final Outbound"
                  placeholder="Proxy"
                  value={formData.final_outbound}
                  onChange={(e) => setFormData({ ...formData, final_outbound: e.target.value })}
                  className="flex-1"
                />
                <UndoButton field="final_outbound" formData={formData} previousSettings={previousSettings} settings={settings} onUndo={handleUndo} />
              </div>
            </div>
          </AccordionItem>

          {/* Automation Settings */}
          <AccordionItem
            key="automation"
            aria-label="Automation"
            title={<span className="font-semibold">Automation</span>}
          >
            <div ref={(el) => { sectionRefs.current['automation'] = el; }} data-section="automation" className="space-y-4 pb-2">
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
              <div className="flex items-end gap-2">
                <Input
                  type="number"
                  label="Subscription Auto-update Interval (minutes)"
                  placeholder="60"
                  description="Set to 0 to disable auto-update"
                  value={String(formData.subscription_interval)}
                  onChange={(e) => setFormData({ ...formData, subscription_interval: parseInt(e.target.value) || 0 })}
                  className="flex-1"
                />
                <UndoButton field="subscription_interval" formData={formData} previousSettings={previousSettings} settings={settings} onUndo={handleUndo} />
              </div>
              <div className="flex items-end gap-2">
                <Input
                  type="number"
                  min={1}
                  label="Archive Threshold (failures)"
                  placeholder="10"
                  description="Pending nodes with failures >= threshold are archived before verification checks"
                  value={String(formData.archive_threshold ?? 10)}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    setFormData({
                      ...formData,
                      archive_threshold: Number.isFinite(parsed) && parsed > 0 ? parsed : 10,
                    });
                  }}
                  className="flex-1"
                />
                <UndoButton field="archive_threshold" formData={formData} previousSettings={previousSettings} settings={settings} onUndo={handleUndo} />
              </div>
            </div>
          </AccordionItem>

          {/* Database Export/Import */}
          <AccordionItem
            key="database"
            aria-label="Database"
            title={
              <div className="flex items-center gap-2">
                <span className="font-semibold">Database</span>
              </div>
            }
          >
            <div ref={(el) => { sectionRefs.current['database'] = el; }} data-section="database" className="space-y-4 pb-2">
              <p className="text-sm text-gray-500">
                Export the entire SQLite database to transfer between server and local environments, or import a previously exported database.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  color="primary"
                  variant="flat"
                  startContent={<HardDriveDownload className="w-4 h-4" />}
                  onPress={handleExportDatabase}
                >
                  {`Export Database${dbExportSize ? ` (${dbExportSize})` : ''}`}
                </Button>
                <Button
                  color="warning"
                  variant="flat"
                  startContent={<HardDriveUpload className="w-4 h-4" />}
                  isLoading={dbImporting}
                  onPress={() => dbFileInputRef.current?.click()}
                >
                  Import Database
                </Button>
                <input
                  ref={dbFileInputRef}
                  type="file"
                  accept=".db,.sqlite,.sqlite3"
                  className="hidden"
                  onChange={handleImportDatabase}
                />
              </div>
              <div className="p-3 bg-warning-50 dark:bg-warning-900/20 rounded-lg">
                <p className="text-sm text-warning-700 dark:text-warning-400">
                  Importing a database will replace ALL current data including nodes, subscriptions, rules, and settings. The page will reload automatically after import.
                </p>
              </div>
            </div>
          </AccordionItem>

          {/* Debug API */}
          <AccordionItem
            key="debug"
            aria-label="Debug API"
            title={<span className="font-semibold">Debug API</span>}
          >
            <div ref={(el) => { sectionRefs.current['debug'] = el; }} data-section="debug" className="space-y-4 pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Enable Debug API</p>
                  <p className="text-sm text-gray-500">Allows remote access to all data and settings via <code className="text-xs bg-default-100 px-1 py-0.5 rounded">/api/debug/dump</code></p>
                </div>
                <Switch
                  isSelected={formData.debug_api_enabled}
                  onValueChange={(enabled) => setFormData({ ...formData, debug_api_enabled: enabled })}
                />
              </div>
              {formData.debug_api_enabled && (
                <div className="p-3 bg-warning-50 dark:bg-warning-900/20 rounded-lg">
                  <p className="text-sm text-warning-700 dark:text-warning-400">
                    Debug API is active. All subscriptions, nodes, rules, and settings are accessible at <code className="text-xs bg-warning-100 dark:bg-warning-800/30 px-1 py-0.5 rounded">{window.location.origin}/api/debug/dump</code>
                  </p>
                </div>
              )}
            </div>
          </AccordionItem>

          {/* Background Service Management */}
          <AccordionItem
            key="daemon"
            aria-label="Background Service"
            className={daemonStatus?.supported ? '' : 'hidden'}
            title={
              <div className="flex items-center gap-2">
                <span className="font-semibold">Background Service</span>
                {daemonStatus && (
                  <Chip
                    color={daemonStatus.installed ? 'success' : 'default'}
                    variant="flat"
                    size="sm"
                  >
                    {daemonStatus.installed ? 'Installed' : 'Not Installed'}
                  </Chip>
                )}
              </div>
            }
          >
            <div ref={(el) => { sectionRefs.current['daemon'] = el; }} data-section="daemon" className="pb-2">
              <p className="text-sm text-gray-500 mb-4">
                Installing the background service allows the sbm manager to run in the background. The web management interface remains accessible after closing the terminal. The service will auto-start on boot and automatically restart after crashes.
              </p>
              <div className="flex flex-wrap gap-2">
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
            </div>
          </AccordionItem>
        </Accordion>
      </div>

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
