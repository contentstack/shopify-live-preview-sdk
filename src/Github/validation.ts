// Validation of what a caller can pass to cloneRepository.
//
// Owner, repository, branch and the theme folder reach a git command line, a URL and the file system, and the
// middleware's /sync-github-repo route passes them through from a request body. Each is checked against the shape
// GitHub itself allows before anything runs, so none of them can carry a shell metacharacter, an option or a path that
// leaves the clone.
//
// The theme-folder rules are kept in step with normalizeThemeRoot in shopify-lp-marketplace-app, which does the same
// job for the marketplace app's own GitHub sync.

/** An error about what the caller passed. Its message is written for the user and is safe to show. */
export class RepositoryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryInputError';
  }
}

export interface ValidatedRepositoryInput {
  auth: string;
  owner: string;
  repo: string;
  branch?: string;
  /** Normalised relative POSIX path of the theme folder, or '' for the repository root. */
  themeRoot: string;
}

const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/;
// GitHub personal access tokens, fine-grained tokens and app installation tokens use letters, digits, "_" and "-".
const TOKEN = /^[A-Za-z0-9_.-]{1,255}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,255}$/;

export const MAX_THEME_ROOT_LENGTH = 255;
const MAX_THEME_ROOT_DEPTH = 20;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const FORBIDDEN_THEME_ROOT_CHARACTERS = /[:*?[\]!]/;

/**
 * A relative POSIX path with no leading or trailing slash, or '' for the repository root. Throws RepositoryInputError
 * for anything that is not a plain folder path inside the repository.
 */
export const normalizeThemeRoot = (input: unknown): string => {
  if (input === undefined || input === null) return '';
  if (typeof input !== 'string') {
    throw new RepositoryInputError('The theme folder must be text');
  }

  const trimmed = input.trim();
  if (trimmed === '') return '';
  if (trimmed.length > MAX_THEME_ROOT_LENGTH) {
    throw new RepositoryInputError(
      `The theme folder is too long (at most ${MAX_THEME_ROOT_LENGTH} characters)`
    );
  }
  if (CONTROL_CHARACTERS.test(trimmed)) {
    throw new RepositoryInputError('The theme folder contains invalid characters');
  }

  const segments = trimmed
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');

  if (segments.length > MAX_THEME_ROOT_DEPTH) {
    throw new RepositoryInputError('The theme folder is nested too deeply');
  }

  for (const segment of segments) {
    if (segment === '..') {
      throw new RepositoryInputError(
        'The theme folder must be inside the repository (".." is not allowed)'
      );
    }
    if (segment.toLowerCase() === '.git') {
      throw new RepositoryInputError('The theme folder cannot be inside ".git"');
    }
    // Would be read as an option by the git command the folder is passed to.
    if (segment.startsWith('-')) {
      throw new RepositoryInputError('A folder name cannot start with "-"');
    }
    if (FORBIDDEN_THEME_ROOT_CHARACTERS.test(segment)) {
      throw new RepositoryInputError(
        'The theme folder contains characters that are not allowed (: * ? [ ] !)'
      );
    }
  }

  return segments.join('/');
};

const isValidBranch = (branch: string): boolean =>
  BRANCH.test(branch) &&
  !branch.startsWith('-') &&
  !branch.startsWith('/') &&
  !branch.endsWith('/') &&
  !branch.endsWith('.lock') &&
  !branch.includes('..') &&
  !branch.includes('//');

/** Checks everything a caller can pass and returns the normalised values. */
export const validateRepositoryInput = (config: {
  auth: unknown;
  owner: unknown;
  repo: unknown;
  branch?: unknown;
  themeRoot?: unknown;
}): ValidatedRepositoryInput => {
  const { auth, owner, repo, branch, themeRoot } = config;

  if (typeof auth !== 'string' || !TOKEN.test(auth)) {
    throw new RepositoryInputError('The GitHub token is missing or malformed');
  }
  if (typeof owner !== 'string' || !OWNER.test(owner)) {
    throw new RepositoryInputError('Invalid repository owner');
  }
  if (typeof repo !== 'string' || !REPOSITORY.test(repo) || repo === '.' || repo === '..') {
    throw new RepositoryInputError('Invalid repository name');
  }

  let validBranch: string | undefined;
  if (branch !== undefined && branch !== null && branch !== '') {
    if (typeof branch !== 'string' || !isValidBranch(branch)) {
      throw new RepositoryInputError('Invalid branch name');
    }
    validBranch = branch;
  }

  return { auth, owner, repo, branch: validBranch, themeRoot: normalizeThemeRoot(themeRoot) };
};
