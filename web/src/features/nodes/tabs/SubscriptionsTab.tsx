import { Card, CardBody, CardHeader, Button, Chip, Spinner } from '@nextui-org/react';
import { Globe, RefreshCw, Pencil, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import type { Subscription, NodeCounts } from '../../../store';

interface SubscriptionsTabProps {
  subscriptions: Subscription[];
  nodeCounts: NodeCounts;
  loading: boolean;
  onRefresh: (id: string) => void;
  onEdit: (sub: Subscription) => void;
  onDelete: (id: string) => void;
  onToggle: (sub: Subscription) => void;
}

export default function SubscriptionsTab({
  subscriptions,
  nodeCounts,
  loading,
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
      {/* Node counts summary */}
      <Card>
        <CardBody className="py-3">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm font-medium text-gray-500">Node Status:</span>
            <Chip size="sm" variant="flat" color="warning">Pending: {nodeCounts.pending}</Chip>
            <Chip size="sm" variant="flat" color="success">Verified: {nodeCounts.verified}</Chip>
            <Chip size="sm" variant="flat" color="default">Archived: {nodeCounts.archived}</Chip>
          </div>
        </CardBody>
      </Card>

      {subscriptions.map((sub) => (
        <Card key={sub.id}>
          <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="flex items-center gap-3">
              <Chip
                size="sm"
                color={sub.enabled ? 'success' : 'default'}
                variant="dot"
              >
                {sub.name}
              </Chip>
              <span className="text-sm text-gray-500">
                {sub.node_count} nodes
              </span>
              {sub.traffic && (
                <span className="text-xs text-gray-400">
                  {formatTraffic(sub.traffic.used)} / {formatTraffic(sub.traffic.total)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="light"
                isIconOnly
                onPress={() => onToggle(sub)}
              >
                {sub.enabled ? <ToggleRight className="w-4 h-4 text-success" /> : <ToggleLeft className="w-4 h-4" />}
              </Button>
              <Button
                size="sm"
                variant="light"
                isIconOnly
                isDisabled={loading}
                onPress={() => onRefresh(sub.id)}
              >
                {loading ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />}
              </Button>
              <Button
                size="sm"
                variant="light"
                isIconOnly
                onPress={() => onEdit(sub)}
              >
                <Pencil className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="light"
                isIconOnly
                color="danger"
                onPress={() => onDelete(sub.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-sm text-gray-500">
              <span>Updated: {new Date(sub.updated_at).toLocaleString()}</span>
              {sub.expire_at && (
                <span>Expires: {new Date(sub.expire_at).toLocaleDateString()}</span>
              )}
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function formatTraffic(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
