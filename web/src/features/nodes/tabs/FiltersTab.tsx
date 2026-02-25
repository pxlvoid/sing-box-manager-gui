import {
  Card,
  CardBody,
  Chip,
  Button,
  Switch,
} from '@nextui-org/react';
import { Filter as FilterIcon, Pencil, Trash2 } from 'lucide-react';
import type { Filter } from '../../../store';
import { countryOptions } from '../types';

interface FiltersTabProps {
  filters: Filter[];
  onEdit: (filter: Filter) => void;
  onDelete: (id: string) => void;
  onToggle: (filter: Filter) => void;
}

export default function FiltersTab({
  filters,
  onEdit,
  onDelete,
  onToggle,
}: FiltersTabProps) {
  if (filters.length === 0) {
    return (
      <Card className="mt-4">
        <CardBody className="py-12 text-center">
          <FilterIcon className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">No filters yet, click the button above to add one</p>
          <p className="text-xs text-gray-400 mt-2">
            Filters allow you to filter nodes by country or keywords, and create custom node groups
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-3 mt-4">
      {filters.map((filter) => (
        <Card key={filter.id}>
          <CardBody className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <FilterIcon className="w-5 h-5 text-secondary shrink-0" />
              <div className="min-w-0">
                <h3 className="font-medium truncate">{filter.name}</h3>
                <div className="flex flex-wrap gap-1 mt-1">
                  {filter.include_countries?.length > 0 && (
                    <Chip size="sm" variant="flat" color="success">
                      {filter.include_countries.map(code =>
                        countryOptions.find(c => c.code === code)?.emoji || code
                      ).join(' ')} Include
                    </Chip>
                  )}
                  {filter.exclude_countries?.length > 0 && (
                    <Chip size="sm" variant="flat" color="danger">
                      {filter.exclude_countries.map(code =>
                        countryOptions.find(c => c.code === code)?.emoji || code
                      ).join(' ')} Exclude
                    </Chip>
                  )}
                  {filter.include?.length > 0 && (
                    <Chip size="sm" variant="flat">
                      Keywords: {filter.include.join('|')}
                    </Chip>
                  )}
                  <Chip size="sm" variant="flat" color="secondary">
                    {filter.mode === 'urltest' ? 'Auto Speed Test' : 'Manual Select'}
                  </Chip>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPress={() => onEdit(filter)}
              >
                <Pencil className="w-4 h-4" />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                color="danger"
                onPress={() => onDelete(filter.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <Switch
                isSelected={filter.enabled}
                onValueChange={() => onToggle(filter)}
              />
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
