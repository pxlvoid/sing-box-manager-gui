/**
 * Variant K — Sidebar Accent
 * Left color accent bar with structured content, inspired by Notion / Linear.
 */
import { Card, CardBody, CardHeader, Button, Chip, Input, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';

export default function ActiveProxyVariantK({
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
        <CardHeader><div className="flex items-center gap-2"><Globe className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant K — Sidebar Accent</h2></div></CardHeader>
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

  const accentColor = delay === null ? 'bg-gray-400' : delay <= 0 ? 'bg-danger' : delay < 300 ? 'bg-success' : delay < 800 ? 'bg-warning' : 'bg-danger';

  return (
    <Card>
      <CardHeader><div className="flex items-center gap-2"><Globe className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant K — Sidebar Accent</h2></div></CardHeader>
      <CardBody className="space-y-4">
        {/* Main info with left accent bar */}
        <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
          {/* Accent bar */}
          <div className={`w-1.5 shrink-0 ${accentColor}`} />

          <div className="flex-1 p-4 flex flex-col sm:flex-row gap-4">
            {/* Left: Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                {geo && (
                  <Tooltip content={geo.country}>
                    <span className="text-xl cursor-default">{geo.emoji}</span>
                  </Tooltip>
                )}
                <h3 className="font-bold text-lg truncate">{display}</h3>
              </div>

              <div className="space-y-1">
                {source && source !== display && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider w-14 shrink-0">Source</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400 truncate">{source}</span>
                  </div>
                )}
                {serverPort && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider w-14 shrink-0">Server</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400 font-mono">{serverPort}</span>
                  </div>
                )}
                {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider w-14 shrink-0">Via</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400">{getProxyDisplayTag(mainProxyGroup.now)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Metrics + action */}
            <div className="flex flex-col items-end gap-2 shrink-0">
              <div className="flex items-center gap-2">
                {delay !== null && (
                  <Chip size="md" variant="flat" color={delayChipColor(delay)} className="font-semibold">
                    {formatDelayLabel(delay)}
                  </Chip>
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
                    <Chip size="md" variant="flat" color={siteChipColor(summary)} className="cursor-help font-semibold">
                      {summary.failed > 0 ? `${summary.failed}/${summary.count} fail` : `${summary.avg}ms (${summary.count})`}
                    </Chip>
                  </Tooltip>
                )}
              </div>
              <Button
                size="sm"
                color="primary"
                variant="flat"
                startContent={!activeProxyRefreshing ? <RefreshCw className="w-4 h-4" /> : undefined}
                isLoading={activeProxyRefreshing}
                isDisabled={!resolvedActiveProxyTag || verificationRunning}
                onPress={handleRefreshActiveProxy}
              >
                Run Pipeline
              </Button>
            </div>
          </div>
        </div>

        {/* Controls */}
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
      </CardBody>
    </Card>
  );
}
