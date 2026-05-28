/**
 * Quotation module — public facade.
 *
 * Zero external dependencies. Reusable in desktop app and web questionnaire.
 */

export type {
  CatalogItem,
  CatalogItemSpecs,
  Quotation,
  QuotationInput,
  QuotationLineItem,
  ManifestLineItem,
  SiteManifest,
} from './types';

export { DEFAULT_CATALOG, findDefaultCatalogItem } from './catalog';

export {
  buildBaseInfrastructure,
  buildTopologyComponents,
  buildQuotation,
  buildQuotationFromTopology,
} from './calc';

export { renderQuotationHtml, renderTechnicalBomHtml } from './render-html';
