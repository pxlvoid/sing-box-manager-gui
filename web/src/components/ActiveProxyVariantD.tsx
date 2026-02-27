import { Card, CardBody, CardHeader, Button, Chip, Input, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search, Zap, BarChart3, MapPin } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';

export default function ActiveProxyVariantD({
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
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Variant D — Dashboard Widget</h2>
          </div>
        </CardHeader>
        <CardBody>
          <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl text-center">
            <p className="text-gray-500">sing-box is not running</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  const activeProxyTag = resolvedActiveProxyTag || mainProxyGroup.now;
  const activeDisplay = getProxyDisplayTag(activeProxyTag);
  const activeSource = getProxySourceTag(activeProxyTag);
  const activeServerPort = getServerPortLabel(activeProxyTag);
  const activeDelay = getLatestMeasuredDelay(activeProxyTag);
  const activeSummary = getSiteCheckSummary(activeProxyTag);
  const geo = getGeoLabel(activeProxyTag);

  const delayColor = activeDelay !== null && activeDelay > 0
    ? (activeDelay < 300 ? 'text-success' : activeDelay < 800 ? 'text-warning' : 'text-danger')
    : activeDelay === 0 ? 'text-danger' : 'text-gray-400';

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Variant D — Dashboard Widget</h2>
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
        {/* Metric widgets row */}
        <div className="grid grid-cols-3 gap-3">
          {/* Geo widget */}
          <div className="flex flex-col items-center justify-center p-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <MapPin className="w-4 h-4 text-gray-400 mb-1" />
            {geo ? (
              <>
                <span className="text-2xl leading-none mb-1">{geo.emoji}</span>
                <span className="text-xs text-gray-500 text-center">{geo.country}</span>
              </>
            ) : (
              <>
                <span className="text-2xl leading-none mb-1">-</span>
                <span className="text-xs text-gray-500">Unknown</span>
              </>
            )}
          </div>

          {/* TCP Delay widget */}
          <div className="flex flex-col items-center justify-center p-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <Zap className="w-4 h-4 text-gray-400 mb-1" />
            <span className={`text-xl font-bold leading-none mb-1 ${delayColor}`}>
              {activeDelay !== null ? (activeDelay > 0 ? activeDelay : 'Fail') : '-'}
            </span>
            <span className="text-xs text-gray-500">TCP Latency{activeDelay !== null && activeDelay > 0 ? ' ms' : ''}</span>
          </div>

          {/* Site Check widget */}
          <Tooltip
            isDisabled={!activeSummary}
            placement="top"
            showArrow
            delay={100}
            content={
              activeSummary ? (
                <div className="flex flex-col gap-1 py-1">
                  {activeSummary.details.map((d) => (
                    <div key={d.label} className="flex items-center justify-between gap-4 text-xs min-w-[180px]">
                      <span className="text-default-600">{d.label}</span>
                      <span className={d.delay > 0 ? (d.delay < 800 ? 'text-success' : 'text-warning') : 'text-danger'}>
                        {d.delay > 0 ? `${d.delay}ms` : 'Fail'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null
            }
          >
            <div className="flex flex-col items-center justify-center p-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 cursor-help">
              <BarChart3 className="w-4 h-4 text-gray-400 mb-1" />
              {activeSummary ? (
                <>
                  <span className={`text-xl font-bold leading-none mb-1 ${activeSummary.failed > 0 ? 'text-danger' : activeSummary.avg >= 800 ? 'text-warning' : 'text-success'}`}>
                    {activeSummary.failed > 0 ? 'Fail' : activeSummary.avg}
                  </span>
                  <span className="text-xs text-gray-500">
                    {activeSummary.failed > 0 ? `${activeSummary.failed}/${activeSummary.count} failed` : `avg ms (${activeSummary.count})`}
                  </span>
                  {/* Dots indicator */}
                  <div className="flex gap-1 mt-1">
                    {activeSummary.details.map((d) => (
                      <div
                        key={d.label}
                        className={`w-2 h-2 rounded-full ${d.delay > 0 ? (d.delay < 800 ? 'bg-success' : 'bg-warning') : 'bg-danger'}`}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <span className="text-xl font-bold leading-none mb-1 text-gray-400">-</span>
                  <span className="text-xs text-gray-500">Site Check</span>
                </>
              )}
            </div>
          </Tooltip>
        </div>

        {/* Proxy name info */}
        <div className="px-1">
          <p className="font-bold text-base">{activeDisplay}</p>
          <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
            {activeSource && activeSource !== activeDisplay && (
              <span className="truncate max-w-[280px]" title={activeSource}>{activeSource}</span>
            )}
            {activeServerPort && (
              <span className="font-mono">{activeServerPort}</span>
            )}
            {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
              <span>via {getProxyDisplayTag(mainProxyGroup.now)}</span>
            )}
          </div>
        </div>

        {/* Search + Select */}
        <div className="space-y-3">
          <Input
            size="sm"
            value={proxySearch}
            onChange={(e) => setProxySearch(e.target.value)}
            placeholder="Search proxy by name"
            startContent={<Search className="w-4 h-4 text-gray-400" />}
            aria-label="Search proxy by name"
          />
          <Select
            size="lg"
            selectedKeys={[mainProxyGroup.now]}
            onChange={(e) => {
              if (e.target.value) {
                switchProxy(mainProxyGroup.name, e.target.value);
                setProxySearch('');
              }
            }}
            className="w-full"
            aria-label="Select main proxy"
            classNames={{ trigger: 'min-h-14', value: 'text-base' }}
          >
            {filteredMainProxyOptions.map((item) => {
              const siteSummary = getSiteCheckSummary(item);
              const itemGeo = getGeoLabel(item);
              const itemDisplay = getProxyDisplayTag(item);
              const itemSource = getProxySourceTag(item);
              return (
                <SelectItem key={item} textValue={`${itemDisplay} ${itemSource} ${item}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {itemGeo && <span className="text-lg shrink-0">{itemGeo.emoji}</span>}
                      <div className="min-w-0">
                        <p className="text-sm truncate">{itemDisplay}</p>
                        {itemSource && itemSource !== itemDisplay && (
                          <p className="text-xs text-gray-500 truncate">{itemSource}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {getLatestMeasuredDelay(item) !== null && (
                        <Chip size="sm" variant="flat" color={delayChipColor(getLatestMeasuredDelay(item))}>
                          {formatDelayLabel(getLatestMeasuredDelay(item))}
                        </Chip>
                      )}
                      {siteSummary && (
                        <Chip size="sm" variant="flat" color={siteChipColor(siteSummary)}>
                          {siteSummary.failed > 0 ? `Fail (${siteSummary.failed}/${siteSummary.count})` : `${siteSummary.avg}ms (${siteSummary.count})`}
                        </Chip>
                      )}
                    </div>
                  </div>
                </SelectItem>
              );
            })}
          </Select>
          {!hasSearchMatches && (
            <p className="text-sm text-gray-500">No proxies found for "{proxySearch.trim()}"</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
