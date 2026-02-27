/**
 * Variant O — "Inline Row"
 * Matches the compact style of System Resources rows (sing-box, Probe).
 * Active proxy info is ONE dense row, select is below as a slim picker.
 * Minimal vertical space, max information density.
 */
import { Card, CardBody, Button, Chip, Input, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';
import { siteErrorLabel } from '../features/nodes/types';

export default function ActiveProxyBlock({
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
        <CardBody className="p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Globe className="w-4 h-4" />
            <span className="font-medium">Active Proxy</span>
            <span className="text-gray-400">·</span>
            <span>sing-box is not running</span>
          </div>
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
      <CardBody className="p-4 space-y-3">
        {/* Row 1: Status — single dense line like System Resources rows */}
        <div className="flex items-center gap-3 text-xs px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center gap-2 shrink-0">
            <div className={`w-2 h-2 rounded-full ${delay !== null && delay > 0 ? 'bg-green-500' : delay === 0 ? 'bg-red-500' : 'bg-gray-400'}`} />
            <Globe className="w-3.5 h-3.5 text-gray-400" />
            <span className="font-semibold text-sm text-gray-700 dark:text-gray-200">Active Proxy</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap text-gray-500 dark:text-gray-400 min-w-0 flex-1">
            {geo && (
              <Tooltip content={geo.country}>
                <span className="cursor-default">{geo.emoji}</span>
              </Tooltip>
            )}
            <span className="font-semibold text-gray-700 dark:text-gray-200 truncate max-w-[180px]">{display}</span>
            {source && source !== display && (
              <span className="truncate max-w-[160px] hidden sm:inline" title={source}>{source}</span>
            )}
            {serverPort && (
              <span className="font-mono text-gray-400 dark:text-gray-500">{serverPort}</span>
            )}
            {delay !== null && (
              <span>TCP <span className={`font-semibold ${delay <= 0 ? 'text-danger' : delay < 300 ? 'text-success' : delay < 800 ? 'text-warning' : 'text-danger'}`}>{formatDelayLabel(delay)}</span></span>
            )}
            {summary && (
              <Tooltip placement="top" showArrow delay={100} content={
                <div className="flex flex-col gap-1 py-1">{summary.details.map((d, index) => {
                  const reason = siteErrorLabel(d.errorType);
                  return (
                    <div key={`${d.label}-${index}`} className="flex items-center justify-between gap-4 text-xs min-w-[180px]">
                      <span className="text-default-600">{d.label}</span>
                      <span className={d.delay > 0 ? (d.delay < 800 ? 'text-success' : 'text-warning') : 'text-danger'}>
                        {d.delay > 0 ? `${d.delay}ms` : (reason ? `Fail (${reason})` : 'Fail')}
                      </span>
                    </div>
                  );
                })}</div>
              }>
                <span className="cursor-help">
                  Sites <span className={`font-semibold ${summary.failed > 0 ? 'text-danger' : 'text-success'}`}>
                    {summary.failed > 0 ? `${summary.failed}/${summary.count} fail` : `${summary.avg}ms (${summary.count})`}
                  </span>
                </span>
              </Tooltip>
            )}
            {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
              <span className="text-gray-400 dark:text-gray-500">via {getProxyDisplayTag(mainProxyGroup.now)}</span>
            )}
          </div>
          <Button
            size="sm"
            color="primary"
            variant="flat"
            className="shrink-0 h-7 min-w-0 px-2.5"
            startContent={!activeProxyRefreshing ? <RefreshCw className="w-3 h-3" /> : undefined}
            isLoading={activeProxyRefreshing}
            isDisabled={!resolvedActiveProxyTag || verificationRunning}
            onPress={handleRefreshActiveProxy}
          >
            <span className="hidden sm:inline">Pipeline</span>
          </Button>
        </div>

        {/* Row 2: Search + Select side by side */}
        <div className="flex gap-2">
          <Input
            size="sm"
            value={proxySearch}
            onChange={(e) => setProxySearch(e.target.value)}
            placeholder="Search..."
            startContent={<Search className="w-3.5 h-3.5 text-gray-400" />}
            aria-label="Search proxy"
            className="max-w-[200px]"
            classNames={{ inputWrapper: 'h-9' }}
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
            classNames={{ trigger: 'h-9' }}
          >
            {filteredMainProxyOptions.map((item) => {
              const s = getSiteCheckSummary(item);
              const g = getGeoLabel(item);
              const d = getProxyDisplayTag(item);
              const src = getProxySourceTag(item);
              return (
                <SelectItem key={item} textValue={`${d} ${src} ${item}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {g && <span className="text-base shrink-0">{g.emoji}</span>}
                      <div className="min-w-0">
                        <p className="text-sm truncate">{d}</p>
                        {src && src !== d && <p className="text-xs text-gray-500 truncate">{src}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {getLatestMeasuredDelay(item) !== null && (
                        <Chip size="sm" variant="flat" color={delayChipColor(getLatestMeasuredDelay(item))}>{formatDelayLabel(getLatestMeasuredDelay(item))}</Chip>
                      )}
                      {s && (
                        <Chip size="sm" variant="flat" color={siteChipColor(s)}>
                          {s.failed > 0 ? `Fail (${s.failed}/${s.count})` : `${s.avg}ms (${s.count})`}
                        </Chip>
                      )}
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
