/**
 * Default product catalog seed data.
 *
 * Component definitions live in code (schema). Manufacturer lines and quote
 * defaults are seed data. Users edit manufacturer lines and defaults in the
 * desktop app.
 */

import type {
  ComponentDefinition,
  ProductLine,
  ProductVariant,
  QuoteDefaults,
} from './types';

// ---------------------------------------------------------------------------
// Component Registry — schema, not data
// ---------------------------------------------------------------------------

export const COMPONENT_REGISTRY: Record<string, ComponentDefinition> = {
  controller: {
    id: 'controller',
    category: 'controller',
    subCategory: 'esp32_relay_board',
    name: 'Controller',
    description: 'Main ESP32 relay controller for the system.',
    parameters: [],
    defaultParams: {},
  },
  compute: {
    id: 'compute',
    category: 'base_infra',
    subCategory: 'single_board_computer',
    name: 'Home Assistant Host',
    description: 'Single-board computer running the local automation hub.',
    parameters: [],
    defaultParams: {},
  },
  power_ups: {
    id: 'power_ups',
    category: 'power',
    subCategory: 'ups',
    name: 'UPS / Power Bank',
    description: 'Battery backup for controller and compute.',
    parameters: [],
    defaultParams: {},
  },
  power_solar: {
    id: 'power_solar',
    category: 'power',
    subCategory: 'solar',
    name: 'Solar Kit',
    description: 'Solar panel and charge controller for off-grid sites.',
    parameters: [],
    defaultParams: {},
  },
  enclosure: {
    id: 'enclosure',
    category: 'enclosure',
    subCategory: 'din_rail',
    name: 'DIN Rail Enclosure',
    description: 'Polycarbonate enclosure with DIN rail mounting.',
    parameters: [],
    defaultParams: {},
  },
  relay: {
    id: 'relay',
    category: 'relay',
    subCategory: 'high_current_relay',
    name: 'Pump Relay',
    description: 'High-current relay module for pump switching.',
    parameters: [],
    defaultParams: {},
  },
  cable_valve: {
    id: 'cable_valve',
    category: 'base_infra',
    subCategory: 'cable',
    name: 'Valve Cable',
    description: 'Two-core cable for valve actuator wiring.',
    parameters: [{ name: 'gauge', label: 'Gauge', type: 'select', options: ['1.0mm²', '1.5mm²'] }],
    defaultParams: { gauge: '1.0mm²' },
  },
  cable_sensor: {
    id: 'cable_sensor',
    category: 'base_infra',
    subCategory: 'cable',
    name: 'Sensor Cable',
    description: 'Shielded twisted pair for sensor signal runs.',
    parameters: [{ name: 'gauge', label: 'Gauge', type: 'select', options: ['0.34mm²', '0.5mm²'] }],
    defaultParams: { gauge: '0.34mm²' },
  },
  valve: {
    id: 'valve',
    category: 'valve',
    subCategory: 'ball_valve',
    name: 'Ball Valve',
    description: '12V DC electrically actuated ball valve.',
    parameters: [
      { name: 'portSize', label: 'Port Size', type: 'select', options: ['DN15', 'DN20', 'DN25', 'DN32'] },
    ],
    defaultParams: { portSize: 'DN20' },
  },
  flow_sensor: {
    id: 'flow_sensor',
    category: 'flow_sensor',
    subCategory: 'pulse_flow',
    name: 'Flow Sensor',
    description: 'Hall effect water flow sensor.',
    parameters: [
      { name: 'portSize', label: 'Port Size', type: 'select', options: ['DN15', 'DN20', 'DN25'] },
    ],
    defaultParams: { portSize: 'DN20' },
  },
};

// ---------------------------------------------------------------------------
// Seed Manufacturer Lines
// ---------------------------------------------------------------------------

function v(portSize: string, unitCost: number, partNumber?: string): ProductVariant {
  return { params: { portSize }, unitCost, currency: 'USD', partNumber, isActive: true };
}

function c(gauge: string, unitCost: number): ProductVariant {
  return { params: { gauge }, unitCost, currency: 'USD', isActive: true };
}

export const DEFAULT_LINES: ProductLine[] = [
  {
    id: 'ctrl-kc868-a16',
    componentId: 'controller',
    manufacturer: 'Kincony',
    name: 'KC868-A16',
    manufacturerPartNumber: 'KC868-A16',
    description: 'Industrial ESP32 relay controller with 16 relay outputs, 16 digital inputs, 4 ADC channels, Ethernet, and WiFi.',
    selectionHelp: 'Primary recommended controller for all MajiFlow installations. DIN-rail mountable.',
    baseSpecs: { voltage: '12V DC', communication: 'Ethernet + WiFi', relays: '16', inputs: '16', adc: '4' },
    variants: [{ params: {}, unitCost: 42.5, currency: 'USD', isActive: true }],
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'compute-rpi-3bp',
    componentId: 'compute',
    manufacturer: 'Raspberry Pi Foundation',
    name: 'Raspberry Pi 3B+',
    manufacturerPartNumber: 'RPI3-MODBP',
    description: 'Home Assistant OS host. Quad-core 1.4GHz, 1GB RAM, onboard WiFi and Ethernet.',
    selectionHelp: 'Required for Home Assistant OS. Runs the local automation hub.',
    baseSpecs: { voltage: '5V DC', memory: '1GB', storage: 'microSD', ports: '4x USB, Ethernet, HDMI' },
    variants: [{ params: {}, unitCost: 33.0, currency: 'USD', isActive: true }],
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'power-ups-12v',
    componentId: 'power_ups',
    manufacturer: 'Generic',
    name: '12V DC UPS / Power Bank',
    manufacturerPartNumber: 'UPS-12V-20AH',
    description: '12V DC uninterruptible power supply with lithium battery backup. Automatic switchover.',
    selectionHelp: 'Keeps the controller and Pi alive during power outages. Essential for water systems.',
    baseSpecs: { voltage: '12V DC', capacity: '20Ah', output: '12V/5A', switchover: '<10ms' },
    variants: [{ params: {}, unitCost: 26.4, currency: 'USD', isActive: true }],
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'power-solar-kit',
    componentId: 'power_solar',
    manufacturer: 'Generic',
    name: 'Solar Panel + Charge Controller Kit',
    manufacturerPartNumber: 'SP-100W-KIT',
    description: '100W solar panel with 10A PWM charge controller. Keeps the UPS battery topped up.',
    selectionHelp: 'Reduces running costs and ensures off-grid capability. Always recommended.',
    baseSpecs: { wattage: '100W', voltage: '12V', controller: 'PWM 10A', panelSize: '100W poly/mono' },
    variants: [{ params: {}, unitCost: 51.9, currency: 'USD', isActive: true }],
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'enclosure-din-ip54',
    componentId: 'enclosure',
    manufacturer: 'Fibox',
    name: 'DIN Rail Enclosure IP54',
    manufacturerPartNumber: 'PC-300-300-150',
    description: 'IP54 polycarbonate enclosure with DIN rail mounting. Houses controller, Pi, and power supplies.',
    selectionHelp: 'IP54 is sufficient for covered outdoor installs. Upgrade to IP65 for direct exposure.',
    baseSpecs: { ipRating: 'IP54', dimensions: '300x300x150mm', material: 'polycarbonate', modules: '18' },
    variants: [{ params: {}, unitCost: 30.2, currency: 'USD', isActive: true }],
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'relay-30a-module',
    componentId: 'relay',
    manufacturer: 'SainSmart',
    name: '30A Relay Module',
    manufacturerPartNumber: '30A-RELAY-1CH',
    description: 'Single-channel 30A relay module for high-current pump switching. 12V coil.',
    selectionHelp: 'Required for direct pump control (non-VFD). Omit if using a VFD.',
    baseSpecs: { voltage: '12V DC', current: '30A', contacts: 'SPDT', coil: '12V' },
    variants: [{ params: {}, unitCost: 8.0, currency: 'USD', isActive: true }],
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'cable-valve-2c',
    componentId: 'cable_valve',
    manufacturer: 'Generic',
    name: 'Valve Cable 2-Core 1.0mm²',
    manufacturerPartNumber: 'CV-2C-1.0',
    description: 'Two-core 1.0mm² cable for valve actuator wiring. Price per meter.',
    selectionHelp: 'Allow 10-20m per valve depending on layout.',
    baseSpecs: { cores: '2', rating: '300V', length: 'per meter' },
    variants: [c('1.0mm²', 0.75)],
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'cable-sensor-shielded',
    componentId: 'cable_sensor',
    manufacturer: 'Generic',
    name: 'Sensor Cable Shielded Twisted Pair 0.34mm²',
    manufacturerPartNumber: 'STP-2PR-0.34',
    description: 'Shielded twisted pair for flow sensor and level sensor signal runs. Price per meter.',
    selectionHelp: 'Allow 5-15m per sensor depending on layout.',
    baseSpecs: { cores: '2 pair', shield: 'foil+braid', length: 'per meter' },
    variants: [c('0.34mm²', 1.12)],
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'valve-bv12-atv',
    componentId: 'valve',
    manufacturer: 'ATV Motors',
    name: '12V DC Electric Ball Valve',
    manufacturerPartNumber: 'ATV-BV12',
    description: '2-way brass ball valve with 12V DC electric actuator. BSP thread.',
    selectionHelp: 'Default choice for most systems. Reliable in hard water. ATV has good field feedback.',
    baseSpecs: { voltage: '12V DC', pressureRating: '1.6MPa', material: 'brass', actuator: 'CR2-01' },
    variants: [
      v('DN15', 21.2, 'ATV-BV12-15'),
      v('DN20', 27.0, 'ATV-BV12-20'),
      v('DN25', 33.7, 'ATV-BV12-25'),
      v('DN32', 46.3, 'ATV-BV12-32'),
    ],
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'valve-bv12-vx',
    componentId: 'valve',
    manufacturer: 'VX Industrial',
    name: '12V DC Electric Ball Valve',
    manufacturerPartNumber: 'VX-EV-12',
    description: '2-way stainless steel ball valve with 12V DC actuator. BSP thread.',
    selectionHelp: 'Stainless steel body — better for corrosive or saline water. Slightly higher cost.',
    baseSpecs: { voltage: '12V DC', pressureRating: '1.0MPa', material: 'SS304', actuator: 'standard' },
    variants: [
      v('DN15', 25.1, 'VX-EV15-12'),
      v('DN20', 30.8, 'VX-EV20-12'),
      v('DN25', 40.5, 'VX-EV25-12'),
      v('DN32', 48.0, 'VX-EV32-12'),
    ],
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'flow-yfs201-sea',
    componentId: 'flow_sensor',
    manufacturer: 'Sea Electronics',
    name: 'Hall Effect Flow Sensor',
    manufacturerPartNumber: 'YF-S201',
    description: 'Hall effect water flow sensor with BSP threads.',
    selectionHelp: 'Reliable and cheap. Good for small zones and residential systems.',
    baseSpecs: { voltage: '5-24V DC', material: 'nylon' },
    variants: [
      v('DN15', 7.2, 'YF-S201-DN15'),
      v('DN20', 8.7, 'YF-S201-DN20'),
      v('DN25', 11.1, 'YF-S201-DN25'),
    ],
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'flow-bronze-flowmax',
    componentId: 'flow_sensor',
    manufacturer: 'FlowMax',
    name: 'Brass Hall Effect Flow Sensor',
    manufacturerPartNumber: 'FM-BR',
    description: 'Brass-bodied Hall effect flow sensor. More durable than nylon in hard water.',
    selectionHelp: 'Upgrade for hard water or high-temperature applications.',
    baseSpecs: { voltage: '5-24V DC', material: 'brass' },
    variants: [
      v('DN20', 17.4, 'FM-BR-20'),
    ],
    isActive: true,
    isUserDefined: false,
  },
];

// ---------------------------------------------------------------------------
// Seed Quote Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_DEFAULTS: QuoteDefaults[] = [
  { componentId: 'controller', manufacturerId: 'ctrl-kc868-a16', params: {} },
  { componentId: 'compute', manufacturerId: 'compute-rpi-3bp', params: {} },
  { componentId: 'power_ups', manufacturerId: 'power-ups-12v', params: {} },
  { componentId: 'power_solar', manufacturerId: 'power-solar-kit', params: {} },
  { componentId: 'enclosure', manufacturerId: 'enclosure-din-ip54', params: {} },
  { componentId: 'relay', manufacturerId: 'relay-30a-module', params: {} },
  { componentId: 'cable_valve', manufacturerId: 'cable-valve-2c', params: { gauge: '1.0mm²' } },
  { componentId: 'cable_sensor', manufacturerId: 'cable-sensor-shielded', params: { gauge: '0.34mm²' } },
  { componentId: 'valve', manufacturerId: 'valve-bv12-atv', params: { portSize: 'DN20' } },
  { componentId: 'flow_sensor', manufacturerId: 'flow-yfs201-sea', params: { portSize: 'DN20' } },
];

// ---------------------------------------------------------------------------
// Default catalog bundle (for quote page and tests)
// ---------------------------------------------------------------------------

export const DEFAULT_CATALOG: CatalogBundle = {
  registry: COMPONENT_REGISTRY,
  lines: DEFAULT_LINES,
  defaults: DEFAULT_DEFAULTS,
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface CatalogBundle {
  registry: Record<string, ComponentDefinition>;
  lines: ProductLine[];
  defaults: QuoteDefaults[];
}

export function resolveQuoteLineItem(
  componentId: string,
  paramOverrides: Record<string, string>,
  bundle: CatalogBundle,
): { line: ProductLine; variant: ProductVariant } | null {
  const component = bundle.registry[componentId];
  if (!component) return null;

  const defaultEntry = bundle.defaults.find((d) => d.componentId === componentId);

  const candidates = bundle.lines.filter(
    (l) => l.isActive && l.componentId === componentId,
  );
  if (candidates.length === 0) return null;

  const manufacturerId = defaultEntry?.manufacturerId ?? candidates[0]!.id;
  const line = candidates.find((c) => c.id === manufacturerId) ?? candidates[0]!;

  const baseParams = defaultEntry?.params ?? component.defaultParams;
  const targetParams = { ...baseParams, ...paramOverrides };

  const variant = line.variants.find(
    (v) =>
      v.isActive &&
      Object.entries(targetParams).every(
        ([key, value]) => v.params[key] === value,
      ),
  );
  if (!variant) return null;
  if (variant.unitCost === 0) return null;

  return { line, variant };
}
