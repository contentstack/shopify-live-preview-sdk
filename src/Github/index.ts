import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import axios from 'axios';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import * as tar from 'tar';
import { RepositoryInputError, validateRepositoryInput } from './validation.js';

export { RepositoryInputError } from './validation.js';

export interface GitHubConfig {
  auth: string;
  owner: string;
  repo: string;
  branch?: string;
  /**
   * Folder inside the repository that holds the Shopify theme, for a monorepo (for example `apps/storefront/theme`).
   * Only that folder is fetched and its contents are what ends up in the target directory. Absent or empty means the
   * repository root, which is the behaviour without this option.
   */
  themeRoot?: string;
}

export type CloneConfig = Pick<GitHubConfig, 'auth' | 'owner' | 'repo' | 'branch' | 'themeRoot'>;

/** What cloneRepository needs from the outside world. Replaceable so the real flow can be tested without GitHub. */
export interface CloneDependencies {
  /** Runs `git <args>` in `cwd`. Must throw an Error whose message contains none of `secrets`. */
  runGit: (args: string[], cwd: string, secrets: string[]) => void;
  /** The URL to clone from, including the token. */
  remoteUrl: (config: { auth: string; owner: string; repo: string }) => string;
  /** The same repository without the token. */
  publicUrl: (config: { owner: string; repo: string }) => string;
  /** The repository as a gzipped tarball stream, for hosts without git. */
  fetchArchive: (config: {
    auth: string;
    owner: string;
    repo: string;
    branch: string;
  }) => Promise<Readable>;
}

const redact = (text: string, secrets: string[]): string => {
  let result = text;
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join('***');
  }
  // Anything of the shape https://<credentials>@host that was not one of the secrets above.
  return result.replace(/(https?:\/\/)[^@\s/]+@/g, '$1***@');
};

interface GitFailure extends Error {
  gitUnavailable?: boolean;
}

/** A git runner for the given executable (`git` unless a test points it at something else). */
export const createGitRunner =
  (executable = 'git'): CloneDependencies['runGit'] =>
  (args, cwd, secrets) => {
    try {
      // execFileSync passes the arguments straight to git, with no shell in between.
      execFileSync(executable, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      const failure = error as Error & { code?: string; status?: number; stderr?: Buffer | string };
      const stderr = redact(String(failure.stderr ?? '').trim(), secrets).slice(-500);
      // Never the original message: it contains the whole command line, token included.
      const safe: GitFailure = new Error(`git ${args[0]} failed${stderr ? `: ${stderr}` : ''}`);
      // No git on this host (a shell reports 127; running git directly reports ENOENT).
      safe.gitUnavailable = failure.code === 'ENOENT' || failure.status === 127;
      throw safe;
    }
  };

const defaultRunGit = createGitRunner();

/** Exposed for tests, which run the real git against a local repository. */
export const runGit = defaultRunGit;

const defaultFetchArchive: CloneDependencies['fetchArchive'] = async ({
  auth,
  owner,
  repo,
  branch,
}) => {
  const ref = branch.split('/').map(encodeURIComponent).join('/');
  const response = await axios({
    method: 'GET',
    url: `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`,
    headers: {
      Authorization: `token ${auth}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'live-preview-shopify-middleware',
    },
    responseType: 'stream',
  });
  return response.data as Readable;
};

const defaultDependencies: CloneDependencies = {
  runGit: defaultRunGit,
  remoteUrl: ({ auth, owner, repo }) => `https://${auth}@github.com/${owner}/${repo}.git`,
  publicUrl: ({ owner, repo }) => `https://github.com/${owner}/${repo}.git`,
  fetchArchive: defaultFetchArchive,
};

const isGitUnavailable = (error: unknown): boolean =>
  Boolean((error as GitFailure)?.gitUnavailable);

/**
 * Downloads a GitHub repository as a tarball and extracts it
 * This is a fallback when git is not available (e.g., in serverless environments)
 */
async function downloadRepositoryArchive(
  config: { auth: string; owner: string; repo: string; branch?: string },
  targetPath: string,
  dependencies: CloneDependencies
): Promise<void> {
  const { auth, owner, repo, branch = 'main' } = config;

  try {
    const archive = await dependencies.fetchArchive({ auth, owner, repo, branch });
    await extractTarball(archive, targetPath);
  } catch (error) {
    // Only the status: the original error can carry the request, token included.
    console.error(
      `Failed to download repository from GitHub API:`,
      axios.isAxiosError(error)
        ? `HTTP ${error.response?.status ?? 'error'}`
        : (error as Error).message
    );
    throw error;
  }
}

/**
 * Extracts a gzipped GitHub repository tarball into the target directory.
 * GitHub wraps the repository in one `<owner>-<repo>-<sha>/` directory, which is stripped.
 *
 * With `folder`, only that folder of the repository is extracted, to `<targetPath>/<folder>/...`, which is the layout a
 * checkout of that folder has. Symbolic and hard links are not extracted in that case: a theme does not need them, and a
 * link can point anywhere on this host.
 */
export async function extractTarball(
  archive: NodeJS.ReadableStream,
  targetPath: string,
  folder?: string
): Promise<void> {
  try {
    const insideFolder = (entryPath: string): boolean => {
      // `entryPath` still has the wrapper directory in front of it
      const inRepository = entryPath.split('/').slice(1).join('/').replace(/\/$/, '');
      return inRepository === folder || inRepository.startsWith(`${folder}/`);
    };

    // tar rejects absolute and `..` entry paths by default (preservePaths: false)
    await pipeline(
      archive,
      tar.x({
        cwd: targetPath,
        strip: 1,
        ...(folder
          ? {
              filter: (entryPath: string, entry: fs.Stats | tar.ReadEntry) =>
                insideFolder(entryPath) &&
                !('type' in entry && (entry.type === 'SymbolicLink' || entry.type === 'Link')),
            }
          : {}),
      })
    );
  } catch (error) {
    const extractError = error as Error;
    console.error(`Failed to extract repository archive:`, extractError);
    throw new Error(`Archive extraction failed: ${extractError.message}`);
  }
}

const looksLikeShopifyTheme = (dir: string): boolean =>
  ['layout/theme.liquid', 'sections', 'templates'].some((relative) =>
    fs.existsSync(path.join(dir, relative))
  );

/** The theme folder inside the clone, resolved through symlinks, which must stay inside the clone. */
function resolveThemeDirectory(cloneDir: string, themeRoot: string): string {
  let resolved: string;
  try {
    resolved = fs.realpathSync(path.join(cloneDir, ...themeRoot.split('/')));
  } catch {
    throw new RepositoryInputError(
      `The folder "${themeRoot}" was not found in this repository and branch`
    );
  }

  const resolvedClone = fs.realpathSync(cloneDir);
  if (resolved !== resolvedClone && !resolved.startsWith(resolvedClone + path.sep)) {
    throw new RepositoryInputError('The theme folder must be inside the repository');
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new RepositoryInputError(`"${themeRoot}" is a file, not a folder`);
  }
  if (!looksLikeShopifyTheme(resolved)) {
    throw new RepositoryInputError(
      `"${themeRoot}" does not look like a Shopify theme: it has no layout, sections or templates folder`
    );
  }
  return resolved;
}

/**
 * Copies the contents of a directory. Neither `.git` nor symbolic links are copied: a link in a repository can point
 * anywhere on this server, and copying what it points at would put that file into the theme.
 */
function copyDirectoryContents(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.isSymbolicLink()) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

/** Fetches one folder of the repository and copies its contents into targetPath. */
async function cloneThemeFolder(
  config: { auth: string; owner: string; repo: string; branch?: string },
  themeRoot: string,
  targetPath: string,
  dependencies: CloneDependencies
): Promise<void> {
  const { auth, owner, repo, branch } = config;
  const secrets = [auth];
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-theme-'));
  const cloneDir = path.join(workDir, 'repo');
  fs.mkdirSync(cloneDir);

  try {
    try {
      // Nothing is checked out until the folder is chosen; with blobs filtered out, only that folder is downloaded.
      dependencies.runGit(
        [
          'clone',
          '--depth',
          '1',
          '--filter=blob:none',
          '--no-checkout',
          ...(branch ? ['--branch', branch] : []),
          dependencies.remoteUrl({ auth, owner, repo }),
          '.',
        ],
        cloneDir,
        secrets
      );
      dependencies.runGit(['sparse-checkout', 'set', '--cone', themeRoot], cloneDir, secrets);
      // `checkout` after `sparse-checkout set` is what populates the working tree.
      dependencies.runGit(['checkout'], cloneDir, secrets);
    } catch (gitError) {
      if (!isGitUnavailable(gitError)) throw gitError;

      // No git on this host: the archive API, extracting only the folder.
      const archive = await dependencies.fetchArchive({
        auth,
        owner,
        repo,
        branch: branch ?? 'main',
      });
      await extractTarball(archive, cloneDir, themeRoot);
    }

    copyDirectoryContents(resolveThemeDirectory(cloneDir, themeRoot), targetPath);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Clones a GitHub repository into the specified target path.
 * The target path will be emptied before cloning.
 * Falls back to GitHub API download if git is not available.
 * @param cloneConfig Configuration object containing auth token, owner, repo name, and optional branch and themeRoot.
 *   With a `themeRoot`, only that folder is fetched and its contents (not the folder itself) are placed in targetPath.
 * @param targetPath The absolute path where the repository should be cloned into.
 * @throws RepositoryInputError if the owner, repository, branch, token or theme folder is not acceptable, or the
 *   theme folder is not in the repository.
 * @throws Error if cloning fails.
 */
export async function cloneRepository(
  cloneConfig: CloneConfig,
  targetPath: string,
  dependencies: CloneDependencies = defaultDependencies
): Promise<void> {
  // Before anything touches the target directory.
  const { auth, owner, repo, branch, themeRoot } = validateRepositoryInput(cloneConfig);

  let actualTargetPath = targetPath;

  // First, try to use the provided target path (should be the pre-built views directory)

  try {
    // Test if we can write to the target directory
    if (fs.existsSync(actualTargetPath)) {
      // Try to create a test file to check write permissions
      const testFile = path.join(actualTargetPath, '.write-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);

      // Empty the directory for fresh clone
      const items = fs.readdirSync(actualTargetPath);
      for (const item of items) {
        const itemPath = path.join(actualTargetPath, item);
        if (fs.statSync(itemPath).isDirectory()) {
          fs.rmSync(itemPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(itemPath);
        }
      }
    } else {
      fs.mkdirSync(actualTargetPath, { recursive: true });
    }
  } catch (error) {
    // If we can't use the target directory, fall back to a writable location
    console.warn(`Cannot use target directory ${actualTargetPath}: ${(error as Error).message}`);

    // Use a consistent fallback directory based on the repo name
    // This provides some persistence within the same serverless container lifecycle
    const repoIdentifier = `${owner}-${repo}`.replace(/[^a-zA-Z0-9-]/g, '-');
    const fallbackDir = path.join('/tmp', `views-${repoIdentifier}`);

    actualTargetPath = fallbackDir;

    // Create or clean the fallback directory
    if (fs.existsSync(fallbackDir)) {
      const items = fs.readdirSync(fallbackDir);
      for (const item of items) {
        const itemPath = path.join(fallbackDir, item);
        fs.rmSync(itemPath, { recursive: true, force: true });
      }
    } else {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
  }

  if (themeRoot) {
    await cloneThemeFolder(
      { auth, owner, repo, branch },
      themeRoot,
      actualTargetPath,
      dependencies
    );
    return;
  }

  try {
    // First, try using git clone
    dependencies.runGit(
      [
        'clone',
        '--depth',
        '1',
        ...(branch ? ['--branch', branch] : []),
        dependencies.remoteUrl({ auth, owner, repo }),
        '.',
      ],
      actualTargetPath,
      [auth]
    );

    // The clone remembers the URL it came from, token included, in .git/config. Replace it with the plain one so the
    // token does not stay on disk inside the views directory.
    try {
      dependencies.runGit(
        ['remote', 'set-url', 'origin', dependencies.publicUrl({ owner, repo })],
        actualTargetPath,
        [auth]
      );
    } catch (scrubError) {
      console.warn(
        'Could not remove the token from the clone remote:',
        (scrubError as Error).message
      );
    }
  } catch (gitError) {
    // If git is not installed, try GitHub API download
    if (isGitUnavailable(gitError)) {
      try {
        await downloadRepositoryArchive(
          { auth, owner, repo, branch },
          actualTargetPath,
          dependencies
        );
      } catch (apiError) {
        console.error(
          `Both git clone and GitHub API download failed:`,
          (apiError as Error).message
        );
        throw new Error(
          `Failed to obtain repository: Git unavailable and API download failed - ${redact((apiError as Error).message, [auth])}`
        );
      }
    } else {
      // If it's a different git error (not command not found), re-throw it
      console.error(`Git clone failed with error:`, (gitError as Error).message);
      throw gitError;
    }
  }
}
