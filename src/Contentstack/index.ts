import { LivePreviewShopifyConfig } from "..";

 
  // ContentstackService class for API calls
export class ContentstackService {
    private config: LivePreviewShopifyConfig;
  
    constructor(config: LivePreviewShopifyConfig) {
      if (!config.deliveryToken) {
        throw new Error('deliveryToken is required');
      }
      if (!config.previewToken) {
        throw new Error('previewToken is required');
      }
      if (!config.environment) {
        throw new Error('environment is required');
      }
      if (!config.apiKey) {
        throw new Error('apiKey is required');
      }
      this.config = {
        ...config,
        previewUrl: config.previewUrl || 'https://api.contentstack.io'
      };
    }
  
    private getHeaders(): Headers {
      const headers = new Headers();
      headers.append("Content-Type", "application/json");
      headers.append("access_token", this.config.deliveryToken);
      headers.append("api_key", this.config.apiKey);
      return headers;
    }
  
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async fetchData(ctUID: string, entryUID: string, hash: string, locale: string): Promise<unknown> {
      const contentstackURL = new URL(`${this.config.previewUrl}/v3/content_types/${ctUID}/entries/${entryUID}?environment=${this.config.environment}&include_schema=true`);
      const headers = this.getHeaders();
      headers.append("live_preview", hash);
      headers.append("preview_token", this.config.previewToken);
      const res = await fetch(contentstackURL.toString(), {
        method: "GET",
        headers: headers,
      });
      return res.json();
    }
  }