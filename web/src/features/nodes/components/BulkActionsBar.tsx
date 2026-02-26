import { Button, Spinner, Tooltip } from '@nextui-org/react';
import { Activity, Globe, Trash2, ToggleLeft, ToggleRight, FolderInput, X } from 'lucide-react';
import useIsMobile from '../../../hooks/useIsMobile';

interface BulkActionsBarProps {
  selectedCount: number;
  selectedManualCount: number;
  selectedSubCount: number;
  siteChecking: boolean;
  onHealthCheck: () => void;
  onSiteCheck: () => void;
  onDelete: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onCopyToManual: () => void;
  onClear: () => void;
}

export default function BulkActionsBar({
  selectedCount,
  selectedManualCount,
  selectedSubCount,
  siteChecking,
  onHealthCheck,
  onSiteCheck,
  onDelete,
  onEnable,
  onDisable,
  onCopyToManual,
  onClear,
}: BulkActionsBarProps) {
  const isMobile = useIsMobile();

  if (selectedCount === 0) return null;

  if (isMobile) {
    return (
      <div className="flex items-center gap-1 p-2 bg-primary-50 dark:bg-primary-900/20 rounded-lg">
        <span className="text-xs font-medium shrink-0">{selectedCount} sel.</span>
        <Tooltip content="Health Check">
          <Button size="sm" isIconOnly variant="flat" color="warning" onPress={onHealthCheck}>
            <Activity className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content="Site Check">
          <Button size="sm" isIconOnly variant="flat" color="warning" onPress={onSiteCheck} isDisabled={siteChecking}>
            {siteChecking ? <Spinner size="sm" /> : <Globe className="w-3.5 h-3.5" />}
          </Button>
        </Tooltip>
        <Tooltip content={`Delete (${selectedManualCount})`}>
          <Button size="sm" isIconOnly variant="flat" color="danger" onPress={onDelete} isDisabled={selectedManualCount === 0}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content={`Enable (${selectedManualCount})`}>
          <Button size="sm" isIconOnly variant="flat" onPress={onEnable} isDisabled={selectedManualCount === 0}>
            <ToggleRight className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content={`Disable (${selectedManualCount})`}>
          <Button size="sm" isIconOnly variant="flat" onPress={onDisable} isDisabled={selectedManualCount === 0}>
            <ToggleLeft className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content={`Copy to Manual (${selectedSubCount})`}>
          <Button size="sm" isIconOnly variant="flat" color="secondary" onPress={onCopyToManual} isDisabled={selectedSubCount === 0}>
            <FolderInput className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
        <Button size="sm" isIconOnly variant="light" onPress={onClear} className="ml-auto">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 p-2 bg-primary-50 dark:bg-primary-900/20 rounded-lg">
      <span className="text-sm font-medium ml-1">{selectedCount} selected</span>
      <Button size="sm" variant="flat" color="warning" startContent={<Activity className="w-3.5 h-3.5" />} onPress={onHealthCheck}>
        Health Check
      </Button>
      <Button
        size="sm"
        variant="flat"
        color="warning"
        startContent={siteChecking ? <Spinner size="sm" /> : <Globe className="w-3.5 h-3.5" />}
        onPress={onSiteCheck}
        isDisabled={siteChecking}
      >
        Site Check
      </Button>
      <Button
        size="sm"
        variant="flat"
        color="danger"
        startContent={<Trash2 className="w-3.5 h-3.5" />}
        onPress={onDelete}
        isDisabled={selectedManualCount === 0}
      >
        Delete ({selectedManualCount})
      </Button>
      <Button
        size="sm"
        variant="flat"
        startContent={<ToggleRight className="w-3.5 h-3.5" />}
        onPress={onEnable}
        isDisabled={selectedManualCount === 0}
      >
        Enable ({selectedManualCount})
      </Button>
      <Button
        size="sm"
        variant="flat"
        startContent={<ToggleLeft className="w-3.5 h-3.5" />}
        onPress={onDisable}
        isDisabled={selectedManualCount === 0}
      >
        Disable ({selectedManualCount})
      </Button>
      <Button
        size="sm"
        variant="flat"
        color="secondary"
        startContent={<FolderInput className="w-3.5 h-3.5" />}
        onPress={onCopyToManual}
        isDisabled={selectedSubCount === 0}
      >
        Copy to Manual ({selectedSubCount})
      </Button>
      <Button size="sm" isIconOnly variant="light" onPress={onClear} className="ml-auto">
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
