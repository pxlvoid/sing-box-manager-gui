import { Chip, Tooltip } from '@nextui-org/react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { NodeStabilityStats } from '../types';

interface StabilityCellProps {
  stats?: NodeStabilityStats;
}

export default function StabilityCell({ stats }: StabilityCellProps) {
  if (!stats || stats.total_checks === 0) {
    return <span className="text-xs text-gray-400">No data</span>;
  }

  const uptime = stats.uptime_percent;
  const color = uptime >= 80 ? 'success' : uptime >= 50 ? 'warning' : 'danger';

  return (
    <div className="flex items-center gap-1.5">
      <Tooltip content={`${stats.alive_checks}/${stats.total_checks} checks successful`}>
        <Chip size="sm" variant="flat" color={color}>
          {uptime.toFixed(0)}%
        </Chip>
      </Tooltip>
      <span className="text-xs text-gray-500">{Math.round(stats.avg_latency_ms)}ms</span>
      {stats.latency_trend === 'up' && <TrendingUp className="w-3 h-3 text-danger" />}
      {stats.latency_trend === 'down' && <TrendingDown className="w-3 h-3 text-success" />}
      {stats.latency_trend === 'stable' && <Minus className="w-3 h-3 text-gray-400" />}
    </div>
  );
}
