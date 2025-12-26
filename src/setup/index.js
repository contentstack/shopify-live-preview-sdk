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

const getShopifyFields = async (content_type, entries, type, Path, entryMetaObject, dataCSLPMapping, extraData) => {
  const allFields = [];
  const content_type_fields = content_type?.schema;
  // Sanitize inbound entries to avoid prototype pollution via malicious keys
  const safeEntries = Array.isArray(entries) ? entries.map(createNullProtoCopy) : [];
  for (const entry of safeEntries) {
    const entryUid = entry?._metadata?.uid ? `${Path}-${entry?._metadata?.uid}` : Path;
    let path = Path ? entryUid : entry?.uid;
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
          const createdEntries = await createMetaobjectEntries(field, groupEntries, type, tempPath, entryMetaObject, dataCSLPMapping, extraData);

          const groupGids = createdEntries?.map(({ id }) => `"${id}"`);
          const group_key = fieldUid;
          const group_value = `[${groupGids?.join(',')}]`;
          fields.push({ key: group_key, value: group_value });
        } else {
          const groupEntry = getSafeOwn(entry, fieldUid);
          if (groupEntry === undefined || groupEntry === null) continue;
          const createdEntries = await createMetaobjectEntries(field, [groupEntry], type, tempPath, entryMetaObject, dataCSLPMapping, extraData);

          const group_key = fieldUid;
          const group_value = createdEntries?.[0]?.id;
          fields.push({ key: group_key, value: group_value });
        }
      } else if (field.data_type === "blocks") {
        if (!Object.prototype.hasOwnProperty.call(entry, fieldUid)) continue;
        const blockContentTypes = field.blocks;
        const tempType = `${type}-${fieldUid}`;
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
            globalFieldContentType = await fetchGlobalField(blockContentType?.reference_to, extraData?.hash);
          }

          // Loop through each entry and collect block entries
          const entryBlockEntries = entry[fieldUid];

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
            const blockData = await createMetaobjectEntries(contentType, blockEntries, blockType, tempPath, entryMetaObject, dataCSLPMapping, { ...extraData, fieldType: 'block' });

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
        const globalFieldContentType = await fetchGlobalField(field?.reference_to, extraData?.hash);

        if (field.multiple) {
          const globalFieldResults = await createMetaobjectEntries(globalFieldContentType, entry[fieldUid], "", tempPath, entryMetaObject, dataCSLPMapping, extraData);

          const globalGids = globalFieldResults?.map(({ id }) => `"${id}"`);
          const globalField_key = fieldUid;
          const globalField_value = `[${globalGids?.join(',')}]`;
          fields.push({ key: globalField_key, value: globalField_value });
        } else {
          const globalFieldResults = await createMetaobjectEntries(globalFieldContentType, [entry[fieldUid]], "", tempPath, entryMetaObject, dataCSLPMapping, extraData);

          const globalField_key = fieldUid;
          const globalField_value = globalFieldResults?.[0]?.id
          fields.push({ key: globalField_key, value: globalField_value });
        }
      } else if (field.data_type === "reference") {
        if (!Object.prototype.hasOwnProperty.call(entry, fieldUid)) continue;

        if (field?.field_metadata?.ref_multiple) {
          const referenceGids = [];
          for (const contentType of field.reference_to || []) {
            const entriesToCreate = [];
            for (const entryData of entry[fieldUid]) {
              const { _content_type_uid, uid } = entryData;
              if (_content_type_uid === contentType) {
                const csEntry = await getEntry(_content_type_uid, uid, extraData?.hash);
                if (!csEntry) throw new Error(`Entry not found for ${_content_type_uid} and ${uid}`);
                entriesToCreate.push(csEntry);
              }
            }
            if (entriesToCreate.length) {
              const contentTypeResponse = await fetchContentType(contentType, extraData?.hash);
              const metaobjectEntries = await createMetaobjectEntries(contentTypeResponse?.content_type, entriesToCreate, entryMetaObject, dataCSLPMapping, extraData);
              metaobjectEntries?.forEach((entry) => referenceGids.push(`"${entry?.id}"`));
            }
          }
          const field_key = fieldUid;
          const field_value = `[${referenceGids.join(',')}]`;
          fields.push({ key: field_key, value: field_value });
        } else {
          const entryData = entry[fieldUid];
          if (isEmpty(entryData)) {
            fields.push({ key: fieldUid, value: null });
            continue;
          }
          const { uid: entryUid, _content_type_uid: contentTypeUid } = entryData[0] || {};

          const contentTypeResponse = await fetchContentType(contentTypeUid, extraData?.hash);
          const csEntry = await getEntry(contentTypeUid, entryUid, extraData?.hash);
          const metaobjectEntries = await createMetaobjectEntries(contentTypeResponse?.content_type, [csEntry], "", "", entryMetaObject, dataCSLPMapping, extraData);
          const metaobjectEntry = metaobjectEntries?.[0];
          const field_key = fieldUid;
          const field_value = metaobjectEntry?.id;
          fields.push({ key: field_key, value: field_value });
        }
      } else if (field.data_type === "file") {
        // TODO: Handle file field
        if (!Object.prototype.hasOwnProperty.call(entry, fieldUid)) continue;
        const entryData = entry[fieldUid];
        let field_value = "";

        if (entryData) {
          if (field?.multiple) {
            const promises = entryData?.map((file) => getAssetGid(file, extraData?.hash));
            const gids = await Promise.all(promises);
            field_value = `[${gids?.map(gid => `${gid}`).join(',')}]`;
          } else {
            const gid = await getAssetGid(entryData, extraData?.hash);
            field_value = `${gid}`;
          }
        } else {
          continue
        }

        fields.push({ key: fieldUid, value: field_value });
      } else if (field.data_type === "isodate") {
        if (!Object.prototype.hasOwnProperty.call(entry, fieldUid)) continue;
        const entryData = entry[fieldUid];
        let field_value = '';

        if (!isEmpty(entryData)) {
          if (field?.multiple) {
            const values = entryData.map((i) => {
              if (field?.field_metadata?.hide_time) return i;
              return (new Date(i)).toISOString();
            });
            field_value = `[${values.join(',')}]`;
          }
          else {
            field_value = field?.field_metadata?.hide_time ? entryData : (new Date(entryData)).toISOString();
          }
        }

        fields.push({ key: fieldUid, value: field_value });
      } else if (field.data_type === 'link') {
        if (!Object.prototype.hasOwnProperty.call(entry, fieldUid)) continue;
        const field_key = fieldUid;

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
      }
      else {
        const field_key = fieldUid;
        const field_value = `${entry[field_key] ?? ""}`;
        fields.push({ key: field_key, value: field_value });
        saveDataInObject(type, path, { key: field_key, value: field_value }, field.data_type, entryMetaObject, extraData);
        if (entry?.$?.[field_key]?.["data-cslp"] && entry?.$?.[field_key]?.["data-cslp"] !== "") {
          const rawMapKey = (entry.$[field_key]["data-cslp"]).replace(".", "_");
          const safeMapKey = sanitizeKey(rawMapKey);
          if (safeMapKey) {
            dataCSLPMapping[safeMapKey] = `${type}.${path}.$.${field_key}`;
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
      const blockData = Object.prototype.hasOwnProperty.call(entry, key) ? entry[key] : [];
      const finalBlockData = [];
      for (const block of blockData) {
        for (const blockData of Object.entries(block)) {
          const currentMetafieldsData = currentMetafields[key].find((item) => {
            return item?.___system?.handle?.includes(`-${blockData[1]?._metadata?.uid}`) || false
          });
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
        const referenceData = await refUids?.map( async (refUid) => {
          const refEntryData = await getEntry(refUid._content_type_uid, refUid.uid, hash);
          return refEntryData;
        });
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
