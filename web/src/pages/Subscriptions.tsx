import { useEffect, useState } from 'react';
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Input,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Chip,
  Accordion,
  AccordionItem,
  Spinner,
  Tabs,
  Tab,
  Select,
  SelectItem,
  Switch,
  Textarea,
} from '@nextui-org/react';
import { Plus, RefreshCw, Trash2, Globe, Server, Pencil, Link, Filter as FilterIcon, ChevronDown, ChevronUp, List, Activity, Copy, ClipboardCheck } from 'lucide-react';
import { useStore } from '../store';
import { nodeApi, manualNodeApi } from '../api';
import type { Subscription, ManualNode, Node, Filter, NodeHealthResult } from '../store';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const nodeTypeOptions = [
  { value: 'shadowsocks', label: 'Shadowsocks' },
  { value: 'vmess', label: 'VMess' },
  { value: 'vless', label: 'VLESS' },
  { value: 'trojan', label: 'Trojan' },
  { value: 'hysteria2', label: 'Hysteria2' },
  { value: 'tuic', label: 'TUIC' },
  { value: 'socks', label: 'SOCKS' },
];

const countryOptions = [
  { code: 'HK', name: 'Hong Kong', emoji: '🇭🇰' },
  { code: 'TW', name: 'Taiwan', emoji: '🇹🇼' },
  { code: 'JP', name: 'Japan', emoji: '🇯🇵' },
  { code: 'KR', name: 'South Korea', emoji: '🇰🇷' },
  { code: 'SG', name: 'Singapore', emoji: '🇸🇬' },
  { code: 'US', name: 'United States', emoji: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', emoji: '🇬🇧' },
  { code: 'DE', name: 'Germany', emoji: '🇩🇪' },
  { code: 'FR', name: 'France', emoji: '🇫🇷' },
  { code: 'NL', name: 'Netherlands', emoji: '🇳🇱' },
  { code: 'AU', name: 'Australia', emoji: '🇦🇺' },
  { code: 'CA', name: 'Canada', emoji: '🇨🇦' },
  { code: 'RU', name: 'Russia', emoji: '🇷🇺' },
  { code: 'IN', name: 'India', emoji: '🇮🇳' },
];

const defaultNode: Node = {
  tag: '',
  type: 'shadowsocks',
  server: '',
  server_port: 443,
  country: 'HK',
  country_emoji: '🇭🇰',
};

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
    addSubscription,
    updateSubscription,
    deleteSubscription,
    refreshSubscription,
    toggleSubscription,
    addManualNode,
    addManualNodesBulk,
    updateManualNode,
    deleteManualNode,
    addFilter,
    updateFilter,
    deleteFilter,
    toggleFilter,
    healthResults,
    healthMode,
    healthChecking,
    healthCheckingNodes,
    checkAllNodesHealth,
    checkSingleNodeHealth,
  } = useStore();

  const { isOpen: isSubOpen, onOpen: onSubOpen, onClose: onSubClose } = useDisclosure();
  const { isOpen: isNodeOpen, onOpen: onNodeOpen, onClose: onNodeClose } = useDisclosure();
  const { isOpen: isBulkOpen, onOpen: onBulkOpen, onClose: onBulkClose } = useDisclosure();
  const { isOpen: isFilterOpen, onOpen: onFilterOpen, onClose: onFilterClose } = useDisclosure();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);

  // Manual node form
  const [editingNode, setEditingNode] = useState<ManualNode | null>(null);
  const [nodeForm, setNodeForm] = useState<Node>(defaultNode);
  const [nodeEnabled, setNodeEnabled] = useState(true);
  const [nodeUrl, setNodeUrl] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState('');

  // Bulk add form
  const [bulkUrls, setBulkUrls] = useState('');
  const [bulkGroupTag, setBulkGroupTag] = useState('');
  const [bulkParsing, setBulkParsing] = useState(false);
  const [bulkAdding, setBulkAdding] = useState(false);
  const [bulkResults, setBulkResults] = useState<Array<{ url: string; node?: Node; error?: string }>>([]);

  // Filter form
  const [editingFilter, setEditingFilter] = useState<Filter | null>(null);
  const defaultFilterForm: Omit<Filter, 'id'> = {
    name: '',
    include: [],
    exclude: [],
    include_countries: [],
    exclude_countries: [],
    mode: 'urltest',
    urltest_config: {
      url: 'https://www.gstatic.com/generate_204',
      interval: '5m',
      tolerance: 50,
    },
    subscriptions: [],
    all_nodes: true,
    enabled: true,
  };
  const [filterForm, setFilterForm] = useState<Omit<Filter, 'id'>>(defaultFilterForm);

  // Copy state
  const [copiedNodeId, setCopiedNodeId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    fetchSubscriptions();
    fetchManualNodes();
    fetchCountryGroups();
    fetchFilters();
    fetchManualNodeTags();
  }, []);

  const handleOpenAddSubscription = () => {
    setEditingSubscription(null);
    setName('');
    setUrl('');
    onSubOpen();
  };

  const handleOpenEditSubscription = (sub: Subscription) => {
    setEditingSubscription(sub);
    setName(sub.name);
    setUrl(sub.url);
    onSubOpen();
  };

  const handleSaveSubscription = async () => {
    if (!name || !url) return;

    setIsSubmitting(true);
    try {
      if (editingSubscription) {
        await updateSubscription(editingSubscription.id, name, url);
      } else {
        await addSubscription(name, url);
      }
      setName('');
      setUrl('');
      setEditingSubscription(null);
      onSubClose();
    } catch (error) {
      console.error(editingSubscription ? 'Failed to update subscription:' : 'Failed to add subscription:', error);
    } finally {
      setIsSubmitting(false);
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

  const handleToggleSubscription = async (sub: Subscription) => {
    await toggleSubscription(sub.id, !sub.enabled);
  };

  // Manual node operations
  const handleOpenAddNode = () => {
    setEditingNode(null);
    setNodeForm(defaultNode);
    setNodeEnabled(true);
    setNodeUrl('');
    setParseError('');
    onNodeOpen();
  };

  const handleOpenEditNode = (mn: ManualNode) => {
    setEditingNode(mn);
    setNodeForm(mn.node);
    setNodeEnabled(mn.enabled);
    setNodeUrl('');
    setParseError('');
    onNodeOpen();
  };

  // Parse node link
  const handleParseUrl = async () => {
    if (!nodeUrl.trim()) return;

    setIsParsing(true);
    setParseError('');

    try {
      const response = await nodeApi.parse(nodeUrl.trim());
      const parsedNode = response.data.data as Node;
      setNodeForm(parsedNode);
    } catch (error: any) {
      const message = error.response?.data?.error || 'Failed to parse, please check the link format';
      setParseError(message);
    } finally {
      setIsParsing(false);
    }
  };

  const handleSaveNode = async () => {
    if (!nodeForm.tag || !nodeForm.server) return;

    setIsSubmitting(true);
    try {
      const country = countryOptions.find(c => c.code === nodeForm.country);
      const nodeData = {
        ...nodeForm,
        country_emoji: country?.emoji || '🌐',
      };

      if (editingNode) {
        await updateManualNode(editingNode.id, { node: nodeData, enabled: nodeEnabled });
      } else {
        await addManualNode({ node: nodeData, enabled: nodeEnabled });
      }
      onNodeClose();
    } catch (error) {
      console.error('Failed to save node:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

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

  // Bulk add operations
  const handleOpenBulkAdd = () => {
    setBulkUrls('');
    setBulkGroupTag('');
    setBulkResults([]);
    setBulkParsing(false);
    setBulkAdding(false);
    onBulkOpen();
  };

  const handleBulkParse = async () => {
    const urls = bulkUrls.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    if (urls.length === 0) return;

    setBulkParsing(true);
    try {
      const response = await nodeApi.parseBulk(urls);
      setBulkResults(response.data.data);
    } catch (error: any) {
      console.error('Failed to parse URLs:', error);
    } finally {
      setBulkParsing(false);
    }
  };

  const handleBulkAdd = async () => {
    const successNodes = bulkResults.filter(r => r.node);
    if (successNodes.length === 0) return;

    setBulkAdding(true);
    try {
      const nodes = successNodes.map(r => ({
        node: r.node!,
        enabled: true,
      }));
      await addManualNodesBulk(nodes, bulkGroupTag.trim() || undefined);
      onBulkClose();
    } catch (error: any) {
      console.error('Failed to add nodes:', error);
    } finally {
      setBulkAdding(false);
    }
  };

  // Filter operations
  const handleOpenAddFilter = () => {
    setEditingFilter(null);
    setFilterForm(defaultFilterForm);
    onFilterOpen();
  };

  const handleOpenEditFilter = (filter: Filter) => {
    setEditingFilter(filter);
    setFilterForm({
      name: filter.name,
      include: filter.include || [],
      exclude: filter.exclude || [],
      include_countries: filter.include_countries || [],
      exclude_countries: filter.exclude_countries || [],
      mode: filter.mode || 'urltest',
      urltest_config: filter.urltest_config || {
        url: 'https://www.gstatic.com/generate_204',
        interval: '5m',
        tolerance: 50,
      },
      subscriptions: filter.subscriptions || [],
      all_nodes: filter.all_nodes ?? true,
      enabled: filter.enabled,
    });
    onFilterOpen();
  };

  const handleSaveFilter = async () => {
    if (!filterForm.name) return;

    setIsSubmitting(true);
    try {
      if (editingFilter) {
        await updateFilter(editingFilter.id, filterForm);
      } else {
        await addFilter(filterForm);
      }
      onFilterClose();
    } catch (error) {
      console.error('Failed to save filter:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteFilter = async (id: string) => {
    if (confirm('Are you sure you want to delete this filter?')) {
      await deleteFilter(id);
    }
  };

  const handleToggleFilter = async (filter: Filter) => {
    await toggleFilter(filter.id, !filter.enabled);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Node Management</h1>
        <div className="flex gap-2">
          <Button
            color="warning"
            variant="flat"
            startContent={healthChecking ? <Spinner size="sm" /> : <Activity className="w-4 h-4" />}
            onPress={() => checkAllNodesHealth()}
            isDisabled={healthChecking}
          >
            Check All
          </Button>
          <Button
            color="secondary"
            variant="flat"
            startContent={<FilterIcon className="w-4 h-4" />}
            onPress={handleOpenAddFilter}
          >
            Add Filter
          </Button>
          <Button
            color="primary"
            variant="flat"
            startContent={<Plus className="w-4 h-4" />}
            onPress={handleOpenAddNode}
          >
            Add Node
          </Button>
          <Button
            color="primary"
            variant="flat"
            startContent={<List className="w-4 h-4" />}
            onPress={handleOpenBulkAdd}
          >
            Bulk Add
          </Button>
          <Button
            color="primary"
            startContent={<Plus className="w-4 h-4" />}
            onPress={handleOpenAddSubscription}
          >
            Add Subscription
          </Button>
        </div>
      </div>

      <Tabs aria-label="Node Management" defaultSelectedKey="manual">
        <Tab key="manual" title={<span>Manual Nodes{manualNodes.length > 0 && <span className="ml-1.5 text-xs opacity-60">({manualNodes.length})</span>}</span>}>
          {manualNodes.length === 0 ? (
            <Card className="mt-4">
              <CardBody className="py-12 text-center">
                <Server className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">No manual nodes yet, click the button above to add one</p>
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-3 mt-4">
              <div className="flex justify-between items-center">
                {manualNodeTags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
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
                      <Chip
                        key={tag}
                        variant={selectedGroupTag === tag ? 'solid' : 'flat'}
                        color="secondary"
                        className="cursor-pointer"
                        onClick={() => setSelectedGroupTag(tag)}
                      >
                        {tag} ({manualNodes.filter(n => n.group_tag === tag).length})
                      </Chip>
                    ))}
                  </div>
                )}
                <Button
                  size="sm"
                  variant="flat"
                  startContent={copiedAll ? <ClipboardCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  color={copiedAll ? 'success' : 'default'}
                  onPress={handleCopyAllNodes}
                >
                  {copiedAll ? 'Copied!' : 'Copy All'}
                </Button>
              </div>
              {(selectedGroupTag === null
                ? manualNodes
                : selectedGroupTag === ''
                  ? manualNodes.filter(n => !n.group_tag)
                  : manualNodes.filter(n => n.group_tag === selectedGroupTag)
              ).map((mn) => (
                <Card key={mn.id}>
                  <CardBody className="flex flex-row items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{mn.node.country_emoji || '🌐'}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium">{mn.node.tag}</h3>
                          {mn.group_tag && (
                            <Chip size="sm" variant="flat" color="secondary">{mn.group_tag}</Chip>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">{mn.node.type} • {mn.node.server}:{mn.node.server_port}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <NodeHealthChips tag={mn.node.tag} healthResults={healthResults} healthMode={healthMode} />
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
                        onPress={() => handleCopyNode(mn.id)}
                        title="Copy node link"
                      >
                        {copiedNodeId === mn.id ? <ClipboardCheck className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                      </Button>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        onPress={() => handleOpenEditNode(mn)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        color="danger"
                        onPress={() => handleDeleteNode(mn.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                      <Switch
                        isSelected={mn.enabled}
                        onValueChange={() => handleToggleNode(mn)}
                      />
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </Tab>

        <Tab key="subscriptions" title={<span>Subscriptions{subscriptions.length > 0 && <span className="ml-1.5 text-xs opacity-60">({subscriptions.length})</span>}</span>}>
          {subscriptions.length === 0 ? (
            <Card className="mt-4">
              <CardBody className="py-12 text-center">
                <Globe className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">No subscriptions yet, click the button above to add one</p>
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-4 mt-4">
              {subscriptions.map((sub) => (
                <SubscriptionCard
                  key={sub.id}
                  subscription={sub}
                  onRefresh={() => handleRefresh(sub.id)}
                  onEdit={() => handleOpenEditSubscription(sub)}
                  onDelete={() => handleDeleteSubscription(sub.id)}
                  onToggle={() => handleToggleSubscription(sub)}
                  loading={loading}
                  healthResults={healthResults}
                  healthMode={healthMode}
                  healthCheckingNodes={healthCheckingNodes}
                  onHealthCheck={checkSingleNodeHealth}
                />
              ))}
            </div>
          )}
        </Tab>

        <Tab key="filters" title={<span>Filters{filters.length > 0 && <span className="ml-1.5 text-xs opacity-60">({filters.length})</span>}</span>}>
          {filters.length === 0 ? (
            <Card className="mt-4">
              <CardBody className="py-12 text-center">
                <FilterIcon className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">No filters yet, click the button above to add one</p>
                <p className="text-xs text-gray-400 mt-2">
                  Filters allow you to filter nodes by country or keywords, and create custom node groups
                </p>
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-3 mt-4">
              {filters.map((filter) => (
                <Card key={filter.id}>
                  <CardBody className="flex flex-row items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FilterIcon className="w-5 h-5 text-secondary" />
                      <div>
                        <h3 className="font-medium">{filter.name}</h3>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {filter.include_countries?.length > 0 && (
                            <Chip size="sm" variant="flat" color="success">
                              {filter.include_countries.map(code =>
                                countryOptions.find(c => c.code === code)?.emoji || code
                              ).join(' ')} Include
                            </Chip>
                          )}
                          {filter.exclude_countries?.length > 0 && (
                            <Chip size="sm" variant="flat" color="danger">
                              {filter.exclude_countries.map(code =>
                                countryOptions.find(c => c.code === code)?.emoji || code
                              ).join(' ')} Exclude
                            </Chip>
                          )}
                          {filter.include?.length > 0 && (
                            <Chip size="sm" variant="flat">
                              Keywords: {filter.include.join('|')}
                            </Chip>
                          )}
                          <Chip size="sm" variant="flat" color="secondary">
                            {filter.mode === 'urltest' ? 'Auto Speed Test' : 'Manual Select'}
                          </Chip>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        onPress={() => handleOpenEditFilter(filter)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        color="danger"
                        onPress={() => handleDeleteFilter(filter.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                      <Switch
                        isSelected={filter.enabled}
                        onValueChange={() => handleToggleFilter(filter)}
                      />
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </Tab>

        <Tab key="countries" title={<span>By Country/Region{countryGroups.length > 0 && <span className="ml-1.5 text-xs opacity-60">({countryGroups.length})</span>}</span>}>
          {countryGroups.length === 0 ? (
            <Card className="mt-4">
              <CardBody className="py-12 text-center">
                <Globe className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">No nodes yet, please add a subscription or manually add nodes first</p>
              </CardBody>
            </Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
              {countryGroups.map((group) => (
                <Card key={group.code} className="hover:shadow-md transition-shadow">
                  <CardBody className="flex flex-row items-center gap-3">
                    <span className="text-3xl">{group.emoji}</span>
                    <div>
                      <h3 className="font-semibold">{group.name}</h3>
                      <p className="text-sm text-gray-500">{group.node_count} nodes</p>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </Tab>
      </Tabs>

      {/* Add/Edit Subscription Modal */}
      <Modal isOpen={isSubOpen} onClose={onSubClose}>
        <ModalContent>
          <ModalHeader>{editingSubscription ? 'Edit Subscription' : 'Add Subscription'}</ModalHeader>
          <ModalBody>
            <Input
              label="Subscription Name"
              placeholder="Enter subscription name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              label="Subscription URL"
              placeholder="Enter subscription URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onSubClose}>
              Cancel
            </Button>
            <Button
              color="primary"
              onPress={handleSaveSubscription}
              isLoading={isSubmitting}
              isDisabled={!name || !url}
            >
              {editingSubscription ? 'Save' : 'Add'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Add/Edit Node Modal */}
      <Modal isOpen={isNodeOpen} onClose={onNodeClose} size="lg">
        <ModalContent>
          <ModalHeader>{editingNode ? 'Edit Node' : 'Add Node'}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {/* Node Link Input - Only shown in add mode */}
              {!editingNode && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      label="Node Link"
                      placeholder="Paste node link, e.g. hysteria2://... vmess://... ss://... socks://..."
                      value={nodeUrl}
                      onChange={(e) => setNodeUrl(e.target.value)}
                      startContent={<Link className="w-4 h-4 text-gray-400" />}
                      className="flex-1"
                    />
                    <Button
                      color="primary"
                      variant="flat"
                      onPress={handleParseUrl}
                      isLoading={isParsing}
                      isDisabled={!nodeUrl.trim()}
                      className="self-end"
                    >
                      Parse
                    </Button>
                  </div>
                  {parseError && (
                    <p className="text-sm text-danger">{parseError}</p>
                  )}
                  <p className="text-xs text-gray-400">
                    Supported protocols: ss://, vmess://, vless://, trojan://, hysteria2://, tuic://, socks://
                  </p>
                </div>
              )}

              {/* Display node info after parsing */}
              {nodeForm.tag && (
                <Card className="bg-default-100">
                  <CardBody className="py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{nodeForm.country_emoji || '🌐'}</span>
                      <div className="flex-1">
                        <h4 className="font-medium">{nodeForm.tag}</h4>
                        <p className="text-sm text-gray-500">
                          {nodeForm.type} · {nodeForm.server}:{nodeForm.server_port}
                        </p>
                      </div>
                      <Chip size="sm" variant="flat" color="success">Parsed</Chip>
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* Manual edit area - collapsible */}
              <Accordion variant="bordered" selectionMode="multiple">
                <AccordionItem key="manual" aria-label="Manual Edit" title="Manually Edit Node Info">
                  <div className="space-y-4 pb-2">
                    <Input
                      label="Node Name"
                      placeholder="e.g.: Hong Kong-01"
                      value={nodeForm.tag}
                      onChange={(e) => setNodeForm({ ...nodeForm, tag: e.target.value })}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <Select
                        label="Node Type"
                        selectedKeys={[nodeForm.type]}
                        onChange={(e) => setNodeForm({ ...nodeForm, type: e.target.value })}
                      >
                        {nodeTypeOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </Select>

                      <Select
                        label="Country/Region"
                        selectedKeys={[nodeForm.country || 'HK']}
                        onChange={(e) => {
                          const country = countryOptions.find(c => c.code === e.target.value);
                          setNodeForm({
                            ...nodeForm,
                            country: e.target.value,
                            country_emoji: country?.emoji || '🌐',
                          });
                        }}
                      >
                        {countryOptions.map((opt) => (
                          <SelectItem key={opt.code} value={opt.code}>
                            {opt.emoji} {opt.name}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        label="Server Address"
                        placeholder="example.com"
                        value={nodeForm.server}
                        onChange={(e) => setNodeForm({ ...nodeForm, server: e.target.value })}
                      />

                      <Input
                        type="number"
                        label="Port"
                        placeholder="443"
                        value={String(nodeForm.server_port)}
                        onChange={(e) => setNodeForm({ ...nodeForm, server_port: parseInt(e.target.value) || 443 })}
                      />
                    </div>
                  </div>
                </AccordionItem>
              </Accordion>

              <div className="flex items-center justify-between">
                <span>Enable Node</span>
                <Switch
                  isSelected={nodeEnabled}
                  onValueChange={setNodeEnabled}
                />
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onNodeClose}>
              Cancel
            </Button>
            <Button
              color="primary"
              onPress={handleSaveNode}
              isLoading={isSubmitting}
              isDisabled={!nodeForm.tag || !nodeForm.server}
            >
              {editingNode ? 'Save' : 'Add'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Bulk Add Nodes Modal */}
      <Modal isOpen={isBulkOpen} onClose={onBulkClose} size="2xl">
        <ModalContent>
          <ModalHeader>Bulk Add Nodes</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <Textarea
                label="Node Links"
                placeholder={"Paste node links, one per line:\nhysteria2://...\nvmess://...\nss://..."}
                value={bulkUrls}
                onChange={(e) => setBulkUrls(e.target.value)}
                minRows={5}
                maxRows={10}
              />
              <Input
                label="Group Tag (optional)"
                placeholder="e.g.: work, gaming, streaming"
                value={bulkGroupTag}
                onChange={(e) => setBulkGroupTag(e.target.value)}
                description="Tag for filtering these nodes later"
              />
              <div className="flex justify-between items-center">
                <p className="text-xs text-gray-400">
                  Supported: ss://, vmess://, vless://, trojan://, hysteria2://, tuic://, socks://
                </p>
                <Button
                  color="primary"
                  variant="flat"
                  onPress={handleBulkParse}
                  isLoading={bulkParsing}
                  isDisabled={!bulkUrls.trim()}
                >
                  Parse All
                </Button>
              </div>

              {bulkResults.length > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <p className="text-sm font-medium">
                      Results: {bulkResults.filter(r => r.node).length} parsed, {bulkResults.filter(r => r.error).length} failed
                    </p>
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {bulkResults.map((result, idx) => (
                      <Card key={idx} className={result.error ? 'bg-danger-50' : 'bg-default-100'}>
                        <CardBody className="py-2 px-3">
                          {result.node ? (
                            <div className="flex items-center gap-3">
                              <span className="text-xl">{result.node.country_emoji || '🌐'}</span>
                              <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-sm truncate">{result.node.tag}</h4>
                                <p className="text-xs text-gray-500 truncate">
                                  {result.node.type} · {result.node.server}:{result.node.server_port}
                                </p>
                              </div>
                              <Chip size="sm" variant="flat" color="success">OK</Chip>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-500 truncate">{result.url}</p>
                                <p className="text-xs text-danger">{result.error}</p>
                              </div>
                              <Chip size="sm" variant="flat" color="danger">Error</Chip>
                            </div>
                          )}
                        </CardBody>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onBulkClose}>
              Cancel
            </Button>
            <Button
              color="primary"
              onPress={handleBulkAdd}
              isLoading={bulkAdding}
              isDisabled={bulkResults.filter(r => r.node).length === 0}
            >
              Add {bulkResults.filter(r => r.node).length || ''} Nodes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Add/Edit Filter Modal */}
      <Modal isOpen={isFilterOpen} onClose={onFilterClose} size="2xl">
        <ModalContent>
          <ModalHeader>{editingFilter ? 'Edit Filter' : 'Add Filter'}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {/* Filter Name */}
              <Input
                label="Filter Name"
                placeholder="e.g.: Japan High Speed Nodes, TikTok Dedicated"
                value={filterForm.name}
                onChange={(e) => setFilterForm({ ...filterForm, name: e.target.value })}
                isRequired
              />
              {/* Include Countries */}
              <Select
                label="Include Countries"
                placeholder="Select countries to include (multiple selection)"
                selectionMode="multiple"
                selectedKeys={filterForm.include_countries}
                onSelectionChange={(keys) => {
                  setFilterForm({
                    ...filterForm,
                    include_countries: Array.from(keys) as string[]
                  })
                }}
              >
                {countryOptions.map((opt) => (
                  <SelectItem key={opt.code} value={opt.code}>
                    {opt.name}
                  </SelectItem>
                ))}
              </Select>

              {/* Exclude Countries */}
              <Select
                label="Exclude Countries"
                placeholder="Select countries to exclude (multiple selection)"
                selectionMode="multiple"
                selectedKeys={filterForm.exclude_countries}
                onSelectionChange={(keys) => setFilterForm({
                  ...filterForm,
                  exclude_countries: Array.from(keys) as string[]
                })}
              >
                {countryOptions.map((opt) => (
                  <SelectItem key={opt.code} value={opt.code}>
                    {opt.name}
                  </SelectItem>
                ))}
              </Select>

              {/* Include Keywords */}
              <Input
                label="Include Keywords"
                placeholder="Separated by |, e.g.: high-speed|IPLC|dedicated"
                value={filterForm.include.join('|')}
                onChange={(e) => setFilterForm({
                  ...filterForm,
                  include: e.target.value ? e.target.value.split('|').filter(Boolean) : []
                })}
              />

              {/* Exclude Keywords */}
              <Input
                label="Exclude Keywords"
                placeholder="Separated by |, e.g.: expired|maintenance|slow"
                value={filterForm.exclude.join('|')}
                onChange={(e) => setFilterForm({
                  ...filterForm,
                  exclude: e.target.value ? e.target.value.split('|').filter(Boolean) : []
                })}
              />

              {/* Apply to All Nodes Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">Apply to All Nodes</span>
                  <p className="text-xs text-gray-400">When enabled, will match nodes from all subscriptions</p>
                </div>
                <Switch
                  isSelected={filterForm.all_nodes}
                  onValueChange={(checked) => setFilterForm({ ...filterForm, all_nodes: checked })}
                />
              </div>

              {/* Mode Selection */}
              <Select
                label="Mode"
                selectedKeys={[filterForm.mode]}
                onChange={(e) => setFilterForm({ ...filterForm, mode: e.target.value })}
              >
                <SelectItem key="urltest" value="urltest">
                  Auto Speed Test (urltest)
                </SelectItem>
                <SelectItem key="selector" value="selector">
                  Manual Select (selector)
                </SelectItem>
              </Select>

              {/* urltest Configuration */}
              {filterForm.mode === 'urltest' && (
                <Card className="bg-default-50">
                  <CardBody className="space-y-3">
                    <h4 className="font-medium text-sm">Speed Test Configuration</h4>
                    <Input
                      label="Speed Test URL"
                      placeholder="https://www.gstatic.com/generate_204"
                      value={filterForm.urltest_config?.url || ''}
                      onChange={(e) => setFilterForm({
                        ...filterForm,
                        urltest_config: { ...filterForm.urltest_config!, url: e.target.value }
                      })}
                      size="sm"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="Speed Test Interval"
                        placeholder="5m"
                        value={filterForm.urltest_config?.interval || ''}
                        onChange={(e) => setFilterForm({
                          ...filterForm,
                          urltest_config: { ...filterForm.urltest_config!, interval: e.target.value }
                        })}
                        size="sm"
                      />
                      <Input
                        type="number"
                        label="Tolerance Threshold (ms)"
                        placeholder="50"
                        value={String(filterForm.urltest_config?.tolerance || 50)}
                        onChange={(e) => setFilterForm({
                          ...filterForm,
                          urltest_config: { ...filterForm.urltest_config!, tolerance: parseInt(e.target.value) || 50 }
                        })}
                        size="sm"
                      />
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* Enable Filter Toggle */}
              <div className="flex items-center justify-between">
                <span>Enable Filter</span>
                <Switch
                  isSelected={filterForm.enabled}
                  onValueChange={(checked) => setFilterForm({ ...filterForm, enabled: checked })}
                />
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onFilterClose}>
              Cancel
            </Button>
            <Button
              color="primary"
              onPress={handleSaveFilter}
              isLoading={isSubmitting}
              isDisabled={!filterForm.name}
            >
              {editingFilter ? 'Save' : 'Add'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// NodeHealthChips component to display health check results for a node
function NodeHealthChips({ tag, healthResults, healthMode }: {
  tag: string;
  healthResults: Record<string, NodeHealthResult>;
  healthMode: 'clash_api' | 'clash_api_temp' | 'tcp' | null;
}) {
  const result = healthResults[tag];
  if (!result) return null;

  if ((healthMode === 'clash_api' || healthMode === 'clash_api_temp') && Object.keys(result.groups).length > 0) {
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {Object.entries(result.groups).map(([group, delay]) => (
          <Chip
            key={group}
            size="sm"
            variant="flat"
            color={delay > 0 ? (delay < 300 ? 'success' : 'warning') : 'danger'}
          >
            {group}: {delay > 0 ? `${delay}ms` : 'Timeout'}
          </Chip>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      <Chip
        size="sm"
        variant="flat"
        color={result.alive ? (result.tcp_latency_ms < 300 ? 'success' : 'warning') : 'danger'}
      >
        {result.alive ? `TCP: ${result.tcp_latency_ms}ms` : 'Timeout'}
      </Chip>
    </div>
  );
}

interface SubscriptionCardProps {
  subscription: Subscription;
  onRefresh: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  loading: boolean;
  healthResults: Record<string, NodeHealthResult>;
  healthMode: 'clash_api' | 'clash_api_temp' | 'tcp' | null;
  healthCheckingNodes: string[];
  onHealthCheck: (tag: string) => void;
}

function SubscriptionCard({ subscription: sub, onRefresh, onEdit, onDelete, onToggle, loading, healthResults, healthMode, healthCheckingNodes, onHealthCheck }: SubscriptionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Ensure nodes is an array, handle null or undefined cases
  const nodes = sub.nodes || [];

  // Group nodes by country
  const nodesByCountry = nodes.reduce((acc, node) => {
    const country = node.country || 'OTHER';
    if (!acc[country]) {
      acc[country] = {
        emoji: node.country_emoji || '🌐',
        nodes: [],
      };
    }
    acc[country].nodes.push(node);
    return acc;
  }, {} as Record<string, { emoji: string; nodes: Node[] }>);

  return (
    <Card>
      <CardHeader
        className="flex justify-between items-start cursor-pointer"
        onClick={(e) => {
          // If clicking a button, don't trigger expand
          if ((e.target as HTMLElement).closest('button')) return;
          setIsExpanded(!isExpanded);
        }}
      >
        <div className="flex items-center gap-3">
          <Chip
            color={sub.enabled ? 'success' : 'default'}
            variant="flat"
            size="sm"
          >
            {sub.enabled ? 'Enabled' : 'Disabled'}
          </Chip>
          <div>
            <h3 className="text-lg font-semibold">{sub.name}</h3>
            <p className="text-sm text-gray-500">
              {sub.node_count} nodes · Updated at {new Date(sub.updated_at).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <Button
            size="sm"
            variant="flat"
            startContent={loading ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />}
            onPress={onRefresh}
            isDisabled={loading}
          >
            Refresh
          </Button>
          <Button
            size="sm"
            variant="flat"
            startContent={<Pencil className="w-4 h-4" />}
            onPress={onEdit}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="flat"
            color="danger"
            startContent={<Trash2 className="w-4 h-4" />}
            onPress={onDelete}
          >
            Delete
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            onPress={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
          <Switch
            isSelected={sub.enabled}
            onValueChange={onToggle}
          />
        </div>
      </CardHeader>

      {isExpanded && (
        <CardBody className="pt-0">
          {/* Traffic Information */}
          {sub.traffic && (
            <div className="flex gap-4 text-sm mb-4">
              <span>Used: {formatBytes(sub.traffic.used)}</span>
              <span>Remaining: {formatBytes(sub.traffic.remaining)}</span>
              <span>Total: {formatBytes(sub.traffic.total)}</span>
              {sub.expire_at && (
                <span>Expires: {new Date(sub.expire_at).toLocaleDateString()}</span>
              )}
            </div>
          )}

          {/* Node list grouped by country */}
          <Accordion variant="bordered" selectionMode="multiple">
            {Object.entries(nodesByCountry).map(([country, data]) => (
              <AccordionItem
                key={country}
                aria-label={country}
                title={
                  <div className="flex items-center gap-2">
                    <span>{data.emoji}</span>
                    <span>{country}</span>
                    <Chip size="sm" variant="flat">{data.nodes.length}</Chip>
                  </div>
                }
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {data.nodes.map((node, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded text-sm"
                    >
                      <span className="truncate flex-1 min-w-0">
                        <span className="block truncate">{node.tag}</span>
                        <NodeHealthChips tag={node.tag} healthResults={healthResults} healthMode={healthMode} />
                      </span>
                      <Chip size="sm" variant="flat">
                        {node.type}
                      </Chip>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        color="warning"
                        onPress={() => onHealthCheck(node.tag)}
                        isDisabled={healthCheckingNodes.includes(node.tag)}
                      >
                        {healthCheckingNodes.includes(node.tag) ? (
                          <Spinner size="sm" />
                        ) : (
                          <Activity className="w-3 h-3" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </AccordionItem>
            ))}
          </Accordion>
        </CardBody>
      )}
    </Card>
  );
}
