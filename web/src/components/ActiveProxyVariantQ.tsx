/**
 * Variant Q — "Integrated Header"
 * Active proxy info baked into CardHeader alongside controls.
 * Card header = status + switch; Card body = only select dropdown (hidden until needed).
 * Most compact possible while keeping all data accessible.
 */
import { useState } from 'react';
import { Card, CardBody, CardHeader, Button, Chip, Input, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search, ChevronDown, ChevronUp } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';

export default function ActiveProxyVariantQ({
  mainProxyGroup, resolvedActiveProxyTag, isAutoMode,
  activeProxyRefreshing, verificationRunning,
  proxySearch, setProxySearch, filteredMainProxyOptions, hasSearchMatches,
  switchProxy, handleRefreshActiveProxy,
  getProxyDisplayTag, getProxySourceTag, getServerPortLabel,
  getLatestMeasuredDelay, getSiteCheckSummary, getGeoLabel,
  delayChipColor, siteChipColor, formatDelayLabel,
}: ActiveProxyProps) {
  const [expanded, setExpanded] = useState(false);

  if (!mainProxyGroup) {
    return (
      <Card>
        <CardBody className="flex flex-row items-center gap-3 p-4">
          <Globe className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-semibold">Variant Q — Active Proxy</span>
          <span className="text-sm text-gray-500">sing-box is not running</span>
        </CardBody>
      </Card>
    );
  }

  const tag = resolvedActiveProxyTag || mainProxyGroup.now;
  const display = getProxyDisplayTag(tag);
  const serverPort = getServerPortLabel(tag);
  const delay = getLatestMeasuredDelay(tag);
  const summary = getSiteCheckSummary(tag);
  const geo = getGeoLabel(tag);

  return (
    <Card>
      {/* Header IS the status display */}
      <CardHeader
        className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors px-4 py-3"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status dot */}
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${delay !== null && delay > 0 ? 'bg-green-500' : delay === 0 ? 'bg-red-500' : 'bg-gray-400'}`} />

        {/* Geo */}
        {geo && (
          <Tooltip content={geo.country}>
            <span className="text-lg cursor-default shrink-0">{geo.emoji}</span>
          </Tooltip>
        )}

        {/* Name + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">Variant Q</span>
            <span className="text-xs text-gray-400">·</span>
            <span className="font-medium text-sm truncate">{display}</span>
            {serverPort && <span className="text-xs text-gray-400 font-mono hidden sm:inline">{serverPort}</span>}
            {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
              <span className="text-xs text-gray-400">via {getProxyDisplayTag(mainProxyGroup.now)}</span>
            )}
          </div>
        </div>

        {/* Metrics */}
        <div className="flex items-center gap-1.5 shrink-0">
          {delay !== null && (
            <Chip size="sm" variant="flat" color={delayChipColor(delay)}>{formatDelayLabel(delay)}</Chip>
          )}
          {summary && (
            <Tooltip placement="top" showArrow delay={100} content={
              <div className="flex flex-col gap-1 py-1">{summary.details.map((d) => (
                <div key={d.label} className="flex items-center justify-between gap-4 text-xs min-w-[180px]">
                  <span className="text-default-600">{d.label}</span>
                  <span className={d.delay > 0 ? (d.delay < 800 ? 'text-success' : 'text-warning') : 'text-danger'}>{d.delay > 0 ? `${d.delay}ms` : 'Fail'}</span>
                </div>
              ))}</div>
            }>
              <Chip size="sm" variant="flat" color={siteChipColor(summary)} className="cursor-help">
                {summary.failed > 0 ? `${summary.failed}F/${summary.count}` : `${summary.avg}ms·${summary.count}`}
              </Chip>
            </Tooltip>
          )}
          <Button
            size="sm"
            color="primary"
            variant="flat"
            className="h-7 min-w-0 px-2"
            startContent={!activeProxyRefreshing ? <RefreshCw className="w-3 h-3" /> : undefined}
            isLoading={activeProxyRefreshing}
            isDisabled={!resolvedActiveProxyTag || verificationRunning}
            onPress={() => { handleRefreshActiveProxy(); }}
          >
            <span className="hidden sm:inline text-xs">Pipeline</span>
          </Button>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </CardHeader>

      {/* Expandable body with selector */}
      {expanded && (
        <CardBody className="pt-0 pb-4 px-4 space-y-2">
          <div className="flex gap-2 items-center">
            <Input
              size="sm"
              value={proxySearch}
              onChange={(e) => setProxySearch(e.target.value)}
              placeholder="Filter..."
              startContent={<Search className="w-3.5 h-3.5 text-gray-400" />}
              aria-label="Filter proxy"
              className="w-[160px] shrink-0"
            />
            <Select
              size="sm"
              selectedKeys={[mainProxyGroup.now]}
              onChange={(e) => {
                if (e.target.value) {
                  switchProxy(mainProxyGroup.name, e.target.value);
                  setProxySearch('');
                }
              }}
              className="flex-1"
              aria-label="Select proxy"
            >
              {filteredMainProxyOptions.map((item) => {
                const s = getSiteCheckSummary(item);
                const g = getGeoLabel(item);
                const d = getProxyDisplayTag(item);
                const src = getProxySourceTag(item);
                return (
                  <SelectItem key={item} textValue={`${d} ${src} ${item}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {g && <span className="text-sm shrink-0">{g.emoji}</span>}
                        <span className="text-sm truncate">{d}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {getLatestMeasuredDelay(item) !== null && (
                          <Chip size="sm" variant="flat" color={delayChipColor(getLatestMeasuredDelay(item))}>{formatDelayLabel(getLatestMeasuredDelay(item))}</Chip>
                        )}
                        {s && <Chip size="sm" variant="flat" color={siteChipColor(s)}>{s.failed > 0 ? `${s.failed}F` : `${s.avg}ms`}</Chip>}
                      </div>
                    </div>
                  </SelectItem>
                );
              })}
            </Select>
          </div>
          {!hasSearchMatches && <p className="text-xs text-gray-500">No proxies found for "{proxySearch.trim()}"</p>}
        </CardBody>
      )}
    </Card>
  );
}
