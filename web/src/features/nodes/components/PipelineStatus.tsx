import { Chip } from '@nextui-org/react';
import type { PipelineResult } from '../../../store';

interface PipelineStatusProps {
  lastRun?: string;
  lastResult?: PipelineResult;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function PipelineStatus({ lastRun, lastResult }: PipelineStatusProps) {
  if (!lastRun) {
    return <p className="text-xs text-gray-400">Never run</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-gray-500">Last run: {timeAgo(lastRun)}</span>
      {lastResult && (
        <>
          {lastResult.copied_nodes > 0 && (
            <Chip size="sm" variant="flat" color="success">+{lastResult.copied_nodes} copied</Chip>
          )}
          {lastResult.skipped_nodes > 0 && (
            <Chip size="sm" variant="flat" color="default">{lastResult.skipped_nodes} skipped</Chip>
          )}
          {lastResult.removed_stale > 0 && (
            <Chip size="sm" variant="flat" color="warning">-{lastResult.removed_stale} removed</Chip>
          )}
          {lastResult.error && (
            <Chip size="sm" variant="flat" color="danger">{lastResult.error}</Chip>
          )}
        </>
      )}
    </div>
  );
}
