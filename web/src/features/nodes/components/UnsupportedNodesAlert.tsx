import {
  Card,
  CardBody,
  Button,
} from '@nextui-org/react';
import { AlertTriangle, Trash2, RefreshCw } from 'lucide-react';
import type { UnsupportedNodeInfo } from '../../../store';

interface UnsupportedNodesAlertProps {
  unsupportedNodes: UnsupportedNodeInfo[];
  onRecheck: () => void;
  onDeleteOne: (tags: string[]) => void;
  onDeleteAll: () => void;
}

export default function UnsupportedNodesAlert({
  unsupportedNodes,
  onRecheck,
  onDeleteAll,
}: UnsupportedNodesAlertProps) {
  if (unsupportedNodes.length === 0) return null;

  return (
    <Card className="border border-warning-200 bg-warning-50 dark:bg-warning-50/10">
      <CardBody>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex gap-3 items-center">
            <AlertTriangle className="w-5 h-5 text-warning-600 shrink-0" />
            <p className="font-semibold text-warning-700 dark:text-warning-500 text-sm">
              {unsupportedNodes.length} unsupported node(s) excluded — these nodes cause sing-box config errors and have been automatically disabled.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="flat"
              color="warning"
              startContent={<RefreshCw className="w-3 h-3" />}
              onPress={onRecheck}
            >
              Recheck
            </Button>
            <Button
              size="sm"
              variant="flat"
              color="danger"
              startContent={<Trash2 className="w-3 h-3" />}
              onPress={onDeleteAll}
            >
              Delete All
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
