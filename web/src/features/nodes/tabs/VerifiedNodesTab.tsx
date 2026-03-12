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
  Button,
  Tooltip,
} from '@nextui-org/react';
import { Search, Activity, Trash2, ArrowDownCircle, Pencil, Star, Copy } from 'lucide-react';
// Activity is used for empty state icon
import type { UnifiedNode, GeoData } from '../../../store';
import type { NodeHealthResult, HealthCheckMode, NodeSiteCheckResult } from '../../../store';
import { nodeDisplayTag, nodeInternalTag, nodeSourceTag } from '../../../store';
import { unifiedNodeApi } from '../../../api';
import { toast } from '../../../components/Toast';
import { SITE_CHECK_TARGETS, formatBytes } from '../types';
import type { NodeTrafficRow } from '../types';
import NodeHealthChips from '../components/NodeHealthChips';
import GeoChip from '../components/GeoChip';
import MobileNodeCard from '../components/MobileNodeCard';
import { useNodeSort } from '../hooks/useNodeSort';
import useIsMobile from '../../../hooks/useIsMobile';
const PAGE_SIZE = 50;

interface VerifiedNodesTabProps {
  nodes: UnifiedNode[];
  healthResults: Record<string, NodeHealthResult>;
  healthMode: HealthCheckMode | null;
  healthCheckingNodes: string[];
  siteCheckResults: Record<string, NodeSiteCheckResult>;
  siteCheckingNodes: string[];
  geoData: Record<string, GeoData>;
  checkSingleNodeHealth: (tag: string) => void;
  checkSingleNodeSites: (tag: string, targets: string[]) => void;
  onDemote: (id: number) => void;
  onDelete: (id: number) => void;
  onEdit: (node: UnifiedNode) => void;
  nodeTrafficMap?: Map<string, NodeTrafficRow>;
  onToggleFavorite: (id: number) => void;
}

export default function VerifiedNodesTab({
  nodes,
  healthResults,
  healthMode,
  healthCheckingNodes,
  siteCheckResults,
  siteCheckingNodes: _siteCheckingNodes,
  geoData,
  checkSingleNodeHealth,
  checkSingleNodeSites: _checkSingleNodeSites,
  onDemote,
  onDelete,
  onEdit,
  onToggleFavorite,
  nodeTrafficMap,
}: VerifiedNodesTabProps) {
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const [exporting, setExporting] = useState(false);

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

  const handleExportLinks = useCallback(() => {
    setExporting(true);
    const ids = filteredNodes.map((n) => n.id);

    const dataPromise = unifiedNodeApi.exportLinks(ids).then((res) => {
      const { links, errors } = res.data as { links: string[] | null; errors: string[] | null; total: number };
      if (!links || links.length === 0) {
        throw new Error('No links to export');
      }
      const text = links.join('\n');
      if (errors && errors.length > 0) {
        toast.info(`Copied ${links.length} link(s) to clipboard (${errors.length} failed)`);
      } else {
        toast.success(`Copied ${links.length} link(s) to clipboard`);
      }
      return text;
    });

    // ClipboardItem with a Promise preserves the user-gesture context on iOS Safari
    const blobPromise = dataPromise.then((text) => new Blob([text], { type: 'text/plain' }));

    navigator.clipboard
      .write([new ClipboardItem({ 'text/plain': blobPromise })])
      .catch(() => {
        // Fallback for browsers that don't support Promise in ClipboardItem
        return dataPromise.then((text) => navigator.clipboard.writeText(text));
      })
      .catch((err: any) => {
        toast.error(err?.message || 'Failed to copy to clipboard');
      })
      .finally(() => setExporting(false));
  }, [filteredNodes]);

  const extractSortValue = useCallback(
    (node: UnifiedNode, col: string): string | number | null => {
      const key = `${node.server}:${node.server_port}`;
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
        case 'lastChecked': return node.last_checked_at ? new Date(node.last_checked_at).getTime() : 0;
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

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedNodes = sortedItems.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  if (nodes.length === 0) {
    return (
      <Card className="mt-4">
        <CardBody className="py-12 text-center">
          <Activity className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">
            No verified nodes yet. Run verification to promote pending nodes.
          </p>
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
          className="w-full sm:w-64"
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
        <Tooltip content="Copy links to clipboard">
          <Button
            isIconOnly
            size="sm"
            variant="light"
            isLoading={exporting}
            onPress={handleExportLinks}
          >
            <Copy className="w-4 h-4" />
          </Button>
        </Tooltip>
        <span className="text-xs text-gray-400 ml-auto">
          {filteredNodes.length === nodes.length
            ? `${nodes.length} verified nodes`
            : `${filteredNodes.length} of ${nodes.length} verified nodes`}
        </span>
      </div>

      {sortedItems.length === 0 ? (
        <Card>
          <CardBody className="py-8 text-center">
            <p className="text-gray-500">No nodes match current search.</p>
          </CardBody>
        </Card>
      ) : isMobile ? (
        /* Mobile: card list */
        <div className="space-y-2">
          {paginatedNodes.map((node) => (
              <MobileNodeCard
                key={node.id}
                node={node}
                geoData={geoData}
                variant="verified"
                healthResults={healthResults}
                healthMode={healthMode}
                healthCheckingNodes={healthCheckingNodes}
                siteCheckResults={siteCheckResults}
                trafficRow={nodeTrafficMap?.get(nodeInternalTag(node))}
                onHealthCheck={checkSingleNodeHealth}
                onDemote={onDemote}
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
          aria-label="Verified nodes table"
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
            <TableColumn key="geoip" width={160} allowsSorting>GeoIP</TableColumn>
            <TableColumn key="tag" allowsSorting>Tag</TableColumn>
            <TableColumn key="type" width={100} allowsSorting>Type</TableColumn>
            <TableColumn key="server" width={200} allowsSorting>Server:Port</TableColumn>
            <TableColumn key="upload" width={80} className="hidden xl:table-cell" allowsSorting>Upload</TableColumn>
            <TableColumn key="download" width={80} className="hidden xl:table-cell" allowsSorting>Download</TableColumn>
            <TableColumn key="total" width={80} className="hidden xl:table-cell" allowsSorting>Total</TableColumn>
            <TableColumn key="lastChecked" width={180} allowsSorting>Last Checked</TableColumn>
            <TableColumn key="health" width={140} allowsSorting>Health</TableColumn>
            <TableColumn width={140}>Actions</TableColumn>
          </TableHeader>
          <TableBody>
            {paginatedNodes.map((node) => {
              const key = `${node.server}:${node.server_port}`;
              const traffic = nodeTrafficMap?.get(nodeInternalTag(node));
              return (
                <TableRow key={node.id}>
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
                    <Chip size="sm" variant="flat">
                      {node.type}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-gray-500 truncate">
                      {node.server}:{node.server_port}
                    </span>
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
                    <span className="text-xs text-gray-500">
                      {formatDate(node.last_checked_at)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <NodeHealthChips
                      tag={key}
                      healthResults={healthResults}
                      healthMode={healthMode}
                      siteCheckResults={siteCheckResults}
                      siteTargets={SITE_CHECK_TARGETS}
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
                      <Tooltip content="Demote to pending">
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          color="warning"
                          onPress={() => onDemote(node.id)}
                        >
                          <ArrowDownCircle className="w-4 h-4" />
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
