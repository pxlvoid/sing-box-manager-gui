import { useState } from 'react';
import { useDisclosure } from '@nextui-org/react';
import { useStore } from '../../../store';
import type { Filter } from '../../../store';

const defaultFilterForm: Omit<Filter, 'id'> = {
  name: '',
  include: [],
  exclude: [],
  include_countries: [],
  exclude_countries: [],
  mode: 'urltest',
  urltest_config: {
    url: 'https://www.youtube.com/generate_204',
    interval: '5m',
    tolerance: 50,
  },
  subscriptions: [],
  all_nodes: true,
  enabled: true,
};

export function useFilterForm() {
  const { addFilter, updateFilter } = useStore();

  const { isOpen, onOpen, onClose } = useDisclosure();
  const [editingFilter, setEditingFilter] = useState<Filter | null>(null);
  const [filterForm, setFilterForm] = useState<Omit<Filter, 'id'>>(defaultFilterForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOpenAdd = () => {
    setEditingFilter(null);
    setFilterForm(defaultFilterForm);
    onOpen();
  };

  const handleOpenEdit = (filter: Filter) => {
    setEditingFilter(filter);
    setFilterForm({
      name: filter.name,
      include: filter.include || [],
      exclude: filter.exclude || [],
      include_countries: filter.include_countries || [],
      exclude_countries: filter.exclude_countries || [],
      mode: filter.mode || 'urltest',
      urltest_config: filter.urltest_config || {
        url: 'https://www.youtube.com/generate_204',
        interval: '5m',
        tolerance: 50,
      },
      subscriptions: filter.subscriptions || [],
      all_nodes: filter.all_nodes ?? true,
      enabled: filter.enabled,
    });
    onOpen();
  };

  const handleSave = async () => {
    if (!filterForm.name) return;

    setIsSubmitting(true);
    try {
      if (editingFilter) {
        await updateFilter(editingFilter.id, filterForm);
      } else {
        await addFilter(filterForm);
      }
      onClose();
    } catch (error) {
      console.error('Failed to save filter:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    isOpen,
    onClose,
    editingFilter,
    filterForm,
    setFilterForm,
    isSubmitting,
    handleOpenAdd,
    handleOpenEdit,
    onSave: handleSave,
  };
}
