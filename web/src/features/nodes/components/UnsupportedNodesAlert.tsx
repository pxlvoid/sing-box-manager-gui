import {
  Card,
  CardBody,
  Button,
} from '@nextui-org/react';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';
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
  onDeleteOne,
  onDeleteAll,
}: UnsupportedNodesAlertProps) {
  if (unsupportedNodes.length === 0) return null;

  return (
    <Card className="border border-warning-200 bg-warning-50 dark:bg-warning-50/10">
      <CardBody>
        <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
          <div className="flex gap-3">
            <AlertTriangle className="w-5 h-5 text-warning-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <h4 className="font-semibold text-warning-700 dark:text-warning-500">
                {unsupportedNodes.length} unsupported node(s) excluded
              </h4>
              <p className="text-sm text-warning-600 dark:text-warning-400 mt-0.5">
                These nodes cause sing-box config errors and have been automatically disabled.
              </p>
              <div className="mt-2 space-y-1">
                {unsupportedNodes.map(n => (
                  <div key={n.tag} className="text-xs text-warning-600 dark:text-warning-400 flex items-center gap-2">
                    <span className="font-mono shrink-0">{n.tag}</span>
                    <span className="opacity-70 truncate flex-1">{n.error}</span>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      color="danger"
                      className="min-w-6 w-6 h-6"
                      onPress={() => onDeleteOne([n.tag])}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
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
