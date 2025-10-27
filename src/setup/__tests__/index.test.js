import { jest } from '@jest/globals';

// --- Environment Variable Mocking --- START ---
const mockEnv = {
    CONTENTSTACK_DELIVERY_TOKEN: 'test_delivery_token',
    CONTENTSTACK_PREVIEW_TOKEN: 'test_preview_token',
    CONTENTSTACK_ENVIRONMENT: 'test_environment',
    CONTENTSTACK_API_KEY: 'test_api_key',
    CONTENTSTACK_PREVIEW_URL: 'https://api.contentstack.io',
};

const originalEnv = { ...process.env };
process.env = {
    ...originalEnv,
    ...mockEnv,
};
// --- Environment Variable Mocking --- END ---

// Dynamic import after env vars are set
let setupModule;
let fetchData, createMetaobjectEntries, createContentTypeKeyBased, getUpdatedProductMetafields, getUpdatedMetaobject;

// Mock global.fetch is provided by jest.setup.js, but ensure we can spy/override per test
const originalFetch = global.fetch;

beforeAll(async () => {
    setupModule = await import('../index.js');
    fetchData = setupModule.fetchData;
    createMetaobjectEntries = setupModule.createMetaobjectEntries;
    createContentTypeKeyBased = setupModule.createContentTypeKeyBased;
    getUpdatedProductMetafields = setupModule.getUpdatedProductMetafields;
    getUpdatedMetaobject = setupModule.getUpdatedMetaobject;
});

afterAll(() => {
    process.env = originalEnv;
});

describe('Setup Service (src/setup/index.js)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = originalFetch;
    });

    it('fetchData should call correct URL and include preview headers', async () => {
        const mockResponseData = { entry: { title: 'Test Entry' } };
        const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValueOnce(mockResponseData) });
        await fetchData('ct', 'entry', 'hash');
        expect(spy).toHaveBeenCalledTimes(1);
        const [url, init] = spy.mock.calls[0];
        expect(url).toBe(`${mockEnv.CONTENTSTACK_PREVIEW_URL}/v3/content_types/ct/entries/entry?environment=${mockEnv.CONTENTSTACK_ENVIRONMENT}&include_schema=true`);
        expect(init.method).toBe('GET');
        expect(init.headers.get('access_token')).toBe(mockEnv.CONTENTSTACK_DELIVERY_TOKEN);
        expect(init.headers.get('api_key')).toBe(mockEnv.CONTENTSTACK_API_KEY);
        expect(init.headers.get('live_preview')).toBe('hash');
        expect(init.headers.get('preview_token')).toBe(mockEnv.CONTENTSTACK_PREVIEW_TOKEN);
    });

    it('createContentTypeKeyBased should convert schema array to object map', () => {
        const schema = [
            { uid: 'title', data_type: 'text' },
            { uid: 'price', data_type: 'number' },
        ];
        const result = createContentTypeKeyBased(schema);
        expect(result).toEqual({
            title: { uid: 'title', data_type: 'text' },
            price: { uid: 'price', data_type: 'number' },
        });
    });

    it('getUpdatedProductMetafields should handle invalid input', async () => {
        const result = await getUpdatedProductMetafields(null, {}, {}, { ctUid: 'ct', entryUid: 'e', hash: 'h' });
        expect(result).toBeUndefined();
    });

    it('createMetaobjectEntries should resolve without errors for simple schema', async () => {
        const ct = { uid: 'product', schema: [{ uid: 'title', data_type: 'text' }] };
        const entries = [{ uid: 'u1', title: 'T', _metadata: { uid: 'm1' } }];
        const entryMetaObject = {};
        const dataCSLPMapping = {};
        await expect(createMetaobjectEntries(ct, entries, 'type', 'path', entryMetaObject, dataCSLPMapping, { hash: 'h' })).resolves.toBeUndefined();
    });
}); 