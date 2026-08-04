import { jest } from '@jest/globals';
import { LivePreviewShopify } from '../index.js';

// This file exists ONLY to observe a pristine module state. The singleton is stored in a
// module-level static, and under native ESM there is no registry reset — so "no instance
// configured yet" is observable exactly once per module lifetime, i.e. once per FILE.
// Nothing here may call getInstance(config) before the unconfigured assertions below.

const validInstanceConfig = {
  deliveryToken: 'test_delivery_token',
  previewToken: 'test_preview_token',
  environment: 'test_environment',
  apiKey: 'test_api_key',
  previewUrl: 'https://api.contentstack.io',
};

const originalFetch = global.fetch;

describe('unconfigured instance', () => {
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('creates an instance even when no config is supplied', () => {
    const instance = LivePreviewShopify.getInstance();

    expect(instance).toBeInstanceOf(LivePreviewShopify);
  });

  it('still provides a liquid engine, which the constructor sets up unconditionally', () => {
    const instance = LivePreviewShopify.getInstance();

    expect(instance.getLiquidEngine()).toBeDefined();
    expect(instance.getLiquidEngine().parseAndRender).toBeInstanceOf(Function);
  });

  it('rejects fetchData with a configuration error', async () => {
    const instance = LivePreviewShopify.getInstance();

    await expect(instance.fetchData('ct', 'entry', 'hash', 'en-us')).rejects.toThrow(
      'LivePreviewShopify is not configured. Please call getInstance with configuration.'
    );
  });

  // Ordered last: this is the first call that supplies config, so it ends the
  // unconfigured window for this module lifetime.
  it('starts issuing CDA requests once config is supplied', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => ({ entry: {} }) } as never);

    const instance = LivePreviewShopify.getInstance(validInstanceConfig);
    await instance.fetchData('ct', 'entry', 'hash', 'en-us');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain(
      '/v3/content_types/ct/entries/entry?environment=test_environment'
    );
  });
});
