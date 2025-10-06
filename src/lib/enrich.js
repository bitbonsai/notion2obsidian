import { Glob } from "bun";
import { stat, readdir, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, basename, extname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import chalk from "chalk";
import matter from "gray-matter";

// ============================================================================
// Configuration & Constants
// ============================================================================

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_API_VERSION = "2022-06-28";
const RATE_LIMIT_DELAY = 334; // 334ms = ~3 req/s
const MAX_RETRIES = 3;
const CACHE_FILE = ".notion-cache.json";

// ============================================================================
// .env File Loading
// ============================================================================

/**
 * Loads environment variables from a .env file
 * @param {string} envPath - Path to .env file
 * @returns {Object} Environment variables as key-value pairs
 */
function loadEnvFile(envPath) {
  try {
    const content = readFileSync(envPath, 'utf-8');
    const env = {};

    content.split('\n').forEach(line => {
      // Skip comments and empty lines
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      // Parse key=value
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();

        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        env[key] = value;
      }
    });

    return env;
  } catch (error) {
    return {};
  }
}

/**
 * Gets the Notion API token from .env file or environment variable
 * @param {string} vaultPath - Path to the vault directory
 * @returns {string|null} The API token or null if not found
 */
export function getNotionToken(vaultPath) {
  // First, try .env file in vault directory
  const envPath = join(vaultPath, '.env');
  if (existsSync(envPath)) {
    const env = loadEnvFile(envPath);
    if (env.NOTION_TOKEN) {
      return env.NOTION_TOKEN;
    }
  }

  // Fall back to environment variable
  return process.env.NOTION_TOKEN || null;
}

// ============================================================================
// Rate Limiter
// ============================================================================

class RateLimiter {
  constructor(delayMs = RATE_LIMIT_DELAY) {
    this.delayMs = delayMs;
    this.lastRequestTime = 0;
  }

  async wait() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.delayMs) {
      const waitTime = this.delayMs - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }
}

// ============================================================================
// Notion API Client
// ============================================================================

class NotionAPIClient {
  constructor(token) {
    this.token = token;
    this.rateLimiter = new RateLimiter();
  }

  /**
   * Fetch page metadata from Notion API
   * @param {string} pageId - Notion page ID (with or without dashes)
   * @returns {Promise<Object>} Page metadata
   */
  async getPage(pageId) {
    // Remove dashes from page ID if present
    const cleanPageId = pageId.replace(/-/g, '');

    await this.rateLimiter.wait();

    const url = `${NOTION_API_BASE}/pages/${cleanPageId}`;

    let lastError;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Notion-Version': NOTION_API_VERSION
          }
        });

        if (response.status === 429) {
          // Rate limited - exponential backoff
          const retryAfter = parseInt(response.headers.get('retry-after') || '1', 10);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue;
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`API error ${response.status}: ${errorData.message || response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        lastError = error;

        // Exponential backoff for retries
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError;
  }

  /**
   * Download an asset from a URL
   * @param {string} url - URL to download from
   * @returns {Promise<ArrayBuffer>} Downloaded data
   */
  async downloadAsset(url) {
    await this.rateLimiter.wait();

    let lastError;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Download failed: ${response.status} ${response.statusText}`);
        }

        return await response.arrayBuffer();
      } catch (error) {
        lastError = error;

        // Exponential backoff for retries
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError;
  }
}

// ============================================================================
// Cache Manager
// ============================================================================

class CacheManager {
  constructor(vaultPath) {
    this.cachePath = join(vaultPath, CACHE_FILE);
    this.cache = this.load();
  }

  load() {
    try {
      if (existsSync(this.cachePath)) {
        const content = readFileSync(this.cachePath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn(chalk.yellow(`⚠ Could not load cache: ${error.message}`));
    }
    return {};
  }

  async save() {
    try {
      await writeFile(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf-8');
    } catch (error) {
      console.warn(chalk.yellow(`⚠ Could not save cache: ${error.message}`));
    }
  }

  get(pageId) {
    return this.cache[pageId] || null;
  }

  set(pageId, data) {
    this.cache[pageId] = {
      data,
      fetched_at: new Date().toISOString()
    };
  }

  has(pageId) {
    return pageId in this.cache;
  }
}

// ============================================================================
// Vault Scanner
// ============================================================================

/**
 * Scans vault for markdown files with notion-id frontmatter
 * @param {string} vaultPath - Path to vault directory
 * @returns {Promise<Array>} Array of {path, notionId, frontmatter} objects
 */
export async function scanVaultForNotionPages(vaultPath) {
  const glob = new Glob("**/*.md");
  const pages = [];

  for await (const file of glob.scan({
    cwd: vaultPath,
    absolute: true,
    dot: false
  })) {
    try {
      const content = await Bun.file(file).text();
      const parsed = matter(content);

      if (parsed.data && parsed.data['notion-id']) {
        pages.push({
          path: file,
          notionId: parsed.data['notion-id'],
          frontmatter: parsed.data,
          content: parsed.content
        });
      }
    } catch (error) {
      // Skip files that can't be parsed
      continue;
    }
  }

  return pages;
}

// ============================================================================
// Frontmatter Merger
// ============================================================================

/**
 * Safely merges new metadata into existing frontmatter
 * @param {Object} existingFrontmatter - Current frontmatter
 * @param {Object} newMetadata - New metadata to merge
 * @returns {Object} Merged frontmatter
 */
export function mergeFrontmatter(existingFrontmatter, newMetadata) {
  const merged = { ...existingFrontmatter };

  // Add new fields, preserving existing ones
  for (const [key, value] of Object.entries(newMetadata)) {
    if (value !== null && value !== undefined) {
      merged[key] = value;
    }
  }

  // If page has a public URL, set published to true
  if (newMetadata['public-url']) {
    merged.published = true;
  }

  return merged;
}

// ============================================================================
// Asset Downloader
// ============================================================================

/**
 * Downloads and saves an asset next to the markdown file
 * @param {NotionAPIClient} client - API client
 * @param {string} assetUrl - URL of the asset
 * @param {string} mdFilePath - Path to the markdown file
 * @param {string} assetType - Type of asset ('cover' or 'icon')
 * @returns {Promise<string|null>} Filename of saved asset, or null if failed
 */
async function downloadAsset(client, assetUrl, mdFilePath, assetType) {
  try {
    // Skip if URL is a Notion SVG icon (these are embedded references)
    if (assetUrl.includes('notion.so/icons/')) {
      return null;
    }

    // Determine file extension from URL
    const urlObj = new URL(assetUrl);
    const pathname = urlObj.pathname;
    let ext = extname(pathname);

    // Default to .jpg if no extension found
    if (!ext) {
      ext = '.jpg';
    }

    // Build asset filename
    const mdFileName = basename(mdFilePath, '.md');
    const assetFileName = `${mdFileName}-${assetType}${ext}`;
    const assetPath = join(dirname(mdFilePath), assetFileName);

    // Skip if already exists
    if (existsSync(assetPath)) {
      return assetFileName;
    }

    // Download asset
    const data = await client.downloadAsset(assetUrl);

    // Save to file
    await writeFile(assetPath, Buffer.from(data));

    return assetFileName;
  } catch (error) {
    console.warn(chalk.yellow(`⚠ Failed to download ${assetType}: ${error.message}`));
    return null;
  }
}

// ============================================================================
// Metadata Extractor
// ============================================================================

/**
 * Extracts relevant metadata from Notion API response
 * @param {Object} pageData - Response from Notion API
 * @returns {Object} Extracted metadata
 */
function extractMetadata(pageData) {
  const metadata = {};

  // Dates
  if (pageData.created_time) {
    metadata.created = pageData.created_time;
  }

  if (pageData.last_edited_time) {
    metadata.modified = pageData.last_edited_time;
  }

  // Public URL (only if page is publicly shared)
  if (pageData.public_url) {
    metadata['public-url'] = pageData.public_url;
  }

  // Icon
  if (pageData.icon) {
    if (pageData.icon.type === 'emoji') {
      metadata.icon = pageData.icon.emoji;
    } else if (pageData.icon.type === 'external' || pageData.icon.type === 'file') {
      const url = pageData.icon.external?.url || pageData.icon.file?.url;
      if (url) {
        metadata._iconUrl = url; // Store for download
      }
    }
  }

  // Cover
  if (pageData.cover) {
    if (pageData.cover.type === 'external' || pageData.cover.type === 'file') {
      const url = pageData.cover.external?.url || pageData.cover.file?.url;
      if (url) {
        metadata._coverUrl = url; // Store for download
      }
    }
  }

  return metadata;
}

// ============================================================================
// Progress Tracker
// ============================================================================

class ProgressTracker {
  constructor(total) {
    this.total = total;
    this.current = 0;
    this.startTime = Date.now();
    this.fromCache = 0;
    this.fetched = 0;
  }

  increment(fromCache = false) {
    this.current++;
    if (fromCache) {
      this.fromCache++;
    } else {
      this.fetched++;
    }
  }

  getRate() {
    const elapsed = (Date.now() - this.startTime) / 1000;
    if (elapsed === 0) return 0;
    return (this.current / elapsed).toFixed(1);
  }

  getElapsed() {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  getRemaining() {
    const rate = parseFloat(this.getRate());
    if (rate === 0) return '?';

    const remaining = (this.total - this.current) / rate;

    if (remaining < 60) {
      return `${Math.ceil(remaining)}s`;
    } else {
      const minutes = Math.ceil(remaining / 60);
      return `${minutes}m`;
    }
  }

  display() {
    const percentage = Math.floor((this.current / this.total) * 100);
    const bar = '━'.repeat(Math.floor(percentage / 2)) + '━'.repeat(50 - Math.floor(percentage / 2));

    console.log(`\rEnriching pages: ${String(this.current).padStart(3, '0')}/${this.total} (${percentage}%) ${chalk.cyan(bar)}`);
    console.log(`Rate: ${this.getRate()} req/s | Elapsed: ${this.getElapsed()}s | Remaining: ~${this.getRemaining()}`);
  }
}

// ============================================================================
// Error Collector
// ============================================================================

class ErrorCollector {
  constructor() {
    this.errors = [];
  }

  add(filePath, errorType, errorMessage) {
    this.errors.push({
      filePath,
      errorType,
      errorMessage
    });
  }

  hasErrors() {
    return this.errors.length > 0;
  }

  generateReport() {
    if (this.errors.length === 0) {
      return null;
    }

    const report = [];
    report.push(chalk.red.bold('ENRICHMENT ERRORS\n'));

    const criticalErrors = this.errors.filter(e => e.errorType === 'auth');
    const pageErrors = this.errors.filter(e => e.errorType === 'page');
    const assetErrors = this.errors.filter(e => e.errorType === 'asset');

    if (criticalErrors.length > 0) {
      report.push(chalk.red('Critical Errors (stop processing):'));
      criticalErrors.forEach(e => {
        report.push(`  - ${basename(e.filePath)}: ${e.errorMessage}`);
      });
      report.push('');
    }

    if (pageErrors.length > 0) {
      report.push(chalk.yellow('Page Errors (skipped):'));
      pageErrors.forEach(e => {
        report.push(`  - ${basename(e.filePath)}: ${e.errorMessage}`);
      });
      report.push('');
    }

    if (assetErrors.length > 0) {
      report.push(chalk.yellow('Asset Download Errors:'));
      assetErrors.forEach(e => {
        report.push(`  - ${basename(e.filePath)}: ${e.errorMessage}`);
      });
      report.push('');
    }

    return report.join('\n');
  }
}

// ============================================================================
// Main Enrichment Function
// ============================================================================

/**
 * Main enrichment function
 * @param {string} vaultPath - Path to the vault directory
 * @param {Object} options - Enrichment options
 * @returns {Promise<Object>} Enrichment results
 */
export async function enrichVault(vaultPath, options = {}) {
  const { dryRun = false, verbose = false } = options;

  console.log(chalk.blueBright.bold('\n💎 Notion API Enrichment'));
  console.log(chalk.gray('━'.repeat(50)) + '\n');

  // Get Notion token
  const token = getNotionToken(vaultPath);
  if (!token) {
    console.log(chalk.red('✗ NOTION_TOKEN not found'));
    console.log(chalk.gray('\nPlease set up your Notion integration token:'));
    console.log(chalk.gray('  1. Create .env file in vault directory:'));
    console.log(chalk.cyan(`     echo "NOTION_TOKEN=secret_xxx" > ${join(vaultPath, '.env')}`));
    console.log(chalk.gray('  2. Or set environment variable:'));
    console.log(chalk.cyan('     export NOTION_TOKEN="secret_xxx"'));
    console.log(chalk.gray('\nFor setup instructions, visit:'));
    console.log(chalk.cyan('  https://bitbonsai.github.io/notion2obsidian/#enrich\n'));
    return { success: false };
  }

  // Scan vault for pages with notion-id
  console.log(chalk.cyan('🔍 Scanning vault for pages with Notion IDs...'));
  const pages = await scanVaultForNotionPages(vaultPath);

  if (pages.length === 0) {
    console.log(chalk.yellow('⚠ No pages with notion-id found in vault'));
    console.log(chalk.gray('Make sure you have migrated your Notion export first.\n'));
    return { success: false };
  }

  console.log(chalk.green(`✓ Found ${pages.length} pages with Notion IDs\n`));

  // Initialize API client
  const client = new NotionAPIClient(token);

  // Test API connectivity
  console.log(chalk.cyan('🔌 Testing Notion API connection...'));
  try {
    await client.getPage(pages[0].notionId);
    console.log(chalk.green('✓ Notion API connected successfully\n'));
  } catch (error) {
    console.log(chalk.red(`✗ Failed to connect to Notion API: ${error.message}`));

    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      console.log(chalk.gray('\nYour token may be invalid. Please check:'));
      console.log(chalk.gray('  1. Token is correctly copied from https://www.notion.so/my-integrations'));
      console.log(chalk.gray('  2. Integration has been shared with your pages'));
    }

    return { success: false };
  }

  // Initialize cache
  const cache = new CacheManager(vaultPath);

  // Initialize progress tracker
  const progress = new ProgressTracker(pages.length);

  // Initialize error collector
  const errors = new ErrorCollector();

  // Track stats
  const stats = {
    pagesEnriched: 0,
    publicUrls: 0,
    assetsDownloaded: 0,
    covers: 0,
    icons: 0,
    emojiIcons: 0,
    imageIcons: 0
  };

  if (dryRun) {
    console.log(chalk.yellow.bold('DRY RUN MODE - No changes will be made\n'));
  }

  // Process each page
  for (const page of pages) {
    try {
      let pageData;

      // Check cache first
      if (cache.has(page.notionId)) {
        pageData = cache.get(page.notionId).data;
        progress.increment(true);
      } else {
        // Fetch from API
        pageData = await client.getPage(page.notionId);
        cache.set(page.notionId, pageData);
        await cache.save();
        progress.increment(false);
      }

      // Extract metadata
      const metadata = extractMetadata(pageData);

      // Download assets if not dry run
      if (!dryRun) {
        if (metadata._iconUrl) {
          const iconFile = await downloadAsset(client, metadata._iconUrl, page.path, 'icon');
          if (iconFile) {
            metadata.icon = iconFile;
            stats.imageIcons++;
            stats.assetsDownloaded++;
          }
          delete metadata._iconUrl;
        } else if (metadata.icon) {
          stats.emojiIcons++;
        }

        if (metadata._coverUrl) {
          const coverFile = await downloadAsset(client, metadata._coverUrl, page.path, 'cover');
          if (coverFile) {
            metadata.banner = coverFile;
            stats.covers++;
            stats.assetsDownloaded++;
          }
          delete metadata._coverUrl;
        }
      }

      // Track public URLs
      if (metadata['public-url']) {
        stats.publicUrls++;
      }

      // Merge frontmatter
      const mergedFrontmatter = mergeFrontmatter(page.frontmatter, metadata);

      // Update file
      if (!dryRun) {
        const newContent = matter.stringify(page.content, mergedFrontmatter);
        await writeFile(page.path, newContent, 'utf-8');
      }

      stats.pagesEnriched++;

      // Display progress every 10 pages
      if (verbose || progress.current % 10 === 0) {
        progress.display();
      }

    } catch (error) {
      errors.add(page.path, 'page', error.message);
      if (verbose) {
        console.log(chalk.yellow(`⚠ Failed to enrich ${basename(page.path)}: ${error.message}`));
      }
    }
  }

  // Final progress display
  progress.display();
  console.log();

  // Display results
  console.log(chalk.green.bold('Enrichment Complete!'));
  console.log(chalk.gray('━'.repeat(50)) + '\n');

  if (dryRun) {
    console.log(chalk.yellow('DRY RUN - No changes were made'));
    console.log(chalk.gray('Run without --dry-run to apply enrichment\n'));
  }

  console.log(chalk.white('Results:'));
  console.log(`  ${chalk.green('✓')} ${stats.pagesEnriched} pages enriched (${progress.fromCache} from cache, ${progress.fetched} fetched)`);

  if (!dryRun && stats.assetsDownloaded > 0) {
    console.log(`  ${chalk.green('✓')} ${stats.assetsDownloaded} assets downloaded (${stats.covers} covers, ${stats.imageIcons} icons)`);
  }

  if (errors.hasErrors()) {
    console.log(`  ${chalk.red('✗')} ${errors.errors.length} errors encountered`);
  }

  console.log();
  console.log(chalk.white('Metadata Added:'));
  console.log(`  • Creation dates: ${stats.pagesEnriched} pages`);
  console.log(`  • Modification dates: ${stats.pagesEnriched} pages`);
  console.log(`  • Public URLs: ${stats.publicUrls} pages (${pages.length - stats.publicUrls} private)`);

  if (stats.emojiIcons + stats.imageIcons > 0) {
    console.log(`  • Page icons: ${stats.emojiIcons + stats.imageIcons} pages (${stats.emojiIcons} emoji, ${stats.imageIcons} images)`);
  }

  if (stats.covers > 0) {
    console.log(`  • Cover images: ${stats.covers} pages`);
  }

  console.log();
  console.log(chalk.gray(`Cache: ${CACHE_FILE} updated`));
  console.log(chalk.gray('Assets: Stored next to markdown files'));

  const elapsed = Math.floor((Date.now() - progress.startTime) / 1000);
  console.log(chalk.gray(`\nTime elapsed: ${elapsed}s`));

  // Show error report if any
  if (errors.hasErrors()) {
    console.log();
    console.log(errors.generateReport());
  }

  return {
    success: true,
    stats
  };
}
