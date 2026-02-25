import { useEffect, useState } from 'react';
import {
  Button,
  Spinner,
  Tabs,
  Tab,
  useDisclosure,
} from '@nextui-org/react';
import { Plus, Globe, Activity, List, Filter as FilterIcon, Download, ClipboardPaste } from 'lucide-react';
import { useStore } from '../store';
import { manualNodeApi, nodeApi } from '../api';
import type { ManualNode, Node } from '../store';
import { SITE_CHECK_TARGETS } from '../features/nodes/types';

// Hooks
import { useSubscriptionForm } from '../features/nodes/hooks/useSubscriptionForm';
import { useNodeForm } from '../features/nodes/hooks/useNodeForm';
import { useFilterForm } from '../features/nodes/hooks/useFilterForm';
import { useBulkAddForm } from '../features/nodes/hooks/useBulkAddForm';
import { useExportImport } from '../features/nodes/hooks/useExportImport';
import { useUnifiedTab } from '../features/nodes/hooks/useUnifiedTab';

// Tabs
import UnifiedNodesTab from '../features/nodes/tabs/UnifiedNodesTab';
import ManualNodesTab from '../features/nodes/tabs/ManualNodesTab';
import SubscriptionsTab from '../features/nodes/tabs/SubscriptionsTab';
import FiltersTab from '../features/nodes/tabs/FiltersTab';
import CountryViewTab from '../features/nodes/tabs/CountryViewTab';

// Components
import UnsupportedNodesAlert from '../features/nodes/components/UnsupportedNodesAlert';

// Modals
import SubscriptionModal from '../features/nodes/modals/SubscriptionModal';
import NodeModal from '../features/nodes/modals/NodeModal';
import BulkAddModal from '../features/nodes/modals/BulkAddModal';
import FilterModal from '../features/nodes/modals/FilterModal';
import ExportModal from '../features/nodes/modals/ExportModal';
import ImportModal from '../features/nodes/modals/ImportModal';
import CountryNodesModal from '../features/nodes/modals/CountryNodesModal';

export default function Subscriptions() {
  const {
    subscriptions,
    manualNodes,
    countryGroups,
    filters,
    loading,
    manualNodeTags,
    selectedGroupTag,
    fetchSubscriptions,
    fetchManualNodes,
    fetchCountryGroups,
    fetchFilters,
    fetchManualNodeTags,
    setSelectedGroupTag,
    deleteSubscription,
    refreshSubscription,
    toggleSubscription,
    deleteManualNode,
    updateManualNode,
    addManualNode,
    deleteFilter,
    toggleFilter,
    healthResults,
    healthMode,
    healthChecking,
    healthCheckingNodes,
    checkAllNodesHealth,
    checkSingleNodeHealth,
    siteCheckResults,
    siteChecking,
    siteCheckingNodes,
    checkNodesSites,
    checkSingleNodeSites,
    unsupportedNodes,
    fetchUnsupportedNodes,
    recheckUnsupportedNodes,
    deleteUnsupportedNodes,
    probeStatus,
    fetchProbeStatus,
  } = useStore();

  // Form hooks
  const subForm = useSubscriptionForm();
  const nodeForm = useNodeForm();
  const bulkForm = useBulkAddForm();
  const filterForm = useFilterForm();
  const exportImport = useExportImport();
  const unified = useUnifiedTab();

  // Shared state
  const [copiedNodeId, setCopiedNodeId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  // Country modal state
  const { isOpen: isCountryOpen, onOpen: onCountryOpen, onClose: onCountryClose } = useDisclosure();
  const [selectedCountry, setSelectedCountry] = useState<{ code: string; name: string; emoji: string } | null>(null);
  const [countryNodes, setCountryNodes] = useState<Node[]>([]);
  const [countryNodesLoading, setCountryNodesLoading] = useState(false);
  const [countryNodesError, setCountryNodesError] = useState<string | null>(null);

  // Initial data loading
  useEffect(() => {
    fetchSubscriptions();
    fetchManualNodes();
    fetchCountryGroups();
    fetchFilters();
    fetchManualNodeTags();
    fetchUnsupportedNodes();
    fetchProbeStatus();
  }, []);

  // Bridge handlers
  const handleDeleteNode = async (id: string) => {
    if (confirm('Are you sure you want to delete this node?')) {
      await deleteManualNode(id);
    }
  };

  const handleToggleNode = async (mn: ManualNode) => {
    await updateManualNode(mn.id, { ...mn, enabled: !mn.enabled });
  };

  const handleCopyNode = async (id: string) => {
    try {
      const response = await manualNodeApi.export([id]);
      const urls: string[] = response.data.data;
      if (urls.length > 0) {
        await navigator.clipboard.writeText(urls[0]);
        setCopiedNodeId(id);
        setTimeout(() => setCopiedNodeId(null), 2000);
      }
    } catch (error) {
      console.error('Failed to copy node:', error);
    }
  };

  const handleCopyAllNodes = async () => {
    try {
      const response = await manualNodeApi.export();
      const urls: string[] = response.data.data;
      if (urls.length > 0) {
        await navigator.clipboard.writeText(urls.join('\n'));
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 2000);
      }
    } catch (error) {
      console.error('Failed to copy nodes:', error);
    }
  };

  const handleCopyToManual = async (node: Node, sourceSubscriptionId?: string) => {
    try {
      await addManualNode({ node, enabled: true, source_subscription_id: sourceSubscriptionId });
    } catch (error) {
      console.error('Failed to copy node to manual:', error);
    }
  };

  const handleRefresh = async (id: string) => {
    await refreshSubscription(id);
  };

  const handleDeleteSubscription = async (id: string) => {
    if (confirm('Are you sure you want to delete this subscription?')) {
      await deleteSubscription(id);
    }
  };

  const handleToggleSubscription = async (sub: import('../store').Subscription) => {
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

  const handleCountryClick = async (group: { code: string; name: string; emoji: string }) => {
    setSelectedCountry(group);
    setCountryNodes([]);
    setCountryNodesError(null);
    setCountryNodesLoading(true);
    onCountryOpen();
    try {
      const res = await nodeApi.getByCountry(group.code);
      setCountryNodes(res.data.data || []);
    } catch (error) {
      console.error('Failed to fetch nodes for country:', error);
      setCountryNodesError('Failed to load nodes for this country');
    } finally {
      setCountryNodesLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Node Management</h1>
        <div className="flex flex-wrap gap-2">
          <Button
            color="warning"
            variant="flat"
            size="sm"
            startContent={healthChecking ? <Spinner size="sm" /> : <Activity className="w-4 h-4" />}
            onPress={() => checkAllNodesHealth()}
            isDisabled={healthChecking}
          >
            <span className="hidden sm:inline">Check All</span>
            <span className="sm:hidden">Check</span>
          </Button>
          <Button
            color="warning"
            variant="flat"
            size="sm"
            startContent={siteChecking ? <Spinner size="sm" /> : <Globe className="w-4 h-4" />}
            onPress={() => checkNodesSites(undefined, SITE_CHECK_TARGETS)}
            isDisabled={siteChecking}
          >
            <span className="hidden sm:inline">Check Sites</span>
            <span className="sm:hidden">Sites</span>
          </Button>
          <Button
            variant="flat"
            size="sm"
            startContent={<Download className="w-4 h-4" />}
            onPress={exportImport.handlePrepareExport}
          >
            <span className="hidden sm:inline">Export All</span>
            <span className="sm:hidden">Export</span>
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
            <span className="hidden sm:inline">Add Filter</span>
            <span className="sm:hidden">Filter</span>
          </Button>
          <Button
            color="primary"
            variant="flat"
            size="sm"
            startContent={<Plus className="w-4 h-4" />}
            onPress={nodeForm.handleOpenAdd}
          >
            <span className="hidden sm:inline">Add Node</span>
            <span className="sm:hidden">Node</span>
          </Button>
          <Button
            color="primary"
            variant="flat"
            size="sm"
            startContent={<List className="w-4 h-4" />}
            onPress={bulkForm.handleOpen}
          >
            <span className="hidden sm:inline">Bulk Add</span>
            <span className="sm:hidden">Bulk</span>
          </Button>
          <Button
            color="primary"
            size="sm"
            startContent={<Plus className="w-4 h-4" />}
            onPress={subForm.handleOpenAdd}
          >
            <span className="hidden sm:inline">Add Subscription</span>
            <span className="sm:hidden">Sub</span>
          </Button>
        </div>
      </div>

      <UnsupportedNodesAlert
        unsupportedNodes={unsupportedNodes}
        onRecheck={recheckUnsupportedNodes}
        onDeleteOne={deleteUnsupportedNodes}
        onDeleteAll={() => {
          if (confirm(`Delete all ${unsupportedNodes.length} unsupported node(s) from subscriptions and manual nodes?`)) {
            deleteUnsupportedNodes();
          }
        }}
      />

      <Tabs aria-label="Node Management" defaultSelectedKey="unified">
        <Tab key="unified" title={<span>Unified{unified.unifiedNodes.length > 0 && <span className="ml-1.5 text-xs opacity-60">({unified.unifiedNodes.length})</span>}</span>}>
          <UnifiedNodesTab
            {...unified}
            subscriptions={subscriptions}
            manualNodes={manualNodes}
            healthResults={healthResults}
            healthMode={healthMode}
            healthCheckingNodes={healthCheckingNodes}
            checkSingleNodeHealth={checkSingleNodeHealth}
            siteCheckResults={siteCheckResults}
            siteChecking={siteChecking}
            siteCheckingNodes={siteCheckingNodes}
            checkSingleNodeSites={checkSingleNodeSites}
            probeStatus={probeStatus}
            copiedNodeId={copiedNodeId}
            onCopyNode={handleCopyNode}
            onCopyToManual={handleCopyToManual}
            onEditNode={nodeForm.handleOpenEdit}
            onDeleteNode={handleDeleteNode}
            onToggleNode={handleToggleNode}
          />
        </Tab>

        <Tab key="manual" title={<span>Manual Nodes{manualNodes.length > 0 && <span className="ml-1.5 text-xs opacity-60">({manualNodes.length})</span>}</span>}>
          <ManualNodesTab
            manualNodes={manualNodes}
            manualNodeTags={manualNodeTags}
            selectedGroupTag={selectedGroupTag}
            setSelectedGroupTag={setSelectedGroupTag}
            healthResults={healthResults}
            healthMode={healthMode}
            healthCheckingNodes={healthCheckingNodes}
            checkSingleNodeHealth={checkSingleNodeHealth}
            siteCheckResults={siteCheckResults}
            siteCheckingNodes={siteCheckingNodes}
            checkSingleNodeSites={checkSingleNodeSites}
            unsupportedNodes={unsupportedNodes}
            copiedNodeId={copiedNodeId}
            copiedAll={copiedAll}
            onCopyNode={handleCopyNode}
            onCopyAllNodes={handleCopyAllNodes}
            onEditNode={nodeForm.handleOpenEdit}
            onDeleteNode={handleDeleteNode}
            onToggleNode={handleToggleNode}
          />
        </Tab>

        <Tab key="subscriptions" title={<span>Subscriptions{subscriptions.length > 0 && <span className="ml-1.5 text-xs opacity-60">({subscriptions.length})</span>}</span>}>
          <SubscriptionsTab
            subscriptions={subscriptions}
            manualNodes={manualNodes}
            loading={loading}
            healthResults={healthResults}
            healthMode={healthMode}
            healthCheckingNodes={healthCheckingNodes}
            checkSingleNodeHealth={checkSingleNodeHealth}
            siteCheckResults={siteCheckResults}
            siteCheckingNodes={siteCheckingNodes}
            checkSingleNodeSites={checkSingleNodeSites}
            unsupportedNodes={unsupportedNodes}
            onRefresh={handleRefresh}
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

        <Tab key="countries" title={<span>By Country/Region{countryGroups.length > 0 && <span className="ml-1.5 text-xs opacity-60">({countryGroups.length})</span>}</span>}>
          <CountryViewTab
            countryGroups={countryGroups}
            onCountryClick={handleCountryClick}
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
        nodeEnabled={nodeForm.nodeEnabled}
        setNodeEnabled={nodeForm.setNodeEnabled}
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

      <CountryNodesModal
        isOpen={isCountryOpen}
        onClose={onCountryClose}
        selectedCountry={selectedCountry}
        countryNodes={countryNodes}
        countryNodesLoading={countryNodesLoading}
        countryNodesError={countryNodesError}
        healthResults={healthResults}
        healthMode={healthMode}
        healthCheckingNodes={healthCheckingNodes}
        onHealthCheck={checkSingleNodeHealth}
        siteCheckResults={siteCheckResults}
        siteCheckingNodes={siteCheckingNodes}
        onSiteCheck={(tag) => checkSingleNodeSites(tag, SITE_CHECK_TARGETS)}
      />
    </div>
  );
}
