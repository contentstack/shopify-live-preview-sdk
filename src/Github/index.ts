import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import axios from 'axios';
import { pipeline } from 'stream/promises';
import * as tar from 'tar';

export interface GitHubConfig {
  auth: string;
  owner: string;
  repo: string;
  branch?: string;
}

/**
 * Downloads a GitHub repository as a tarball and extracts it
 * This is a fallback when git is not available (e.g., in serverless environments)
 */
async function downloadRepositoryArchive(
  config: Pick<GitHubConfig, 'auth' | 'owner' | 'repo' | 'branch'>,
  targetPath: string
): Promise<void> {
  const { auth, owner, repo, branch = 'main' } = config;

  // GitHub API URL for downloading repository archive
  const tarballUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${branch}`;

  try {
    const response = await axios({
      method: 'GET',
      url: tarballUrl,
      headers: {
        'Authorization': `token ${auth}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'live-preview-shopify-middleware'
      },
      responseType: 'stream'
    });

    await extractTarball(response.data, targetPath);
  } catch (error) {
    console.error(`Failed to download repository from GitHub API:`, error);
    throw error;
  }
}

/**
 * Extracts a gzipped GitHub repository tarball into the target directory.
 * GitHub wraps the repository in one `<owner>-<repo>-<sha>/` directory, which is stripped.
 */
export async function extractTarball(
  archive: NodeJS.ReadableStream,
  targetPath: string
): Promise<void> {
  try {
    // tar rejects absolute and `..` entry paths by default (preservePaths: false)
    await pipeline(archive, tar.x({ cwd: targetPath, strip: 1 }));
  } catch (error) {
    const extractError = error as Error;
    console.error(`Failed to extract repository archive:`, extractError);
    throw new Error(`Archive extraction failed: ${extractError.message}`);
  }
}

/**
 * Clones a GitHub repository into the specified target path.
 * The target path will be emptied before cloning.
 * Falls back to GitHub API download if git is not available.
 * @param cloneConfig Configuration object containing auth token, owner, repo name, and optional branch.
 * @param targetPath The absolute path where the repository should be cloned into.
 * @throws Error if cloning fails.
 */
export async function cloneRepository(
  cloneConfig: Pick<GitHubConfig, 'auth' | 'owner' | 'repo' | 'branch'>, 
  targetPath: string
): Promise<void> {
  const { auth, owner, repo, branch } = cloneConfig;

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

  try {
    // First, try using git clone
    
    let cloneCommand = `git clone --depth 1`;
    if (branch) {
      cloneCommand += ` --branch ${branch}`;
    }
    cloneCommand += ` https://${auth}@github.com/${owner}/${repo}.git .`;
    
    execSync(cloneCommand, { cwd: actualTargetPath, stdio: 'inherit' }); 
    
  } catch (gitError) {
    const error = gitError as Error & { status?: number };
    
    // If git command is not found (status 127), try GitHub API download
    if (error.status === 127 || error.message.includes('git: command not found')) {
      
      try {
        await downloadRepositoryArchive(cloneConfig, actualTargetPath);
      } catch (apiError) {
        console.error(`Both git clone and GitHub API download failed:`, apiError);
        throw new Error(`Failed to obtain repository: Git unavailable and API download failed - ${(apiError as Error).message}`);
      }
    } else {
      // If it's a different git error (not command not found), re-throw it
      console.error(`Git clone failed with error:`, error);
      throw error;
    }
  }
} 