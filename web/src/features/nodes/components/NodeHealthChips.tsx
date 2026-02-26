import { Chip, Tooltip } from '@nextui-org/react';
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

  const checks: Array<{
    label: string;
    value: string;
    status: 'success' | 'warning' | 'danger';
  }> = [];

  if (result) {
    if (isClashMode && Object.keys(result.groups).length > 0) {
      Object.entries(result.groups).forEach(([group, delay]) => {
        checks.push({
          label: group,
          value: delay > 0 ? `${delay}ms` : 'Timeout',
          status: delay > 0 ? (delay < 300 ? 'success' : 'warning') : 'danger',
        });
      });
    } else {
      checks.push({
        label: 'Proxy',
        value: result.alive ? (result.tcp_latency_ms > 0 ? `${result.tcp_latency_ms}ms` : 'OK') : 'Fail',
        status: result.alive ? 'success' : 'danger',
      });
    }
  }

  orderedSiteEntries.forEach(([site, delay]) => {
    checks.push({
      label: shortSiteLabel(site),
      value: delay > 0 ? `${delay}ms` : 'Fail',
      status: delay > 0 ? (delay < 800 ? 'success' : 'warning') : 'danger',
    });
  });

  if (checks.length === 0) return null;

  const failCount = checks.filter((check) => check.status === 'danger').length;
  const warningCount = checks.filter((check) => check.status === 'warning').length;

  const summaryColor: 'success' | 'warning' | 'danger' =
    failCount > 0 ? 'danger' : warningCount > 0 ? 'warning' : 'success';

  const summaryLabel =
    failCount > 0
      ? `Fail (${failCount})`
      : warningCount > 0
        ? `Slow (${warningCount})`
        : checks.length > 1
          ? `OK (${checks.length})`
          : 'OK';

  const detailRows = (
    <div className="flex flex-col gap-1 py-1">
      {checks.map((check, index) => (
        <div key={`${check.label}-${index}`} className="flex items-center justify-between gap-4 text-xs min-w-[180px]">
          <span className="text-default-600">{check.label}</span>
          <span
            className={
              check.status === 'danger'
                ? 'text-danger'
                : check.status === 'warning'
                  ? 'text-warning'
                  : 'text-success'
            }
          >
            {check.value}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <Tooltip content={detailRows} placement="top-start" showArrow delay={100}>
      <Chip size="sm" variant="flat" color={summaryColor} className="cursor-help">
        {summaryLabel}
      </Chip>
    </Tooltip>
  );
}
