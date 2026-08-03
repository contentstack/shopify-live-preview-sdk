// @ts-nocheck
/* eslint-disable */
// This file contains custom Liquid filters and tags that require loose type checking
// due to the nature of Liquid template engine's dynamic behavior

import { Liquid } from 'liquidjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Section names reach `renderFile`, so only a bare file-name shape is allowed through — anything
// with a path separator or traversal segment is rejected before it can resolve a file.
const SECTION_NAME_PATTERN = /^[\w-]+$/;

// Fallback for `{% paginate ... by <n> %}` when n is missing or not a usable page size. Themes read
// `paginate.page_size` arithmetically, so zero or negative must never reach the stub.
const DEFAULT_PAGINATE_PAGE_SIZE = 50;

/**
 * Registers a Shopify block tag whose body is captured as raw text instead of being parsed as
 * Liquid, plus its dummy end tag. Raw capture is required because these bodies legitimately
 * contain other Liquid tags (e.g. a {% doc %} @example showing {% content_for %}) that must not
 * be parsed or rendered.
 * @param engine Liquid engine to register on
 * @param tagName Shopify tag name, e.g. 'doc' — its closer is assumed to be `end<tagName>`
 * @param renderCapturedText Turns the captured body text into the tag's rendered output
 */
function registerRawContentBlockTag(engine: Liquid, tagName: string, renderCapturedText: (capturedText: string) => string): void {
    const endTagName = `end${tagName}`;

    engine.registerTag(tagName, {
        parse(tagToken, remainTokens) {
            this.capturedTokensText = [];

            let token;
            while ((token = remainTokens.shift())) {
                if (token.name === endTagName) return;
                this.capturedTokensText.push(token.getText?.() ?? String(token.value ?? ''));
            }

            throw new Error(`tag {% ${tagName} %} not closed`);
        },
        render() {
            return renderCapturedText(this.capturedTokensText.join('\n'));
        },
    });

    // Dummy registration for end tag to prevent "not found" errors
    engine.registerTag(endTagName, {
        parse() { },
        render() {
            return '';
        },
    });
}

export interface LiquidEngineOptions {
    extname?: string;
    root?: string | string[];
    cache?: boolean;
    dynamicPartials?: boolean;
    strictFilters?: boolean;
    strictVariables?: boolean;
    trimTagRight?: boolean;
    trimTagLeft?: boolean;
    trimOutputRight?: boolean;
    trimOutputLeft?: boolean;
    root?: string | string[];
}

/**
 * Sets up and configures a new Liquid engine instance
 * @param options Configuration options for the Liquid engine
 * @returns Configured Liquid engine instance
 */
export function setupLiquidEngine(options: LiquidEngineOptions = {}): Liquid {
    const defaultOptions: LiquidEngineOptions = {
        extname: '.liquid',
        cache: process.env.NODE_ENV === 'production',
        dynamicPartials: true,
        strictFilters: false,
        strictVariables: false,
        trimTagRight: false,
        trimTagLeft: false,
        trimOutputRight: false,
        trimOutputLeft: false,
        root: [
            path.resolve(__dirname, 'views'),              // Main views folder
            path.resolve(__dirname, 'views/snippets'),     // Snippets directory
            path.resolve(__dirname, 'views/sections'),     // Sections directory
            path.resolve(__dirname, 'views/assets'),     // assets directory
            path.resolve(__dirname, 'views/config'),     // config directory
            path.resolve(__dirname, 'views/layout'),     // layout directory
            path.resolve(__dirname, 'views/locales'),     // locales directory
            path.resolve(__dirname, 'views/templates'),     // templates directory
        ]
    };

    // Merge default options with provided options
    const finalOptions = {
        ...defaultOptions,
        ...options
    };

    // Create and configure the Liquid engine
    const engine = new Liquid(finalOptions);


    // // Register a custom "style" block to handle paired tags
    engine.registerTag('style', {
        parse(tagToken, remainTokens) {
            this.styles = [];

            // Iterate until we find the "endstyle" tag
            let token;
            while ((token = remainTokens.shift())) {
                if (token.name === 'endstyle') break; // Exit on {%- endstyle -%}
                this.styles.push(token.value || token);
            }
        },
        render(ctx) {
            return `<style>${this.styles.join('\n')}</style>`;
        },
    });

    // Dummy registration for end tag to prevent "not found" errors
    engine.registerTag('endstyle', {
        parse() { },
        render() {
            return '';
        },
    });

    // Register the custom "schema" tag
    engine.registerTag('schema', {
        parse(tagToken, remainTokens) {
            this.schemaContent = [];

            let token;
            while ((token = remainTokens.shift())) {
                if (token.name === 'endschema') break;
                // Ensure we capture raw text, even from other token types
                this.schemaContent.push(token.getText ? token.getText() : token.value || token);
            }
        },
        render(ctx) {
            const schemaJson = this.schemaContent.join('\n');
            try {
                const schema = JSON.parse(schemaJson);
                return `<script type="application/json">${JSON.stringify(schema)}</script>`;
            } catch (err) {
                console.error('Error parsing schema:', err.message);
                return `<script>Error: Invalid schema</script>`;
            }
        },
    });

    // Register the "endschema" tag (dummy tag to complete the block)
    engine.registerTag('endschema', {
        parse() { },
        render() {
            return '';
        },
    });

    // Shopify theme tags that LiquidJS does not know about. Unregistered tags are a parse error,
    // so every one of these must at minimum parse cleanly for a customer theme to preview at all.
    registerRawContentBlockTag(engine, 'doc', () => '');
    registerRawContentBlockTag(engine, 'javascript', (capturedText) => `<script>${capturedText}</script>`);
    registerRawContentBlockTag(engine, 'stylesheet', (capturedText) => `<style>${capturedText}</style>`);

    // Theme blocks need section/block settings the preview payload does not carry, so this renders
    // nothing. Its arguments are deliberately never read.
    engine.registerTag('content_for', {
        parse() { },
        render() {
            return '';
        },
    });

    engine.registerTag('section', {
        parse(tagToken) {
            this.sectionName = (tagToken.args ?? '').trim().replace(/^['"]|['"]$/g, '');
        },
        render: async function (ctx) {
            // Preview theme copies are frequently partial, so a section that cannot be resolved
            // leaves a comment rather than failing the whole page render. A rejected name is not
            // echoed back — it can contain '-->' and break out of the comment.
            if (!SECTION_NAME_PATTERN.test(this.sectionName)) {
                return '<!-- section not found in preview -->';
            }

            try {
                return await this.liquid.renderFile(`sections/${this.sectionName}.liquid`, ctx.getAll());
            } catch (err) {
                console.error(`Error rendering section '${this.sectionName}':`, err.message);
                return `<!-- section '${this.sectionName}' not found in preview -->`;
            }
        },
    });

    // Rendering a real section group needs the group JSON plus per-section settings, none of which
    // the preview payload carries — Phase 1 only guarantees the tag parses.
    engine.registerTag('sections', {
        parse(tagToken) {
            this.sectionGroupName = (tagToken.args ?? '').trim().replace(/^['"]|['"]$/g, '');
        },
        render() {
            if (!SECTION_NAME_PATTERN.test(this.sectionGroupName)) {
                return '<!-- section group omitted in preview -->';
            }
            return `<!-- section group '${this.sectionGroupName}' omitted in preview -->`;
        },
    });

    // Preview renders a single page, so the inner content is rendered once against a stub
    // `paginate` object — enough for themes that read it, without a real paginated data source.
    engine.registerTag('paginate', {
        parse(tagToken, remainTokens) {
            this.pageTemplates = [];

            const pageSizeMatch = (tagToken.args ?? '').match(/by\s+(\d+)/);
            const requestedPageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : NaN;
            this.pageSize = Number.isFinite(requestedPageSize) && requestedPageSize > 0
                ? Math.floor(requestedPageSize)
                : DEFAULT_PAGINATE_PAGE_SIZE;

            // 'template' (not 'token') is what yields parsed templates — a 'token' handler
            // short-circuits parsing and leaves raw tokens the renderer cannot render.
            const stream = this.liquid.parser.parseStream(remainTokens);
            stream
                .on('template', (template) => {
                    this.pageTemplates.push(template);
                })
                .on('tag:endpaginate', () => {
                    stream.stop();
                })
                .on('end', () => {
                    throw new Error(`tag {% paginate %} not closed`);
                });
            stream.start();
        },
        // A generator render (rather than async) is required here: renderTemplates is a generator,
        // so the scope pushed below must stay on the context until the engine has driven it.
        render: function* (ctx, emitter) {
            const previewPaginateStub = {
                current_page: 1,
                current_offset: 0,
                page_size: this.pageSize,
                pages: 1,
                parts: [],
                previous: null,
                next: null,
                items: this.pageSize,
            };

            ctx.push({ paginate: previewPaginateStub });
            try {
                yield this.liquid.renderer.renderTemplates(this.pageTemplates, ctx, emitter);
            } finally {
                ctx.pop();
            }
        },
    });

    // Custom Tag: {% endpaginate %} - No need to render anything
    engine.registerTag('endpaginate', {
        render: function () {
            return '';
        }
    });

    engine.registerFilter('asset_url', function (filename) {
        return `/assets/${filename}`;
    });

    engine.registerFilter('placeholder_svg_tag', function (name, className) {
        return `<svg class="${className}" width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="gray"/></svg>`;
    });

    engine.registerFilter('image_url', (image, options = {}) => {
        
        if (!image) {
            return '/placeholder-image.jpg';
        }
        
        let baseUrl = '';
        if (typeof image === 'string') {
            baseUrl = image;
        } else if (image.url) {
            baseUrl = image.url;
        } else if (image.src) {
            baseUrl = image.src;
        } else {
            return '/placeholder-image.jpg';
        }
    
        // Handle width parameter
        if (options.width) {
            const separator = baseUrl.includes('?') ? '&' : '?';
            return `${baseUrl}${separator}width=${options.width}`;
        }
    
        return baseUrl;
    });

    engine.registerFilter('safe_preview_image', (media) => {
        if (!media) return { width: 1100, height: 1100, aspect_ratio: 1.0 };
        if (!media.preview_image) {
            return {
                width: media.width || 1100,
                height: media.height || 1100,
                aspect_ratio: media.aspect_ratio || 1.0,
                alt: media.alt || '',
                url: media.url || media.src || '/placeholder-image.jpg'
            };
        }
        return media.preview_image;
    });

    // Custom Tag: {% form %} - Ignore it in non-Shopify environments
    engine.registerTag('form', {
        parse: function (token, remainingTokens) {
            const args = token.args; // Capture form arguments
            this.formContent = [];
            this.formArgs = args;

            let stream = this.liquid.parser.parseStream(remainingTokens);
            stream
                .on('token', (token) => {
                    if (token.name === 'endform') stream.stop(); // Stop at {% endform %}
                    else this.formContent.push(token);
                })
                .on('end', () => {
                    throw new Error(`tag {% form %} not closed`); // If no {% endform %}
                });
            stream.start();
        },
        render: async function (ctx) {
            const formContent = await this.liquid.renderer.renderTemplates(this.formContent, ctx);

            // Mock Shopify's form behavior (modify as needed)
            return `<form method="post" action="/cart/add" ${this.formArgs}>
                ${formContent}
              </form>`;
        }
    });

    // Custom Tag: {% endform %} - No need to render anything
    engine.registerTag('endform', {
        render: function () {
            return ''; // Just act as a closing tag
        }
    });

    engine.registerTag('render', {
        parse: function (token, remainTokens) {
            const argsString = token.args.trim();
    
            this.params = {}; // Will store { key: rawValueString }
            this.file = null;
            this.fileExpression = null;
    
            // Regex to capture:
            // 1. Quoted filename (this.file)
            // 2. The rest of the arguments string (paramsString)
            // The /s flag allows . to match newline characters for multi-line params.
            const quotedFileWithParamsMatch = argsString.match(/^['"]([^'"]+)['"]\s*(.*)$/s);
    
            if (quotedFileWithParamsMatch) {
                this.file = quotedFileWithParamsMatch[1]; // The filename, e.g., "price"
                let paramsString = quotedFileWithParamsMatch[2] ? quotedFileWithParamsMatch[2].trim() : "";
    
                // If paramsString started with a comma (e.g., "'file', param:val"), remove it.
                if (paramsString.startsWith(',')) {
                    paramsString = paramsString.substring(1).trim();
                }
    
                if (paramsString) {
                    // Regex to parse "key: value" pairs.
                    // Value part is "((?!,?\s*[\w-]+\s*:).)+" which means "match everything until
                    // the next potential 'key:' pair or end of paramsString".
                    // The /gs flag makes it global and allows . in value to match newlines.
                    const paramRegex = /([\w-]+)\s*:\s*(((?!,?\s*[\w-]+\s*:).)+)/gs;
                    let paramMatch;
                    while ((paramMatch = paramRegex.exec(paramsString)) !== null) {
                        const key = paramMatch[1].trim();
                        const valueStr = paramMatch[2].trim();
                        // Store the raw value string - we'll evaluate it in the render phase
                        this.params[key] = valueStr;
                    }
                }
            } else if (argsString.match(/^[\w.-]+$/) && !argsString.includes("'") && !argsString.includes('"') && !argsString.includes(":")) {
                // For simple unquoted identifiers like {% render block %} or {% render variable_name %}
                this.fileExpression = argsString;
            } else {
                // If it doesn't match either pattern, it's an invalid syntax for this tag.
                throw new Error(`Invalid arguments for render tag: "${argsString}". Expected a quoted filename with optional 'key: value' pairs, or a single variable/identifier.`);
            }
        },
    
        render: async function (ctx) {
            let filenameToRender;
            const localContextFromParams = {};
    
            // Helper function to evaluate variable paths
            const evaluateVariablePath = (context, path) => {
                const parts = path.split('.');
                let current = context.getAll();
                
                for (const part of parts) {
                    if (current && typeof current === 'object' && part in current) {
                        current = current[part];
                    } else {
                        return undefined;
                    }
                }
                
                return current;
            };
    
            // Evaluate all parameter expressions against the current context
            for (const key in this.params) {
                const valueStr = this.params[key]; // Raw string like "endorsement_details.system" or "'name'"
                
                try {
                    // Handle different types of values
                    if ((valueStr.startsWith("'") && valueStr.endsWith("'")) || 
                        (valueStr.startsWith('"') && valueStr.endsWith('"'))) {
                        // It's a quoted string literal - remove quotes
                        localContextFromParams[key] = valueStr.substring(1, valueStr.length - 1);
                    } else if (valueStr === 'true') {
                        // Boolean true
                        localContextFromParams[key] = true;
                    } else if (valueStr === 'false') {
                        // Boolean false
                        localContextFromParams[key] = false;
                    } else if (/^\d+$/.test(valueStr)) {
                        // Integer
                        localContextFromParams[key] = parseInt(valueStr, 10);
                    } else if (/^\d+\.\d+$/.test(valueStr)) {
                        // Float
                        localContextFromParams[key] = parseFloat(valueStr);
                    } else {
                        // Assume it's a variable path like "endorsement_details.system" or "product"
                        const value = evaluateVariablePath(ctx, valueStr);
                        localContextFromParams[key] = value;
                    }
                } catch (e) {
                    console.error(`[Custom Render] Error evaluating parameter "${key}" with value "${valueStr}":`, e);
                    localContextFromParams[key] = null;
                }
            }
    
            let blockContext = {}; // For handling {% render block %}
    
            if (this.file) {
                filenameToRender = this.file;
            } else if (this.fileExpression) {
                const evaluatedExpr = await ctx.get(this.fileExpression);
    
                if (typeof evaluatedExpr === 'string') {
                    filenameToRender = evaluatedExpr;
                } else if (typeof evaluatedExpr === 'object' && evaluatedExpr !== null && this.fileExpression === 'block') {
                    const block = evaluatedExpr;
                    blockContext = { block: block }; // Make the block object available as 'block'
    
                    if (block.type) {
                        filenameToRender = block.type === '@app' ? 'app-block' : block.type;
                    } else {
                        throw new Error(`[Custom Render] Cannot render block: "block.type" is missing. Block data: ${JSON.stringify(block)}`);
                    }
                } else {
                    throw new Error(`[Custom Render] Could not resolve filename from expression "${this.fileExpression}". Evaluated to: ${typeof evaluatedExpr}`);
                }
            } else {
                throw new Error('[Custom Render] Render tag called without a file or file expression.');
            }
    
            if (!filenameToRender) {
                return `<!-- Render failed: Could not determine snippet for ${this.fileExpression || this.file} -->`;
            }
    
            const filePath = `${filenameToRender}.liquid`;
            const parentScope = ctx.getAll();
    
            // ✅ ENSURE GLOBAL VARIABLES ARE ALWAYS AVAILABLE
            // Extract and preserve global Shopify variables
            const globalVariables = {
                // Core Shopify globals
                shop: parentScope.shop || {},
                product: parentScope.product || {},
                localization: parentScope.localization || {
                    language: { iso_code: 'en', name: 'English', primary: true },
                    country: { iso_code: 'US', name: 'United States', currency: { iso_code: 'USD', symbol: '$' } },
                    available_languages: [],
                    available_countries: []
                },
                
                // Other common globals
                request: parentScope.request || {},
                routes: parentScope.routes || {},
                settings: parentScope.settings || {},
                cart: parentScope.cart || { item_count: 0, total_price: 0, items: [] },
                customer: parentScope.customer || null,
                collection: parentScope.collection || {},
                collections: parentScope.collections || {},
                
                // Section and template globals
                section: parentScope.section || {},
                template: parentScope.template || {},
                
                // Theme globals
                theme: parentScope.theme || {},
                canonical_url: parentScope.canonical_url || '',
                page_title: parentScope.page_title || '',
                page_description: parentScope.page_description || '',
                
                // Content globals
                blog: parentScope.blog || {},
                article: parentScope.article || {},
                page: parentScope.page || {},
                
                // Forms
                form: parentScope.form || {},
                
                // Pagination
                paginate: parentScope.paginate || {},
                
                // Search
                search: parentScope.search || {},
                
                // Apps
                app: parentScope.app || {},
            };
    
            // Order of merging: globals first, then parent scope, then block context, then explicit render params
            // This ensures globals are always available but can be overridden by more specific contexts
            const renderCtx = { 
                ...globalVariables,      // Ensure globals are always present
                ...parentScope,          // Parent context (may override some globals)
                ...blockContext,         // Block-specific context (if any)
                ...localContextFromParams // Explicit render parameters (highest priority)
            };
    
            try {
                const html = await this.liquid.renderFile(filePath, renderCtx);
                return html;
            } catch (err) {
                if (err.name === 'RenderError' && err.originalError && err.originalError.code === 'ENOENT') {
                     throw new Error(`[Custom Render] Failed to render snippet. File not found: "${filePath}". (Searched in: ${this.liquid.options.root.join(', ')}) Original error: ${err.message}`);
                }
                console.error(`[Custom Render] Error during rendering ${filePath}:`, err);
                throw err;
            }
        }
    });
    
    engine.registerFilter('json', (input) => {
        try {
            return JSON.stringify(input);
        } catch (error) {
            return '{}'; // Return empty JSON if serialization fails
        }
    });

    // Register Shopify-style filters
    engine.registerFilter('upcase', str => String(str).toUpperCase())
    engine.registerFilter('downcase', str => String(str).toLowerCase())
    engine.registerFilter('capitalize', str => String(str).charAt(0).toUpperCase() + String(str).slice(1))
    engine.registerFilter('strip', str => String(str).trim())
    engine.registerFilter('lstrip', str => String(str).replace(/^\s+/, ''))
    engine.registerFilter('rstrip', str => String(str).replace(/\s+$/, ''))
    engine.registerFilter('strip_html', str => String(str).replace(/<[^>]*>/g, ''))

    engine.registerFilter('replace', (str, pattern, replacement) => String(str).replaceAll(pattern, replacement))
    engine.registerFilter('replace_first', (str, pattern, replacement) => String(str).replace(pattern, replacement))

    engine.registerFilter('split', (str, delimiter) => String(str).split(delimiter))
    engine.registerFilter('join', (arr, separator) => Array.isArray(arr) ? arr.join(separator) : arr)

    engine.registerFilter('size', val => Array.isArray(val) || typeof val === 'string' ? val.length : 0)
    engine.registerFilter('first', arr => Array.isArray(arr) ? arr[0] : null)
    engine.registerFilter('last', arr => Array.isArray(arr) ? arr[arr.length - 1] : null)

    engine.registerFilter('json', input => JSON.stringify(input))

    engine.registerFilter('money', (value) => {
        const amount = parseFloat(value as string);
        if (isNaN(amount)) return '$0.00';
        return `$${(amount / 100).toFixed(2)}`;
    });

    engine.registerFilter('default', (value, defaultVal) => {
        return value === null || value === undefined || value === '' ? defaultVal : value
    })

    engine.registerFilter('date', (input, format) => {
        // You can customize the formatting here
        const date = new Date(input)
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: '2-digit'
        })
    })

    // Math filters
    engine.registerFilter('plus', (a, b) => a + b)
    engine.registerFilter('minus', (a, b) => a - b)
    engine.registerFilter('times', (a, b) => a * b)
    engine.registerFilter('divided_by', (a, b) => b !== 0 ? a / b : 0)
    engine.registerFilter('modulo', (a, b) => a % b)
    engine.registerFilter('round', (n, decimals = 0) => Number(n.toFixed(decimals)))
    engine.registerFilter('ceil', n => Math.ceil(n))
    engine.registerFilter('floor', n => Math.floor(n))

    // Escape filters
    engine.registerFilter('escape', str => encodeURIComponent(str))
    engine.registerFilter('escape_once', str => str.replace(/&amp;/g, '&').replace(/&/g, '&amp;'))

    // Sorting, filtering etc. (stubs – implement as needed)
    engine.registerFilter('sort', arr => Array.isArray(arr) ? [...arr].sort() : arr)
    engine.registerFilter('uniq', arr => Array.isArray(arr) ? [...new Set(arr)] : arr)
    engine.registerFilter('reverse', arr => Array.isArray(arr) ? [...arr].reverse() : arr)


    // Return the configured engine
    return engine;
} 