import { DeviceSpec } from '../services/api.types';

export interface CodecTemplate {
  id: string;
  name: string;
  spec: DeviceSpec;
}

export const CODEC_TEMPLATES: CodecTemplate[] = [
  {
    id: 'sensecap-s2105',
    name: 'SenseCAP S2105 — Soil Moisture & Temperature',
    spec: {
      type: 'codec',
      fields: [
        { key: 'soil_moisture', display_name: 'Soil Moisture', unit: '%', data_type: 'number', category: 'telemetry', access: 'r', state_class: 'm', min_value: 0, max_value: 100, sort_order: 0 },
        { key: 'soil_temperature', display_name: 'Soil Temperature', unit: '°C', data_type: 'number', category: 'telemetry', access: 'r', state_class: 'm', min_value: 0, max_value: 80, sort_order: 1 },
      ],
      controls: [],
      commands: [],
      decode_rules: [
        {
          fport: 2,
          format: 'binary_frames',
          config: {
            frame_size: 7,
            layout: [
              { offset: 0, size: 1, name: '_channel', type: 'uint8' },
              { offset: 1, size: 2, name: '_type_id', type: 'uint16_le' },
              { offset: 3, size: 4, name: '_raw_value', type: 'int32_le' },
            ],
            dispatch_key: '_type_id',
            value_key: '_raw_value',
            mappings: {
              '1794': { key: 'soil_moisture', transform: 'value / 1000' },
              '1795': { key: 'soil_temperature', transform: 'value / 1000' },
            },
          },
        },
      ],
      visualizations: [
        { name: 'Soil Conditions', viz_type: 'time_series', config: { fields: ['soil_moisture', 'soil_temperature'], y_label: 'Value', y_unit: '' }, sort_order: 0 },
        { name: 'Soil Moisture', viz_type: 'gauge', config: { field: 'soil_moisture', color_ranges: [{ max: 20, color: 'error' }, { max: 40, color: 'warning' }, { max: 100, color: 'success' }] }, sort_order: 1 },
      ],
    } as unknown as DeviceSpec,
  },
];
