import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Chip,
  Spinner,
  Tabs,
  Tab,
} from '@nextui-org/react';
import { Plus, List, Filter as FilterIcon, Download, ClipboardPaste, Network } from 'lucide-react';
import { useStore } from '../store';
import type { Subscription, UnifiedNode } from '../store';
import { nodeDisplayTag, nodeInternalTag, nodeSourceTag } from '../store';
import { monitoringApi } from '../api';

// Hooks
import { useSubscriptionForm } from '../features/nodes/hooks/useSubscriptionForm';
import { useNodeForm } from '../features/nodes/hooks/useNodeForm';
import { useFilterForm } from '../features/nodes/hooks/useFilterForm';
import { useBulkAddForm } from '../features/nodes/hooks/useBulkAddForm';
import { useExportImport } from '../features/nodes/hooks/useExportImport';

// Tabs
import PendingNodesTab from '../features/nodes/tabs/PendingNodesTab';
import VerifiedNodesTab from '../features/nodes/tabs/VerifiedNodesTab';
import ArchivedNodesTab from '../features/nodes/tabs/ArchivedNodesTab';
import SubscriptionsTab from '../features/nodes/tabs/SubscriptionsTab';
import FiltersTab from '../features/nodes/tabs/FiltersTab';

// Components
import UnsupportedNodesAlert from '../features/nodes/components/UnsupportedNodesAlert';

// Modals
import SubscriptionModal from '../features/nodes/modals/SubscriptionModal';
import NodeModal from '../features/nodes/modals/NodeModal';
import BulkAddModal from '../features/nodes/modals/BulkAddModal';
import FilterModal from '../features/nodes/modals/FilterModal';
import ExportModal from '../features/nodes/modals/ExportModal';
import ImportModal from '../features/nodes/modals/ImportModal';

interface NodeTrafficRow {
  node_tag: string;
  display_name?: string;
  source_tag?: string;
  last_seen?: string;
  upload_bytes: number;
  download_bytes: number;
  total_bytes: number;
}

export default function Subscriptions() {
  const {
    subscriptions,
    pendingNodes,
    verifiedNodes,
    archivedNodes,
    nodeCounts,
    filters,
    loading,
    fetchSubscriptions,
    fetchNodes,
    fetchNodeCounts,
    fetchCountryGroups,
    fetchFilters,
    deleteSubscription,
    refreshSubscription,
    toggleSubscription,
    deleteNode,
    promoteNode,
    demoteNode,
    archiveNode,
    unarchiveNode,
    bulkPromoteNodes,
    bulkArchiveNodes,
    deleteFilter,
    toggleFilter,
    healthResults,
    healthMode,
    healthCheckingNodes,
    checkSingleNodeHealth,
    siteCheckResults,
    siteCheckingNodes,
    checkSingleNodeSites,
    unsupportedNodes,
    fetchUnsupportedNodes,
    recheckUnsupportedNodes,
    deleteUnsupportedNodes,
    geoData,
    fetchGeoData,
    fetchProbeStatus,
    fetchVerificationStatus,
    fetchLatestMeasurements,
  } = useStore();

  // Form hooks
  const subForm = useSubscriptionForm();
  const nodeForm = useNodeForm();
  const bulkForm = useBulkAddForm();
  const filterForm = useFilterForm();
  const exportImport = useExportImport();
  const [nodeTraffic, setNodeTraffic] = useState<NodeTrafficRow[]>([]);
  const [nodeTrafficLoading, setNodeTrafficLoading] = useState(true);

  const fetchNodeTraffic = useCallback(async () => {
    try {
      const res = await monitoringApi.getNodeTraffic(200, 0);
      setNodeTraffic(res.data?.data || []);
    } catch (error) {
      console.error('Failed to fetch node traffic stats:', error);
      setNodeTraffic([]);
    } finally {
      setNodeTrafficLoading(false);
    }
  }, []);

  const nodeStatusByTag = useMemo(() => {
    const map = new Map<string, 'pending' | 'verified' | 'archived'>();
    for (const node of pendingNodes) map.set(nodeInternalTag(node), 'pending');
    for (const node of verifiedNodes) map.set(nodeInternalTag(node), 'verified');
    for (const node of archivedNodes) map.set(nodeInternalTag(node), 'archived');
    return map;
  }, [pendingNodes, verifiedNodes, archivedNodes]);

  const nodeByInternalTag = useMemo(() => {
    const map = new Map<string, UnifiedNode>();
    for (const node of [...pendingNodes, ...verifiedNodes, ...archivedNodes]) {
      map.set(nodeInternalTag(node), node);
    }
    return map;
  }, [pendingNodes, verifiedNodes, archivedNodes]);

  const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx += 1;
    }
    return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
  };

  const formatDateTime = (value?: string): string => {
    if (!value) return '-';
    const ts = Date.parse(value);
    if (Number.isNaN(ts)) return '-';
    return new Date(ts).toLocaleString();
  };

  // Initial data loading
  useEffect(() => {
    fetchSubscriptions();
    fetchNodes();
    fetchNodeCounts();
    fetchCountryGroups();
    fetchFilters();
    fetchUnsupportedNodes();
    fetchProbeStatus();
    fetchVerificationStatus();
    fetchLatestMeasurements();
    fetchGeoData();
    fetchNodeTraffic();

    const timer = window.setInterval(() => {
      fetchNodeTraffic();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [fetchNodeTraffic]);

  const handleDeleteSubscription = async (id: string) => {
    if (confirm('Are you sure you want to delete this subscription?')) {
      await deleteSubscription(id);
    }
  };

  const handleToggleSubscription = async (sub: Subscription) => {
    await toggleSubscription(sub.id, !sub.enabled);
  };

  const handleDeleteFilter = async (id: string) => {
    if (confirm('Are you sure you want to delete this filter?')) {
      await deleteFilter(id);
    }
  };

  const handleToggleFilter = async (filter: import('../store').Filter) => {
    await toggleFilter(filter.id, !filter.enabled);
  };

  const handleEditNode = (node: UnifiedNode) => {
    nodeForm.handleOpenEdit(node);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Node Management</h1>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="flat"
            size="sm"
            startContent={<Download className="w-4 h-4" />}
            onPress={exportImport.handlePrepareExport}
          >
            Export
          </Button>
          <Button
            variant="flat"
            size="sm"
            startContent={<ClipboardPaste className="w-4 h-4" />}
            onPress={exportImport.handlePrepareImport}
          >
            Import
          </Button>
          <Button
            color="secondary"
            variant="flat"
            size="sm"
            startContent={<FilterIcon className="w-4 h-4" />}
            onPress={filterForm.handleOpenAdd}
          >
            Filter
          </Button>
          <Button
            color="primary"
            variant="flat"
            size="sm"
            startContent={<Plus className="w-4 h-4" />}
            onPress={nodeForm.handleOpenAdd}
          >
            Node
          </Button>
          <Button
            color="primary"
            variant="flat"
            size="sm"
            startContent={<List className="w-4 h-4" />}
            onPress={bulkForm.handleOpen}
          >
            Bulk
          </Button>
          <Button
            color="primary"
            size="sm"
            startContent={<Plus className="w-4 h-4" />}
            onPress={subForm.handleOpenAdd}
          >
            Sub
          </Button>
        </div>
      </div>

      <Card className="shadow-none border border-gray-200 dark:border-gray-700">
        <CardHeader className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Traffic by Node</h2>
          </div>
          <Chip size="sm" variant="flat">All-time (sampled)</Chip>
        </CardHeader>
        <CardBody className="pt-0">
          {nodeTrafficLoading ? (
            <div className="flex justify-center py-6">
              <Spinner size="sm" />
            </div>
          ) : nodeTraffic.length === 0 ? (
            <p className="text-sm text-gray-500 py-2">No node traffic data yet.</p>
          ) : (
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="py-2 pr-3">Node</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Upload</th>
                    <th className="py-2 pr-3">Download</th>
                    <th className="py-2 pr-3">Total</th>
                    <th className="py-2">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {nodeTraffic.slice(0, 40).map((item) => {
                    const status = nodeStatusByTag.get(item.node_tag);
                    const statusColor = status === 'verified' ? 'success' : status === 'pending' ? 'warning' : status === 'archived' ? 'default' : 'danger';
                    const knownNode = nodeByInternalTag.get(item.node_tag);
                    const displayName = (item.display_name || (knownNode ? nodeDisplayTag(knownNode) : item.node_tag)).trim();
                    const sourceTag = (item.source_tag || (knownNode ? nodeSourceTag(knownNode) : '')).trim();
                    return (
                      <tr key={item.node_tag} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-2 pr-3 font-medium max-w-[240px]">
                          <div className="truncate" title={displayName}>{displayName}</div>
                          {sourceTag && sourceTag !== displayName && (
                            <div className="text-xs text-gray-500 truncate" title={sourceTag}>{sourceTag}</div>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <Chip size="sm" variant="flat" color={statusColor}>
                            {status || 'missing'}
                          </Chip>
                        </td>
                        <td className="py-2 pr-3">{formatBytes(item.upload_bytes)}</td>
                        <td className="py-2 pr-3">{formatBytes(item.download_bytes)}</td>
                        <td className="py-2 pr-3 font-semibold">{formatBytes(item.total_bytes)}</td>
                        <td className="py-2">{formatDateTime(item.last_seen)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-500 mt-3">
            Based on saved monitoring snapshots in SQLite. Direct traffic and chains outside managed node tags are excluded.
          </p>
        </CardBody>
      </Card>

      <UnsupportedNodesAlert
        unsupportedNodes={unsupportedNodes}
        onRecheck={recheckUnsupportedNodes}
        onDeleteOne={deleteUnsupportedNodes}
        onDeleteAll={() => {
          if (confirm(`Delete all ${unsupportedNodes.length} unsupported node(s)?`)) {
            deleteUnsupportedNodes();
          }
        }}
      />

      <Tabs aria-label="Node Management" defaultSelectedKey="pending">
        <Tab key="pending" title={<span>Pending{nodeCounts.pending > 0 && <span className="ml-1.5 text-xs opacity-60">({nodeCounts.pending})</span>}</span>}>
          <PendingNodesTab
            nodes={pendingNodes}
            healthResults={healthResults}
            healthMode={healthMode}
            healthCheckingNodes={healthCheckingNodes}
            siteCheckResults={siteCheckResults}
            siteCheckingNodes={siteCheckingNodes}
            geoData={geoData}
            checkSingleNodeHealth={checkSingleNodeHealth}
            checkSingleNodeSites={checkSingleNodeSites}
            onPromote={promoteNode}
            onArchive={archiveNode}
            onDelete={(id) => { if (confirm('Delete this node?')) deleteNode(id); }}
            onEdit={handleEditNode}
            onBulkPromote={bulkPromoteNodes}
            onBulkArchive={bulkArchiveNodes}
          />
        </Tab>

        <Tab key="verified" title={<span>Verified{nodeCounts.verified > 0 && <span className="ml-1.5 text-xs opacity-60">({nodeCounts.verified})</span>}</span>}>
          <VerifiedNodesTab
            nodes={verifiedNodes}
            healthResults={healthResults}
            healthMode={healthMode}
            healthCheckingNodes={healthCheckingNodes}
            siteCheckResults={siteCheckResults}
            siteCheckingNodes={siteCheckingNodes}
            geoData={geoData}
            checkSingleNodeHealth={checkSingleNodeHealth}
            checkSingleNodeSites={checkSingleNodeSites}
            onDemote={demoteNode}
            onDelete={(id) => { if (confirm('Delete this node?')) deleteNode(id); }}
            onEdit={handleEditNode}
          />
        </Tab>

        <Tab key="archived" title={<span>Archived{nodeCounts.archived > 0 && <span className="ml-1.5 text-xs opacity-60">({nodeCounts.archived})</span>}</span>}>
          <ArchivedNodesTab
            nodes={archivedNodes}
            geoData={geoData}
            onUnarchive={unarchiveNode}
            onDelete={(id) => { if (confirm('Delete this node?')) deleteNode(id); }}
          />
        </Tab>

        <Tab key="subscriptions" title={<span>Subscriptions{subscriptions.length > 0 && <span className="ml-1.5 text-xs opacity-60">({subscriptions.length})</span>}</span>}>
          <SubscriptionsTab
            subscriptions={subscriptions}
            nodeCounts={nodeCounts}
            loading={loading}
            onRefresh={(id) => refreshSubscription(id)}
            onEdit={subForm.handleOpenEdit}
            onDelete={handleDeleteSubscription}
            onToggle={handleToggleSubscription}
          />
        </Tab>

        <Tab key="filters" title={<span>Filters{filters.length > 0 && <span className="ml-1.5 text-xs opacity-60">({filters.length})</span>}</span>}>
          <FiltersTab
            filters={filters}
            onEdit={filterForm.handleOpenEdit}
            onDelete={handleDeleteFilter}
            onToggle={handleToggleFilter}
          />
        </Tab>
      </Tabs>

      {/* Modals */}
      <SubscriptionModal
        isOpen={subForm.isOpen}
        onClose={subForm.onClose}
        name={subForm.name}
        setName={subForm.setName}
        url={subForm.url}
        setUrl={subForm.setUrl}
        editingSubscription={subForm.editingSubscription}
        isSubmitting={subForm.isSubmitting}
        onSave={subForm.onSave}
      />

      <NodeModal
        isOpen={nodeForm.isOpen}
        onClose={nodeForm.onClose}
        editingNode={nodeForm.editingNode}
        nodeForm={nodeForm.nodeForm}
        setNodeForm={nodeForm.setNodeForm}
        nodeUrl={nodeForm.nodeUrl}
        setNodeUrl={nodeForm.setNodeUrl}
        isParsing={nodeForm.isParsing}
        parseError={nodeForm.parseError}
        isSubmitting={nodeForm.isSubmitting}
        onParseUrl={nodeForm.onParseUrl}
        onSave={nodeForm.onSave}
        getExtra={nodeForm.getExtra}
        setExtra={nodeForm.setExtra}
      />

      <BulkAddModal
        isOpen={bulkForm.isOpen}
        onClose={bulkForm.onClose}
        bulkUrls={bulkForm.bulkUrls}
        setBulkUrls={bulkForm.setBulkUrls}
        bulkGroupTag={bulkForm.bulkGroupTag}
        setBulkGroupTag={bulkForm.setBulkGroupTag}
        bulkParsing={bulkForm.bulkParsing}
        bulkAdding={bulkForm.bulkAdding}
        bulkResults={bulkForm.bulkResults}
        onParse={bulkForm.onParse}
        onAdd={bulkForm.onAdd}
      />

      <FilterModal
        isOpen={filterForm.isOpen}
        onClose={filterForm.onClose}
        editingFilter={filterForm.editingFilter}
        filterForm={filterForm.filterForm}
        setFilterForm={filterForm.setFilterForm}
        isSubmitting={filterForm.isSubmitting}
        onSave={filterForm.onSave}
      />

      <ExportModal
        isOpen={exportImport.isExportOpen}
        onClose={exportImport.onExportClose}
        exportData={exportImport.exportData}
        onConfirm={exportImport.onConfirmExport}
      />

      <ImportModal
        isOpen={exportImport.isImportOpen}
        onClose={exportImport.onImportClose}
        importData={exportImport.importData}
        importing={exportImport.importing}
        onConfirm={exportImport.onConfirmImport}
      />
    </div>
  );
}
