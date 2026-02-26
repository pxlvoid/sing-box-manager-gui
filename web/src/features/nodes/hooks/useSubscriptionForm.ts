import { useState } from 'react';
import { useDisclosure } from '@nextui-org/react';
import { useStore } from '../../../store';
import type { Subscription } from '../../../store';

const NAME_ADJECTIVES = [
  'Swift',
  'Bright',
  'Calm',
  'Solar',
  'Lunar',
  'Arctic',
  'Urban',
  'Silent',
  'Rapid',
  'Golden',
  'Crimson',
  'Azure',
  'Emerald',
  'Silver',
  'Amber',
  'Neon',
  'Velvet',
  'Cosmic',
  'Misty',
  'Frosty',
  'Stormy',
  'Wild',
  'Brisk',
  'Nimble',
  'Steady',
  'Turbo',
  'Prime',
  'Noble',
  'Crystal',
  'Iron',
  'Cloud',
  'Shadow',
  'Electric',
  'Stellar',
  'Nova',
  'Polar',
  'Coral',
  'Sapphire',
  'Ruby',
  'Obsidian',
];

const NAME_NOUNS = [
  'Falcon',
  'Harbor',
  'Bridge',
  'Comet',
  'River',
  'Atlas',
  'Beacon',
  'Aurora',
  'Voyager',
  'Summit',
  'Pioneer',
  'Ranger',
  'Transit',
  'Gateway',
  'Relay',
  'Orbit',
  'Pulse',
  'Anchor',
  'Circuit',
  'Vertex',
  'Signal',
  'Breeze',
  'Thunder',
  'Rocket',
  'Drift',
  'Tide',
  'Glider',
  'Peak',
  'Field',
  'Horizon',
  'Forest',
  'Meadow',
  'Nimbus',
  'Trail',
  'Spark',
  'Echo',
  'Prism',
  'Canyon',
  'Delta',
  'Bastion',
];

const NAME_SUFFIXES = [
  'Link',
  'Route',
  'Node',
  'Lane',
  'Hub',
  'Core',
  'Gate',
  'Path',
  'Point',
  'Flow',
];

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function parseUniqueUrls(raw: string): string[] {
  return [...new Set(raw.split('\n').map((item) => item.trim()).filter((item) => item.length > 0))];
}

function generateReadableName(existingNames: Set<string>): string {
  for (let i = 0; i < 200; i++) {
    const adjective = pickRandom(NAME_ADJECTIVES);
    const noun = pickRandom(NAME_NOUNS);
    const suffix = pickRandom(NAME_SUFFIXES);
    const digits = Math.floor(100 + Math.random() * 900);
    const template = Math.floor(Math.random() * 4);
    let candidate = `${adjective} ${noun} ${digits}`;

    if (template === 1) {
      candidate = `${noun} ${suffix} ${digits}`;
    } else if (template === 2) {
      candidate = `${adjective} ${suffix} ${digits}`;
    } else if (template === 3) {
      candidate = `${adjective}-${noun} ${digits}`;
    }

    const key = candidate.toLowerCase();
    if (!existingNames.has(key)) {
      existingNames.add(key);
      return candidate;
    }
  }

  const fallback = `Sub ${Math.floor(100000 + Math.random() * 900000)}`;
  existingNames.add(fallback.toLowerCase());
  return fallback;
}

export function useSubscriptionForm() {
  const { subscriptions, addSubscriptionsBulk, updateSubscription } = useStore();

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
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();

    if (editingSubscription) {
      if (!trimmedName || !trimmedUrl) return;
    } else {
      const urls = parseUniqueUrls(url);
      if (urls.length === 0) return;

      const existingNames = new Set(subscriptions.map((sub) => sub.name.toLowerCase()));
      const subs = urls.map((subUrl) => ({
        name: urls.length === 1 && trimmedName ? trimmedName : generateReadableName(existingNames),
        url: subUrl,
      }));

      setIsSubmitting(true);
      try {
        const result = await addSubscriptionsBulk(subs);
        if (result.added > 0) {
          setName('');
          setUrl('');
          setEditingSubscription(null);
          onClose();
        }
      } catch (error) {
        console.error('Failed to add subscriptions:', error);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingSubscription) {
        await updateSubscription(editingSubscription.id, trimmedName, trimmedUrl);
      }
      setName('');
      setUrl('');
      setEditingSubscription(null);
      onClose();
    } catch (error) {
      console.error('Failed to update subscription:', error);
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
