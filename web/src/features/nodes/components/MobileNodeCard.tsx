import { Chip, Button, Checkbox } from '@nextui-org/react';
import { Activity, Trash2, ArrowUpCircle, ArrowDownCircle, Archive, Pencil, RotateCcw } from 'lucide-react';
import type { UnifiedNode, NodeHealthResult, HealthCheckMode, NodeSiteCheckResult, GeoData } from '../../../store';
import { nodeDisplayTag, nodeInternalTag, nodeSourceTag } from '../../../store';
import { spKey, SITE_CHECK_TARGETS } from '../types';
import NodeHealthChips from './NodeHealthChips';
import GeoChip from './GeoChip';

function countryCodeToEmoji(code: string): string {
  const upper = code.toUpperCase();
  if (upper.length !== 2) return '🌐';
  return String.fromCodePoint(
    0x1F1E6 + upper.charCodeAt(0) - 65,
    0x1F1E6 + upper.charCodeAt(1) - 65,
  );
}

interface MobileNodeCardProps {
  node: UnifiedNode;
  geoData: Record<string, GeoData>;
  variant: 'pending' | 'verified' | 'archived';
  // Optional — only for pending/verified
  healthResults?: Record<string, NodeHealthResult>;
  healthMode?: HealthCheckMode | null;
  healthCheckingNodes?: string[];
  siteCheckResults?: Record<string, NodeSiteCheckResult>;
  onHealthCheck?: (tag: string) => void;
  // Selection — only for pending
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
  // Actions
  onPromote?: (id: number) => void;
  onDemote?: (id: number) => void;
  onArchive?: (id: number) => void;
  onUnarchive?: (id: number) => void;
  onDelete?: (id: number) => void;
  onEdit?: (node: UnifiedNode) => void;
}

export default function MobileNodeCard({
  node,
  geoData,
  variant,
  healthResults,
  healthMode,
  healthCheckingNodes,
  siteCheckResults,
  onHealthCheck,
  selected,
  onToggleSelect,
  onPromote,
  onDemote,
  onArchive,
  onUnarchive,
  onDelete,
  onEdit,
}: MobileNodeCardProps) {
  const key = spKey(node);
  const geo = geoData[key];
  const hasGeo = geo?.status === 'success' && geo.country_code;
  const countryEmoji = hasGeo ? countryCodeToEmoji(geo.country_code) : '🌐';
  const failures = node.consecutive_failures;

  return (
    <div className={`p-3 rounded-lg border ${selected ? 'border-primary bg-primary-50 dark:bg-primary-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
      {/* Row 1: checkbox + emoji + tag + type */}
      <div className="flex items-center gap-2 min-w-0">
        {onToggleSelect && (
          <Checkbox
            size="sm"
            isSelected={selected}
            onValueChange={() => onToggleSelect(node.id)}
            className="shrink-0"
          />
        )}
        <span className="text-lg shrink-0">{countryEmoji}</span>
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm truncate block">{nodeDisplayTag(node)}</span>
          {nodeSourceTag(node) && nodeSourceTag(node) !== nodeDisplayTag(node) && (
            <span className="text-xs text-gray-500 truncate block">{nodeSourceTag(node)}</span>
          )}
        </div>
        <Chip size="sm" variant="flat" className="shrink-0">{node.type}</Chip>
      </div>

      {/* Row 2: server:port + geo + failures */}
      <div className="flex flex-wrap items-center gap-1.5 mt-2 ml-0">
        <span className="text-xs text-gray-500 font-mono">{node.server}:{node.server_port}</span>
        <GeoChip geo={geoData[key]} claimedCountry={node.country} />
        {variant === 'pending' && failures > 0 && (
          <Chip size="sm" variant="flat" color={failures >= 8 ? 'danger' : failures >= 5 ? 'warning' : 'default'}>
            {failures} fails
          </Chip>
        )}
        {variant === 'archived' && (
          <Chip size="sm" variant="flat" color="danger">
            {failures} fails
          </Chip>
        )}
        {variant === 'verified' && node.last_checked_at && (
          <span className="text-xs text-gray-400">
            {new Date(node.last_checked_at).toLocaleDateString()}
          </span>
        )}
        {variant === 'archived' && node.archived_at && (
          <span className="text-xs text-gray-400">
            {new Date(node.archived_at).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Row 3: health chips + action buttons */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1">
          {healthResults && siteCheckResults && (
            <NodeHealthChips
              tag={key}
              healthResults={healthResults}
              healthMode={healthMode ?? null}
              siteCheckResults={siteCheckResults}
              siteTargets={SITE_CHECK_TARGETS}
            />
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {onHealthCheck && (
            <Button
              isIconOnly
              size="sm"
              variant="light"
              isLoading={healthCheckingNodes?.includes(nodeInternalTag(node))}
              onPress={() => onHealthCheck(nodeInternalTag(node))}
            >
              <Activity className="w-3.5 h-3.5" />
            </Button>
          )}
          {onPromote && (
            <Button isIconOnly size="sm" variant="light" color="success" onPress={() => onPromote(node.id)}>
              <ArrowUpCircle className="w-3.5 h-3.5" />
            </Button>
          )}
          {onDemote && (
            <Button isIconOnly size="sm" variant="light" color="warning" onPress={() => onDemote(node.id)}>
              <ArrowDownCircle className="w-3.5 h-3.5" />
            </Button>
          )}
          {onArchive && (
            <Button isIconOnly size="sm" variant="light" color="warning" onPress={() => onArchive(node.id)}>
              <Archive className="w-3.5 h-3.5" />
            </Button>
          )}
          {onUnarchive && (
            <Button isIconOnly size="sm" variant="light" color="success" onPress={() => onUnarchive(node.id)}>
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          )}
          {onEdit && (
            <Button isIconOnly size="sm" variant="light" onPress={() => onEdit(node)}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
          )}
          {onDelete && (
            <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => onDelete(node.id)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
