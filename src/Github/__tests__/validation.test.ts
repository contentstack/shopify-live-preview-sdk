import { RepositoryInputError, normalizeThemeRoot, validateRepositoryInput } from '../validation';

const valid = { auth: 'ghp_abc123', owner: 'acme', repo: 'theme' };

describe('validateRepositoryInput', () => {
  it('accepts ordinary values and returns them normalised', () => {
    expect(
      validateRepositoryInput({ ...valid, branch: 'release/2026', themeRoot: '/apps/theme/' })
    ).toEqual({
      auth: 'ghp_abc123',
      owner: 'acme',
      repo: 'theme',
      branch: 'release/2026',
      themeRoot: 'apps/theme',
    });
  });

  it('treats a missing or empty branch and theme folder as "none"', () => {
    expect(validateRepositoryInput({ ...valid })).toMatchObject({
      branch: undefined,
      themeRoot: '',
    });
    expect(validateRepositoryInput({ ...valid, branch: '', themeRoot: '' })).toMatchObject({
      branch: undefined,
      themeRoot: '',
    });
    expect(validateRepositoryInput({ ...valid, branch: null, themeRoot: null })).toMatchObject({
      branch: undefined,
      themeRoot: '',
    });
  });

  it.each([['github_pat_11ABC_xyz'], ['ghs_16C7e42F292c6912E7710c838347Ae178B4a'], ['a-b.c_d']])(
    'accepts the token %s',
    (auth) => {
      expect(() => validateRepositoryInput({ ...valid, auth })).not.toThrow();
    }
  );

  it.each([
    ['x@evil.com/'],
    ['tok en'],
    ['tok;id'],
    ['tok\nen'],
    ['$(id)'],
    [''],
    ['a'.repeat(256)],
    [undefined],
    [42],
  ])('refuses the token %j', (auth) => {
    expect(() => validateRepositoryInput({ ...valid, auth })).toThrow(RepositoryInputError);
  });

  it.each([['acme'], ['my-org'], ['a'], ['0day'], ['a'.repeat(39)]])(
    'accepts the owner %s',
    (owner) => {
      expect(() => validateRepositoryInput({ ...valid, owner })).not.toThrow();
    }
  );

  it.each([
    ['-acme'],
    ['acme/evil'],
    ['acme;id'],
    ['acme evil'],
    ['$(id)'],
    ['a'.repeat(40)],
    [''],
    [undefined],
  ])('refuses the owner %j', (owner) => {
    expect(() => validateRepositoryInput({ ...valid, owner })).toThrow('Invalid repository owner');
  });

  it.each([['theme'], ['my.theme_v2-final'], ['.github'], ['repo.git']])(
    'accepts the repository %s',
    (repo) => {
      expect(() => validateRepositoryInput({ ...valid, repo })).not.toThrow();
    }
  );

  it.each([
    ['.'],
    ['..'],
    ['theme/extra'],
    ['theme;id'],
    ['th eme'],
    ['`id`'],
    ['a'.repeat(101)],
    [''],
  ])('refuses the repository %j', (repo) => {
    expect(() => validateRepositoryInput({ ...valid, repo })).toThrow('Invalid repository name');
  });

  it.each([['main'], ['release/2026.1'], ['feature/new_thing-v2'], ['v1.0.0']])(
    'accepts the branch %s',
    (branch) => {
      expect(validateRepositoryInput({ ...valid, branch }).branch).toBe(branch);
    }
  );

  it.each([
    ['main; touch /tmp/pwned'],
    ['main && id'],
    ['$(id)'],
    ['`id`'],
    ['main|cat /etc/passwd'],
    ['-c'],
    ['--upload-pack=evil'],
    ['../main'],
    ['a/../b'],
    ['a//b'],
    ['/main'],
    ['main/'],
    ['x.lock'],
    ['main\nmain'],
    ['main branch'],
    ['a'.repeat(256)],
    [42],
  ])('refuses the branch %j', (branch) => {
    expect(() => validateRepositoryInput({ ...valid, branch })).toThrow('Invalid branch name');
  });

  it('does not put the token in any error message', () => {
    for (const bad of [{ owner: ';' }, { repo: ';' }, { branch: ';' }, { themeRoot: '..' }]) {
      try {
        validateRepositoryInput({ ...valid, auth: 'ghp_SECRETSECRET', ...bad });
        throw new Error('expected a RepositoryInputError');
      } catch (error) {
        expect(error).toBeInstanceOf(RepositoryInputError);
        expect((error as Error).message).not.toContain('SECRET');
      }
    }
  });
});

describe('normalizeThemeRoot', () => {
  it.each([
    [undefined, ''],
    [null, ''],
    ['', ''],
    ['   ', ''],
    ['.', ''],
    ['/', ''],
    ['apps/theme', 'apps/theme'],
    ['/apps/theme/', 'apps/theme'],
    ['./apps//theme/.', 'apps/theme'],
    ['apps\\storefront\\theme', 'apps/storefront/theme'],
    ['packages/my theme (v2)', 'packages/my theme (v2)'],
  ])('turns %j into %j', (input, expected) => {
    expect(normalizeThemeRoot(input)).toBe(expected);
  });

  it.each([
    ['..'],
    ['../outside'],
    ['apps/../../outside'],
    ['..\\outside'],
    ['.git'],
    ['apps/.GIT/hooks'],
    ['-rf'],
    ['apps/--output=x'],
    ['C:/Windows'],
    ['apps/*'],
    ['apps/th?me'],
    ['apps/[a]'],
    ['!apps'],
    ['apps/theme\u0000.txt'],
    ['apps/theme\nx'],
    ['a'.repeat(256)],
    [Array(25).fill('a').join('/')],
    [42],
    [{ path: 'x' }],
  ])('refuses %j', (input) => {
    expect(() => normalizeThemeRoot(input)).toThrow(RepositoryInputError);
  });
});
