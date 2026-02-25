import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Textarea,
  Card,
  CardBody,
  Chip,
} from '@nextui-org/react';
import type { Node } from '../../../store';

interface BulkAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  bulkUrls: string;
  setBulkUrls: (v: string) => void;
  bulkGroupTag: string;
  setBulkGroupTag: (v: string) => void;
  bulkParsing: boolean;
  bulkAdding: boolean;
  bulkResults: Array<{ url: string; node?: Node; error?: string }>;
  onParse: () => void;
  onAdd: () => void;
}

export default function BulkAddModal({
  isOpen,
  onClose,
  bulkUrls,
  setBulkUrls,
  bulkGroupTag,
  setBulkGroupTag,
  bulkParsing,
  bulkAdding,
  bulkResults,
  onParse,
  onAdd,
}: BulkAddModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl">
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
                onPress={onParse}
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
          <Button variant="flat" onPress={onClose}>
            Cancel
          </Button>
          <Button
            color="primary"
            onPress={onAdd}
            isLoading={bulkAdding}
            isDisabled={bulkResults.filter(r => r.node).length === 0}
          >
            Add {bulkResults.filter(r => r.node).length || ''} Nodes
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
