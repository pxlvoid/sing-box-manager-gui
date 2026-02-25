import { useState } from 'react';
import { Switch, Button, Input, Select, SelectItem, Spinner } from '@nextui-org/react';
import { Play } from 'lucide-react';
import type { Subscription, PipelineSettings as PipelineSettingsType } from '../../../store';
import PipelineStatus from './PipelineStatus';

interface PipelineSettingsProps {
  subscription: Subscription;
  manualNodeTags: string[];
  onUpdatePipeline: (id: string, settings: PipelineSettingsType) => Promise<void>;
  onRunPipeline: (id: string) => Promise<any>;
  pipelineRunning: boolean;
}

const stabilityOptions = [
  { value: '0', label: 'Any' },
  { value: '50', label: '> 50%' },
  { value: '80', label: '> 80%' },
  { value: '95', label: '> 95%' },
];

export default function PipelineSettings({
  subscription: sub,
  manualNodeTags,
  onUpdatePipeline,
  onRunPipeline,
  pipelineRunning,
}: PipelineSettingsProps) {
  const [groupTag, setGroupTag] = useState(sub.pipeline_group_tag || '');

  const handleToggleAuto = (enabled: boolean) => {
    onUpdatePipeline(sub.id, { auto_pipeline: enabled });
  };

  const handleGroupTagBlur = () => {
    if (groupTag !== (sub.pipeline_group_tag || '')) {
      onUpdatePipeline(sub.id, { pipeline_group_tag: groupTag });
    }
  };

  const handleStabilityChange = (value: string) => {
    onUpdatePipeline(sub.id, { pipeline_min_stability: Number(value) });
  };

  const handleToggleRemoveDead = (enabled: boolean) => {
    onUpdatePipeline(sub.id, { pipeline_remove_dead: enabled });
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Auto-Pipeline</h4>
        <Switch
          size="sm"
          isSelected={sub.auto_pipeline}
          onValueChange={handleToggleAuto}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          size="sm"
          label="Target Group Tag"
          placeholder="e.g. auto-alive"
          value={groupTag}
          onValueChange={setGroupTag}
          onBlur={handleGroupTagBlur}
          list="group-tag-suggestions"
        />
        <datalist id="group-tag-suggestions">
          {manualNodeTags.map(tag => (
            <option key={tag} value={tag} />
          ))}
        </datalist>

        <Select
          size="sm"
          label="Min Stability"
          selectedKeys={[String(sub.pipeline_min_stability || 0)]}
          onSelectionChange={(keys) => {
            const val = Array.from(keys)[0] as string;
            if (val) handleStabilityChange(val);
          }}
        >
          {stabilityOptions.map(opt => (
            <SelectItem key={opt.value}>{opt.label}</SelectItem>
          ))}
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-sm text-gray-600 dark:text-gray-400">Remove dead nodes</label>
        <Switch
          size="sm"
          isSelected={sub.pipeline_remove_dead}
          onValueChange={handleToggleRemoveDead}
        />
      </div>

      <div className="flex items-center justify-between">
        <PipelineStatus
          lastRun={sub.pipeline_last_run}
          lastResult={sub.pipeline_last_result}
        />
        <Button
          size="sm"
          color="primary"
          variant="flat"
          startContent={pipelineRunning ? <Spinner size="sm" /> : <Play className="w-3 h-3" />}
          onPress={() => onRunPipeline(sub.id)}
          isDisabled={pipelineRunning || !sub.enabled || (sub.nodes?.length || 0) === 0}
        >
          Run Now
        </Button>
      </div>
    </div>
  );
}
