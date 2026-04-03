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
  probeLogs: (lines: number = 200) => api.get(`/monitor/logs/probe?lines=${lines}`),
};

// Node API
export const nodeApi = {
  getAll: () => api.get('/nodes'),
  getCountries: () => api.get('/nodes/countries'),
  getByCountry: (code: string) => api.get(`/nodes/country/${code}`),
  parse: (url: string) => api.post('/nodes/parse', { url }),
  parseBulk: (urls: string[], defaultProtocol?: string) =>
    api.post('/nodes/parse-bulk', { urls, default_protocol: defaultProtocol }),
  healthCheck: (tags?: string[]) =>
    api.post('/nodes/health-check', { tags }, { timeout: 60000 }),
  healthCheckSingle: (tag: string) =>
    api.post('/nodes/health-check-single', { tag, internal_tag: tag }, { timeout: 15000 }),
  siteCheck: (tags?: string[], sites?: string[]) =>
    api.post('/nodes/site-check', { tags, sites }, { timeout: 180000 }),
  speedTest: (tags?: string[]) =>
    api.post('/nodes/speed-test', { tags }, { timeout: 600000 }),
  getGeoData: () => api.get('/nodes/geo'),
  getNodeGeo: (server: string, port: number) =>
    api.get(`/nodes/geo/${encodeURIComponent(server)}/${port}`),
  geoCheck: (tags?: string[]) =>
    api.post('/nodes/geo-check', { tags }, { timeout: 300000 }),
  getUnsupported: () => api.get('/nodes/unsupported'),
  recheckUnsupported: () => api.post('/nodes/unsupported/recheck'),
  clearUnsupported: () => api.delete('/nodes/unsupported'),
  deleteUnsupported: (tags?: string[]) => api.post('/nodes/unsupported/delete', { tags }),
};

// Unified node API
export const unifiedNodeApi = {
  getAll: (status?: string) => api.get('/nodes/unified', { params: status ? { status } : {} }),
  add: (data: any) => api.post('/nodes/unified', data),
  addBulk: (nodes: any[], groupTag?: string, source?: string) =>
    api.post('/nodes/unified/bulk', { nodes, group_tag: groupTag, source }),
  update: (id: number, data: any) => api.put(`/nodes/unified/${id}`, data),
  delete: (id: number) => api.delete(`/nodes/unified/${id}`),
  promote: (id: number) => api.post(`/nodes/unified/${id}/promote`),
  demote: (id: number) => api.post(`/nodes/unified/${id}/demote`),
  archive: (id: number) => api.post(`/nodes/unified/${id}/archive`),
  unarchive: (id: number) => api.post(`/nodes/unified/${id}/unarchive`),
  bulkPromote: (ids: number[]) => api.post('/nodes/unified/bulk-promote', { ids }),
  bulkArchive: (ids: number[]) => api.post('/nodes/unified/bulk-archive', { ids }),
  getCounts: () => api.get('/nodes/unified/counts'),
  exportLinks: (ids?: number[], status?: string) =>
    api.post('/nodes/unified/export-links', { ids, status }),
  toggleFavorite: (id: number, favorite: boolean) => api.post(`/nodes/unified/${id}/favorite`, { favorite }),
};

// Verification API
export const verificationApi = {
  run: () => api.post('/verification/run'),
  runTags: (tags: string[]) => api.post('/verification/run-tags', { tags }),
  getLogs: (limit?: number) => api.get('/verification/logs', { params: { limit: limit || 20 } }),
  getStatus: () => api.get('/verification/status'),
  start: () => api.post('/verification/start'),
  stop: () => api.post('/verification/stop'),
};

export const pipelineApi = {
  getActivity: (limit?: number) => api.get('/pipeline/activity', { params: { limit: limit || 50 } }),
};

// Kernel management API
export const kernelApi = {
  getInfo: () => api.get('/kernel/info'),
  getReleases: () => api.get('/kernel/releases'),
  download: (version: string) => api.post('/kernel/download', { version }),
  getProgress: () => api.get('/kernel/progress'),
};

// Probe API
export const probeApi = {
  status: () => api.get('/probe/status'),
  stop: () => api.post('/probe/stop'),
};

// Proxy group API (Clash API proxy)
export const proxyApi = {
  getGroups: () => api.get('/proxy/groups'),
  switchGroup: (group: string, selected: string) =>
    api.put(`/proxy/groups/${encodeURIComponent(group)}`, { name: selected }),
  checkDelay: (name: string) => api.get(`/proxy/delay/${encodeURIComponent(name)}`),
};

// Proxy mode API
export const proxyModeApi = {
  get: () => api.get('/proxy/mode'),
  set: (mode: string) => api.put('/proxy/mode', { mode }),
};

// Traffic monitoring API
export const monitoringApi = {
  getOverview: () => api.get('/monitoring/overview'),
  getLifetime: () => api.get('/monitoring/lifetime'),
  getHistory: (limit: number = 120, hours?: number) => api.get('/monitoring/history', { params: { limit, hours: hours || undefined } }),
  getClients: (limit: number = 200) => api.get('/monitoring/clients', { params: { limit } }),
  getRecentClients: (limit: number = 300, hours: number = 24) =>
    api.get('/monitoring/clients/recent', { params: { limit, hours } }),
  getResources: (limit: number = 300, sourceIP?: string) =>
    api.get('/monitoring/resources', { params: { limit, source_ip: sourceIP || undefined } }),
  getClientHistory: (
    sourceIP: string,
    options: { limit?: number; hours?: number; maxPoints?: number } = {},
  ) =>
    api.get('/monitoring/clients/history', {
      params: {
        source_ip: sourceIP,
        limit: options.limit,
        hours: options.hours,
        max_points: options.maxPoints,
      },
    }),
  getNodeTraffic: (limit: number = 100, hours: number = 0) =>
    api.get('/monitoring/nodes', { params: { limit, hours } }),
  getClientResourcesHistory: (sourceIP: string, limit: number = 500) =>
    api.get(`/monitoring/clients/${encodeURIComponent(sourceIP)}/resources/history`, { params: { limit } }),
};

// Database API
export const databaseApi = {
  stats: () => api.get('/database/stats'),
  exportUrl: '/api/database/export',
  import: (file: File) => {
    const formData = new FormData();
    formData.append('database', file);
    return api.post('/database/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },
};

// Debug API
export const debugApi = {
  dump: () => api.get('/debug/dump'),
  singboxLogs: (lines: number = 500) => api.get(`/debug/logs/singbox?lines=${lines}`),
  appLogs: (lines: number = 500) => api.get(`/debug/logs/app?lines=${lines}`),
  probeLogs: (lines: number = 500) => api.get(`/debug/logs/probe?lines=${lines}`),
};

// Measurement API
export const measurementApi = {
  getLatest: () => api.get('/measurements/latest'),
  getHealth: (server: string, port: number, limit?: number) =>
    api.get('/measurements/health', { params: { server, port, limit } }),
  getHealthStats: (server: string, port: number) =>
    api.get('/measurements/health/stats', { params: { server, port } }),
  getBulkHealthStats: (days?: number) =>
    api.get('/measurements/health/stats/bulk', { params: { days: days || 7 } }),
  getSite: (server: string, port: number, limit?: number) =>
    api.get('/measurements/site', { params: { server, port, limit } }),
  getLatestSpeed: () => api.get('/measurements/speed/latest'),
};

// Diagnostic API
export const diagnosticApi = {
  getAll: () => api.get('/diagnostic'),
};

export default api;
