import { useState, useRef, useEffect, useMemo } from 'react';
import { Card, CardBody, Button, Chip, Tooltip, Popover, PopoverTrigger, PopoverContent, ScrollShadow, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Checkbox, CheckboxGroup } from '@nextui-org/react';
import { Globe, RefreshCw, Search, ChevronDown, Check, X, ArrowUp, ArrowDown, ShieldBan } from 'lucide-react';
import type { ActiveProxyProps } from './ActiveProxyTypes';
import { siteErrorLabel, countryOptions } from '../features/nodes/types';

type SortField = 'delay' | 'site';
type SortDir = 'asc' | 'desc';
type SortState = { field: SortField; dir: SortDir } | null;

export default function ActiveProxyBlock({
  mainProxyGroup, resolvedActiveProxyTag, isAutoMode,
  activeProxyRefreshing, verificationRunning,
  proxySearch, setProxySearch, filteredMainProxyOptions, hasSearchMatches,
  switchProxy, handleRefreshActiveProxy,
  getProxyDisplayTag, getProxySourceTag, getServerPortLabel,
  getLatestMeasuredDelay, getSiteCheckSummary, getGeoLabel,
  delayChipColor, siteChipColor, formatDelayLabel,
  settings, updateSettings,
}: ActiveProxyProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [sort, setSort] = useState<SortState>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [blockedDraft, setBlockedDraft] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    } else {
      setProxySearch('');
    }
  }, [isOpen, setProxySearch]);

  const toggleSort = (field: SortField) => {
    setSort((prev) => {
      if (!prev || prev.field !== field) return { field, dir: 'asc' };
      if (prev.dir === 'asc') return { field, dir: 'desc' };
      return null; // third click resets
    });
  };

  const sortedOptions = useMemo(() => {
    if (!sort) return filteredMainProxyOptions;
    const list = [...filteredMainProxyOptions];
    list.sort((a, b) => {
      if (sort.field === 'delay') {
        const da = getLatestMeasuredDelay(a);
        const db = getLatestMeasuredDelay(b);
        const va = da !== null && da > 0 ? da : Infinity;
        const vb = db !== null && db > 0 ? db : Infinity;
        return sort.dir === 'asc' ? va - vb : vb - va;
      }
      const sa = getSiteCheckSummary(a);
      const sb = getSiteCheckSummary(b);
      const va = sa ? (sa.failed > 0 ? Infinity : sa.avg) : Infinity;
      const vb = sb ? (sb.failed > 0 ? Infinity : sb.avg) : Infinity;
      return sort.dir === 'asc' ? va - vb : vb - va;
    });
    return list;
  }, [filteredMainProxyOptions, sort, getLatestMeasuredDelay, getSiteCheckSummary]);

  const blockedCount = settings?.blocked_countries?.length ?? 0;

  const openBlockModal = () => {
    setBlockedDraft(settings?.blocked_countries ?? []);
    setBlockModalOpen(true);
  };

  const saveBlocked = async () => {
    if (!settings) return;
    await updateSettings({ ...settings, blocked_countries: blockedDraft });
    setBlockModalOpen(false);
  };

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

  const SortChip = ({ field, label }: { field: SortField; label: string }) => {
    const active = sort?.field === field;
    return (
      <button
        type="button"
        onClick={() => toggleSort(field)}
        className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer
          transition-all border
          ${active
            ? 'border-primary bg-primary-50 dark:bg-primary-50/15 text-primary'
            : 'border-default-200 dark:border-default-100 text-default-500 hover:border-default-300 hover:text-default-700'
          }`}
      >
        {label}
        {active && (sort.dir === 'asc'
          ? <ArrowUp className="w-2.5 h-2.5" />
          : <ArrowDown className="w-2.5 h-2.5" />
        )}
      </button>
    );
  };

  const renderSiteTooltipContent = (s: NonNullable<ReturnType<typeof getSiteCheckSummary>>) => (
    <div className="flex flex-col gap-1 py-1">
      {s.details.map((d, index) => {
        const reason = siteErrorLabel(d.errorType);
        return (
          <div key={`${d.label}-${index}`} className="flex items-center justify-between gap-4 text-xs min-w-[180px]">
            <span className="text-default-600">{d.label}</span>
            <span className={d.delay > 0 ? (d.delay < 800 ? 'text-success' : 'text-warning') : 'text-danger'}>
              {d.delay > 0 ? `${d.delay}ms` : (reason ? `Fail (${reason})` : 'Fail')}
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <Card>
      <CardBody className="p-4 space-y-3">
        {/* Row 1: Status */}
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
              <Tooltip placement="top" showArrow delay={100} content={renderSiteTooltipContent(summary)}>
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
          <div className="flex items-center gap-1.5 shrink-0">
            <Tooltip content={blockedCount > 0 ? `${blockedCount} blocked countries` : 'Block countries'}>
              <Button
                size="sm"
                color={blockedCount > 0 ? 'danger' : 'default'}
                variant="flat"
                className="shrink-0 h-7 min-w-0 px-2"
                onPress={openBlockModal}
              >
                <ShieldBan className="w-3.5 h-3.5" />
                {blockedCount > 0 && (
                  <span className="text-[11px] font-semibold">{blockedCount}</span>
                )}
              </Button>
            </Tooltip>
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
        </div>

        {/* Row 2: Custom proxy picker */}
        <Popover
          isOpen={isOpen}
          onOpenChange={setIsOpen}
          placement="bottom"
          showArrow={false}
          offset={4}
          classNames={{
            content: 'p-0 w-[var(--popover-trigger-width)]',
          }}
        >
          <PopoverTrigger>
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-default-200 dark:border-default-100
                         hover:border-primary hover:bg-default-50 dark:hover:bg-default-50/10
                         transition-colors text-left group cursor-pointer"
            >
              {geo && <span className="text-base shrink-0">{geo.emoji}</span>}
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-foreground truncate block">{display}</span>
                {source && source !== display && (
                  <span className="text-xs text-default-400 truncate block">{source}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {delay !== null && (
                  <Chip size="sm" variant="flat" color={delayChipColor(delay)} className="h-5 text-[10px]">
                    {formatDelayLabel(delay)}
                  </Chip>
                )}
                <ChevronDown className={`w-4 h-4 text-default-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>
          </PopoverTrigger>

          <PopoverContent>
            <div className="flex flex-col">
              {/* Search */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-default-100">
                <Search className="w-3.5 h-3.5 text-default-400 shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={proxySearch}
                  onChange={(e) => setProxySearch(e.target.value)}
                  placeholder="Search proxies..."
                  className="flex-1 text-sm bg-transparent outline-none placeholder:text-default-300"
                />
                {proxySearch && (
                  <button type="button" onClick={() => setProxySearch('')} className="text-default-400 hover:text-default-600 cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  <SortChip field="delay" label="TCP" />
                  <SortChip field="site" label="Sites" />
                </div>
              </div>

              {/* List */}
              <ScrollShadow className="max-h-[280px]">
                {!hasSearchMatches ? (
                  <div className="px-3 py-4 text-xs text-center text-default-400">
                    No proxies found for &ldquo;{proxySearch.trim()}&rdquo;
                  </div>
                ) : (
                  <div className="py-1">
                    {sortedOptions.map((item) => {
                      const s = getSiteCheckSummary(item);
                      const g = getGeoLabel(item);
                      const d = getProxyDisplayTag(item);
                      const src = getProxySourceTag(item);
                      const itemDelay = getLatestMeasuredDelay(item);
                      const isSelected = item === mainProxyGroup.now;

                      return (
                        <button
                          key={item}
                          type="button"
                          onClick={() => {
                            switchProxy(mainProxyGroup.name, item);
                            setIsOpen(false);
                          }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer
                            transition-colors hover:bg-default-100 dark:hover:bg-default-50/10
                            ${isSelected ? 'bg-primary-50 dark:bg-primary-50/10' : ''}`}
                        >
                          {/* Geo flag or check icon */}
                          <span className="w-5 text-center shrink-0">
                            {isSelected ? (
                              <Check className="w-4 h-4 text-primary inline-block" />
                            ) : g ? (
                              <span className="text-sm">{g.emoji}</span>
                            ) : (
                              <span className="w-4 h-4 inline-block" />
                            )}
                          </span>

                          {/* Name + source */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {isSelected && g && <span className="text-sm">{g.emoji}</span>}
                              <span className={`text-sm truncate ${isSelected ? 'font-semibold text-primary' : 'text-foreground'}`}>{d}</span>
                            </div>
                            {src && src !== d && (
                              <p className="text-[11px] text-default-400 truncate">{src}</p>
                            )}
                          </div>

                          {/* Metrics with tooltips */}
                          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            {itemDelay !== null && (
                              <Tooltip content={`TCP delay: ${formatDelayLabel(itemDelay)}`} placement="left" delay={200}>
                                <div>
                                  <Chip size="sm" variant="flat" color={delayChipColor(itemDelay)} className="h-5 text-[10px] cursor-help">
                                    {formatDelayLabel(itemDelay)}
                                  </Chip>
                                </div>
                              </Tooltip>
                            )}
                            {s && (
                              <Tooltip placement="left" showArrow delay={200} content={renderSiteTooltipContent(s)}>
                                <div>
                                  <Chip size="sm" variant="flat" color={siteChipColor(s)} className="h-5 text-[10px] cursor-help">
                                    {s.failed > 0 ? `${s.failed}/${s.count}` : `${s.avg}ms`}
                                  </Chip>
                                </div>
                              </Tooltip>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </ScrollShadow>
            </div>
          </PopoverContent>
        </Popover>
      </CardBody>

      {/* Block Countries Modal */}
      <Modal isOpen={blockModalOpen} onClose={() => setBlockModalOpen(false)} size="sm">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <ShieldBan className="w-5 h-5" />
            Block Countries
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-500 mb-2">
              Nodes from blocked countries will be excluded from Auto, country groups and Proxy selector.
            </p>
            <CheckboxGroup value={blockedDraft} onChange={(v) => setBlockedDraft(v as string[])}>
              <div className="grid grid-cols-2 gap-1">
                {countryOptions.filter(c => c.code !== 'UNKNOWN').map((c) => (
                  <Checkbox key={c.code} value={c.code} size="sm">
                    <span className="text-sm">{c.emoji} {c.name}</span>
                  </Checkbox>
                ))}
              </div>
            </CheckboxGroup>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="flat" onPress={() => setBlockModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" color="primary" onPress={saveBlocked}>
              Save
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Card>
  );
}
