import { Card, CardBody } from '@nextui-org/react';
import { Globe } from 'lucide-react';
import type { Subscription, ManualNode, NodeHealthResult, HealthCheckMode, NodeSiteCheckResult, UnsupportedNodeInfo } from '../../../store';
import { SITE_CHECK_TARGETS } from '../types';
import SubscriptionCard from '../components/SubscriptionCard';

interface SubscriptionsTabProps {
  subscriptions: Subscription[];
  manualNodes: ManualNode[];
  loading: boolean;
  healthResults: Record<string, NodeHealthResult>;
  healthMode: HealthCheckMode | null;
  healthCheckingNodes: string[];
  checkSingleNodeHealth: (tag: string) => void;
  siteCheckResults: Record<string, NodeSiteCheckResult>;
  siteCheckingNodes: string[];
  checkSingleNodeSites: (tag: string, targets: string[]) => void;
  unsupportedNodes: UnsupportedNodeInfo[];
  onRefresh: (id: string) => void;
  onEdit: (sub: Subscription) => void;
  onDelete: (id: string) => void;
  onToggle: (sub: Subscription) => void;
}

export default function SubscriptionsTab({
  subscriptions,
  manualNodes,
  loading,
  healthResults,
  healthMode,
  healthCheckingNodes,
  checkSingleNodeHealth,
  siteCheckResults,
  siteCheckingNodes,
  checkSingleNodeSites,
  unsupportedNodes,
  onRefresh,
  onEdit,
  onDelete,
  onToggle,
}: SubscriptionsTabProps) {
  if (subscriptions.length === 0) {
    return (
      <Card className="mt-4">
        <CardBody className="py-12 text-center">
          <Globe className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">No subscriptions yet, click the button above to add one</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      {subscriptions.map((sub) => (
        <SubscriptionCard
          key={sub.id}
          subscription={sub}
          onRefresh={() => onRefresh(sub.id)}
          onEdit={() => onEdit(sub)}
          onDelete={() => onDelete(sub.id)}
          onToggle={() => onToggle(sub)}
          loading={loading}
          healthResults={healthResults}
          healthMode={healthMode}
          healthCheckingNodes={healthCheckingNodes}
          onHealthCheck={checkSingleNodeHealth}
          siteCheckResults={siteCheckResults}
          siteCheckingNodes={siteCheckingNodes}
          onSiteCheck={(tag) => checkSingleNodeSites(tag, SITE_CHECK_TARGETS)}
          siteTargets={SITE_CHECK_TARGETS}
          unsupportedNodes={unsupportedNodes}
          manualNodes={manualNodes}
        />
      ))}
    </div>
  );
}
