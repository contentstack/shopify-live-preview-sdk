import { jest } from '@jest/globals';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as tar from 'tar';
import {
  cloneRepository,
  createGitRunner,
  extractTarball,
  runGit,
  RepositoryInputError,
} from '../index';
import type { CloneConfig, CloneDependencies } from '../index';

// These run the real git against a repository on disk, with only the remote URL pointed at it instead of github.com, so
// the whole flow (clone, sparse checkout, copy, scrubbing, errors) is exercised rather than mocked.

const TOKEN = 'ghp_SECRETTOKEN123';
const base = { auth: TOKEN, owner: 'acme', repo: 'storefront' };

let work: string;
let remote: string; // the "GitHub" repository
let outside: string; // a file the repository must never be able to pull in
let target: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
    { cwd, stdio: 'pipe' }
  );

const write = (root: string, relative: string, content = 'x') => {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};

const listFiles = (root: string): string[] =>
  (fs.readdirSync(root, { recursive: true }) as string[])
    .filter((f) => fs.lstatSync(path.join(root, f)).isFile())
    .sort();

const calls: string[][] = [];
const recordingRunGit: CloneDependencies['runGit'] = (args, cwd, secrets) => {
  calls.push(args);
  runGit(args, cwd, secrets);
};

const local = (): CloneDependencies => ({
  runGit: recordingRunGit,
  remoteUrl: () => `file://${remote}`,
  publicUrl: () => 'https://github.com/acme/storefront.git',
  fetchArchive: async () => {
    throw new Error('the archive should not be used');
  },
});

beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clone-test-')));
  outside = path.join(work, 'server-secret.txt');
  fs.writeFileSync(outside, 'SERVER SECRET');

  remote = path.join(work, 'remote');
  fs.mkdirSync(remote);
  git(remote, 'init', '-q', '-b', 'main');
  git(remote, 'config', 'uploadpack.allowFilter', 'true');
  write(remote, 'README.md', 'monorepo');
  write(remote, 'apps/storefront/theme/layout/theme.liquid', '<html>main</html>');
  write(remote, 'apps/storefront/theme/sections/header.liquid', 'header');
  write(remote, 'apps/storefront/theme/templates/index.json', '{}');
  write(remote, 'apps/other/notes.txt', 'not part of the theme');
  write(remote, 'apps/notatheme/src/index.ts', 'code');
  fs.writeFileSync(path.join(remote, 'packages-big.bin'), Buffer.alloc(200_000, 1));
  // a link in the theme folder that points at a file outside the repository
  fs.symlinkSync(outside, path.join(remote, 'apps/storefront/theme/sections/leak.liquid'));
  // a folder that is a link to somewhere outside the repository, and looks like a theme, so that only the containment
  // check (not the "is it a theme" check) can refuse it
  write(work, 'outside-theme/layout/theme.liquid', 'OUTSIDE THEME');
  fs.symlinkSync(path.join(work, 'outside-theme'), path.join(remote, 'apps/escape'));
  git(remote, 'add', '-A');
  git(remote, 'commit', '-q', '-m', 'init');

  git(remote, 'checkout', '-q', '-b', 'release/2026');
  write(remote, 'apps/storefront/theme/layout/theme.liquid', '<html>release</html>');
  git(remote, 'commit', '-q', '-am', 'release');
  git(remote, 'checkout', '-q', 'main');
});

afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

beforeEach(() => {
  calls.length = 0;
  target = path.join(work, `views-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(target);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('cloneRepository without a theme folder (the repository is the theme)', () => {
  it('clones the whole repository into the target, as before', async () => {
    write(target, 'stale.txt', 'left over from a previous sync');

    await cloneRepository({ ...base }, target, local());

    expect(fs.existsSync(path.join(target, 'stale.txt'))).toBe(false);
    expect(
      fs.readFileSync(path.join(target, 'apps/storefront/theme/layout/theme.liquid'), 'utf8')
    ).toBe('<html>main</html>');
    expect(fs.existsSync(path.join(target, 'README.md'))).toBe(true);
  });

  it('clones the requested branch', async () => {
    await cloneRepository({ ...base, branch: 'release/2026' }, target, local());
    expect(
      fs.readFileSync(path.join(target, 'apps/storefront/theme/layout/theme.liquid'), 'utf8')
    ).toBe('<html>release</html>');
  });

  it('runs git with an argument list: the URL and the branch are single arguments, never a command string', async () => {
    await cloneRepository({ ...base, branch: 'release/2026' }, target, local());
    expect(calls[0]).toEqual([
      'clone',
      '--depth',
      '1',
      '--branch',
      'release/2026',
      `file://${remote}`,
      '.',
    ]);
  });

  it('replaces the remote URL, which contained the token, with the plain one', async () => {
    await cloneRepository({ ...base }, target, local());
    expect(calls[1]).toEqual([
      'remote',
      'set-url',
      'origin',
      'https://github.com/acme/storefront.git',
    ]);
    const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: target })
      .toString()
      .trim();
    expect(origin).toBe('https://github.com/acme/storefront.git');
    expect(fs.readFileSync(path.join(target, '.git', 'config'), 'utf8')).not.toContain(TOKEN);
  });
});

describe('cloneRepository with a theme folder', () => {
  it('puts the contents of that folder, and only that, in the target', async () => {
    write(target, 'stale.txt', 'left over');

    await cloneRepository({ ...base, themeRoot: 'apps/storefront/theme' }, target, local());

    expect(listFiles(target)).toEqual([
      'layout/theme.liquid',
      'sections/header.liquid',
      'templates/index.json',
    ]);
    expect(fs.readFileSync(path.join(target, 'layout/theme.liquid'), 'utf8')).toBe(
      '<html>main</html>'
    );
  });

  it('does not leave a .git folder, the monorepo, or temporary files behind', async () => {
    const before = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('lp-theme-'));

    await cloneRepository({ ...base, themeRoot: 'apps/storefront/theme' }, target, local());

    expect(fs.existsSync(path.join(target, '.git'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'apps'))).toBe(false);
    expect(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('lp-theme-'))).toEqual(
      before
    );
  });

  it('fetches with a no-checkout, blob-filtered clone, then a cone sparse checkout, then checkout, in that order', async () => {
    await cloneRepository(
      { ...base, branch: 'release/2026', themeRoot: 'apps/storefront/theme' },
      target,
      local()
    );

    expect(calls).toEqual([
      [
        'clone',
        '--depth',
        '1',
        '--filter=blob:none',
        '--no-checkout',
        '--branch',
        'release/2026',
        `file://${remote}`,
        '.',
      ],
      ['sparse-checkout', 'set', '--cone', 'apps/storefront/theme'],
      ['checkout'],
    ]);
  });

  it('clones the requested branch', async () => {
    await cloneRepository(
      { ...base, branch: 'release/2026', themeRoot: 'apps/storefront/theme' },
      target,
      local()
    );
    expect(fs.readFileSync(path.join(target, 'layout/theme.liquid'), 'utf8')).toBe(
      '<html>release</html>'
    );
  });

  it('does not copy a symbolic link in the theme folder, or what it points at', async () => {
    await cloneRepository({ ...base, themeRoot: 'apps/storefront/theme' }, target, local());
    expect(fs.existsSync(path.join(target, 'sections/leak.liquid'))).toBe(false);
    expect(listFiles(target).join('\n')).not.toContain('leak');
  });

  it('normalises the folder before using it', async () => {
    await cloneRepository({ ...base, themeRoot: '/apps/storefront//theme/' }, target, local());
    expect(calls[1]).toEqual(['sparse-checkout', 'set', '--cone', 'apps/storefront/theme']);
  });

  it('says so when the folder is not in the repository, and copies nothing', async () => {
    await expect(
      cloneRepository({ ...base, themeRoot: 'apps/missing' }, target, local())
    ).rejects.toThrow('The folder "apps/missing" was not found in this repository and branch');
    expect(fs.readdirSync(target)).toEqual([]);
  });

  it('refuses a folder that is not a Shopify theme', async () => {
    await expect(
      cloneRepository({ ...base, themeRoot: 'apps/notatheme' }, target, local())
    ).rejects.toThrow('does not look like a Shopify theme');
    expect(fs.readdirSync(target)).toEqual([]);
  });

  it('refuses a folder that is a symbolic link out of the repository', async () => {
    await expect(
      cloneRepository({ ...base, themeRoot: 'apps/escape' }, target, local())
    ).rejects.toThrow('must be inside the repository');
    expect(fs.readdirSync(target)).toEqual([]);
  });
});

describe('input that is refused before anything runs', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['a branch with a shell command', { branch: 'main; touch /tmp/pwned' }],
    ['a branch that looks like an option', { branch: '--upload-pack=evil' }],
    ['a repository with command substitution', { repo: '$(id)' }],
    ['an owner with a slash', { owner: 'acme/evil' }],
    ['a token that would change the host', { auth: 'x@evil.com/' }],
    ['a theme folder that leaves the repository', { themeRoot: '../outside' }],
    ['a theme folder that starts like an option', { themeRoot: '-rf' }],
  ];

  it.each(cases)('%s', async (_name, override) => {
    write(target, 'keep.txt', 'must survive');
    await expect(
      cloneRepository({ ...base, ...override } as unknown as CloneConfig, target, local())
    ).rejects.toThrow(RepositoryInputError);
    expect(calls).toEqual([]);
    // the target is not emptied for a request that is refused
    expect(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8')).toBe('must survive');
  });
});

describe('errors never contain the token', () => {
  it('redacts it from a failed git command, whatever git prints', async () => {
    const failing: CloneDependencies = {
      ...local(),
      remoteUrl: ({ auth }) => `file:///no/such/repository-${auth}`,
    };

    const error: Error = await cloneRepository({ ...base }, target, failing).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('git clone failed');
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).toContain('***');
  });

  it('redacts credentials in a URL that was not one of the known secrets', () => {
    expect(() =>
      runGit(['clone', 'https://someone:pw@127.0.0.1:1/x.git', 'x'], os.tmpdir(), [])
    ).toThrow();
    try {
      runGit(
        ['clone', 'https://someone:pw@127.0.0.1:1/x.git', path.join(work, 'redact-check')],
        os.tmpdir(),
        []
      );
    } catch (error) {
      expect((error as Error).message).not.toContain('someone:pw');
    }
  });
});

describe('a host without git', () => {
  // A gzipped tarball shaped like GitHub's: everything inside one `<owner>-<repo>-<sha>/` directory
  const archive = () => {
    const source = path.join(work, 'archive-source');
    const wrapper = 'acme-storefront-abc123';
    fs.rmSync(source, { recursive: true, force: true });
    write(source, `${wrapper}/README.md`, 'monorepo');
    write(source, `${wrapper}/apps/storefront/theme/layout/theme.liquid`, '<html>tar</html>');
    write(source, `${wrapper}/apps/storefront/theme/sections/header.liquid`, 'header');
    write(source, `${wrapper}/apps/storefront/theme-extra/layout/theme.liquid`, 'not ours');
    write(source, `${wrapper}/apps/other/notes.txt`, 'other');
    // links that must never reach the theme: one pointing out of the repository, one inside it
    fs.symlinkSync(outside, path.join(source, wrapper, 'apps/storefront/theme/leak.txt'));
    fs.symlinkSync('layout', path.join(source, wrapper, 'apps/storefront/theme/layout-alias'));

    const file = path.join(work, 'archive.tar.gz');
    tar.c({ gzip: true, file, cwd: source, sync: true }, [wrapper]);
    return fs.createReadStream(file);
  };

  const noGit = (): CloneDependencies => ({
    ...local(),
    runGit: () => {
      throw Object.assign(new Error('git clone failed'), { gitUnavailable: true });
    },
    fetchArchive: async ({ branch }) => {
      requested.push(branch);
      return archive();
    },
  });
  const requested: string[] = [];
  beforeEach(() => {
    requested.length = 0;
  });

  it('flags a missing git binary (spawn reports ENOENT)', () => {
    const missing = createGitRunner('git-that-is-not-installed');
    try {
      missing(['--version'], os.tmpdir(), []);
      throw new Error('expected the executable to be missing');
    } catch (error) {
      expect((error as { gitUnavailable?: boolean }).gitUnavailable).toBe(true);
    }
  });

  it('does not flag an ordinary git failure as a missing binary', () => {
    try {
      runGit(
        ['clone', `file://${path.join(work, 'does-not-exist')}`, path.join(work, 'x')],
        os.tmpdir(),
        []
      );
      throw new Error('expected git to fail');
    } catch (error) {
      expect((error as { gitUnavailable?: boolean }).gitUnavailable).toBe(false);
    }
  });

  it('falls back to the archive for the whole repository, as before', async () => {
    await cloneRepository({ ...base }, target, noGit());
    expect(
      fs.readFileSync(path.join(target, 'apps/storefront/theme/layout/theme.liquid'), 'utf8')
    ).toBe('<html>tar</html>');
    expect(requested).toEqual(['main']);
  });

  it('falls back to the archive for a theme folder, extracting only that folder', async () => {
    await cloneRepository(
      { ...base, branch: 'release/2026', themeRoot: 'apps/storefront/theme' },
      target,
      noGit()
    );

    expect(listFiles(target)).toEqual(['layout/theme.liquid', 'sections/header.liquid']);
    expect(requested).toEqual(['release/2026']);
  });

  describe('extracting a folder of the archive', () => {
    let into: string;
    beforeEach(() => {
      into = fs.mkdtempSync(path.join(work, 'extract-'));
    });

    it('writes only that folder, in the layout of a checkout of it', async () => {
      await extractTarball(archive(), into, 'apps/storefront/theme');

      expect(listFiles(into)).toEqual([
        'apps/storefront/theme/layout/theme.liquid',
        'apps/storefront/theme/sections/header.liquid',
      ]);
    });

    it('does not take a sibling folder whose name only starts the same way', async () => {
      await extractTarball(archive(), into, 'apps/storefront/theme');
      expect(fs.existsSync(path.join(into, 'apps/storefront/theme-extra'))).toBe(false);
    });

    it('does not extract symbolic links, whatever they point at', async () => {
      await extractTarball(archive(), into, 'apps/storefront/theme');

      const theme = path.join(into, 'apps/storefront/theme');
      expect(fs.readdirSync(theme).sort()).toEqual(['layout', 'sections']);
      expect(fs.lstatSync(path.join(theme, 'layout')).isSymbolicLink()).toBe(false);
    });

    it('extracts the whole repository when no folder is given, as upstream does', async () => {
      await extractTarball(archive(), into);

      expect(listFiles(into)).toEqual(
        expect.arrayContaining([
          'README.md',
          'apps/other/notes.txt',
          'apps/storefront/theme-extra/layout/theme.liquid',
        ])
      );
    });
  });

  it('does not extract links from the archive when extracting a theme folder', async () => {
    await cloneRepository({ ...base, themeRoot: 'apps/storefront/theme' }, target, noGit());

    expect(fs.readdirSync(target).sort()).toEqual(['layout', 'sections']);
    expect(JSON.stringify(listFiles(target))).not.toContain('leak');
    expect(fs.readFileSync(outside, 'utf8')).toBe('SERVER SECRET');
  });

  it('reports a folder that is not in the archive, and leaves nothing behind', async () => {
    await expect(
      cloneRepository({ ...base, themeRoot: 'apps/missing' }, target, noGit())
    ).rejects.toThrow(RepositoryInputError);
    expect(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('lp-theme-'))).toEqual([]);
  });

  it('does not treat another git failure as "no git"', async () => {
    const broken: CloneDependencies = {
      ...local(),
      runGit: () => {
        throw new Error('git clone failed: repository not found');
      },
    };
    await expect(cloneRepository({ ...base }, target, broken)).rejects.toThrow(
      'repository not found'
    );
  });
});
