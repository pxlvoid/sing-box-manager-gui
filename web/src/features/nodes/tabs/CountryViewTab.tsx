import { Card, CardBody } from '@nextui-org/react';
import { Globe } from 'lucide-react';
import type { CountryGroup } from '../../../store';

interface CountryViewTabProps {
  countryGroups: CountryGroup[];
  onCountryClick: (group: { code: string; name: string; emoji: string }) => void;
}

export default function CountryViewTab({
  countryGroups,
  onCountryClick,
}: CountryViewTabProps) {
  if (countryGroups.length === 0) {
    return (
      <Card className="mt-4">
        <CardBody className="py-12 text-center">
          <Globe className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">No nodes yet, please add a subscription or manually add nodes first</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 mt-4">
      {countryGroups.map((group) => (
        <Card
          key={group.code}
          isPressable
          className="hover:shadow-md transition-shadow cursor-pointer"
          onPress={() => onCountryClick(group)}
        >
          <CardBody className="flex flex-row items-center gap-2 sm:gap-3 p-3 sm:p-4">
            <span className="text-2xl sm:text-3xl">{group.emoji}</span>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm sm:text-base truncate">{group.name}</h3>
              <p className="text-xs sm:text-sm text-gray-500">{group.node_count} nodes</p>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
