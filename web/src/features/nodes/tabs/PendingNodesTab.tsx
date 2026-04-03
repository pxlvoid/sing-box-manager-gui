import { useState, useMemo, useCallback } from 'react';
import {
  Card,
  CardBody,
  Input,
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
  Tooltip,
} from '@nextui-org/react';
import { Search, Activity, Trash2, ArrowUpCircle, Archive, Pencil, Star } from 'lucide-react';
// Activity is used for empty state icon
import type { UnifiedNode, NodeHealthResult, HealthCheckMode, NodeSiteCheckResult, SpeedTestResult, GeoData } from '../../../store';
import { nodeDisplayTag, nodeInternalTag, nodeSourceTag } from '../../../store';
import { spKey, SITE_CHECK_TARGETS, formatBytes } from '../types';
import type { NodeTrafficRow } from '../types';
import NodeHealthChips from '../components/NodeHealthChips';
import GeoChip from '../components/GeoChip';
import MobileNodeCard from '../components/MobileNodeCard';
import { useNodeSort } from '../hooks/useNodeSort';
import useIsMobile from '../../../hooks/useIsMobile';

const ITEMS_PER_PAGE = 50;

interface PendingNodesTabProps {
  nodes: UnifiedNode[];
  healthResults: Record<string, NodeHealthResult>;
  healthMode: HealthCheckMode | null;
  healthCheckingNodes: string[];
  siteCheckResults: Record<string, NodeSiteCheckResult>;
  siteCheckingNodes: string[];
  speedResults?: Record<string, SpeedTestResult>;
  geoData: Record<string, GeoData>;
  checkSingleNodeHealth: (tag: string) => void;
  checkSingleNodeSites: (tag: string, targets: string[]) => void;
  onPromote: (id: number) => void;
  onArchive: (id: number) => void;
  onDelete: (id: number) => void;
  onEdit: (node: UnifiedNode) => void;
  onToggleFavorite: (id: number) => void;
  nodeTrafficMap?: Map<string, NodeTrafficRow>;
  onBulkPromote: (ids: number[]) => void;
  onBulkArchive: (ids: number[]) => void;
}

export default function PendingNodesTab({
  nodes,
  healthResults,
  healthMode,
  healthCheckingNodes,
  siteCheckResults,
  siteCheckingNodes: _siteCheckingNodes,
  speedResults,
  geoData,
  checkSingleNodeHealth,
  checkSingleNodeSites: _checkSingleNodeSites,
  onPromote,
  onArchive,
  onDelete,
  onEdit,
  onToggleFavorite,
  nodeTrafficMap,
  onBulkPromote,
  onBulkArchive,
}: PendingNodesTabProps) {
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const filteredNodes = useMemo(() => {
    let result = nodes;
    if (showFavoritesOnly) {
      result = result.filter((n) => n.is_favorite);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (n) =>
          nodeDisplayTag(n).toLowerCase().includes(q) ||
          nodeSourceTag(n).toLowerCase().includes(q) ||
          n.server.toLowerCase().includes(q)
      );
    }
    return result;
  }, [nodes, searchQuery, showFavoritesOnly]);

  const extractSortValue = useCallback(
    (node: UnifiedNode, col: string): string | number | null => {
      const key = spKey(node);
      const geo = geoData[key];
      const traffic = nodeTrafficMap?.get(nodeInternalTag(node));
      switch (col) {
        case 'geoip': return geo?.country ?? '';
        case 'tag': return nodeDisplayTag(node);
        case 'type': return node.type;
        case 'server': return `${node.server}:${node.server_port}`;
        case 'upload': return traffic?.upload_bytes ?? 0;
        case 'download': return traffic?.download_bytes ?? 0;
        case 'total': return traffic?.total_bytes ?? 0;
        case 'failures': return node.consecutive_failures;
        case 'health': {
          const hr = healthResults[key];
          if (!hr) return null;
          const delays = Object.values(hr.groups).filter((d) => d > 0);
          return delays.length > 0 ? Math.min(...delays) : null;
        }
        default: return null;
      }
    },
    [geoData, nodeTrafficMap, healthResults]
  );

  const { sortedItems, sortDescriptor, setSortDescriptor } = useNodeSort(filteredNodes, extractSortValue);

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paginatedNodes = sortedItems.slice(
    (safePage - 1) * ITEMS_PER_PAGE,
    safePage * ITEMS_PER_PAGE
  );

  const pageIds = paginatedNodes.map((n) => n.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedIds.has(id));

  const handleToggleSelectAll = () => {
    if (allPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pageIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pageIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectedArray = Array.from(selectedIds);

  const handleBulkDelete = () => {
    selectedArray.forEach((id) => onDelete(id));
    clearSelection();
  };

  if (nodes.length === 0) {
    return (
      <Card className="mt-4">
        <CardBody className="py-12 text-center">
          <Activity className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">No pending nodes. Nodes awaiting verification will appear here.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-3 mt-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          size="sm"
          placeholder="Search by name, original tag or server..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          startContent={<Search className="w-3.5 h-3.5 text-gray-400" />}
          className="w-full sm:w-56"
          isClearable
          onClear={() => {
            setSearchQuery('');
            setPage(1);
          }}
        />
        <Tooltip content={showFavoritesOnly ? 'Show all' : 'Favorites only'}>
          <Button
            isIconOnly
            size="sm"
            variant={showFavoritesOnly ? 'solid' : 'light'}
            color={showFavoritesOnly ? 'warning' : 'default'}
            onPress={() => setShowFavoritesOnly((v) => !v)}
          >
            <Star className={`w-4 h-4 ${showFavoritesOnly ? 'fill-current' : ''}`} />
          </Button>
        </Tooltip>
        <span className="text-xs text-gray-400 ml-auto">
          {filteredNodes.length === nodes.length
            ? `${nodes.length} pending nodes`
            : `${filteredNodes.length} of ${nodes.length} pending nodes`}
        </span>
      </div>

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-2 bg-primary-50 dark:bg-primary-900/20 rounded-lg">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button
            size="sm"
            variant="flat"
            color="success"
            startContent={<ArrowUpCircle className="w-3.5 h-3.5" />}
            onPress={() => {
              onBulkPromote(selectedArray);
              clearSelection();
            }}
          >
            Promote Selected
          </Button>
          <Button
            size="sm"
            variant="flat"
            color="warning"
            startContent={<Archive className="w-3.5 h-3.5" />}
            onPress={() => {
              onBulkArchive(selectedArray);
              clearSelection();
            }}
          >
            Archive Selected
          </Button>
          <Button
            size="sm"
            variant="flat"
            color="danger"
            startContent={<Trash2 className="w-3.5 h-3.5" />}
            onPress={handleBulkDelete}
          >
            Delete Selected
          </Button>
          <Button size="sm" variant="light" onPress={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      {/* Table / Cards */}
      {sortedItems.length === 0 ? (
        <Card>
          <CardBody className="py-8 text-center">
            <p className="text-gray-500">No nodes match current search.</p>
          </CardBody>
        </Card>
      ) : isMobile ? (
        /* Mobile: card list with select-all */
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Checkbox
              size="sm"
              isSelected={allPageSelected}
              isIndeterminate={somePageSelected && !allPageSelected}
              onValueChange={handleToggleSelectAll}
            />
            <span className="text-xs text-gray-500">Select all on page</span>
          </div>
          {paginatedNodes.map((node) => (
            <MobileNodeCard
              key={node.id}
              node={node}
              geoData={geoData}
              variant="pending"
              healthResults={healthResults}
              healthMode={healthMode}
              healthCheckingNodes={healthCheckingNodes}
              siteCheckResults={siteCheckResults}
              trafficRow={nodeTrafficMap?.get(nodeInternalTag(node))}
              onHealthCheck={checkSingleNodeHealth}
              selected={selectedIds.has(node.id)}
              onToggleSelect={handleToggleSelect}
              onPromote={onPromote}
              onArchive={onArchive}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          ))}
          {totalPages > 1 && (
            <div className="flex justify-center pt-2">
              <Pagination size="sm" total={totalPages} page={safePage} onChange={setPage} />
            </div>
          )}
        </div>
      ) : (
        /* Desktop: table */
        <div className="overflow-x-auto -mx-3 px-3">
        <Table
          aria-label="Pending nodes table"
          removeWrapper
          isCompact
          sortDescriptor={sortDescriptor}
          onSortChange={setSortDescriptor}
          bottomContent={
            totalPages > 1 ? (
              <div className="flex justify-center">
                <Pagination
                  size="sm"
                  total={totalPages}
                  page={safePage}
                  onChange={setPage}
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
            <TableColumn key="geoip" width={160} allowsSorting>GeoIP</TableColumn>
            <TableColumn key="tag" allowsSorting>Tag</TableColumn>
            <TableColumn key="type" width={100} allowsSorting>Type</TableColumn>
            <TableColumn key="server" allowsSorting>Server</TableColumn>
            <TableColumn key="upload" width={80} className="hidden xl:table-cell" allowsSorting>Upload</TableColumn>
            <TableColumn key="download" width={80} className="hidden xl:table-cell" allowsSorting>Download</TableColumn>
            <TableColumn key="total" width={80} className="hidden xl:table-cell" allowsSorting>Total</TableColumn>
            <TableColumn key="failures" width={80} allowsSorting>Failures</TableColumn>
            <TableColumn key="health" width={140} allowsSorting>Status / Health</TableColumn>
            <TableColumn width={160}>Actions</TableColumn>
          </TableHeader>
          <TableBody>
            {paginatedNodes.map((node) => {
              const key = spKey(node);
              const traffic = nodeTrafficMap?.get(nodeInternalTag(node));
              const failures = node.consecutive_failures;
              const failureColor =
                failures >= 8 ? 'danger' : failures >= 5 ? 'warning' : 'default';

              return (
                <TableRow key={node.id}>
                  <TableCell>
                    <Checkbox
                      size="sm"
                      isSelected={selectedIds.has(node.id)}
                      onValueChange={() => handleToggleSelect(node.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <GeoChip geo={geoData[key]} claimedCountry={node.country} />
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[180px] sm:max-w-[300px]">
                      <span className="font-medium truncate block">{nodeDisplayTag(node)}</span>
                      {nodeSourceTag(node) && nodeSourceTag(node) !== nodeDisplayTag(node) && (
                        <span className="text-xs text-gray-500 truncate block" title={nodeSourceTag(node)}>
                          {nodeSourceTag(node)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" variant="flat">{node.type}</Chip>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-gray-500">{node.server}:{node.server_port}</span>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <span className="text-xs text-gray-500">{traffic ? formatBytes(traffic.upload_bytes) : '-'}</span>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <span className="text-xs text-gray-500">{traffic ? formatBytes(traffic.download_bytes) : '-'}</span>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <span className="text-xs font-medium">{traffic ? formatBytes(traffic.total_bytes) : '-'}</span>
                  </TableCell>
                  <TableCell>
                    {failures > 0 ? (
                      <Chip size="sm" variant="flat" color={failureColor}>
                        {failures}
                      </Chip>
                    ) : (
                      <span className="text-xs text-gray-400">0</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <NodeHealthChips
                      tag={key}
                      healthResults={healthResults}
                      healthMode={healthMode}
                      siteCheckResults={siteCheckResults}
                      siteTargets={SITE_CHECK_TARGETS}
                      speedResults={speedResults}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Tooltip content={node.is_favorite ? "Remove from favorites" : "Add to favorites"}>
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          onPress={() => onToggleFavorite(node.id)}
                        >
                          <Star className={`w-4 h-4 ${node.is_favorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Promote to Verified">
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          color="success"
                          onPress={() => onPromote(node.id)}
                        >
                          <ArrowUpCircle className="w-4 h-4" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Archive">
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          color="warning"
                          onPress={() => onArchive(node.id)}
                        >
                          <Archive className="w-4 h-4" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Edit">
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          onPress={() => onEdit(node)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Delete">
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          color="danger"
                          onPress={() => onDelete(node.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </div>
      )}
    </div>
  );
}
