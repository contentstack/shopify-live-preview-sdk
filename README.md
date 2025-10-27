# Shopify Live Preview SDK

A utility package for Shopify live preview functionality that provides a singleton instance for configuring a Liquid template engine and integrating with Contentstack for live preview data.

## Installation

```bash
npm install @contentstack/shopify-live-preview-sdk
```

## Usage

### Basic Setup

```typescript
import { LivePreviewShopify, LivePreviewShopifyConfig } from '@contentstack/shopify-live-preview-sdk';

// Initialize with configuration
const config: LivePreviewShopifyConfig = {
  deliveryToken: process.env.CS_DELIVERY_TOKEN!,
  previewToken: process.env.CS_PREVIEW_TOKEN!,
  environment: 'development',
  apiKey: process.env.CS_API_KEY!,
  // optional
  previewUrl: 'https://api.contentstack.io',
  liquidEngineOptions: {
    // Set your views directories; absolute paths recommended
    root: ['/absolute/path/to/views'],
    extname: '.liquid'
  }
};

// Get the singleton instance
const livePreview = LivePreviewShopify.getInstance(config);

// The same instance will be returned everywhere in your application
const sameInstance = LivePreviewShopify.getInstance();
// sameInstance === livePreview // true
```

### Fetch Content (Contentstack)

```typescript
// Fetch entry data for live preview
const data = await livePreview.fetchData(
  'content_type_uid',
  'entry_uid',
  'live_preview_hash',
  'en-us'
);
```

### Render with Liquid

```typescript
// Access the configured Liquid engine
const engine = livePreview.getLiquidEngine();

// Render a template file with context
const html = await engine.renderFile('templates/index.liquid', {
  product: { title: 'Shirt' }
});
```

## Features

- Singleton pattern ensures consistent state across your application
- TypeScript support with full type definitions
- Liquid template engine configuration with custom filters/tags
- Contentstack data fetching for live preview
- Metaobject and metafield helper utilities
- Comprehensive test coverage

## Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Make your changes in the `src` directory
4. Build the package:
   ```bash
   npm run build
   ```
5. Run tests:
   ```bash
   npm test
   ```

## Scripts

- `npm run build` - Builds the package using TypeScript
- `npm test` - Runs the test suite
- `npm run lint` - Lints the code using ESLint
- `npm run format` - Formats the code using Prettier

## API Reference

### LivePreviewShopify

The main class that implements the singleton pattern.

#### Methods

- `getInstance(config?: LivePreviewShopifyConfig)`: Get the singleton instance
- `getLiquidEngine()`: Get the Liquid template engine instance
- `fetchData(ctUID: string, entryUID: string, hash: string, locale: string)`: Fetch entry data from Contentstack
- `createMetaobjectEntries(contentType, entries, type, path, entryMetaObject, dataCSLPMapping, extraData)`: Create metaobject entries
- `getUpdatedProductMetafields(currentMetafields, keyBasedCt, entry, options)`: Compute updated product metafields
- `getUpdatedMetaobject(currentMetaobjects, keyBasedCt, entry, options)`: Compute updated metaobject
- `createContentTypeKeyBased(fieldSchemas)`: Build key-based content type helper

### Interfaces

#### LivePreviewShopifyConfig
```typescript
interface LivePreviewShopifyConfig {
  deliveryToken: string;
  previewToken: string;
  environment: string;
  apiKey: string;
  previewUrl?: string;
  liquidEngineOptions?: LiquidEngineOptions;
}
```

#### LiquidEngineOptions (subset)
```typescript
interface LiquidEngineOptions {
  extname?: string; // default: '.liquid'
  root?: string | string[]; // template search paths
  cache?: boolean;
  dynamicPartials?: boolean;
  strictFilters?: boolean;
  strictVariables?: boolean;
  trimTagRight?: boolean;
  trimTagLeft?: boolean;
  trimOutputRight?: boolean;
  trimOutputLeft?: boolean;
}
```

## License

MIT 
