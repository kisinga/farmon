/**
 * Default product catalog seed data.
 *
 * These are the known-good products MajiFlow recommends.
 * Users can edit, add, or deactivate items in the desktop app.
 */

import type { CatalogItem, CatalogItemSpecs } from './types';

export const DEFAULT_CATALOG: CatalogItem[] = [
  // ---------------------------------------------------------------------------
  // Base Infrastructure
  // ---------------------------------------------------------------------------
  {
    id: 'ctrl-kc868-a16',
    category: 'controller',
    subCategory: 'esp32_relay_board',
    name: 'Kincony KC868-A16',
    manufacturer: 'Kincony',
    manufacturerPartNumber: 'KC868-A16',
    specs: { voltage: '12V DC', communication: 'Ethernet + WiFi', relays: '16', inputs: '16', adc: '4' },
    unitCostUsd: 5850,
    currency: 'KES',
    description: 'Industrial ESP32 relay controller with 16 relay outputs, 16 digital inputs, 4 ADC channels, Ethernet, and WiFi.',
    selectionHelp: 'Primary recommended controller for all MajiFlow installations. DIN-rail mountable.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'compute-rpi-3bp',
    category: 'base_infra',
    subCategory: 'single_board_computer',
    name: 'Raspberry Pi 3B+',
    manufacturer: 'Raspberry Pi Foundation',
    manufacturerPartNumber: 'RPI3-MODBP',
    specs: { voltage: '5V DC', memory: '1GB', storage: 'microSD', ports: '4x USB, Ethernet, HDMI' },
    unitCostUsd: 4550,
    currency: 'KES',
    description: 'Home Assistant OS host. Quad-core 1.4GHz, 1GB RAM, onboard WiFi and Ethernet.',
    selectionHelp: 'Required for Home Assistant OS. Runs the local automation hub.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'power-ups-12v',
    category: 'power',
    subCategory: 'ups',
    name: '12V DC UPS / Power Bank',
    manufacturer: 'Generic',
    manufacturerPartNumber: 'UPS-12V-20AH',
    specs: { voltage: '12V DC', capacity: '20Ah', output: '12V/5A', switchover: '<10ms' },
    unitCostUsd: 3640,
    currency: 'KES',
    description: '12V DC uninterruptible power supply with lithium battery backup. Automatic switchover.',
    selectionHelp: 'Keeps the controller and Pi alive during power outages. Essential for water systems.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'power-solar-kit',
    category: 'power',
    subCategory: 'solar',
    name: 'Solar Panel + Charge Controller Kit',
    manufacturer: 'Generic',
    manufacturerPartNumber: 'SP-100W-KIT',
    specs: { wattage: '100W', voltage: '12V', controller: 'PWM 10A', panelSize: '100W poly/mono' },
    unitCostUsd: 7150,
    currency: 'KES',
    description: '100W solar panel with 10A PWM charge controller. Keeps the UPS battery topped up.',
    selectionHelp: 'Reduces running costs and ensures off-grid capability. Always recommended.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'enclosure-din-ip54',
    category: 'enclosure',
    subCategory: 'din_rail',
    name: 'DIN Rail Enclosure IP54',
    manufacturer: 'Fibox',
    manufacturerPartNumber: 'PC-300-300-150',
    specs: { ipRating: 'IP54', dimensions: '300x300x150mm', material: 'polycarbonate', modules: '18' },
    unitCostUsd: 4160,
    currency: 'KES',
    description: 'IP54 polycarbonate enclosure with DIN rail mounting. Houses controller, Pi, and power supplies.',
    selectionHelp: 'IP54 is sufficient for covered outdoor installs. Upgrade to IP65 for direct exposure.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'relay-30a-module',
    category: 'relay',
    subCategory: 'high_current_relay',
    name: '30A Relay Module',
    manufacturer: 'SainSmart',
    manufacturerPartNumber: '30A-RELAY-1CH',
    specs: { voltage: '12V DC', current: '30A', contacts: 'SPDT', coil: '12V' },
    unitCostUsd: 1105,
    currency: 'KES',
    description: 'Single-channel 30A relay module for high-current pump switching. 12V coil.',
    selectionHelp: 'Required for direct pump control (non-VFD). Omit if using a VFD.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'cable-valve-2c',
    category: 'base_infra',
    subCategory: 'cable',
    name: 'Valve Cable 2-Core 1.0mm²',
    manufacturer: 'Generic',
    manufacturerPartNumber: 'CV-2C-1.0',
    specs: { cores: '2', gauge: '1.0mm²', rating: '300V', length: 'per meter' },
    unitCostUsd: 104,
    currency: 'KES',
    description: 'Two-core 1.0mm² cable for valve actuator wiring. Price per meter.',
    selectionHelp: 'Allow 10-20m per valve depending on layout.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'cable-sensor-shielded',
    category: 'base_infra',
    subCategory: 'cable',
    name: 'Sensor Cable Shielded Twisted Pair 0.34mm²',
    manufacturer: 'Generic',
    manufacturerPartNumber: 'STP-2PR-0.34',
    specs: { cores: '2 pair', gauge: '0.34mm²', shield: 'foil+braid', length: 'per meter' },
    unitCostUsd: 156,
    currency: 'KES',
    description: 'Shielded twisted pair for flow sensor and level sensor signal runs. Price per meter.',
    selectionHelp: 'Allow 5-15m per sensor depending on layout.',
    isActive: true,
    isUserDefined: false,
  },

  // ---------------------------------------------------------------------------
  // Valves — 12V Electrically Actuated Ball Valves
  // ---------------------------------------------------------------------------
  {
    id: 'valve-bv12-dn15-atv',
    category: 'valve',
    subCategory: 'ball_valve',
    name: '12V DC Electric Ball Valve DN15',
    manufacturer: 'ATV Motors',
    manufacturerPartNumber: 'ATV-BV12-15',
    specs: { portSize: 'DN15', voltage: '12V DC', pressureRating: '1.6MPa', material: 'brass', actuator: 'CR2-01' },
    unitCostUsd: 2860,
    currency: 'KES',
    description: '2-way brass ball valve with 12V DC electric actuator. DN15 (1/2") BSP thread.',
    selectionHelp: 'Default choice for DN15 systems. Reliable in hard water. ATV has good field feedback.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'valve-bv12-dn15-vx',
    category: 'valve',
    subCategory: 'ball_valve',
    name: '12V DC Electric Ball Valve DN15',
    manufacturer: 'VX Industrial',
    manufacturerPartNumber: 'VX-EV15-12',
    specs: { portSize: 'DN15', voltage: '12V DC', pressureRating: '1.0MPa', material: 'SS304', actuator: 'standard' },
    unitCostUsd: 3380,
    currency: 'KES',
    description: '2-way stainless steel ball valve with 12V DC actuator. DN15 (1/2") BSP thread.',
    selectionHelp: 'Stainless steel body — better for corrosive or saline water. Slightly higher cost.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'valve-bv12-dn20-atv',
    category: 'valve',
    subCategory: 'ball_valve',
    name: '12V DC Electric Ball Valve DN20',
    manufacturer: 'ATV Motors',
    manufacturerPartNumber: 'ATV-BV12-20',
    specs: { portSize: 'DN20', voltage: '12V DC', pressureRating: '1.6MPa', material: 'brass', actuator: 'CR2-01' },
    unitCostUsd: 3640,
    currency: 'KES',
    description: '2-way brass ball valve with 12V DC electric actuator. DN20 (3/4") BSP thread.',
    selectionHelp: 'Most common size for residential and small commercial systems.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'valve-bv12-dn20-vx',
    category: 'valve',
    subCategory: 'ball_valve',
    name: '12V DC Electric Ball Valve DN20',
    manufacturer: 'VX Industrial',
    manufacturerPartNumber: 'VX-EV20-12',
    specs: { portSize: 'DN20', voltage: '12V DC', pressureRating: '1.0MPa', material: 'SS304', actuator: 'standard' },
    unitCostUsd: 4160,
    currency: 'KES',
    description: '2-way stainless steel ball valve with 12V DC actuator. DN20 (3/4") BSP thread.',
    selectionHelp: 'SS304 body for corrosive environments.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'valve-bv12-dn25-atv',
    category: 'valve',
    subCategory: 'ball_valve',
    name: '12V DC Electric Ball Valve DN25',
    manufacturer: 'ATV Motors',
    manufacturerPartNumber: 'ATV-BV12-25',
    specs: { portSize: 'DN25', voltage: '12V DC', pressureRating: '1.6MPa', material: 'brass', actuator: 'CR2-02' },
    unitCostUsd: 4550,
    currency: 'KES',
    description: '2-way brass ball valve with 12V DC electric actuator. DN25 (1") BSP thread.',
    selectionHelp: 'Use for main lines or higher-flow zones.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'valve-bv12-dn25-vx',
    category: 'valve',
    subCategory: 'ball_valve',
    name: '12V DC Electric Ball Valve DN25',
    manufacturer: 'VX Industrial',
    manufacturerPartNumber: 'VX-EV25-12',
    specs: { portSize: 'DN25', voltage: '12V DC', pressureRating: '1.0MPa', material: 'SS304', actuator: 'standard' },
    unitCostUsd: 5460,
    currency: 'KES',
    description: '2-way stainless steel ball valve with 12V DC actuator. DN25 (1") BSP thread.',
    selectionHelp: 'SS304 for larger corrosive lines.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'valve-bv12-dn32-atv',
    category: 'valve',
    subCategory: 'ball_valve',
    name: '12V DC Electric Ball Valve DN32',
    manufacturer: 'ATV Motors',
    manufacturerPartNumber: 'ATV-BV12-32',
    specs: { portSize: 'DN32', voltage: '12V DC', pressureRating: '1.6MPa', material: 'brass', actuator: 'CR2-03' },
    unitCostUsd: 6240,
    currency: 'KES',
    description: '2-way brass ball valve with 12V DC electric actuator. DN32 (1-1/4") BSP thread.',
    selectionHelp: 'Commercial-grade flow. Verify pump capacity matches valve size.',
    isActive: true,
    isUserDefined: false,
  },

  // ---------------------------------------------------------------------------
  // Flow Sensors
  // ---------------------------------------------------------------------------
  {
    id: 'flow-yfs201-dn15',
    category: 'flow_sensor',
    subCategory: 'pulse_flow',
    name: 'Hall Effect Flow Sensor DN15',
    manufacturer: 'Sea Electronics',
    manufacturerPartNumber: 'YF-S201-DN15',
    specs: { portSize: 'DN15', voltage: '5-24V DC', flowRange: '1-30 L/min', pulsesPerLiter: '450', material: 'nylon' },
    unitCostUsd: 975,
    currency: 'KES',
    description: 'Hall effect water flow sensor with 1/2" BSP threads. 450 pulses per liter.',
    selectionHelp: 'Reliable and cheap. Good for small zones and residential systems.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'flow-yfs201-dn20',
    category: 'flow_sensor',
    subCategory: 'pulse_flow',
    name: 'Hall Effect Flow Sensor DN20',
    manufacturer: 'Sea Electronics',
    manufacturerPartNumber: 'YF-S201-DN20',
    specs: { portSize: 'DN20', voltage: '5-24V DC', flowRange: '2-60 L/min', pulsesPerLiter: '300', material: 'nylon' },
    unitCostUsd: 1170,
    currency: 'KES',
    description: 'Hall effect water flow sensor with 3/4" BSP threads. 300 pulses per liter.',
    selectionHelp: 'Use for main lines or higher-flow zones.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'flow-yfs201-dn25',
    category: 'flow_sensor',
    subCategory: 'pulse_flow',
    name: 'Hall Effect Flow Sensor DN25',
    manufacturer: 'Sea Electronics',
    manufacturerPartNumber: 'YF-S201-DN25',
    specs: { portSize: 'DN25', voltage: '5-24V DC', flowRange: '5-100 L/min', pulsesPerLiter: '200', material: 'nylon' },
    unitCostUsd: 1495,
    currency: 'KES',
    description: 'Hall effect water flow sensor with 1" BSP threads. 200 pulses per liter.',
    selectionHelp: 'For commercial systems with higher flow requirements.',
    isActive: true,
    isUserDefined: false,
  },
  {
    id: 'flow-bronze-dn20',
    category: 'flow_sensor',
    subCategory: 'pulse_flow',
    name: 'Brass Hall Effect Flow Sensor DN20',
    manufacturer: 'FlowMax',
    manufacturerPartNumber: 'FM-BR-20',
    specs: { portSize: 'DN20', voltage: '5-24V DC', flowRange: '2-60 L/min', pulsesPerLiter: '280', material: 'brass' },
    unitCostUsd: 2340,
    currency: 'KES',
    description: 'Brass-bodied Hall effect flow sensor. More durable than nylon in hard water.',
    selectionHelp: 'Upgrade for hard water or high-temperature applications.',
    isActive: true,
    isUserDefined: false,
  },
];

/**
 * Find the default catalog item for a category + spec match.
 * Used by the quick questionnaire to auto-select SKUs.
 */
export function findDefaultCatalogItem(
  catalog: CatalogItem[],
  category: CatalogItem['category'],
  subCategory: string | undefined,
  specMatch: Partial<CatalogItemSpecs>,
): CatalogItem | undefined {
  const candidates = catalog.filter(
    (c) => c.isActive && c.category === category && (!subCategory || c.subCategory === subCategory),
  );
  if (candidates.length === 0) return undefined;

  const hasSpecCriteria = Object.keys(specMatch).length > 0;

  // Prefer exact spec match when criteria are given
  if (hasSpecCriteria) {
    for (const c of candidates) {
      let matches = true;
      for (const [key, value] of Object.entries(specMatch)) {
        if (c.specs[key] !== value) {
          matches = false;
          break;
        }
      }
      if (matches) return c;
    }
    return undefined;
  }

  // No spec criteria — return first active candidate
  return candidates[0];
}
