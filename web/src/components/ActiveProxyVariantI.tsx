/**
 * Variant I — Bento Grid
 * Trendy bento box layout with distinct cells for each piece of info.
 */
import { Card, CardBody, CardHeader, Button, Chip, Input, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search, Zap, BarChart3, MapPin, Server } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';

export default function ActiveProxyVariantI({
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
        <CardHeader><div className="flex items-center gap-2"><Globe className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant I — Bento Grid</h2></div></CardHeader>
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
          <h2 className="text-lg font-semibold">Variant I — Bento Grid</h2>
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
        {/* Bento grid */}
        <div className="grid grid-cols-4 gap-2">
          {/* Name cell — spans 2 cols */}
          <div className="col-span-2 p-4 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 flex flex-col justify-center">
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Server className="w-3 h-3" /> Active Node</p>
            <p className="text-lg font-bold truncate">{display}</p>
            {source && source !== display && (
              <p className="text-xs text-gray-500 truncate mt-0.5">{source}</p>
            )}
            {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
              <p className="text-xs text-gray-400 mt-1">via {getProxyDisplayTag(mainProxyGroup.now)}</p>
            )}
          </div>

          {/* Geo cell */}
          <div className="col-span-1 p-4 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center">
            <MapPin className="w-3 h-3 text-gray-400 mb-1" />
            {geo ? (
              <>
                <span className="text-3xl mb-1">{geo.emoji}</span>
                <span className="text-[10px] text-gray-500 text-center leading-tight">{geo.country}</span>
              </>
            ) : (
              <span className="text-sm text-gray-400">N/A</span>
            )}
          </div>

          {/* TCP cell */}
          <div className="col-span-1 p-4 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center">
            <Zap className="w-3 h-3 text-gray-400 mb-1" />
            <span className={`text-2xl font-bold ${delay !== null && delay > 0 ? (delay < 300 ? 'text-success' : delay < 800 ? 'text-warning' : 'text-danger') : delay === 0 ? 'text-danger' : 'text-gray-400'}`}>
              {delay !== null ? (delay > 0 ? delay : '!') : '-'}
            </span>
            <span className="text-[10px] text-gray-500">{delay !== null && delay > 0 ? 'ms TCP' : delay === 0 ? 'FAIL' : 'TCP'}</span>
          </div>

          {/* Server + Site check row — spans 4 */}
          {serverPort && (
            <div className="col-span-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <Server className="w-3 h-3 text-gray-400 shrink-0" />
              <span className="text-sm font-mono text-gray-600 dark:text-gray-300 truncate">{serverPort}</span>
            </div>
          )}

          {summary ? (
            <Tooltip placement="top" showArrow delay={100} content={
              <div className="flex flex-col gap-1 py-1">{summary.details.map((d) => (
                <div key={d.label} className="flex items-center justify-between gap-4 text-xs min-w-[180px]">
                  <span className="text-default-600">{d.label}</span>
                  <span className={d.delay > 0 ? (d.delay < 800 ? 'text-success' : 'text-warning') : 'text-danger'}>{d.delay > 0 ? `${d.delay}ms` : 'Fail'}</span>
                </div>
              ))}</div>
            }>
              <div className={`${serverPort ? 'col-span-2' : 'col-span-4'} p-3 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 flex items-center justify-between cursor-help`}>
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-3 h-3 text-gray-400" />
                  <span className="text-sm font-medium">Site Check</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {summary.details.map((d) => (
                      <div key={d.label} className={`w-3 h-3 rounded-full ${d.delay > 0 ? (d.delay < 800 ? 'bg-success' : 'bg-warning') : 'bg-danger'}`} />
                    ))}
                  </div>
                  <Chip size="sm" variant="flat" color={siteChipColor(summary)}>
                    {summary.failed > 0 ? `${summary.failed} fail` : `${summary.avg}ms`}
                  </Chip>
                </div>
              </div>
            </Tooltip>
          ) : !serverPort ? null : null}
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
