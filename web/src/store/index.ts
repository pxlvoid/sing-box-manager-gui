import { create } from 'zustand';
import { subscriptionApi, filterApi, ruleApi, ruleGroupApi, settingsApi, serviceApi, nodeApi, unifiedNodeApi, verificationApi, monitorApi, proxyApi, probeApi, measurementApi, pipelineApi, proxyModeApi } from '../api';
import { toast } from '../components/Toast';

export interface NodeHealthResult {
  alive: boolean;
  tcp_latency_ms: number;
  groups: Record<string, number>;
}

export interface NodeSiteCheckResult {
  sites: Record<string, number>;
}

export type HealthCheckMode = 'clash_api' | 'clash_api_temp' | 'probe';
export type SiteCheckMode = 'clash_api' | 'clash_api_temp' | 'probe';

export interface TimedHealthMeasurement {
  timestamp: string;
  mode: HealthCheckMode | null;
  result: NodeHealthResult;
}

export interface TimedSiteMeasurement {
  timestamp: string;
  mode: SiteCheckMode | null;
  result: NodeSiteCheckResult;
}

export interface UnsupportedNodeInfo {
  tag: string;
  error: string;
  detected_at: string;
}

export interface GeoData {
  id: number;
  server: string;
  server_port: number;
  node_tag: string;
  timestamp: string;
  status: string;
  country: string;
  country_code: string;
  region: string;
  region_name: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  timezone: string;
  isp: string;
  org: string;
  as: string;
  query_ip: string;
}

const MAX_MEASUREMENTS_PER_NODE = 20;

function appendHealthHistory(
  current: Record<string, TimedHealthMeasurement[]>,
  updates: Record<string, NodeHealthResult>,
  mode: HealthCheckMode | null
): Record<string, TimedHealthMeasurement[]> {
  if (!updates || Object.keys(updates).length === 0) return current;

  const now = new Date().toISOString();
  const next: Record<string, TimedHealthMeasurement[]> = { ...current };

  for (const [tag, result] of Object.entries(updates)) {
    const prev = next[tag] || [];
    next[tag] = [{ timestamp: now, mode, result }, ...prev].slice(0, MAX_MEASUREMENTS_PER_NODE);
  }

  return next;
}

function appendSiteHistory(
  current: Record<string, TimedSiteMeasurement[]>,
  updates: Record<string, NodeSiteCheckResult>,
  mode: SiteCheckMode | null
): Record<string, TimedSiteMeasurement[]> {
  if (!updates || Object.keys(updates).length === 0) return current;

  const now = new Date().toISOString();
  const next: Record<string, TimedSiteMeasurement[]> = { ...current };

  for (const [tag, result] of Object.entries(updates)) {
    const prev = next[tag] || [];
    next[tag] = [{ timestamp: now, mode, result }, ...prev].slice(0, MAX_MEASUREMENTS_PER_NODE);
  }

  return next;
}

// Type definitions
export type NodeStatus = 'pending' | 'verified' | 'archived';

export interface UnifiedNode {
  id: number;
  tag: string;
  type: string;
  server: string;
  server_port: number;
  country?: string;
  country_emoji?: string;
  extra?: Record<string, any>;
  status: NodeStatus;
  source: string;
  group_tag?: string;
  consecutive_failures: number;
  last_checked_at?: string;
  created_at: string;
  promoted_at?: string;
  archived_at?: string;
}

export interface NodeCounts {
  pending: number;
  verified: number;
  archived: number;
}

export interface VerificationLog {
  id: number;
  timestamp: string;
  pending_checked: number;
  pending_promoted: number;
  pending_archived: number;
  verified_checked: number;
  verified_demoted: number;
  duration_ms: number;
  error?: string;
}

export interface VerificationStatus {
  enabled: boolean;
  interval_min: number;
  last_run_at?: string;
  next_run_at?: string;
  node_counts: NodeCounts;
  scheduler_running: boolean;
  sub_update_enabled: boolean;
  sub_update_interval_min: number;
  sub_next_update_at?: string;
  auto_apply: boolean;
}

export interface Subscription {
  id: string;
  name: string;
  url: string;
  node_count: number;
  updated_at: string;
  expire_at?: string;
  traffic?: {
    total: number;
    used: number;
    remaining: number;
  };
  nodes: Node[];
  enabled: boolean;
}

export interface Node {
  tag: string;
  type: string;
  server: string;
  server_port: number;
  country?: string;
  country_emoji?: string;
  extra?: Record<string, any>;
}


export interface CountryGroup {
  code: string;
  name: string;
  emoji: string;
  node_count: number;
}

export interface URLTestConfig {
  url: string;
  interval: string;
  tolerance: number;
}

export interface Filter {
  id: string;
  name: string;
  include: string[];
  exclude: string[];
  include_countries: string[];
  exclude_countries: string[];
  mode: string;
  urltest_config?: URLTestConfig;
  subscriptions: string[];
  all_nodes: boolean;
  enabled: boolean;
}

export interface Rule {
  id: string;
  name: string;
  rule_type: string;
  values: string[];
  outbound: string;
  enabled: boolean;
  priority: number;
}

export interface RuleGroup {
  id: string;
  name: string;
  site_rules: string[];
  ip_rules: string[];
  outbound: string;
  enabled: boolean;
}

export interface HostEntry {
  id: string;
  domain: string;
  ips: string[];
  enabled: boolean;
}

export interface Settings {
  singbox_path: string;
  config_path: string;
  mixed_port: number;
  mixed_address: string;
  tun_enabled: boolean;
  allow_lan: boolean;              // Allow LAN access

  socks_port: number;
  socks_address: string;
  socks_auth: boolean;
  socks_username: string;
  socks_password: string;

  http_port: number;
  http_address: string;
  http_auth: boolean;
  http_username: string;
  http_password: string;

  shadowsocks_port: number;
  shadowsocks_address: string;
  shadowsocks_method: string;
  shadowsocks_password: string;
  proxy_dns: string;
  direct_dns: string;
  hosts?: HostEntry[];           // DNS hosts mapping
  web_port: number;
  clash_api_port: number;
  clash_ui_path: string;
  clash_api_secret: string;        // ClashAPI secret
  final_outbound: string;
  ruleset_base_url: string;
  auto_apply: boolean;           // Auto-apply after config changes
  subscription_interval: number; // Subscription auto-update interval (minutes)
  verification_interval: number; // Verification interval (minutes), 0 to disable
  archive_threshold: number;     // Consecutive failures before archiving
  github_proxy: string;          // GitHub proxy address
  debug_api_enabled: boolean;    // Enable debug API for remote diagnostics
  proxy_mode: ProxyMode;         // Proxy mode: rule, global, direct
}

export type ProxyMode = 'rule' | 'global' | 'direct';

export interface ServiceStatus {
  running: boolean;
  pid: number;
  version: string;
  sbm_version: string;
}

export interface ProxyGroup {
  name: string;
  type: string;
  now: string;
  all: string[];
}

export interface ProbeStatus {
  running: boolean;
  port: number;
  pid: number;
  node_count: number;
  started_at?: string;
}

export interface ProcessStats {
  pid: number;
  cpu_percent: number;
  memory_mb: number;
}

export interface SystemInfo {
  sbm?: ProcessStats;
  singbox?: ProcessStats;
  probe?: ProcessStats;
}

let _pipelineEventId = 0;

export interface PipelineEvent {
  id: number;
  type: string;
  message: string;
  timestamp: string;
}

export interface VerificationProgress {
  phase: 'pending' | 'verified' | 'health_check' | 'site_check' | 'geo';
  current: number;
  total: number;
}

export interface RunCounters {
  promoted: number;
  demoted: number;
  archived: number;
}

interface AppState {
  // Data
  subscriptions: Subscription[];
  pendingNodes: UnifiedNode[];
  verifiedNodes: UnifiedNode[];
  archivedNodes: UnifiedNode[];
  nodeCounts: NodeCounts;
  countryGroups: CountryGroup[];
  filters: Filter[];
  rules: Rule[];
  ruleGroups: RuleGroup[];
  defaultRuleGroups: RuleGroup[];
  settings: Settings | null;
  previousSettings: Settings | null;
  serviceStatus: ServiceStatus | null;
  probeStatus: ProbeStatus | null;
  systemInfo: SystemInfo | null;

  // Verification
  verificationStatus: VerificationStatus | null;
  verificationLogs: VerificationLog[];
  verificationRunning: boolean;

  // Pipeline live monitoring (SSE)
  pipelineEvents: PipelineEvent[];
  verificationProgress: VerificationProgress | null;
  runCounters: RunCounters;

  // Health check state
  healthResults: Record<string, NodeHealthResult>;
  healthMode: HealthCheckMode | null;
  healthChecking: boolean;
  healthCheckingNodes: string[];
  healthHistory: Record<string, TimedHealthMeasurement[]>;
  siteCheckResults: Record<string, NodeSiteCheckResult>;
  siteCheckMode: SiteCheckMode | null;
  siteChecking: boolean;
  siteCheckingNodes: string[];
  siteCheckHistory: Record<string, TimedSiteMeasurement[]>;

  // Proxy groups (from Clash API)
  proxyGroups: ProxyGroup[];

  // Stability stats
  stabilityStats: Record<string, import('../features/nodes/types').NodeStabilityStats>;

  // Unsupported nodes
  unsupportedNodes: UnsupportedNodeInfo[];

  // GeoIP data
  geoData: Record<string, GeoData>;
  geoChecking: boolean;

  // Loading state
  loading: boolean;

  // Actions
  fetchSubscriptions: () => Promise<void>;
  fetchNodes: (status?: NodeStatus) => Promise<void>;
  fetchNodeCounts: () => Promise<void>;
  fetchCountryGroups: () => Promise<void>;
  fetchFilters: () => Promise<void>;
  fetchRules: () => Promise<void>;
  fetchRuleGroups: () => Promise<void>;
  fetchDefaultRuleGroups: () => Promise<void>;
  fetchSettings: () => Promise<void>;
  fetchServiceStatus: () => Promise<void>;
  fetchProbeStatus: () => Promise<void>;
  stopProbe: () => Promise<void>;
  fetchSystemInfo: () => Promise<void>;

  addSubscription: (name: string, url: string) => Promise<void>;
  addSubscriptionsBulk: (subs: { name: string; url: string }[]) => Promise<{ added: number; failed: number }>;
  updateSubscription: (id: string, name: string, url: string) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
  refreshSubscription: (id: string) => Promise<void>;
  toggleSubscription: (id: string, enabled: boolean) => Promise<void>;

  // Unified node operations
  addNode: (node: Partial<UnifiedNode>) => Promise<void>;
  addNodesBulk: (nodes: any[], groupTag?: string, source?: string) => Promise<void>;
  updateNode: (id: number, node: Partial<UnifiedNode>) => Promise<void>;
  deleteNode: (id: number) => Promise<void>;
  promoteNode: (id: number) => Promise<void>;
  demoteNode: (id: number) => Promise<void>;
  archiveNode: (id: number) => Promise<void>;
  unarchiveNode: (id: number) => Promise<void>;
  bulkPromoteNodes: (ids: number[]) => Promise<void>;
  bulkArchiveNodes: (ids: number[]) => Promise<void>;

  // Verification operations
  runVerification: () => Promise<void>;
  runVerificationForTags: (tags: string[]) => Promise<void>;
  fetchVerificationStatus: () => Promise<void>;
  fetchVerificationLogs: (limit?: number) => Promise<void>;
  fetchPipelineEvents: (limit?: number) => Promise<void>;
  startVerificationScheduler: () => Promise<void>;
  stopVerificationScheduler: () => Promise<void>;

  updateSettings: (settings: Settings) => Promise<void>;

  // Rule group operations
  toggleRuleGroup: (id: string, enabled: boolean) => Promise<void>;
  updateRuleGroupOutbound: (id: string, outbound: string) => Promise<void>;
  updateRuleGroup: (id: string, data: Partial<RuleGroup>) => Promise<void>;
  resetRuleGroup: (id: string) => Promise<void>;

  // Custom rule operations
  addRule: (rule: Omit<Rule, 'id'>) => Promise<void>;
  updateRule: (id: string, rule: Partial<Rule>) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;

  // Filter operations
  addFilter: (filter: Omit<Filter, 'id'>) => Promise<void>;
  updateFilter: (id: string, filter: Partial<Filter>) => Promise<void>;
  deleteFilter: (id: string) => Promise<void>;
  toggleFilter: (id: string, enabled: boolean) => Promise<void>;

  // Health check operations
  checkAllNodesHealth: (tags?: string[]) => Promise<void>;
  checkSingleNodeHealth: (tag: string, options?: { skipStatsRefresh?: boolean }) => Promise<void>;
  checkNodesSites: (tags?: string[], sites?: string[]) => Promise<void>;
  checkSingleNodeSites: (tag: string, sites?: string[]) => Promise<void>;

  // Latest measurements from backend
  fetchLatestMeasurements: () => Promise<void>;

  // Stability stats
  fetchStabilityStats: (days?: number) => Promise<void>;

  // Unsupported nodes operations
  fetchUnsupportedNodes: () => Promise<void>;
  recheckUnsupportedNodes: () => Promise<void>;
  deleteUnsupportedNodes: (tags?: string[]) => Promise<void>;

  // GeoIP operations
  fetchGeoData: () => Promise<void>;
  runGeoCheck: (tags?: string[]) => Promise<void>;

  // Proxy group operations
  fetchProxyGroups: () => Promise<void>;
  switchProxy: (group: string, selected: string) => Promise<void>;

  // Proxy mode operations
  proxyMode: ProxyMode;
  proxyModeRunning: boolean;
  proxyModeSource: 'runtime' | 'settings';
  proxyModeSwitching: boolean;
  proxyModeSwitchingTo: ProxyMode | null;
  fetchProxyMode: () => Promise<void>;
  setProxyMode: (mode: ProxyMode) => Promise<void>;

  // Pipeline event actions (used by SSE hook)
  addPipelineEvent: (type: string, message: string) => void;
  setVerificationProgress: (progress: VerificationProgress | null) => void;
  incrementRunCounter: (counter: 'promoted' | 'demoted' | 'archived') => void;
  resetRunCounters: () => void;
}

// Helper: server:port key for a node
export function nodeServerPortKey(node: { server: string; server_port: number }): string {
  return `${node.server}:${node.server_port}`;
}

export const useStore = create<AppState>((set, get) => ({
  subscriptions: [],
  pendingNodes: [],
  verifiedNodes: [],
  archivedNodes: [],
  nodeCounts: { pending: 0, verified: 0, archived: 0 },
  countryGroups: [],
  filters: [],
  rules: [],
  ruleGroups: [],
  defaultRuleGroups: [],
  settings: null,
  previousSettings: null,
  serviceStatus: null,
  probeStatus: null,
  systemInfo: null,
  verificationStatus: null,
  verificationLogs: [],
  verificationRunning: false,
  pipelineEvents: [],
  verificationProgress: null,
  runCounters: { promoted: 0, demoted: 0, archived: 0 },
  healthResults: {},
  healthMode: null,
  healthChecking: false,
  healthCheckingNodes: [],
  healthHistory: {},
  siteCheckResults: {},
  siteCheckMode: null,
  siteChecking: false,
  siteCheckingNodes: [],
  siteCheckHistory: {},
  proxyGroups: [],
  proxyMode: 'rule',
  proxyModeRunning: false,
  proxyModeSource: 'settings',
  proxyModeSwitching: false,
  proxyModeSwitchingTo: null,
  stabilityStats: {},
  unsupportedNodes: [],
  geoData: {},
  geoChecking: false,
  loading: false,

  fetchSubscriptions: async () => {
    try {
      const res = await subscriptionApi.getAll();
      set({ subscriptions: res.data.data || [] });
    } catch (error) {
      console.error('Failed to fetch subscriptions:', error);
    }
  },

  fetchNodes: async (status?: NodeStatus) => {
    try {
      if (status) {
        const res = await unifiedNodeApi.getAll(status);
        const nodes = res.data.data || [];
        if (status === 'pending') set({ pendingNodes: nodes });
        else if (status === 'verified') set({ verifiedNodes: nodes });
        else if (status === 'archived') set({ archivedNodes: nodes });
      } else {
        const res = await unifiedNodeApi.getAll();
        const data = res.data;
        set({
          pendingNodes: data.pending || [],
          verifiedNodes: data.verified || [],
          archivedNodes: data.archived || [],
        });
      }
    } catch (error) {
      console.error('Failed to fetch nodes:', error);
    }
  },

  fetchNodeCounts: async () => {
    try {
      const res = await unifiedNodeApi.getCounts();
      set({ nodeCounts: res.data.data || { pending: 0, verified: 0, archived: 0 } });
    } catch (error) {
      console.error('Failed to fetch node counts:', error);
    }
  },

  fetchCountryGroups: async () => {
    try {
      const res = await nodeApi.getCountries();
      set({ countryGroups: res.data.data || [] });
    } catch (error) {
      console.error('Failed to fetch country groups:', error);
    }
  },

  fetchFilters: async () => {
    try {
      const res = await filterApi.getAll();
      set({ filters: res.data.data || [] });
    } catch (error) {
      console.error('Failed to fetch filters:', error);
    }
  },

  fetchRules: async () => {
    try {
      const res = await ruleApi.getAll();
      set({ rules: res.data.data || [] });
    } catch (error) {
      console.error('Failed to fetch rules:', error);
    }
  },

  fetchRuleGroups: async () => {
    try {
      const res = await ruleGroupApi.getAll();
      set({ ruleGroups: res.data.data || [] });
    } catch (error) {
      console.error('Failed to fetch rule groups:', error);
    }
  },

  fetchDefaultRuleGroups: async () => {
    try {
      const res = await ruleGroupApi.getDefaults();
      set({ defaultRuleGroups: res.data.data || [] });
    } catch (error) {
      console.error('Failed to fetch default rule groups:', error);
    }
  },

  fetchSettings: async () => {
    try {
      const res = await settingsApi.get();
      const settings = res.data.data;
      set({ settings });
      // Fallback: sync proxyMode from settings if runtime data hasn't been fetched yet
      if (settings?.proxy_mode && get().proxyModeSource === 'settings') {
        set({ proxyMode: settings.proxy_mode });
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    }
  },

  fetchServiceStatus: async () => {
    try {
      const res = await serviceApi.status();
      set({ serviceStatus: res.data.data });
    } catch (error) {
      console.error('Failed to fetch service status:', error);
    }
  },

  fetchProbeStatus: async () => {
    try {
      const res = await probeApi.status();
      set({ probeStatus: res.data.data });
    } catch (error) {
      console.error('Failed to fetch probe status:', error);
    }
  },

  stopProbe: async () => {
    try {
      await probeApi.stop();
      set({ probeStatus: { running: false, port: 0, pid: 0, node_count: 0 } });
      toast.success('Probe stopped');
    } catch (error: any) {
      console.error('Failed to stop probe:', error);
      toast.error(error.response?.data?.error || 'Failed to stop probe');
    }
  },

  fetchSystemInfo: async () => {
    try {
      const res = await monitorApi.system();
      set({ systemInfo: res.data.data });
    } catch (error) {
      console.error('Failed to fetch system info:', error);
    }
  },

  addSubscription: async (name: string, url: string) => {
    set({ loading: true });
    try {
      await subscriptionApi.add(name, url);
      await get().fetchSubscriptions();
      toast.success('Subscription added successfully');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to add subscription');
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  addSubscriptionsBulk: async (subs: { name: string; url: string }[]) => {
    const preparedSubs = subs
      .map((sub) => ({ name: sub.name.trim(), url: sub.url.trim() }))
      .filter((sub) => sub.name && sub.url);

    if (preparedSubs.length === 0) {
      return { added: 0, failed: 0 };
    }

    set({ loading: true });
    let added = 0;
    let failed = 0;

    try {
      for (const sub of preparedSubs) {
        try {
          await subscriptionApi.add(sub.name, sub.url);
          added++;
        } catch (error: any) {
          failed++;
          console.error(`Failed to add subscription ${sub.url}:`, error);
        }
      }

      if (added > 0) {
        await get().fetchSubscriptions();
      }

      if (added > 0 && failed === 0) {
        toast.success(`Added ${added} subscription${added > 1 ? 's' : ''}`);
      } else if (added > 0 && failed > 0) {
        toast.success(`Added ${added} subscription${added > 1 ? 's' : ''}`);
        toast.error(`Failed to add ${failed} subscription${failed > 1 ? 's' : ''}`);
      } else {
        toast.error(`Failed to add ${failed} subscription${failed > 1 ? 's' : ''}`);
      }

      return { added, failed };
    } finally {
      set({ loading: false });
    }
  },

  updateSubscription: async (id: string, name: string, url: string) => {
    set({ loading: true });
    try {
      await subscriptionApi.update(id, { name, url });
      await get().fetchSubscriptions();
      toast.success('Subscription updated successfully');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to update subscription');
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  deleteSubscription: async (id: string) => {
    try {
      await subscriptionApi.delete(id);
      await get().fetchSubscriptions();
      toast.success('Subscription deleted');
    } catch (error: any) {
      console.error('Failed to delete subscription:', error);
      toast.error(error.response?.data?.error || 'Failed to delete subscription');
    }
  },

  refreshSubscription: async (id: string) => {
    set({ loading: true });
    try {
      const res = await subscriptionApi.refresh(id);
      await get().fetchSubscriptions();
      await get().fetchCountryGroups();
      // Check backend warning
      if (res.data.warning) {
        toast.info(res.data.warning);
      } else {
        toast.success('Subscription refreshed successfully');
      }
    } catch (error: any) {
      console.error('Failed to refresh subscription:', error);
      toast.error(error.response?.data?.error || 'Failed to refresh subscription');
    } finally {
      set({ loading: false });
    }
  },

  toggleSubscription: async (id: string, enabled: boolean) => {
    const subscription = get().subscriptions.find(s => s.id === id);
    if (subscription) {
      try {
        const res = await subscriptionApi.update(id, { ...subscription, enabled });
        await get().fetchSubscriptions();
        await get().fetchCountryGroups();
        if (res.data.warning) {
          toast.info(res.data.warning);
        } else {
          toast.success(`Subscription ${enabled ? 'enabled' : 'disabled'}`);
        }
      } catch (error: any) {
        console.error('Failed to toggle subscription:', error);
        toast.error(error.response?.data?.error || 'Failed to toggle subscription');
      }
    }
  },

  addNode: async (node: Partial<UnifiedNode>) => {
    try {
      await unifiedNodeApi.add(node);
      await get().fetchNodes();
      await get().fetchNodeCounts();
      toast.success('Node added successfully');
    } catch (error: any) {
      console.error('Failed to add node:', error);
      toast.error(error.response?.data?.error || 'Failed to add node');
      throw error;
    }
  },

  addNodesBulk: async (nodes: any[], groupTag?: string, source?: string) => {
    try {
      const res = await unifiedNodeApi.addBulk(nodes, groupTag, source);
      await get().fetchNodes();
      await get().fetchNodeCounts();
      const data = res.data;
      toast.success(`Added ${data.added} nodes (${data.skipped} skipped)`);
    } catch (error: any) {
      console.error('Failed to add nodes in bulk:', error);
      toast.error(error.response?.data?.error || 'Failed to add nodes');
      throw error;
    }
  },

  updateNode: async (id: number, node: Partial<UnifiedNode>) => {
    try {
      await unifiedNodeApi.update(id, node);
      await get().fetchNodes();
      toast.success('Node updated successfully');
    } catch (error: any) {
      console.error('Failed to update node:', error);
      toast.error(error.response?.data?.error || 'Failed to update node');
      throw error;
    }
  },

  deleteNode: async (id: number) => {
    try {
      await unifiedNodeApi.delete(id);
      await get().fetchNodes();
      await get().fetchNodeCounts();
      toast.success('Node deleted');
    } catch (error: any) {
      console.error('Failed to delete node:', error);
      toast.error(error.response?.data?.error || 'Failed to delete node');
    }
  },

  promoteNode: async (id: number) => {
    try {
      await unifiedNodeApi.promote(id);
      await get().fetchNodes();
      await get().fetchNodeCounts();
      toast.success('Node promoted to verified');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to promote node');
    }
  },

  demoteNode: async (id: number) => {
    try {
      await unifiedNodeApi.demote(id);
      await get().fetchNodes();
      await get().fetchNodeCounts();
      toast.success('Node demoted to pending');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to demote node');
    }
  },

  archiveNode: async (id: number) => {
    try {
      await unifiedNodeApi.archive(id);
      await get().fetchNodes();
      await get().fetchNodeCounts();
      toast.success('Node archived');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to archive node');
    }
  },

  unarchiveNode: async (id: number) => {
    try {
      await unifiedNodeApi.unarchive(id);
      await get().fetchNodes();
      await get().fetchNodeCounts();
      toast.success('Node unarchived');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to unarchive node');
    }
  },

  bulkPromoteNodes: async (ids: number[]) => {
    try {
      await unifiedNodeApi.bulkPromote(ids);
      await get().fetchNodes();
      await get().fetchNodeCounts();
      toast.success(`${ids.length} nodes promoted`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to promote nodes');
    }
  },

  bulkArchiveNodes: async (ids: number[]) => {
    try {
      await unifiedNodeApi.bulkArchive(ids);
      await get().fetchNodes();
      await get().fetchNodeCounts();
      toast.success(`${ids.length} nodes archived`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to archive nodes');
    }
  },

  // Verification operations
  runVerification: async () => {
    set({ verificationRunning: true });
    try {
      await verificationApi.run();
      toast.success('Verification started');
      // SSE will handle completion — reset verificationRunning via verify:complete event
    } catch (error: any) {
      set({ verificationRunning: false });
      toast.error(error.response?.data?.error || 'Failed to start verification');
    }
  },

  runVerificationForTags: async (tags: string[]) => {
    const filteredTags = tags.map((t) => t.trim()).filter((t) => t.length > 0);
    if (filteredTags.length === 0) {
      toast.error('No proxy tags selected for verification');
      return;
    }

    set({ verificationRunning: true });
    try {
      await verificationApi.runTags(filteredTags);
      toast.success(`Verification started for ${filteredTags.length} tag${filteredTags.length > 1 ? 's' : ''}`);
      // SSE will handle completion — reset verificationRunning via verify:complete event
    } catch (error: any) {
      set({ verificationRunning: false });
      toast.error(error.response?.data?.error || 'Failed to start tag verification');
    }
  },

  fetchVerificationStatus: async () => {
    try {
      const res = await verificationApi.getStatus();
      set({ verificationStatus: res.data.data });
    } catch (error) {
      console.error('Failed to fetch verification status:', error);
    }
  },

  fetchVerificationLogs: async (limit?: number) => {
    try {
      const res = await verificationApi.getLogs(limit);
      set({ verificationLogs: res.data.data || [] });
    } catch (error) {
      console.error('Failed to fetch verification logs:', error);
    }
  },

  fetchPipelineEvents: async (limit?: number) => {
    try {
      const res = await pipelineApi.getActivity(limit);
      const logs = ((res.data.data || []) as PipelineEvent[])
        .filter((event) => event.type !== 'verify:node_archived');
      const events = [...logs].reverse();
      for (const event of events) {
        if (event.id > _pipelineEventId) {
          _pipelineEventId = event.id;
        }
      }
      set({ pipelineEvents: events });
    } catch (error) {
      console.error('Failed to fetch pipeline activity logs:', error);
    }
  },

  startVerificationScheduler: async () => {
    try {
      await verificationApi.start();
      await get().fetchVerificationStatus();
      toast.success('Scheduler started');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to start scheduler');
    }
  },

  stopVerificationScheduler: async () => {
    try {
      await verificationApi.stop();
      await get().fetchVerificationStatus();
      toast.success('Scheduler stopped');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to stop scheduler');
    }
  },

  updateSettings: async (settings: Settings) => {
    try {
      // Save current settings as previous before overwriting
      const currentSettings = get().settings;
      const res = await settingsApi.update(settings);
      // Use backend-returned data (may contain auto-generated secret)
      if (res.data.data) {
        set({ settings: res.data.data, previousSettings: currentSettings });
      } else {
        set({ settings, previousSettings: currentSettings });
      }
    } catch (error) {
      console.error('Failed to update settings:', error);
      throw error;
    }
  },

  toggleRuleGroup: async (id: string, enabled: boolean) => {
    const ruleGroup = get().ruleGroups.find(r => r.id === id);
    if (ruleGroup) {
      try {
        const res = await ruleGroupApi.update(id, { ...ruleGroup, enabled });
        await get().fetchRuleGroups();
        if (res.data.warning) {
          toast.info(res.data.warning);
        } else {
          toast.success(`Rule group ${enabled ? 'enabled' : 'disabled'}`);
        }
      } catch (error: any) {
        console.error('Failed to update rule group:', error);
        toast.error(error.response?.data?.error || 'Failed to update rule group');
      }
    }
  },

  updateRuleGroupOutbound: async (id: string, outbound: string) => {
    const ruleGroup = get().ruleGroups.find(r => r.id === id);
    if (ruleGroup) {
      try {
        const res = await ruleGroupApi.update(id, { ...ruleGroup, outbound });
        await get().fetchRuleGroups();
        if (res.data.warning) {
          toast.info(res.data.warning);
        } else {
          toast.success('Rule group outbound updated');
        }
      } catch (error: any) {
        console.error('Failed to update rule group outbound:', error);
        toast.error(error.response?.data?.error || 'Failed to update rule group outbound');
      }
    }
  },

  updateRuleGroup: async (id: string, data: Partial<RuleGroup>) => {
    const ruleGroup = get().ruleGroups.find(r => r.id === id);
    if (ruleGroup) {
      try {
        const res = await ruleGroupApi.update(id, { ...ruleGroup, ...data });
        await get().fetchRuleGroups();
        if (res.data.warning) {
          toast.info(res.data.warning);
        } else {
          toast.success('Rule group updated');
        }
      } catch (error: any) {
        console.error('Failed to update rule group:', error);
        toast.error(error.response?.data?.error || 'Failed to update rule group');
      }
    }
  },

  resetRuleGroup: async (id: string) => {
    try {
      await ruleGroupApi.reset(id);
      await get().fetchRuleGroups();
      toast.success('Rule group reset to default');
    } catch (error: any) {
      console.error('Failed to reset rule group:', error);
      toast.error(error.response?.data?.error || 'Failed to reset rule group');
    }
  },

  addRule: async (rule: Omit<Rule, 'id'>) => {
    try {
      const res = await ruleApi.add(rule);
      await get().fetchRules();
      if (res.data.warning) {
        toast.info(res.data.warning);
      } else {
        toast.success('Rule added successfully');
      }
    } catch (error: any) {
      console.error('Failed to add rule:', error);
      toast.error(error.response?.data?.error || 'Failed to add rule');
      throw error;
    }
  },

  updateRule: async (id: string, rule: Partial<Rule>) => {
    try {
      const res = await ruleApi.update(id, rule);
      await get().fetchRules();
      if (res.data.warning) {
        toast.info(res.data.warning);
      } else {
        toast.success('Rule updated successfully');
      }
    } catch (error: any) {
      console.error('Failed to update rule:', error);
      toast.error(error.response?.data?.error || 'Failed to update rule');
      throw error;
    }
  },

  deleteRule: async (id: string) => {
    try {
      const res = await ruleApi.delete(id);
      await get().fetchRules();
      if (res.data.warning) {
        toast.info(res.data.warning);
      } else {
        toast.success('Rule deleted');
      }
    } catch (error: any) {
      console.error('Failed to delete rule:', error);
      toast.error(error.response?.data?.error || 'Failed to delete rule');
    }
  },

  addFilter: async (filter: Omit<Filter, 'id'>) => {
    try {
      await filterApi.add(filter);
      await get().fetchFilters();
      toast.success('Filter added successfully');
    } catch (error: any) {
      console.error('Failed to add filter:', error);
      toast.error(error.response?.data?.error || 'Failed to add filter');
      throw error;
    }
  },

  updateFilter: async (id: string, filter: Partial<Filter>) => {
    try {
      await filterApi.update(id, filter);
      await get().fetchFilters();
      toast.success('Filter updated successfully');
    } catch (error: any) {
      console.error('Failed to update filter:', error);
      toast.error(error.response?.data?.error || 'Failed to update filter');
      throw error;
    }
  },

  deleteFilter: async (id: string) => {
    try {
      await filterApi.delete(id);
      await get().fetchFilters();
      toast.success('Filter deleted');
    } catch (error: any) {
      console.error('Failed to delete filter:', error);
      toast.error(error.response?.data?.error || 'Failed to delete filter');
      throw error;
    }
  },

  toggleFilter: async (id: string, enabled: boolean) => {
    const filter = get().filters.find(f => f.id === id);
    if (filter) {
      try {
        await filterApi.update(id, { ...filter, enabled });
        await get().fetchFilters();
        toast.success(`Filter ${enabled ? 'enabled' : 'disabled'}`);
      } catch (error: any) {
        console.error('Failed to toggle filter:', error);
        toast.error(error.response?.data?.error || 'Failed to toggle filter');
      }
    }
  },

  checkAllNodesHealth: async (tags?: string[]) => {
    set({ healthChecking: true });
    try {
      const res = await nodeApi.healthCheck(tags);
      const updates = (res.data.data || {}) as Record<string, NodeHealthResult>;
      const mode = (res.data.mode || null) as HealthCheckMode | null;
      const state = get();
      const healthResults = { ...state.healthResults, ...updates };
      const healthHistory = appendHealthHistory(state.healthHistory, updates, mode);
      set({
        healthResults,
        healthHistory,
        healthMode: mode,
      });
      toast.success('Health check completed');
      get().fetchStabilityStats();
    } catch (error: any) {
      console.error('Failed to check nodes health:', error);
      toast.error(error.response?.data?.error || 'Health check failed');
      throw error;
    } finally {
      set({ healthChecking: false });
    }
  },

  checkSingleNodeHealth: async (tag: string, options?: { skipStatsRefresh?: boolean }) => {
    set({ healthCheckingNodes: [...get().healthCheckingNodes, tag] });
    try {
      const res = await nodeApi.healthCheckSingle(tag);
      const updates = (res.data.data || {}) as Record<string, NodeHealthResult>;
      const mode = (res.data.mode || null) as HealthCheckMode | null;
      const state = get();
      const healthResults = { ...state.healthResults, ...updates };
      const healthHistory = appendHealthHistory(state.healthHistory, updates, mode);
      set({
        healthResults,
        healthHistory,
        healthMode: mode,
      });
      if (!options?.skipStatsRefresh) {
        get().fetchStabilityStats();
      }
    } catch (error: any) {
      console.error('Failed to check node health:', error);
      toast.error(error.response?.data?.error || 'Health check failed');
    } finally {
      set({ healthCheckingNodes: get().healthCheckingNodes.filter(t => t !== tag) });
    }
  },

  checkNodesSites: async (tags?: string[], sites?: string[]) => {
    set({ siteChecking: true });
    try {
      const res = await nodeApi.siteCheck(tags, sites);
      const updates = (res.data.data || {}) as Record<string, NodeSiteCheckResult>;
      const mode = (res.data.mode || null) as SiteCheckMode | null;
      const state = get();
      const siteCheckResults = { ...state.siteCheckResults, ...updates };
      const siteCheckHistory = appendSiteHistory(state.siteCheckHistory, updates, mode);
      set({
        siteCheckResults,
        siteCheckHistory,
        siteCheckMode: mode,
      });
      toast.success('Site check completed');
    } catch (error: any) {
      console.error('Failed to check sites:', error);
      toast.error(error.response?.data?.error || 'Site check failed');
    } finally {
      set({ siteChecking: false });
    }
  },

  checkSingleNodeSites: async (tag: string, sites?: string[]) => {
    if (get().siteCheckingNodes.includes(tag)) return;

    set({ siteCheckingNodes: [...get().siteCheckingNodes, tag] });
    try {
      const res = await nodeApi.siteCheck([tag], sites);
      const updates = (res.data.data || {}) as Record<string, NodeSiteCheckResult>;
      const mode = (res.data.mode || null) as SiteCheckMode | null;
      const state = get();
      const siteCheckResults = { ...state.siteCheckResults, ...updates };
      const siteCheckHistory = appendSiteHistory(state.siteCheckHistory, updates, mode);
      set({
        siteCheckResults,
        siteCheckHistory,
        siteCheckMode: mode,
      });
    } catch (error: any) {
      console.error('Failed to check node sites:', error);
      toast.error(error.response?.data?.error || 'Site check failed');
    } finally {
      set({ siteCheckingNodes: get().siteCheckingNodes.filter(t => t !== tag) });
    }
  },

  fetchLatestMeasurements: async () => {
    try {
      const res = await measurementApi.getLatest();
      const { health, sites } = res.data as {
        health: Record<string, { alive: boolean; latency_ms: number; timestamp: string; mode: string; node_tag: string }>;
        sites: Record<string, { sites: Record<string, number>; timestamp: string; mode: string; node_tag: string }>;
      };

      const state = get();
      const newHealthResults: Record<string, NodeHealthResult> = {};
      let healthMode: HealthCheckMode | null = state.healthMode;

      for (const [serverPortKey, entry] of Object.entries(health)) {
        const parsed: NodeHealthResult = {
          alive: entry.alive,
          tcp_latency_ms: entry.latency_ms,
          groups: {},
        };
        newHealthResults[serverPortKey] = parsed;
        if (entry.node_tag) {
          newHealthResults[entry.node_tag] = parsed;
        }
        if (entry.mode && !healthMode) {
          healthMode = entry.mode as HealthCheckMode;
        }
      }

      const newSiteResults: Record<string, NodeSiteCheckResult> = {};
      let siteMode: SiteCheckMode | null = state.siteCheckMode;

      for (const [serverPortKey, entry] of Object.entries(sites)) {
        const parsed: NodeSiteCheckResult = { sites: entry.sites };
        newSiteResults[serverPortKey] = parsed;
        if (entry.node_tag) {
          newSiteResults[entry.node_tag] = parsed;
        }
        if (entry.mode && !siteMode) {
          siteMode = entry.mode as SiteCheckMode;
        }
      }

      // Backend latest measurements are authoritative.
      // Do not merge with in-memory cache, otherwise stale tag keys may survive indefinitely.
      const latestHealthResults = newHealthResults;
      const latestSiteResults = newSiteResults;

      set({
        healthResults: latestHealthResults,
        healthMode: healthMode,
        siteCheckResults: latestSiteResults,
        siteCheckMode: siteMode,
      });
    } catch (error) {
      console.error('Failed to fetch latest measurements:', error);
    }
  },

  fetchStabilityStats: async (days?: number) => {
    try {
      const res = await measurementApi.getBulkHealthStats(days);
      const stats = (res.data.data || []) as import('../features/nodes/types').NodeStabilityStats[];
      const map: Record<string, import('../features/nodes/types').NodeStabilityStats> = {};
      for (const s of stats) {
        map[`${s.server}:${s.server_port}`] = s;
      }
      set({ stabilityStats: map });
    } catch (error) {
      console.error('Failed to fetch stability stats:', error);
    }
  },

  fetchUnsupportedNodes: async () => {
    try {
      const res = await nodeApi.getUnsupported();
      set({ unsupportedNodes: res.data.data || [] });
    } catch (error) {
      console.error('Failed to fetch unsupported nodes:', error);
    }
  },

  recheckUnsupportedNodes: async () => {
    try {
      const res = await nodeApi.recheckUnsupported();
      set({ unsupportedNodes: res.data.data || [] });
      toast.success(res.data.message || 'Recheck completed');
    } catch (error: any) {
      console.error('Failed to recheck unsupported nodes:', error);
      toast.error(error.response?.data?.error || 'Recheck failed');
    }
  },

  deleteUnsupportedNodes: async (tags?: string[]) => {
    try {
      const res = await nodeApi.deleteUnsupported(tags);
      toast.success(res.data.message || 'Nodes deleted');
      // Refresh all related data
      await Promise.all([
        get().fetchUnsupportedNodes(),
        get().fetchSubscriptions(),
        get().fetchNodes(),
        get().fetchNodeCounts(),
        get().fetchCountryGroups(),
      ]);
    } catch (error: any) {
      console.error('Failed to delete unsupported nodes:', error);
      toast.error(error.response?.data?.error || 'Failed to delete nodes');
    }
  },

  fetchGeoData: async () => {
    try {
      const res = await nodeApi.getGeoData();
      const data = res.data.data || [];
      const geoMap: Record<string, GeoData> = {};
      for (const g of data) {
        geoMap[`${g.server}:${g.server_port}`] = g;
      }
      set({ geoData: geoMap });
    } catch (error) {
      console.error('Failed to fetch geo data:', error);
    }
  },

  runGeoCheck: async (tags?: string[]) => {
    try {
      set({ geoChecking: true });
      await nodeApi.geoCheck(tags);
      await get().fetchGeoData();
      toast.success('GeoIP check completed');
    } catch (error: any) {
      console.error('GeoIP check failed:', error);
      toast.error(error.response?.data?.error || 'GeoIP check failed');
    } finally {
      set({ geoChecking: false });
    }
  },

  fetchProxyGroups: async () => {
    try {
      const res = await proxyApi.getGroups();
      set({ proxyGroups: res.data.data || [] });
    } catch (error) {
      console.error('Failed to fetch proxy groups:', error);
    }
  },

  switchProxy: async (group: string, selected: string) => {
    try {
      await proxyApi.switchGroup(group, selected);
      await get().fetchProxyGroups();
      toast.success(`Switched to ${selected}`);
    } catch (error: any) {
      console.error('Failed to switch proxy:', error);
      toast.error(error.response?.data?.error || 'Failed to switch proxy');
    }
  },

  fetchProxyMode: async () => {
    try {
      const res = await proxyModeApi.get();
      const data = res.data.data;
      if (data) {
        set({
          proxyMode: data.mode || 'rule',
          proxyModeRunning: data.running ?? false,
          proxyModeSource: data.source || 'settings',
        });
      }
    } catch (error) {
      console.error('Failed to fetch proxy mode:', error);
    }
  },

  setProxyMode: async (mode: ProxyMode) => {
    set({ proxyModeSwitching: true, proxyModeSwitchingTo: mode });
    try {
      const res = await proxyModeApi.set(mode);
      const data = res.data.data;
      if (data) {
        set({
          proxyMode: data.mode || mode,
          proxyModeRunning: data.running ?? false,
        });
      }
      if (res.data.warning) {
        toast.info(res.data.warning);
      } else {
        toast.success(`Proxy mode: ${mode}`);
      }
    } catch (error: any) {
      console.error('Failed to set proxy mode:', error);
      toast.error(error.response?.data?.error || 'Failed to set proxy mode');
    } finally {
      set({ proxyModeSwitching: false, proxyModeSwitchingTo: null });
    }
  },

  // Pipeline event actions (used by SSE hook)
  addPipelineEvent: (type: string, message: string) => {
    const event: PipelineEvent = {
      id: ++_pipelineEventId,
      type,
      message,
      timestamp: new Date().toISOString(),
    };
    set((state) => ({
      pipelineEvents: [...state.pipelineEvents.slice(-49), event],
    }));
  },

  setVerificationProgress: (progress: VerificationProgress | null) => {
    set({ verificationProgress: progress });
  },

  incrementRunCounter: (counter: 'promoted' | 'demoted' | 'archived') => {
    set((state) => ({
      runCounters: {
        ...state.runCounters,
        [counter]: state.runCounters[counter] + 1,
      },
    }));
  },

  resetRunCounters: () => {
    set({ runCounters: { promoted: 0, demoted: 0, archived: 0 } });
  },

}));
