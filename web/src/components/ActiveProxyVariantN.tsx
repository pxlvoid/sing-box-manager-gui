/**
 * Variant N — Gradient Banner
 * Full-width gradient banner at top with floating metrics overlay, modern SaaS feel.
 */
import { Card, CardBody, CardHeader, Button, Chip, Input, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search, Shield } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';

export default function ActiveProxyVariantN({
  mainProxyGroup, resolvedActiveProxyTag, isAutoMode,
  activeProxyRefreshing, verificationRunning,
  proxySearch, setProxySearch, filteredMainProxyOptions, hasSearchMatches,
  switchProxy, handleRefreshActiveProxy,
  getProxyDisplayTag, getProxySourceTag, getServerPortLabel,
  getLatestMeasuredDelay, getSiteCheckSummary, getGeoLabel,
  delayChipColor, siteChipColor, formatDelayLabel,
}: ActiveProxyProps) {
  if (!mainProxyGroup) {
    return (
      <Card>
        <CardHeader><div className="flex items-center gap-2"><Globe className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant N — Gradient Banner</h2></div></CardHeader>
        <CardBody><div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl text-center"><p className="text-gray-500">sing-box is not running</p></div></CardBody>
      </Card>
    );
  }

  const tag = resolvedActiveProxyTag || mainProxyGroup.now;
  const display = getProxyDisplayTag(tag);
  const source = getProxySourceTag(tag);
  const serverPort = getServerPortLabel(tag);
  const delay = getLatestMeasuredDelay(tag);
  const summary = getSiteCheckSummary(tag);
  const geo = getGeoLabel(tag);

  return (
    <Card>
      <CardHeader><div className="flex items-center gap-2"><Globe className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant N — Gradient Banner</h2></div></CardHeader>
      <CardBody className="p-0">
        {/* Gradient banner */}
        <div className="relative mx-3 mt-1 rounded-2xl overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.15),transparent_60%)]" />

          <div className="relative px-5 pt-5 pb-12 text-white">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 opacity-80" />
                <span className="text-xs font-medium uppercase tracking-wider opacity-80">Active Connection</span>
              </div>
              <Button
                size="sm"
                variant="flat"
                className="bg-white/20 text-white border-white/30 backdrop-blur-sm"
                startContent={!activeProxyRefreshing ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
                isLoading={activeProxyRefreshing}
                isDisabled={!resolvedActiveProxyTag || verificationRunning}
                onPress={handleRefreshActiveProxy}
              >
                Pipeline
              </Button>
            </div>

            <div className="flex items-center gap-3 mb-1">
              {geo && <span className="text-3xl">{geo.emoji}</span>}
              <div>
                <h3 className="text-2xl font-bold">{display}</h3>
                <div className="flex items-center gap-2 text-xs opacity-70">
                  {geo && <span>{geo.country}</span>}
                  {serverPort && <span className="font-mono">{serverPort}</span>}
                  {source && source !== display && <span>{source}</span>}
                </div>
              </div>
            </div>

            {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
              <p className="text-xs opacity-60 mt-1">via {getProxyDisplayTag(mainProxyGroup.now)}</p>
            )}
          </div>

          {/* Floating metrics cards overlapping banner */}
          <div className="relative -mt-8 mx-3 mb-3 flex gap-3">
            <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-3 border border-gray-200 dark:border-gray-700">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">TCP Latency</p>
              <div className="flex items-center gap-2">
                <span className={`text-xl font-bold ${delay !== null && delay > 0 ? (delay < 300 ? 'text-success' : delay < 800 ? 'text-warning' : 'text-danger') : delay === 0 ? 'text-danger' : 'text-gray-400'}`}>
                  {delay !== null ? (delay > 0 ? `${delay}ms` : 'Fail') : '-'}
                </span>
              </div>
            </div>

            {summary ? (
              <Tooltip placement="top" showArrow delay={100} content={
                <div className="flex flex-col gap-1 py-1">{summary.details.map((d) => (
                  <div key={d.label} className="flex items-center justify-between gap-4 text-xs min-w-[180px]">
                    <span className="text-default-600">{d.label}</span>
                    <span className={d.delay > 0 ? (d.delay < 800 ? 'text-success' : 'text-warning') : 'text-danger'}>{d.delay > 0 ? `${d.delay}ms` : 'Fail'}</span>
                  </div>
                ))}</div>
              }>
                <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-3 border border-gray-200 dark:border-gray-700 cursor-help">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Site Check</p>
                  <div className="flex items-center gap-2">
                    <span className={`text-xl font-bold ${summary.failed > 0 ? 'text-danger' : summary.avg >= 800 ? 'text-warning' : 'text-success'}`}>
                      {summary.failed > 0 ? `${summary.failed} Fail` : `${summary.avg}ms`}
                    </span>
                    <span className="text-xs text-gray-500">/ {summary.count}</span>
                  </div>
                </div>
              </Tooltip>
            ) : (
              <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-3 border border-gray-200 dark:border-gray-700">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Site Check</p>
                <span className="text-xl font-bold text-gray-400">-</span>
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-3 px-3 pb-3 pt-1">
          <Input size="sm" value={proxySearch} onChange={(e) => setProxySearch(e.target.value)} placeholder="Search proxy..." startContent={<Search className="w-4 h-4 text-gray-400" />} aria-label="Search proxy" />
          <Select size="lg" selectedKeys={[mainProxyGroup.now]} onChange={(e) => { if (e.target.value) { switchProxy(mainProxyGroup.name, e.target.value); setProxySearch(''); } }} aria-label="Select proxy" classNames={{ trigger: 'min-h-14', value: 'text-base' }}>
            {filteredMainProxyOptions.map((item) => {
              const s = getSiteCheckSummary(item); const g = getGeoLabel(item); const d = getProxyDisplayTag(item); const src = getProxySourceTag(item);
              return (<SelectItem key={item} textValue={`${d} ${src} ${item}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">{g && <span className="text-lg shrink-0">{g.emoji}</span>}<div className="min-w-0"><p className="text-sm truncate">{d}</p>{src && src !== d && <p className="text-xs text-gray-500 truncate">{src}</p>}</div></div>
                  <div className="flex items-center gap-1 shrink-0">{getLatestMeasuredDelay(item) !== null && <Chip size="sm" variant="flat" color={delayChipColor(getLatestMeasuredDelay(item))}>{formatDelayLabel(getLatestMeasuredDelay(item))}</Chip>}{s && <Chip size="sm" variant="flat" color={siteChipColor(s)}>{s.failed > 0 ? `Fail (${s.failed}/${s.count})` : `${s.avg}ms (${s.count})`}</Chip>}</div>
                </div>
              </SelectItem>);
            })}
          </Select>
          {!hasSearchMatches && <p className="text-sm text-gray-500">No proxies found for "{proxySearch.trim()}"</p>}
        </div>
      </CardBody>
    </Card>
  );
}
