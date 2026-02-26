import { useState } from 'react';
import { useDisclosure } from '@nextui-org/react';
import { useStore } from '../../../store';
import { nodeApi } from '../../../api';
import type { Node } from '../../../store';

export function useBulkAddForm() {
  const { addNodesBulk } = useStore();

  const { isOpen, onOpen, onClose } = useDisclosure();
  const [bulkUrls, setBulkUrls] = useState('');
  const [bulkGroupTag, setBulkGroupTag] = useState('');
  const [bulkParsing, setBulkParsing] = useState(false);
  const [bulkAdding, setBulkAdding] = useState(false);
  const [bulkResults, setBulkResults] = useState<Array<{ url: string; node?: Node; error?: string }>>([]);

  const handleOpen = () => {
    setBulkUrls('');
    setBulkGroupTag('');
    setBulkResults([]);
    setBulkParsing(false);
    setBulkAdding(false);
    onOpen();
  };

  const handleParse = async () => {
    const urls = bulkUrls.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    if (urls.length === 0) return;

    setBulkParsing(true);
    try {
      const response = await nodeApi.parseBulk(urls);
      setBulkResults(response.data.data);
    } catch (error: any) {
      console.error('Failed to parse URLs:', error);
    } finally {
      setBulkParsing(false);
    }
  };

  const handleAdd = async () => {
    const successNodes = bulkResults.filter(r => r.node);
    if (successNodes.length === 0) return;

    setBulkAdding(true);
    try {
      const nodes = successNodes.map(r => r.node!);
      await addNodesBulk(nodes, bulkGroupTag.trim() || undefined, 'manual');
      onClose();
    } catch (error: any) {
      console.error('Failed to add nodes:', error);
    } finally {
      setBulkAdding(false);
    }
  };

  return {
    isOpen,
    onClose,
    bulkUrls,
    setBulkUrls,
    bulkGroupTag,
    setBulkGroupTag,
    bulkParsing,
    bulkAdding,
    bulkResults,
    handleOpen,
    onParse: handleParse,
    onAdd: handleAdd,
  };
}
