import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Chip,
  Spinner,
} from '@nextui-org/react';
import { Activity, Globe } from 'lucide-react';
import type { Node, NodeHealthResult, HealthCheckMode, NodeSiteCheckResult } from '../../../store';
import { nodeDisplayTag, nodeInternalTag, nodeSourceTag } from '../../../store';
import { spKey, SITE_CHECK_TARGETS } from '../types';
import NodeHealthChips from '../components/NodeHealthChips';

interface CountryNodesModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCountry: { code: string; name: string; emoji: string } | null;
  countryNodes: Node[];
  countryNodesLoading: boolean;
  countryNodesError: string | null;
  healthResults: Record<string, NodeHealthResult>;
  healthMode: HealthCheckMode | null;
  healthCheckingNodes: string[];
  onHealthCheck: (tag: string) => void;
  siteCheckResults: Record<string, NodeSiteCheckResult>;
  siteCheckingNodes: string[];
  onSiteCheck: (tag: string) => void;
}

export default function CountryNodesModal({
  isOpen,
  onClose,
  selectedCountry,
  countryNodes,
  countryNodesLoading,
  countryNodesError,
  healthResults,
  healthMode,
  healthCheckingNodes,
  onHealthCheck,
  siteCheckResults,
  siteCheckingNodes,
  onSiteCheck,
}: CountryNodesModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{selectedCountry?.emoji}</span>
            <span>{selectedCountry?.name}</span>
            <Chip size="sm" variant="flat">{countryNodes.length}</Chip>
          </div>
        </ModalHeader>
        <ModalBody>
          {countryNodesLoading ? (
            <div className="flex justify-center py-8">
              <Spinner size="lg" />
            </div>
          ) : countryNodesError ? (
            <p className="text-center text-red-500 py-8">{countryNodesError}</p>
          ) : countryNodes.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No nodes found</p>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {countryNodes.map((node, idx) => (
                <div
                  key={idx}
                  className="flex flex-wrap items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded text-sm"
                >
                  <span className="truncate flex-1 min-w-0">
                    <span className="block truncate">{nodeDisplayTag(node)}</span>
                    {nodeSourceTag(node) && nodeSourceTag(node) !== nodeDisplayTag(node) && (
                      <span className="block truncate text-xs text-gray-500">{nodeSourceTag(node)}</span>
                    )}
                    <NodeHealthChips
                      tag={spKey(node)}
                      healthResults={healthResults}
                      healthMode={healthMode}
                      siteCheckResults={siteCheckResults}
                      siteTargets={SITE_CHECK_TARGETS}
                    />
                  </span>
                  <Chip size="sm" variant="flat">
                    {node.type}
                  </Chip>
                  <span className="text-xs text-gray-400 hidden sm:inline">{node.server}:{node.server_port}</span>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    color="warning"
                    onPress={() => onHealthCheck(nodeInternalTag(node))}
                    isDisabled={healthCheckingNodes.includes(nodeInternalTag(node))}
                  >
                    {healthCheckingNodes.includes(nodeInternalTag(node)) ? (
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
                    onPress={() => onSiteCheck(nodeInternalTag(node))}
                    isDisabled={siteCheckingNodes.includes(nodeInternalTag(node))}
                  >
                    {siteCheckingNodes.includes(nodeInternalTag(node)) ? (
                      <Spinner size="sm" />
                    ) : (
                      <Globe className="w-3 h-3" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>Close</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
