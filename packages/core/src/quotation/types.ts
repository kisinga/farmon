/**
 * Quotation domain types.
 *
 * Zero external dependencies. Pure data shapes.
 */

export type ParameterDef =
  | { name: string; label: string; type: 'select'; options: string[] }
  | { name: string; label: string; type: 'number'; min?: number; max?: number };

export interface ComponentDefinition {
  id: string;
  category: string;
  subCategory?: string;
  name: string;
  description: string;
  parameters: ParameterDef[];
  defaultParams: Record<string, string>;
}

export interface ProductVariant {
  params: Record<string, string>;
  unitCost: number;
  currency: string;
  partNumber?: string;
  isActive: boolean;
}

export interface ProductLine {
  id: string;
  componentId: string;
  manufacturer: string;
  name: string;
  manufacturerPartNumber?: string;
  description: string;
  selectionHelp?: string;
  reliabilityScore?: number;
  baseSpecs: Record<string, string>;
  variants: ProductVariant[];
  isActive: boolean;
  isUserDefined: boolean;
}

export interface QuoteDefaults {
  componentId: string;
  manufacturerId: string;
  params: Record<string, string>;
}

export interface QuotationInput {
  numTanks: number;
  numPumps: number;
  hasVfd: boolean;
  numValveZones: number;
  maxPipeDiameter: 'DN15' | 'DN20' | 'DN25' | 'DN32';
  numFlowSensors: number;
  /** Per-component parameter overrides. Key = componentId, value = param map.
   *  Falls back to maxPipeDiameter for valve/flow_sensor if not specified. */
  componentParams?: Record<string, Record<string, string>>;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  consentGiven?: boolean;
}

export interface QuotationDiagnostic {
  componentId: string;
  reason: string;
}

export interface QuotationLineItem {
  manufacturerId: string;
  name: string;
  manufacturer: string;
  specs: Record<string, string>;
  description: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  lineTotal: number;
  currency: string;
  selectionHelp?: string;
  notes?: string;
}

export interface Quotation {
  quoteId: string;
  generatedAt: string;
  customerName?: string;
  siteName?: string;
  baseInfrastructure: QuotationLineItem[];
  systemComponents: QuotationLineItem[];
  subtotal: number;
  currency: string;
}

export interface ManifestLineItem {
  manufacturerId: string;
  params: Record<string, string>;
  quantity: number;
  unitPriceAtTime: number;
  notes?: string;
}

export interface SiteManifest {
  id: number;
  siteId: string;
  manifestVersion: number;
  manifestType: 'quote' | 'deployment' | 'revision';
  createdAt: string;
  topologyChecksum?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  notes?: string;
  items: ManifestLineItem[];
}
