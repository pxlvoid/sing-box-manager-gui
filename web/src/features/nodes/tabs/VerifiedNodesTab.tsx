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
import { Search, Activity, Trash2, ArrowDownCircle, Pencil, Star } from 'lucide-react';
import type { UnifiedNode, GeoData } from '../../../store';
import type { NodeHealthResult, HealthCheckMode, NodeSiteCheckResult } from '../../../store';
import { nodeDisplayTag, nodeInternalTag, nodeSourceTag } from '../../../store';
import { SITE_CHECK_TARGETS, formatBytes } from '../types';
import type { NodeTrafficRow } from '../types';
import NodeHealthChips from '../components/NodeHealthChips';
import GeoChip from '../components/GeoChip';
import MobileNodeCard from '../components/MobileNodeCard';
import useIsMobile from '../../../hooks/useIsMobile';
const PAGE_SIZE = 50;

function countryCodeToEmoji(code: string): string {
  const upper = code.toUpperCase();
  if (upper.length !== 2) return '🌐';
  return String.fromCodePoint(
    0x1F1E6 + upper.charCodeAt(0) - 65,
    0x1F1E6 + upper.charCodeAt(1) - 65
  );
}

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

  const totalPages = Math.max(1, Math.ceil(filteredNodes.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedNodes = filteredNodes.slice(
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
        <span className="text-xs text-gray-400 ml-auto">
          {filteredNodes.length === nodes.length
            ? `${nodes.length} verified nodes`
            : `${filteredNodes.length} of ${nodes.length} verified nodes`}
        </span>
      </div>

      {filteredNodes.length === 0 ? (
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
            <TableColumn width={200}>Server:Port</TableColumn>
            <TableColumn width={160}>GeoIP</TableColumn>
            <TableColumn width={80} className="hidden xl:table-cell">Upload</TableColumn>
            <TableColumn width={80} className="hidden xl:table-cell">Download</TableColumn>
            <TableColumn width={80} className="hidden xl:table-cell">Total</TableColumn>
            <TableColumn width={180}>Last Checked</TableColumn>
            <TableColumn width={140}>Health</TableColumn>
            <TableColumn width={140}>Actions</TableColumn>
          </TableHeader>
          <TableBody>
            {paginatedNodes.map((node) => {
              const key = `${node.server}:${node.server_port}`;
              const geo = geoData[key];
              const hasGeo = geo?.status === 'success' && geo.country_code;
              const countryEmoji = hasGeo ? countryCodeToEmoji(geo.country_code) : '🌐';
              const countryLabel = hasGeo ? `${geo.country} (${geo.country_code})` : 'No GeoIP data';
              const traffic = nodeTrafficMap?.get(nodeInternalTag(node));
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
                    <Chip size="sm" variant="flat">
                      {node.type}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-gray-500 truncate">
                      {node.server}:{node.server_port}
                    </span>
                  </TableCell>
                  <TableCell>
                    <GeoChip geo={geoData[key]} claimedCountry={node.country} />
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
                      <Tooltip content="Health check">
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          isLoading={healthCheckingNodes.includes(nodeInternalTag(node))}
                          onPress={() => checkSingleNodeHealth(nodeInternalTag(node))}
                        >
                          <Activity className="w-4 h-4" />
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
