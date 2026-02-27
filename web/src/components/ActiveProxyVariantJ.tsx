/**
 * Variant J — Spotlight / Command Palette
 * Large prominent search-first design, like macOS Spotlight or VS Code palette.
 */
import { Card, CardBody, CardHeader, Button, Chip, Input, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search, ChevronRight } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';

export default function ActiveProxyVariantJ({
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
        <CardHeader><div className="flex items-center gap-2"><Globe className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant J — Spotlight</h2></div></CardHeader>
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
      <CardHeader><div className="flex items-center gap-2"><Globe className="w-5 h-5" /><h2 className="text-lg font-semibold">Variant J — Spotlight</h2></div></CardHeader>
      <CardBody className="space-y-3">
        {/* Prominent search bar */}
        <div className="relative">
          <Input
            size="lg"
            value={proxySearch}
            onChange={(e) => setProxySearch(e.target.value)}
            placeholder="Search & switch proxy..."
            startContent={<Search className="w-5 h-5 text-gray-400" />}
            aria-label="Search proxy"
            classNames={{
              input: 'text-lg',
              inputWrapper: 'shadow-md border-2 border-gray-200 dark:border-gray-600 h-14',
            }}
          />
        </div>

        {/* Current proxy as highlighted "result" */}
        <div className="flex items-center gap-3 p-4 bg-primary-50 dark:bg-primary-900/20 rounded-xl border border-primary-200 dark:border-primary-700/40">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {geo && (
              <Tooltip content={geo.country}>
                <span className="text-2xl cursor-default shrink-0">{geo.emoji}</span>
              </Tooltip>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <ChevronRight className="w-4 h-4 text-primary-500 shrink-0" />
                <span className="font-bold text-base truncate">{display}</span>
                <Chip size="sm" variant="flat" color="primary" className="shrink-0">active</Chip>
              </div>
              <div className="flex items-center gap-2 mt-1 pl-6 flex-wrap">
                {source && source !== display && <span className="text-xs text-gray-500 truncate max-w-[200px]">{source}</span>}
                {serverPort && <span className="text-xs text-gray-500 font-mono">{serverPort}</span>}
                {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
                  <span className="text-xs text-gray-500">via {getProxyDisplayTag(mainProxyGroup.now)}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {delay !== null && (
              <Chip size="sm" variant="flat" color={delayChipColor(delay)}>{formatDelayLabel(delay)}</Chip>
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
                <Chip size="sm" variant="flat" color={siteChipColor(summary)} className="cursor-help">
                  {summary.failed > 0 ? `${summary.failed}F` : `${summary.avg}ms`}
                </Chip>
              </Tooltip>
            )}
            <Button
              size="sm"
              color="primary"
              variant="shadow"
              isIconOnly
              isLoading={activeProxyRefreshing}
              isDisabled={!resolvedActiveProxyTag || verificationRunning}
              onPress={handleRefreshActiveProxy}
            >
              {!activeProxyRefreshing && <RefreshCw className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Select dropdown */}
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
