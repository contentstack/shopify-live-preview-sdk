import { jest } from '@jest/globals';
// import * as fs from 'fs'; // Not needed for these simplified tests
// import * as path from 'path'; // Not needed for these simplified tests
// import { execSync } from 'child_process'; // Not needed for these simplified tests
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as tar from 'tar';
import { GitHubConfig, cloneRepository, extractTarball } from '../index';

// Mock console methods to avoid cluttering test output if they were used
// const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
// const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

describe('Github Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // mockConsoleLog.mockClear();
    // mockConsoleError.mockClear();
  });

  afterAll(() => {
    // mockConsoleLog.mockRestore();
    // mockConsoleError.mockRestore();
  });

  describe('GitHubConfig interface', () => {
    it('should accept valid configuration with all required fields', () => {
      const config: GitHubConfig = {
        auth: 'test-token',
        owner: 'test-owner',
        repo: 'test-repo',
      };
      expect(config.auth).toBe('test-token');
      expect(config.owner).toBe('test-owner');
      expect(config.repo).toBe('test-repo');
      expect(config.branch).toBeUndefined();
    });

    it('should accept configuration with optional branch field', () => {
      const config: GitHubConfig = {
        auth: 'test-token',
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'develop',
      };
      expect(config.branch).toBe('develop');
    });

    it('should accept configuration with empty optional branch field', () => {
      const config: GitHubConfig = {
        auth: 'test-token',
        owner: 'test-owner',
        repo: 'test-repo',
        branch: ''
      };

      expect(config.branch).toBe('');
    });

    it('should handle special characters in configuration fields', () => {
      const config: GitHubConfig = {
        auth: 'ghp_1234567890abcdef@#$%',
        owner: 'test-owner-123',
        repo: 'test-repo_with.dots-and-dashes',
        branch: 'feature/new-feature_v2.0',
      };

      expect(config.auth).toBe('ghp_1234567890abcdef@#$%');
      expect(config.owner).toBe('test-owner-123');
      expect(config.repo).toBe('test-repo_with.dots-and-dashes');
      expect(config.branch).toBe('feature/new-feature_v2.0');
    });
  });

  describe('cloneRepository function', () => {
    it('should be exported and callable', () => {
      expect(cloneRepository).toBeDefined();
      expect(typeof cloneRepository).toBe('function');
    });

    it('should accept correct parameter types', () => {
      // This test just verifies the function can be called with correct types
      // We don't actually execute it to avoid file system operations
      expect(() => {
        // Just check that the function signature is correct
        expect(cloneRepository.length).toBe(2); // Should accept 2 parameters
      }).not.toThrow();
    });
  });

  describe('extractTarball', () => {
    let workDir: string;
    let targetDir: string;

    beforeEach(() => {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-tarball-'));
      targetDir = path.join(workDir, 'target');
      fs.mkdirSync(targetDir);
    });

    afterEach(() => {
      fs.rmSync(workDir, { recursive: true, force: true });
    });

    it('should strip the GitHub root directory and extract the repository contents', async () => {
      const sourceDir = path.join(workDir, 'source');
      const rootDir = path.join(sourceDir, 'owner-repo-abc1234');
      fs.mkdirSync(path.join(rootDir, 'templates'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, 'layout.liquid'), 'layout');
      fs.writeFileSync(path.join(rootDir, 'templates', 'index.liquid'), 'index');
      const archivePath = path.join(workDir, 'repo.tar.gz');
      await tar.c({ gzip: true, file: archivePath, cwd: sourceDir }, ['owner-repo-abc1234']);

      await extractTarball(fs.createReadStream(archivePath), targetDir);

      expect(fs.readdirSync(targetDir).sort()).toEqual(['layout.liquid', 'templates']);
      expect(fs.readFileSync(path.join(targetDir, 'templates', 'index.liquid'), 'utf8')).toBe(
        'index'
      );
    });

    it('should not write entries that escape the target directory', async () => {
      const sourceDir = path.join(workDir, 'source', 'nested');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(path.join(workDir, 'source', 'outside.txt'), 'outside');
      const archivePath = path.join(workDir, 'evil.tar.gz');
      await tar.c({ gzip: true, file: archivePath, cwd: sourceDir, preservePaths: true }, [
        '../../source/outside.txt',
      ]);
      fs.rmSync(path.join(workDir, 'source', 'outside.txt'));

      await extractTarball(fs.createReadStream(archivePath), targetDir);

      expect(fs.existsSync(path.join(workDir, 'source', 'outside.txt'))).toBe(false);
      expect(fs.existsSync(path.join(workDir, 'outside.txt'))).toBe(false);
    });

    it('should reject an archive that is not a valid tarball', async () => {
      const archivePath = path.join(workDir, 'broken.tar.gz');
      fs.writeFileSync(archivePath, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02]));
      jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(extractTarball(fs.createReadStream(archivePath), targetDir)).rejects.toThrow(
        'Archive extraction failed'
      );
    });
  });

  describe('Module exports', () => {
    it('should export GitHubConfig interface', () => {
      const config: GitHubConfig = {
        auth: 'token',
        owner: 'owner',
        repo: 'repo',
      };
      expect(config).toBeDefined();
    });

    it('should export cloneRepository function', () => {
      expect(cloneRepository).toBeDefined();
      expect(typeof cloneRepository).toBe('function');
    });
  });
}); 