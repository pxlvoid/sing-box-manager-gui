import { useState } from 'react';
import { useDisclosure } from '@nextui-org/react';
import { useStore } from '../../../store';
import type { Node, UnifiedNode } from '../../../store';
import { nodeApi } from '../../../api';
import { defaultNode, countryOptions } from '../types';

export function useNodeForm() {
  const { addNode, updateNode } = useStore();

  const { isOpen, onOpen, onClose } = useDisclosure();
  const [editingNode, setEditingNode] = useState<UnifiedNode | null>(null);
  const [nodeForm, setNodeForm] = useState<Node>({ ...defaultNode });
  const [nodeUrl, setNodeUrl] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOpenAdd = () => {
    setEditingNode(null);
    setNodeForm({ ...defaultNode });
    setNodeUrl('');
    setParseError('');
    onOpen();
  };

  const handleOpenEdit = (node: UnifiedNode) => {
    setEditingNode(node);
    setNodeForm({
      tag: node.tag,
      type: node.type,
      server: node.server,
      server_port: node.server_port,
      country: node.country,
      country_emoji: node.country_emoji,
      extra: node.extra,
    });
    setNodeUrl('');
    setParseError('');
    onOpen();
  };

  const handleParseUrl = async () => {
    if (!nodeUrl.trim()) return;

    setIsParsing(true);
    setParseError('');

    try {
      const response = await nodeApi.parse(nodeUrl.trim());
      const parsedNode = response.data.data as Node;
      setNodeForm(parsedNode);
    } catch (error: any) {
      const message = error.response?.data?.error || 'Failed to parse, please check the link format';
      setParseError(message);
    } finally {
      setIsParsing(false);
    }
  };

  const handleSave = async () => {
    if (!nodeForm.tag || !nodeForm.server) return;

    setIsSubmitting(true);
    try {
      const country = countryOptions.find(c => c.code === nodeForm.country);
      const nodeData = {
        tag: nodeForm.tag,
        type: nodeForm.type,
        server: nodeForm.server,
        server_port: nodeForm.server_port,
        country: nodeForm.country,
        country_emoji: country?.emoji || '🌐',
        extra: nodeForm.extra,
      };

      if (editingNode) {
        await updateNode(editingNode.id, nodeData);
      } else {
        await addNode(nodeData);
      }
      onClose();
    } catch (error) {
      console.error('Failed to save node:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getExtra = (...keys: string[]): any => {
    let obj: any = nodeForm.extra;
    for (const key of keys) {
      if (obj == null) return undefined;
      obj = obj[key];
    }
    return obj;
  };

  const setExtra = (...args: any[]) => {
    const value = args.pop();
    const keys: string[] = args;
    const extra = { ...nodeForm.extra } as Record<string, any>;

    if (keys.length === 1) {
      if (value === '' || value === undefined) {
        delete extra[keys[0]];
      } else {
        extra[keys[0]] = value;
      }
    } else if (keys.length === 2) {
      const nested = { ...(extra[keys[0]] || {}) };
      if (value === '' || value === undefined) {
        delete nested[keys[1]];
      } else {
        nested[keys[1]] = value;
      }
      if (Object.keys(nested).length === 0) {
        delete extra[keys[0]];
      } else {
        extra[keys[0]] = nested;
      }
    } else if (keys.length === 3) {
      const nested = { ...(extra[keys[0]] || {}) };
      const deep = { ...(nested[keys[1]] || {}) };
      if (value === '' || value === undefined) {
        delete deep[keys[2]];
      } else {
        deep[keys[2]] = value;
      }
      if (Object.keys(deep).length === 0) {
        delete nested[keys[1]];
      } else {
        nested[keys[1]] = deep;
      }
      if (Object.keys(nested).length === 0) {
        delete extra[keys[0]];
      } else {
        extra[keys[0]] = nested;
      }
    }

    setNodeForm({ ...nodeForm, extra });
  };

  return {
    isOpen,
    onClose,
    editingNode,
    nodeForm,
    setNodeForm,
    nodeUrl,
    setNodeUrl,
    isParsing,
    parseError,
    isSubmitting,
    handleOpenAdd,
    handleOpenEdit,
    onParseUrl: handleParseUrl,
    onSave: handleSave,
    getExtra,
    setExtra,
  };
}
