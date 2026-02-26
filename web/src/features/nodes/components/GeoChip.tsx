import { Chip, Tooltip } from '@nextui-org/react';
import type { GeoData } from '../../../store';

interface GeoChipProps {
  geo: GeoData | undefined;
  claimedCountry?: string;
}

export default function GeoChip({ geo, claimedCountry }: GeoChipProps) {
  if (!geo) {
    return <span className="text-xs text-gray-400">-</span>;
  }
  if (geo.status !== 'success') {
    return (
      <Chip size="sm" variant="flat" color="warning">
        UNKNOWN
      </Chip>
    );
  }

  const mismatch = claimedCountry && claimedCountry !== geo.country_code && claimedCountry !== '';

  const detailRows = (
    <div className="text-xs space-y-0.5 py-1">
      <div><span className="text-gray-400">Country:</span> {geo.country} ({geo.country_code})</div>
      <div><span className="text-gray-400">Region:</span> {geo.region_name}</div>
      <div><span className="text-gray-400">City:</span> {geo.city}</div>
      <div><span className="text-gray-400">ISP:</span> {geo.isp}</div>
      <div><span className="text-gray-400">Org:</span> {geo.org}</div>
      <div><span className="text-gray-400">AS:</span> {geo.as}</div>
      <div><span className="text-gray-400">IP:</span> <span className="font-mono">{geo.query_ip}</span></div>
      <div><span className="text-gray-400">Timezone:</span> {geo.timezone}</div>
      {mismatch && (
        <div className="text-warning-500 font-medium mt-1">
          Country mismatch: claimed {claimedCountry}, actual {geo.country_code}
        </div>
      )}
    </div>
  );

  const label = `${geo.country_code} · ${geo.city || geo.region_name || '?'}`;
  const color = mismatch ? 'warning' : 'default';

  return (
    <Tooltip content={detailRows} placement="top-start" showArrow delay={100}>
      <Chip size="sm" variant="flat" color={color} className="cursor-help">
        {label}
      </Chip>
    </Tooltip>
  );
}
