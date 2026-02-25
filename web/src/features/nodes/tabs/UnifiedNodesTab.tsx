import {
  Card,
  CardBody,
  Input,
  Select,
  SelectItem,
  Chip,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Pagination,
  Checkbox,
  Button,
  Switch,
  Tooltip,
} from '@nextui-org/react';
import { Search, ArrowUp, ArrowDown, Activity, Globe, Copy, ClipboardCheck, Pencil, Trash2, FolderInput, Server } from 'lucide-react';
import type { Subscription, ManualNode, NodeHealthResult, HealthCheckMode, NodeSiteCheckResult } from '../../../store';
import type { UnifiedNode, HealthFilter, SortConfig, NodeStabilityStats, SortColumn } from '../types';
import { spKey, SITE_CHECK_TARGETS } from '../types';
import NodeHealthChips from '../components/NodeHealthChips';
import StabilityCell from '../components/StabilityCell';
import BulkActionsBar from '../components/BulkActionsBar';

interface UnifiedNodesTabProps {
  // Unified tab hook data
  healthFilter: HealthFilter;
  setHealthFilter: (f: HealthFilter) => void;
  sortConfig: SortConfig;
  handleColumnSort: (col: SortColumn) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  sourceFilter: string;
  setSourceFilter: (f: string) => void;
  unifiedPage: number;
  setUnifiedPage: (p: number) => void;
  unifiedNodes: UnifiedNode[];
  filteredAndSortedNodes: UnifiedNode[];
  unifiedTotalPages: number;
  safePage: number;
  paginatedNodes: UnifiedNode[];
  selectedNodes: Set<string>;
  selectedManualNodes: UnifiedNode[];
  selectedSubNodes: UnifiedNode[];
  allPageSelected: boolean;
  somePageSelected: boolean;
  handleToggleSelectAll: () => void;
  handleToggleSelect: (key: string) => void;
  handleBulkHealthCheck: () => void;
  handleBulkSiteCheck: () => void;
  handleBulkDelete: () => void;
  handleBulkToggle: (enabled: boolean) => void;
  handleBulkCopyToManual: () => void;
  clearSelection: () => void;
  // From store / parent
  subscriptions: Subscription[];
  manualNodes: ManualNode[];
  healthResults: Record<string, NodeHealthResult>;
  healthMode: HealthCheckMode | null;
  healthCheckingNodes: string[];
  checkSingleNodeHealth: (tag: string) => void;
  siteCheckResults: Record<string, NodeSiteCheckResult>;
  siteChecking: boolean;
  siteCheckingNodes: string[];
  checkSingleNodeSites: (tag: string, targets: string[]) => void;
  probeStatus: { running: boolean; node_count: number } | null;
  // Handlers from parent
  copiedNodeId: string | null;
  onCopyNode: (id: string) => void;
  onCopyToManual: (node: import('../../../store').Node, sourceSubscriptionId?: string) => void;
  onEditNode: (mn: ManualNode) => void;
  onDeleteNode: (id: string) => void;
  onToggleNode: (mn: ManualNode) => void;
  // Stability
  stabilityStats: Record<string, NodeStabilityStats>;
  minStability: number;
  setMinStability: (v: number) => void;
  // Copy Alive
  hasAliveNodes: boolean;
  healthChecking: boolean;
  onCopyAliveToManual: () => void;
}

export default function UnifiedNodesTab({
  healthFilter,
  setHealthFilter,
  sortConfig,
  handleColumnSort,
  searchQuery,
  setSearchQuery,
  sourceFilter,
  setSourceFilter,
  setUnifiedPage,
  unifiedNodes,
  filteredAndSortedNodes,
  unifiedTotalPages,
  safePage,
  paginatedNodes,
  selectedNodes,
  selectedManualNodes,
  selectedSubNodes,
  allPageSelected,
  somePageSelected,
  handleToggleSelectAll,
  handleToggleSelect,
  handleBulkHealthCheck,
  handleBulkSiteCheck,
  handleBulkDelete,
  handleBulkToggle,
  handleBulkCopyToManual,
  clearSelection,
  subscriptions,
  manualNodes,
  healthResults,
  healthMode,
  healthCheckingNodes,
  checkSingleNodeHealth,
  siteCheckResults,
  siteChecking,
  siteCheckingNodes,
  checkSingleNodeSites,
  probeStatus,
  stabilityStats,
  minStability,
  setMinStability,
  copiedNodeId,
  onCopyNode,
  onCopyToManual,
  onEditNode,
  onDeleteNode,
  onToggleNode,
  hasAliveNodes,
  healthChecking,
  onCopyAliveToManual,
}: UnifiedNodesTabProps) {
  return (
    <div className="space-y-3 mt-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          size="sm"
          placeholder="Search nodes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          startContent={<Search className="w-3.5 h-3.5 text-gray-400" />}
          className="w-48"
          isClearable
          onClear={() => setSearchQuery('')}
        />
        <Select
          size="sm"
          selectedKeys={[sourceFilter]}
          onChange={(e) => setSourceFilter(e.target.value || 'all')}
          className="w-40"
          aria-label="Source filter"
          items={[
            { key: 'all', label: 'All Sources' },
            { key: 'manual', label: 'Manual' },
            ...subscriptions.filter(s => s.enabled).map(sub => ({ key: sub.id, label: sub.name })),
          ]}
        >
          {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
        </Select>
        <div className="flex gap-1">
          {(['all', 'alive', 'timeout', 'unchecked'] as HealthFilter[]).map(f => (
            <Chip
              key={f}
              size="sm"
              variant={healthFilter === f ? 'solid' : 'flat'}
              color={f === 'alive' ? 'success' : f === 'timeout' ? 'danger' : f === 'unchecked' ? 'default' : 'primary'}
              className="cursor-pointer"
              onClick={() => setHealthFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'alive' ? 'Alive' : f === 'timeout' ? 'Timeout' : 'Unchecked'}
            </Chip>
          ))}
        </div>
        <Select
          size="sm"
          selectedKeys={[String(minStability)]}
          onChange={(e) => setMinStability(Number(e.target.value) || 0)}
          className="w-32"
          aria-label="Stability filter"
          items={[
            { key: '0', label: 'Any stability' },
            { key: '50', label: '> 50%' },
            { key: '80', label: '> 80%' },
            { key: '95', label: '> 95%' },
          ]}
        >
          {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
        </Select>
        {hasAliveNodes && !healthChecking && (
          <Button
            size="sm"
            variant="flat"
            color="success"
            startContent={<FolderInput className="w-3.5 h-3.5" />}
            onPress={onCopyAliveToManual}
          >
            Copy Alive to Manual
          </Button>
        )}
        <span className="text-xs text-gray-400 ml-auto">
          {filteredAndSortedNodes.length === unifiedNodes.length
            ? `${unifiedNodes.length} nodes`
            : `${filteredAndSortedNodes.length} of ${unifiedNodes.length} nodes`}
        </span>
      </div>

      {/* Probe status indicator */}
      <div className="flex items-center gap-2 px-1">
        <span className={`inline-block w-2 h-2 rounded-full ${probeStatus?.running ? 'bg-green-500' : 'bg-gray-400'}`} />
        <span className="text-xs text-gray-500">
          {probeStatus?.running ? `Probe running (${probeStatus.node_count} nodes)` : 'Probe stopped'}
        </span>
      </div>

      {/* Bulk action bar */}
      <BulkActionsBar
        selectedCount={selectedNodes.size}
        selectedManualCount={selectedManualNodes.length}
        selectedSubCount={selectedSubNodes.length}
        siteChecking={siteChecking}
        onHealthCheck={handleBulkHealthCheck}
        onSiteCheck={handleBulkSiteCheck}
        onDelete={handleBulkDelete}
        onEnable={() => handleBulkToggle(true)}
        onDisable={() => handleBulkToggle(false)}
        onCopyToManual={handleBulkCopyToManual}
        onClear={clearSelection}
      />

      {/* Table */}
      {unifiedNodes.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center">
            <Server className="w-12 h-12 mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500">No nodes yet. Add manual nodes or subscriptions first.</p>
          </CardBody>
        </Card>
      ) : filteredAndSortedNodes.length === 0 ? (
        <Card>
          <CardBody className="py-8 text-center">
            <p className="text-gray-500">No nodes match current filters.</p>
          </CardBody>
        </Card>
      ) : (
        <Table
          aria-label="Unified nodes table"
          removeWrapper
          isCompact
          bottomContent={
            unifiedTotalPages > 1 ? (
              <div className="flex justify-center">
                <Pagination
                  size="sm"
                  total={unifiedTotalPages}
                  page={safePage}
                  onChange={setUnifiedPage}
                />
              </div>
            ) : null
          }
        >
          <TableHeader>
            <TableColumn width={40}>
              <Checkbox
                size="sm"
                isSelected={allPageSelected}
                isIndeterminate={somePageSelected && !allPageSelected}
                onValueChange={handleToggleSelectAll}
              />
            </TableColumn>
            <TableColumn width={40}> </TableColumn>
            <TableColumn allowsSorting>
              <span className="cursor-pointer flex items-center gap-1" onClick={() => handleColumnSort('name')}>
                Name
                {sortConfig.column === 'name' && (sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
              </span>
            </TableColumn>
            <TableColumn width={100}>
              <span className="cursor-pointer flex items-center gap-1" onClick={() => handleColumnSort('type')}>
                Type
                {sortConfig.column === 'type' && (sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
              </span>
            </TableColumn>
            <TableColumn width={140}>
              <span className="cursor-pointer flex items-center gap-1" onClick={() => handleColumnSort('source')}>
                Source
                {sortConfig.column === 'source' && (sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
              </span>
            </TableColumn>
            <TableColumn width={130}>
              <span className="cursor-pointer flex items-center gap-1" onClick={() => handleColumnSort('stability')}>
                Stability
                {sortConfig.column === 'stability' && (sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
              </span>
            </TableColumn>
            <TableColumn width={180}>
              <span className="cursor-pointer flex items-center gap-1" onClick={() => handleColumnSort('latency')}>
                Latency
                {sortConfig.column === 'latency' && (sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
              </span>
            </TableColumn>
            <TableColumn width={160}>Actions</TableColumn>
          </TableHeader>
          <TableBody>
            {paginatedNodes.map((un) => {
              const mn = un.manualNodeId ? manualNodes.find(m => m.id === un.manualNodeId) : null;
              return (
                <TableRow key={un.key}>
                  <TableCell>
                    <Checkbox
                      size="sm"
                      isSelected={selectedNodes.has(un.key)}
                      onValueChange={() => handleToggleSelect(un.key)}
                    />
                  </TableCell>
                  <TableCell>
                    <span className="text-lg">{un.node.country_emoji || '🌐'}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate max-w-[300px]">{un.node.tag}</span>
                      {un.isUnsupported && (
                        <Chip size="sm" variant="flat" color="warning">Unsupported</Chip>
                      )}
                      {un.groupTag && (
                        <Chip size="sm" variant="flat" color="secondary">{un.groupTag}</Chip>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{un.node.server}:{un.node.server_port}</p>
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" variant="flat">{un.node.type}</Chip>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="sm"
                      variant="flat"
                      color={un.source === 'manual' ? 'primary' : 'secondary'}
                    >
                      {un.sourceName}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <StabilityCell stats={stabilityStats[spKey(un.node)]} />
                  </TableCell>
                  <TableCell>
                    <NodeHealthChips
                      tag={spKey(un.node)}
                      healthResults={healthResults}
                      healthMode={healthMode}
                      siteCheckResults={siteCheckResults}
                      siteTargets={SITE_CHECK_TARGETS}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        isLoading={healthCheckingNodes.includes(un.node.tag)}
                        onPress={() => checkSingleNodeHealth(un.node.tag)}
                      >
                        <Activity className="w-4 h-4" />
                      </Button>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        isLoading={siteCheckingNodes.includes(un.node.tag)}
                        onPress={() => checkSingleNodeSites(un.node.tag, SITE_CHECK_TARGETS)}
                      >
                        <Globe className="w-4 h-4" />
                      </Button>
                      {mn ? (
                        <>
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
                            size="sm"
                            isSelected={mn.enabled}
                            onValueChange={() => onToggleNode(mn)}
                          />
                        </>
                      ) : (
                        <Tooltip content="Copy to Manual">
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            onPress={() => onCopyToManual(un.node, un.source === 'subscription' ? un.sourceId : undefined)}
                          >
                            <FolderInput className="w-4 h-4" />
                          </Button>
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
