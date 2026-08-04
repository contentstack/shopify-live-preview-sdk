import { jest } from '@jest/globals';
import { ContentstackService } from '../index.js';
import type { LivePreviewShopifyConfig } from '../../index.js';

const validServiceConfig: LivePreviewShopifyConfig = {
  deliveryToken: 'test_delivery_token',
  previewToken: 'test_preview_token',
  environment: 'test_environment',
  apiKey: 'test_api_key',
};

// Lets a test hand the constructor a deliberately incomplete config without widening the
// exported type.
const asConfig = (value: Record<string, unknown>) =>
  value as unknown as LivePreviewShopifyConfig;

// jest.setup.js installs the global fetch/Headers mocks for every suite and utils'
// jest.config.js sets no clearMocks/resetMocks/restoreMocks — so this suite spies OVER
// that shared mock and is responsible for clearing it and putting it back itself.
const originalFetch = global.fetch;

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as never;

const spyOnFetchOnce = (response: unknown = jsonResponse({})) =>
  jest.spyOn(global, 'fetch').mockResolvedValueOnce(response as never);

describe('ContentstackService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('constructor validation', () => {
    it.each([
      ['deliveryToken', 'deliveryToken is required'],
      ['previewToken', 'previewToken is required'],
      ['environment', 'environment is required'],
      ['apiKey', 'apiKey is required'],
    ])('throws when %s is missing', (field, message) => {
      const config: Record<string, unknown> = { ...validServiceConfig };
      delete config[field];

      expect(() => new ContentstackService(asConfig(config))).toThrow(message);
    });

    it.each([
      ['deliveryToken', 'deliveryToken is required'],
      ['previewToken', 'previewToken is required'],
      ['environment', 'environment is required'],
      ['apiKey', 'apiKey is required'],
    ])('throws when %s is an empty string', (field, message) => {
      const config: Record<string, unknown> = { ...validServiceConfig, [field]: '' };

      expect(() => new ContentstackService(asConfig(config))).toThrow(message);
    });

    it('accepts a fully populated config', () => {
      expect(() => new ContentstackService(validServiceConfig)).not.toThrow();
    });
  });

  describe('fetchData', () => {
    it('builds the CDA entry URL with environment and include_schema', async () => {
      const fetchSpy = spyOnFetchOnce();
      const service = new ContentstackService({
        ...validServiceConfig,
        previewUrl: 'https://api.contentstack.io',
      });

      await service.fetchData('product_ct', 'entry_123', 'hash_abc', 'en-us');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(
        'https://api.contentstack.io/v3/content_types/product_ct/entries/entry_123?environment=test_environment&include_schema=true'
      );
      expect(init?.method).toBe('GET');
    });

    it('defaults previewUrl to the hosted Contentstack API when not supplied', async () => {
      const fetchSpy = spyOnFetchOnce();
      const service = new ContentstackService(validServiceConfig);

      await service.fetchData('ct', 'entry', 'hash', 'en-us');

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain('https://api.contentstack.io/v3/content_types/ct/entries/entry');
    });

    it('sends the delivery, api-key, live-preview and preview-token headers', async () => {
      const fetchSpy = spyOnFetchOnce();
      const service = new ContentstackService(validServiceConfig);

      await service.fetchData('ct', 'entry', 'hash_abc', 'en-us');

      const headers = fetchSpy.mock.calls[0][1]?.headers as Headers;
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('access_token')).toBe('test_delivery_token');
      expect(headers.get('api_key')).toBe('test_api_key');
      expect(headers.get('live_preview')).toBe('hash_abc');
      expect(headers.get('preview_token')).toBe('test_preview_token');
    });

    it('resolves with the parsed JSON body', async () => {
      const entryPayload = { entry: { uid: 'entry_123' }, schema: [{ uid: 'title' }] };
      spyOnFetchOnce(jsonResponse(entryPayload));
      const service = new ContentstackService(validServiceConfig);

      await expect(service.fetchData('ct', 'entry', 'hash', 'en-us')).resolves.toEqual(entryPayload);
    });

    // locale is accepted but never used in the request today (the parameter is
    // eslint-disabled at the source). Pinned so a future change is a deliberate one.
    it('does not put locale into the URL or headers', async () => {
      const fetchSpy = spyOnFetchOnce();
      const service = new ContentstackService(validServiceConfig);

      await service.fetchData('ct', 'entry', 'hash', 'fr-fr');

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).not.toContain('fr-fr');
      expect((init?.headers as Headers).get('locale')).toBeUndefined();
    });

    describe('error paths', () => {
      it('propagates a network-level fetch rejection', async () => {
        jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network unreachable') as never);
        const service = new ContentstackService(validServiceConfig);

        await expect(service.fetchData('ct', 'entry', 'hash', 'en-us')).rejects.toThrow(
          'network unreachable'
        );
      });

      // Documents the missing res.ok guard: a non-2xx response is not detected, so a
      // non-JSON error body surfaces as a parse rejection instead of an HTTP error.
      it('rejects when the body is not JSON, because res.ok is never checked', async () => {
        spyOnFetchOnce({
          ok: false,
          status: 401,
          json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
        });
        const service = new ContentstackService(validServiceConfig);

        await expect(service.fetchData('ct', 'entry', 'hash', 'en-us')).rejects.toThrow(SyntaxError);
      });

      it('resolves normally on a 4xx whose body happens to be JSON', async () => {
        const errorBody = { error_message: 'unauthorized', error_code: 105 };
        spyOnFetchOnce({ ok: false, status: 401, json: () => Promise.resolve(errorBody) });
        const service = new ContentstackService(validServiceConfig);

        // No res.ok guard means the caller receives the error body as if it were an entry.
        await expect(service.fetchData('ct', 'entry', 'hash', 'en-us')).resolves.toEqual(errorBody);
      });
    });

    describe('adversarial identifiers', () => {
      it('percent-encodes spaces but lets a slash in ctUID add a path segment', async () => {
        const fetchSpy = spyOnFetchOnce();
        const service = new ContentstackService(validServiceConfig);

        await service.fetchData('a b/c', 'entry_123', 'hash', 'en-us');

        const [url] = fetchSpy.mock.calls[0];
        // The identifier is interpolated raw, so URL parsing encodes the space and
        // keeps the slash as a separator — the ctUID is not escaped by the service.
        expect(url).toContain('/v3/content_types/a%20b/c/entries/entry_123');
      });

      it('lets a query character in entryUID alter the query string', async () => {
        const fetchSpy = spyOnFetchOnce();
        const service = new ContentstackService(validServiceConfig);

        await service.fetchData('ct', 'entry&environment=production', 'hash', 'en-us');

        const [url] = fetchSpy.mock.calls[0];
        // Documents unescaped interpolation: the injected pair lands in the query.
        expect(url).toContain('entry&environment=production');
      });
    });
  });
});
