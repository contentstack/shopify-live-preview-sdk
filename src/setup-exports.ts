// TypeScript wrapper for setup module exports
import * as setupModule from './setup/index.js';

export const fetchData = setupModule.fetchData;
export const createMetaobjectEntries = setupModule.createMetaobjectEntries;
export const getUpdatedProductMetafields = setupModule.getUpdatedProductMetafields;
export const getUpdatedMetaobject = setupModule.getUpdatedMetaobject;
export const createContentTypeKeyBased = setupModule.createContentTypeKeyBased;

// Export all types from the setup module
export type {
  ContentType,
  Entry,
  Asset,
  MetaobjectEntries,
  UpdatedProductMetafields,
  UpdatedMetaobject,
  ShopifyFieldsOptions,
  KeyBasedContentType,
  FieldSchema
} from './setup/index.js';