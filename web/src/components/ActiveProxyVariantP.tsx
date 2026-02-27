/**
 * Variant P — "Two-Row Compact"
 * Row 1: Flag + Name + metrics chips + Pipeline button (all inline)
 * Row 2: Search-integrated Select (one combined control)
 * No Card header — uses the card body only, like Service Controls.
 */
import { Card, CardBody, Button, Chip, Input, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';

export default function ActiveProxyVariantP({
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
        <CardBody className="flex flex-row items-center gap-3 p-4">
          <Globe className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Variant P — Active Proxy</span>
          <span className="text-sm text-gray-500">sing-box is not running</span>
        </CardBody>
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
      <CardBody className="flex flex-col gap-3 p-4 sm:p-5">
        {/* Row 1: All info + actions in one line */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 shrink-0">
            <Globe className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Variant P</span>
          </div>

          <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 hidden sm:block" />

          <div className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
            {geo && (
              <Tooltip content={geo.country}>
                <span className="text-base cursor-default shrink-0">{geo.emoji}</span>
              </Tooltip>
            )}
            <span className="font-medium text-sm truncate max-w-[200px]">{display}</span>
            {source && source !== display && (
              <span className="text-xs text-gray-400 truncate max-w-[150px] hidden md:inline">{source}</span>
            )}
            {serverPort && (
              <span className="text-xs text-gray-400 font-mono hidden sm:inline">{serverPort}</span>
            )}
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
            {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
              <span className="text-xs text-gray-400">via {getProxyDisplayTag(mainProxyGroup.now)}</span>
            )}
          </div>

          <Button
            size="sm"
            color="primary"
            variant="flat"
            className="shrink-0"
            startContent={!activeProxyRefreshing ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
            isLoading={activeProxyRefreshing}
            isDisabled={!resolvedActiveProxyTag || verificationRunning}
            onPress={handleRefreshActiveProxy}
          >
            Pipeline
          </Button>
        </div>

        {/* Row 2: Search + Select */}
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
                      {src && src !== d && <span className="text-xs text-gray-400 truncate hidden sm:inline">{src}</span>}
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
    </Card>
  );
}
