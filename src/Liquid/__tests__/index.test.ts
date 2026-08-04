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

// ---------------------------------------------------------------------------
// Everything below is appended as separate top-level blocks on purpose: the
// VP-2241 branch adds theme-tag tests inside the describes above, so keeping
// these out of the way avoids a merge conflict. Deliberately excluded here:
// the seven VP-2241 theme tags, which that branch owns.
// ---------------------------------------------------------------------------

// Resolved from import.meta.url rather than a top-of-file `path` import so this
// addition touches no existing line in the file.
const fixturesDir = new URL('./fixtures', import.meta.url).pathname;

describe('render tag', () => {
  let engine: Liquid;

  beforeEach(() => {
    engine = setupLiquidEngine({ root: [fixturesDir] });
  });

  it('renders a quoted snippet name', async () => {
    const result = await engine.parseAndRender("{% render 'simple' %}", {});
    expect(result).toContain('simple snippet');
  });

  it('parses quoted-string, integer, float and boolean params', async () => {
    const template =
      "{% render 'with-params', label: 'Hello', count: 3, flag: true, ratio: 1.5 %}";
    const result = await engine.parseAndRender(template, {});
    expect(result).toContain('Hello|3|true|1.5');
  });

  it('parses a false boolean param', async () => {
    const result = await engine.parseAndRender(
      "{% render 'with-params', label: 'x', flag: false %}",
      {}
    );
    expect(result).toContain('x||false|');
  });

  it('resolves a param given as a dotted variable path', async () => {
    const result = await engine.parseAndRender("{% render 'with-params', label: product.title %}", {
      product: { title: 'From context' },
    });
    expect(result).toContain('From context');
  });

  it('yields an empty param when the variable path does not resolve', async () => {
    const result = await engine.parseAndRender("{% render 'with-params', label: missing.deep %}", {});
    expect(result).toContain('<p>|||</p>');
  });

  it('tolerates a leading comma between the filename and params', async () => {
    const result = await engine.parseAndRender("{% render 'with-params', label: 'Comma' %}", {});
    expect(result).toContain('Comma');
  });

  it('injects Shopify globals that the parent scope does not provide', async () => {
    const result = await engine.parseAndRender("{% render 'uses-globals' %}", {});
    // localization/cart defaults come from the tag's globalVariables block
    expect(result).toContain('$-0');
  });

  it('lets the parent scope override an injected global', async () => {
    const result = await engine.parseAndRender("{% render 'uses-globals' %}", {
      cart: { item_count: 7 },
    });
    expect(result).toContain('-7');
  });

  it('rejects when the snippet file does not exist', async () => {
    await expect(engine.parseAndRender("{% render 'no-such-snippet' %}", {})).rejects.toThrow();
  });

  it('rejects invalid render arguments at parse time', async () => {
    await expect(engine.parseAndRender('{% render %}', {})).rejects.toThrow();
  });

  // The unquoted-identifier branch is currently unreachable. Liquid/index.ts:309 calls
  // `ctx.get(this.fileExpression)` with a STRING, but liquidjs 10's Context.get expects a
  // path ARRAY — get('block') resolves to undefined while get(['block']) returns the
  // value. So every identifier form throws "Could not resolve filename", including the
  // standard Shopify `{% render block %}`. Pinned below as current behaviour, with
  // it.failing cases for the intended behaviour.
  describe('unquoted identifier form (broken — see note above)', () => {
    it.each([
      ['a string variable', '{% render snippet_name %}', { snippet_name: 'simple' }],
      ['a block with a type', '{% render block %}', { block: { type: 'card' } }],
      ['an @app block', '{% render block %}', { block: { type: '@app' } }],
      ['a block with no type', '{% render block %}', { block: { name: 'no type' } }],
    ])('fails to resolve %s', async (_name, template, ctx) => {
      await expect(engine.parseAndRender(template, ctx)).rejects.toThrow(
        /Could not resolve filename/
      );
    });

    it('rejects an identifier that resolves to a non-string, non-block value', async () => {
      await expect(
        engine.parseAndRender('{% render thing %}', { thing: { a: 1 } })
      ).rejects.toThrow(/Could not resolve filename/);
    });

    it.failing('should render the snippet named by a string variable', async () => {
      const result = await engine.parseAndRender('{% render snippet_name %}', {
        snippet_name: 'simple',
      });
      expect(result).toContain('simple snippet');
    });

    it.failing('should render a block using its type as the snippet name', async () => {
      const result = await engine.parseAndRender('{% render block %}', {
        block: { type: 'card' },
      });
      expect(result).toContain('card:card');
    });

    it.failing('should map an @app block type to the app-block snippet', async () => {
      const result = await engine.parseAndRender('{% render block %}', {
        block: { type: '@app' },
      });
      expect(result).toContain('app block');
    });

    it.failing('should report a missing block.type distinctly', async () => {
      await expect(
        engine.parseAndRender('{% render block %}', { block: { name: 'no type' } })
      ).rejects.toThrow(/block\.type/);
    });
  });
});

describe('style and schema tags', () => {
  let engine: Liquid;

  beforeEach(() => {
    engine = setupLiquidEngine();
  });

  it('wraps style block content in a style element', async () => {
    const result = await engine.parseAndRender('{% style %}.a{color:red}{% endstyle %}', {});
    expect(result).toContain('<style>');
    expect(result).toContain('</style>');
  });

  it('emits valid schema json as an application/json script', async () => {
    const result = await engine.parseAndRender(
      '{% schema %}{"name":"Section"}{% endschema %}',
      {}
    );
    expect(result).toContain('<script type="application/json">');
    expect(result).toContain('"name":"Section"');
  });

  it('emits an error script when the schema json is invalid', async () => {
    const result = await engine.parseAndRender('{% schema %}{not json}{% endschema %}', {});
    expect(result).toContain('Error: Invalid schema');
  });
});

describe('live filters', () => {
  let engine: Liquid;

  beforeEach(() => {
    engine = setupLiquidEngine();
  });

  const render = (template: string, ctx: Record<string, unknown> = {}) =>
    engine.parseAndRender(template, ctx);

  describe('string filters', () => {
    it.each([
      ['upcase', "{{ 'abC' | upcase }}", 'ABC'],
      ['downcase', "{{ 'AbC' | downcase }}", 'abc'],
      ['capitalize', "{{ 'hello world' | capitalize }}", 'Hello world'],
      ['strip', "{{ '  x  ' | strip }}", 'x'],
      ['lstrip', "{{ '  x' | lstrip }}", 'x'],
      ['rstrip', "{{ 'x  ' | rstrip }}|", 'x|'],
      ['strip_html', "{{ '<b>bold</b>' | strip_html }}", 'bold'],
      ['replace', "{{ 'a-b-a' | replace: 'a', 'z' }}", 'z-b-z'],
      ['replace_first', "{{ 'a-b-a' | replace_first: 'a', 'z' }}", 'z-b-a'],
    ])('%s', async (_name, template, expected) => {
      await expect(render(template)).resolves.toBe(expected);
    });

    // These coerce with String(), so a missing variable becomes the literal "undefined".
    it.each([
      ['upcase', '{{ missing | upcase }}', 'UNDEFINED'],
      ['downcase', '{{ missing | downcase }}', 'undefined'],
      ['strip_html', '{{ missing | strip_html }}', 'undefined'],
    ])('%s coerces a missing value rather than returning empty', async (_n, template, expected) => {
      await expect(render(template)).resolves.toBe(expected);
    });
  });

  describe('array filters', () => {
    it.each([
      ['split then join', "{{ 'a,b,c' | split: ',' | join: '-' }}", 'a-b-c'],
      ['size of array', '{{ list | size }}', '3'],
      ['size of string', "{{ 'abcd' | size }}", '4'],
      ['size of non-collection', '{{ 5 | size }}', '0'],
      ['size of missing', '{{ missing | size }}', '0'],
      ['first', '{{ list | first }}', 'c'],
      ['last', '{{ list | last }}', 'b'],
      ['first of non-array', '{{ 5 | first }}', ''],
      ['last of non-array', '{{ 5 | last }}', ''],
      ['sort', "{{ list | sort | join: ',' }}", 'a,b,c'],
      ['reverse', "{{ list | reverse | join: ',' }}", 'b,a,c'],
      ['uniq', "{{ dupes | uniq | join: ',' }}", 'a,b'],
      ['join of non-array', "{{ 5 | join: ',' }}", '5'],
    ])('%s', async (_name, template, expected) => {
      await expect(render(template, { list: ['c', 'a', 'b'], dupes: ['a', 'b', 'a'] })).resolves.toBe(
        expected
      );
    });
  });

  describe('math filters', () => {
    it.each([
      ['plus', '{{ 5 | plus: 3 }}', '8'],
      ['minus', '{{ 5 | minus: 3 }}', '2'],
      ['times', '{{ 5 | times: 3 }}', '15'],
      ['divided_by', '{{ 6 | divided_by: 3 }}', '2'],
      ['divided_by zero returns zero', '{{ 6 | divided_by: 0 }}', '0'],
      ['modulo', '{{ 7 | modulo: 3 }}', '1'],
      ['round to decimals', '{{ 2.567 | round: 2 }}', '2.57'],
      ['round to integer', '{{ 2.567 | round }}', '3'],
      ['ceil', '{{ 2.1 | ceil }}', '3'],
      ['floor', '{{ 2.9 | floor }}', '2'],
    ])('%s', async (_name, template, expected) => {
      await expect(render(template)).resolves.toBe(expected);
    });
  });

  describe('money filter', () => {
    it.each([
      ['whole amount', '{{ 1000 | money }}', '$10.00'],
      ['zero', '{{ 0 | money }}', '$0.00'],
      ['sub-cent rounding', '{{ 1 | money }}', '$0.01'],
      ['negative amount is not rejected', '{{ -500 | money }}', '$-5.00'],
      ['oversized amount has no upper clamp', '{{ 999999999999 | money }}', '$9999999999.99'],
      ['non-numeric string', "{{ 'invalid' | money }}", '$0.00'],
      ['missing value', '{{ missing | money }}', '$0.00'],
    ])('%s', async (_name, template, expected) => {
      await expect(render(template)).resolves.toBe(expected);
    });

    it('treats a wrong-type-but-truthy object as zero', async () => {
      await expect(render('{{ obj | money }}', { obj: { a: 1 } })).resolves.toBe('$0.00');
    });
  });

  describe('default filter', () => {
    it.each([
      ['empty string', "{{ '' | default: 'fallback' }}", 'fallback'],
      ['missing value', "{{ missing | default: 'fallback' }}", 'fallback'],
      ['present value wins', "{{ 'given' | default: 'fallback' }}", 'given'],
      ['zero is kept', "{{ 0 | default: 'fallback' }}", '0'],
      ['false is kept', "{{ false | default: 'fallback' }}", 'false'],
    ])('%s', async (_name, template, expected) => {
      await expect(render(template)).resolves.toBe(expected);
    });
  });

  describe('asset and image filters', () => {
    it('asset_url prefixes the assets path', async () => {
      await expect(render("{{ 'logo.png' | asset_url }}")).resolves.toBe('/assets/logo.png');
    });

    it('placeholder_svg_tag emits an svg carrying the class', async () => {
      const result = await render("{{ 'x' | placeholder_svg_tag: 'ph' }}");
      expect(result).toContain('<svg class="ph"');
    });

    it.each([
      ['a missing image', '{{ missing | image_url }}', '/placeholder-image.jpg'],
      ['a string image', "{{ 'https://cdn/a.png' | image_url }}", 'https://cdn/a.png'],
    ])('image_url handles %s', async (_name, template, expected) => {
      await expect(render(template)).resolves.toBe(expected);
    });

    it.each([
      ['url property', { url: 'https://cdn/u.png' }, 'https://cdn/u.png'],
      ['src property', { src: 'https://cdn/s.png' }, 'https://cdn/s.png'],
      ['neither property', { alt: 'nope' }, '/placeholder-image.jpg'],
    ])('image_url reads an image object by %s', async (_name, image, expected) => {
      await expect(render('{{ image | image_url }}', { image })).resolves.toBe(expected);
    });

    it('image_url appends width with ? when the url has no query', async () => {
      await expect(
        render('{{ image | image_url: opts }}', {
          image: 'https://cdn/a.png',
          opts: { width: 200 },
        })
      ).resolves.toBe('https://cdn/a.png?width=200');
    });

    it('image_url appends width with & when the url already has a query', async () => {
      await expect(
        render('{{ image | image_url: opts }}', {
          image: 'https://cdn/a.png?v=1',
          opts: { width: 200 },
        })
      ).resolves.toBe('https://cdn/a.png?v=1&width=200');
    });

    it('safe_preview_image returns square defaults for a missing media object', async () => {
      const result = await render('{{ missing | safe_preview_image | json }}');
      expect(JSON.parse(result)).toEqual({ width: 1100, height: 1100, aspect_ratio: 1.0 });
    });

    it('safe_preview_image derives a preview from media without one', async () => {
      const result = await render('{{ media | safe_preview_image | json }}', {
        media: { width: 50, height: 60, alt: 'a', src: 'https://cdn/s.png' },
      });
      expect(JSON.parse(result)).toEqual({
        width: 50,
        height: 60,
        aspect_ratio: 1.0,
        alt: 'a',
        url: 'https://cdn/s.png',
      });
    });

    it('safe_preview_image passes an existing preview_image through', async () => {
      const result = await render('{{ media | safe_preview_image | json }}', {
        media: { preview_image: { width: 10, height: 20 } },
      });
      expect(JSON.parse(result)).toEqual({ width: 10, height: 20 });
    });
  });

  describe('json filter', () => {
    it('serializes an object', async () => {
      await expect(render('{{ obj | json }}', { obj: { a: 1 } })).resolves.toBe('{"a":1}');
    });

    it('serializes an array', async () => {
      await expect(render('{{ list | json }}', { list: [1, 2] })).resolves.toBe('[1,2]');
    });
  });

  describe('escape filters', () => {
    // Documented, not endorsed: `escape` is URL-encoding, not HTML-escaping. See the
    // it.failing repro below for the Shopify-parity behaviour.
    it('escape percent-encodes rather than html-escapes', async () => {
      await expect(render("{{ '<b>&</b>' | escape }}")).resolves.toBe('%3Cb%3E%26%3C%2Fb%3E');
    });

    it('escape_once normalises an already-escaped ampersand', async () => {
      await expect(render("{{ '&amp;x' | escape_once }}")).resolves.toBe('&amp;x');
    });

    it('escape_once escapes a bare ampersand', async () => {
      await expect(render("{{ 'a&b' | escape_once }}")).resolves.toBe('a&amp;b');
    });
  });

  describe('date filter', () => {
    // The format argument is accepted but ignored; output is always en-US medium date.
    it('ignores its format argument', async () => {
      const withFormat = await render("{{ stamp | date: '%Y' }}", {
        stamp: '2026-08-03T12:00:00.000Z',
      });
      const withoutFormat = await render('{{ stamp | date }}', {
        stamp: '2026-08-03T12:00:00.000Z',
      });

      expect(withFormat).toBe(withoutFormat);
      expect(withFormat).toMatch(/^[A-Z][a-z]{2} \d{2}, \d{4}$/);
    });
  });
});

describe('known bugs (it.failing repros — flip green when fixed)', () => {
  let engine: Liquid;

  beforeEach(() => {
    engine = setupLiquidEngine({ root: [fixturesDir] });
  });

  // VP-2450: renderTemplates is a generator, so awaiting it yields the generator object
  // instead of the rendered string, and the form body renders as "[object Generator]".
  it('reproduces VP-2450: a non-empty form body renders as [object Generator]', async () => {
    const result = await engine.parseAndRender('{% form "product" %}INNER{% endform %}', {});
    expect(result).toContain('[object Generator]');
    expect(result).not.toContain('INNER');
  });

  it.failing('form should render its inner body content (VP-2450)', async () => {
    const result = await engine.parseAndRender('{% form "product" %}INNER{% endform %}', {});
    expect(result).toContain('INNER');
  });

  it.failing('escape should html-escape for Shopify parity', async () => {
    const result = await engine.parseAndRender("{{ '<script>' | escape }}", {});
    expect(result).toBe('&lt;script&gt;');
  });

  it.failing('date should honour its format argument', async () => {
    const result = await engine.parseAndRender("{{ stamp | date: '%Y' }}", {
      stamp: '2026-08-03T12:00:00.000Z',
    });
    expect(result).toBe('2026');
  });

  // The json filter is registered twice (Liquid/index.ts:408 and :435). The second
  // registration wins, so the try/catch in the first — which would return '{}' — is dead
  // and a circular structure throws instead.
  it.failing('json should fall back to {} for a circular structure', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const result = await engine.parseAndRender('{{ obj | json }}', { obj: circular });
    expect(result).toBe('{}');
  });
});
