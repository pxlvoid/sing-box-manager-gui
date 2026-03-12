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
import { Search, Trash2, RotateCcw, Archive, Star } from 'lucide-react';
import type { UnifiedNode, GeoData } from '../../../store';
import { nodeDisplayTag, nodeSourceTag, nodeInternalTag } from '../../../store';
import MobileNodeCard from '../components/MobileNodeCard';
import GeoChip from '../components/GeoChip';
import { useNodeSort } from '../hooks/useNodeSort';
import useIsMobile from '../../../hooks/useIsMobile';
import { formatBytes } from '../types';
import type { NodeTrafficRow } from '../types';

interface ArchivedNodesTabProps {
  nodes: UnifiedNode[];
  geoData: Record<string, GeoData>;
  nodeTrafficMap?: Map<string, NodeTrafficRow>;
  onUnarchive: (id: number) => void;
  onDelete: (id: number) => void;
  onToggleFavorite: (id: number) => void;
}

const PAGE_SIZE = 50;

export default function ArchivedNodesTab({ nodes, geoData, nodeTrafficMap, onUnarchive, onDelete, onToggleFavorite }: ArchivedNodesTabProps) {
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
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
        case 'failures': return node.consecutive_failures;
        case 'archivedAt': return node.archived_at ? new Date(node.archived_at).getTime() : 0;
        default: return null;
      }
    },
    [geoData, nodeTrafficMap]
  );

  const { sortedItems, sortDescriptor, setSortDescriptor } = useNodeSort(filteredNodes, extractSortValue);

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedNodes = sortedItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleString();
  };

  if (nodes.length === 0) {
    return (
      <Card className="mt-4">
        <CardBody className="py-12 text-center">
          <Archive className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">No archived nodes.</p>
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
          placeholder="Search archived nodes..."
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
        <span className="text-xs text-gray-400 ml-auto">
          {filteredNodes.length === nodes.length
            ? `${nodes.length} archived nodes`
            : `${filteredNodes.length} of ${nodes.length} archived nodes`}
        </span>
      </div>

      {sortedItems.length === 0 ? (
        <Card>
          <CardBody className="py-8 text-center">
            <p className="text-gray-500">No archived nodes match your search.</p>
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
              variant="archived"
              trafficRow={nodeTrafficMap?.get(nodeInternalTag(node))}
              onUnarchive={onUnarchive}
              onDelete={onDelete}
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
          aria-label="Archived nodes table"
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
            <TableColumn key="server" allowsSorting>Server:Port</TableColumn>
            <TableColumn key="upload" width={80} className="hidden xl:table-cell" allowsSorting>Upload</TableColumn>
            <TableColumn key="download" width={80} className="hidden xl:table-cell" allowsSorting>Download</TableColumn>
            <TableColumn key="total" width={80} className="hidden xl:table-cell" allowsSorting>Total</TableColumn>
            <TableColumn key="failures" width={90} allowsSorting>Failures</TableColumn>
            <TableColumn key="archivedAt" width={180} allowsSorting>Archived At</TableColumn>
            <TableColumn width={110}>Actions</TableColumn>
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
                  <Chip size="sm" variant="flat" color="danger">
                    {node.consecutive_failures}
                  </Chip>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-gray-400">{formatDate(node.archived_at)}</span>
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
                    <Tooltip content="Unarchive">
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        color="success"
                        onPress={() => onUnarchive(node.id)}
                      >
                        <RotateCcw className="w-4 h-4" />
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
