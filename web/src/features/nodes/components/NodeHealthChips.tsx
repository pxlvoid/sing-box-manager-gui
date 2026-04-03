import { Chip, Tooltip } from '@nextui-org/react';
import type { NodeHealthResult, HealthCheckMode, NodeSiteCheckResult, SpeedTestResult } from '../../../store';
import { shortSiteLabel, siteErrorLabel } from '../types';

function formatSpeed(bps: number): string {
  if (bps <= 0) return '0';
  const mbps = (bps * 8) / 1_000_000;
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
  const kbps = (bps * 8) / 1000;
  return `${kbps.toFixed(0)} Kbps`;
}

interface NodeHealthChipsProps {
  tag: string;
  healthResults: Record<string, NodeHealthResult>;
  healthMode: HealthCheckMode | null;
  siteCheckResults: Record<string, NodeSiteCheckResult>;
  siteTargets: string[];
  speedResults?: Record<string, SpeedTestResult>;
}

export default function NodeHealthChips({ tag, healthResults, healthMode, siteCheckResults, siteTargets, speedResults }: NodeHealthChipsProps) {
  const result = healthResults[tag];
  const siteResult = siteCheckResults[tag];
  const speedResult = speedResults?.[tag];
  const isClashMode = healthMode === 'clash_api' || healthMode === 'clash_api_temp';
  if (!result && !siteResult && !speedResult) return null;

  const orderedSiteEntries = siteResult
    ? siteTargets.map((site) => ({
        site,
        delay: siteResult.sites?.[site] ?? 0,
        errorType: siteResult.errors?.[site] || '',
      }))
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

  orderedSiteEntries.forEach(({ site, delay, errorType }) => {
    const failReason = siteErrorLabel(errorType);
    checks.push({
      label: shortSiteLabel(site),
      value: delay > 0 ? `${delay}ms` : failReason ? `Fail (${failReason})` : 'Fail',
      status: delay > 0 ? (delay < 800 ? 'success' : 'warning') : 'danger',
    });
  });

  if (speedResult) {
    if (speedResult.error && speedResult.download_bps <= 0) {
      checks.push({ label: 'Speed', value: 'Fail', status: 'danger' });
    } else if (speedResult.download_bps > 0) {
      const mbps = (speedResult.download_bps * 8) / 1_000_000;
      checks.push({
        label: 'Speed',
        value: formatSpeed(speedResult.download_bps),
        status: mbps >= 10 ? 'success' : mbps >= 2 ? 'warning' : 'danger',
      });
    }
  }

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
