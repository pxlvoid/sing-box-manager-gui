import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
} from '@nextui-org/react';
import { Globe } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  exportData: { subscriptions: { name: string; url: string }[] } | null;
  onConfirm: () => void;
}

export default function ExportModal({ isOpen, onClose, exportData, onConfirm }: ExportModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalContent>
        <ModalHeader>Export All to Clipboard</ModalHeader>
        <ModalBody>
          {exportData && (
            <div className="space-y-3">
              <p className="text-sm">The following data will be copied to clipboard:</p>
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">{exportData.subscriptions.length} subscriptions</span>
              </div>
              <p className="text-xs text-gray-400">Data will be exported in JSON format.</p>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>Cancel</Button>
          <Button color="primary" onPress={onConfirm}>Copy</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
