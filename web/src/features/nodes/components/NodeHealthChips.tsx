import { Chip } from '@nextui-org/react';
import type { NodeHealthResult, HealthCheckMode, NodeSiteCheckResult } from '../../../store';
import { shortSiteLabel } from '../types';

interface NodeHealthChipsProps {
  tag: string;
  healthResults: Record<string, NodeHealthResult>;
  healthMode: HealthCheckMode | null;
  siteCheckResults: Record<string, NodeSiteCheckResult>;
  siteTargets: string[];
}

export default function NodeHealthChips({ tag, healthResults, healthMode, siteCheckResults, siteTargets }: NodeHealthChipsProps) {
  const result = healthResults[tag];
  const siteResult = siteCheckResults[tag];
  const isClashMode = healthMode === 'clash_api' || healthMode === 'clash_api_temp';
  if (!result && !siteResult) return null;

  const orderedSiteEntries = siteResult
    ? siteTargets.map((site) => [site, siteResult.sites?.[site] ?? 0] as const)
    : [];

  return (
    <>
      {result && (
        <>
          {isClashMode && Object.keys(result.groups).length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-1">
              {Object.entries(result.groups).map(([group, delay]) => (
                <Chip
                  key={group}
                  size="sm"
                  variant="flat"
                  color={delay > 0 ? (delay < 300 ? 'success' : 'warning') : 'danger'}
                >
                  {group}: {delay > 0 ? `${delay}ms` : 'Timeout'}
                </Chip>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1 mt-1">
              <Chip size="sm" variant="flat" color={result.alive ? 'success' : 'danger'}>
                {result.alive ? 'Proxy: OK' : 'Proxy: Fail'}
              </Chip>
            </div>
          )}
        </>
      )}

      {orderedSiteEntries.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {orderedSiteEntries.map(([site, delay]) => (
            <Chip
              key={site}
              size="sm"
              variant="flat"
              color={delay > 0 ? (delay < 800 ? 'success' : 'warning') : 'danger'}
            >
              {shortSiteLabel(site)}: {delay > 0 ? `${delay}ms` : 'Fail'}
            </Chip>
          ))}
        </div>
      )}
    </>
  );
}
