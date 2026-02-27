/**
 * Variant E — Glassmorphism
 * Frosted glass card with layered depth, gradient accents, soft shadows.
 */
import { Card, CardBody, CardHeader, Button, Chip, Input, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search, Signal } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';

export default function ActiveProxyVariantE({
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
        <CardHeader><div className="flex items-center gap-2"><Globe className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant E — Glassmorphism</h2></div></CardHeader>
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
      <CardHeader><div className="flex items-center gap-2"><Globe className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant E — Glassmorphism</h2></div></CardHeader>
      <CardBody className="p-0">
        {/* Glass hero */}
        <div className="relative overflow-hidden mx-3 mt-1 mb-4 rounded-2xl">
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/20 via-blue-500/20 to-cyan-500/20 dark:from-violet-500/30 dark:via-blue-500/30 dark:to-cyan-500/30" />
          <div className="absolute top-[-50%] right-[-20%] w-64 h-64 rounded-full bg-blue-400/20 blur-3xl" />
          <div className="absolute bottom-[-50%] left-[-20%] w-64 h-64 rounded-full bg-violet-400/20 blur-3xl" />

          <div className="relative backdrop-blur-sm p-5 space-y-4">
            {/* Top row: status badge */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wider">Connected</span>
              </div>
              <Button
                size="sm"
                color="secondary"
                variant="flat"
                className="backdrop-blur-md"
                startContent={!activeProxyRefreshing ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
                isLoading={activeProxyRefreshing}
                isDisabled={!resolvedActiveProxyTag || verificationRunning}
                onPress={handleRefreshActiveProxy}
              >
                Pipeline
              </Button>
            </div>

            {/* Main info */}
            <div className="flex items-center gap-4">
              {geo ? (
                <Tooltip content={geo.country}>
                  <div className="w-14 h-14 rounded-2xl bg-white/40 dark:bg-white/10 backdrop-blur-md flex items-center justify-center text-3xl shadow-lg shadow-black/5 cursor-default border border-white/30">
                    {geo.emoji}
                  </div>
                </Tooltip>
              ) : (
                <div className="w-14 h-14 rounded-2xl bg-white/40 dark:bg-white/10 backdrop-blur-md flex items-center justify-center shadow-lg shadow-black/5 border border-white/30">
                  <Signal className="w-6 h-6 text-gray-400" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-lg font-bold truncate">{display}</p>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  {source && source !== display && <span className="text-xs text-gray-500 dark:text-gray-400">{source}</span>}
                  {serverPort && <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">· {serverPort}</span>}
                </div>
                {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
                  <p className="text-xs text-gray-500 mt-0.5">via {getProxyDisplayTag(mainProxyGroup.now)}</p>
                )}
              </div>
            </div>

            {/* Metrics in glass pills */}
            <div className="flex gap-2 flex-wrap">
              {delay !== null && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/50 dark:bg-white/10 backdrop-blur-md border border-white/30 text-sm">
                  <div className={`w-1.5 h-1.5 rounded-full ${delay <= 0 ? 'bg-danger' : delay < 300 ? 'bg-success' : delay < 800 ? 'bg-warning' : 'bg-danger'}`} />
                  <span className="font-medium">{formatDelayLabel(delay)}</span>
                </div>
              )}
              {summary && (
                <Tooltip placement="top-start" showArrow delay={100} content={
                  <div className="flex flex-col gap-1 py-1">{summary.details.map((d) => (
                    <div key={d.label} className="flex items-center justify-between gap-4 text-xs min-w-[180px]">
                      <span className="text-default-600">{d.label}</span>
                      <span className={d.delay > 0 ? (d.delay < 800 ? 'text-success' : 'text-warning') : 'text-danger'}>{d.delay > 0 ? `${d.delay}ms` : 'Fail'}</span>
                    </div>
                  ))}</div>
                }>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/50 dark:bg-white/10 backdrop-blur-md border border-white/30 text-sm cursor-help">
                    <div className={`w-1.5 h-1.5 rounded-full ${summary.failed > 0 ? 'bg-danger' : 'bg-success'}`} />
                    <span className="font-medium">{summary.failed > 0 ? `${summary.failed} fail` : `${summary.avg}ms`}</span>
                    <span className="text-gray-500 text-xs">({summary.count})</span>
                  </div>
                </Tooltip>
              )}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-3 px-3 pb-3">
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
