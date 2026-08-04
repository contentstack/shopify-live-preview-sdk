import fs from 'fs';
import os from 'os';
import path from 'path';
// Jest runs in ESM mode here, where `jest` is not a global
import { jest } from '@jest/globals';
import { Liquid } from 'liquidjs';
import { setupLiquidEngine, LiquidEngineOptions } from '../index';

// The template from VP-2241 verbatim — the 500 a customer hit in production.
const VP_2241_CUSTOMER_TEMPLATE = `{% doc %}
 Renders the selected Caleres home page body.
 @example
 {% content_for 'block', type: 'caleres-home-page-body', id: 'caleres-home-page-body' %}
{% enddoc %}`;

// A JS body whose text merely looks like Liquid. Raw capture must hand it back untouched — joining
// the captured tokens with a newline splits the string literal and the browser drops the block.
const JS_BODY_WITH_LIQUID_TEXT = `el.innerHTML = '<b>{{ price }}</b>';`;

// Three ways the unbounded `\d+` capture yields a page size no theme can use. Only the last one is
// non-finite, so a finite-only check would let the first two through to `paginate.page_size`.
const OUT_OF_RANGE_PAGE_SIZE_LITERALS: [string, string][] = [
  ['past exact integer range', '9'.repeat(17)],   // -> 100000000000000000, not the number written
  ['stringified exponentially', '9'.repeat(22)],  // -> "1e+22"
  ['overflowed to Infinity', '9'.repeat(400)],
];

describe('Liquid Module', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let liquidEngine: Liquid;

  beforeEach(() => {
    liquidEngine = new Liquid();
  });

  describe('Engine Setup', () => {
    it('should set up Liquid engine with default options', () => {
      const engine = setupLiquidEngine();
      expect(engine).toBeInstanceOf(Liquid);
      expect(engine.options.extname).toBe('.liquid');
      expect(engine.options.dynamicPartials).toBe(true);
    });

    it('should set up Liquid engine with custom options', () => {
      const customOptions = {
        extname: '.liquid',
        dynamicPartials: true,
        root: ['./templates']
      };

      const engine = setupLiquidEngine(customOptions);
      expect(engine).toBeInstanceOf(Liquid);
      expect(engine.options.extname).toBe('.liquid');
      expect(engine.options.dynamicPartials).toBe(true);
      expect(engine.options.root).toEqual(['./templates']);
    });

    it('should merge default options with custom options', () => {
      const customOptions: LiquidEngineOptions = {
        extname: '.html',
        strictFilters: true
      };

      const engine = setupLiquidEngine(customOptions);
      const engineOptions = engine.options;

      // Custom options should override defaults
      expect(engineOptions.extname).toBe('.html');
      expect(engineOptions.strictFilters).toBe(true);

      // Default options should be preserved when not overridden
      expect(engineOptions.dynamicPartials).toBe(true);
      expect(engineOptions.trimTagRight).toBe(false);
      expect(engineOptions.trimTagLeft).toBe(false);
    });

    it('should handle root path configuration', () => {
      const customOptions: LiquidEngineOptions = {
        root: './custom-templates'
      };

      const engine = setupLiquidEngine(customOptions);
      const engineOptions = engine.options;

      expect(engineOptions.root).toEqual(['./custom-templates']);
    });
  });

  describe('Custom Filters', () => {
    let engine: Liquid;

    beforeEach(() => {
      engine = setupLiquidEngine();
    });

    it('should have money filter', () => {
      expect(engine.filters.money).toBeDefined();
    });

    it('should format money values correctly', async () => {
      const result = await engine.parseAndRender('{{ price | money }}', { price: 1000 });
      expect(result).toBe('$10.00');
    });

    it('should handle invalid money values', async () => {
      const result = await engine.parseAndRender('{{ price | money }}', { price: 'invalid' });
      expect(result).toBe('$0.00');
    });
  });

  describe('Custom Tags', () => {
    let engine: Liquid;

    beforeEach(() => {
      engine = setupLiquidEngine();
    });

    it('should have form tag', () => {
      expect(engine.tags.form).toBeDefined();
    });

    it('should render form tag correctly', async () => {
      const template = '{% form "product", product %}{% endform %}';
      const result = await engine.parseAndRender(template, { product: { id: 123 } });
      expect(result).toContain('<form');
      expect(result).toContain('</form>');
    });

    it('should handle missing product data', async () => {
      const template = '{% form "product", product %}{% endform %}';
      const result = await engine.parseAndRender(template, {});
      expect(result).toContain('<form');
      expect(result).toContain('</form>');
    });

    describe('doc tag', () => {
      it('should render nothing for a doc block', async () => {
        const result = await engine.parseAndRender('{% doc %}anything{% enddoc %}');
        expect(result).toBe('');
      });

      it('should render the VP-2241 customer template without throwing', async () => {
        const result = await engine.parseAndRender(VP_2241_CUSTOMER_TEMPLATE);
        expect(result).toBe('');
      });

      it('should reject an unclosed doc block', async () => {
        await expect(engine.parseAndRender('{% doc %}no closer here')).rejects.toThrow('not closed');
      });
    });

    describe('javascript tag', () => {
      it('should wrap block content in a script tag', async () => {
        const result = await engine.parseAndRender('{% javascript %}var a=1;{% endjavascript %}');
        expect(result).toBe('<script>var a=1;</script>');
      });

      it('should render an empty block as an empty script tag', async () => {
        const result = await engine.parseAndRender('{% javascript %}{% endjavascript %}');
        expect(result).toBe('<script></script>');
      });

      // Full equality, not toContain — injected newlines survive a substring assertion.
      it('should reproduce a body containing output tokens byte for byte', async () => {
        const result = await engine.parseAndRender(
          `{% javascript %}${JS_BODY_WITH_LIQUID_TEXT}{% endjavascript %}`
        );
        expect(result).toBe(`<script>${JS_BODY_WITH_LIQUID_TEXT}</script>`);
      });

      it('should reproduce a body containing a whole Liquid tag byte for byte', async () => {
        const jsBody = 'var t = "{% if a %}x{% endif %}";';
        const result = await engine.parseAndRender(`{% javascript %}${jsBody}{% endjavascript %}`);
        expect(result).toBe(`<script>${jsBody}</script>`);
      });
    });

    describe('stylesheet tag', () => {
      it('should wrap block content in a style tag', async () => {
        const result = await engine.parseAndRender('{% stylesheet %}.a{}{% endstylesheet %}');
        expect(result).toBe('<style>.a{}</style>');
      });

      it('should reproduce a body containing output tokens byte for byte', async () => {
        const cssBody = '.a{ color: {{ settings.c }}; }';
        const result = await engine.parseAndRender(`{% stylesheet %}${cssBody}{% endstylesheet %}`);
        expect(result).toBe(`<style>${cssBody}</style>`);
      });
    });

    describe('content_for tag', () => {
      it('should render a placeholder comment regardless of arguments', async () => {
        const result = await engine.parseAndRender("{% content_for 'block', type: 'x', id: 'y' %}");
        expect(result).toBe('<!-- theme block content omitted in preview -->');
      });
    });

    describe('section tag', () => {
      let sectionsRoot: string;

      beforeAll(() => {
        sectionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-2241-sections-'));
        fs.mkdirSync(path.join(sectionsRoot, 'sections'));
        fs.writeFileSync(path.join(sectionsRoot, 'sections', 'header.liquid'), '<h1>{{ shop.name }}</h1>');
        fs.writeFileSync(
          path.join(sectionsRoot, 'sections', 'inner.liquid'),
          'id=[{{ section.id }}] set=[{{ section.settings.title }}] blocks=[{{ section.blocks.size }}] shop=[{{ shop.name }}]'
        );
        fs.writeFileSync(path.join(sectionsRoot, 'sections', 'unclosed.liquid'), '{% if true %}never closed');
        fs.writeFileSync(path.join(sectionsRoot, 'sections', 'badrender.liquid'), "{% render 'nope-not-here' %}");
      });

      afterAll(() => {
        fs.rmSync(sectionsRoot, { recursive: true, force: true });
      });

      // Resolve sections from the temp root instead of the packaged views directory
      beforeEach(() => {
        engine = setupLiquidEngine({ root: sectionsRoot });
      });

      it('should render a section file from the configured root', async () => {
        const result = await engine.parseAndRender("{% section 'header' %}", { shop: { name: 'Caleres' } });
        expect(result).toBe('<h1>Caleres</h1>');
      });

      it('should render a comment when the section file is missing', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        const result = await engine.parseAndRender("{% section 'missing' %}");

        expect(result).toBe("<!-- section 'missing' not found in preview -->");
        // The exact prefix, not just "was called": it is what separates this branch from the
        // failed-to-render one below, so a loose assertion would not notice them swapping.
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Section 'missing' not found:",
          expect.stringContaining('ENOENT')
        );
        consoleErrorSpy.mockRestore();
      });

      it('should reject a traversal section name without reading a file or echoing the name', async () => {
        const result = await engine.parseAndRender("{% section '../../etc/passwd' %}");
        expect(result).toBe('<!-- section not found in preview -->');
      });

      it('should give the section its own section object while passing other globals through', async () => {
        const result = await engine.parseAndRender("{% section 'inner' %}", {
          shop: { name: 'Caleres' },
          section: { id: 'PARENT', settings: { title: 'PARENT-TITLE' } },
        });

        expect(result).toBe('id=[inner] set=[] blocks=[0] shop=[Caleres]');
      });

      // A section that exists but throws must not be reported as an absent file — that is what hid
      // the real error before, and a parse error is used here so the case does not depend on the
      // custom render tag's behaviour.
      it('should distinguish a section that fails to render from one that is missing', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        const result = await engine.parseAndRender("{% section 'unclosed' %}");

        expect(result).toBe("<!-- section 'unclosed' failed to render in preview -->");
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Error rendering section 'unclosed':",
          expect.stringContaining('not closed')
        );
        consoleErrorSpy.mockRestore();
      });

      // Regression test for the discriminator's shape: this error carries ENOENT on originalError,
      // so classifying on originalError would call a present-but-broken section "not found".
      it('should report a section whose inner render target is missing as a render failure', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        const result = await engine.parseAndRender("{% section 'badrender' %}");

        expect(result).toBe("<!-- section 'badrender' failed to render in preview -->");
        expect(consoleErrorSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
      });

      it('should survive a rejection that is not an Error object', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const renderFileSpy = jest.spyOn(engine, 'renderFile').mockRejectedValue('boom');

        const result = await engine.parseAndRender("{% section 'header' %}");

        expect(result).toBe("<!-- section 'header' failed to render in preview -->");
        expect(consoleErrorSpy).toHaveBeenCalledWith("Error rendering section 'header':", undefined);
        renderFileSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      });
    });

    describe('sections tag', () => {
      it('should render a placeholder comment for a section group', async () => {
        const result = await engine.parseAndRender("{% sections 'footer-group' %}");
        expect(result).toBe("<!-- section group 'footer-group' omitted in preview -->");
      });

      it('should not echo an invalid group name into the placeholder comment', async () => {
        const result = await engine.parseAndRender("{% sections '--><script>bad</script>' %}");
        expect(result).toBe('<!-- section group omitted in preview -->');
      });
    });

    describe('paginate tag', () => {
      it('should render inner content once with the requested page size', async () => {
        const template = '{% paginate collection.products by 12 %}{{ paginate.page_size }}{% endpaginate %}';
        const result = await engine.parseAndRender(template, { collection: { products: [] } });
        expect(result).toBe('12');
      });

      it.each(['by 0', 'by -5', 'by abc', ''])(
        'should fall back to the default page size for "%s"',
        async (pageSizeArgs) => {
          const template = `{% paginate collection.products ${pageSizeArgs} %}{{ paginate.page_size }}{% endpaginate %}`;
          const result = await engine.parseAndRender(template);
          expect(result).toBe('50');
        }
      );

      it.each(OUT_OF_RANGE_PAGE_SIZE_LITERALS)(
        'should fall back to the default page size for a literal %s',
        async (_label, pageSizeLiteral) => {
          const template = `{% paginate collection.products by ${pageSizeLiteral} %}{{ paginate.page_size }}{% endpaginate %}`;
          const result = await engine.parseAndRender(template);
          expect(result).toBe('50');
        }
      );

      it('should reject an unclosed paginate block', async () => {
        await expect(engine.parseAndRender('{% paginate collection.products by 12 %}no closer'))
          .rejects.toThrow('not closed');
      });
    });

    // A matched block consumes its own closer while parsing, so these registrations only ever see a
    // stray unmatched closer — which they swallow instead of failing the page with a parse error.
    describe('stray block closers', () => {
      it.each(['enddoc', 'endjavascript', 'endstylesheet', 'endpaginate'])(
        'should render an unmatched {%% %s %%} as empty output',
        async (closerTagName) => {
          const result = await engine.parseAndRender(`A{% ${closerTagName} %}B`);
          expect(result).toBe('AB');
        }
      );
    });
  });
}); 