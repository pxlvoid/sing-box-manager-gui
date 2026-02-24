import { useEffect, useMemo, useState } from 'react';
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
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Pagination,
  Tooltip,
  Checkbox,
} from '@nextui-org/react';
import { Plus, RefreshCw, Trash2, Globe, Server, Pencil, Link, Filter as FilterIcon, ChevronDown, ChevronUp, List, Activity, Copy, ClipboardCheck, Download, ClipboardPaste, AlertTriangle, Search, ArrowUp, ArrowDown, FolderInput, X, ToggleLeft, ToggleRight } from 'lucide-react';
import { useStore } from '../store';
import { nodeApi, manualNodeApi, subscriptionApi } from '../api';
import { toast } from '../components/Toast';
import type { Subscription, ManualNode, Node, Filter, NodeHealthResult, UnsupportedNodeInfo } from '../store';

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
  extra: {},
};

const ssMethodOptions = [
  'aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305',
  'none',
];

const vmessSecurityOptions = ['auto', 'aes-128-gcm', 'chacha20-poly1305', 'none', 'zero'];

const flowOptions = ['', 'xtls-rprx-vision'];

const transportTypeOptions = ['tcp', 'ws', 'http', 'h2', 'grpc', 'quic'];

const utlsFingerprintOptions = [
  '', 'chrome', 'firefox', 'safari', 'ios', 'android', 'edge', '360', 'qq', 'random', 'randomized',
];

const congestionControlOptions = ['bbr', 'cubic', 'new_reno'];

const protocolsWithTls = ['vmess', 'vless', 'trojan', 'hysteria2', 'tuic'];
const protocolsWithTransport = ['vmess', 'vless', 'trojan'];

// Known extra keys per protocol — everything else goes to "Other"
const knownExtraKeys: Record<string, string[]> = {
  shadowsocks: ['method', 'password', 'network'],
  vmess: ['uuid', 'alter_id', 'security', 'tls', 'transport'],
  vless: ['uuid', 'flow', 'packet_encoding', 'tls', 'transport'],
  trojan: ['password', 'flow', 'tls', 'transport'],
  hysteria2: ['password', 'up_mbps', 'down_mbps', 'obfs', 'tls', 'ports', 'hop_interval'],
  tuic: ['uuid', 'password', 'congestion_control', 'udp_relay_mode', 'zero_rtt_handshake', 'heartbeat', 'tls'],
  socks: ['version', 'username', 'password', 'udp_over_tcp'],
};

interface UnifiedNode {
  key: string;
  node: Node;
  source: 'manual' | 'subscription';
  sourceName: string;
  sourceId: string;
  enabled: boolean;
  groupTag?: string;
  manualNodeId?: string;
  isUnsupported: boolean;
}

type HealthFilter = 'all' | 'alive' | 'timeout' | 'unchecked';
type SortColumn = 'name' | 'type' | 'source' | 'latency';
type SortDirection = 'asc' | 'desc';
interface SortConfig {
  column: SortColumn | null;
  direction: SortDirection;
}

function getNodeLatency(tag: string, healthResults: Record<string, NodeHealthResult>, healthMode: string | null): number | null {
  const result = healthResults[tag];
  if (!result) return null;
  if ((healthMode === 'clash_api' || healthMode === 'clash_api_temp') && Object.keys(result.groups).length > 0) {
    const delays = Object.values(result.groups).filter(d => d > 0);
    if (delays.length === 0) return result.alive ? 0 : -1;
    return Math.min(...delays);
  }
  return result.alive ? result.tcp_latency_ms : -1;
}

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
    unsupportedNodes,
    fetchUnsupportedNodes,
    recheckUnsupportedNodes,
    deleteUnsupportedNodes,
  } = useStore();

  const { isOpen: isSubOpen, onOpen: onSubOpen, onClose: onSubClose } = useDisclosure();
  const { isOpen: isNodeOpen, onOpen: onNodeOpen, onClose: onNodeClose } = useDisclosure();
  const { isOpen: isBulkOpen, onOpen: onBulkOpen, onClose: onBulkClose } = useDisclosure();
  const { isOpen: isFilterOpen, onOpen: onFilterOpen, onClose: onFilterClose } = useDisclosure();
  const { isOpen: isExportOpen, onOpen: onExportOpen, onClose: onExportClose } = useDisclosure();
  const { isOpen: isImportOpen, onOpen: onImportOpen, onClose: onImportClose } = useDisclosure();
  const { isOpen: isCountryOpen, onOpen: onCountryOpen, onClose: onCountryClose } = useDisclosure();
  const [selectedCountry, setSelectedCountry] = useState<{ code: string; name: string; emoji: string } | null>(null);
  const [countryNodes, setCountryNodes] = useState<Node[]>([]);
  const [countryNodesLoading, setCountryNodesLoading] = useState(false);
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

  // Export/Import state
  const [exportData, setExportData] = useState<{ subscriptions: { name: string; url: string }[]; manual_nodes: string[] } | null>(null);
  const [importData, setImportData] = useState<{ subscriptions: { name: string; url: string }[]; manual_nodes: string[] } | null>(null);
  const [importing, setImporting] = useState(false);

  // Unified tab state
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: null, direction: 'asc' });
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [unifiedPage, setUnifiedPage] = useState(1);
  const UNIFIED_PAGE_SIZE = 50;

  const handleColumnSort = (column: SortColumn) => {
    setSortConfig(prev => {
      if (prev.column === column) {
        if (prev.direction === 'asc') return { column, direction: 'desc' };
        return { column: null, direction: 'asc' }; // reset
      }
      return { column, direction: 'asc' };
    });
  };

  const unifiedNodes = useMemo(() => {
    const result: UnifiedNode[] = [];
    for (const mn of manualNodes) {
      result.push({
        key: `manual::${mn.id}`,
        node: mn.node,
        source: 'manual',
        sourceName: 'Manual',
        sourceId: mn.id,
        enabled: mn.enabled,
        groupTag: mn.group_tag,
        manualNodeId: mn.id,
        isUnsupported: unsupportedNodes.some(u => u.tag === mn.node.tag),
      });
    }
    for (const sub of subscriptions) {
      if (!sub.enabled) continue;
      for (const node of (sub.nodes || [])) {
        result.push({
          key: `sub::${sub.id}::${node.tag}`,
          node,
          source: 'subscription',
          sourceName: sub.name,
          sourceId: sub.id,
          enabled: true,
          isUnsupported: unsupportedNodes.some(u => u.tag === node.tag),
        });
      }
    }
    return result;
  }, [manualNodes, subscriptions, unsupportedNodes]);

  const filteredAndSortedNodes = useMemo(() => {
    let nodes = [...unifiedNodes];

    if (sourceFilter === 'manual') {
      nodes = nodes.filter(n => n.source === 'manual');
    } else if (sourceFilter !== 'all') {
      nodes = nodes.filter(n => n.source === 'subscription' && n.sourceId === sourceFilter);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      nodes = nodes.filter(n =>
        n.node.tag.toLowerCase().includes(q) ||
        n.node.server.toLowerCase().includes(q) ||
        n.sourceName.toLowerCase().includes(q)
      );
    }

    if (healthFilter !== 'all') {
      nodes = nodes.filter(n => {
        const result = healthResults[n.node.tag];
        if (healthFilter === 'unchecked') return !result;
        if (healthFilter === 'alive') return result?.alive === true;
        if (healthFilter === 'timeout') return result && !result.alive;
        return true;
      });
    }

    if (sortConfig.column) {
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      nodes.sort((a, b) => {
        switch (sortConfig.column) {
          case 'name':
            return dir * a.node.tag.localeCompare(b.node.tag);
          case 'type':
            return dir * a.node.type.localeCompare(b.node.type);
          case 'source':
            return dir * a.sourceName.localeCompare(b.sourceName);
          case 'latency': {
            const la = getNodeLatency(a.node.tag, healthResults, healthMode);
            const lb = getNodeLatency(b.node.tag, healthResults, healthMode);
            if (la === null && lb === null) return 0;
            if (la === null) return 1;
            if (lb === null) return -1;
            if (la === -1 && lb === -1) return 0;
            if (la === -1) return 1;
            if (lb === -1) return -1;
            return dir * (la - lb);
          }
          default:
            return 0;
        }
      });
    }

    return nodes;
  }, [unifiedNodes, sourceFilter, searchQuery, healthFilter, sortConfig, healthResults, healthMode]);

  const unifiedTotalPages = Math.max(1, Math.ceil(filteredAndSortedNodes.length / UNIFIED_PAGE_SIZE));
  const paginatedNodes = filteredAndSortedNodes.slice(
    (unifiedPage - 1) * UNIFIED_PAGE_SIZE,
    unifiedPage * UNIFIED_PAGE_SIZE
  );

  // Selection state
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());

  const selectedUnified = useMemo(() =>
    paginatedNodes.filter(n => selectedNodes.has(n.key)),
    [paginatedNodes, selectedNodes]
  );
  const selectedManualNodes = useMemo(() =>
    selectedUnified.filter(n => n.source === 'manual'),
    [selectedUnified]
  );
  const selectedSubNodes = useMemo(() =>
    selectedUnified.filter(n => n.source === 'subscription'),
    [selectedUnified]
  );

  const allPageSelected = paginatedNodes.length > 0 && paginatedNodes.every(n => selectedNodes.has(n.key));
  const somePageSelected = paginatedNodes.some(n => selectedNodes.has(n.key));

  const handleToggleSelectAll = () => {
    setSelectedNodes(prev => {
      const next = new Set(prev);
      if (allPageSelected) {
        paginatedNodes.forEach(n => next.delete(n.key));
      } else {
        paginatedNodes.forEach(n => next.add(n.key));
      }
      return next;
    });
  };

  const handleToggleSelect = (key: string) => {
    setSelectedNodes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleBulkHealthCheck = async () => {
    for (const un of selectedUnified) {
      checkSingleNodeHealth(un.node.tag);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedManualNodes.length === 0) return;
    if (!confirm(`Delete ${selectedManualNodes.length} manual node(s)?`)) return;
    for (const un of selectedManualNodes) {
      if (un.manualNodeId) await deleteManualNode(un.manualNodeId);
    }
    setSelectedNodes(new Set());
  };

  const handleBulkToggle = async (enabled: boolean) => {
    for (const un of selectedManualNodes) {
      const mn = manualNodes.find(m => m.id === un.manualNodeId);
      if (mn) await updateManualNode(mn.id, { ...mn, enabled });
    }
  };

  const handleBulkCopyToManual = async () => {
    for (const un of selectedSubNodes) {
      try {
        await addManualNode({ node: un.node, enabled: true });
      } catch (error) {
        console.error('Failed to copy node:', error);
      }
    }
    setSelectedNodes(new Set());
  };

  // Reset selection and page when filters change
  useEffect(() => {
    setUnifiedPage(1);
    setSelectedNodes(new Set());
  }, [sourceFilter, searchQuery, healthFilter, sortConfig]);

  useEffect(() => {
    fetchSubscriptions();
    fetchManualNodes();
    fetchCountryGroups();
    fetchFilters();
    fetchManualNodeTags();
    fetchUnsupportedNodes();
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

  // Helpers for reading/writing nested extra fields
  const getExtra = (...keys: string[]): any => {
    let obj: any = nodeForm.extra;
    for (const key of keys) {
      if (obj == null) return undefined;
      obj = obj[key];
    }
    return obj;
  };

  const setExtra = (...args: any[]) => {
    const value = args.pop();
    const keys: string[] = args;
    const extra = { ...nodeForm.extra } as Record<string, any>;

    if (keys.length === 1) {
      if (value === '' || value === undefined) {
        delete extra[keys[0]];
      } else {
        extra[keys[0]] = value;
      }
    } else if (keys.length === 2) {
      const nested = { ...(extra[keys[0]] || {}) };
      if (value === '' || value === undefined) {
        delete nested[keys[1]];
      } else {
        nested[keys[1]] = value;
      }
      if (Object.keys(nested).length === 0) {
        delete extra[keys[0]];
      } else {
        extra[keys[0]] = nested;
      }
    } else if (keys.length === 3) {
      const nested = { ...(extra[keys[0]] || {}) };
      const deep = { ...(nested[keys[1]] || {}) };
      if (value === '' || value === undefined) {
        delete deep[keys[2]];
      } else {
        deep[keys[2]] = value;
      }
      if (Object.keys(deep).length === 0) {
        delete nested[keys[1]];
      } else {
        nested[keys[1]] = deep;
      }
      if (Object.keys(nested).length === 0) {
        delete extra[keys[0]];
      } else {
        extra[keys[0]] = nested;
      }
    }

    setNodeForm({ ...nodeForm, extra });
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

  const handleCopyToManual = async (node: Node) => {
    try {
      await addManualNode({ node, enabled: true });
    } catch (error) {
      console.error('Failed to copy node to manual:', error);
    }
  };

  // Export all project data
  const handlePrepareExport = async () => {
    try {
      const subs = subscriptions.map(s => ({ name: s.name, url: s.url }));
      const response = await manualNodeApi.export();
      const nodeUrls: string[] = response.data.data || [];
      setExportData({ subscriptions: subs, manual_nodes: nodeUrls });
      onExportOpen();
    } catch (error) {
      console.error('Failed to prepare export:', error);
      toast.error('Failed to prepare export data');
    }
  };

  const handleConfirmExport = async () => {
    if (!exportData) return;
    try {
      const json = JSON.stringify({ sbm_export: true, ...exportData }, null, 2);
      await navigator.clipboard.writeText(json);
      toast.success('Copied to clipboard');
      onExportClose();
    } catch (error) {
      console.error('Failed to copy:', error);
      toast.error('Failed to copy to clipboard');
    }
  };

  // Import from clipboard
  const handlePrepareImport = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const data = JSON.parse(text);
      if (!data.sbm_export) {
        toast.error('Clipboard does not contain SBM export data');
        return;
      }
      const subs: { name: string; url: string }[] = data.subscriptions || [];
      const nodes: string[] = data.manual_nodes || [];
      // Filter out subscriptions that already exist by URL
      const existingUrls = new Set(subscriptions.map(s => s.url));
      const newSubs = subs.filter(s => !existingUrls.has(s.url));
      setImportData({ subscriptions: newSubs, manual_nodes: nodes });
      onImportOpen();
    } catch {
      toast.error('Clipboard does not contain valid SBM export data');
    }
  };

  const handleConfirmImport = async () => {
    if (!importData) return;
    setImporting(true);
    try {
      let addedSubs = 0;
      let addedNodes = 0;

      // Add subscriptions
      for (const sub of importData.subscriptions) {
        try {
          await subscriptionApi.add(sub.name, sub.url);
          addedSubs++;
        } catch (error) {
          console.error(`Failed to add subscription ${sub.name}:`, error);
        }
      }

      // Parse and add manual nodes
      if (importData.manual_nodes.length > 0) {
        const parseResponse = await nodeApi.parseBulk(importData.manual_nodes);
        const parsed = parseResponse.data.data;
        const successNodes = parsed.filter((r: any) => r.node);
        if (successNodes.length > 0) {
          const nodes = successNodes.map((r: any) => ({
            node: r.node,
            enabled: true,
          }));
          await addManualNodesBulk(nodes);
          addedNodes = successNodes.length;
        }
      }

      toast.success(`Imported: ${addedSubs} subscriptions, ${addedNodes} nodes`);
      onImportClose();
      fetchSubscriptions();
      fetchManualNodes();
      fetchManualNodeTags();
    } catch (error) {
      console.error('Import failed:', error);
      toast.error('Import failed');
    } finally {
      setImporting(false);
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

  const handleCountryClick = async (group: { code: string; name: string; emoji: string }) => {
    setSelectedCountry(group);
    setCountryNodes([]);
    setCountryNodesLoading(true);
    onCountryOpen();
    try {
      const res = await nodeApi.getByCountry(group.code);
      setCountryNodes(res.data.data || []);
    } catch (error) {
      console.error('Failed to fetch nodes for country:', error);
      toast.error('Failed to load nodes');
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
            variant="flat"
            size="sm"
            startContent={<Download className="w-4 h-4" />}
            onPress={handlePrepareExport}
          >
            <span className="hidden sm:inline">Export All</span>
            <span className="sm:hidden">Export</span>
          </Button>
          <Button
            variant="flat"
            size="sm"
            startContent={<ClipboardPaste className="w-4 h-4" />}
            onPress={handlePrepareImport}
          >
            Import
          </Button>
          <Button
            color="secondary"
            variant="flat"
            size="sm"
            startContent={<FilterIcon className="w-4 h-4" />}
            onPress={handleOpenAddFilter}
          >
            <span className="hidden sm:inline">Add Filter</span>
            <span className="sm:hidden">Filter</span>
          </Button>
          <Button
            color="primary"
            variant="flat"
            size="sm"
            startContent={<Plus className="w-4 h-4" />}
            onPress={handleOpenAddNode}
          >
            <span className="hidden sm:inline">Add Node</span>
            <span className="sm:hidden">Node</span>
          </Button>
          <Button
            color="primary"
            variant="flat"
            size="sm"
            startContent={<List className="w-4 h-4" />}
            onPress={handleOpenBulkAdd}
          >
            <span className="hidden sm:inline">Bulk Add</span>
            <span className="sm:hidden">Bulk</span>
          </Button>
          <Button
            color="primary"
            size="sm"
            startContent={<Plus className="w-4 h-4" />}
            onPress={handleOpenAddSubscription}
          >
            <span className="hidden sm:inline">Add Subscription</span>
            <span className="sm:hidden">Sub</span>
          </Button>
        </div>
      </div>

      {unsupportedNodes.length > 0 && (
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
                          onPress={() => deleteUnsupportedNodes([n.tag])}
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
                  onPress={recheckUnsupportedNodes}
                >
                  Recheck
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  color="danger"
                  startContent={<Trash2 className="w-3 h-3" />}
                  onPress={() => {
                    if (confirm(`Delete all ${unsupportedNodes.length} unsupported node(s) from subscriptions and manual nodes?`)) {
                      deleteUnsupportedNodes();
                    }
                  }}
                >
                  Delete All
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <Tabs aria-label="Node Management" defaultSelectedKey="unified">
        <Tab key="unified" title={<span>Unified{unifiedNodes.length > 0 && <span className="ml-1.5 text-xs opacity-60">({unifiedNodes.length})</span>}</span>}>
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
              <span className="text-xs text-gray-400 ml-auto">
                {filteredAndSortedNodes.length === unifiedNodes.length
                  ? `${unifiedNodes.length} nodes`
                  : `${filteredAndSortedNodes.length} of ${unifiedNodes.length} nodes`}
              </span>
            </div>

            {/* Bulk action bar */}
            {selectedNodes.size > 0 && (
              <div className="flex items-center gap-2 p-2 bg-primary-50 dark:bg-primary-900/20 rounded-lg">
                <span className="text-sm font-medium ml-1">{selectedNodes.size} selected</span>
                <Button size="sm" variant="flat" color="warning" startContent={<Activity className="w-3.5 h-3.5" />} onPress={handleBulkHealthCheck}>
                  Health Check
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  color="danger"
                  startContent={<Trash2 className="w-3.5 h-3.5" />}
                  onPress={handleBulkDelete}
                  isDisabled={selectedManualNodes.length === 0}
                >
                  Delete ({selectedManualNodes.length})
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  startContent={<ToggleRight className="w-3.5 h-3.5" />}
                  onPress={() => handleBulkToggle(true)}
                  isDisabled={selectedManualNodes.length === 0}
                >
                  Enable ({selectedManualNodes.length})
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  startContent={<ToggleLeft className="w-3.5 h-3.5" />}
                  onPress={() => handleBulkToggle(false)}
                  isDisabled={selectedManualNodes.length === 0}
                >
                  Disable ({selectedManualNodes.length})
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  color="secondary"
                  startContent={<FolderInput className="w-3.5 h-3.5" />}
                  onPress={handleBulkCopyToManual}
                  isDisabled={selectedSubNodes.length === 0}
                >
                  Copy to Manual ({selectedSubNodes.length})
                </Button>
                <Button size="sm" isIconOnly variant="light" onPress={() => setSelectedNodes(new Set())} className="ml-auto">
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}

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
                        page={unifiedPage}
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
                          <NodeHealthChips tag={un.node.tag} healthResults={healthResults} healthMode={healthMode} />
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
                            {mn ? (
                              <>
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
                                  size="sm"
                                  isSelected={mn.enabled}
                                  onValueChange={() => handleToggleNode(mn)}
                                />
                              </>
                            ) : (
                              <Tooltip content="Copy to Manual">
                                <Button
                                  isIconOnly
                                  size="sm"
                                  variant="light"
                                  onPress={() => handleCopyToManual(un.node)}
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
        </Tab>

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
                  unsupportedNodes={unsupportedNodes}
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
                  <CardBody className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <FilterIcon className="w-5 h-5 text-secondary shrink-0" />
                      <div className="min-w-0">
                        <h3 className="font-medium truncate">{filter.name}</h3>
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
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
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
                <Card
                  key={group.code}
                  isPressable
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onPress={() => handleCountryClick(group)}
                >
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
      <Modal isOpen={isNodeOpen} onClose={onNodeClose} size="2xl" scrollBehavior="inside">
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

              {/* Edit area - collapsible sections */}
              <Accordion variant="bordered" selectionMode="multiple">
                <AccordionItem key="basic" aria-label="Basic Settings" title="Basic Settings">
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

                {/* Protocol Settings */}
                <AccordionItem key="protocol" aria-label="Protocol Settings" title="Protocol Settings">
                  <div className="space-y-4 pb-2">
                    {/* Shadowsocks */}
                    {nodeForm.type === 'shadowsocks' && (
                      <>
                        <Select
                          label="Encryption Method"
                          selectedKeys={getExtra('method') ? [getExtra('method')] : []}
                          onChange={(e) => setExtra('method', e.target.value)}
                        >
                          {ssMethodOptions.map((m) => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </Select>
                        <Input
                          label="Password"
                          placeholder="Password"
                          value={getExtra('password') || ''}
                          onChange={(e) => setExtra('password', e.target.value)}
                        />
                      </>
                    )}

                    {/* VMess */}
                    {nodeForm.type === 'vmess' && (
                      <>
                        <Input
                          label="UUID"
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          value={getExtra('uuid') || ''}
                          onChange={(e) => setExtra('uuid', e.target.value)}
                        />
                        <div className="grid grid-cols-2 gap-4">
                          <Select
                            label="Security"
                            selectedKeys={getExtra('security') ? [getExtra('security')] : ['auto']}
                            onChange={(e) => setExtra('security', e.target.value)}
                          >
                            {vmessSecurityOptions.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </Select>
                          <Input
                            type="number"
                            label="Alter ID"
                            placeholder="0"
                            value={String(getExtra('alter_id') ?? 0)}
                            onChange={(e) => setExtra('alter_id', parseInt(e.target.value) || 0)}
                          />
                        </div>
                      </>
                    )}

                    {/* VLESS */}
                    {nodeForm.type === 'vless' && (
                      <>
                        <Input
                          label="UUID"
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          value={getExtra('uuid') || ''}
                          onChange={(e) => setExtra('uuid', e.target.value)}
                        />
                        <div className="grid grid-cols-2 gap-4">
                          <Select
                            label="Flow"
                            selectedKeys={[getExtra('flow') || '']}
                            onChange={(e) => setExtra('flow', e.target.value)}
                          >
                            {flowOptions.map((f) => (
                              <SelectItem key={f} value={f}>{f || '(none)'}</SelectItem>
                            ))}
                          </Select>
                          <Select
                            label="Packet Encoding"
                            selectedKeys={[getExtra('packet_encoding') || '']}
                            onChange={(e) => setExtra('packet_encoding', e.target.value)}
                          >
                            <SelectItem key="" value="">(none)</SelectItem>
                            <SelectItem key="xudp" value="xudp">xudp</SelectItem>
                          </Select>
                        </div>
                      </>
                    )}

                    {/* Trojan */}
                    {nodeForm.type === 'trojan' && (
                      <>
                        <Input
                          label="Password"
                          placeholder="Password"
                          value={getExtra('password') || ''}
                          onChange={(e) => setExtra('password', e.target.value)}
                        />
                        <Select
                          label="Flow"
                          selectedKeys={[getExtra('flow') || '']}
                          onChange={(e) => setExtra('flow', e.target.value)}
                        >
                          {flowOptions.map((f) => (
                            <SelectItem key={f} value={f}>{f || '(none)'}</SelectItem>
                          ))}
                        </Select>
                      </>
                    )}

                    {/* Hysteria2 */}
                    {nodeForm.type === 'hysteria2' && (
                      <>
                        <Input
                          label="Password"
                          placeholder="Password"
                          value={getExtra('password') || ''}
                          onChange={(e) => setExtra('password', e.target.value)}
                        />
                        <div className="grid grid-cols-2 gap-4">
                          <Input
                            type="number"
                            label="Upload (Mbps)"
                            placeholder="0"
                            value={String(getExtra('up_mbps') ?? '')}
                            onChange={(e) => setExtra('up_mbps', e.target.value ? parseInt(e.target.value) : undefined)}
                          />
                          <Input
                            type="number"
                            label="Download (Mbps)"
                            placeholder="0"
                            value={String(getExtra('down_mbps') ?? '')}
                            onChange={(e) => setExtra('down_mbps', e.target.value ? parseInt(e.target.value) : undefined)}
                          />
                        </div>
                        <p className="text-xs text-gray-400 -mt-2">Obfuscation</p>
                        <div className="grid grid-cols-2 gap-4">
                          <Select
                            label="Obfs Type"
                            selectedKeys={[getExtra('obfs', 'type') || '']}
                            onChange={(e) => {
                              if (e.target.value) {
                                setExtra('obfs', 'type', e.target.value);
                              } else {
                                // Clear entire obfs object
                                const extra = { ...nodeForm.extra } as Record<string, any>;
                                delete extra.obfs;
                                setNodeForm({ ...nodeForm, extra });
                              }
                            }}
                          >
                            <SelectItem key="" value="">(none)</SelectItem>
                            <SelectItem key="salamander" value="salamander">salamander</SelectItem>
                          </Select>
                          {getExtra('obfs', 'type') && (
                            <Input
                              label="Obfs Password"
                              placeholder="Obfuscation password"
                              value={getExtra('obfs', 'password') || ''}
                              onChange={(e) => setExtra('obfs', 'password', e.target.value)}
                            />
                          )}
                        </div>
                      </>
                    )}

                    {/* TUIC */}
                    {nodeForm.type === 'tuic' && (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <Input
                            label="UUID"
                            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                            value={getExtra('uuid') || ''}
                            onChange={(e) => setExtra('uuid', e.target.value)}
                          />
                          <Input
                            label="Password"
                            placeholder="Password"
                            value={getExtra('password') || ''}
                            onChange={(e) => setExtra('password', e.target.value)}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <Select
                            label="Congestion Control"
                            selectedKeys={getExtra('congestion_control') ? [getExtra('congestion_control')] : []}
                            onChange={(e) => setExtra('congestion_control', e.target.value)}
                          >
                            {congestionControlOptions.map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </Select>
                          <Select
                            label="UDP Relay Mode"
                            selectedKeys={[getExtra('udp_relay_mode') || '']}
                            onChange={(e) => setExtra('udp_relay_mode', e.target.value)}
                          >
                            <SelectItem key="" value="">(default)</SelectItem>
                            <SelectItem key="native" value="native">native</SelectItem>
                            <SelectItem key="quic" value="quic">quic</SelectItem>
                          </Select>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Zero RTT Handshake</span>
                          <Switch
                            size="sm"
                            isSelected={!!getExtra('zero_rtt_handshake')}
                            onValueChange={(v) => setExtra('zero_rtt_handshake', v || undefined)}
                          />
                        </div>
                        <Input
                          label="Heartbeat"
                          placeholder="e.g. 10s"
                          value={getExtra('heartbeat') || ''}
                          onChange={(e) => setExtra('heartbeat', e.target.value)}
                        />
                      </>
                    )}

                    {/* SOCKS */}
                    {nodeForm.type === 'socks' && (
                      <>
                        <Select
                          label="SOCKS Version"
                          selectedKeys={[getExtra('version') || '5']}
                          onChange={(e) => setExtra('version', e.target.value)}
                        >
                          <SelectItem key="4" value="4">SOCKS4</SelectItem>
                          <SelectItem key="5" value="5">SOCKS5</SelectItem>
                        </Select>
                        <div className="grid grid-cols-2 gap-4">
                          <Input
                            label="Username"
                            placeholder="(optional)"
                            value={getExtra('username') || ''}
                            onChange={(e) => setExtra('username', e.target.value)}
                          />
                          <Input
                            label="Password"
                            placeholder="(optional)"
                            value={getExtra('password') || ''}
                            onChange={(e) => setExtra('password', e.target.value)}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </AccordionItem>
              </Accordion>

              {/* TLS Settings */}
              {protocolsWithTls.includes(nodeForm.type) && (
                <Accordion variant="bordered" selectionMode="multiple">
                  <AccordionItem key="tls" aria-label="TLS Settings" title="TLS Settings">
                    <div className="space-y-4 pb-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Enable TLS</span>
                        <Switch
                          size="sm"
                          isSelected={!!getExtra('tls', 'enabled')}
                          onValueChange={(v) => {
                            if (v) {
                              setExtra('tls', 'enabled', true);
                            } else {
                              const extra = { ...nodeForm.extra } as Record<string, any>;
                              delete extra.tls;
                              setNodeForm({ ...nodeForm, extra });
                            }
                          }}
                        />
                      </div>

                      {!!getExtra('tls', 'enabled') && (
                        <>
                          <Input
                            label="SNI (Server Name)"
                            placeholder="example.com"
                            value={getExtra('tls', 'server_name') || ''}
                            onChange={(e) => setExtra('tls', 'server_name', e.target.value)}
                          />

                          <div className="flex items-center justify-between">
                            <span className="text-sm">Allow Insecure</span>
                            <Switch
                              size="sm"
                              isSelected={!!getExtra('tls', 'insecure')}
                              onValueChange={(v) => setExtra('tls', 'insecure', v || undefined)}
                            />
                          </div>

                          <Input
                            label="ALPN"
                            placeholder="h2,http/1.1 (comma-separated)"
                            value={Array.isArray(getExtra('tls', 'alpn')) ? getExtra('tls', 'alpn').join(',') : (getExtra('tls', 'alpn') || '')}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val) {
                                setExtra('tls', 'alpn', val.split(',').map((s: string) => s.trim()).filter(Boolean));
                              } else {
                                setExtra('tls', 'alpn', undefined);
                              }
                            }}
                          />

                          <Select
                            label="uTLS Fingerprint"
                            selectedKeys={[getExtra('tls', 'utls', 'fingerprint') || '']}
                            onChange={(e) => {
                              if (e.target.value) {
                                const tls = { ...(nodeForm.extra?.tls || {}), utls: { enabled: true, fingerprint: e.target.value } };
                                const extra = { ...nodeForm.extra, tls } as Record<string, any>;
                                setNodeForm({ ...nodeForm, extra });
                              } else {
                                const tls = { ...(nodeForm.extra?.tls || {}) };
                                delete tls.utls;
                                const extra = { ...nodeForm.extra, tls } as Record<string, any>;
                                setNodeForm({ ...nodeForm, extra });
                              }
                            }}
                          >
                            {utlsFingerprintOptions.map((f) => (
                              <SelectItem key={f} value={f}>{f || '(none)'}</SelectItem>
                            ))}
                          </Select>

                          {/* Reality */}
                          {(nodeForm.type === 'vless' || nodeForm.type === 'trojan') && (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="text-sm">Reality</span>
                                <Switch
                                  size="sm"
                                  isSelected={!!getExtra('tls', 'reality', 'enabled')}
                                  onValueChange={(v) => {
                                    if (v) {
                                      setExtra('tls', 'reality', { enabled: true, public_key: '', short_id: '' });
                                    } else {
                                      const tls = { ...(nodeForm.extra?.tls || {}) };
                                      delete tls.reality;
                                      const extra = { ...nodeForm.extra, tls } as Record<string, any>;
                                      setNodeForm({ ...nodeForm, extra });
                                    }
                                  }}
                                />
                              </div>

                              {!!getExtra('tls', 'reality', 'enabled') && (
                                <div className="grid grid-cols-2 gap-4">
                                  <Input
                                    label="Public Key"
                                    placeholder="Reality public key"
                                    value={getExtra('tls', 'reality', 'public_key') || ''}
                                    onChange={(e) => setExtra('tls', 'reality', { ...getExtra('tls', 'reality'), public_key: e.target.value })}
                                  />
                                  <Input
                                    label="Short ID"
                                    placeholder="Reality short ID"
                                    value={getExtra('tls', 'reality', 'short_id') || ''}
                                    onChange={(e) => setExtra('tls', 'reality', { ...getExtra('tls', 'reality'), short_id: e.target.value })}
                                  />
                                </div>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </AccordionItem>
                </Accordion>
              )}

              {/* Transport Settings */}
              {protocolsWithTransport.includes(nodeForm.type) && (
                <Accordion variant="bordered" selectionMode="multiple">
                  <AccordionItem key="transport" aria-label="Transport" title="Transport">
                    <div className="space-y-4 pb-2">
                      <Select
                        label="Transport Type"
                        selectedKeys={[getExtra('transport', 'type') || '']}
                        onChange={(e) => {
                          if (e.target.value) {
                            setExtra('transport', 'type', e.target.value);
                          } else {
                            const extra = { ...nodeForm.extra } as Record<string, any>;
                            delete extra.transport;
                            setNodeForm({ ...nodeForm, extra });
                          }
                        }}
                      >
                        {['' , ...transportTypeOptions].map((t) => (
                          <SelectItem key={t} value={t}>{t || '(none)'}</SelectItem>
                        ))}
                      </Select>

                      {/* WebSocket */}
                      {getExtra('transport', 'type') === 'ws' && (
                        <div className="grid grid-cols-2 gap-4">
                          <Input
                            label="Path"
                            placeholder="/"
                            value={getExtra('transport', 'path') || ''}
                            onChange={(e) => setExtra('transport', 'path', e.target.value)}
                          />
                          <Input
                            label="Host Header"
                            placeholder="example.com"
                            value={getExtra('transport', 'headers', 'Host') || ''}
                            onChange={(e) => {
                              const transport = { ...(nodeForm.extra?.transport || {}) };
                              if (e.target.value) {
                                transport.headers = { ...(transport.headers || {}), Host: e.target.value };
                              } else {
                                if (transport.headers) {
                                  delete transport.headers.Host;
                                  if (Object.keys(transport.headers).length === 0) delete transport.headers;
                                }
                              }
                              const extra = { ...nodeForm.extra, transport } as Record<string, any>;
                              setNodeForm({ ...nodeForm, extra });
                            }}
                          />
                        </div>
                      )}

                      {/* HTTP / H2 */}
                      {(getExtra('transport', 'type') === 'http' || getExtra('transport', 'type') === 'h2') && (
                        <div className="grid grid-cols-2 gap-4">
                          <Input
                            label="Path"
                            placeholder="/"
                            value={getExtra('transport', 'path') || ''}
                            onChange={(e) => setExtra('transport', 'path', e.target.value)}
                          />
                          <Input
                            label="Host"
                            placeholder="example.com (comma-separated)"
                            value={Array.isArray(getExtra('transport', 'host')) ? getExtra('transport', 'host').join(',') : (getExtra('transport', 'host') || '')}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val) {
                                setExtra('transport', 'host', val.split(',').map((s: string) => s.trim()).filter(Boolean));
                              } else {
                                setExtra('transport', 'host', undefined);
                              }
                            }}
                          />
                        </div>
                      )}

                      {/* gRPC */}
                      {getExtra('transport', 'type') === 'grpc' && (
                        <Input
                          label="Service Name"
                          placeholder="grpc-service"
                          value={getExtra('transport', 'service_name') || ''}
                          onChange={(e) => setExtra('transport', 'service_name', e.target.value)}
                        />
                      )}
                    </div>
                  </AccordionItem>
                </Accordion>
              )}

              {/* Other (unknown) extra fields */}
              {(() => {
                const known = new Set(knownExtraKeys[nodeForm.type] || []);
                const unknownKeys = Object.keys(nodeForm.extra || {}).filter(k => !known.has(k));
                if (unknownKeys.length === 0) return null;
                const unknownObj: Record<string, any> = {};
                for (const k of unknownKeys) unknownObj[k] = (nodeForm.extra as Record<string, any>)[k];
                return (
                  <Accordion variant="bordered" selectionMode="multiple">
                    <AccordionItem key="other" aria-label="Other" title={`Other (${unknownKeys.length})`}>
                      <div className="space-y-3 pb-2">
                        <p className="text-xs text-gray-400">
                          Extra fields not covered by the editor above. Edit as JSON.
                        </p>
                        <Textarea
                          label="Other Fields (JSON)"
                          minRows={3}
                          maxRows={10}
                          value={JSON.stringify(unknownObj, null, 2)}
                          onChange={(e) => {
                            try {
                              const parsed = JSON.parse(e.target.value);
                              if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
                              // Keep known keys, replace unknown keys with parsed
                              const extra = { ...nodeForm.extra } as Record<string, any>;
                              for (const k of unknownKeys) delete extra[k];
                              for (const [k, v] of Object.entries(parsed)) extra[k] = v;
                              setNodeForm({ ...nodeForm, extra });
                            } catch {
                              // Ignore invalid JSON while user is typing
                            }
                          }}
                        />
                      </div>
                    </AccordionItem>
                  </Accordion>
                );
              })()}

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

      {/* Export All Modal */}
      <Modal isOpen={isExportOpen} onClose={onExportClose}>
        <ModalContent>
          <ModalHeader>Export All to Clipboard</ModalHeader>
          <ModalBody>
            {exportData && (
              <div className="space-y-3">
                <p className="text-sm">The following data will be copied to clipboard:</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">{exportData.subscriptions.length} subscriptions</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">{exportData.manual_nodes.length} manual nodes</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400">Data will be exported in JSON format.</p>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onExportClose}>Cancel</Button>
            <Button color="primary" onPress={handleConfirmExport}>Copy</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Import from Clipboard Modal */}
      <Modal isOpen={isImportOpen} onClose={onImportClose}>
        <ModalContent>
          <ModalHeader>Import from Clipboard</ModalHeader>
          <ModalBody>
            {importData && (
              <div className="space-y-3">
                <p className="text-sm">The following data will be added from clipboard:</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">{importData.subscriptions.length} new subscriptions</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">{importData.manual_nodes.length} manual nodes</span>
                  </div>
                </div>
                {importData.subscriptions.length > 0 && (
                  <p className="text-xs text-gray-400">Subscriptions with duplicate URLs will be skipped.</p>
                )}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onImportClose} isDisabled={importing}>Cancel</Button>
            <Button color="primary" onPress={handleConfirmImport} isLoading={importing}>Import</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Country Nodes Modal */}
      <Modal isOpen={isCountryOpen} onClose={onCountryClose} size="2xl" scrollBehavior="inside">
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
            ) : countryNodes.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No nodes found</p>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {countryNodes.map((node, idx) => (
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
                    <span className="text-xs text-gray-400 hidden sm:inline">{node.server}:{node.server_port}</span>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      color="warning"
                      onPress={() => checkSingleNodeHealth(node.tag)}
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
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onCountryClose}>Close</Button>
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
  unsupportedNodes: UnsupportedNodeInfo[];
}

function SubscriptionCard({ subscription: sub, onRefresh, onEdit, onDelete, onToggle, loading, healthResults, healthMode, healthCheckingNodes, onHealthCheck, unsupportedNodes }: SubscriptionCardProps) {
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
        className="flex flex-col sm:flex-row justify-between items-start gap-3 cursor-pointer"
        onClick={(e) => {
          // If clicking a button, don't trigger expand
          if ((e.target as HTMLElement).closest('button')) return;
          setIsExpanded(!isExpanded);
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Chip
            color={sub.enabled ? 'success' : 'default'}
            variant="flat"
            size="sm"
          >
            {sub.enabled ? 'Enabled' : 'Disabled'}
          </Chip>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold truncate">{sub.name}</h3>
            <p className="text-sm text-gray-500">
              {sub.node_count} nodes · Updated at {new Date(sub.updated_at).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center self-end sm:self-auto shrink-0">
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
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-4">
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
                      {unsupportedNodes.some(u => u.tag === node.tag) && (
                        <Chip size="sm" variant="flat" color="warning" title={unsupportedNodes.find(u => u.tag === node.tag)?.error}>
                          Unsupported
                        </Chip>
                      )}
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
