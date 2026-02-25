import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
} from '@nextui-org/react';
import { Globe, Server } from 'lucide-react';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  importData: { subscriptions: { name: string; url: string }[]; manual_nodes: string[] } | null;
  importing: boolean;
  onConfirm: () => void;
}

export default function ImportModal({ isOpen, onClose, importData, importing, onConfirm }: ImportModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
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
          <Button variant="flat" onPress={onClose} isDisabled={importing}>Cancel</Button>
          <Button color="primary" onPress={onConfirm} isLoading={importing}>Import</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
