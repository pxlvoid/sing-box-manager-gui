import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../../store';
import type { UnifiedNode as StoreUnifiedNode } from '../../../store';
import type { HealthFilter, SortColumn, SortConfig } from '../types';
import { spKey, getNodeLatency, UNIFIED_PAGE_SIZE } from '../types';

export function useUnifiedTab(status: 'pending' | 'verified' | 'archived') {
  const {
    pendingNodes,
    verifiedNodes,
    archivedNodes,
    healthResults,
    healthMode,
    checkSingleNodeHealth,
    checkNodesSites,
    stabilityStats,
    fetchStabilityStats,
    deleteNode,
    promoteNode,
    demoteNode,
    archiveNode,
    unarchiveNode,
    bulkPromoteNodes,
    bulkArchiveNodes,
  } = useStore();

  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: null, direction: 'asc' });
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [selectedNodes, setSelectedNodes] = useState<Set<number>>(new Set());
  const [minStability, setMinStability] = useState(0);

  useEffect(() => { fetchStabilityStats(); }, []);

  const handleColumnSort = (column: SortColumn) => {
    setSortConfig(prev => {
      if (prev.column === column) {
        if (prev.direction === 'asc') return { column, direction: 'desc' };
        return { column: null, direction: 'asc' };
      }
      return { column, direction: 'asc' };
    });
  };

  const nodes: StoreUnifiedNode[] = useMemo(() => {
    if (status === 'pending') return pendingNodes;
    if (status === 'verified') return verifiedNodes;
    return archivedNodes;
  }, [status, pendingNodes, verifiedNodes, archivedNodes]);

  const filteredAndSortedNodes = useMemo(() => {
    let result = [...nodes];

    if (sourceFilter === 'manual') {
      result = result.filter(n => n.source === 'manual');
    } else if (sourceFilter === 'subscription') {
      result = result.filter(n => n.source === 'subscription');
    } else if (sourceFilter !== 'all') {
      result = result.filter(n => n.group_tag === sourceFilter);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(n =>
        n.tag.toLowerCase().includes(q) ||
        n.server.toLowerCase().includes(q) ||
        (n.country || '').toLowerCase().includes(q)
      );
    }

    if (healthFilter !== 'all') {
      result = result.filter(n => {
        const key = spKey(n);
        const hr = healthResults[key];
        if (healthFilter === 'unchecked') return !hr;
        if (healthFilter === 'alive') return hr?.alive === true;
        if (healthFilter === 'timeout') return hr && !hr.alive;
        return true;
      });
    }

    if (minStability > 0) {
      result = result.filter(n => {
        const stats = stabilityStats[spKey(n)];
        return stats && stats.uptime_percent >= minStability;
      });
    }

    if (sortConfig.column) {
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      result.sort((a, b) => {
        switch (sortConfig.column) {
          case 'name':
            return dir * a.tag.localeCompare(b.tag);
          case 'type':
            return dir * a.type.localeCompare(b.type);
          case 'source':
            return dir * a.source.localeCompare(b.source);
          case 'latency': {
            const la = getNodeLatency(spKey(a), healthResults, healthMode);
            const lb = getNodeLatency(spKey(b), healthResults, healthMode);
            if (la === null && lb === null) return 0;
            if (la === null) return 1;
            if (lb === null) return -1;
            if (la === -1 && lb === -1) return 0;
            if (la === -1) return 1;
            if (lb === -1) return -1;
            return dir * (la - lb);
          }
          case 'stability': {
            const sa = stabilityStats[spKey(a)];
            const sb = stabilityStats[spKey(b)];
            if (!sa && !sb) return 0;
            if (!sa) return 1;
            if (!sb) return -1;
            return dir * (sa.uptime_percent - sb.uptime_percent);
          }
          case 'avgLatency': {
            const sa = stabilityStats[spKey(a)];
            const sb = stabilityStats[spKey(b)];
            if (!sa && !sb) return 0;
            if (!sa) return 1;
            if (!sb) return -1;
            return dir * (sa.avg_latency_ms - sb.avg_latency_ms);
          }
          default:
            return 0;
        }
      });
    }

    return result;
  }, [nodes, sourceFilter, searchQuery, healthFilter, sortConfig, healthResults, healthMode, stabilityStats, minStability]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedNodes.length / UNIFIED_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedNodes = filteredAndSortedNodes.slice(
    (safePage - 1) * UNIFIED_PAGE_SIZE,
    safePage * UNIFIED_PAGE_SIZE
  );

  const allPageSelected = paginatedNodes.length > 0 && paginatedNodes.every(n => selectedNodes.has(n.id));
  const somePageSelected = paginatedNodes.some(n => selectedNodes.has(n.id));

  const handleToggleSelectAll = () => {
    setSelectedNodes(prev => {
      const next = new Set(prev);
      if (allPageSelected) {
        paginatedNodes.forEach(n => next.delete(n.id));
      } else {
        paginatedNodes.forEach(n => next.add(n.id));
      }
      return next;
    });
  };

  const handleToggleSelect = (id: number) => {
    setSelectedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkHealthCheck = async () => {
    const selected = nodes.filter(n => selectedNodes.has(n.id));
    await Promise.all(
      selected.map(n => checkSingleNodeHealth(n.tag, { skipStatsRefresh: true }))
    );
    useStore.getState().fetchStabilityStats();
  };

  const handleBulkSiteCheck = async () => {
    const tags = [...new Set(nodes.filter(n => selectedNodes.has(n.id)).map(n => n.tag))];
    if (tags.length === 0) return;
    await checkNodesSites(tags);
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedNodes];
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} node(s)?`)) return;
    for (const id of ids) {
      await deleteNode(id);
    }
    setSelectedNodes(new Set());
  };

  const handleBulkPromote = async () => {
    const ids = [...selectedNodes];
    if (ids.length === 0) return;
    await bulkPromoteNodes(ids);
    setSelectedNodes(new Set());
  };

  const handleBulkArchive = async () => {
    const ids = [...selectedNodes];
    if (ids.length === 0) return;
    await bulkArchiveNodes(ids);
    setSelectedNodes(new Set());
  };

  const clearSelection = () => setSelectedNodes(new Set());

  useEffect(() => {
    setPage(1);
    setSelectedNodes(new Set());
  }, [sourceFilter, searchQuery, healthFilter, sortConfig, minStability]);

  return {
    nodes,
    filteredAndSortedNodes,
    paginatedNodes,
    page,
    setPage,
    totalPages,
    safePage,
    healthFilter,
    setHealthFilter,
    sortConfig,
    handleColumnSort,
    searchQuery,
    setSearchQuery,
    sourceFilter,
    setSourceFilter,
    selectedNodes,
    allPageSelected,
    somePageSelected,
    handleToggleSelectAll,
    handleToggleSelect,
    handleBulkHealthCheck,
    handleBulkSiteCheck,
    handleBulkDelete,
    handleBulkPromote,
    handleBulkArchive,
    clearSelection,
    stabilityStats,
    minStability,
    setMinStability,
    // Single node actions
    deleteNode,
    promoteNode,
    demoteNode,
    archiveNode,
    unarchiveNode,
  };
}
