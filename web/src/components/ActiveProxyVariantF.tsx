/**
 * Variant F — Terminal / CLI Style
 * Monospace font, dark terminal aesthetic, typed-out feel.
 */
import { Card, CardBody, CardHeader, Button, Chip, Input, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search, Terminal } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';

export default function ActiveProxyVariantF({
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
        <CardHeader><div className="flex items-center gap-2"><Terminal className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant F — Terminal</h2></div></CardHeader>
        <CardBody><div className="p-4 bg-gray-900 rounded-xl text-center"><p className="text-gray-500 font-mono">sing-box is not running</p></div></CardBody>
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

  const delayStatus = delay === null ? 'gray' : delay <= 0 ? 'red' : delay < 300 ? 'green' : delay < 800 ? 'yellow' : 'red';
  const colorMap: Record<string, string> = { green: 'text-green-400', yellow: 'text-yellow-400', red: 'text-red-400', gray: 'text-gray-500' };

  return (
    <Card>
      <CardHeader><div className="flex items-center gap-2"><Terminal className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant F — Terminal</h2></div></CardHeader>
      <CardBody className="p-0">
        <div className="bg-gray-950 rounded-xl mx-3 mb-3 overflow-hidden border border-gray-800">
          {/* Title bar */}
          <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
              </div>
              <span className="text-xs text-gray-500 font-mono ml-2">proxy-status</span>
            </div>
            <Button
              size="sm"
              color="success"
              variant="flat"
              className="font-mono text-xs h-6"
              startContent={!activeProxyRefreshing ? <RefreshCw className="w-3 h-3" /> : undefined}
              isLoading={activeProxyRefreshing}
              isDisabled={!resolvedActiveProxyTag || verificationRunning}
              onPress={handleRefreshActiveProxy}
            >
              run-pipeline
            </Button>
          </div>

          {/* Terminal content */}
          <div className="p-4 font-mono text-sm space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-green-400 shrink-0">$</span>
              <span className="text-gray-300">proxy --status</span>
            </div>

            <div className="pl-4 space-y-1 text-xs">
              <div className="flex gap-2">
                <span className="text-gray-500 w-16 shrink-0">NODE</span>
                <span className="text-blue-400">{display}</span>
                {geo && <span className="text-gray-500">({geo.emoji} {geo.country})</span>}
              </div>
              {source && source !== display && (
                <div className="flex gap-2">
                  <span className="text-gray-500 w-16 shrink-0">SOURCE</span>
                  <span className="text-gray-400">{source}</span>
                </div>
              )}
              {serverPort && (
                <div className="flex gap-2">
                  <span className="text-gray-500 w-16 shrink-0">ADDR</span>
                  <span className="text-cyan-400">{serverPort}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-gray-500 w-16 shrink-0">TCP</span>
                <span className={colorMap[delayStatus]}>{formatDelayLabel(delay)}</span>
              </div>
              {summary && (
                <Tooltip placement="top-start" showArrow delay={100} content={
                  <div className="flex flex-col gap-1 py-1">{summary.details.map((d) => (
                    <div key={d.label} className="flex items-center justify-between gap-4 text-xs min-w-[180px]">
                      <span className="text-default-600">{d.label}</span>
                      <span className={d.delay > 0 ? (d.delay < 800 ? 'text-success' : 'text-warning') : 'text-danger'}>{d.delay > 0 ? `${d.delay}ms` : 'Fail'}</span>
                    </div>
                  ))}</div>
                }>
                  <div className="flex gap-2 cursor-help">
                    <span className="text-gray-500 w-16 shrink-0">SITES</span>
                    <span className={summary.failed > 0 ? 'text-red-400' : 'text-green-400'}>
                      {summary.failed > 0 ? `FAIL ${summary.failed}/${summary.count}` : `OK avg=${summary.avg}ms (${summary.count})`}
                    </span>
                  </div>
                </Tooltip>
              )}
              {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
                <div className="flex gap-2">
                  <span className="text-gray-500 w-16 shrink-0">VIA</span>
                  <span className="text-yellow-400">{getProxyDisplayTag(mainProxyGroup.now)}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <span className="text-green-400">$</span>
              <span className="text-gray-600 animate-pulse">_</span>
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
