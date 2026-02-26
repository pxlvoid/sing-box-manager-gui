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
import { Search, Activity, Trash2, ArrowDownCircle, Pencil } from 'lucide-react';
import type { UnifiedNode } from '../../../store';
import type { NodeHealthResult, HealthCheckMode, NodeSiteCheckResult } from '../../../store';
import { SITE_CHECK_TARGETS } from '../types';
import NodeHealthChips from '../components/NodeHealthChips';
const PAGE_SIZE = 50;

interface VerifiedNodesTabProps {
  nodes: UnifiedNode[];
  healthResults: Record<string, NodeHealthResult>;
  healthMode: HealthCheckMode | null;
  healthCheckingNodes: string[];
  siteCheckResults: Record<string, NodeSiteCheckResult>;
  siteCheckingNodes: string[];
  checkSingleNodeHealth: (tag: string) => void;
  checkSingleNodeSites: (tag: string, targets: string[]) => void;
  onDemote: (id: number) => void;
  onDelete: (id: number) => void;
  onEdit: (node: UnifiedNode) => void;
}

export default function VerifiedNodesTab({
  nodes,
  healthResults,
  healthMode,
  healthCheckingNodes,
  siteCheckResults,
  siteCheckingNodes: _siteCheckingNodes,
  checkSingleNodeHealth,
  checkSingleNodeSites: _checkSingleNodeSites,
  onDemote,
  onDelete,
  onEdit,
}: VerifiedNodesTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return nodes;
    const q = searchQuery.toLowerCase();
    return nodes.filter(
      (n) =>
        n.tag.toLowerCase().includes(q) ||
        n.server.toLowerCase().includes(q)
    );
  }, [nodes, searchQuery]);

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
          placeholder="Search by tag or server..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          startContent={<Search className="w-3.5 h-3.5 text-gray-400" />}
          className="w-64"
          isClearable
          onClear={() => {
            setSearchQuery('');
            setPage(1);
          }}
        />
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
      ) : (
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
            <TableColumn>Tag</TableColumn>
            <TableColumn width={100}>Type</TableColumn>
            <TableColumn width={200}>Server:Port</TableColumn>
            <TableColumn width={180}>Last Checked</TableColumn>
            <TableColumn width={200}>Health</TableColumn>
            <TableColumn width={140}>Actions</TableColumn>
          </TableHeader>
          <TableBody>
            {paginatedNodes.map((node) => {
              const key = `${node.server}:${node.server_port}`;
              return (
                <TableRow key={node.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{node.country_emoji || '🌐'}</span>
                      <span className="font-medium truncate max-w-[300px]">
                        {node.tag}
                      </span>
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
                      <Tooltip content="Health check">
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          isLoading={healthCheckingNodes.includes(node.tag)}
                          onPress={() => checkSingleNodeHealth(node.tag)}
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
      )}
    </div>
  );
}
