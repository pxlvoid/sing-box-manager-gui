import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Input, Button, Switch, Chip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Select, SelectItem, Progress, Textarea, useDisclosure, Checkbox, CheckboxGroup, Tabs, Tab, Tooltip } from '@nextui-org/react';
import { Download, CheckCircle, AlertCircle, Plus, Pencil, Trash2, Server, Eye, EyeOff, Copy, RefreshCw, Wifi, Undo2, Loader2, Check, HardDriveDownload, HardDriveUpload, ShieldBan, Globe, Settings2, Zap, Network, Bug, Route, Cog } from 'lucide-react';
import { useStore } from '../store';
import type { Settings as SettingsType, HostEntry } from '../store';
import { daemonApi, databaseApi, kernelApi, settingsApi } from '../api';
import { toast } from '../components/Toast';
import { countryOptions } from '../features/nodes/types';
import { AnimatePresence, motion } from 'framer-motion';

// ─── Types ───────────────────────────────────────────────────────────
interface KernelInfo {
  installed: boolean;
  version: string;
  path: string;
  os: string;
  arch: string;
}

interface DownloadProgress {
  status: 'idle' | 'preparing' | 'downloading' | 'extracting' | 'installing' | 'completed' | 'error';
  progress: number;
  message: string;
  downloaded?: number;
  total?: number;
}

interface GithubRelease {
  tag_name: string;
  name: string;
}

// ─── Constants ───────────────────────────────────────────────────────
const TAB_KEYS = ['general', 'inbound', 'dns', 'routing', 'automation', 'system'] as const;
type TabKey = typeof TAB_KEYS[number];

const SS_METHODS = [
  'aes-256-gcm',
  'aes-128-gcm',
  'chacha20-ietf-poly1305',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-aes-128-gcm',
  '2022-blake3-chacha20-poly1305',
] as const;

function generateSecret(length = 16): string {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) result += charset.charAt(Math.floor(Math.random() * charset.length));
  return result;
}

// ─── Compact Undo Button ─────────────────────────────────────────────
function UndoBtn({ field, previousSettings, settings, onUndo }: {
  field: keyof SettingsType;
  previousSettings: SettingsType | null;
  settings: SettingsType | null;
  onUndo: (field: keyof SettingsType, value: any) => void;
}) {
  if (!previousSettings || !settings) return null;
  if (JSON.stringify(settings[field]) === JSON.stringify(previousSettings[field])) return null;

  return (
    <Tooltip content="Undo" size="sm">
      <Button isIconOnly size="sm" variant="light" color="warning" onPress={() => onUndo(field, previousSettings[field])} className="min-w-6 w-6 h-6">
        <Undo2 className="w-3 h-3" />
      </Button>
    </Tooltip>
  );
}

// ─── Section Card ────────────────────────────────────────────────────
function SectionCard({ title, description, children, className = '' }: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-default-200 dark:border-default-100 bg-default-50/50 dark:bg-default-50/30 ${className}`}>
      {(title || description) && (
        <div className="px-4 pt-3 pb-2 border-b border-default-200 dark:border-default-100">
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          {description && <p className="text-xs text-default-400 mt-0.5">{description}</p>}
        </div>
      )}
      <div className="p-4">
        {children}
      </div>
    </div>
  );
}

// ─── Compact Toggle Row ──────────────────────────────────────────────
function ToggleRow({ label, description, icon: Icon, isSelected, onChange, children }: {
  label: string;
  description?: string;
  icon?: React.ElementType;
  isSelected: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && <Icon className="w-3.5 h-3.5 text-default-400 shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground leading-tight">{label}</p>
            {description && <p className="text-xs text-default-400 leading-tight mt-0.5">{description}</p>}
          </div>
        </div>
        <Switch size="sm" isSelected={isSelected} onValueChange={onChange} className="shrink-0" />
      </div>
      {children}
    </div>
  );
}

// ─── Inline Field with Undo ──────────────────────────────────────────
function Field({ children, field, previousSettings, settings, onUndo }: {
  children: React.ReactNode;
  field?: keyof SettingsType;
  previousSettings?: SettingsType | null;
  settings?: SettingsType | null;
  onUndo?: (field: keyof SettingsType, value: any) => void;
}) {
  return (
    <div className="flex items-end gap-1.5">
      <div className="flex-1 min-w-0">{children}</div>
      {field && previousSettings && settings && onUndo && (
        <UndoBtn field={field} previousSettings={previousSettings} settings={settings} onUndo={onUndo} />
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────
export default function Settings() {
  const { settings, previousSettings, fetchSettings, updateSettings } = useStore();
  const countryGroups = useStore((s) => s.countryGroups);
  const fetchCountryGroups = useStore((s) => s.fetchCountryGroups);
  const [formData, setFormData] = useState<SettingsType | null>(null);
  const [daemonStatus, setDaemonStatus] = useState<{ installed: boolean; running: boolean; supported: boolean } | null>(null);

  // Kernel state
  const [kernelInfo, setKernelInfo] = useState<KernelInfo | null>(null);
  const [releases, setReleases] = useState<GithubRelease[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hosts state
  const [systemHosts, setSystemHosts] = useState<HostEntry[]>([]);
  const { isOpen: isHostModalOpen, onOpen: onHostModalOpen, onClose: onHostModalClose } = useDisclosure();
  const [editingHost, setEditingHost] = useState<HostEntry | null>(null);
  const [hostFormData, setHostFormData] = useState({ domain: '', enabled: true });
  const [ipsText, setIpsText] = useState('');

  // Database state
  const [dbImporting, setDbImporting] = useState(false);
  const [dbExportSize, setDbExportSize] = useState<string>('');
  const dbFileInputRef = useRef<HTMLInputElement>(null);

  // Country count map
  const countMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of countryGroups) m[g.code] = g.node_count;
    return m;
  }, [countryGroups]);

  // UI state
  const [showSecret, setShowSecret] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('general');

  // Autosave
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const initializedRef = useRef(false);

  useEffect(() => {
    fetchSettings();
    fetchCountryGroups();
    fetchDaemonStatus();
    fetchKernelInfo();
    fetchSystemHosts();
    fetchDatabaseStats();
  }, []);

  useEffect(() => {
    if (settings) {
      setFormData(settings);
      initializedRef.current = true;
    }
  }, [settings]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Autosave with debounce
  useEffect(() => {
    if (!formData || !settings || !initializedRef.current) return;
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

  const handleUndo = useCallback((field: keyof SettingsType, value: any) => {
    setFormData(prev => prev ? { ...prev, [field]: value } : prev);
  }, []);

  // ─── API helpers ─────────────────────────────────────────────────
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

  // ─── Host handlers ───────────────────────────────────────────────
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
    setFormData({ ...formData, hosts: formData.hosts.filter(h => h.id !== id) });
  };

  const handleToggleHost = (id: string, enabled: boolean) => {
    if (!formData?.hosts) return;
    setFormData({ ...formData, hosts: formData.hosts.map(h => h.id === id ? { ...h, enabled } : h) });
  };

  const handleSubmitHost = () => {
    const ips = ipsText.split('\n').map(ip => ip.trim()).filter(ip => ip);
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([a-fA-F0-9:]+)$/;
    const invalidIps = ips.filter(ip => !ipv4Regex.test(ip) && !ipv6Regex.test(ip));
    if (invalidIps.length > 0) { toast.error(`Invalid IP: ${invalidIps.join(', ')}`); return; }
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
    if (!domainRegex.test(hostFormData.domain)) { toast.error('Invalid domain format'); return; }
    if (ips.length === 0) { toast.error('Enter at least one IP address'); return; }

    const hosts = formData?.hosts || [];
    if (editingHost) {
      setFormData({ ...formData!, hosts: hosts.map(h => h.id === editingHost.id ? { ...h, domain: hostFormData.domain, ips, enabled: hostFormData.enabled } : h) });
    } else {
      setFormData({ ...formData!, hosts: [...hosts, { id: crypto.randomUUID(), domain: hostFormData.domain, ips, enabled: hostFormData.enabled }] });
    }
    onHostModalClose();
  };

  // ─── Clipboard ───────────────────────────────────────────────────
  const handleCopySecret = () => {
    if (!formData?.clash_api_secret) return;
    const text = formData.clash_api_secret;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => toast.success('Copied')).catch(() => fallbackCopy(text));
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
      document.execCommand('copy') ? toast.success('Copied') : toast.error('Copy failed');
    } catch {
      toast.error('Copy failed');
    } finally {
      document.body.removeChild(textarea);
    }
  };

  const handleGenerateSecret = () => {
    const secret = generateSecret();
    setFormData(prev => prev ? { ...prev, clash_api_secret: secret } : prev);
    toast.success('Secret generated');
  };

  // ─── Daemon handlers ─────────────────────────────────────────────
  const handleInstallDaemon = async () => {
    try {
      const res = await daemonApi.install();
      const data = res.data;
      if (data.action === 'exit') toast.success(data.message);
      else if (data.action === 'manual') toast.info(data.message);
      else toast.success(data.message || 'Service installed');
      await fetchDaemonStatus();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to install service');
    }
  };

  const handleUninstallDaemon = async () => {
    if (!confirm('Are you sure you want to uninstall the background service?')) return;
    try {
      await daemonApi.uninstall();
      toast.success('Service uninstalled');
      await fetchDaemonStatus();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to uninstall service');
    }
  };

  const handleRestartDaemon = async () => {
    try {
      await daemonApi.restart();
      toast.success('Service restarted');
      await fetchDaemonStatus();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to restart service');
    }
  };

  // ─── Database handlers ───────────────────────────────────────────
  const handleExportDatabase = () => { window.location.href = databaseApi.exportUrl; };

  const handleImportDatabase = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('Importing will replace ALL current data. Continue?')) { e.target.value = ''; return; }
    setDbImporting(true);
    try {
      const res = await databaseApi.import(file);
      toast.success(res.data.message || 'Database imported');
      setTimeout(() => window.location.reload(), 1500);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to import database');
    } finally {
      setDbImporting(false);
      e.target.value = '';
    }
  };

  // ─── Kernel download ─────────────────────────────────────────────
  const openDownloadModal = async () => {
    await fetchReleases();
    setDownloadProgress(null);
    setShowDownloadModal(true);
  };

  const startDownload = async () => {
    if (!selectedVersion) return;
    setDownloading(true);
    setDownloadProgress({ status: 'preparing', progress: 0, message: 'Preparing...' });
    try {
      await kernelApi.download(selectedVersion);
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await kernelApi.getProgress();
          const progress = res.data.data;
          setDownloadProgress(progress);
          if (progress.status === 'completed' || progress.status === 'error') {
            if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
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
      setDownloadProgress({ status: 'error', progress: 0, message: error.response?.data?.error || 'Download failed' });
    }
  };

  // ─── Stable helpers (must be before early return) ──────────────────
  const set = useCallback(
    (patch: Partial<SettingsType>) => setFormData(prev => prev ? { ...prev, ...patch } : prev),
    []
  );
  const undoProps = useMemo(
    () => ({ previousSettings, settings, onUndo: handleUndo }),
    [previousSettings, settings, handleUndo]
  );

  // ─── Loading state ───────────────────────────────────────────────
  if (!formData) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-default-400" />
      </div>
    );
  }

  const f = formData; // shorthand

  return (
    <div className="max-w-4xl mx-auto">
      {/* ─── Header with save status ─────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-foreground tracking-tight">Settings</h1>
        <AnimatePresence mode="wait">
          {saveStatus !== 'idle' && (
            <motion.div
              key={saveStatus}
              initial={{ opacity: 0, scale: 0.9, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              <Chip
                size="sm"
                variant="flat"
                color={saveStatus === 'saving' ? 'default' : saveStatus === 'saved' ? 'success' : 'danger'}
                startContent={
                  saveStatus === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" /> :
                  saveStatus === 'saved' ? <Check className="w-3 h-3" /> :
                  <AlertCircle className="w-3 h-3" />
                }
                className="h-6"
              >
                {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Error'}
              </Chip>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── Tab Navigation ──────────────────────────────────────── */}
      <Tabs
        selectedKey={activeTab}
        onSelectionChange={(key) => setActiveTab(key as TabKey)}
        variant="underlined"
        color="primary"
        classNames={{
          tabList: 'gap-0 w-full border-b border-default-200 dark:border-default-100 pb-0 overflow-x-auto no-scrollbar',
          tab: 'px-2 sm:px-3 h-9 text-xs sm:text-sm',
          cursor: 'h-[2px]',
          panel: 'pt-4 px-0',
        }}
      >
        {/* ─── GENERAL TAB ──────────────────────────────────────────── */}
        <Tab
          key="general"
          title={<div className="flex items-center gap-1.5"><Cog className="w-3.5 h-3.5" /><span>General</span></div>}
        >
          <div className="space-y-3">
            {/* Kernel Status Banner */}
            <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-xl border ${
              kernelInfo?.installed
                ? 'border-success-200 dark:border-success-900/50 bg-success-50/50 dark:bg-success-900/10'
                : 'border-warning-200 dark:border-warning-900/50 bg-warning-50/50 dark:bg-warning-900/10'
            }`}>
              <div className="flex items-center gap-2.5 min-w-0">
                {kernelInfo?.installed ? (
                  <CheckCircle className="w-4 h-4 text-success shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-warning shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight">
                    {kernelInfo?.installed ? 'sing-box Installed' : 'sing-box Not Installed'}
                  </p>
                  <p className="text-xs text-default-400 leading-tight">
                    {kernelInfo?.installed
                      ? `v${kernelInfo.version || '?'} · ${kernelInfo.os}/${kernelInfo.arch}`
                      : 'Download the kernel to use proxy features'}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                color={kernelInfo?.installed ? 'default' : 'primary'}
                variant={kernelInfo?.installed ? 'flat' : 'solid'}
                startContent={<Download className="w-3.5 h-3.5" />}
                onPress={openDownloadModal}
                className="shrink-0 w-full sm:w-auto"
              >
                {kernelInfo?.installed ? 'Update' : 'Download'}
              </Button>
            </div>

            {/* Paths & Ports */}
            <SectionCard title="Configuration">
              <div className="space-y-3">
                <Field field="config_path" {...undoProps}>
                  <Input size="sm" label="Config File Path" placeholder="generated/config.json"
                    value={f.config_path} onChange={(e) => set({ config_path: e.target.value })} />
                </Field>
                <Field field="github_proxy" {...undoProps}>
                  <Input size="sm" label="GitHub Proxy URL" placeholder="e.g. https://ghproxy.com/"
                    description="Accelerate GitHub downloads, leave empty for direct"
                    value={f.github_proxy || ''} onChange={(e) => set({ github_proxy: e.target.value })} />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input size="sm" type="number" label="Web Port" placeholder="9090" isDisabled
                    value={String(f.web_port)} onChange={(e) => set({ web_port: parseInt(e.target.value) || 9090 })} />
                  <Field field="clash_api_port" {...undoProps}>
                    <Input size="sm" type="number" label="Clash API Port" placeholder="9091"
                      value={String(f.clash_api_port)} onChange={(e) => set({ clash_api_port: parseInt(e.target.value) || 9091 })} />
                  </Field>
                </div>
              </div>
            </SectionCard>
          </div>
        </Tab>

        {/* ─── INBOUND TAB ──────────────────────────────────────────── */}
        <Tab
          key="inbound"
          title={<div className="flex items-center gap-1.5"><Network className="w-3.5 h-3.5" /><span>Inbound</span></div>}
        >
          <div className="space-y-3">
            {/* Mixed Inbound */}
            <SectionCard title="Mixed (HTTP+SOCKS5)" description="Combined proxy on a single port">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field field="mixed_port" {...undoProps}>
                  <Input size="sm" type="number" label="Port" placeholder="2080" description="0 = disabled"
                    value={String(f.mixed_port)} onChange={(e) => set({ mixed_port: parseInt(e.target.value) || 0 })} />
                </Field>
                <Input size="sm" label="Address" placeholder="example.com" description="External address for links"
                  value={f.mixed_address || ''} onChange={(e) => set({ mixed_address: e.target.value })} />
              </div>
            </SectionCard>

            {/* SOCKS5 */}
            <SectionCard title="SOCKS5">
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input size="sm" type="number" label="Port" placeholder="0" description="0 = disabled"
                    value={String(f.socks_port)} onChange={(e) => set({ socks_port: parseInt(e.target.value) || 0 })} />
                  <Input size="sm" label="Address" placeholder="example.com"
                    value={f.socks_address || ''} onChange={(e) => set({ socks_address: e.target.value })} />
                </div>
                {f.socks_port > 0 && (
                  <>
                    <ToggleRow label="Authentication" isSelected={f.socks_auth} onChange={(v) => set({ socks_auth: v })} />
                    {f.socks_auth && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input size="sm" label="Username" value={f.socks_username || ''} onChange={(e) => set({ socks_username: e.target.value })} />
                        <Input size="sm" label="Password" type="password" value={f.socks_password || ''} onChange={(e) => set({ socks_password: e.target.value })} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </SectionCard>

            {/* HTTP */}
            <SectionCard title="HTTP">
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input size="sm" type="number" label="Port" placeholder="0" description="0 = disabled"
                    value={String(f.http_port)} onChange={(e) => set({ http_port: parseInt(e.target.value) || 0 })} />
                  <Input size="sm" label="Address" placeholder="example.com"
                    value={f.http_address || ''} onChange={(e) => set({ http_address: e.target.value })} />
                </div>
                {f.http_port > 0 && (
                  <>
                    <ToggleRow label="Authentication" isSelected={f.http_auth} onChange={(v) => set({ http_auth: v })} />
                    {f.http_auth && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input size="sm" label="Username" value={f.http_username || ''} onChange={(e) => set({ http_username: e.target.value })} />
                        <Input size="sm" label="Password" type="password" value={f.http_password || ''} onChange={(e) => set({ http_password: e.target.value })} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </SectionCard>

            {/* Shadowsocks */}
            <SectionCard title="Shadowsocks">
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input size="sm" type="number" label="Port" placeholder="0" description="0 = disabled"
                    value={String(f.shadowsocks_port)} onChange={(e) => set({ shadowsocks_port: parseInt(e.target.value) || 0 })} />
                  <Input size="sm" label="Address" placeholder="example.com"
                    value={f.shadowsocks_address || ''} onChange={(e) => set({ shadowsocks_address: e.target.value })} />
                </div>
                {f.shadowsocks_port > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Select size="sm" label="Encryption Method"
                      selectedKeys={f.shadowsocks_method ? [f.shadowsocks_method] : [SS_METHODS[0]]}
                      onSelectionChange={(keys) => { const s = Array.from(keys)[0] as string; if (s) set({ shadowsocks_method: s }); }}>
                      {SS_METHODS.map((m) => (
                        <SelectItem key={m}>{m}</SelectItem>
                      ))}
                    </Select>
                    <Input size="sm" label="Password" type="password"
                      value={f.shadowsocks_password || ''} onChange={(e) => set({ shadowsocks_password: e.target.value })} />
                  </div>
                )}
              </div>
            </SectionCard>

          </div>
        </Tab>

        {/* ─── DNS TAB ─────────────────────────────────────────────── */}
        <Tab
          key="dns"
          title={<div className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /><span>DNS</span></div>}
        >
          <div className="space-y-3">
            <SectionCard title="DNS Servers">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field field="proxy_dns" {...undoProps}>
                  <Input size="sm" label="Proxy DNS" placeholder="https://1.1.1.1/dns-query"
                    value={f.proxy_dns} onChange={(e) => set({ proxy_dns: e.target.value })} />
                </Field>
                <Field field="direct_dns" {...undoProps}>
                  <Input size="sm" label="Direct DNS" placeholder="https://dns.alidns.com/dns-query"
                    value={f.direct_dns} onChange={(e) => set({ direct_dns: e.target.value })} />
                </Field>
              </div>
            </SectionCard>

            {/* Hosts Mapping */}
            <SectionCard>
              <div className="flex justify-between items-center mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Hosts Mapping</h3>
                  <p className="text-xs text-default-400">Custom domain resolution for Sing-Box</p>
                </div>
                <Button size="sm" color="primary" variant="flat" startContent={<Plus className="w-3.5 h-3.5" />} onPress={handleAddHost} className="h-7">
                  Add
                </Button>
              </div>

              {/* Custom hosts */}
              {f.hosts && f.hosts.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {f.hosts.map((host) => (
                    <div key={host.id} className="flex items-center gap-2 p-2 rounded-lg bg-default-100 dark:bg-default-50/50">
                      <Server className="w-3.5 h-3.5 text-default-400 shrink-0 hidden sm:block" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{host.domain}</span>
                          {!host.enabled && <Chip size="sm" variant="flat" className="h-4 text-[10px]">Off</Chip>}
                        </div>
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {host.ips.map((ip, idx) => (
                            <span key={idx} className="text-[11px] text-default-400 font-mono">{ip}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <Button isIconOnly size="sm" variant="light" onPress={() => handleEditHost(host)} className="min-w-7 w-7 h-7">
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => handleDeleteHost(host.id)} className="min-w-7 w-7 h-7">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                        <Switch size="sm" isSelected={host.enabled} onValueChange={(v) => handleToggleHost(host.id, v)} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* System hosts */}
              {systemHosts.length > 0 && (
                <div>
                  <p className="text-xs text-default-400 mb-1.5 flex items-center gap-1">
                    System hosts <Chip size="sm" variant="flat" className="h-4 text-[10px]">Read-only</Chip>
                  </p>
                  <div className="space-y-1.5">
                    {systemHosts.map((host) => (
                      <div key={host.id} className="flex items-center gap-2 p-2 rounded-lg bg-default-100/50 dark:bg-default-50/20">
                        <Server className="w-3.5 h-3.5 text-default-300 shrink-0 hidden sm:block" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm truncate">{host.domain}</span>
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {host.ips.map((ip, idx) => (
                              <span key={idx} className="text-[11px] text-default-400 font-mono">{ip}</span>
                            ))}
                          </div>
                        </div>
                        <Chip size="sm" color="secondary" variant="flat" className="h-4 text-[10px]">System</Chip>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(!f.hosts || f.hosts.length === 0) && systemHosts.length === 0 && (
                <p className="text-default-400 text-center py-4 text-sm">No hosts mappings</p>
              )}
            </SectionCard>
          </div>
        </Tab>

        {/* ─── ROUTING TAB ──────────────────────────────────────────── */}
        <Tab
          key="routing"
          title={<div className="flex items-center gap-1.5"><Route className="w-3.5 h-3.5" /><span>Routing</span></div>}
        >
          <div className="space-y-3">
            {/* Traffic mode toggles */}
            <SectionCard title="Traffic Mode">
              <div className="space-y-1 divide-y divide-default-100">
                <ToggleRow label="TUN Mode" description="Transparent proxying for all traffic" isSelected={f.tun_enabled} onChange={(v) => set({ tun_enabled: v })} />
                <ToggleRow
                  label="Allow LAN Access"
                  description="Other devices can use this proxy"
                  icon={Wifi}
                  isSelected={f.allow_lan}
                  onChange={(enabled) => {
                    const updates: Partial<SettingsType> = { allow_lan: enabled };
                    if (enabled && !f.clash_api_secret) {
                      updates.clash_api_secret = generateSecret();
                    } else if (!enabled) {
                      updates.clash_api_secret = '';
                    }
                    set(updates);
                  }}
                >
                  {f.allow_lan && (
                    <div className="mt-2 p-3 rounded-lg bg-warning-50/80 dark:bg-warning-900/15 border border-warning-200/60 dark:border-warning-800/40">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <p className="text-xs font-semibold text-warning-700 dark:text-warning-400">Clash API Secret</p>
                        <Chip size="sm" color="warning" variant="flat" className="h-4 text-[10px]">Security</Chip>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Input
                          size="sm"
                          type={showSecret ? 'text' : 'password'}
                          value={f.clash_api_secret || ''}
                          onChange={(e) => set({ clash_api_secret: e.target.value })}
                          placeholder="Auto-generated on save"
                          className="flex-1"
                          endContent={
                            <button onClick={() => setShowSecret(!showSecret)} className="text-default-400 hover:text-default-600 p-1">
                              {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          }
                        />
                        <Tooltip content="Copy" size="sm">
                          <Button isIconOnly size="sm" variant="flat" onPress={handleCopySecret} isDisabled={!f.clash_api_secret} className="min-w-8 w-8 h-8">
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                        </Tooltip>
                        <Tooltip content="Regenerate" size="sm">
                          <Button isIconOnly size="sm" variant="flat" onPress={handleGenerateSecret} className="min-w-8 w-8 h-8">
                            <RefreshCw className="w-3.5 h-3.5" />
                          </Button>
                        </Tooltip>
                      </div>
                    </div>
                  )}
                </ToggleRow>
              </div>
            </SectionCard>

            {/* Outbound */}
            <SectionCard title="Outbound">
              <Field field="final_outbound" {...undoProps}>
                <Input size="sm" label="Final Outbound" placeholder="Proxy"
                  value={f.final_outbound} onChange={(e) => set({ final_outbound: e.target.value })} />
              </Field>
            </SectionCard>

            {/* Blocked Countries */}
            <SectionCard>
              <div className="flex items-center gap-2 mb-2">
                <ShieldBan className="w-3.5 h-3.5 text-default-400" />
                <h3 className="text-sm font-semibold text-foreground">Blocked Countries</h3>
                {(f.blocked_countries?.length ?? 0) > 0 && (
                  <Chip size="sm" variant="flat" color="danger" className="h-4 text-[10px]">{f.blocked_countries.length}</Chip>
                )}
              </div>
              <p className="text-xs text-default-400 mb-2">Excluded from Auto, country groups and Proxy selector</p>
              <CheckboxGroup
                value={f.blocked_countries ?? []}
                onChange={(v) => set({ blocked_countries: v as string[] })}
              >
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-2 gap-y-0.5">
                  {countryOptions.filter(c => c.code !== 'UNKNOWN').map((c) => (
                    <Checkbox key={c.code} value={c.code} size="sm">
                      <span className="text-xs">{c.emoji} {c.name} <span className="text-default-400">({countMap[c.code] ?? 0})</span></span>
                    </Checkbox>
                  ))}
                </div>
              </CheckboxGroup>
            </SectionCard>
          </div>
        </Tab>

        {/* ─── AUTOMATION TAB ──────────────────────────────────────── */}
        <Tab
          key="automation"
          title={<div className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /><span>Auto</span></div>}
        >
          <SectionCard>
            <div className="space-y-3">
              <ToggleRow
                label="Auto-apply after config changes"
                description="Restart sing-box after subscription refresh or rule changes"
                isSelected={f.auto_apply}
                onChange={(v) => set({ auto_apply: v })}
              />
              <div className="border-t border-default-100 pt-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field field="subscription_interval" {...undoProps}>
                    <Input size="sm" type="number" label="Subscription Interval (min)" placeholder="60" description="0 = disabled"
                      value={String(f.subscription_interval)} onChange={(e) => set({ subscription_interval: parseInt(e.target.value) || 0 })} />
                  </Field>
                  <Field field="archive_threshold" {...undoProps}>
                    <Input size="sm" type="number" min={1} label="Archive Threshold (failures)" placeholder="10" description="Auto-archive pending nodes"
                      value={String(f.archive_threshold ?? 10)} onChange={(e) => {
                        const parsed = parseInt(e.target.value, 10);
                        set({ archive_threshold: Number.isFinite(parsed) && parsed > 0 ? parsed : 10 });
                      }} />
                  </Field>
                </div>
              </div>
            </div>
          </SectionCard>
        </Tab>

        {/* ─── SYSTEM TAB ──────────────────────────────────────────── */}
        <Tab
          key="system"
          title={<div className="flex items-center gap-1.5"><Settings2 className="w-3.5 h-3.5" /><span>System</span></div>}
        >
          <div className="space-y-3">
            {/* Database */}
            <SectionCard title="Database" description="Export or import the SQLite database">
              <div className="flex flex-wrap gap-2 mb-3">
                <Button size="sm" color="primary" variant="flat" startContent={<HardDriveDownload className="w-3.5 h-3.5" />}
                  onPress={handleExportDatabase} className="h-8">
                  {`Export${dbExportSize ? ` (${dbExportSize})` : ''}`}
                </Button>
                <Button size="sm" color="warning" variant="flat" startContent={<HardDriveUpload className="w-3.5 h-3.5" />}
                  isLoading={dbImporting} onPress={() => dbFileInputRef.current?.click()} className="h-8">
                  Import
                </Button>
                <input ref={dbFileInputRef} type="file" accept=".db,.sqlite,.sqlite3" className="hidden" onChange={handleImportDatabase} />
              </div>
              <div className="p-2 bg-warning-50/60 dark:bg-warning-900/10 rounded-lg">
                <p className="text-[11px] text-warning-600 dark:text-warning-400">
                  Import replaces ALL data — nodes, subscriptions, rules, settings. Page reloads after import.
                </p>
              </div>
            </SectionCard>

            {/* Debug API */}
            <SectionCard title="Debug API">
              <ToggleRow
                label="Enable Debug API"
                description={`Remote access to all data via /api/debug/dump`}
                icon={Bug}
                isSelected={f.debug_api_enabled}
                onChange={(v) => set({ debug_api_enabled: v })}
              />
              {f.debug_api_enabled && (
                <div className="mt-2 p-2 bg-warning-50/60 dark:bg-warning-900/10 rounded-lg">
                  <p className="text-[11px] text-warning-600 dark:text-warning-400 font-mono break-all">
                    {window.location.origin}/api/debug/dump
                  </p>
                </div>
              )}
            </SectionCard>

            {/* Background Service */}
            {daemonStatus?.supported && (
              <SectionCard>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">Background Service</h3>
                    <Chip
                      size="sm"
                      color={daemonStatus.installed ? 'success' : 'default'}
                      variant="flat"
                      className="h-4 text-[10px]"
                    >
                      {daemonStatus.installed ? 'Installed' : 'Not Installed'}
                    </Chip>
                  </div>
                </div>
                <p className="text-xs text-default-400 mb-3">
                  Auto-start on boot, auto-restart on crash. Web UI stays accessible after closing terminal.
                </p>
                <div className="flex flex-wrap gap-2">
                  {daemonStatus.installed ? (
                    <>
                      <Button size="sm" color="primary" variant="flat" onPress={handleRestartDaemon} className="h-8">Restart</Button>
                      <Button size="sm" color="danger" variant="flat" onPress={handleUninstallDaemon} className="h-8">Uninstall</Button>
                    </>
                  ) : (
                    <Button size="sm" color="primary" onPress={handleInstallDaemon} className="h-8">Install Service</Button>
                  )}
                </div>
              </SectionCard>
            )}
          </div>
        </Tab>
      </Tabs>

      {/* ─── Download Kernel Modal ───────────────────────────────── */}
      <Modal isOpen={showDownloadModal} onClose={() => {
        if (downloading) return;
        if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
        setShowDownloadModal(false);
      }} size="sm">
        <ModalContent>
          <ModalHeader className="text-base pb-2">Download sing-box</ModalHeader>
          <ModalBody className="gap-3">
            <Select size="sm" label="Version" placeholder="Select version"
              selectedKeys={selectedVersion ? [selectedVersion] : []}
              onSelectionChange={(keys) => { const s = Array.from(keys)[0] as string; if (s) setSelectedVersion(s); }}
              isDisabled={downloading}>
              {releases.map((r) => (
                <SelectItem key={r.tag_name} textValue={r.tag_name}>
                  {r.tag_name} {r.name && `— ${r.name}`}
                </SelectItem>
              ))}
            </Select>
            {kernelInfo && (
              <p className="text-xs text-default-400">Platform: {kernelInfo.os}/{kernelInfo.arch}</p>
            )}
            {downloadProgress && (
              <div className="space-y-1.5">
                <Progress size="sm" value={downloadProgress.progress}
                  color={downloadProgress.status === 'error' ? 'danger' : downloadProgress.status === 'completed' ? 'success' : 'primary'}
                  showValueLabel />
                <p className={`text-xs ${downloadProgress.status === 'error' ? 'text-danger' : downloadProgress.status === 'completed' ? 'text-success' : 'text-default-500'}`}>
                  {downloadProgress.message}
                </p>
              </div>
            )}
          </ModalBody>
          <ModalFooter className="pt-2">
            <Button size="sm" variant="flat" onPress={() => setShowDownloadModal(false)} isDisabled={downloading}>Cancel</Button>
            <Button size="sm" color="primary" onPress={startDownload} isLoading={downloading} isDisabled={!selectedVersion || downloading}>Download</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ─── Hosts Edit Modal ────────────────────────────────────── */}
      <Modal isOpen={isHostModalOpen} onClose={onHostModalClose} size="sm">
        <ModalContent>
          <ModalHeader className="text-base pb-2">{editingHost ? 'Edit Host' : 'Add Host'}</ModalHeader>
          <ModalBody className="gap-3">
            <Input size="sm" label="Domain" placeholder="example.com"
              value={hostFormData.domain} onChange={(e) => setHostFormData({ ...hostFormData, domain: e.target.value })} />
            <Textarea size="sm" label="IP Addresses" placeholder={"One per line\n192.168.1.1\n192.168.1.2"}
              value={ipsText} onChange={(e) => setIpsText(e.target.value)} minRows={2} />
            <div className="flex items-center justify-between">
              <span className="text-sm">Enabled</span>
              <Switch size="sm" isSelected={hostFormData.enabled} onValueChange={(v) => setHostFormData({ ...hostFormData, enabled: v })} />
            </div>
          </ModalBody>
          <ModalFooter className="pt-2">
            <Button size="sm" variant="flat" onPress={onHostModalClose}>Cancel</Button>
            <Button size="sm" color="primary" onPress={handleSubmitHost} isDisabled={!hostFormData.domain || !ipsText.trim()}>
              {editingHost ? 'Save' : 'Add'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
