import { jest } from '@jest/globals';

// --- Environment Variable Mocking --- START ---
// setup/index.js reads every CONTENTSTACK_* var at module scope, so env must be in place
// before the dynamic import below. Structure copied from ./index.test.js — under native
// ESM the module registry cannot be reset per case, so one env permutation per FILE.
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

// jest.setup.js owns the global fetch mock and utils' jest.config.js sets no
// clearMocks/resetMocks/restoreMocks, so clearing and restoring is this suite's job.
const originalFetch = global.fetch;

let getUpdatedProductMetafields, createContentTypeKeyBased;

beforeAll(async () => {
  const setupModule = await import('../index.js');
  getUpdatedProductMetafields = setupModule.getUpdatedProductMetafields;
  createContentTypeKeyBased = setupModule.createContentTypeKeyBased;
});

afterAll(() => {
  process.env = originalEnv;
  global.fetch = originalFetch;
});

/**
 * Dispatches a stubbed CDA response by URL substring. Patterns are matched in order, so
 * list the most specific first (an entry URL contains the content-type URL).
 */
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

const options = { ctUid: 'product_ct', entryUid: 'entry_1', hash: 'hash_abc' };

describe('getUpdatedProductMetafields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  // Migrated here from ./index.test.js so the invalid-input contract lives in one place.
  describe('invalid currentMetafields', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'not-an-object'],
      ['a number', 42],
    ])('returns undefined when currentMetafields is %s', async (_label, input) => {
      await expect(getUpdatedProductMetafields(input, {}, {}, options)).resolves.toBeUndefined();
    });

    it('returns an empty result for an empty metafields object', async () => {
      await expect(getUpdatedProductMetafields({}, {}, {}, options)).resolves.toEqual({});
    });
  });

  // A metafield key with no matching schema field takes the "unknown key" path, which
  // wraps the value with a synthesized ___system descriptor.
  describe('keys absent from the content type', () => {
    it('wraps a scalar value and prefers the entry value over the stored one', async () => {
      const result = await getUpdatedProductMetafields(
        { promo_text: 'stale value' },
        {},
        { promo_text: 'fresh value' },
        options
      );

      expect(String(result.promo_text)).toBe('fresh value');
      expect(result.promo_text.system).toEqual({
        type: 'product_ct-promo_text',
        handle: 'entry_1-promo_text',
        id: null,
        url: null,
      });
    });

    it('falls back to the stored value when the entry lacks the key', async () => {
      const result = await getUpdatedProductMetafields(
        { promo_text: 'stale value' },
        {},
        {},
        options
      );

      expect(String(result.promo_text)).toBe('stale value');
    });

    it('wraps an object value so toJSON carries the system descriptor', async () => {
      const result = await getUpdatedProductMetafields(
        { spec: { weight: 1 } },
        {},
        { spec: { weight: 2 } },
        options
      );

      expect(result.spec.toJSON()).toEqual({
        weight: 2,
        system: {
          type: 'product_ct-spec',
          handle: 'entry_1-spec',
          id: null,
          url: null,
        },
      });
      expect(result.spec.toString()).toBe(JSON.stringify({ weight: 2 }));
    });

    it('reuses an existing ___system descriptor instead of synthesizing one', async () => {
      const existingSystem = {
        type: 'existing-type',
        handle: 'existing-handle',
        id: 'gid://shopify/Metaobject/1',
        url: null,
      };

      const result = await getUpdatedProductMetafields(
        { promo_text: { ___system: existingSystem } },
        {},
        {},
        options
      );

      expect(result.promo_text.system).toEqual(existingSystem);
    });

    it('skips prototype-polluting keys', async () => {
      const hostile = { __proto__: 'evil', safe_key: 'kept' };
      const result = await getUpdatedProductMetafields(hostile, {}, {}, options);

      expect(String(result.safe_key)).toBe('kept');
      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
    });
  });

  describe('blocks field', () => {
    // keyBasedCt is always built by the real createContentTypeKeyBased, never hand-written,
    // so the tests consume the same runtime shape the middleware passes in.
    const blocksKeyBasedCt = () =>
      createContentTypeKeyBased([{ uid: 'sections', data_type: 'blocks' }]);

    it('reuses the stored ___system when a block handle matches the entry block uid', async () => {
      const storedSystem = {
        type: 'stored-type',
        handle: 'entry_1-sections-hero-block_1',
        id: 'gid://shopify/Metaobject/9',
        url: null,
      };

      const result = await getUpdatedProductMetafields(
        { sections: [{ ___system: storedSystem }] },
        blocksKeyBasedCt(),
        { sections: [{ hero: { _metadata: { uid: 'block_1' }, heading: 'Hi' } }] },
        options
      );

      const blocks = result.sections.value;
      expect(blocks).toHaveLength(1);
      expect(blocks[0].system).toEqual(storedSystem);
      expect(blocks[0].toJSON()).toMatchObject({ heading: 'Hi' });
    });

    it('synthesizes a block system descriptor when nothing matches', async () => {
      const result = await getUpdatedProductMetafields(
        { sections: [] },
        blocksKeyBasedCt(),
        { sections: [{ hero: { _metadata: { uid: 'block_9' }, heading: 'New' } }] },
        options
      );

      const blocks = result.sections.value;
      expect(blocks[0].system).toEqual({
        handle: 'entry_1-sections-hero-block_9',
        type: 'product_ct-sections-hero',
        id: 'block_9',
        url: null,
      });
    });

    it('emits a single null placeholder block when the entry has no blocks', async () => {
      const result = await getUpdatedProductMetafields(
        { sections: [] },
        blocksKeyBasedCt(),
        { sections: [] },
        options
      );

      const blocks = result.sections.value;
      expect(blocks).toHaveLength(1);
      expect(blocks[0].toJSON()).toBeNull();
      expect(blocks[0].system).toEqual({
        type: 'product_ct-sections',
        handle: 'entry_1-sections',
        id: null,
        url: null,
      });
    });

    // VP-2702: the Preview API returns null for an empty modular-blocks field.
    it('emits the placeholder instead of throwing when the blocks field is null', async () => {
      const result = await getUpdatedProductMetafields(
        { sections: [] },
        blocksKeyBasedCt(),
        { sections: null },
        options
      );

      const blocks = result.sections.value;
      expect(blocks).toHaveLength(1);
      expect(blocks[0].toJSON()).toBeNull();
    });

    it('exposes the whole blocks field with its own system descriptor', async () => {
      const result = await getUpdatedProductMetafields(
        { sections: [] },
        blocksKeyBasedCt(),
        { sections: [] },
        options
      );

      expect(result.sections.system).toEqual({
        type: 'product_ct-sections',
        handle: 'entry_1-sections',
        id: null,
        url: null,
      });
    });
  });

  // Groups, links, global fields and references INSIDE a block arrive in Contentstack's raw shape.
  // The blocks branch hands the theme the same dual-access shape Shopify does (see
  // normalizeNestedValue in setup/index.js), so one template works on both engines.
  describe('blocks field: nested values', () => {
    const blocksKeyBasedCt = () => createContentTypeKeyBased([{ uid: 'sections', data_type: 'blocks' }]);

    const faqBlock = {
      _metadata: { uid: 'faq_1' },
      section_title: 'FAQ',
      faq_items: [
        { question: 'Q1', answer: 'A1' },
        { question: 'Q2', answer: 'A2' },
      ],
      cta: { title: 'Shop', href: '/shop' },
      image: { uid: 'asset_1', url: 'https://cdn/x.jpg', filename: 'x.jpg', content_type: 'image/jpeg' },
    };

    const rebuild = async (block, current = { sections: [] }) =>
      (await getUpdatedProductMetafields(current, blocksKeyBasedCt(), { sections: [{ faq: block }] }, options))
        .sections.value[0];

    it('exposes a repeatable group as a real array with a value alias', async () => {
      const block = await rebuild(faqBlock);

      expect(Array.isArray(block.faq_items)).toBe(true);
      expect(block.faq_items.map((i) => i.question)).toEqual(['Q1', 'Q2']);
      expect(block.faq_items.value).toBe(block.faq_items);
      expect(block.faq_items[0].value.answer).toBe('A1');
    });

    it('exposes a link in the Shopify shape and keeps the raw keys', async () => {
      const block = await rebuild(faqBlock);

      expect(block.cta).toMatchObject({ text: 'Shop', url: '/shop', title: 'Shop', href: '/shop' });
      expect(block.cta.value.url).toBe('/shop');
    });

    it('leaves an asset untouched so image_url keeps working', async () => {
      const block = await rebuild(faqBlock);

      expect(block.image).toEqual(faqBlock.image);
      expect(block.image.url).toBe('https://cdn/x.jpg');
    });

    it('does not leak the value alias into serialization', async () => {
      const block = await rebuild(faqBlock);

      expect(JSON.parse(JSON.stringify(block.faq_items))).toEqual(faqBlock.faq_items);
      expect(Object.keys(block.faq_items[0])).toEqual(['question', 'answer']);
    });

    it('keeps the stored ___system handle and the block uid lookup working', async () => {
      const storedSystem = { type: 't', handle: 'entry_1-sections-faq_accordion_section-faq_1', id: null, url: null };
      const block = await rebuild(faqBlock, { sections: [{ ___system: storedSystem }] });

      expect(block.system).toEqual(storedSystem);
    });

    it('resolves a reference inside a block to the fetched entry', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockImplementation(stubCdaFetch([['/entries/ref_1', { entry: { uid: 'ref_1', name: 'Ada' } }]]));

      const block = await rebuild({
        _metadata: { uid: 'b1' },
        authors: [{ uid: 'ref_1', _content_type_uid: 'author_ct' }],
      });

      expect(block.authors).toHaveLength(1);
      expect(block.authors[0].name).toBe('Ada');
    });

    it('leaves a reference it cannot fetch as-is instead of failing the preview', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest
        .spyOn(global, 'fetch')
        .mockImplementation(stubCdaFetch([['/entries/ref_1', { error_code: 141, error_message: 'gone' }]]));

      const block = await rebuild({
        _metadata: { uid: 'b1' },
        authors: [{ uid: 'ref_1', _content_type_uid: 'author_ct' }],
      });

      expect(block.authors[0]).toEqual({ uid: 'ref_1', _content_type_uid: 'author_ct' });
    });

    it('stops following references that point back at themselves', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
        stubCdaFetch([
          [
            '/entries/loop',
            { entry: { uid: 'loop', related: [{ uid: 'loop', _content_type_uid: 'page_ct' }] } },
          ],
        ])
      );

      const block = await rebuild({
        _metadata: { uid: 'b1' },
        related: [{ uid: 'loop', _content_type_uid: 'page_ct' }],
      });

      expect(block.related[0].uid).toBe('loop');
      expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('issues no request when the block holds no references', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(stubCdaFetch([]));

      await rebuild(faqBlock);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    // The point of the dual shape: one template, both engines. Real Shopify reads
    // `block.cta.value.url` / `block.faq_items.value`; the plain-object style reads them directly.
    it('renders through Liquid with either access style', async () => {
      const { Liquid } = await import('liquidjs');
      const block = await rebuild(faqBlock);

      const html = await new Liquid().parseAndRender(
        '{% for i in block.faq_items %}[{{ i.question }}={{ i.answer }}]{% endfor %}' +
          '|{% for i in block.faq_items.value %}<{{ i.value.question }}>{% endfor %}' +
          '|{{ block.cta.url }}|{{ block.cta.value.text }}|{{ block.faq_items.size }}',
        { block }
      );

      expect(html).toBe('[Q1=A1][Q2=A2]|<Q1><Q2>|/shop|Shop|2');
    });
  });

  // The live-preview entry can arrive without a block `_metadata.uid`. Synthesizing a handle then
  // ("<entry>-sections-<type>") makes the theme read the block TYPE as the block id, and the block no
  // longer matches the page's own copy of itself. The page's real handle is recovered by block type
  // and by position among blocks of that type.
  describe('blocks field: block without a _metadata uid', () => {
    const blocksKeyBasedCt = () => createContentTypeKeyBased([{ uid: 'sections', data_type: 'blocks' }]);
    const baselineFor = (...handles) => ({
      sections: handles.map((handle) => ({ ___system: { handle, type: 't', id: null, url: null } })),
    });
    const rebuild = (blocks, current) =>
      getUpdatedProductMetafields(current, blocksKeyBasedCt(), { sections: blocks }, options).then(
        (result) => result.sections.value
      );

    it('reuses the page handle of the same block type', async () => {
      const blocks = await rebuild(
        [{ faq: { section_title: 'FAQ' } }],
        baselineFor('entry_1-sections-faq-cs_real_uid')
      );

      expect(blocks).toHaveLength(1);
      expect(blocks[0].system.handle).toBe('entry_1-sections-faq-cs_real_uid');
    });

    it('matches several uid-less blocks of one type to the page handles in order', async () => {
      const blocks = await rebuild(
        [
          { hero: { heading: 'A' } },
          { faq: { section_title: 'one' } },
          { faq: { section_title: 'two' } },
        ],
        baselineFor('entry_1-sections-hero-cs_h', 'entry_1-sections-faq-cs_f1', 'entry_1-sections-faq-cs_f2')
      );

      expect(blocks.map((b) => b.system.handle)).toEqual([
        'entry_1-sections-hero-cs_h',
        'entry_1-sections-faq-cs_f1',
        'entry_1-sections-faq-cs_f2',
      ]);
    });

    it('does not borrow a handle that belongs to a different block type', async () => {
      const blocks = await rebuild([{ faq: { section_title: 'FAQ' } }], baselineFor('entry_1-sections-hero-cs_h'));

      expect(blocks[0].system.handle).toBe('entry_1-sections-faq');
    });

    it('still synthesizes a descriptor when the page has no baseline for the block', async () => {
      const blocks = await rebuild([{ faq: { section_title: 'FAQ' } }], { sections: [] });

      expect(blocks[0].system).toEqual({
        handle: 'entry_1-sections-faq',
        type: 'product_ct-sections-faq',
        id: undefined,
        url: null,
      });
    });

    it('prefers the uid match when the block does carry a _metadata uid', async () => {
      const blocks = await rebuild(
        [{ faq: { _metadata: { uid: 'cs_b' }, section_title: 'FAQ' } }],
        baselineFor('entry_1-sections-faq-cs_a', 'entry_1-sections-faq-cs_b')
      );

      expect(blocks[0].system.handle).toBe('entry_1-sections-faq-cs_b');
    });
  });

  describe('file field', () => {
    const fileKeyBasedCt = () => createContentTypeKeyBased([{ uid: 'gallery', data_type: 'file' }]);

    it('serializes to the list of asset urls', async () => {
      const result = await getUpdatedProductMetafields(
        { gallery: [] },
        fileKeyBasedCt(),
        { gallery: [{ url: 'https://cdn/a.png' }, { url: 'https://cdn/b.png' }] },
        options
      );

      expect(result.gallery.toJSON()).toEqual(['https://cdn/a.png', 'https://cdn/b.png']);
    });

    it('yields an empty url list when the entry has no asset for the key', async () => {
      const result = await getUpdatedProductMetafields(
        { gallery: [] },
        fileKeyBasedCt(),
        {},
        options
      );

      expect(result.gallery.toJSON()).toEqual([]);
    });
  });

  describe('reference field', () => {
    it('fetches the referenced entry for a single reference', async () => {
      const referencedEntry = { uid: 'ref_1', _content_type_uid: 'author', name: 'Ada' };
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(stubCdaFetch([['/entries/ref_1', { entry: referencedEntry }]]));

      const result = await getUpdatedProductMetafields(
        { author: { _system: { handle: 'stored-handle' } } },
        createContentTypeKeyBased([{ uid: 'author', data_type: 'reference', multiple: false }]),
        { author: [{ uid: 'ref_1', _content_type_uid: 'author' }] },
        options
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0][0])).toContain(
        '/v3/content_types/author/entries/ref_1?environment=test_environment'
      );
      expect(result.author.toJSON()).toEqual(referencedEntry);
      expect(result.author.system).toEqual({ handle: 'stored-handle' });
    });

    it('propagates a CDA error for a single reference', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockImplementation(
          stubCdaFetch([['/entries/ref_1', { error_code: 141, error_message: 'no access' }]])
        );

      await expect(
        getUpdatedProductMetafields(
          { author: {} },
          createContentTypeKeyBased([{ uid: 'author', data_type: 'reference', multiple: false }]),
          { author: [{ uid: 'ref_1', _content_type_uid: 'author' }] },
          options
        )
      ).rejects.toThrow('no access');
    });

    it('resolves each reference before deriving its system descriptor', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockImplementation(
          stubCdaFetch([['/entries/ref_1', { entry: { uid: 'ref_1', _content_type_uid: 'author' } }]])
        );

      const result = await getUpdatedProductMetafields(
        { authors: [] },
        createContentTypeKeyBased([{ uid: 'authors', data_type: 'reference', multiple: true }]),
        { authors: [{ uid: 'ref_1', _content_type_uid: 'author' }] },
        options
      );

      const references = result.authors.value;
      expect(references).toHaveLength(1);
      expect(references[0].system).toEqual({ handle: 'ref_1', type: 'author', id: null, url: null });
    });

    // An unawaited failure here is an unhandled rejection, which exits the caller's process.
    it('propagates a CDA error for one of multiple references', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockImplementation(
          stubCdaFetch([
            ['/entries/ref_1', { entry: { uid: 'ref_1', _content_type_uid: 'author' } }],
            ['/entries/ref_2', { error_code: 141, error_message: 'no access' }],
          ])
        );

      await expect(
        getUpdatedProductMetafields(
          { authors: [] },
          createContentTypeKeyBased([{ uid: 'authors', data_type: 'reference', multiple: true }]),
          {
            authors: [
              { uid: 'ref_1', _content_type_uid: 'author' },
              { uid: 'ref_2', _content_type_uid: 'author' },
            ],
          },
          options
        )
      ).rejects.toThrow('no access');
    });
  });

  describe('every other data_type (default branch)', () => {
    it.each([
      ['text', 'Some copy'],
      ['number', 42],
      ['boolean', true],
      ['isodate', '2026-08-03T00:00:00.000Z'],
      ['json', { nested: true }],
    ])('passes a %s field through with the stored system descriptor', async (dataType, value) => {
      const storedSystem = { type: 'stored', handle: 'stored-handle', id: null, url: null };

      const result = await getUpdatedProductMetafields(
        { field_a: { ___system: storedSystem } },
        createContentTypeKeyBased([{ uid: 'field_a', data_type: dataType }]),
        { field_a: value },
        options
      );

      expect(result.field_a.toJSON()).toEqual(value);
      expect(result.field_a.system).toEqual(storedSystem);
    });

    it('reports a null system when the stored metafield has no ___system', async () => {
      const result = await getUpdatedProductMetafields(
        { field_a: {} },
        createContentTypeKeyBased([{ uid: 'field_a', data_type: 'text' }]),
        { field_a: 'value' },
        options
      );

      expect(result.field_a.system).toBeNull();
    });

    it('yields undefined for a key the entry does not carry', async () => {
      const result = await getUpdatedProductMetafields(
        { field_a: {} },
        createContentTypeKeyBased([{ uid: 'field_a', data_type: 'text' }]),
        {},
        options
      );

      expect(result.field_a.toJSON()).toBeUndefined();
    });
  });

  describe('result composition', () => {
    it('keeps untouched metafields alongside the updated ones', async () => {
      const result = await getUpdatedProductMetafields(
        { field_a: {}, untouched: 'kept' },
        createContentTypeKeyBased([{ uid: 'field_a', data_type: 'text' }]),
        { field_a: 'updated' },
        options
      );

      expect(Object.keys(result).sort()).toEqual(['field_a', 'untouched']);
    });
  });
});
