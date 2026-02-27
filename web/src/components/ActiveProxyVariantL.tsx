/**
 * Variant L — Big Number Focus
 * Large prominent latency number as the hero element, minimalist feel.
 */
import { Card, CardBody, CardHeader, Button, Chip, Input, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';

export default function ActiveProxyVariantL({
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
        <CardHeader><div className="flex items-center gap-2"><Globe className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant L — Big Number</h2></div></CardHeader>
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

  const bigColor = delay === null ? 'text-gray-300 dark:text-gray-600' : delay <= 0 ? 'text-danger' : delay < 300 ? 'text-success' : delay < 800 ? 'text-warning' : 'text-danger';

  return (
    <Card>
      <CardHeader><div className="flex items-center gap-2"><Globe className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant L — Big Number</h2></div></CardHeader>
      <CardBody className="space-y-4">
        <div className="flex items-center gap-6">
          {/* Big number */}
          <div className="flex flex-col items-center shrink-0">
            <span className={`text-5xl font-black tabular-nums leading-none ${bigColor}`}>
              {delay !== null ? (delay > 0 ? delay : '!') : '--'}
            </span>
            <span className="text-xs text-gray-500 mt-1">{delay !== null && delay > 0 ? 'ms TCP latency' : delay === 0 ? 'Connection failed' : 'No data'}</span>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {geo && (
                <Tooltip content={geo.country}>
                  <span className="text-xl cursor-default">{geo.emoji}</span>
                </Tooltip>
              )}
              <span className="font-bold text-lg truncate">{display}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
              {source && source !== display && <span className="truncate max-w-[200px]">{source}</span>}
              {serverPort && <span className="font-mono">{serverPort}</span>}
              {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
                <span>via {getProxyDisplayTag(mainProxyGroup.now)}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2">
              {summary && (
                <Tooltip placement="top-start" showArrow delay={100} content={
                  <div className="flex flex-col gap-1 py-1">{summary.details.map((d) => (
                    <div key={d.label} className="flex items-center justify-between gap-4 text-xs min-w-[180px]">
                      <span className="text-default-600">{d.label}</span>
                      <span className={d.delay > 0 ? (d.delay < 800 ? 'text-success' : 'text-warning') : 'text-danger'}>{d.delay > 0 ? `${d.delay}ms` : 'Fail'}</span>
                    </div>
                  ))}</div>
                }>
                  <Chip size="sm" variant="flat" color={siteChipColor(summary)} className="cursor-help">
                    Sites: {summary.failed > 0 ? `${summary.failed}/${summary.count} fail` : `${summary.avg}ms avg (${summary.count})`}
                  </Chip>
                </Tooltip>
              )}
              <Button
                size="sm"
                color="primary"
                variant="flat"
                startContent={!activeProxyRefreshing ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
                isLoading={activeProxyRefreshing}
                isDisabled={!resolvedActiveProxyTag || verificationRunning}
                onPress={handleRefreshActiveProxy}
              >
                Pipeline
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
