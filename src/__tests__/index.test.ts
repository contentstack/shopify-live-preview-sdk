import { jest } from '@jest/globals';
import { LivePreviewShopify } from '../index.js';

// The "no instance yet" state lives in ./getInstance-uninitialized.test.ts — one module
// lifetime per file is the only isolation boundary available under native ESM, and this
// file configures the singleton, so it cannot also observe the unconfigured state.

const validInstanceConfig = {
  deliveryToken: 'test_delivery_token',
  previewToken: 'test_preview_token',
  environment: 'test_environment',
  apiKey: 'test_api_key',
  previewUrl: 'https://first.example.com',
};

const alternateInstanceConfig = {
  deliveryToken: 'alt_delivery_token',
  previewToken: 'alt_preview_token',
  environment: 'alt_environment',
  apiKey: 'alt_api_key',
  previewUrl: 'https://second.example.com',
};

const singleFieldSchemaFixture = [{ uid: 'title', data_type: 'text', display_name: 'Title' }];

const originalFetch = global.fetch;

describe('LivePreviewShopify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('getInstance', () => {
    it('returns the very same instance on repeated calls', () => {
      const first = LivePreviewShopify.getInstance();
      const second = LivePreviewShopify.getInstance();

      expect(second).toBe(first);
    });

    it('keeps returning that instance even when a config is supplied later', () => {
      const first = LivePreviewShopify.getInstance();
      const reconfigured = LivePreviewShopify.getInstance(validInstanceConfig);

      expect(reconfigured).toBe(first);
    });

    // This is the practical hazard behind the middleware's spy strategy: the controller
    // captures getLiquidEngine() once at import, and re-initializing swaps the engine out
    // from under that captured reference.
    it('replaces the liquid engine when re-initialized with a config', () => {
      const engineBefore = LivePreviewShopify.getInstance().getLiquidEngine();
      const engineAfter = LivePreviewShopify.getInstance(validInstanceConfig).getLiquidEngine();

      expect(engineAfter).not.toBe(engineBefore);
    });

    it('rebuilds the contentstack service so a new previewUrl takes effect', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: true, json: async () => ({}) } as never);

      const instance = LivePreviewShopify.getInstance(validInstanceConfig);
      await instance.fetchData('ct', 'entry', 'hash', 'en-us');

      LivePreviewShopify.getInstance(alternateInstanceConfig);
      await instance.fetchData('ct', 'entry', 'hash', 'en-us');

      const requested = fetchSpy.mock.calls.map((call) => String(call[0]));
      expect(requested[0]).toContain('https://first.example.com');
      expect(requested[1]).toContain('https://second.example.com');
      expect(requested[1]).toContain('environment=alt_environment');
    });

    it('throws from a re-initialization whose config is incomplete', () => {
      expect(() => LivePreviewShopify.getInstance({ deliveryToken: '' } as never)).toThrow(
        'deliveryToken is required'
      );
    });
  });

  describe('createContentTypeKeyBased', () => {
    it('keys a schema array by field uid', () => {
      const result = LivePreviewShopify.getInstance().createContentTypeKeyBased(
        singleFieldSchemaFixture as never
      );

      expect(result.title).toEqual(singleFieldSchemaFixture[0]);
    });

    it('returns an empty map for an empty schema array', () => {
      const result = LivePreviewShopify.getInstance().createContentTypeKeyBased([]);

      expect(Object.keys(result)).toEqual([]);
    });

    // Regression documentation for the middleware fix: when the CDA schema array was
    // wrapped in another array, every element was an array with no `uid`, so each one was
    // skipped and the resulting map was empty. An empty map routes every field through
    // the generic no-schema branch, which is what broke modular blocks.
    it('yields an unusable empty map when the schema is double-wrapped', () => {
      const result = LivePreviewShopify.getInstance().createContentTypeKeyBased([
        singleFieldSchemaFixture,
      ] as never);

      expect(Object.keys(result)).toEqual([]);
      expect(result.title).toBeUndefined();
    });

    it('skips fields whose uid is missing or unsafe', () => {
      const result = LivePreviewShopify.getInstance().createContentTypeKeyBased([
        { data_type: 'text' },
        { uid: '__proto__', data_type: 'text' },
        { uid: 'kept', data_type: 'text' },
      ] as never);

      expect(Object.keys(result)).toEqual(['kept']);
    });

    it('produces a prototype-free map', () => {
      const result = LivePreviewShopify.getInstance().createContentTypeKeyBased(
        singleFieldSchemaFixture as never
      );

      expect(Object.getPrototypeOf(result)).toBeNull();
    });

    it('throws when handed a non-iterable schema', () => {
      expect(() =>
        LivePreviewShopify.getInstance().createContentTypeKeyBased(null as never)
      ).toThrow();
    });
  });

  // The middleware calls these two through the class rather than importing the setup
  // module, so the delegation itself is live surface worth pinning. The dead
  // createMetaobjectEntries wrapper is deliberately left untested (it goes in Step 12).
  describe('delegating transform methods', () => {
    it('getUpdatedProductMetafields forwards to the setup transform', async () => {
      const instance = LivePreviewShopify.getInstance();
      const keyBasedCt = instance.createContentTypeKeyBased([
        { uid: 'title', data_type: 'text' },
      ] as never);

      const result = await instance.getUpdatedProductMetafields(
        { title: {} },
        keyBasedCt,
        { title: 'Updated' } as never,
        { ctUid: 'product_ct', entryUid: 'entry_1', hash: 'hash_abc' }
      );

      const fields = result as unknown as Record<string, { toJSON(): unknown }>;
      expect(fields.title.toJSON()).toBe('Updated');
    });

    it('getUpdatedProductMetafields passes the invalid-input guard through', async () => {
      const instance = LivePreviewShopify.getInstance();

      await expect(
        instance.getUpdatedProductMetafields(null, {} as never, {} as never, {
          ctUid: 'ct',
          entryUid: 'e',
          hash: 'h',
        })
      ).resolves.toBeUndefined();
    });

    it('getUpdatedMetaobject forwards to the setup transform', async () => {
      const instance = LivePreviewShopify.getInstance();
      const keyBasedCt = instance.createContentTypeKeyBased([
        { uid: 'title', data_type: 'text' },
      ] as never);

      const result = await instance.getUpdatedMetaobject(
        {},
        keyBasedCt,
        { uid: 'entry_1', title: 'Hello' } as never,
        { ctUid: 'product_ct', hash: 'hash_abc' }
      );

      const metaobject = result as unknown as {
        currentMetaobjects: Record<string, { values: unknown[] }>;
      };
      expect(metaobject.currentMetaobjects.product_ct.values).toEqual([{ title: 'Hello' }]);
    });
  });
});
