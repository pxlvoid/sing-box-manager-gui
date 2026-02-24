import { create } from 'zustand';
import { subscriptionApi, filterApi, ruleApi, ruleGroupApi, settingsApi, serviceApi, nodeApi, manualNodeApi, monitorApi, proxyApi, probeApi } from '../api';
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

const MEASUREMENT_STORAGE_KEY = 'sbm.measurements.v1';
const MAX_MEASUREMENTS_PER_NODE = 20;

interface MeasurementCache {
  healthResults: Record<string, NodeHealthResult>;
  siteCheckResults: Record<string, NodeSiteCheckResult>;
  healthMode: HealthCheckMode | null;
  siteCheckMode: SiteCheckMode | null;
  healthHistory: Record<string, TimedHealthMeasurement[]>;
  siteCheckHistory: Record<string, TimedSiteMeasurement[]>;
}

const EMPTY_MEASUREMENT_CACHE: MeasurementCache = {
  healthResults: {},
  siteCheckResults: {},
  healthMode: null,
  siteCheckMode: null,
  healthHistory: {},
  siteCheckHistory: {},
};

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function loadMeasurementCache(): MeasurementCache {
  if (typeof window === 'undefined') return EMPTY_MEASUREMENT_CACHE;

  try {
    const raw = window.localStorage.getItem(MEASUREMENT_STORAGE_KEY);
    if (!raw) return EMPTY_MEASUREMENT_CACHE;

    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return EMPTY_MEASUREMENT_CACHE;

    return {
      healthResults: isObject(parsed.healthResults) ? parsed.healthResults : {},
      siteCheckResults: isObject(parsed.siteCheckResults) ? parsed.siteCheckResults : {},
      healthMode: ['clash_api', 'clash_api_temp', 'probe'].includes(parsed.healthMode) ? parsed.healthMode : null,
      siteCheckMode: ['clash_api', 'clash_api_temp', 'probe'].includes(parsed.siteCheckMode) ? parsed.siteCheckMode : null,
      healthHistory: isObject(parsed.healthHistory) ? parsed.healthHistory : {},
      siteCheckHistory: isObject(parsed.siteCheckHistory) ? parsed.siteCheckHistory : {},
    };
  } catch {
    return EMPTY_MEASUREMENT_CACHE;
  }
}

function saveMeasurementCache(cache: MeasurementCache): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(MEASUREMENT_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore quota or serialization errors.
  }
}

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

export interface ManualNode {
  id: string;
  node: Node;
  enabled: boolean;
  group_tag?: string;
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
  github_proxy: string;          // GitHub proxy address
  debug_api_enabled: boolean;    // Enable debug API for remote diagnostics
}

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
}

interface AppState {
  // Data
  subscriptions: Subscription[];
  manualNodes: ManualNode[];
  countryGroups: CountryGroup[];
  filters: Filter[];
  rules: Rule[];
  ruleGroups: RuleGroup[];
  defaultRuleGroups: RuleGroup[];
  settings: Settings | null;
  serviceStatus: ServiceStatus | null;
  probeStatus: ProbeStatus | null;
  systemInfo: SystemInfo | null;

  // Group tags
  manualNodeTags: string[];
  selectedGroupTag: string | null;

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

  // Unsupported nodes
  unsupportedNodes: UnsupportedNodeInfo[];

  // Loading state
  loading: boolean;

  // Actions
  fetchSubscriptions: () => Promise<void>;
  fetchManualNodes: () => Promise<void>;
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
  fetchManualNodeTags: () => Promise<void>;
  setSelectedGroupTag: (tag: string | null) => void;

  addSubscription: (name: string, url: string) => Promise<void>;
  updateSubscription: (id: string, name: string, url: string) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
  refreshSubscription: (id: string) => Promise<void>;
  toggleSubscription: (id: string, enabled: boolean) => Promise<void>;

  // Manual node operations
  addManualNodesBulk: (nodes: Omit<ManualNode, 'id'>[], groupTag?: string) => Promise<void>;
  addManualNode: (node: Omit<ManualNode, 'id'>) => Promise<void>;
  updateManualNode: (id: string, node: Partial<ManualNode>) => Promise<void>;
  deleteManualNode: (id: string) => Promise<void>;

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
  checkSingleNodeHealth: (tag: string) => Promise<void>;
  checkNodesSites: (tags?: string[], sites?: string[]) => Promise<void>;
  checkSingleNodeSites: (tag: string, sites?: string[]) => Promise<void>;

  // Unsupported nodes operations
  fetchUnsupportedNodes: () => Promise<void>;
  recheckUnsupportedNodes: () => Promise<void>;
  deleteUnsupportedNodes: (tags?: string[]) => Promise<void>;

  // Proxy group operations
  fetchProxyGroups: () => Promise<void>;
  switchProxy: (group: string, selected: string) => Promise<void>;
}

const measurementCache = loadMeasurementCache();

export const useStore = create<AppState>((set, get) => ({
  subscriptions: [],
  manualNodes: [],
  countryGroups: [],
  filters: [],
  rules: [],
  ruleGroups: [],
  defaultRuleGroups: [],
  settings: null,
  serviceStatus: null,
  probeStatus: null,
  systemInfo: null,
  manualNodeTags: [],
  selectedGroupTag: null,
  healthResults: measurementCache.healthResults,
  healthMode: measurementCache.healthMode,
  healthChecking: false,
  healthCheckingNodes: [],
  healthHistory: measurementCache.healthHistory,
  siteCheckResults: measurementCache.siteCheckResults,
  siteCheckMode: measurementCache.siteCheckMode,
  siteChecking: false,
  siteCheckingNodes: [],
  siteCheckHistory: measurementCache.siteCheckHistory,
  proxyGroups: [],
  unsupportedNodes: [],
  loading: false,

  fetchSubscriptions: async () => {
    try {
      const res = await subscriptionApi.getAll();
      set({ subscriptions: res.data.data || [] });
    } catch (error) {
      console.error('Failed to fetch subscriptions:', error);
    }
  },

  fetchManualNodes: async () => {
    try {
      const res = await manualNodeApi.getAll();
      set({ manualNodes: res.data.data || [] });
    } catch (error) {
      console.error('Failed to fetch manual nodes:', error);
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
      set({ settings: res.data.data });
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

  fetchManualNodeTags: async () => {
    try {
      const res = await manualNodeApi.getTags();
      set({ manualNodeTags: res.data.data || [] });
    } catch (error) {
      console.error('Failed to fetch manual node tags:', error);
    }
  },

  setSelectedGroupTag: (tag: string | null) => {
    set({ selectedGroupTag: tag });
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

  addManualNodesBulk: async (nodes: Omit<ManualNode, 'id'>[], groupTag?: string) => {
    try {
      const res = await manualNodeApi.addBulk(nodes, groupTag);
      await get().fetchManualNodes();
      await get().fetchCountryGroups();
      await get().fetchManualNodeTags();
      if (res.data.warning) {
        toast.info(res.data.warning);
      } else {
        toast.success(`${nodes.length} nodes added successfully`);
      }
    } catch (error: any) {
      console.error('Failed to add nodes in bulk:', error);
      toast.error(error.response?.data?.error || 'Failed to add nodes');
      throw error;
    }
  },

  addManualNode: async (node: Omit<ManualNode, 'id'>) => {
    try {
      const res = await manualNodeApi.add(node);
      await get().fetchManualNodes();
      await get().fetchCountryGroups();
      await get().fetchManualNodeTags();
      if (res.data.warning) {
        toast.info(res.data.warning);
      } else {
        toast.success('Node added successfully');
      }
    } catch (error: any) {
      console.error('Failed to add manual node:', error);
      toast.error(error.response?.data?.error || 'Failed to add node');
      throw error;
    }
  },

  updateManualNode: async (id: string, node: Partial<ManualNode>) => {
    try {
      const res = await manualNodeApi.update(id, node);
      await get().fetchManualNodes();
      await get().fetchCountryGroups();
      await get().fetchManualNodeTags();
      if (res.data.warning) {
        toast.info(res.data.warning);
      } else {
        toast.success('Node updated successfully');
      }
    } catch (error: any) {
      console.error('Failed to update manual node:', error);
      toast.error(error.response?.data?.error || 'Failed to update node');
      throw error;
    }
  },

  deleteManualNode: async (id: string) => {
    try {
      const res = await manualNodeApi.delete(id);
      await get().fetchManualNodes();
      await get().fetchCountryGroups();
      await get().fetchManualNodeTags();
      if (res.data.warning) {
        toast.info(res.data.warning);
      } else {
        toast.success('Node deleted');
      }
    } catch (error: any) {
      console.error('Failed to delete manual node:', error);
      toast.error(error.response?.data?.error || 'Failed to delete node');
    }
  },

  updateSettings: async (settings: Settings) => {
    try {
      const res = await settingsApi.update(settings);
      // Use backend-returned data (may contain auto-generated secret)
      if (res.data.data) {
        set({ settings: res.data.data });
      } else {
        set({ settings });
      }
    } catch (error) {
      console.error('Failed to update settings:', error);
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
      saveMeasurementCache({
        healthResults,
        siteCheckResults: state.siteCheckResults,
        healthMode: mode,
        siteCheckMode: state.siteCheckMode,
        healthHistory,
        siteCheckHistory: state.siteCheckHistory,
      });
      toast.success('Health check completed');
    } catch (error: any) {
      console.error('Failed to check nodes health:', error);
      toast.error(error.response?.data?.error || 'Health check failed');
    } finally {
      set({ healthChecking: false });
    }
  },

  checkSingleNodeHealth: async (tag: string) => {
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
      saveMeasurementCache({
        healthResults,
        siteCheckResults: state.siteCheckResults,
        healthMode: mode,
        siteCheckMode: state.siteCheckMode,
        healthHistory,
        siteCheckHistory: state.siteCheckHistory,
      });
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
      saveMeasurementCache({
        healthResults: state.healthResults,
        siteCheckResults,
        healthMode: state.healthMode,
        siteCheckMode: mode,
        healthHistory: state.healthHistory,
        siteCheckHistory,
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
      saveMeasurementCache({
        healthResults: state.healthResults,
        siteCheckResults,
        healthMode: state.healthMode,
        siteCheckMode: mode,
        healthHistory: state.healthHistory,
        siteCheckHistory,
      });
    } catch (error: any) {
      console.error('Failed to check node sites:', error);
      toast.error(error.response?.data?.error || 'Site check failed');
    } finally {
      set({ siteCheckingNodes: get().siteCheckingNodes.filter(t => t !== tag) });
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
        get().fetchManualNodes(),
        get().fetchCountryGroups(),
      ]);
    } catch (error: any) {
      console.error('Failed to delete unsupported nodes:', error);
      toast.error(error.response?.data?.error || 'Failed to delete nodes');
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
}));
