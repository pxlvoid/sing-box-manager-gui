import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../../store';
import type { UnifiedNode, HealthFilter, SortColumn, SortConfig } from '../types';
import { spKey, getNodeLatency, UNIFIED_PAGE_SIZE, SITE_CHECK_TARGETS } from '../types';

export function useUnifiedTab() {
  const {
    subscriptions,
    manualNodes,
    unsupportedNodes,
    healthResults,
    healthMode,
    checkSingleNodeHealth,
    checkNodesSites,
  } = useStore();

  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: null, direction: 'asc' });
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [unifiedPage, setUnifiedPage] = useState(1);
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());

  const handleColumnSort = (column: SortColumn) => {
    setSortConfig(prev => {
      if (prev.column === column) {
        if (prev.direction === 'asc') return { column, direction: 'desc' };
        return { column: null, direction: 'asc' };
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

  const aliveSubNodes = useMemo(() =>
    unifiedNodes.filter(n =>
      n.source === 'subscription' && healthResults[spKey(n.node)]?.alive === true
    ), [unifiedNodes, healthResults]);

  const hasAliveNodes = aliveSubNodes.length > 0;

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
        const result = healthResults[spKey(n.node)];
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
            const la = getNodeLatency(spKey(a.node), healthResults, healthMode);
            const lb = getNodeLatency(spKey(b.node), healthResults, healthMode);
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
  const safePage = Math.min(unifiedPage, unifiedTotalPages);
  const paginatedNodes = filteredAndSortedNodes.slice(
    (safePage - 1) * UNIFIED_PAGE_SIZE,
    safePage * UNIFIED_PAGE_SIZE
  );

  const selectedUnified = useMemo(() =>
    filteredAndSortedNodes.filter(n => selectedNodes.has(n.key)),
    [filteredAndSortedNodes, selectedNodes]
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

  const handleBulkSiteCheck = async () => {
    const tags = [...new Set(selectedUnified.map(un => un.node.tag))];
    if (tags.length === 0) return;
    await checkNodesSites(tags, SITE_CHECK_TARGETS);
  };

  const handleBulkDelete = async () => {
    const { deleteManualNode } = useStore.getState();
    if (selectedManualNodes.length === 0) return;
    if (!confirm(`Delete ${selectedManualNodes.length} manual node(s)?`)) return;
    for (const un of selectedManualNodes) {
      if (un.manualNodeId) await deleteManualNode(un.manualNodeId);
    }
    setSelectedNodes(new Set());
  };

  const handleBulkToggle = async (enabled: boolean) => {
    const { updateManualNode } = useStore.getState();
    for (const un of selectedManualNodes) {
      const mn = manualNodes.find(m => m.id === un.manualNodeId);
      if (mn) await updateManualNode(mn.id, { ...mn, enabled });
    }
  };

  const handleBulkCopyToManual = async () => {
    const { addManualNode } = useStore.getState();
    for (const un of selectedSubNodes) {
      try {
        await addManualNode({
          node: un.node,
          enabled: true,
          source_subscription_id: un.source === 'subscription' ? un.sourceId : undefined,
        });
      } catch (error) {
        console.error('Failed to copy node:', error);
      }
    }
    setSelectedNodes(new Set());
  };

  const clearSelection = () => setSelectedNodes(new Set());

  // Reset selection and page when filters change
  useEffect(() => {
    setUnifiedPage(1);
    setSelectedNodes(new Set());
  }, [sourceFilter, searchQuery, healthFilter, sortConfig]);

  return {
    healthFilter,
    setHealthFilter,
    sortConfig,
    handleColumnSort,
    searchQuery,
    setSearchQuery,
    sourceFilter,
    setSourceFilter,
    unifiedPage,
    setUnifiedPage,
    unifiedNodes,
    filteredAndSortedNodes,
    unifiedTotalPages,
    safePage,
    paginatedNodes,
    selectedNodes,
    selectedUnified,
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
    aliveSubNodes,
    hasAliveNodes,
  };
}
