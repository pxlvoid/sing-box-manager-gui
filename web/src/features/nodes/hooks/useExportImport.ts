import { useState } from 'react';
import { useDisclosure } from '@nextui-org/react';
import { useStore } from '../../../store';
import { subscriptionApi, nodeApi } from '../../../api';
import { toast } from '../../../components/Toast';

export function useExportImport() {
  const { subscriptions, addNodesBulk, fetchSubscriptions, fetchNodes, fetchNodeCounts } = useStore();

  const { isOpen: isExportOpen, onOpen: onExportOpen, onClose: onExportClose } = useDisclosure();
  const { isOpen: isImportOpen, onOpen: onImportOpen, onClose: onImportClose } = useDisclosure();
  const [exportData, setExportData] = useState<{ subscriptions: { name: string; url: string }[] } | null>(null);
  const [importData, setImportData] = useState<{ subscriptions: { name: string; url: string }[]; manual_nodes: string[] } | null>(null);
  const [importing, setImporting] = useState(false);

  const handlePrepareExport = async () => {
    try {
      const subs = subscriptions.map(s => ({ name: s.name, url: s.url }));
      setExportData({ subscriptions: subs });
      onExportOpen();
    } catch (error) {
      console.error('Failed to prepare export:', error);
      toast.error('Failed to prepare export data');
    }
  };

  const handleConfirmExport = async () => {
    if (!exportData) return;
    try {
      const json = JSON.stringify({ sbm_export: true, ...exportData }, null, 2);
      await navigator.clipboard.writeText(json);
      toast.success('Copied to clipboard');
      onExportClose();
    } catch (error) {
      console.error('Failed to copy:', error);
      toast.error('Failed to copy to clipboard');
    }
  };

  const handlePrepareImport = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const data = JSON.parse(text);
      if (!data.sbm_export) {
        toast.error('Clipboard does not contain SBM export data');
        return;
      }
      const subs: { name: string; url: string }[] = data.subscriptions || [];
      const nodes: string[] = data.manual_nodes || [];
      const existingUrls = new Set(subscriptions.map(s => s.url));
      const newSubs = subs.filter(s => !existingUrls.has(s.url));
      setImportData({ subscriptions: newSubs, manual_nodes: nodes });
      onImportOpen();
    } catch {
      toast.error('Clipboard does not contain valid SBM export data');
    }
  };

  const handleConfirmImport = async () => {
    if (!importData) return;
    setImporting(true);
    try {
      let addedSubs = 0;
      let addedNodes = 0;

      for (const sub of importData.subscriptions) {
        try {
          await subscriptionApi.add(sub.name, sub.url);
          addedSubs++;
        } catch (error) {
          console.error(`Failed to add subscription ${sub.name}:`, error);
        }
      }

      if (importData.manual_nodes.length > 0) {
        const parseResponse = await nodeApi.parseBulk(importData.manual_nodes);
        const parsed = parseResponse.data.data;
        const successNodes = parsed.filter((r: any) => r.node);
        if (successNodes.length > 0) {
          const nodes = successNodes.map((r: any) => r.node);
          await addNodesBulk(nodes, undefined, 'manual');
          addedNodes = successNodes.length;
        }
      }

      toast.success(`Imported: ${addedSubs} subscriptions, ${addedNodes} nodes`);
      onImportClose();
      fetchSubscriptions();
      fetchNodes();
      fetchNodeCounts();
    } catch (error) {
      console.error('Import failed:', error);
      toast.error('Import failed');
    } finally {
      setImporting(false);
    }
  };

  return {
    isExportOpen,
    onExportClose,
    exportData,
    handlePrepareExport,
    onConfirmExport: handleConfirmExport,
    isImportOpen,
    onImportClose,
    importData,
    importing,
    handlePrepareImport,
    onConfirmImport: handleConfirmImport,
  };
}
