import { useState } from 'react';
import { useDisclosure } from '@nextui-org/react';
import { useStore } from '../../../store';
import type { Node, ManualNode } from '../../../store';
import { nodeApi } from '../../../api';
import { defaultNode, countryOptions } from '../types';

export function useNodeForm() {
  const { addManualNode, updateManualNode } = useStore();

  const { isOpen, onOpen, onClose } = useDisclosure();
  const [editingNode, setEditingNode] = useState<ManualNode | null>(null);
  const [nodeForm, setNodeForm] = useState<Node>({ ...defaultNode });
  const [nodeEnabled, setNodeEnabled] = useState(true);
  const [nodeUrl, setNodeUrl] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOpenAdd = () => {
    setEditingNode(null);
    setNodeForm({ ...defaultNode });
    setNodeEnabled(true);
    setNodeUrl('');
    setParseError('');
    onOpen();
  };

  const handleOpenEdit = (mn: ManualNode) => {
    setEditingNode(mn);
    setNodeForm(mn.node);
    setNodeEnabled(mn.enabled);
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
        ...nodeForm,
        country_emoji: country?.emoji || '🌐',
      };

      if (editingNode) {
        await updateManualNode(editingNode.id, { node: nodeData, enabled: nodeEnabled });
      } else {
        await addManualNode({ node: nodeData, enabled: nodeEnabled });
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
    nodeEnabled,
    setNodeEnabled,
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
