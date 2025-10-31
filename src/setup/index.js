import 'dotenv/config';
import lodash from 'lodash';
const { isEmpty } = lodash;


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
  for (const entry of entries) {
    const entryUid = entry?._metadata?.uid ? `${Path}-${entry?._metadata?.uid}` : Path;
    let path = Path ? entryUid : entry?.uid;
    const fields = [];
    for (const field of content_type_fields) {
      if (field.data_type === "group") {
        if (entry[field.uid] === undefined) continue;
        const tempPath = `${path}-${field.uid}`;
        if (field.multiple) {
          const createdEntries = await createMetaobjectEntries(field, entry[field.uid], type, tempPath, entryMetaObject, dataCSLPMapping, extraData);

          const groupGids = createdEntries?.map(({ id }) => `"${id}"`);
          const group_key = field?.uid;
          const group_value = `[${groupGids?.join(',')}]`;
          fields.push({ key: group_key, value: group_value });
        } else {
          const createdEntries = await createMetaobjectEntries(field, [entry[field.uid]], type, tempPath, entryMetaObject, dataCSLPMapping, extraData);

          const group_key = field?.uid;
          const group_value = createdEntries?.[0]?.id;
          fields.push({ key: group_key, value: group_value });
        }
      } else if (field.data_type === "blocks") {
        if (entry[field.uid] === undefined) continue;
        const blockContentTypes = field.blocks;
        const tempType = `${type}-${field.uid}`;
        const blockGids = [];

        // Loop through each block content type
        for (const blockContentType of blockContentTypes) {
          const tempPath = `${path}-${field.uid}-${blockContentType.uid}`;
          const isGlobalField = !isEmpty(blockContentType?.reference_to);
          let globalFieldContentType = null;

          const blockEntries = [];
          if (isGlobalField) {
            globalFieldContentType = await fetchGlobalField(blockContentType?.reference_to, extraData?.hash);
          }

          // Loop through each entry and collect block entries
          const entryBlockEntries = entry[field.uid];

          // Loop through each block entry object
          for (const blockEntryObject of entryBlockEntries) {
            const blockEntry = blockEntryObject[blockContentType?.uid];

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

        const block_key = field?.uid;
        const block_value = `[${blockGids.join(',')}]`;
        fields.push({ key: block_key, value: block_value });
      } else if (field.data_type === "global_field") {
        if (entry[field.uid] === undefined) continue;
        const tempPath = `${path}-${field.uid}`;
        const globalFieldContentType = await fetchGlobalField(field?.reference_to, extraData?.hash);

        if (field.multiple) {
          const globalFieldResults = await createMetaobjectEntries(globalFieldContentType, entry[field.uid], "", tempPath, entryMetaObject, dataCSLPMapping, extraData);

          const globalGids = globalFieldResults?.map(({ id }) => `"${id}"`);
          const globalField_key = field?.uid;
          const globalField_value = `[${globalGids?.join(',')}]`;
          fields.push({ key: globalField_key, value: globalField_value });
        } else {
          const globalFieldResults = await createMetaobjectEntries(globalFieldContentType, [entry[field.uid]], "", tempPath, entryMetaObject, dataCSLPMapping, extraData);

          const globalField_key = field?.uid;
          const globalField_value = globalFieldResults?.[0]?.id
          fields.push({ key: globalField_key, value: globalField_value });
        }
      } else if (field.data_type === "reference") {
        if (entry[field.uid] === undefined) continue;

        if (field?.field_metadata?.ref_multiple) {
          const referenceGids = [];
          for (const contentType of field.reference_to || []) {
            const entriesToCreate = [];
            for (const entryData of entry[field.uid]) {
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
          const field_key = field?.uid;
          const field_value = `[${referenceGids.join(',')}]`;
          fields.push({ key: field_key, value: field_value });
        } else {
          const entryData = entry[field.uid];
          if (isEmpty(entryData)) {
            fields.push({ key: field?.uid, value: null });
            continue;
          }
          const { uid: entryUid, _content_type_uid: contentTypeUid } = entryData[0] || {};

          const contentTypeResponse = await fetchContentType(contentTypeUid, extraData?.hash);
          const csEntry = await getEntry(contentTypeUid, entryUid, extraData?.hash);
          const metaobjectEntries = await createMetaobjectEntries(contentTypeResponse?.content_type, [csEntry], "", "", entryMetaObject, dataCSLPMapping, extraData);
          const metaobjectEntry = metaobjectEntries?.[0];
          const field_key = field?.uid;
          const field_value = metaobjectEntry?.id;
          fields.push({ key: field_key, value: field_value });
        }
      } else if (field.data_type === "file") {
        // TODO: Handle file field
        if (entry[field.uid] === undefined) continue;
        const entryData = entry[field?.uid];
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

        fields.push({ key: field?.uid, value: field_value });
      } else if (field.data_type === "isodate") {
        if (entry[field.uid] === undefined) continue;
        const entryData = entry[field.uid];
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

        fields.push({ key: field?.uid, value: field_value });
      } else if (field.data_type === 'link') {
        if (entry[field.uid] === undefined) continue;
        const field_key = field?.uid;

        if (field.multiple) {
          const field_values = entry[field.uid]
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
          const link = entry[field.uid];
          const field_value = (link.title && link.href)
            ? JSON.stringify({ text: link.title, url: link.href })
            : "";
          fields.push({ key: field_key, value: field_value });
        }
      }
      else if (field.data_type === 'json') {
        if (entry[field.uid] === undefined) continue;
        const field_key = field?.uid;
        const field_value = JSON.stringify(entry[field.uid]);
        fields.push({ key: field_key, value: field_value });
      }
      else {
        const field_key = field?.uid;
        const field_value = `${entry[field_key] ?? ""}`;
        fields.push({ key: field_key, value: field_value });
        saveDataInObject(type, path, { key: field_key, value: field_value }, field.data_type, entryMetaObject, extraData);
        if (entry?.$?.[field_key]?.["data-cslp"] && entry?.$?.[field_key]?.["data-cslp"] !== "") dataCSLPMapping[(entry.$[field_key]["data-cslp"]).replace(".", "_")] = `${type}.${path}.$.${field_key}`;
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
  if (!entryMetaObject[type]) entryMetaObject[type] = {};
  if (extraData?.fieldType) {
    entryMetaObject[type] = { ...entryMetaObject[type], _field_type: extraData.fieldType };
  }
  if (!entryMetaObject[type][path]) entryMetaObject[type][path] = {};
  if (!entryMetaObject[type].values) entryMetaObject[type].values = [];
  let updatedData = null;
  if(!isEmpty(entryMetaObject[type][path])) {
    updatedData = {
      ...(entryMetaObject[type][path]?.toJSON() || {}), [data.key]: data.value
    }
  } else {
    updatedData = {
      [data.key]: data.value
    }
  }
  entryMetaObject[type][path] = { 
    ...updatedData,
    get value() {
      return updatedData;
    },
    toJSON() {
      return updatedData;
    },
    get system() {
      return {
        type: `${type}`,
        handle: path,
        id: null,
        url: null
      }
    }
   };
}

const getUpdatedProductMetafields = async (currentMetafields, contentType, entry, { ctUid, entryUid, hash }) => {
  if (!currentMetafields || typeof currentMetafields !== 'object') return;
  const updatedMetafields = {};
  for (const [key, value] of Object.entries(currentMetafields)) {

    const keyFieldType = contentType[key] ? contentType[key].data_type : null;
    if (!keyFieldType) {
      const cleanValue = entry[key] ?? value;

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
      const blockData = entry[key];
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
      const fileData = entry[key];
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
        const refUids = entry[key];
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
        const refUid = entry[key].length ? entry[key][0] : entry[key];
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
      const keyData = entry[key];
      const keyDataWithSystem = {
        ...keyData,
        toJSON() {
          return keyData
        },
        get system() {
          return currentMetafields[key].___system || null
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
          return currentMetafields[key].___system || null
        }
      }
    }
  }
  return { ...currentMetafields, ...updatedMetafields };
}

const getUpdatedMetaobject = async (currentMetaobjects, keyBasedCt, entry, { ctUid, hash }) => {
  if (!currentMetaobjects || typeof currentMetaobjects !== 'object') return;
  const updatedMetaobjects = {};
  const dataCSLPMapping = {};
  const normalContentType = {
    schema: Object.values(keyBasedCt),
    uid: ctUid,
  }
  await createMetaobjectEntries(normalContentType, [entry], "", "", updatedMetaobjects, dataCSLPMapping, { dataCSLPMapping: dataCSLPMapping, hash });
  for (const [type, typeValue] of Object.entries(updatedMetaobjects)) {
    for (const [path, pathValue] of Object.entries(typeValue)) {
      if (path !== '_field_type' && path !== 'values') {
        if (!updatedMetaobjects[type].values) updatedMetaobjects[type].values = [{ ...(pathValue.toJSON()) }];
        else updatedMetaobjects[type].values.push({ ...(pathValue.toJSON()) });
      }
    }
    currentMetaobjects[type] = updatedMetaobjects[type];
  }
  return {
    currentMetaobjects,
    dataCSLPMapping
  };
}

const createContentTypeKeyBased = (content_type) => {
  try {
    const keyBasedCt = {};
    for (const field of content_type) {
      keyBasedCt[field.uid] = field;
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
