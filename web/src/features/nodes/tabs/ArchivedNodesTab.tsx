import { useState, useMemo } from 'react';
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
import { nodeDisplayTag, nodeSourceTag } from '../../../store';
import MobileNodeCard from '../components/MobileNodeCard';
import useIsMobile from '../../../hooks/useIsMobile';

interface ArchivedNodesTabProps {
  nodes: UnifiedNode[];
  geoData: Record<string, GeoData>;
  onUnarchive: (id: number) => void;
  onDelete: (id: number) => void;
  onToggleFavorite: (id: number) => void;
}

const PAGE_SIZE = 50;

function countryCodeToEmoji(code: string): string {
  const upper = code.toUpperCase();
  if (upper.length !== 2) return '🌐';
  return String.fromCodePoint(
    0x1F1E6 + upper.charCodeAt(0) - 65,
    0x1F1E6 + upper.charCodeAt(1) - 65
  );
}

export default function ArchivedNodesTab({ nodes, geoData, onUnarchive, onDelete, onToggleFavorite }: ArchivedNodesTabProps) {
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return nodes;
    const q = searchQuery.toLowerCase();
    return nodes.filter(
      (n) =>
        nodeDisplayTag(n).toLowerCase().includes(q) ||
        nodeSourceTag(n).toLowerCase().includes(q) ||
        n.server.toLowerCase().includes(q)
    );
  }, [nodes, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredNodes.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedNodes = filteredNodes.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
        <span className="text-xs text-gray-400 ml-auto">
          {filteredNodes.length === nodes.length
            ? `${nodes.length} archived nodes`
            : `${filteredNodes.length} of ${nodes.length} archived nodes`}
        </span>
      </div>

      {filteredNodes.length === 0 ? (
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
            <TableColumn width={60}>Country</TableColumn>
            <TableColumn>Tag</TableColumn>
            <TableColumn width={100}>Type</TableColumn>
            <TableColumn>Server:Port</TableColumn>
            <TableColumn width={90}>Failures</TableColumn>
            <TableColumn width={180}>Archived At</TableColumn>
            <TableColumn width={110}>Actions</TableColumn>
          </TableHeader>
          <TableBody>
            {paginatedNodes.map((node) => {
              const key = `${node.server}:${node.server_port}`;
              const geo = geoData[key];
              const hasGeo = geo?.status === 'success' && geo.country_code;
              const countryEmoji = hasGeo ? countryCodeToEmoji(geo.country_code) : '🌐';
              const countryLabel = hasGeo ? `${geo.country} (${geo.country_code})` : 'No GeoIP data';
              return (
              <TableRow key={node.id}>
                <TableCell>
                  <Tooltip content={countryLabel}>
                    <span className="text-lg cursor-default">{countryEmoji}</span>
                  </Tooltip>
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
