import { Card, CardBody, CardHeader, Button, Chip, Input, Tooltip, Select, SelectItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';

export default function ActiveProxyVariantA({
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
            <h2 className="text-lg font-semibold">Variant A — Hero Card</h2>
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Variant A — Hero Card</h2>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* Hero block */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-900/30 dark:to-primary-800/20 border border-primary-200 dark:border-primary-700/40 p-5">
          {/* Geo + Name */}
          <div className="flex items-start gap-3 mb-3">
            {geo && (
              <Tooltip content={geo.country}>
                <span className="text-3xl cursor-default leading-none">{geo.emoji}</span>
              </Tooltip>
            )}
            <div className="min-w-0 flex-1">
              {geo && <p className="text-xs text-primary-600 dark:text-primary-400 font-medium mb-0.5">{geo.country}</p>}
              <p className="text-xl font-bold truncate">{activeDisplay}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {activeSource && activeSource !== activeDisplay && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[280px]">{activeSource}</span>
                )}
                {activeServerPort && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">{activeServerPort}</span>
                )}
              </div>
            </div>
          </div>

          {/* Metrics row */}
          <div className="flex items-center gap-2 flex-wrap">
            {activeDelay !== null && (
              <Chip size="sm" variant="flat" color={delayChipColor(activeDelay)}>
                TCP {formatDelayLabel(activeDelay)}
              </Chip>
            )}
            {activeSummary && (
              <Tooltip
                placement="top-start"
                showArrow
                delay={100}
                content={
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
                }
              >
                <Chip size="sm" variant="flat" color={siteChipColor(activeSummary)} className="cursor-help">
                  Sites {activeSummary.failed > 0 ? `Fail (${activeSummary.failed}/${activeSummary.count})` : `${activeSummary.avg}ms (${activeSummary.count})`}
                </Chip>
              </Tooltip>
            )}
            <div className="flex-1" />
            <Button
              size="sm"
              color="primary"
              variant="shadow"
              startContent={!activeProxyRefreshing ? <RefreshCw className="w-4 h-4" /> : undefined}
              isLoading={activeProxyRefreshing}
              isDisabled={!resolvedActiveProxyTag || verificationRunning}
              onPress={handleRefreshActiveProxy}
            >
              Run Pipeline
            </Button>
          </div>

          {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
            <p className="text-xs text-primary-500 dark:text-primary-400 mt-2">via {getProxyDisplayTag(mainProxyGroup.now)}</p>
          )}
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
