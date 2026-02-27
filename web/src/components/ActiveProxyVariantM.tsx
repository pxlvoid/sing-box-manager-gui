/**
 * Variant M — Pill Tags
 * Everything as horizontal pill-shaped tags, modern tag-cloud feel with clear grouping.
 */
import { Card, CardBody, CardHeader, Button, Chip, Input, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search, MapPin, Server, Gauge, BarChart3 } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';

export default function ActiveProxyVariantM({
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
        <CardHeader><div className="flex items-center gap-2"><Globe className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant M — Pill Tags</h2></div></CardHeader>
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
      <CardHeader className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Variant M — Pill Tags</h2>
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
      </CardHeader>
      <CardBody className="space-y-4">
        {/* All info as pills/tags */}
        <div className="flex flex-wrap gap-2">
          {/* Name pill — prominent */}
          <Chip size="lg" variant="solid" color="primary" className="font-bold text-base h-9 px-4">
            {display}
          </Chip>

          {/* Geo pill */}
          {geo && (
            <Tooltip content={geo.country}>
              <Chip size="lg" variant="bordered" className="h-9 cursor-default" startContent={<MapPin className="w-3.5 h-3.5" />}>
                {geo.emoji} {geo.country}
              </Chip>
            </Tooltip>
          )}

          {/* Source pill */}
          {source && source !== display && (
            <Chip size="lg" variant="bordered" className="h-9 max-w-[240px]" title={source}>
              {source}
            </Chip>
          )}

          {/* Server pill */}
          {serverPort && (
            <Chip size="lg" variant="bordered" className="h-9 font-mono" startContent={<Server className="w-3.5 h-3.5" />}>
              {serverPort}
            </Chip>
          )}

          {/* TCP delay pill */}
          {delay !== null && (
            <Chip size="lg" variant="flat" color={delayChipColor(delay)} className="h-9 font-semibold" startContent={<Gauge className="w-3.5 h-3.5" />}>
              TCP {formatDelayLabel(delay)}
            </Chip>
          )}

          {/* Site check pill */}
          {summary && (
            <Tooltip placement="top-start" showArrow delay={100} content={
              <div className="flex flex-col gap-1 py-1">{summary.details.map((d) => (
                <div key={d.label} className="flex items-center justify-between gap-4 text-xs min-w-[180px]">
                  <span className="text-default-600">{d.label}</span>
                  <span className={d.delay > 0 ? (d.delay < 800 ? 'text-success' : 'text-warning') : 'text-danger'}>{d.delay > 0 ? `${d.delay}ms` : 'Fail'}</span>
                </div>
              ))}</div>
            }>
              <Chip size="lg" variant="flat" color={siteChipColor(summary)} className="h-9 font-semibold cursor-help" startContent={<BarChart3 className="w-3.5 h-3.5" />}>
                Sites {summary.failed > 0 ? `${summary.failed}/${summary.count} fail` : `${summary.avg}ms (${summary.count})`}
              </Chip>
            </Tooltip>
          )}

          {/* Via pill */}
          {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
            <Chip size="lg" variant="dot" color="warning" className="h-9">
              via {getProxyDisplayTag(mainProxyGroup.now)}
            </Chip>
          )}
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
