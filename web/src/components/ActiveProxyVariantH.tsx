/**
 * Variant H — Network Flow
 * Visual connection pipeline: You → Proxy → Internet, with inline metrics.
 */
import { Card, CardBody, CardHeader, Button, Chip, Input, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search, Monitor, Server, ArrowRight } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';

export default function ActiveProxyVariantH({
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
        <CardHeader><div className="flex items-center gap-2"><Globe className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant H — Network Flow</h2></div></CardHeader>
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
          <h2 className="text-lg font-semibold">Variant H — Network Flow</h2>
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
        {/* Network flow visualization */}
        <div className="flex items-center gap-0 py-2 overflow-x-auto">
          {/* Client node */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-200 dark:border-blue-700 flex items-center justify-center">
              <Monitor className="w-5 h-5 text-blue-500" />
            </div>
            <span className="text-[10px] text-gray-500 font-medium">Client</span>
          </div>

          {/* Arrow with delay */}
          <div className="flex flex-col items-center mx-1 shrink-0">
            <div className="flex items-center gap-1">
              <div className="w-8 h-0.5 bg-gray-300 dark:bg-gray-600" />
              <ArrowRight className="w-3 h-3 text-gray-400" />
            </div>
            {delay !== null && (
              <span className={`text-[10px] font-mono font-bold mt-0.5 ${delay <= 0 ? 'text-danger' : delay < 300 ? 'text-success' : delay < 800 ? 'text-warning' : 'text-danger'}`}>
                {formatDelayLabel(delay)}
              </span>
            )}
          </div>

          {/* Proxy node */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <Tooltip content={`${display}${serverPort ? ` (${serverPort})` : ''}`}>
              <div className="w-14 h-14 rounded-xl bg-primary-50 dark:bg-primary-900/30 border-2 border-primary-300 dark:border-primary-700 flex items-center justify-center cursor-default relative">
                {geo ? (
                  <span className="text-2xl">{geo.emoji}</span>
                ) : (
                  <Server className="w-6 h-6 text-primary-500" />
                )}
                <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 ${delay !== null && delay > 0 ? 'bg-success' : delay === 0 ? 'bg-danger' : 'bg-gray-400'}`} />
              </div>
            </Tooltip>
            <span className="text-[10px] text-gray-500 font-medium max-w-[80px] truncate text-center">{display}</span>
          </div>

          {/* Arrow with site check */}
          <div className="flex flex-col items-center mx-1 shrink-0">
            <div className="flex items-center gap-1">
              <div className="w-8 h-0.5 bg-gray-300 dark:bg-gray-600" />
              <ArrowRight className="w-3 h-3 text-gray-400" />
            </div>
            {summary && (
              <span className={`text-[10px] font-mono font-bold mt-0.5 ${summary.failed > 0 ? 'text-danger' : 'text-success'}`}>
                {summary.failed > 0 ? `${summary.failed} fail` : `${summary.avg}ms`}
              </span>
            )}
          </div>

          {/* Internet node */}
          <Tooltip
            isDisabled={!summary}
            placement="top"
            showArrow
            delay={100}
            content={summary ? (
              <div className="flex flex-col gap-1 py-1">{summary.details.map((d) => (
                <div key={d.label} className="flex items-center justify-between gap-4 text-xs min-w-[180px]">
                  <span className="text-default-600">{d.label}</span>
                  <span className={d.delay > 0 ? (d.delay < 800 ? 'text-success' : 'text-warning') : 'text-danger'}>{d.delay > 0 ? `${d.delay}ms` : 'Fail'}</span>
                </div>
              ))}</div>
            ) : null}
          >
            <div className="flex flex-col items-center gap-1 shrink-0 cursor-help">
              <div className="w-12 h-12 rounded-xl bg-green-50 dark:bg-green-900/30 border-2 border-green-200 dark:border-green-700 flex items-center justify-center">
                <Globe className="w-5 h-5 text-green-500" />
              </div>
              <span className="text-[10px] text-gray-500 font-medium">Internet</span>
            </div>
          </Tooltip>
        </div>

        {/* Info line */}
        <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 px-1">
          {source && source !== display && <span className="truncate max-w-[200px]">{source}</span>}
          {serverPort && <span className="font-mono">{serverPort}</span>}
          {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
            <span>via {getProxyDisplayTag(mainProxyGroup.now)}</span>
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
