// TypeScript declarations for setup/index.js

export interface ContentType {
  uid: string;
  schema: FieldSchema[];
  [key: string]: unknown;
}

export interface FieldSchema {
  uid: string;
  data_type: string;
  multiple?: boolean;
  blocks?: unknown[];
  reference_to?: string;
  [key: string]: unknown;
}

export interface Entry {
  uid: string;
  _content_type_uid: string;
  _metadata?: {
    uid: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface Asset {
  uid: string;
  url: string;
  filename: string;
  _metadata?: {
    extensions?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface MetaobjectEntries {
  [type: string]: {
    [path: string]: {
      id?: string;
      _field_type?: string;
      values?: unknown[];
      toJSON(): unknown;
      [key: string]: unknown;
    };
  };
}

export interface UpdatedProductMetafields {
  [key: string]: {
    value: unknown;
    toJSON(): unknown;
    system?: unknown;
  };
}

export interface UpdatedMetaobject {
  currentMetaobjects: unknown;
  dataCSLPMapping: Record<string, unknown>;
}

export interface ShopifyFieldsOptions {
  [key: string]: unknown;
}

export interface KeyBasedContentType {
  [fieldUid: string]: FieldSchema;
}

export declare function fetchData(
  ctUID: string,
  entryUID: string,
  hash: string,
  locale: string
): Promise<unknown>;

export declare function createMetaobjectEntries(
  contentType: ContentType | FieldSchema,
  entries: Entry[],
  type: string,
  path: string,
  entryMetaObject: MetaobjectEntries,
  dataCSLPMapping: Record<string, unknown>,
  extraData: unknown
): Promise<unknown[]>;

export declare function getUpdatedProductMetafields(
  currentMetafields: unknown,
  keyBasedCt: KeyBasedContentType,
  entry: Entry,
  options: {
    ctUid: string;
    entryUid: string;
    hash: string;
  }
): Promise<UpdatedProductMetafields>;

export declare function getUpdatedMetaobject(
  currentMetaobjects: unknown,
  keyBasedCt: KeyBasedContentType,
  entry: Entry,
  options: {
    ctUid: string;
    hash: string;
  }
): Promise<UpdatedMetaobject>;

export declare function createContentTypeKeyBased(
  contentType: FieldSchema[]
): KeyBasedContentType; 