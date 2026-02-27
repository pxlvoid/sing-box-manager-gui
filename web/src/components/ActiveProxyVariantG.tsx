/**
 * Variant G — Status Board (Airport Board Style)
 * Clean rows with clear labels, status dots, structured data grid.
 */
import { Card, CardBody, CardHeader, Button, Chip, Input, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';

export default function ActiveProxyVariantG({
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
        <CardHeader><div className="flex items-center gap-2"><Globe className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant G — Status Board</h2></div></CardHeader>
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

  const StatusIcon = delay === null ? MinusCircle : delay <= 0 ? XCircle : CheckCircle2;
  const statusColor = delay === null ? 'text-gray-400' : delay <= 0 ? 'text-danger' : 'text-success';
  const statusText = delay === null ? 'Unknown' : delay <= 0 ? 'Failed' : 'Operational';

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Variant G — Status Board</h2>
        </div>
        <div className="flex items-center gap-2">
          <StatusIcon className={`w-5 h-5 ${statusColor}`} />
          <span className={`text-sm font-medium ${statusColor}`}>{statusText}</span>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* Status board table */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Header row */}
          <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {geo && (
                <Tooltip content={geo.country}>
                  <span className="text-2xl cursor-default">{geo.emoji}</span>
                </Tooltip>
              )}
              <div>
                <p className="font-bold text-base">{display}</p>
                {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
                  <p className="text-xs text-gray-500">via {getProxyDisplayTag(mainProxyGroup.now)}</p>
                )}
              </div>
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

          {/* Data rows */}
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {source && source !== display && (
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs text-gray-500 uppercase tracking-wider font-medium w-24">Source</span>
                <span className="text-sm text-right truncate max-w-[300px]">{source}</span>
              </div>
            )}
            {serverPort && (
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs text-gray-500 uppercase tracking-wider font-medium w-24">Server</span>
                <span className="text-sm font-mono">{serverPort}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-xs text-gray-500 uppercase tracking-wider font-medium w-24">TCP Latency</span>
              <Chip size="sm" variant="flat" color={delayChipColor(delay)}>{formatDelayLabel(delay)}</Chip>
            </div>
            {summary && (
              <Tooltip placement="left" showArrow delay={100} content={
                <div className="flex flex-col gap-1 py-1">{summary.details.map((d) => (
                  <div key={d.label} className="flex items-center justify-between gap-4 text-xs min-w-[180px]">
                    <span className="text-default-600">{d.label}</span>
                    <span className={d.delay > 0 ? (d.delay < 800 ? 'text-success' : 'text-warning') : 'text-danger'}>{d.delay > 0 ? `${d.delay}ms` : 'Fail'}</span>
                  </div>
                ))}</div>
              }>
                <div className="flex items-center justify-between px-4 py-2.5 cursor-help">
                  <span className="text-xs text-gray-500 uppercase tracking-wider font-medium w-24">Site Check</span>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      {summary.details.map((d) => (
                        <div key={d.label} className={`w-2.5 h-2.5 rounded-sm ${d.delay > 0 ? (d.delay < 800 ? 'bg-success' : 'bg-warning') : 'bg-danger'}`} />
                      ))}
                    </div>
                    <Chip size="sm" variant="flat" color={siteChipColor(summary)}>
                      {summary.failed > 0 ? `${summary.failed} fail` : `${summary.avg}ms avg`}
                    </Chip>
                  </div>
                </div>
              </Tooltip>
            )}
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
