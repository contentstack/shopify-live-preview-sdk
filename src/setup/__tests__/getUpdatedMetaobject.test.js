import { jest } from '@jest/globals';

// --- Environment Variable Mocking --- START ---
// Same harness as ./index.test.js: env at module scope, single dynamic import in
// beforeAll, because setup/index.js reads CONTENTSTACK_* once when it loads and native
// ESM offers no per-case registry reset.
const mockEnv = {
  CONTENTSTACK_DELIVERY_TOKEN: 'test_delivery_token',
  CONTENTSTACK_PREVIEW_TOKEN: 'test_preview_token',
  CONTENTSTACK_ENVIRONMENT: 'test_environment',
  CONTENTSTACK_API_KEY: 'test_api_key',
  CONTENTSTACK_PREVIEW_URL: 'https://api.contentstack.io',
};

const originalEnv = { ...process.env };
process.env = { ...originalEnv, ...mockEnv };
// --- Environment Variable Mocking --- END ---

const originalFetch = global.fetch;

let getUpdatedMetaobject, createContentTypeKeyBased, createMetaobjectEntries;

beforeAll(async () => {
  const setupModule = await import('../index.js');
  getUpdatedMetaobject = setupModule.getUpdatedMetaobject;
  createContentTypeKeyBased = setupModule.createContentTypeKeyBased;
  createMetaobjectEntries = setupModule.createMetaobjectEntries;
});

afterAll(() => {
  process.env = originalEnv;
  global.fetch = originalFetch;
});

/** Matches stubbed CDA responses by URL substring, most specific pattern first. */
const stubCdaFetch = (routes) =>
  jest.fn(async (url) => {
    const requested = String(url);
    for (const [pattern, body] of routes) {
      if (requested.includes(pattern)) {
        return { ok: true, status: 200, json: async () => body };
      }
    }
    throw new Error(`unstubbed CDA request: ${requested}`);
  });

const options = { ctUid: 'product_ct', hash: 'hash_abc' };

// getUpdatedMetaobject takes the key-based map, so build it the way the middleware does.
const keyBasedFrom = (schema) => createContentTypeKeyBased(schema);

describe('getUpdatedMetaobject', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  describe('invalid currentMetaobjects', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'nope'],
    ])('returns undefined when currentMetaobjects is %s', async (_label, input) => {
      await expect(
        getUpdatedMetaobject(input, keyBasedFrom([]), {}, options)
      ).resolves.toBeUndefined();
    });
  });

  // The default branch is the ONLY one in getShopifyFields with a side effect that
  // escapes to the caller (via saveDataInObject writing into entryMetaObject).
  describe('scalar fields (default branch)', () => {
    it('records the field under the content type uid keyed by entry uid', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([{ uid: 'title', data_type: 'text' }]),
        { uid: 'entry_1', title: 'Hello' },
        options
      );

      const metaobject = result.currentMetaobjects.product_ct;
      expect(metaobject.entry_1.toJSON()).toEqual({ title: 'Hello' });
      expect(metaobject.values).toEqual([{ title: 'Hello' }]);
    });

    it('exposes a system descriptor naming the type and handle', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([{ uid: 'title', data_type: 'text' }]),
        { uid: 'entry_1', title: 'Hello' },
        options
      );

      expect(result.currentMetaobjects.product_ct.entry_1.system).toEqual({
        type: 'product_ct',
        handle: 'entry_1',
        id: null,
        url: null,
      });
    });

    it('merges several scalar fields into one handle', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          { uid: 'title', data_type: 'text' },
          { uid: 'subtitle', data_type: 'text' },
        ]),
        { uid: 'entry_1', title: 'Hello', subtitle: 'World' },
        options
      );

      expect(result.currentMetaobjects.product_ct.entry_1.toJSON()).toEqual({
        title: 'Hello',
        subtitle: 'World',
      });
    });

    it('stringifies a missing value to an empty string', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([{ uid: 'title', data_type: 'text' }]),
        { uid: 'entry_1' },
        options
      );

      expect(result.currentMetaobjects.product_ct.entry_1.toJSON()).toEqual({ title: '' });
    });

    it('skips schema fields with an unsafe uid', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          { uid: 'constructor', data_type: 'text' },
          { uid: 'title', data_type: 'text' },
        ]),
        { uid: 'entry_1', title: 'Hello' },
        options
      );

      expect(result.currentMetaobjects.product_ct.entry_1.toJSON()).toEqual({ title: 'Hello' });
    });
  });

  describe('data-cslp mapping', () => {
    it('maps the entry cslp key to the metaobject field path', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([{ uid: 'title', data_type: 'text' }]),
        {
          uid: 'entry_1',
          title: 'Hello',
          $: { title: { 'data-cslp': 'product_ct.entry_1.en-us.title' } },
        },
        options
      );

      // Only the FIRST '.' is replaced — String.replace with a string pattern is not global.
      expect(result.dataCSLPMapping).toEqual({
        'product_ct_entry_1.en-us.title': 'product_ct.entry_1.$.title',
      });
    });

    it('ignores an empty data-cslp value', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([{ uid: 'title', data_type: 'text' }]),
        { uid: 'entry_1', title: 'Hello', $: { title: { 'data-cslp': '' } } },
        options
      );

      expect(result.dataCSLPMapping).toEqual({});
    });
  });

  describe('group field', () => {
    it('records the nested group under its own composed type', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          { uid: 'details', data_type: 'group', schema: [{ uid: 'label', data_type: 'text' }] },
        ]),
        { uid: 'entry_1', details: { label: 'Inner' } },
        options
      );

      const nested = result.currentMetaobjects['product_ct-details'];
      expect(nested['entry_1-details'].toJSON()).toEqual({ label: 'Inner' });
      expect(nested.values).toEqual([{ label: 'Inner' }]);
    });

    // The group value is saved on the PARENT too, so a block/entry can read `parent.details.label`
    // (or `parent.details.value.label`, Shopify's metaobject style) without a second lookup.
    it('saves the group value on the parent so nested fields are reachable from it', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          { uid: 'details', data_type: 'group', schema: [{ uid: 'label', data_type: 'text' }] },
        ]),
        { uid: 'entry_1', details: { label: 'Inner' } },
        options
      );

      const parent = result.currentMetaobjects.product_ct.entry_1.toJSON();
      expect(parent.details.label).toBe('Inner');
      expect(parent.details.value.label).toBe('Inner');
    });

    it('keeps the value alias out of enumeration and JSON output', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          { uid: 'details', data_type: 'group', schema: [{ uid: 'label', data_type: 'text' }] },
        ]),
        { uid: 'entry_1', details: { label: 'Inner' } },
        options
      );

      const details = result.currentMetaobjects.product_ct.entry_1.toJSON().details;
      expect(Object.keys(details)).toEqual(['label']);
      expect(JSON.parse(JSON.stringify(details))).toEqual({ label: 'Inner' });
    });

    it('keeps repeated group items apart when each carries a _metadata uid', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          {
            uid: 'items',
            data_type: 'group',
            multiple: true,
            schema: [{ uid: 'label', data_type: 'text' }],
          },
        ]),
        {
          uid: 'entry_1',
          items: [
            { _metadata: { uid: 'i1' }, label: 'A' },
            { _metadata: { uid: 'i2' }, label: 'B' },
          ],
        },
        options
      );

      const nested = result.currentMetaobjects['product_ct-items'];
      expect(nested['entry_1-items-i1'].toJSON()).toEqual({ label: 'A' });
      expect(nested['entry_1-items-i2'].toJSON()).toEqual({ label: 'B' });
      expect(nested.values).toEqual([{ label: 'A' }, { label: 'B' }]);
    });

    // Entries of a repeatable Group carry no _metadata.uid, so they are told apart by position.
    // (They used to resolve to one shared handle, so later items overwrote earlier ones.)
    it('keeps repeated group items apart by position when they have no _metadata uid', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          {
            uid: 'items',
            data_type: 'group',
            multiple: true,
            schema: [{ uid: 'label', data_type: 'text' }],
          },
        ]),
        { uid: 'entry_1', items: [{ label: 'A' }, { label: 'B' }] },
        options
      );

      const nested = result.currentMetaobjects['product_ct-items'];
      expect(nested['entry_1-items-0'].toJSON()).toEqual({ label: 'A' });
      expect(nested['entry_1-items-1'].toJSON()).toEqual({ label: 'B' });
      expect(nested.values).toEqual([{ label: 'A' }, { label: 'B' }]);

      // ...and the parent exposes the whole list, in order, as a real array.
      const parent = result.currentMetaobjects.product_ct.entry_1.toJSON();
      expect(parent.items.map((item) => item.label)).toEqual(['A', 'B']);
      expect(parent.items.value).toBe(parent.items);
    });

    it('skips a group field the entry does not carry', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          { uid: 'details', data_type: 'group', schema: [{ uid: 'label', data_type: 'text' }] },
          { uid: 'title', data_type: 'text' },
        ]),
        { uid: 'entry_1', title: 'Hello' },
        options
      );

      expect(result.currentMetaobjects['product_ct-details']).toBeUndefined();
      expect(result.currentMetaobjects.product_ct.entry_1.toJSON()).toEqual({ title: 'Hello' });
    });

    it('skips a multiple group whose value is not an array', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          {
            uid: 'items',
            data_type: 'group',
            multiple: true,
            schema: [{ uid: 'label', data_type: 'text' }],
          },
        ]),
        { uid: 'entry_1', items: 'not-an-array' },
        options
      );

      expect(result.currentMetaobjects['product_ct-items']).toBeUndefined();
    });
  });

  describe('global_field field', () => {
    it('fetches the global field definition and records its nested type', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
        stubCdaFetch([
          [
            '/global_fields/seo_gf',
            { global_field: { uid: 'seo_gf', schema: [{ uid: 'meta_title', data_type: 'text' }] } },
          ],
        ])
      );

      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([{ uid: 'seo', data_type: 'global_field', reference_to: 'seo_gf' }]),
        { uid: 'entry_1', seo: { meta_title: 'Title' } },
        options
      );

      expect(String(fetchSpy.mock.calls[0][0])).toContain('/global_fields/seo_gf');
      expect(result.currentMetaobjects.seo_gf['entry_1-seo'].toJSON()).toEqual({
        meta_title: 'Title',
      });
    });

    it('handles a multiple global field', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(
        stubCdaFetch([
          [
            '/global_fields/seo_gf',
            { global_field: { uid: 'seo_gf', schema: [{ uid: 'meta_title', data_type: 'text' }] } },
          ],
        ])
      );

      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          { uid: 'seo', data_type: 'global_field', multiple: true, reference_to: 'seo_gf' },
        ]),
        {
          uid: 'entry_1',
          seo: [
            { _metadata: { uid: 'g1' }, meta_title: 'One' },
            { _metadata: { uid: 'g2' }, meta_title: 'Two' },
          ],
        },
        options
      );

      const nested = result.currentMetaobjects.seo_gf;
      expect(nested['entry_1-seo-g1'].toJSON()).toEqual({ meta_title: 'One' });
      expect(nested['entry_1-seo-g2'].toJSON()).toEqual({ meta_title: 'Two' });
    });
  });

  describe('reference field', () => {
    it('fetches the content type and entry, then records the referenced type', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
        stubCdaFetch([
          ['/entries/ref_1', { entry: { uid: 'ref_1', name: 'Ada' } }],
          [
            '/v3/content_types/author_ct',
            { content_type: { uid: 'author_ct', schema: [{ uid: 'name', data_type: 'text' }] } },
          ],
        ])
      );

      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          { uid: 'author', data_type: 'reference', field_metadata: { ref_multiple: false } },
        ]),
        { uid: 'entry_1', author: [{ uid: 'ref_1', _content_type_uid: 'author_ct' }] },
        options
      );

      const requested = fetchSpy.mock.calls.map((call) => String(call[0]));
      expect(requested.some((url) => url.includes('/v3/content_types/author_ct'))).toBe(true);
      expect(requested.some((url) => url.includes('/entries/ref_1'))).toBe(true);
      expect(result.currentMetaobjects.author_ct.ref_1.toJSON()).toEqual({ name: 'Ada' });
    });

    it('issues no request for an empty single reference', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(stubCdaFetch([]));

      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          { uid: 'author', data_type: 'reference', field_metadata: { ref_multiple: false } },
        ]),
        { uid: 'entry_1', author: [] },
        options
      );

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.currentMetaobjects).toEqual({});
    });

    const multipleReferenceArgs = () => {
      jest.spyOn(global, 'fetch').mockImplementation(
        stubCdaFetch([
          ['/entries/ref_1', { entry: { uid: 'ref_1', name: 'Ada' } }],
          [
            '/v3/content_types/author_ct',
            { content_type: { uid: 'author_ct', schema: [{ uid: 'name', data_type: 'text' }] } },
          ],
        ])
      );

      return [
        {},
        keyBasedFrom([
          {
            uid: 'authors',
            data_type: 'reference',
            field_metadata: { ref_multiple: true },
            reference_to: ['author_ct'],
          },
        ]),
        { uid: 'entry_1', authors: [{ uid: 'ref_1', _content_type_uid: 'author_ct' }] },
        options,
      ];
    };

    // Regression guard: the multiple-reference branch used to call createMetaobjectEntries with
    // 5 arguments against a 7-parameter signature, so the metaobject store landed in `type` and
    // the branch threw "Cannot convert object to primitive value" for any ref_multiple reference
    // that had entries to create.
    it('resolves a multiple reference through the matching content type', async () => {
      const result = await getUpdatedMetaobject(...multipleReferenceArgs());

      expect(result.currentMetaobjects.author_ct.ref_1.toJSON()).toEqual({ name: 'Ada' });
    });

    it('exposes the fetched references on the parent, in authored order', async () => {
      const result = await getUpdatedMetaobject(...multipleReferenceArgs());

      const authors = result.currentMetaobjects.product_ct.entry_1.toJSON().authors;
      expect(authors.map((a) => a.name)).toEqual(['Ada']);
      expect(authors.value).toBe(authors);
    });

    it('propagates a CDA failure while resolving a reference', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockImplementation(
          stubCdaFetch([
            ['/entries/ref_1', { error_code: 141, error_message: 'reference unreachable' }],
            ['/v3/content_types/author_ct', { content_type: { uid: 'author_ct', schema: [] } }],
          ])
        );

      await expect(
        getUpdatedMetaobject(
          {},
          keyBasedFrom([
            { uid: 'author', data_type: 'reference', field_metadata: { ref_multiple: false } },
          ]),
          { uid: 'entry_1', author: [{ uid: 'ref_1', _content_type_uid: 'author_ct' }] },
          options
        )
      ).rejects.toThrow('reference unreachable');
    });
  });

  describe('blocks field', () => {
    it('records each block under a composed type and tags it as a block', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          {
            uid: 'sections',
            data_type: 'blocks',
            blocks: [{ uid: 'hero', schema: [{ uid: 'heading', data_type: 'text' }] }],
          },
        ]),
        {
          uid: 'entry_1',
          sections: [{ hero: { _metadata: { uid: 'b1' }, heading: 'Headline' } }],
        },
        options
      );

      const nested = result.currentMetaobjects['product_ct-sections-hero'];
      expect(nested._field_type).toBe('block');
      expect(nested['entry_1-sections-hero-b1'].toJSON()).toEqual({ heading: 'Headline' });
    });

    it('resolves a block backed by a global field', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
        stubCdaFetch([
          [
            '/global_fields/hero_gf',
            { global_field: { uid: 'hero_gf', schema: [{ uid: 'heading', data_type: 'text' }] } },
          ],
        ])
      );

      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          {
            uid: 'sections',
            data_type: 'blocks',
            blocks: [{ uid: 'hero', reference_to: 'hero_gf' }],
          },
        ]),
        {
          uid: 'entry_1',
          sections: [{ hero: { _metadata: { uid: 'b1' }, heading: 'From GF' } }],
        },
        options
      );

      expect(String(fetchSpy.mock.calls[0][0])).toContain('/global_fields/hero_gf');
      expect(result.currentMetaobjects.hero_gf['entry_1-sections-hero-b1'].toJSON()).toEqual({
        heading: 'From GF',
      });
    });

    it('records nothing when no block entry matches the declared block type', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          {
            uid: 'sections',
            data_type: 'blocks',
            blocks: [{ uid: 'hero', schema: [{ uid: 'heading', data_type: 'text' }] }],
          },
        ]),
        { uid: 'entry_1', sections: [{ banner: { heading: 'Other' } }] },
        options
      );

      expect(result.currentMetaobjects).toEqual({});
    });

    // VP-2702: the Preview API returns null for an empty modular-blocks field.
    it('treats a null blocks field as empty and still refreshes the other fields', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          { uid: 'title', data_type: 'text' },
          {
            uid: 'sections',
            data_type: 'blocks',
            blocks: [{ uid: 'hero', schema: [{ uid: 'heading', data_type: 'text' }] }],
          },
        ]),
        { uid: 'entry_1', title: 'Fresh', sections: null },
        options
      );

      expect(result.currentMetaobjects.product_ct.entry_1.toJSON()).toEqual({ title: 'Fresh' });
    });
  });

  describe('file field', () => {
    // VP-2702: images vanished on edit because the file value never reached metaobjects[type].
    it('records the asset url so the theme can render it', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(
        stubCdaFetch([['/v3/assets/', { asset: { _metadata: { extensions: {} } } }]])
      );

      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          { uid: 'headline', data_type: 'text' },
          { uid: 'image', data_type: 'file' },
        ]),
        { uid: 'entry_1', headline: 'Hi', image: { uid: 'asset_1', url: 'https://images.test/a.png' } },
        options
      );

      expect(result.currentMetaobjects.product_ct.values).toEqual([
        { headline: 'Hi', image: 'https://images.test/a.png' },
      ]);
    });

    it('records every asset url for a multiple file field', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(
        stubCdaFetch([['/v3/assets/', { asset: { _metadata: { extensions: {} } } }]])
      );

      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([{ uid: 'gallery', data_type: 'file', multiple: true }]),
        {
          uid: 'entry_1',
          gallery: [
            { uid: 'asset_1', url: 'https://images.test/1.png' },
            { uid: 'asset_2', url: 'https://images.test/2.png' },
          ],
        },
        options
      );

      expect(result.currentMetaobjects.product_ct.entry_1.toJSON()).toEqual({
        gallery: ['https://images.test/1.png', 'https://images.test/2.png'],
      });
    });

    it('resolves the shopify asset gid through the assets endpoint', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
        stubCdaFetch([
          [
            '/v3/assets/asset_1',
            {
              asset: {
                uid: 'asset_1',
                _metadata: {
                  extensions: { ext_1: [{ shophify_asset_gid: 'gid://shopify/MediaImage/1' }] },
                },
              },
            },
          ],
        ])
      );

      await getUpdatedMetaobject(
        {},
        keyBasedFrom([{ uid: 'image', data_type: 'file' }]),
        { uid: 'entry_1', image: { uid: 'asset_1' } },
        options
      );

      expect(String(fetchSpy.mock.calls[0][0])).toContain('/v3/assets/asset_1?include_metadata=true');
    });

    it('resolves every asset for a multiple file field', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
        stubCdaFetch([['/v3/assets/', { asset: { _metadata: { extensions: {} } } }]])
      );

      await getUpdatedMetaobject(
        {},
        keyBasedFrom([{ uid: 'gallery', data_type: 'file', multiple: true }]),
        { uid: 'entry_1', gallery: [{ uid: 'asset_1' }, { uid: 'asset_2' }] },
        options
      );

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('skips a file field with no value', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(stubCdaFetch([]));

      await getUpdatedMetaobject(
        {},
        keyBasedFrom([{ uid: 'image', data_type: 'file' }]),
        { uid: 'entry_1', image: null },
        options
      );

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // isodate / link / json values used to be computed and then thrown away, so a theme could never
  // read them during Live Preview. They are saved now, in the shape a Shopify theme reads.
  describe('isodate, link and json fields', () => {
    it('surfaces an isodate value as an ISO string', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([{ uid: 'published_at', data_type: 'isodate' }, { uid: 'title', data_type: 'text' }]),
        { uid: 'entry_1', title: 'Kept', published_at: '2026-08-03' },
        options
      );

      expect(result.currentMetaobjects.product_ct.values).toEqual([
        { title: 'Kept', published_at: '2026-08-03T00:00:00.000Z' },
      ]);
    });

    it('surfaces a link as { text, url } and keeps title/href too', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([{ uid: 'cta', data_type: 'link' }, { uid: 'title', data_type: 'text' }]),
        { uid: 'entry_1', title: 'Kept', cta: { title: 'Buy', href: 'https://shop/x' } },
        options
      );

      const cta = result.currentMetaobjects.product_ct.entry_1.toJSON().cta;
      expect(cta).toEqual({ text: 'Buy', url: 'https://shop/x', title: 'Buy', href: 'https://shop/x' });
      // reachable the way Shopify's own link metafield is: cta.value.url
      expect(cta.value.url).toBe('https://shop/x');
    });

    it('surfaces a json field as its parsed value', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([{ uid: 'raw', data_type: 'json' }, { uid: 'title', data_type: 'text' }]),
        { uid: 'entry_1', title: 'Kept', raw: { any: 'shape' } },
        options
      );

      expect(result.currentMetaobjects.product_ct.values).toEqual([{ title: 'Kept', raw: { any: 'shape' } }]);
    });

    it('surfaces repeatable isodate and link fields as real arrays', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          { uid: 'dates', data_type: 'isodate', multiple: true },
          { uid: 'links', data_type: 'link', multiple: true },
        ]),
        {
          uid: 'entry_1',
          dates: ['2026-08-03', '2026-08-04'],
          links: [{ title: 'A', href: 'https://a' }],
        },
        options
      );

      const saved = result.currentMetaobjects.product_ct.entry_1.toJSON();
      expect(Array.from(saved.dates)).toEqual(['2026-08-03T00:00:00.000Z', '2026-08-04T00:00:00.000Z']);
      expect(saved.links[0].url).toBe('https://a');
      expect(saved.links.value).toBe(saved.links);
    });

    it('honours hide_time on an isodate field', async () => {
      const result = await getUpdatedMetaobject(
        {},
        keyBasedFrom([
          { uid: 'day', data_type: 'isodate', field_metadata: { hide_time: true } },
          { uid: 'title', data_type: 'text' },
        ]),
        { uid: 'entry_1', title: 'Kept', day: '2026-08-03' },
        options
      );

      expect(result.currentMetaobjects.product_ct.values).toEqual([{ title: 'Kept', day: '2026-08-03' }]);
    });
  });

  describe('createMetaobjectEntries return contract (Q1 root cause)', () => {
    it('currently resolves undefined, discarding the fields it computed', async () => {
      const contentType = { uid: 'product_ct', schema: [{ uid: 'title', data_type: 'text' }] };

      await expect(
        createMetaobjectEntries(contentType, [{ uid: 'e1', title: 'T' }], '', '', {}, {}, { hash: 'h' })
      ).resolves.toBeUndefined();
    });

    // The single defect behind the "[undefined]" gids: getShopifyFields builds
    // `[{handle, fields}]` but createMetaobjectEntries never returns it, so every caller
    // doing `createdEntries?.map(({id}) => …)` gets undefined. Flips green on the fix.
    it.failing('should resolve with the created entries so callers can read their ids', async () => {
      const contentType = { uid: 'product_ct', schema: [{ uid: 'title', data_type: 'text' }] };

      const created = await createMetaobjectEntries(
        contentType,
        [{ uid: 'e1', title: 'T' }],
        '',
        '',
        {},
        {},
        { hash: 'h' }
      );

      expect(Array.isArray(created)).toBe(true);
    });
  });
});
