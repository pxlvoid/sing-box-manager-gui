import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Select,
  SelectItem,
  Switch,
  Card,
  CardBody,
} from '@nextui-org/react';
import type { Filter } from '../../../store';
import { countryOptions } from '../types';

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingFilter: Filter | null;
  filterForm: Omit<Filter, 'id'>;
  setFilterForm: (form: Omit<Filter, 'id'>) => void;
  isSubmitting: boolean;
  onSave: () => void;
}

export default function FilterModal({
  isOpen,
  onClose,
  editingFilter,
  filterForm,
  setFilterForm,
  isSubmitting,
  onSave,
}: FilterModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl">
      <ModalContent>
        <ModalHeader>{editingFilter ? 'Edit Filter' : 'Add Filter'}</ModalHeader>
        <ModalBody>
          <div className="space-y-4">
            <Input
              label="Filter Name"
              placeholder="e.g.: Japan High Speed Nodes, TikTok Dedicated"
              value={filterForm.name}
              onChange={(e) => setFilterForm({ ...filterForm, name: e.target.value })}
              isRequired
            />
            <Select
              label="Include Countries"
              placeholder="Select countries to include (multiple selection)"
              selectionMode="multiple"
              selectedKeys={filterForm.include_countries}
              onSelectionChange={(keys) => {
                setFilterForm({
                  ...filterForm,
                  include_countries: Array.from(keys) as string[]
                })
              }}
            >
              {countryOptions.map((opt) => (
                <SelectItem key={opt.code} value={opt.code}>
                  {opt.name}
                </SelectItem>
              ))}
            </Select>

            <Select
              label="Exclude Countries"
              placeholder="Select countries to exclude (multiple selection)"
              selectionMode="multiple"
              selectedKeys={filterForm.exclude_countries}
              onSelectionChange={(keys) => setFilterForm({
                ...filterForm,
                exclude_countries: Array.from(keys) as string[]
              })}
            >
              {countryOptions.map((opt) => (
                <SelectItem key={opt.code} value={opt.code}>
                  {opt.name}
                </SelectItem>
              ))}
            </Select>

            <Input
              label="Include Keywords"
              placeholder="Separated by |, e.g.: high-speed|IPLC|dedicated"
              value={filterForm.include.join('|')}
              onChange={(e) => setFilterForm({
                ...filterForm,
                include: e.target.value ? e.target.value.split('|').filter(Boolean) : []
              })}
            />

            <Input
              label="Exclude Keywords"
              placeholder="Separated by |, e.g.: expired|maintenance|slow"
              value={filterForm.exclude.join('|')}
              onChange={(e) => setFilterForm({
                ...filterForm,
                exclude: e.target.value ? e.target.value.split('|').filter(Boolean) : []
              })}
            />

            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium">Apply to All Nodes</span>
                <p className="text-xs text-gray-400">When enabled, will match nodes from all subscriptions</p>
              </div>
              <Switch
                isSelected={filterForm.all_nodes}
                onValueChange={(checked) => setFilterForm({ ...filterForm, all_nodes: checked })}
              />
            </div>

            <Select
              label="Mode"
              selectedKeys={[filterForm.mode]}
              onChange={(e) => setFilterForm({ ...filterForm, mode: e.target.value })}
            >
              <SelectItem key="urltest" value="urltest">
                Auto Speed Test (urltest)
              </SelectItem>
              <SelectItem key="selector" value="selector">
                Manual Select (selector)
              </SelectItem>
            </Select>

            {filterForm.mode === 'urltest' && (
              <Card className="bg-default-50">
                <CardBody className="space-y-3">
                  <h4 className="font-medium text-sm">Speed Test Configuration</h4>
                  <Input
                    label="Speed Test URL"
                    placeholder="https://www.gstatic.com/generate_204"
                    value={filterForm.urltest_config?.url || ''}
                    onChange={(e) => setFilterForm({
                      ...filterForm,
                      urltest_config: { ...filterForm.urltest_config!, url: e.target.value }
                    })}
                    size="sm"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="Speed Test Interval"
                      placeholder="5m"
                      value={filterForm.urltest_config?.interval || ''}
                      onChange={(e) => setFilterForm({
                        ...filterForm,
                        urltest_config: { ...filterForm.urltest_config!, interval: e.target.value }
                      })}
                      size="sm"
                    />
                    <Input
                      type="number"
                      label="Tolerance Threshold (ms)"
                      placeholder="50"
                      value={String(filterForm.urltest_config?.tolerance || 50)}
                      onChange={(e) => setFilterForm({
                        ...filterForm,
                        urltest_config: { ...filterForm.urltest_config!, tolerance: parseInt(e.target.value) || 50 }
                      })}
                      size="sm"
                    />
                  </div>
                </CardBody>
              </Card>
            )}

            <div className="flex items-center justify-between">
              <span>Enable Filter</span>
              <Switch
                isSelected={filterForm.enabled}
                onValueChange={(checked) => setFilterForm({ ...filterForm, enabled: checked })}
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            Cancel
          </Button>
          <Button
            color="primary"
            onPress={onSave}
            isLoading={isSubmitting}
            isDisabled={!filterForm.name}
          >
            {editingFilter ? 'Save' : 'Add'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
