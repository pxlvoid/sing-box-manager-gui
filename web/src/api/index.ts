import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// Subscription API
export const subscriptionApi = {
  getAll: () => api.get('/subscriptions'),
  add: (name: string, url: string) => api.post('/subscriptions', { name, url }),
  update: (id: string, data: any) => api.put(`/subscriptions/${id}`, data),
  delete: (id: string) => api.delete(`/subscriptions/${id}`),
  refresh: (id: string) => api.post(`/subscriptions/${id}/refresh`),
  refreshAll: () => api.post('/subscriptions/refresh-all'),
};

// Filter API
export const filterApi = {
  getAll: () => api.get('/filters'),
  add: (data: any) => api.post('/filters', data),
  update: (id: string, data: any) => api.put(`/filters/${id}`, data),
  delete: (id: string) => api.delete(`/filters/${id}`),
};

// Rule API
export const ruleApi = {
  getAll: () => api.get('/rules'),
  add: (data: any) => api.post('/rules', data),
  replaceAll: (rules: any[]) => api.put('/rules/replace', { rules }),
  update: (id: string, data: any) => api.put(`/rules/${id}`, data),
  delete: (id: string) => api.delete(`/rules/${id}`),
};

// Rule group API
export const ruleGroupApi = {
  getAll: () => api.get('/rule-groups'),
  getDefaults: () => api.get('/rule-groups/defaults'),
  update: (id: string, data: any) => api.put(`/rule-groups/${id}`, data),
  reset: (id: string) => api.post(`/rule-groups/${id}/reset`),
};

// Ruleset validation API
export const ruleSetApi = {
  validate: (type: 'geosite' | 'geoip', name: string) =>
    api.get('/ruleset/validate', { params: { type, name } }),
};

// Settings API
export const settingsApi = {
  get: () => api.get('/settings'),
  update: (data: any) => api.put('/settings', data),
  getSystemHosts: () => api.get('/system-hosts'),
};

// Config API
export const configApi = {
  generate: () => api.post('/config/generate'),
  preview: () => api.get('/config/preview'),
  apply: () => api.post('/config/apply'),
};

// Service API
export const serviceApi = {
  status: () => api.get('/service/status'),
  start: () => api.post('/service/start'),
  stop: () => api.post('/service/stop'),
  restart: () => api.post('/service/restart'),
  reload: () => api.post('/service/reload'),
};

// launchd API
export const launchdApi = {
  status: () => api.get('/launchd/status'),
  install: () => api.post('/launchd/install'),
  uninstall: () => api.post('/launchd/uninstall'),
  restart: () => api.post('/launchd/restart'),
};

// Unified daemon API (auto-detects OS)
export const daemonApi = {
  status: () => api.get('/daemon/status'),
  install: () => api.post('/daemon/install'),
  uninstall: () => api.post('/daemon/uninstall'),
  restart: () => api.post('/daemon/restart'),
};

// Monitor API
export const monitorApi = {
  system: () => api.get('/monitor/system'),
  logs: () => api.get('/monitor/logs'),
  appLogs: (lines: number = 200) => api.get(`/monitor/logs/sbm?lines=${lines}`),
  singboxLogs: (lines: number = 200) => api.get(`/monitor/logs/singbox?lines=${lines}`),
};

// Node API
export const nodeApi = {
  getAll: () => api.get('/nodes'),
  getCountries: () => api.get('/nodes/countries'),
  getByCountry: (code: string) => api.get(`/nodes/country/${code}`),
  parse: (url: string) => api.post('/nodes/parse', { url }),
  parseBulk: (urls: string[]) => api.post('/nodes/parse-bulk', { urls }),
  healthCheck: (tags?: string[]) =>
    api.post('/nodes/health-check', { tags }, { timeout: 60000 }),
  healthCheckSingle: (tag: string) =>
    api.post('/nodes/health-check-single', { tag }, { timeout: 15000 }),
  getUnsupported: () => api.get('/nodes/unsupported'),
  recheckUnsupported: () => api.post('/nodes/unsupported/recheck'),
  clearUnsupported: () => api.delete('/nodes/unsupported'),
  deleteUnsupported: (tags?: string[]) => api.post('/nodes/unsupported/delete', { tags }),
};

// Manual node API
export const manualNodeApi = {
  getAll: () => api.get('/manual-nodes'),
  add: (data: any) => api.post('/manual-nodes', data),
  addBulk: (nodes: any[], groupTag?: string) => api.post('/manual-nodes/bulk', { nodes, group_tag: groupTag }),
  getTags: () => api.get('/manual-nodes/tags'),
  update: (id: string, data: any) => api.put(`/manual-nodes/${id}`, data),
  delete: (id: string) => api.delete(`/manual-nodes/${id}`),
  export: (ids?: string[]) => api.post('/manual-nodes/export', ids ? { ids } : {}),
};

// Kernel management API
export const kernelApi = {
  getInfo: () => api.get('/kernel/info'),
  getReleases: () => api.get('/kernel/releases'),
  download: (version: string) => api.post('/kernel/download', { version }),
  getProgress: () => api.get('/kernel/progress'),
};

// Proxy group API (Clash API proxy)
export const proxyApi = {
  getGroups: () => api.get('/proxy/groups'),
  switchGroup: (group: string, selected: string) =>
    api.put(`/proxy/groups/${encodeURIComponent(group)}`, { name: selected }),
};

export default api;
