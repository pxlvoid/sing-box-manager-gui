import { useState } from 'react';
import { useDisclosure } from '@nextui-org/react';
import { useStore } from '../../../store';
import type { Subscription } from '../../../store';

export function useSubscriptionForm() {
  const { addSubscription, updateSubscription } = useStore();

  const { isOpen, onOpen, onClose } = useDisclosure();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);

  const handleOpenAdd = () => {
    setEditingSubscription(null);
    setName('');
    setUrl('');
    onOpen();
  };

  const handleOpenEdit = (sub: Subscription) => {
    setEditingSubscription(sub);
    setName(sub.name);
    setUrl(sub.url);
    onOpen();
  };

  const handleSave = async () => {
    if (!name || !url) return;

    setIsSubmitting(true);
    try {
      if (editingSubscription) {
        await updateSubscription(editingSubscription.id, name, url);
      } else {
        await addSubscription(name, url);
      }
      setName('');
      setUrl('');
      setEditingSubscription(null);
      onClose();
    } catch (error) {
      console.error(editingSubscription ? 'Failed to update subscription:' : 'Failed to add subscription:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    isOpen,
    onClose,
    name,
    setName,
    url,
    setUrl,
    isSubmitting,
    editingSubscription,
    handleOpenAdd,
    handleOpenEdit,
    onSave: handleSave,
  };
}
