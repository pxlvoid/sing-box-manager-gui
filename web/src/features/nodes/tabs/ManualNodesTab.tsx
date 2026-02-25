import {
  Card,
  CardBody,
  Chip,
  Button,
  Switch,
} from '@nextui-org/react';
import { Server, Activity, Globe, Copy, ClipboardCheck, Pencil, Trash2 } from 'lucide-react';
import type { ManualNode, NodeHealthResult, HealthCheckMode, NodeSiteCheckResult, UnsupportedNodeInfo } from '../../../store';
import { spKey, SITE_CHECK_TARGETS } from '../types';
import NodeHealthChips from '../components/NodeHealthChips';

interface ManualNodesTabProps {
  manualNodes: ManualNode[];
  manualNodeTags: string[];
  selectedGroupTag: string | null;
  setSelectedGroupTag: (tag: string | null) => void;
  healthResults: Record<string, NodeHealthResult>;
  healthMode: HealthCheckMode | null;
  healthCheckingNodes: string[];
  checkSingleNodeHealth: (tag: string) => void;
  siteCheckResults: Record<string, NodeSiteCheckResult>;
  siteCheckingNodes: string[];
  checkSingleNodeSites: (tag: string, targets: string[]) => void;
  unsupportedNodes: UnsupportedNodeInfo[];
  copiedNodeId: string | null;
  copiedAll: boolean;
  onCopyNode: (id: string) => void;
  onCopyAllNodes: () => void;
  onEditNode: (mn: ManualNode) => void;
  onDeleteNode: (id: string) => void;
  onToggleNode: (mn: ManualNode) => void;
  onRenameTag: (oldTag: string, newTag: string) => Promise<void>;
  onDeleteTag: (tag: string) => Promise<void>;
}

export default function ManualNodesTab({
  manualNodes,
  manualNodeTags,
  selectedGroupTag,
  setSelectedGroupTag,
  healthResults,
  healthMode,
  healthCheckingNodes,
  checkSingleNodeHealth,
  siteCheckResults,
  siteCheckingNodes,
  checkSingleNodeSites,
  unsupportedNodes,
  copiedNodeId,
  copiedAll,
  onCopyNode,
  onCopyAllNodes,
  onEditNode,
  onDeleteNode,
  onToggleNode,
  onRenameTag,
  onDeleteTag,
}: ManualNodesTabProps) {
  if (manualNodes.length === 0) {
    return (
      <Card className="mt-4">
        <CardBody className="py-12 text-center">
          <Server className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">No manual nodes yet, click the button above to add one</p>
        </CardBody>
      </Card>
    );
  }

  const filteredNodes = selectedGroupTag === null
    ? manualNodes
    : selectedGroupTag === ''
      ? manualNodes.filter(n => !n.group_tag)
      : manualNodes.filter(n => n.group_tag === selectedGroupTag);

  const handleRenameTag = async (tag: string) => {
    const newTag = prompt(`Rename tag "${tag}" to:`, tag);
    if (newTag && newTag.trim() && newTag.trim() !== tag) {
      await onRenameTag(tag, newTag.trim());
      if (selectedGroupTag === tag) {
        setSelectedGroupTag(newTag.trim());
      }
    }
  };

  const handleDeleteTag = (tag: string) => {
    const count = manualNodes.filter(n => n.group_tag === tag).length;
    if (confirm(`Clear tag "${tag}" from ${count} node(s)? Nodes will not be deleted.`)) {
      onDeleteTag(tag);
      if (selectedGroupTag === tag) {
        setSelectedGroupTag(null);
      }
    }
  };

  return (
    <div className="space-y-3 mt-4">
      <div className="flex justify-between items-center">
        {manualNodeTags.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <Chip
              variant={selectedGroupTag === null ? 'solid' : 'flat'}
              color="primary"
              className="cursor-pointer"
              onClick={() => setSelectedGroupTag(null)}
            >
              All ({manualNodes.length})
            </Chip>
            <Chip
              variant={selectedGroupTag === '' ? 'solid' : 'flat'}
              className="cursor-pointer"
              onClick={() => setSelectedGroupTag('')}
            >
              No tag ({manualNodes.filter(n => !n.group_tag).length})
            </Chip>
            {manualNodeTags.map(tag => (
              <div key={tag} className="flex items-center gap-0.5">
                <Chip
                  variant={selectedGroupTag === tag ? 'solid' : 'flat'}
                  color="secondary"
                  className="cursor-pointer"
                  onClick={() => setSelectedGroupTag(tag)}
                >
                  {tag} ({manualNodes.filter(n => n.group_tag === tag).length})
                </Chip>
                {selectedGroupTag === tag && (
                  <>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      onPress={() => handleRenameTag(tag)}
                      title="Rename tag"
                    >
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      color="danger"
                      onPress={() => handleDeleteTag(tag)}
                      title="Clear tag from nodes"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        <Button
          size="sm"
          variant="flat"
          startContent={copiedAll ? <ClipboardCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          color={copiedAll ? 'success' : 'default'}
          onPress={onCopyAllNodes}
        >
          {copiedAll ? 'Copied!' : 'Copy All'}
        </Button>
      </div>
      {filteredNodes.map((mn) => (
        <Card key={mn.id}>
          <CardBody className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xl">{mn.node.country_emoji || '🌐'}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-medium truncate">{mn.node.tag}</h3>
                  {mn.group_tag && (
                    <Chip size="sm" variant="flat" color="secondary">{mn.group_tag}</Chip>
                  )}
                  {unsupportedNodes.some(u => u.tag === mn.node.tag) && (
                    <Chip size="sm" variant="flat" color="warning" title={unsupportedNodes.find(u => u.tag === mn.node.tag)?.error}>
                      Unsupported
                    </Chip>
                  )}
                </div>
                <p className="text-xs text-gray-500 truncate">{mn.node.type} • {mn.node.server}:{mn.node.server_port}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              <NodeHealthChips
                tag={spKey(mn.node)}
                healthResults={healthResults}
                healthMode={healthMode}
                siteCheckResults={siteCheckResults}
                siteTargets={SITE_CHECK_TARGETS}
              />
              <Button
                isIconOnly
                size="sm"
                variant="light"
                isLoading={healthCheckingNodes.includes(mn.node.tag)}
                onPress={() => checkSingleNodeHealth(mn.node.tag)}
              >
                <Activity className="w-4 h-4" />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                isLoading={siteCheckingNodes.includes(mn.node.tag)}
                onPress={() => checkSingleNodeSites(mn.node.tag, SITE_CHECK_TARGETS)}
              >
                <Globe className="w-4 h-4" />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPress={() => onCopyNode(mn.id)}
                title="Copy node link"
              >
                {copiedNodeId === mn.id ? <ClipboardCheck className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPress={() => onEditNode(mn)}
              >
                <Pencil className="w-4 h-4" />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                color="danger"
                onPress={() => onDeleteNode(mn.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <Switch
                isSelected={mn.enabled}
                onValueChange={() => onToggleNode(mn)}
              />
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
