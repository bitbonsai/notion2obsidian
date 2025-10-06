import { Glob } from "bun";
import { stat, readdir, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, basename, extname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import chalk from "chalk";
import matter from "gray-matter";
import ora from "ora";

// ============================================================================
// Configuration & Constants
// ============================================================================

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_API_VERSION = "2022-06-28";
const RATE_LIMIT_DELAY = 334; // 334ms = ~3 req/s
const MAX_RETRIES = 3;
const CACHE_FILE = ".notion-cache.json";

// ============================================================================
// Environment Token
// ============================================================================

/**
 * Gets the Notion API token from environment variable
 * @returns {string|null} The API token or null if not found
 */
export function getNotionToken() {
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
 * Downloads and saves an asset to the _banners folder
 * @param {NotionAPIClient} client - API client
 * @param {string} assetUrl - URL of the asset
 * @param {string} vaultPath - Path to vault directory
 * @param {string} mdFilePath - Path to the markdown file
 * @param {string} assetType - Type of asset ('cover' or 'icon')
 * @param {Array} warnings - Array to collect warning messages
 * @returns {Promise<string|null>} Relative path to saved asset (_banners/filename), or null if failed
 */
async function downloadAsset(client, assetUrl, vaultPath, mdFilePath, assetType, warnings = []) {
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

    // Build asset filename using notion-id for uniqueness
    const mdFileName = basename(mdFilePath, '.md');
    const assetFileName = `${mdFileName}-${assetType}${ext}`;

    // Create _banners directory at vault root
    const bannersDir = join(vaultPath, '_banners');
    if (!existsSync(bannersDir)) {
      await mkdir(bannersDir, { recursive: true });
    }

    const assetPath = join(bannersDir, assetFileName);
    const relativePath = `_banners/${assetFileName}`;

    // Skip if already exists
    if (existsSync(assetPath)) {
      return relativePath;
    }

    // Download asset
    const data = await client.downloadAsset(assetUrl);

    // Save to file
    await writeFile(assetPath, Buffer.from(data));

    return relativePath;
  } catch (error) {
    // Collect warning instead of printing immediately (to avoid interrupting spinner)
    warnings.push(`Failed to download ${assetType} for ${basename(mdFilePath)}: ${error.message}`);
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
    this.lastDisplayTime = 0;
    this.spinner = ora({
      text: 'Starting enrichment...',
      color: 'cyan'
    }).start();
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
    if (this.fetched === 0) return 0;
    const rate = (this.fetched / elapsed).toFixed(1);
    return Math.min(parseFloat(rate), 3.0).toFixed(1);
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

  display(force = false) {
    const now = Date.now();
    const timeSinceLastDisplay = now - this.lastDisplayTime;

    // Throttle updates to max once per 100ms (unless forced)
    if (!force && (now - this.lastDisplayTime) < 100) {
      return;
    }

    const percentage = Math.floor((this.current / this.total) * 100);
    const elapsed = this.getElapsed();
    const rate = this.getRate();
    const remaining = this.getRemaining();

    // Update spinner text
    this.spinner.text = `${this.current}/${this.total} pages (${percentage}%) | Cached: ${this.fromCache}, Fetched: ${this.fetched} | ${elapsed}s elapsed, ~${remaining} remaining`;

    this.lastDisplayTime = now;
  }

  clear() {
    this.spinner.stop();
  }

  succeed(message) {
    this.spinner.succeed(message);
  }

  fail(message) {
    this.spinner.fail(message);
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
      // Group page errors by type
      const notFoundErrors = pageErrors.filter(e =>
        e.errorMessage.includes('404') ||
        e.errorMessage.includes('Could not find page') ||
        e.errorMessage.includes('not found')
      );
      const otherPageErrors = pageErrors.filter(e =>
        !e.errorMessage.includes('404') &&
        !e.errorMessage.includes('Could not find page') &&
        !e.errorMessage.includes('not found')
      );

      if (notFoundErrors.length > 0) {
        report.push(chalk.yellow(`Notion pages not found: ${notFoundErrors.length} pages`));
        report.push(chalk.gray(`  (Pages may be deleted, in trash, or integration lacks access)`));
        // Show first 3 examples
        const examples = notFoundErrors.slice(0, 3);
        examples.forEach(e => {
          report.push(chalk.gray(`  • ${basename(e.filePath)}`));
        });
        if (notFoundErrors.length > 3) {
          report.push(chalk.gray(`  ... and ${notFoundErrors.length - 3} more`));
        }
        report.push('');
      }

      if (otherPageErrors.length > 0) {
        report.push(chalk.yellow(`Other page errors: ${otherPageErrors.length}`));
        otherPageErrors.slice(0, 5).forEach(e => {
          report.push(`  - ${basename(e.filePath)}: ${e.errorMessage}`);
        });
        if (otherPageErrors.length > 5) {
          report.push(chalk.gray(`  ... and ${otherPageErrors.length - 5} more`));
        }
        report.push('');
      }
    }

    if (assetErrors.length > 0) {
      report.push(chalk.yellow(`Asset download errors: ${assetErrors.length}`));
      assetErrors.slice(0, 3).forEach(e => {
        report.push(chalk.gray(`  • ${basename(e.filePath)}: ${e.errorMessage}`));
      });
      if (assetErrors.length > 3) {
        report.push(chalk.gray(`  ... and ${assetErrors.length - 3} more`));
      }
      report.push('');
    }

    return report.join('\n');
  }
}

// ============================================================================
// CSS Snippet Generator
// ============================================================================

/**
 * Creates Obsidian CSS snippet for banner and metadata display
 * @param {string} vaultPath - Path to the vault directory
 * @returns {Promise<boolean>} True if snippet was created successfully
 */
async function createBannerCSSSnippet(vaultPath) {
  try {
    // Create .obsidian/snippets directory if it doesn't exist
    const snippetsDir = join(vaultPath, '.obsidian', 'snippets');
    if (!existsSync(snippetsDir)) {
      await mkdir(snippetsDir, { recursive: true });
    }

    const snippetPath = join(snippetsDir, 'notion2obsidian-banners.css');

    // Skip if snippet already exists
    if (existsSync(snippetPath)) {
      return false; // Already exists
    }

    const cssContent = `/* Notion to Obsidian - Banner & Metadata Display */
/* Generated by notion2obsidian enrichment */

/* Hide properties header behind banner */
.mod-header:has(+ .obsidian-banner-wrapper) {
    margin-top: var(--banner-height);
    margin-bottom: calc(-1 * var(--banner-height));
}

/* Hide the inline title that appears in the document body */
.inline-title {
    display: none;
}

/* Hide metadata in Reading View */
.markdown-reading-view .metadata-container .metadata-properties-heading {
    display: none;
}
.markdown-reading-view .metadata-container .metadata-content {
    display: none;
}

/* Keep properties expanded in Live Preview/Edit mode */
.markdown-source-view .metadata-container .metadata-content {
    display: block;
}
`;

    await writeFile(snippetPath, cssContent, 'utf-8');
    return true; // Created successfully
  } catch (error) {
    console.warn(chalk.yellow(`⚠ Failed to create CSS snippet: ${error.message}`));
    return false;
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
  const token = getNotionToken();
  if (!token) {
    console.log(chalk.red('✗ NOTION_TOKEN not found'));
    console.log(chalk.gray('\nPlease set the NOTION_TOKEN environment variable:'));
    console.log(chalk.gray('\n  Temporary (current session):'));
    console.log(chalk.cyan('    export NOTION_TOKEN="ntn_xxx"'));
    console.log(chalk.gray('\n  Permanent (add to shell config):'));
    console.log(chalk.cyan('    # For bash - add to ~/.bashrc'));
    console.log(chalk.cyan('    echo \'export NOTION_TOKEN="ntn_xxx"\' >> ~/.bashrc'));
    console.log(chalk.cyan('\n    # For zsh - add to ~/.zshrc'));
    console.log(chalk.cyan('    echo \'export NOTION_TOKEN="ntn_xxx"\' >> ~/.zshrc'));
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
  process.stdout.write(chalk.cyan('🔌 Testing Notion API connection...'));
  try {
    await client.getPage(pages[0].notionId);
    process.stdout.write(chalk.green(' ✓\n\n'));
  } catch (error) {
    process.stdout.write(chalk.red(' ✗\n'));
    console.log(chalk.red(`Failed to connect to Notion API: ${error.message}`));

    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      console.log(chalk.gray('\nYour token may be invalid. Please check:'));
      console.log(chalk.gray('  1. Token is correctly copied from https://www.notion.so/my-integrations'));
      console.log(chalk.gray('  2. Integration must be internal (not public)'));
    } else if (error.message.includes('404') || error.message.includes('Could not find page')) {
      console.log(chalk.gray('\nPages not accessible. Grant access to your integration:'));
      console.log(chalk.gray('  1. Go to: https://www.notion.so/profile/integrations/internal/'));
      console.log(chalk.gray('  2. Select your integration'));
      console.log(chalk.gray('  3. Choose pages to share (select both private and shared pages)'));
    }

    return { success: false };
  }

  // In dry-run mode, sample a subset of pages
  let pagesToProcess = pages;
  const totalPages = pages.length;
  let isSample = false;

  if (dryRun) {
    // Process 10 pages or 1% of total, whichever is larger
    const sampleSize = Math.max(10, Math.ceil(totalPages * 0.01));
    if (totalPages > sampleSize) {
      pagesToProcess = pages.slice(0, sampleSize);
      isSample = true;
    }
    console.log(chalk.yellow.bold('DRY RUN MODE - No changes will be made'));
    if (isSample) {
      console.log(chalk.gray(`Processing ${pagesToProcess.length} sample pages (out of ${totalPages} total)\n`));
    } else {
      console.log(chalk.gray(`Processing all ${totalPages} pages\n`));
    }
  }

  // Initialize cache
  const cache = new CacheManager(vaultPath);

  // Initialize progress tracker
  const progress = new ProgressTracker(pagesToProcess.length);

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

  // Collect warnings to display after spinner completes
  const warnings = [];

  // Track timing for dry-run estimation
  const startTime = Date.now();

  // Process each page
  for (const page of pagesToProcess) {
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
          const iconFile = await downloadAsset(client, metadata._iconUrl, vaultPath, page.path, 'icon', warnings);
          if (iconFile) {
            // Image icons are downloaded but Iconize plugin prefers emoji
            // Save to icon-file field for reference
            metadata['icon-file'] = iconFile;
            stats.imageIcons++;
            stats.assetsDownloaded++;
          }
          delete metadata._iconUrl;
        } else if (metadata.icon) {
          // Emoji icon - keep as 'icon' field for Obsidian Iconize plugin
          // Note: metadata.icon already contains the emoji, no need to rename
          stats.emojiIcons++;
        }

        if (metadata._coverUrl) {
          const coverFile = await downloadAsset(client, metadata._coverUrl, vaultPath, page.path, 'cover', warnings);
          if (coverFile) {
            // Use internal link format for Obsidian Banners plugin
            metadata.banner = `![[${coverFile}]]`;
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
        // Force quotes on all YAML strings to ensure proper parsing of banner field
        const newContent = matter.stringify(page.content, mergedFrontmatter, {
          forceQuotes: true
        });
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

  // Stop the spinner
  progress.succeed(`Enriched ${stats.pagesEnriched} pages in ${progress.getElapsed()}s`);

  // Display any warnings that occurred during processing
  if (warnings.length > 0) {
    console.log();
    console.log(chalk.yellow.bold(`⚠ ${warnings.length} warnings:`));
    // Show first 5 warnings
    warnings.slice(0, 5).forEach(warning => {
      console.log(chalk.yellow(`  • ${warning}`));
    });
    if (warnings.length > 5) {
      console.log(chalk.gray(`  ... and ${warnings.length - 5} more`));
    }
  }

  // Create CSS snippet (only in real mode)
  let snippetCreated = false;
  if (!dryRun) {
    snippetCreated = await createBannerCSSSnippet(vaultPath);
  }

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
  console.log(`  • Public URLs: ${stats.publicUrls} pages (${stats.pagesEnriched - stats.publicUrls} private)`);

  if (stats.emojiIcons + stats.imageIcons > 0) {
    console.log(`  • Page icons: ${stats.emojiIcons + stats.imageIcons} pages (${stats.emojiIcons} emoji, ${stats.imageIcons} images)`);
  }

  if (stats.covers > 0) {
    console.log(`  • Cover images: ${stats.covers} pages`);
  }

  console.log();
  console.log(chalk.gray(`Cache: ${CACHE_FILE} updated`));
  console.log(chalk.gray('Banners: Stored in _banners/ folder (install Obsidian Banners plugin to display)'));
  console.log(chalk.gray('Icons: Emoji icons stored in "icon" field (install Obsidian Iconize plugin to display)'));

  if (snippetCreated) {
    console.log();
    console.log(chalk.green('✓ CSS snippet created: .obsidian/snippets/notion2obsidian-banners.css'));
    console.log(chalk.gray('  Enable in Obsidian: Settings → Appearance → CSS snippets'));
  } else if (!dryRun) {
    console.log();
    console.log(chalk.gray('CSS snippet already exists: .obsidian/snippets/notion2obsidian-banners.css'));
  }

  const elapsedMs = Date.now() - startTime;
  const elapsed = Math.floor(elapsedMs / 1000);
  console.log(chalk.gray(`\nTime elapsed: ${elapsed}s`));

  // Show estimation for dry-run samples
  if (dryRun && isSample) {
    // Only show estimate if we actually fetched pages (not all from cache)
    if (progress.fetched > 0) {
      const avgTimePerPage = elapsedMs / pagesToProcess.length;
      const estimatedTotalMs = avgTimePerPage * totalPages;
      const estimatedMinutes = Math.ceil(estimatedTotalMs / 60000);
      const estimatedSeconds = Math.ceil(estimatedTotalMs / 1000);

      console.log(chalk.gray(`\nEstimated time for full enrichment:`));
      if (estimatedMinutes > 1) {
        console.log(chalk.cyan(`  ~${estimatedMinutes} minutes (${totalPages} pages)`));
      } else {
        console.log(chalk.cyan(`  ~${estimatedSeconds} seconds (${totalPages} pages)`));
      }
    } else {
      // All from cache - will be very fast
      console.log(chalk.gray(`\nEstimated time for full enrichment:`));
      console.log(chalk.cyan(`  Very fast - all ${totalPages} pages already cached`));
    }
  }

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
