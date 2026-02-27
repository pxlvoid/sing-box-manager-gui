import { Card, CardBody, CardHeader, Button, Chip, Tooltip, Autocomplete, AutocompleteItem } from '@nextui-org/react';
import { Globe, RefreshCw, Search } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';

export default function ActiveProxyVariantC({
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
            <h2 className="text-lg font-semibold">Variant C — Compact</h2>
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
      <CardHeader className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Variant C — Compact</h2>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {/* Compact status line */}
        <div className="flex items-center gap-2 flex-wrap">
          {geo && (
            <Tooltip content={geo.country}>
              <span className="text-xl cursor-default">{geo.emoji}</span>
            </Tooltip>
          )}
          <span className="font-bold text-base">{activeDisplay}</span>
          <span className="text-xs text-gray-400">·</span>
          {activeServerPort && (
            <span className="text-xs text-gray-500 font-mono">{activeServerPort}</span>
          )}
          {activeSource && activeSource !== activeDisplay && (
            <>
              <span className="text-xs text-gray-400">·</span>
              <span className="text-xs text-gray-500 truncate max-w-[200px]" title={activeSource}>{activeSource}</span>
            </>
          )}
          {isAutoMode && resolvedActiveProxyTag && resolvedActiveProxyTag !== mainProxyGroup.now && (
            <>
              <span className="text-xs text-gray-400">·</span>
              <span className="text-xs text-gray-500">via {getProxyDisplayTag(mainProxyGroup.now)}</span>
            </>
          )}
        </div>

        {/* Metric chips as a button row */}
        <div className="flex items-center gap-2 flex-wrap">
          {activeDelay !== null && (
            <Chip size="md" variant="flat" color={delayChipColor(activeDelay)} className="font-medium">
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
              <Chip size="md" variant="flat" color={siteChipColor(activeSummary)} className="cursor-help font-medium">
                Sites {activeSummary.failed > 0 ? `Fail (${activeSummary.failed}/${activeSummary.count})` : `${activeSummary.avg}ms (${activeSummary.count})`}
              </Chip>
            </Tooltip>
          )}
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

        {/* Combined Autocomplete search + select */}
        <Autocomplete
          size="lg"
          defaultSelectedKey={mainProxyGroup.now}
          inputValue={proxySearch}
          onInputChange={setProxySearch}
          onSelectionChange={(key) => {
            if (key) {
              switchProxy(mainProxyGroup.name, key as string);
              setProxySearch('');
            }
          }}
          placeholder="Select or search proxy..."
          startContent={<Search className="w-4 h-4 text-gray-400" />}
          aria-label="Select or search proxy"
          className="w-full"
          classNames={{ base: 'w-full' }}
        >
          {filteredMainProxyOptions.map((item) => {
            const siteSummary = getSiteCheckSummary(item);
            const itemGeo = getGeoLabel(item);
            const itemDisplay = getProxyDisplayTag(item);
            const itemSource = getProxySourceTag(item);
            return (
              <AutocompleteItem key={item} textValue={`${itemDisplay} ${itemSource} ${item}`}>
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
              </AutocompleteItem>
            );
          })}
        </Autocomplete>
        {!hasSearchMatches && (
          <p className="text-sm text-gray-500">No proxies found for "{proxySearch.trim()}"</p>
        )}
      </CardBody>
    </Card>
  );
}
