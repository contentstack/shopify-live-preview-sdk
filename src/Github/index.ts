import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import axios from 'axios';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import AdmZip from 'adm-zip';

export interface GitHubConfig {
  auth: string;
  owner: string;
  repo: string;
  branch?: string;
}

/**
 * Downloads a GitHub repository as a zip file and extracts it
 * This is a fallback when git is not available (e.g., in serverless environments)
 */
async function downloadRepositoryZip(
  config: Pick<GitHubConfig, 'auth' | 'owner' | 'repo' | 'branch'>,
  targetPath: string
): Promise<void> {
  const { auth, owner, repo, branch = 'main' } = config;
  
  // GitHub API URL for downloading repository archive
  const zipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`;
  const zipPath = path.join(targetPath, 'repo.zip');
  
  try {
    console.log(`Downloading ${owner}/${repo} (${branch}) from GitHub API...`);
    
    const response = await axios({
      method: 'GET',
      url: zipUrl,
      headers: {
        'Authorization': `token ${auth}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'live-preview-shopify-middleware'
      },
      responseType: 'stream'
    });

    // Download the zip file
    await pipeline(response.data, createWriteStream(zipPath));
    
    console.log(`Downloaded repository zip to ${zipPath}`);
    
    // Extract the zip file (we'll need to implement this next)
    await extractZipFile(zipPath, targetPath);
    
    // Clean up the zip file
    fs.unlinkSync(zipPath);
    
  } catch (error) {
    console.error(`Failed to download repository from GitHub API:`, error);
    throw error;
  }
}

/**
 * Extracts a zip file to the target directory using AdmZip
 */
async function extractZipFile(zipPath: string, targetPath: string): Promise<void> {
  try {
    console.log(`Attempting to extract ${zipPath} to ${targetPath}...`);
    
    const zip = new AdmZip(zipPath);
    
    // Extract all files to target directory
    zip.extractAllTo(targetPath, true);
    
    console.log(`Successfully extracted repository to ${targetPath}`);
    
    // Handle GitHub's zip structure - move files from the root subdirectory
    const items = fs.readdirSync(targetPath);
    const rootDir = items.find(item => {
      const itemPath = path.join(targetPath, item);
      return fs.statSync(itemPath).isDirectory() && item.includes('-');
    });
    
    if (rootDir) {
      const rootDirPath = path.join(targetPath, rootDir);
      const subItems = fs.readdirSync(rootDirPath);
      
      // Move all files from subdirectory to target directory
      for (const subItem of subItems) {
        const srcPath = path.join(rootDirPath, subItem);
        const destPath = path.join(targetPath, subItem);
        
        // Handle existing files
        if (fs.existsSync(destPath)) {
          if (fs.statSync(destPath).isDirectory()) {
            fs.rmSync(destPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(destPath);
          }
        }
        
        fs.renameSync(srcPath, destPath);
      }
      
      // Remove the now-empty subdirectory
      fs.rmSync(rootDirPath, { recursive: true, force: true });
      console.log(`Reorganized files from GitHub zip structure`);
    }
    
  } catch (error) {
    const extractError = error as Error;
    console.error(`Failed to extract zip file:`, extractError);
    throw new Error(`Zip extraction failed: ${extractError.message}`);
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
  console.log(`Attempting to use target directory: ${actualTargetPath}`);

  try {
    // Test if we can write to the target directory
    if (fs.existsSync(actualTargetPath)) {
      console.log(`Target directory exists, testing write permissions...`);
      // Try to create a test file to check write permissions
      const testFile = path.join(actualTargetPath, '.write-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      console.log(`Write permissions confirmed for ${actualTargetPath}`);
      
      // Empty the directory for fresh clone
      console.log(`Emptying directory: ${actualTargetPath}`);
      const items = fs.readdirSync(actualTargetPath);
      for (const item of items) {
        const itemPath = path.join(actualTargetPath, item);
        if (fs.statSync(itemPath).isDirectory()) {
          fs.rmSync(itemPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(itemPath);
        }
      }
      console.log(`Successfully emptied ${actualTargetPath}`);
    } else {
      console.log(`Creating target directory: ${actualTargetPath}`);
      fs.mkdirSync(actualTargetPath, { recursive: true });
    }
  } catch (error) {
    // If we can't use the target directory, fall back to a writable location
    console.warn(`Cannot use target directory ${actualTargetPath}: ${(error as Error).message}`);
    
    // Use a consistent fallback directory based on the repo name
    // This provides some persistence within the same serverless container lifecycle
    const repoIdentifier = `${owner}-${repo}`.replace(/[^a-zA-Z0-9-]/g, '-');
    const fallbackDir = path.join('/tmp', `views-${repoIdentifier}`);
    console.log(`Using fallback directory: ${fallbackDir}`);
    console.log(`Note: Repository will be cloned to temporary location. Content may be lost between container restarts.`);
    
    actualTargetPath = fallbackDir;
    
    // Create or clean the fallback directory
    if (fs.existsSync(fallbackDir)) {
      console.log(`Cleaning existing fallback directory: ${fallbackDir}`);
      const items = fs.readdirSync(fallbackDir);
      for (const item of items) {
        const itemPath = path.join(fallbackDir, item);
        fs.rmSync(itemPath, { recursive: true, force: true });
      }
    } else {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
  }

  // Try git clone first, fall back to GitHub API if git is not available
  const branchInfo = branch ? ` (branch: ${branch})` : ' (default branch)';
  
  try {
    // First, try using git clone
    console.log(`Attempting to clone ${owner}/${repo}${branchInfo} using git...`);
    
    let cloneCommand = `git clone --depth 1`;
    if (branch) {
      cloneCommand += ` --branch ${branch}`;
    }
    cloneCommand += ` https://${auth}@github.com/${owner}/${repo}.git .`;
    
    execSync(cloneCommand, { cwd: actualTargetPath, stdio: 'inherit' }); 
    console.log(`Successfully cloned ${owner}/${repo}${branchInfo} into ${actualTargetPath} using git`);
    
  } catch (gitError) {
    const error = gitError as Error & { status?: number };
    
    // If git command is not found (status 127), try GitHub API download
    if (error.status === 127 || error.message.includes('git: command not found')) {
      console.log(`Git not available (${error.message}), falling back to GitHub API download...`);
      
      try {
        await downloadRepositoryZip(cloneConfig, actualTargetPath);
        console.log(`Successfully downloaded ${owner}/${repo}${branchInfo} into ${actualTargetPath} using GitHub API`);
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