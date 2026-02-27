export interface ActiveProxyProps {
  mainProxyGroup: { name: string; type: string; now: string; all: string[] } | null;
  resolvedActiveProxyTag: string;
  isAutoMode: boolean;
  activeProxyRefreshing: boolean;
  verificationRunning: boolean;
  proxySearch: string;
  setProxySearch: (v: string) => void;
  filteredMainProxyOptions: string[];
  hasSearchMatches: boolean;
  switchProxy: (group: string, selected: string) => Promise<void>;
  handleRefreshActiveProxy: () => Promise<void>;
  getProxyDisplayTag: (tag: string) => string;
  getProxySourceTag: (tag: string) => string;
  getServerPortLabel: (tag: string) => string;
  getLatestMeasuredDelay: (tag: string) => number | null;
  getSiteCheckSummary: (tag: string) => { avg: number; count: number; failed: number; details: { label: string; delay: number; errorType?: string }[] } | null;
  getGeoLabel: (tag: string) => { emoji: string; country: string } | null;
  delayChipColor: (delay: number | null) => 'default' | 'success' | 'warning' | 'danger';
  siteChipColor: (summary: { avg: number; failed: number }) => 'success' | 'warning' | 'danger';
  formatDelayLabel: (delay: number | null) => string;
}
