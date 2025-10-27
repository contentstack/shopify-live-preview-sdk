import { Liquid } from 'liquidjs';
import { setupLiquidEngine, LiquidEngineOptions } from '../index';

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
  });
}); 