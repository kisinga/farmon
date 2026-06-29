/**
 * Product capability catalog: the canonical lists of what MajiFlow Cloud includes and
 * the optional add-on services. Single source of truth shared by the pricing page and
 * the features page so the two can never drift. CLOUD_FEATURES mirrors the live platform
 * (and the backend CoreCapabilities contract).
 */

/** A single capability row. `soon` = announced but not built (rendered muted). */
export interface PlanFeature {
  label: string;
  status: 'live' | 'soon';
}

/** An add-on service available on ANY kit (Lite, Pro or Enterprise), billed separately
 *  from the kit and the flat monthly. Orthogonal to the tier, never gated to it. */
export interface AddonService {
  /** Stable key carried in the lead payload. */
  key: string;
  name: string;
  blurb: string;
  /** Availability / price label, in plain words. */
  availability: string;
}

/** What the flat monthly (MajiFlow Cloud) includes, the same on every kit. `status:
 *  'soon'` renders muted, never as a working feature. */
export const CLOUD_FEATURES: PlanFeature[] = [
  { label: 'Live dashboard: tanks, flow, pumps and valves', status: 'live' },
  { label: 'Remote pump and valve control', status: 'live' },
  { label: 'Schedules and level-based automations', status: 'live' },
  { label: 'In-app and email alerts, with tank thresholds', status: 'live' },
  { label: 'WhatsApp and SMS alerts', status: 'soon' },
  { label: 'One dashboard across all your sites, shared access', status: 'live' },
  { label: 'Usage history', status: 'live' },
  { label: 'Pump safety and offline local control', status: 'live' },
];

export const ADDON_SERVICES: AddonService[] = [
  { key: 'water_quality', name: 'Water quality monitoring', blurb: 'pH, EC, turbidity and more, with managed probe maintenance.', availability: 'On request' },
  { key: 'billing', name: 'Tenant and customer billing', blurb: 'Bill tenants or customers for the water they use.', availability: 'Coming soon' },
  { key: 'metering', name: 'Metering and protection', blurb: 'Sell water by volume, with shrinkage and tamper protection.', availability: 'Coming soon' },
  { key: 'reports', name: 'Advanced reports and export', blurb: 'Deeper analytics and data export.', availability: 'Coming soon' },
];
