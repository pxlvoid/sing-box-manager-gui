import { useState } from 'react';
import {
  Card,
  CardHeader,
  CardBody,
  Button,
  Chip,
  Accordion,
  AccordionItem,
  Spinner,
  Switch,
} from '@nextui-org/react';
import { RefreshCw, Pencil, Trash2, ChevronDown, ChevronUp, Activity, Globe } from 'lucide-react';
import type { Subscription, Node, ManualNode, NodeHealthResult, HealthCheckMode, NodeSiteCheckResult, UnsupportedNodeInfo } from '../../../store';
import { formatBytes, spKey } from '../types';
import NodeHealthChips from './NodeHealthChips';

interface SubscriptionCardProps {
  subscription: Subscription;
  onRefresh: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  loading: boolean;
  healthResults: Record<string, NodeHealthResult>;
  healthMode: HealthCheckMode | null;
  healthCheckingNodes: string[];
  onHealthCheck: (tag: string) => void;
  siteCheckResults: Record<string, NodeSiteCheckResult>;
  siteCheckingNodes: string[];
  onSiteCheck: (tag: string) => void;
  siteTargets: string[];
  unsupportedNodes: UnsupportedNodeInfo[];
  manualNodes?: ManualNode[];
}

export default function SubscriptionCard({
  subscription: sub,
  onRefresh,
  onEdit,
  onDelete,
  onToggle,
  loading,
  healthResults,
  healthMode,
  healthCheckingNodes,
  onHealthCheck,
  siteCheckResults,
  siteCheckingNodes,
  onSiteCheck,
  siteTargets,
  unsupportedNodes,
  manualNodes,
}: SubscriptionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const nodes = sub.nodes || [];

  const nodesByCountry = nodes.reduce((acc, node) => {
    const country = node.country || 'OTHER';
    if (!acc[country]) {
      acc[country] = {
        emoji: node.country_emoji || '🌐',
        nodes: [],
      };
    }
    acc[country].nodes.push(node);
    return acc;
  }, {} as Record<string, { emoji: string; nodes: Node[] }>);

  // Pipeline stats
  const totalNodes = nodes.length;
  const aliveNodes = nodes.filter(n => healthResults[spKey(n)]?.alive === true).length;
  const inManual = manualNodes ? manualNodes.filter(mn => mn.source_subscription_id === sub.id).length : 0;

  return (
    <Card>
      <CardHeader
        className="flex flex-col sm:flex-row justify-between items-start gap-3 cursor-pointer"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          setIsExpanded(!isExpanded);
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Chip
            color={sub.enabled ? 'success' : 'default'}
            variant="flat"
            size="sm"
          >
            {sub.enabled ? 'Enabled' : 'Disabled'}
          </Chip>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold truncate">{sub.name}</h3>
            <p className="text-sm text-gray-500">
              {sub.node_count} nodes · Updated at {new Date(sub.updated_at).toLocaleString()}
            </p>
            {/* Pipeline visualization */}
            {totalNodes > 0 && (
              <div className="flex items-center gap-1.5 mt-1">
                <Chip size="sm" variant="flat" color="default">{totalNodes} nodes</Chip>
                <span className="text-xs text-gray-400">→</span>
                <Chip size="sm" variant="flat" color={aliveNodes > 0 ? 'success' : 'default'}>{aliveNodes} alive</Chip>
                <span className="text-xs text-gray-400">→</span>
                <Chip size="sm" variant="flat" color={inManual > 0 ? 'primary' : 'default'}>{inManual} in manual</Chip>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center self-end sm:self-auto shrink-0">
          <Button
            size="sm"
            variant="flat"
            startContent={loading ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />}
            onPress={onRefresh}
            isDisabled={loading}
          >
            Refresh
          </Button>
          <Button
            size="sm"
            variant="flat"
            startContent={<Pencil className="w-4 h-4" />}
            onPress={onEdit}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="flat"
            color="danger"
            startContent={<Trash2 className="w-4 h-4" />}
            onPress={onDelete}
          >
            Delete
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            onPress={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
          <Switch
            isSelected={sub.enabled}
            onValueChange={onToggle}
          />
        </div>
      </CardHeader>

      {isExpanded && (
        <CardBody className="pt-0">
          {sub.traffic && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-4">
              <span>Used: {formatBytes(sub.traffic.used)}</span>
              <span>Remaining: {formatBytes(sub.traffic.remaining)}</span>
              <span>Total: {formatBytes(sub.traffic.total)}</span>
              {sub.expire_at && (
                <span>Expires: {new Date(sub.expire_at).toLocaleDateString()}</span>
              )}
            </div>
          )}

          <Accordion variant="bordered" selectionMode="multiple">
            {Object.entries(nodesByCountry).map(([country, data]) => (
              <AccordionItem
                key={country}
                aria-label={country}
                title={
                  <div className="flex items-center gap-2">
                    <span>{data.emoji}</span>
                    <span>{country}</span>
                    <Chip size="sm" variant="flat">{data.nodes.length}</Chip>
                  </div>
                }
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {data.nodes.map((node, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded text-sm"
                    >
                      <span className="truncate flex-1 min-w-0">
                        <span className="block truncate">{node.tag}</span>
                        <NodeHealthChips
                          tag={spKey(node)}
                          healthResults={healthResults}
                          healthMode={healthMode}
                          siteCheckResults={siteCheckResults}
                          siteTargets={siteTargets}
                        />
                      </span>
                      {unsupportedNodes.some(u => u.tag === node.tag) && (
                        <Chip size="sm" variant="flat" color="warning" title={unsupportedNodes.find(u => u.tag === node.tag)?.error}>
                          Unsupported
                        </Chip>
                      )}
                      <Chip size="sm" variant="flat">
                        {node.type}
                      </Chip>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        color="warning"
                        onPress={() => onHealthCheck(node.tag)}
                        isDisabled={healthCheckingNodes.includes(node.tag)}
                      >
                        {healthCheckingNodes.includes(node.tag) ? (
                          <Spinner size="sm" />
                        ) : (
                          <Activity className="w-3 h-3" />
                        )}
                      </Button>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        color="warning"
                        onPress={() => onSiteCheck(node.tag)}
                        isDisabled={siteCheckingNodes.includes(node.tag)}
                      >
                        {siteCheckingNodes.includes(node.tag) ? (
                          <Spinner size="sm" />
                        ) : (
                          <Globe className="w-3 h-3" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </AccordionItem>
            ))}
          </Accordion>
        </CardBody>
      )}
    </Card>
  );
}
