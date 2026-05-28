/**
 * Quotation domain types.
 *
 * Zero external dependencies. Pure data shapes.
 */

export interface CatalogItemSpecs {
  portSize?: 'DN15' | 'DN20' | 'DN25' | 'DN32' | string;
  voltage?: string;
  pressureRating?: string;
  material?: string;
  flowRange?: string;
  currentDraw?: string;
  wattage?: string;
  ipRating?: string;
  [key: string]: string | undefined;
}

export interface CatalogItem {
  id: string;
  category: 'base_infra' | 'controller' | 'valve' | 'flow_sensor' | 'pump' | 'relay' | 'power' | 'enclosure';
  subCategory?: string;
  name: string;
  manufacturer: string;
  manufacturerPartNumber?: string;
  specs: CatalogItemSpecs;
  unitCostUsd: number;
  currency: string;  // default 'KES'
  description: string;
  selectionHelp?: string;
  reliabilityScore?: number;
  isActive: boolean;
  isUserDefined: boolean;
}

export interface QuotationInput {
  numTanks: number;
  numPumps: number;
  hasVfd: boolean;
  numValveZones: number;
  maxPipeDiameter: 'DN15' | 'DN20' | 'DN25' | 'DN32';
  numFlowSensors: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  consentGiven?: boolean;
}

export interface QuotationLineItem {
  catalogItemId: string;
  name: string;
  manufacturer: string;
  specs: CatalogItemSpecs;
  description: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  lineTotal: number;
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
  catalogItemId: string;
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
