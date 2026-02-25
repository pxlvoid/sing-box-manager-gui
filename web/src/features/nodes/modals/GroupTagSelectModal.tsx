import { useState, useEffect } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  RadioGroup,
  Radio,
} from '@nextui-org/react';

const CREATE_NEW_SENTINEL = '__create_new__';

interface GroupTagSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingTags: string[];
  defaultTag: string;
  nodeCount: number;
  onConfirm: (tag: string) => Promise<void>;
  isLoading: boolean;
}

export default function GroupTagSelectModal({
  isOpen,
  onClose,
  existingTags,
  defaultTag,
  nodeCount,
  onConfirm,
  isLoading,
}: GroupTagSelectModalProps) {
  const [selection, setSelection] = useState<string>(CREATE_NEW_SENTINEL);
  const [newTag, setNewTag] = useState(defaultTag);

  useEffect(() => {
    if (isOpen) {
      setNewTag(defaultTag);
      setSelection(CREATE_NEW_SENTINEL);
    }
  }, [isOpen, defaultTag]);

  const isCreatingNew = selection === CREATE_NEW_SENTINEL;
  const resolvedTag = isCreatingNew ? newTag.trim() : selection;
  const canConfirm = !isCreatingNew || resolvedTag.length > 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader>Choose Group Tag</ModalHeader>
        <ModalBody>
          <p className="text-sm text-gray-500 mb-2">
            {nodeCount} node{nodeCount !== 1 ? 's' : ''} will be copied to manual nodes.
          </p>

          <RadioGroup value={selection} onValueChange={setSelection}>
            {existingTags.map(tag => (
              <Radio key={tag} value={tag}>{tag}</Radio>
            ))}
            <Radio value={CREATE_NEW_SENTINEL}>Create new tag</Radio>
          </RadioGroup>

          {isCreatingNew && (
            <Input
              label="New tag name"
              placeholder="e.g.: work, gaming"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              className="mt-2"
            />
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={isLoading}>
            Cancel
          </Button>
          <Button
            color="primary"
            onPress={() => onConfirm(resolvedTag)}
            isLoading={isLoading}
            isDisabled={!canConfirm}
          >
            Copy {nodeCount} Nodes
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
