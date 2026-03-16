import type { DeviceField } from '../services/api.service';

export type VizType = 'gauge' | 'chart' | 'badge';

export function getVisibleFieldsByVizType(
  fields: DeviceField[],
  opts: { gauge?: boolean; chart?: boolean; badge?: boolean } = {}
): Record<VizType, DeviceField[]> {
  const visible = fields;
  const gauge: DeviceField[] = [];
  const chart: DeviceField[] = [];
  const badge: DeviceField[] = [];
  for (const f of visible) {
    const isNumeric = f.data_type === 'num' || f.data_type === 'number';
    if (opts.gauge !== false && isNumeric) gauge.push(f);
    if (opts.chart !== false && isNumeric && f.category !== 'state') chart.push(f);
    if (opts.badge !== false) badge.push(f);
  }
  return { gauge, chart, badge };
}
