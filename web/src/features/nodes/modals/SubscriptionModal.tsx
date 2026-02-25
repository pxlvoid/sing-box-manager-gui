import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
} from '@nextui-org/react';
import type { Subscription } from '../../../store';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  name: string;
  setName: (v: string) => void;
  url: string;
  setUrl: (v: string) => void;
  editingSubscription: Subscription | null;
  isSubmitting: boolean;
  onSave: () => void;
}

export default function SubscriptionModal({
  isOpen,
  onClose,
  name,
  setName,
  url,
  setUrl,
  editingSubscription,
  isSubmitting,
  onSave,
}: SubscriptionModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalContent>
        <ModalHeader>{editingSubscription ? 'Edit Subscription' : 'Add Subscription'}</ModalHeader>
        <ModalBody>
          <Input
            label="Subscription Name"
            placeholder="Enter subscription name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Subscription URL"
            placeholder="Enter subscription URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            Cancel
          </Button>
          <Button
            color="primary"
            onPress={onSave}
            isLoading={isSubmitting}
            isDisabled={!name || !url}
          >
            {editingSubscription ? 'Save' : 'Add'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
