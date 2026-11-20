import 'dotenv/config';
import lodash from 'lodash';
const { isEmpty } = lodash;

// Prevent prototype pollution by disallowing unsafe keys
const isUnsafeKey = (key) => {
  return typeof key !== 'string' ||
    key === '__proto__' ||
    key === 'prototype' ||
    key === 'constructor';
};

const sanitizeKey = (key) => {
  if (isUnsafeKey(key)) return null;
  return key;
};

const getSafeOwn = (obj, key) => {
  const k = sanitizeKey(key);
  if (!k || obj === null || typeof obj !== 'object') return undefined;
  return Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : undefined;
};

const sanitizeContentType = (contentType) => {
  if (!contentType || typeof contentType !== 'object') return contentType;
  const safe = { ...contentType };
  const safeUid = sanitizeKey(safe.uid);
  if (safeUid) safe.uid = safeUid;
  if (Array.isArray(safe.schema)) {
    safe.schema = safe.schema.map((f) => {
      if (!f || typeof f !== 'object') return f;
      const sf = { ...f };
      const fuid = sanitizeKey(sf.uid);
      if (fuid) sf.uid = fuid;
      return sf;
    });
  }
  if (Array.isArray(safe.blocks)) {
    safe.blocks = safe.blocks.map((b) => {
      if (!b || typeof b !== 'object') return b;
      const sb = { ...b };
      const buid = sanitizeKey(sb.uid);
      if (buid) sb.uid = buid;
      return sb;
    });
  }
  return safe;
};

const createNullProtoCopy = (obj) => {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const safe = Object.create(null);
  for (const [k, v] of Object.entries(obj)) {
    const sk = sanitizeKey(k);
    if (!sk) continue;
    safe[sk] = v;
  }
  return safe;
};


const CONTENTSTACK_DELIVERY_TOKEN = process.env.CONTENTSTACK_DELIVERY_TOKEN;
const CONTENTSTACK_PREVIEW_TOKEN = process.env.CONTENTSTACK_PREVIEW_TOKEN;
const CONTENTSTACK_ENVIRONMENT = process.env.CONTENTSTACK_ENVIRONMENT;
const CONTENTSTACK_API_KEY = process.env.CONTENTSTACK_API_KEY
const CONTENTSTACK_PREVIEW_URL = process.env.CONTENTSTACK_PREVIEW_URL;

function getHeaders() {
  const headers = new Headers();
  headers.append("Content-Type", "application/json");
  headers.append("access_token", CONTENTSTACK_DELIVERY_TOKEN);
  headers.append("api_key", CONTENTSTACK_API_KEY);
  return headers;
}

const fetchData = async (ctUID, entryUID, hash) => {
  const contentstackURL = new URL(
    `${CONTENTSTACK_PREVIEW_URL}/v3/content_types/${ctUID}/entries/${entryUID}?environment=${CONTENTSTACK_ENVIRONMENT}&include_schema=true`
  );
  const headers = getHeaders();
  headers.append("live_preview", hash);
  headers.append("preview_token", CONTENTSTACK_PREVIEW_TOKEN);
  const res = await fetch(contentstackURL.toString(), {
    method: "GET",
    headers: headers,
  });
  return res.json();
};

const getEntry = async (contentTypeUid, entryUid, hash) => {
  try {
    const contentstackURL = new URL(
      `${CONTENTSTACK_PREVIEW_URL}/v3/content_types/${contentTypeUid}/entries/${entryUid}?environment=${CONTENTSTACK_ENVIRONMENT}`
    );
    const headers = getHeaders();
    headers.append("live_preview", hash);
    headers.append("preview_token", CONTENTSTACK_PREVIEW_TOKEN);
    const res = await fetch(contentstackURL.toString(), {
      method: "GET",
      headers: headers,
    });
    const data = await res.json();
    if (data?.error_code) {
      throw new Error(data?.error_message);
    }
    if (!data?.entry) {
      throw new Error("Entry not found");
    }
    return data.entry;
  }
  catch (error) {
    console.error("Error getting entry", error);
    throw error;
  }
}

const getAsset = async (uid, hash) => {
  try {
    const contentstackURL = new URL(
      `${CONTENTSTACK_PREVIEW_URL}/v3/assets/${uid}?include_metadata=true`
    );
    const headers = getHeaders();
    headers.append("preview_token", CONTENTSTACK_PREVIEW_TOKEN);
    headers.append("live_preview", hash);
    const res = await fetch(contentstackURL.toString(), {
      method: "GET",
      headers: headers,
    });
    const data = await res.json();
    if (data?.error_code) {
      throw new Error(data?.error_message);
    }
    return data.asset;
  }
  catch (error) {
    console.error("Error getting asset", error);
    throw error;
  }
}

const getAssetGid = async (entryData, hash) => {
  try {
    const csAsset = await getAsset(entryData?.uid, hash);
    const assetExtension = csAsset?._metadata?.extensions;
    const assetExtensionValues = assetExtension ? Object.values(assetExtension) : [];
    let gid = "";
    assetExtensionValues?.forEach(ext => {
      if (ext) {
        const assetGid = ext.find((i) => i?.shophify_asset_gid)?.shophify_asset_gid;
        if (assetGid) {
          gid = assetGid;
        }
      }
    });


    // TODO: To check this code again 
    // else {
    //     const shopifyAssetData: any = await uploadAssetsToShopify({ originalSource: entryData?.url, filename: entryData?.filename });
    //     console.info("🚀 ~ getAssetGid ~ shopifyAssetData:", shopifyAssetData);
    //     gid = shopifyAssetData?.[0]?.id;
    //     const metadataBody = {
    //         metadata: {
    //             entity_uid: entryData?.uid,
    //             type: "asset",
    //             _content_type_uid: "sys_assets",
    //             extension_uid: token?.extension_uid,
    //             shophify_asset_gid: gid
    //         }
    //     }
    //     await createMetadata(metadataBody);
    // }

    return gid;
  } catch (error) {
    console.error('Error getting asset gid:', error);
    throw error;
  }
}

const fetchContentType = async (contentTypeUid, hash) => {
  const contentstackURL = new URL(
    `${CONTENTSTACK_PREVIEW_URL}/v3/content_types/${contentTypeUid}`
  );
  const headers = getHeaders();
  headers.append("live_preview", hash);
  headers.append("preview_token", CONTENTSTACK_PREVIEW_TOKEN);
  const res = await fetch(contentstackURL.toString(), {
    method: "GET",
    headers: headers,
  });
  return res.json();
};

// ---------------------------------------------------------------------------------------------
// Nested values (group / link / global_field / reference inside blocks or other groups)
//
// Contentstack's raw shape for these differs from what a Shopify Liquid theme reads:
//   - a Link field arrives as { title, href }, Shopify exposes { text, url };
//   - a Group / Global Field arrives as a plain object, Shopify exposes a metaobject whose
//     fields are read directly (block.cta.url) or through `.value` (block.cta.value.url);
//   - a Reference arrives as [{ uid, _content_type_uid }] and must be fetched to be useful.
// The helpers below convert the raw value into one object that answers BOTH access styles, so
// the same template works on real Shopify and on the middleware. `value` is a non-enumerable
// alias of the object itself, so it never shows up in `| json` output or in iteration.
// ---------------------------------------------------------------------------------------------
const MAX_NESTED_DEPTH = 8;
const MAX_REFERENCE_DEPTH = 2;

const isAssetValue = (v) =>
  v !== null && typeof v === 'object' && typeof v.url === 'string' &&
  (typeof v.filename === 'string' || typeof v.content_type === 'string');

const isLinkValue = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.href === 'string' &&
  Object.keys(v).every((k) => k === 'title' || k === 'href');

const isReferenceValue = (v) =>
  v !== null && typeof v === 'object' && typeof v.uid === 'string' && typeof v._content_type_uid === 'string';

const isUnresolvedReference = (v) =>
  isReferenceValue(v) && Object.keys(v).every((k) => k === 'uid' || k === '_content_type_uid');

const defineValueAlias = (target) => {
  if (!('value' in target)) {
    Object.defineProperty(target, 'value', { get() { return target; }, enumerable: false, configurable: true });
  }
  return target;
};

/** Converts a raw nested Contentstack value into the dual-access, Shopify-like shape. */
const normalizeNestedValue = (value, depth = 0) => {
  if (value === null || typeof value !== 'object' || depth > MAX_NESTED_DEPTH) return value;
  if (Array.isArray(value)) return defineValueAlias(value.map((item) => normalizeNestedValue(item, depth + 1)));
  if (isAssetValue(value) || isReferenceValue(value)) return value;
  if (isLinkValue(value)) {
    return defineValueAlias({ text: value.title, url: value.href, title: value.title, href: value.href });
  }
  return defineValueAlias(normalizeNestedFields(value, depth + 1));
};

/** Normalizes every field of an object (a block, a group entry) without aliasing the object itself. */
const normalizeNestedFields = (obj, depth = 0) => {
  const out = Object.create(null);
  if (obj === null || typeof obj !== 'object') return out;
  for (const [rawKey, v] of Object.entries(obj)) {
    const key = sanitizeKey(rawKey);
    if (!key) continue;
    out[key] = normalizeNestedValue(v, depth);
  }
  return out;
};

/**
 * Replaces unresolved references ({ uid, _content_type_uid }) anywhere inside a value with the
 * fetched entry, up to MAX_REFERENCE_DEPTH levels so reference cycles cannot run away. A reference
 * that cannot be fetched is left as-is rather than failing the whole preview.
 */
const resolveNestedReferences = async (value, hash, depth = 0) => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Promise.all(value.map((item) => resolveNestedReferences(item, hash, depth)));
  if (isAssetValue(value)) return value;
  if (isUnresolvedReference(value)) {
    if (depth >= MAX_REFERENCE_DEPTH) return value;
    try {
      const entry = await getEntry(value._content_type_uid, value.uid, hash);
      return await resolveNestedReferences(entry, hash, depth + 1);
    } catch (error) {
      return value;
    }
  }
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = await resolveNestedReferences(v, hash, depth);
  }
  return out;
};

const getShopifyFields = async (content_type, entries, type, Path, entryMetaObject, dataCSLPMapping, extraData) => {
  // Sanitize inbound arguments
  const safeContentType = sanitizeContentType(content_type) || {};
  const safeEntries = Array.isArray(entries) ? entries.map(createNullProtoCopy) : [];
  const safeType = sanitizeKey(type) || '';
  const safePath = sanitizeKey(Path) || '';
  const safeEntryMetaObject = (entryMetaObject && typeof entryMetaObject === 'object') ? entryMetaObject : Object.create(null);
  const safeDataCSLPMapping = (dataCSLPMapping && typeof dataCSLPMapping === 'object') ? dataCSLPMapping : Object.create(null);
  const safeExtraData = (extraData && typeof extraData === 'object') ? createNullProtoCopy(extraData) : {};
  const allFields = [];
  const content_type_fields = safeContentType?.schema;
  for (const [entryIndex, entry] of safeEntries.entries()) {
    // Blocks carry a stable _metadata.uid; entries of a repeatable Group do not. Without an index
    // every entry of a repeatable Group would share one path and overwrite the previous one.
    const entryUid = entry?._metadata?.uid
      ? `${safePath}-${entry?._metadata?.uid}`
      : (safeEntries.length > 1 && safePath ? `${safePath}-${entryIndex}` : safePath);
    let path = safePath ? entryUid : entry?.uid;
    const fields = [];
    for (const field of content_type_fields) {
      const fieldUid = sanitizeKey(field?.uid);
      if (!fieldUid) continue;
      if (field.data_type === "group") {
        if (!Object.prototype.hasOwnProperty.call(entry, fieldUid)) continue;
        const tempPath = `${path}-${fieldUid}`;
        if (field.multiple) {
          const groupEntries = getSafeOwn(entry, fieldUid);
          if (!Array.isArray(groupEntries)) continue;
          const safeField = sanitizeContentType(field);
          const safeGroupEntries = groupEntries.map(createNullProtoCopy);
          const createdEntries = await createMetaobjectEntries(safeField, safeGroupEntries, type, tempPath, entryMetaObject, dataCSLPMapping, extraData);

          const groupGids = createdEntries?.map(({ id }) => `"${id}"`);
          const group_key = fieldUid;
          const group_value = `[${groupGids?.join(',')}]`;
          fields.push({ key: group_key, value: group_value });
          saveDataInObject(safeType, path, { key: fieldUid, value: normalizeNestedValue(groupEntries) }, field.data_type, safeEntryMetaObject, safeExtraData);
        } else {
          const groupEntry = getSafeOwn(entry, fieldUid);
          if (groupEntry === undefined || groupEntry === null) continue;
          const safeField = sanitizeContentType(field);
          const safeGroupEntry = createNullProtoCopy(groupEntry);
          const createdEntries = await createMetaobjectEntries(safeField, [safeGroupEntry], type, tempPath, entryMetaObject, dataCSLPMapping, extraData);

          const group_key = fieldUid;
          const group_value = createdEntries?.[0]?.id;
          fields.push({ key: group_key, value: group_value });
          saveDataInObject(safeType, path, { key: fieldUid, value: normalizeNestedValue(groupEntry) }, field.data_type, safeEntryMetaObject, safeExtraData);
        }
      } else if (field.data_type === "blocks") {
        if (!Object.prototype.hasOwnProperty.call(entry, fieldUid)) continue;
        const blockContentTypes = field.blocks;
        const tempType = `${safeType}-${fieldUid}`;
        const blockGids = [];

        // Loop through each block content type
        for (const blockContentType of blockContentTypes) {
          const blockContentTypeUid = sanitizeKey(blockContentType?.uid);
          if (!blockContentTypeUid) continue;
          const tempPath = `${path}-${fieldUid}-${blockContentTypeUid}`;
          const isGlobalField = !isEmpty(blockContentType?.reference_to);
          let globalFieldContentType = null;

          const blockEntries = [];
          if (isGlobalField) {
            globalFieldContentType = await fetchGlobalField(blockContentType?.reference_to, safeExtraData?.hash);
          }

          // Loop through each entry and collect block entries
          const entryBlockEntries = Array.isArray(entry[fieldUid]) ? entry[fieldUid] : [];

          // Loop through each block entry object
          for (const blockEntryObject of entryBlockEntries) {
            const blockEntry = blockEntryObject[blockContentTypeUid];

            if (blockEntry) {
              blockEntries.push(blockEntry);
            }
          }

          // Create or update all collected block entries at once
          if (blockEntries.length > 0) {
            const contentType = isGlobalField ? globalFieldContentType : blockContentType;
            const blockType = isGlobalField ? "" : tempType;
            const blockData = await createMetaobjectEntries(contentType, blockEntries, blockType, tempPath, safeEntryMetaObject, safeDataCSLPMapping, { ...safeExtraData, fieldType: 'block' });

            blockData?.forEach(({ id }) => {
              blockGids.push(`"${id}"`);
            });
          }
        }

        const block_key = fieldUid;
        const block_value = `[${blockGids.join(',')}]`;
        fields.push({ key: block_key, value: block_value });
      } else if (field.data_type === "global_field") {
        if (!Object.prototype.hasOwnProperty.call(entry, fieldUid)) continue;
        const tempPath = `${path}-${fieldUid}`;
        const globalFieldContentType = await fetchGlobalField(field?.reference_to, safeExtraData?.hash);

        if (field.multiple) {
          const globalFieldResults = await createMetaobjectEntries(globalFieldContentType, entry[fieldUid], "", tempPath, safeEntryMetaObject, safeDataCSLPMapping, safeExtraData);

          const globalGids = globalFieldResults?.map(({ id }) => `"${id}"`);
          const globalField_key = fieldUid;
          const globalField_value = `[${globalGids?.join(',')}]`;
          fields.push({ key: globalField_key, value: globalField_value });
          saveDataInObject(safeType, path, { key: fieldUid, value: normalizeNestedValue(entry[fieldUid]) }, field.data_type, safeEntryMetaObject, safeExtraData);
        } else {
          const globalFieldResults = await createMetaobjectEntries(globalFieldContentType, [entry[fieldUid]], "", tempPath, safeEntryMetaObject, safeDataCSLPMapping, safeExtraData);

          const globalField_key = fieldUid;
          const globalField_value = globalFieldResults?.[0]?.id
          fields.push({ key: globalField_key, value: globalField_value });
          saveDataInObject(safeType, path, { key: fieldUid, value: normalizeNestedValue(entry[fieldUid]) }, field.data_type, safeEntryMetaObject, safeExtraData);
        }
      } else if (field.data_type === "reference") {
        if (!Object.prototype.hasOwnProperty.call(entry, fieldUid)) continue;

        if (field?.field_metadata?.ref_multiple) {
          const referenceGids = [];
          const fetchedByKey = new Map();
          for (const contentType of field.reference_to || []) {
            const entriesToCreate = [];
            for (const entryData of entry[fieldUid]) {
              const { _content_type_uid, uid } = entryData;
              if (_content_type_uid === contentType) {
                const csEntry = await getEntry(_content_type_uid, uid, safeExtraData?.hash);
                if (!csEntry) throw new Error(`Entry not found for ${_content_type_uid} and ${uid}`);
                entriesToCreate.push(csEntry);
                fetchedByKey.set(`${_content_type_uid}:${uid}`, csEntry);
              }
            }
            if (entriesToCreate.length) {
              const contentTypeResponse = await fetchContentType(contentType, safeExtraData?.hash);
              // type and path were missing here, which shifted every later argument by two slots
              // (the metaobject store landed in `type`). Same call shape as the single reference below.
              const metaobjectEntries = await createMetaobjectEntries(contentTypeResponse?.content_type, entriesToCreate, "", "", safeEntryMetaObject, safeDataCSLPMapping, safeExtraData);
              metaobjectEntries?.forEach((entry) => referenceGids.push(`"${entry?.id}"`));
            }
          }
          const field_key = fieldUid;
          const field_value = `[${referenceGids.join(',')}]`;
          fields.push({ key: field_key, value: field_value });
          // Keep the authored order of the reference list, whatever the grouping by content type above.
          const orderedReferences = entry[fieldUid]
            .map((ref) => fetchedByKey.get(`${ref?._content_type_uid}:${ref?.uid}`))
            .filter(Boolean);
          saveDataInObject(safeType, path, { key: fieldUid, value: normalizeNestedValue(orderedReferences) }, field.data_type, safeEntryMetaObject, safeExtraData);
        } else {
          const entryData = entry[fieldUid];
          if (isEmpty(entryData)) {
            fields.push({ key: fieldUid, value: null });
            continue;
          }
          const { uid: entryUid, _content_type_uid: contentTypeUid } = entryData[0] || {};

          const contentTypeResponse = await fetchContentType(contentTypeUid, safeExtraData?.hash);
          const csEntry = await getEntry(contentTypeUid, entryUid, safeExtraData?.hash);
          const metaobjectEntries = await createMetaobjectEntries(contentTypeResponse?.content_type, [csEntry], "", "", safeEntryMetaObject, safeDataCSLPMapping, safeExtraData);
          const metaobjectEntry = metaobjectEntries?.[0];
          const field_key = fieldUid;
          const field_value = metaobjectEntry?.id;
          fields.push({ key: field_key, value: field_value });
          saveDataInObject(safeType, path, { key: fieldUid, value: normalizeNestedValue(csEntry) }, field.data_type, safeEntryMetaObject, safeExtraData);
        }
      } else if (field.data_type === "file") {
        if (!Object.prototype.hasOwnProperty.call(entry, fieldUid)) continue;
        const entryData = entry[fieldUid];
        let field_value = "";

        if (entryData) {
          if (field?.multiple) {
            const promises = entryData?.map((file) => getAssetGid(file, safeExtraData?.hash));
            const gids = await Promise.all(promises);
            field_value = `[${gids?.map(gid => `${gid}`).join(',')}]`;
          } else {
            const gid = await getAssetGid(entryData, safeExtraData?.hash);
            field_value = `${gid}`;
          }
        } else {
          continue
        }

        fields.push({ key: fieldUid, value: field_value });
        // The theme renders the asset through image_url, which needs the url; a gid would not resolve.
        const assetUrls = field?.multiple ? entryData.map((file) => file?.url) : entryData?.url;
        saveDataInObject(safeType, path, { key: fieldUid, value: assetUrls }, field.data_type, safeEntryMetaObject, safeExtraData);
      } else if (field.data_type === "isodate") {
        if (!Object.prototype.hasOwnProperty.call(entry, fieldUid)) continue;
        const entryData = entry[fieldUid];
        let field_value = '';
        // What a theme reads: a plain string, or a real array for a repeatable date field.
        let saved_value = '';

        if (!isEmpty(entryData)) {
          if (field?.multiple) {
            const values = entryData.map((i) => {
              if (field?.field_metadata?.hide_time) return i;
              return (new Date(i)).toISOString();
            });
            field_value = `[${values.join(',')}]`;
            saved_value = normalizeNestedValue(values);
          }
          else {
            field_value = field?.field_metadata?.hide_time ? entryData : (new Date(entryData)).toISOString();
            saved_value = field_value;
          }
        }

        fields.push({ key: fieldUid, value: field_value });
        saveDataInObject(safeType, path, { key: fieldUid, value: saved_value }, field.data_type, safeEntryMetaObject, safeExtraData);
      } else if (field.data_type === 'link') {
        if (!Object.prototype.hasOwnProperty.call(entry, fieldUid)) continue;
        const field_key = fieldUid;
        // Shopify shape ({ text, url }), reachable as block.cta.url and block.cta.value.url.
        saveDataInObject(safeType, path, { key: fieldUid, value: normalizeNestedValue(entry[fieldUid]) }, field.data_type, safeEntryMetaObject, safeExtraData);

        if (field.multiple) {
          const field_values = entry[fieldUid]
            .map((link) => {
              if (!link.title || !link.href) {
                return null;
              }
              return { text: link.title, url: link.href };
            })
            .filter((link) => link !== null);

          const field_value = field_values.length > 0 ? JSON.stringify(field_values) : "";
          fields.push({ key: field_key, value: field_value });
        } else {
          const link = entry[fieldUid];
          const field_value = (link.title && link.href)
            ? JSON.stringify({ text: link.title, url: link.href })
            : "";
          fields.push({ key: field_key, value: field_value });
        }
      }
      else if (field.data_type === 'json') {
        if (!Object.prototype.hasOwnProperty.call(entry, fieldUid)) continue;
        const field_key = fieldUid;
        const field_value = JSON.stringify(entry[fieldUid]);
        fields.push({ key: field_key, value: field_value });
        saveDataInObject(safeType, path, { key: field_key, value: normalizeNestedValue(entry[fieldUid]) }, field.data_type, safeEntryMetaObject, safeExtraData);
      }
      else {
        const field_key = fieldUid;
        const field_value = `${entry[field_key] ?? ""}`;
        fields.push({ key: field_key, value: field_value });
        saveDataInObject(safeType, path, { key: field_key, value: field_value }, field.data_type, safeEntryMetaObject, safeExtraData);
        if (entry?.$?.[field_key]?.["data-cslp"] && entry?.$?.[field_key]?.["data-cslp"] !== "") {
          const rawMapKey = (entry.$[field_key]["data-cslp"]).replace(".", "_");
          const safeMapKey = sanitizeKey(rawMapKey);
          if (safeMapKey) {
            safeDataCSLPMapping[safeMapKey] = `${safeType}.${path}.$.${field_key}`;
          }
        }
      }
    }
    allFields.push({ handle: path, fields });
  }
  return allFields;
};

const createMetaobjectEntries = async (content_type, entries, type = "", path = "", entryMetaObject, dataCSLPMapping, extraData = {}) => {
  try {
    type = type ? `${type}-${content_type?.uid}` : content_type?.uid;
    await getShopifyFields(content_type, entries, type, path, entryMetaObject, dataCSLPMapping, extraData);
  } catch (error) {
    console.error("🚀 ~ createMetaobjectEntries ~ error:", error);
    throw error;
  }
}

const saveDataInObject = (type, path, data, dataType, entryMetaObject, extraData) => {
  const typeKey = sanitizeKey(type);
  const pathKey = sanitizeKey(path);
  const dataKey = sanitizeKey(data?.key);
  if (!typeKey || !pathKey || !dataKey) return;
  if (!entryMetaObject[typeKey]) entryMetaObject[typeKey] = Object.create(null);
  if (extraData?.fieldType) {
    entryMetaObject[typeKey] = { ...entryMetaObject[typeKey], _field_type: extraData.fieldType };
  }
  if (!entryMetaObject[typeKey][pathKey]) entryMetaObject[typeKey][pathKey] = {};
  if (!entryMetaObject[typeKey].values) entryMetaObject[typeKey].values = [];
  let updatedData = null;
  if(!isEmpty(entryMetaObject[typeKey][pathKey])) {
    updatedData = {
      ...(entryMetaObject[typeKey][pathKey]?.toJSON() || {}), [dataKey]: data.value
    }
  } else {
    updatedData = {
      [dataKey]: data.value
    }
  }
  entryMetaObject[typeKey][pathKey] = { 
    ...updatedData,
    get value() {
      return updatedData;
    },
    toJSON() {
      return updatedData;
    },
    get system() {
      return {
        type: `${typeKey}`,
        handle: pathKey,
        id: null,
        url: null
      }
    }
   };
}

const getUpdatedProductMetafields = async (currentMetafields, contentType, entry, { ctUid, entryUid, hash }) => {
  if (!currentMetafields || typeof currentMetafields !== 'object') return;
  const updatedMetafields = {};
  const safeCurrent = createNullProtoCopy(currentMetafields);
  for (const [rawKey, value] of Object.entries(safeCurrent)) {
    const key = sanitizeKey(rawKey);
    if (!key) continue;

    const keyFieldType = contentType[key] ? contentType[key].data_type : null;
    if (!keyFieldType) {
      const cleanValue = Object.prototype.hasOwnProperty.call(entry, key) ? entry[key] : value;

      const systemData = value?.___system || {
        type: `${ctUid}-${key}`,
        handle: `${entryUid}-${key}`,
        id: null,
        url: null
      };

      const isObject = typeof cleanValue === 'object' && cleanValue !== null;
      const isArray = Array.isArray(cleanValue);

      let wrappedValue;

      if (isObject || isArray) {
        wrappedValue = {
          ...cleanValue,
          get value() {
            return {...cleanValue, system: systemData};
          },
          toJSON() {
            return {...cleanValue, system: systemData};
          },
          toString() {
            return JSON.stringify(cleanValue);
          },
          get system() {
            return systemData;
          },
          [Symbol.toPrimitive](hint) {
            return hint === 'string' ? this.toString() : cleanValue;
          }
        };
      } else {
        wrappedValue = {
          get value() {
            return {...cleanValue, system: systemData};
          },
          toJSON() {
            return {...cleanValue, system: systemData};
          },
          toString() {
            return typeof cleanValue === 'string' ? cleanValue : String(cleanValue);
          },
          get system() {
            return systemData;
          },
          [Symbol.toPrimitive](hint) {
            return hint === 'string' ? this.toString() : cleanValue;
          }
        };
      }

      updatedMetafields[key] = wrappedValue;
      continue;
    }

    if (keyFieldType === 'blocks') {
      const blockData = Object.prototype.hasOwnProperty.call(entry, key) && Array.isArray(entry[key]) ? entry[key] : [];
      const finalBlockData = [];
      const blockTypeOccurrence = Object.create(null);
      for (const block of blockData) {
        for (const [blockTypeKey, rawBlock] of Object.entries(block)) {
          // Nested Groups / Links / Global Fields / References inside the block arrive in Contentstack's
          // raw shape; hand the theme the same dual-access shape Shopify gives it (see normalizeNestedValue).
          const normalizedBlock = rawBlock !== null && typeof rawBlock === 'object'
            ? normalizeNestedFields(await resolveNestedReferences(rawBlock, hash))
            : rawBlock;
          const blockData = [blockTypeKey, normalizedBlock];
          const baselineBlocks = Array.isArray(currentMetafields[key]) ? currentMetafields[key] : [];
          const blockUid = blockData[1]?._metadata?.uid;
          let currentMetafieldsData = blockUid
            ? baselineBlocks.find((item) => item?.___system?.handle?.includes(`-${blockUid}`) || false)
            : undefined;
          // The live-preview entry can arrive without a block `_metadata.uid` (seen on a block backed by a
          // newly created global field). Without a uid the handle below would be synthesized as
          // "<entry>-<field>-<type>", whose last segment the theme then reads as the block id, and the
          // block would no longer match the page's own copy of itself (wrong data-cslp, duplicate block).
          // Recover the page's real handle by block type and by position among blocks of that type.
          if (!blockUid) {
            const typeMarker = `-${key}-${blockData[0]}-`;
            const sameTypeBaseline = baselineBlocks.filter((item) => item?.___system?.handle?.includes(typeMarker));
            currentMetafieldsData = sameTypeBaseline[blockTypeOccurrence[blockData[0]] || 0];
          }
          blockTypeOccurrence[blockData[0]] = (blockTypeOccurrence[blockData[0]] || 0) + 1;
          if (currentMetafieldsData) {
            const systemData = currentMetafieldsData.___system;
            let value = blockData[1];
            if(typeof blockData[1] === 'object' && blockData[1] !== null) {
              value = {...blockData[1], system: systemData};
            }
            const updateBlockData = {
              ...blockData[1],
              get value() {
                return value;
              },
              toJSON() {
                return value;
              },
              get system() {
                return systemData;
              }
            }
            finalBlockData.push(updateBlockData);
          } else {
            const systemData = {
              handle: `${entryUid}-${key}-${blockData[0]}${blockData[1]?._metadata?.uid ? `-${blockData[1]?._metadata?.uid}` : ""}`,
              type: `${ctUid}-${key}-${blockData[0]}`,
              id: blockData[1]?._metadata?.uid,
              url: null
            }
            let value = blockData[1];
            if(typeof blockData[1] === 'object' && blockData[1] !== null) {
              value = {...blockData[1], system: systemData};
            }
            const updateBlockData = {
              ...blockData[1],
              get value() {
                return value;
              },
              toJSON() {
                return value;
              },
              get system() {
                return systemData;
              }
            }
            finalBlockData.push(updateBlockData);
          }
        }
      }
      if(isEmpty(finalBlockData)) {
        finalBlockData.push({
          get value() {
            return null;
          },
          toJSON() {
            return null;
          },
          get system() {
            return {
              type: `${ctUid}-${key}`,
              handle: `${entryUid}-${key}`,
              id: null,
              url: null
            }
          }
        })
      }
      updatedMetafields[key] = {

        get value() {
          return finalBlockData
        },
        toJSON() {
          return finalBlockData
        },
        get system() {
          return {
            type: `${ctUid}-${key}`,
            handle: `${entryUid}-${key}`,
            id: null,
            url: null
          }
        }
      };

    } else if(keyFieldType === 'file'){
      const fileData = Object.prototype.hasOwnProperty.call(entry, key) ? entry[key] : [];
      const fileUrls = fileData?.map((file) => file?.url);
      const fileDataWithSystem = {
        ...fileData,
        toJSON() {
          return fileUrls
        }
      }
      updatedMetafields[key] = {
        get value() {
          return fileDataWithSystem
        },
        toJSON() {
          return fileUrls
        }
      }
    } else if(keyFieldType === "reference"){
      const referenceSchema = contentType[key];
      if(referenceSchema.multiple){
        const refUids = Object.prototype.hasOwnProperty.call(entry, key) ? entry[key] : [];
        const referenceData = await Promise.all(
          (refUids ?? []).map((refUid) => getEntry(refUid._content_type_uid, refUid.uid, hash))
        );
        const finalReferenceData = [];
        for (const reference of referenceData) {
          const currentMetafieldsData = currentMetafields[key]?.find((item) => {
            return item?.___system?.handle?.includes(`${reference?.uid}`) || false
          });
          if (currentMetafieldsData) {
            const systemData = currentMetafieldsData.___system;
            const updateReferenceData = {
              ...reference,
              get value() {
                return reference;
              },
              toJSON() {
                return reference;
              },
              get system() {
                return systemData;
              }
            }
            finalReferenceData.push(updateReferenceData);
          } else {
            const systemData = {
              handle: `${reference?.uid}`,
              type: `${reference?._content_type_uid}`,
              id: null,
              url: null
            }
            const updateReferenceData = {
              ...reference,
              get value() {
                return reference;
              },
              toJSON() {
                return reference;
              },
              get system() {
                return systemData;
              }
            }
            finalReferenceData.push(updateReferenceData);
          }
        }
        updatedMetafields[key] = {

          get value() {
            return finalReferenceData
          },
          toJSON() {
            return finalReferenceData
          },
          get system() {
            return {
              type: `${ctUid}-${key}`,
              handle: `${entryUid}-${key}`,
              id: null,
              url: null
            }
          }
        };
      } else {
        const rawRef = Object.prototype.hasOwnProperty.call(entry, key) ? entry[key] : [];
        const refUid = Array.isArray(rawRef) && rawRef.length ? rawRef[0] : rawRef;
        const referenceData = await getEntry(refUid._content_type_uid, refUid.uid, hash);
        const currentMetafieldsData = currentMetafields[key];
        const systemData = currentMetafieldsData?._system;
        const updateReferenceData = {
          ...referenceData,
          get value() {
            return referenceData;
          },
          toJSON() {
            return referenceData;
          },
          get system() {
            return systemData;
          }
        }
        updatedMetafields[key] = {
          get value() {
            return updateReferenceData
          },
          toJSON() {
            return referenceData
          },
          get system() {
            return systemData;
          }
        }
      }
    } else {
      const keyData = Object.prototype.hasOwnProperty.call(entry, key) ? entry[key] : undefined;
      const keyDataWithSystem = {
        ...keyData,
        toJSON() {
          return keyData
        },
        get system() {
          return safeCurrent[key].___system || null
        }
      }
      updatedMetafields[key] = {
        get value() {
          return keyDataWithSystem
        },
        toJSON() {
          return keyData
        },
        get system() {
          return safeCurrent[key].___system || null
        }
      }
    }
  }
  // Rebuild a sanitized copy of currentMetafields to avoid propagating unsafe keys
  return { ...safeCurrent, ...updatedMetafields };
}

const getUpdatedMetaobject = async (currentMetaobjects, keyBasedCt, entry, { ctUid, hash }) => {
  if (!currentMetaobjects || typeof currentMetaobjects !== 'object') return;
  const updatedMetaobjects = Object.create(null);
  const dataCSLPMapping = {};
  const normalContentType = {
    schema: Object.values(keyBasedCt),
    uid: ctUid,
  }
  await createMetaobjectEntries(normalContentType, [entry], "", "", updatedMetaobjects, dataCSLPMapping, { dataCSLPMapping: dataCSLPMapping, hash });
  for (const [rawType, typeValue] of Object.entries(updatedMetaobjects)) {
    const type = sanitizeKey(rawType);
    if (!type) continue;
    for (const [rawPath, pathValue] of Object.entries(typeValue)) {
      const path = sanitizeKey(rawPath);
      if (!path) continue;
      if (path !== '_field_type' && path !== 'values') {
        if (!updatedMetaobjects[type].values) updatedMetaobjects[type].values = [{ ...(pathValue.toJSON()) }];
        else updatedMetaobjects[type].values.push({ ...(pathValue.toJSON()) });
      }
    }
    const safeType = sanitizeKey(type);
    if (!safeType) continue;
    currentMetaobjects[safeType] = updatedMetaobjects[type];
  }
  return {
    currentMetaobjects,
    dataCSLPMapping
  };
}

const createContentTypeKeyBased = (content_type) => {
  try {
    const keyBasedCt = Object.create(null);
    for (const field of content_type) {
      const uid = sanitizeKey(field?.uid);
      if (!uid) continue;
      keyBasedCt[uid] = field;
    }
    return keyBasedCt;
  } catch (error) {
    console.error("🚀 ~ createContentTypeKeyBased ~ error:", error);
    throw error;
  }
}

const fetchGlobalField = async (uid, hash) => {
  const contentstackURL = new URL(
    `${CONTENTSTACK_PREVIEW_URL}/global_fields/${uid}`
  );
  const headers = getHeaders();
  headers.append("preview_token", CONTENTSTACK_PREVIEW_TOKEN);
  headers.append("live_preview", hash);
  const res = await fetch(contentstackURL.toString(), {
    method: "GET",
    headers: headers,
  });
  return (await res.json())?.global_field;
}

export {
  createMetaobjectEntries,
  getUpdatedProductMetafields,
  getUpdatedMetaobject,
  createContentTypeKeyBased,
  fetchData
};
