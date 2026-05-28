/**
 * Quotation module — public facade.
 *
 * Zero external dependencies. Reusable in desktop app and web questionnaire.
 */

export type {
  ComponentDefinition,
  ParameterDef,
  ProductLine,
  ProductVariant,
  QuoteDefaults,
  Quotation,
  QuotationInput,
  QuotationLineItem,
  QuotationDiagnostic,
  ManifestLineItem,
  SiteManifest,
} from './types';
export type { CatalogBundle } from './catalog';

export {
  COMPONENT_REGISTRY,
  DEFAULT_LINES,
  DEFAULT_DEFAULTS,
  DEFAULT_CATALOG,
  resolveQuoteLineItem,
} from './catalog';

export {
  buildBaseInfrastructure,
  buildTopologyComponents,
  buildQuotation,
  buildQuotationFromTopology,
} from './calc';

export { renderQuotationHtml, renderTechnicalBomHtml } from './render-html';
