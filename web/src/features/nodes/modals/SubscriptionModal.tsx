import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Textarea,
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
  const isEditing = !!editingSubscription;
  const hasName = name.trim().length > 0;
  const hasUrl = url.trim().length > 0;
  const urlCount = url
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size={isEditing ? 'md' : '2xl'}>
      <ModalContent>
        <ModalHeader>{isEditing ? 'Edit Subscription' : 'Add Subscription(s)'}</ModalHeader>
        <ModalBody>
          <Input
            label={isEditing ? 'Subscription Name' : 'Subscription Name (optional)'}
            placeholder={isEditing ? 'Enter subscription name' : 'Optional for single URL'}
            description={isEditing ? undefined : 'If empty or multiple URLs provided, names are generated automatically'}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {isEditing ? (
            <Input
              label="Subscription URL"
              placeholder="Enter subscription URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          ) : (
            <Textarea
              label="Subscription URL(s)"
              placeholder={'Paste one or more subscription URLs, one per line'}
              description="You can paste several URLs at once"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              minRows={4}
              maxRows={10}
            />
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            Cancel
          </Button>
          <Button
            color="primary"
            onPress={onSave}
            isLoading={isSubmitting}
            isDisabled={isEditing ? !hasName || !hasUrl : !hasUrl}
          >
            {isEditing ? 'Save' : urlCount > 1 ? `Add ${urlCount} Subs` : 'Add'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
