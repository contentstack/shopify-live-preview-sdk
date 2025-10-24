import { jest } from '@jest/globals';

// Handle circular structures in test output
const getCircularReplacer = () => {
  const seen = new WeakSet();
  return (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  };
};

// Replace the default stringifier
const originalStringify = JSON.stringify;
JSON.stringify = function(value, replacer, space) {
  return originalStringify(value, replacer || getCircularReplacer(), space);
};

// Mock fetch for tests
const mockFetch = jest.fn(() => 
  Promise.resolve({
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Map([['content-type', 'application/json']])
  })
);

// Mock Response constructor
const mockResponse = jest.fn().mockImplementation((body, init) => ({
  json: () => Promise.resolve(JSON.parse(body)),
  text: () => Promise.resolve(body),
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: new Map(Object.entries(init?.headers || {}))
}));

// Mock Headers constructor
const mockHeaders = jest.fn().mockImplementation(() => {
  const headers = new Map();
  return {
    append: (key, value) => headers.set(key, value),
    delete: (key) => headers.delete(key),
    get: (key) => headers.get(key),
    has: (key) => headers.has(key),
    set: (key, value) => headers.set(key, value),
    forEach: (callback) => headers.forEach(callback),
    entries: () => headers.entries(),
    keys: () => headers.keys(),
    values: () => headers.values(),
    [Symbol.iterator]: () => headers[Symbol.iterator]()
  };
});

// Mock Github module
// jest.mock('./src/Github/index.ts', () => {
//   const mockContent = {
//     name: 'test.liquid',
//     path: 'test.liquid',
//     type: 'file',
//     size: 100,
//     content: '',
//     sha: 'test-sha',
//     url: 'https://api.github.com/repos/test/test/contents/test.liquid',
//     git_url: 'https://api.github.com/repos/test/test/git/blobs/test-sha',
//     html_url: 'https://github.com/test/test/blob/main/test.liquid',
//     download_url: 'https://raw.githubusercontent.com/test/test/main/test.liquid'
//   };

//   const mockGetRepositoryContent = jest.fn();
//   mockGetRepositoryContent.mockImplementation(() => Promise.resolve([mockContent]));

//   return {
//     __esModule: true,
//     getRepositoryContent: mockGetRepositoryContent
//   };
// });

// Removed heavy mock of './src/setup/index.js' to test real implementation

// Assign mocks to global
Object.assign(global, {
  fetch: mockFetch,
  Response: mockResponse,
  Headers: mockHeaders
}); 