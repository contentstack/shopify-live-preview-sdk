import { Liquid } from 'liquidjs';
import { GitHubConfig, cloneRepository } from './Github/index.js';
import {
  createMetaobjectEntries,
  getUpdatedProductMetafields,
  getUpdatedMetaobject,
  createContentTypeKeyBased,
  type ContentType,
  type Entry,
  type KeyBasedContentType,
  type MetaobjectEntries,
  type UpdatedProductMetafields,
  type UpdatedMetaobject,
  type FieldSchema
} from './setup-exports.js';

import { LiquidEngineOptions, setupLiquidEngine } from './Liquid/index.js';
import { ContentstackService } from './Contentstack/index.js';

// Define configuration interface
export interface LivePreviewShopifyConfig {
  deliveryToken: string;
  previewToken: string;
  environment: string;
  apiKey: string;
  previewUrl?: string;
  liquidEngineOptions?: LiquidEngineOptions;
}

/**
 * LivePreviewShopify class implementing the singleton pattern
 * This class provides utilities for Shopify live preview functionality
 */
export class LivePreviewShopify {
  private static instance: LivePreviewShopify | null = null;
  private liquidEngine?: Liquid;
  private contentstackService?: ContentstackService;
  private config?: LivePreviewShopifyConfig;

  /**
   * Private constructor to prevent direct construction calls with the `new` operator.
   */
  private constructor(config?: LivePreviewShopifyConfig) {
    this.liquidEngine = setupLiquidEngine(config?.liquidEngineOptions || {});
    if (config) {
      this.initialize(config);
    }
  }

  /**
   * Gets the singleton instance of LivePreviewShopify.
   * If an instance doesn't exist, it creates one with the provided config.
   * @param config Configuration options for LivePreviewShopify
   */
  public static getInstance(config?: LivePreviewShopifyConfig): LivePreviewShopify {
    if (!LivePreviewShopify.instance) {
      LivePreviewShopify.instance = new LivePreviewShopify(config);
    } else if (config) {
      // If instance exists and new config is provided, reinitialize
      LivePreviewShopify.instance.initialize(config);
    }

    return LivePreviewShopify.instance;
  }

  /**
   * Initialize or reinitialize the LivePreviewShopify instance with configuration
   * @param config Configuration options for LivePreviewShopify
   */
  private initialize(config: LivePreviewShopifyConfig): void {
    this.config = config;
    this.contentstackService = new ContentstackService(config);
    this.liquidEngine = setupLiquidEngine(config.liquidEngineOptions);
  }

  /**
   * Get the Liquid engine instance
   * @returns The Liquid engine instance
   * @throws Error if liquid engine is not initialized
   */
  public getLiquidEngine(): Liquid {
    if (!this.liquidEngine) {
      throw new Error('Liquid engine is not initialized. Call setLiquidEngine first.');
    }
    return this.liquidEngine;
  }

  /**
   * Fetch data from Contentstack
   * @param ctUID Content type UID
   * @param entryUID Entry UID
   * @param hash Live preview hash
   * @returns Promise resolving to fetched data
   */
  public async fetchData(ctUID: string, entryUID: string, hash: string, locale: string): Promise<unknown> {
    if (!this.contentstackService) {
      throw new Error('LivePreviewShopify is not configured. Please call getInstance with configuration.');
    }
    return await this.contentstackService.fetchData(ctUID, entryUID, hash, locale);
  }

  /**
   * Create metaobject entries
   * @param contentType Content type or field schema
   * @param entries Array of entries
   * @param type Type string
   * @param path Path string
   * @param entryMetaObject Entry meta object
   * @param dataCSLPMapping Data CSLP mapping
   * @param extraData Extra data
   * @returns Promise resolving to array of created entries
   */
  public async createMetaobjectEntries(
    contentType: ContentType | FieldSchema,
    entries: Entry[],
    type: string,
    path: string,
    entryMetaObject: MetaobjectEntries,
    dataCSLPMapping: Record<string, unknown>,
    extraData: unknown
  ): Promise<unknown[]> {
    return await createMetaobjectEntries(contentType, entries, type, path, entryMetaObject, dataCSLPMapping, extraData);
  }

  /**
   * Get updated product metafields
   * @param currentMetafields Current metafields
   * @param keyBasedCt Key-based content type
   * @param entry Entry data
   * @param options Options object with ctUid, entryUid, and hash
   * @returns Promise resolving to updated product metafields
   */
  public async getUpdatedProductMetafields(
    currentMetafields: unknown,
    keyBasedCt: KeyBasedContentType,
    entry: Entry,
    options: {
      ctUid: string;
      entryUid: string;
      hash: string;
    }
  ): Promise<UpdatedProductMetafields> {
    return await getUpdatedProductMetafields(currentMetafields, keyBasedCt, entry, options);
  }

  /**
   * Get updated metaobject
   * @param currentMetaobjects Current metaobjects
   * @param keyBasedCt Key-based content type
   * @param entry Entry data
   * @param options Options object with ctUid and hash
   * @returns Promise resolving to updated metaobject
   */
  public async getUpdatedMetaobject(
    currentMetaobjects: unknown,
    keyBasedCt: KeyBasedContentType,
    entry: Entry,
    options: {
      ctUid: string;
      hash: string;
    }
  ): Promise<UpdatedMetaobject> {
    return await getUpdatedMetaobject(currentMetaobjects, keyBasedCt, entry, options);
  }

  /**
   * Create content type key based
   * @param contentType Array of field schemas
   * @returns Key-based content type
   */
  public createContentTypeKeyBased(contentType: FieldSchema[]): KeyBasedContentType {
    return createContentTypeKeyBased(contentType);
  }

  public static async cloneRepository(cloneConfig: Pick<GitHubConfig, 'auth' | 'owner' | 'repo' | 'branch'>, targetPath: string): Promise<void> {
    await cloneRepository(cloneConfig, targetPath);
  }
}