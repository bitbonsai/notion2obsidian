#!/usr/bin/env bun

import { Glob } from "bun";
import { stat, readdir, rename, copyFile, mkdir, rm, writeFile, lstat, realpath, access, constants } from "node:fs/promises";
import { statSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname, basename, extname, relative, sep, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { unzipSync } from "fflate";
import chalk from "chalk";
import matter from "gray-matter";

// ============================================================================
// Runtime Check
// ============================================================================

if (typeof Bun === 'undefined') {
  console.error(chalk.red('✗ Error: This tool requires Bun runtime\n'));
  console.error('Install Bun: ' + chalk.cyan('curl -fsSL https://bun.sh/install | bash'));
  console.error('Or visit: ' + chalk.cyan('https://bun.sh') + '\n');
  process.exit(1);
}

// ============================================================================
// Configuration & Constants
// ============================================================================

const PATTERNS = {
  hexId: /^[0-9a-fA-F]{32}$/,
  mdLink: /\[([^\]]+)\]\(([^)]+)\)/g,
  frontmatter: /^\uFEFF?\s*---\s*\n/,  // Only accept --- delimiters (Obsidian requirement)
  notionIdExtract: /\s([0-9a-fA-F]{32})(?:\.[^.]+)?$/,
  // Visual patterns for Notion callouts and images
  notionCallout: /<img src="https:\/\/www\.notion\.so\/icons\/([^"]+)" alt="[^"]*" width="[^"]*"\s*\/>\s*\n\s*\n\s*\*\*([^*]+)\*\*\s*\n\s*\n\s*([\s\S]*?)(?=<aside>|<\/aside>|\n\n[#*]|\n\n<|\Z)/g,
  notionAsideCallout: /<aside>\s*<img src="https:\/\/www\.notion\.so\/icons\/([^"]+)" alt="[^"]*" width="[^"]*"\s*\/>\s*([\s\S]*?)<\/aside>/g,
  coverImage: /^!\[([^\]]*)\]\(([^)]+)\)$/m  // First image in file
};

const BATCH_SIZE = 50;

// Icon to Obsidian callout mapping
const ICON_TO_CALLOUT = {
  'wind_blue.svg': { type: 'note', emoji: '💨' },
  'token_blue.svg': { type: 'note', emoji: '📘' },
  'token_green.svg': { type: 'tip', emoji: '📗' },
  'token_yellow.svg': { type: 'example', emoji: '📙' },
  'token_red.svg': { type: 'warning', emoji: '📕' },
  'warning-sign_yellow.svg': { type: 'warning', emoji: '⚠️' },
  'warning-sign_red.svg': { type: 'danger', emoji: '🚨' },
  'info_blue.svg': { type: 'info', emoji: 'ℹ️' },
  'check_green.svg': { type: 'success', emoji: '✅' },
  'cross_red.svg': { type: 'failure', emoji: '❌' },
  'lightbulb_yellow.svg': { type: 'tip', emoji: '💡' },
  'important_red.svg': { type: 'important', emoji: '❗' },
  'question_blue.svg': { type: 'question', emoji: '❓' },
  'gear_blue.svg': { type: 'abstract', emoji: '⚙️' },
  'target_red.svg': { type: 'important', emoji: '🎯' },
  'fire_red.svg': { type: 'danger', emoji: '🔥' },
  'star_yellow.svg': { type: 'tip', emoji: '⭐' },
  'bookmark_blue.svg': { type: 'quote', emoji: '🔖' }
};

// ============================================================================
// CLI Arguments Parser
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    targetPaths: [],
    outputDir: null,
    dryRun: false,
    verbose: false,
    pathsExplicitlyProvided: false,
    convertCallouts: true,
    processCsv: true,
    preserveBanners: true,
    dataviewMode: false  // Default to traditional mode (CSV only, no individual MD files)
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run' || arg === '-d') {
      config.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      config.verbose = true;
    } else if (arg === '--output' || arg === '-o') {
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        config.outputDir = args[i + 1];
        i++; // Skip the next argument since it's the output directory
      } else {
        console.error(chalk.red('Error: --output requires a directory path'));
        process.exit(1);
      }
    } else if (arg === '--version' || arg === '-V') {
      showVersion();
      process.exit(0);
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--no-callouts') {
      config.convertCallouts = false;
    } else if (arg === '--no-csv') {
      config.processCsv = false;
    } else if (arg === '--dataview') {
      config.dataviewMode = true;  // Enable individual MD file creation from CSV rows
    } else if (arg === '--no-banners') {
      config.preserveBanners = false;
    } else if (!arg.startsWith('-')) {
      config.targetPaths.push(arg);
      config.pathsExplicitlyProvided = true;
    }
  }

  // Default to current directory if no paths provided
  if (config.targetPaths.length === 0) {
    config.targetPaths.push('.');
  }

  return config;
}

function getVersion() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packagePath = join(__dirname, 'package.json');
    const packageText = readFileSync(packagePath, 'utf-8');
    const packageJson = JSON.parse(packageText);

    return packageJson.version;
  } catch (error) {
    return '2.3.0'; // Fallback version
  }
}

function showVersion() {
  console.log(`${chalk.blueBright.bold('💎 Notion 2 Obsidian')} ${chalk.gray(`v${getVersion()}`)}`);
}

function showHelp() {
  console.log(`
${chalk.blueBright.bold('💎 Notion 2 Obsidian')} ${chalk.gray(`v${getVersion()}`)}

${chalk.yellow('Usage:')}
  notion2obsidian [directory|zip-file(s)|glob-pattern] [options]

${chalk.yellow('Options:')}
  -o, --output DIR    Output directory for processed files (default: extract location)
  -d, --dry-run       Preview changes without modifying files
                      (extracts 10% sample or 10MB max for zip files)
  -v, --verbose       Show detailed processing information
      --no-callouts   Disable Notion callout conversion to Obsidian callouts
      --no-csv        Disable CSV database processing and index generation
      --dataview      Create individual MD files from CSV rows (default: keep CSV only)
      --no-banners    Disable cover image detection and banner frontmatter
  -V, --version       Show version number
  -h, --help          Show this help message

${chalk.yellow('Examples:')}
  ${chalk.gray('# Single zip file')}
  notion2obsidian ./Export-abc123.zip

  ${chalk.gray('# Multiple zip files with custom output')}
  notion2obsidian *.zip -o ~/Obsidian/Notion-Import

  ${chalk.gray('# Multiple zip files with glob pattern')}
  notion2obsidian Export-*.zip --output ./processed

  ${chalk.gray('# Directory processing with output')}
  notion2obsidian ./my-notion-export -o ~/Documents/Obsidian

  ${chalk.gray('# Dry run to preview changes')}
  notion2obsidian *.zip --dry-run

${chalk.blueBright('Features:')}
  • Accepts zip files directly (extracts and merges to unified directory)
  • Supports multiple zip files with glob patterns (*.zip, Export-*.zip)
  • Custom output directory with -o/--output option
  • Removes Notion IDs from filenames and directories
  • Adds YAML frontmatter with metadata
  • Converts markdown links to wiki links
  • Handles duplicate filenames with folder context
  • Organizes attachments in folders with simplified paths
`);
}

// ============================================================================
// Utility Functions
// ============================================================================

function isHexString(str) {
  return PATTERNS.hexId.test(str);
}

function extractNotionId(filename) {
  const match = filename.match(PATTERNS.notionIdExtract);
  return match ? match[1] : null;
}

function sanitizeFilename(name) {
  // Replace Windows forbidden characters: < > : " / \ | ? *
  // Also replace any other control characters
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-');
}

function shortenFilename(filename, maxLength = 50) {
  if (filename.length <= maxLength) {
    return filename;
  }

  const ext = extname(filename);
  const nameWithoutExt = filename.slice(0, -ext.length);

  // Reserve space for extension + "..." + last 5 chars
  const reservedSpace = ext.length + 3 + 5; // "..." + last5chars + ext
  const availableForStart = maxLength - reservedSpace;

  if (availableForStart > 5 && nameWithoutExt.length > 10) {
    const startPart = nameWithoutExt.slice(0, availableForStart);
    const endPart = nameWithoutExt.slice(-5); // Last 5 characters
    return startPart + '...' + endPart + ext;
  }

  // Fallback to original behavior if name is too short for this pattern
  const availableLength = maxLength - ext.length - 3; // 3 for "..."
  if (availableLength > 0) {
    return nameWithoutExt.slice(0, availableLength) + '...' + ext;
  }

  // If even the extension is too long, just truncate everything
  return filename.slice(0, maxLength - 3) + '...';
}

function cleanName(filename) {
  const ext = extname(filename);
  const nameWithoutExt = filename.slice(0, -ext.length);
  const parts = nameWithoutExt.split(' ');

  if (parts.length > 1 && isHexString(parts[parts.length - 1])) {
    parts.pop();
    const cleanedName = parts.join(' ');
    return sanitizeFilename(cleanedName) + ext;
  }

  return sanitizeFilename(filename);
}

function cleanDirName(dirname) {
  const parts = dirname.split(' ');
  if (parts.length > 1 && isHexString(parts[parts.length - 1])) {
    parts.pop();
    return sanitizeFilename(parts.join(' '));
  }
  return sanitizeFilename(dirname);
}

// ============================================================================
// Glob Pattern Resolution
// ============================================================================

async function resolveGlobPatterns(patterns) {
  const { Glob } = await import('bun');
  const resolvedPaths = [];
  const errors = [];

  for (const pattern of patterns) {
    try {
      // Check if it's a literal path first (not a glob pattern)
      if (!pattern.includes('*') && !pattern.includes('?') && !pattern.includes('[')) {
        // Check if the literal path exists
        try {
          await stat(pattern);
          resolvedPaths.push(pattern);
        } catch (err) {
          errors.push(`Path not found: ${pattern}`);
        }
        continue;
      }

      // It's a glob pattern, resolve it
      const glob = new Glob(pattern);
      const matches = [];

      for await (const file of glob.scan({
        cwd: process.cwd(),
        absolute: true,
        dot: false,
        onlyFiles: true
      })) {
        matches.push(file);
      }

      if (matches.length === 0) {
        errors.push(`No files found matching pattern: ${pattern}`);
      } else {
        resolvedPaths.push(...matches);
      }
    } catch (err) {
      errors.push(`Error resolving pattern '${pattern}': ${err.message}`);
    }
  }

  return { resolvedPaths, errors };
}


// ============================================================================
// File Map Builder
// ============================================================================

function buildFileMap(files, baseDir) {
  const fileMap = new Map();

  for (const filePath of files) {
    const filename = basename(filePath);
    const cleanedName = cleanName(filename);
    const relativePath = relative(baseDir, dirname(filePath));

    const entry = {
      fullPath: filePath,
      cleanedName: cleanedName,
      relativePath: relativePath
    };

    // Store by original name
    fileMap.set(filename, entry);

    // Store by URL-encoded version
    const encodedName = encodeURIComponent(filename);
    if (encodedName !== filename) {
      fileMap.set(encodedName, entry);
    }
  }

  return fileMap;
}

// ============================================================================
// Link Conversion
// ============================================================================

function convertMarkdownLinkToWiki(link, fileMap, currentFilePath) {
  const match = link.match(/\[([^\]]+)\]\(([^)]+)\)/);
  if (!match) return link;

  const [fullMatch, linkText, linkPath] = match;

  // Skip external links
  if (linkPath.startsWith('http://') || linkPath.startsWith('https://')) {
    return link;
  }

  // Parse path and anchor
  const [pathPart, anchor] = linkPath.split('#');

  // Decode the URL-encoded path
  const decodedPath = decodeURIComponent(pathPart);

  // Handle non-md files by cleaning their names but not converting to wiki links
  if (!pathPart.endsWith('.md')) {
    // Clean the filename to remove Notion IDs
    const targetFilename = basename(decodedPath);
    const cleanedFilename = cleanName(targetFilename);

    // If the filename changed, update the link
    if (cleanedFilename !== targetFilename) {
      const decodedLinkText = decodeURIComponent(linkText);
      const newPath = decodedPath.replace(targetFilename, cleanedFilename);
      return `[${decodedLinkText}](${newPath})`;
    }
    return link;
  }

  // Resolve relative paths against current file's directory
  let targetFilename;
  if (decodedPath.startsWith('../') || decodedPath.startsWith('./')) {
    // Resolve relative path
    const currentDir = dirname(currentFilePath);
    const resolvedPath = join(currentDir, decodedPath);
    targetFilename = basename(resolvedPath);
  } else {
    // Just a filename
    targetFilename = basename(decodedPath);
  }

  const cleanedFilename = cleanName(targetFilename);
  const cleanedName = cleanedFilename.replace('.md', '');

  // Decode link text
  const decodedLinkText = decodeURIComponent(linkText);

  // Build wiki link with optional anchor
  const anchorPart = anchor ? `#${anchor}` : '';

  if (decodedLinkText === cleanedName || decodedLinkText === cleanedFilename) {
    // Simple wiki link
    return `[[${cleanedName}${anchorPart}]]`;
  } else {
    // Aliased wiki link
    return `[[${cleanedName}${anchorPart}|${decodedLinkText}]]`;
  }
}

// ============================================================================
// Metadata Extraction
// ============================================================================

function extractInlineMetadataFromLines(lines) {
  const metadata = {};

  for (const line of lines) {
    if (line.startsWith('Status:')) metadata.status = line.substring(7).trim();
    if (line.startsWith('Owner:')) metadata.owner = line.substring(6).trim();
    if (line.startsWith('Dates:')) metadata.dates = line.substring(6).trim();
    if (line.startsWith('Priority:')) metadata.priority = line.substring(9).trim();
    if (line.startsWith('Completion:')) metadata.completion = parseFloat(line.substring(11).trim());
    if (line.startsWith('Summary:')) metadata.summary = line.substring(8).trim();
  }

  return metadata;
}

function getTagsFromPath(filePath, baseDir) {
  const relativePath = relative(baseDir, filePath);
  const dir = dirname(relativePath);

  if (dir === '.' || dir === '') return [];

  const parts = dir.split('/');
  const tags = parts.map(part =>
    cleanDirName(part)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  ).filter(tag => tag.length > 0);

  return [...new Set(tags)];
}

// File stats function removed - dates not meaningful for Notion exports

// ============================================================================
// Frontmatter Handling (Gray-Matter Based)
// ============================================================================

/**
 * Validates if content has proper Obsidian-compatible frontmatter
 * @param {string} content - The file content to check
 * @returns {boolean} - True if valid frontmatter is detected
 */
function hasValidFrontmatter(content) {
  // Strip BOM if present
  const cleanContent = content.replace(/^\uFEFF/, '');

  // Check if content starts with exactly '---' (Obsidian requirement)
  return cleanContent.trimStart().startsWith('---\n');
}

/**
 * Parses frontmatter from content using gray-matter
 * @param {string} content - The file content
 * @returns {Object} - { data: {}, content: '', hasFrontmatter: boolean }
 */
function parseFrontmatter(content) {
  try {
    // Strip BOM if present
    const cleanContent = content.replace(/^\uFEFF/, '');

    const parsed = matter(cleanContent);

    return {
      data: parsed.data || {},
      content: parsed.content || '',
      hasFrontmatter: Object.keys(parsed.data || {}).length > 0
    };
  } catch (error) {
    console.warn(chalk.yellow(`Warning: Failed to parse frontmatter: ${error.message}`));
    return {
      data: {},
      content: content.replace(/^\uFEFF/, ''),
      hasFrontmatter: false
    };
  }
}

/**
 * Generates valid YAML frontmatter using gray-matter
 * @param {Object} metadata - The metadata object
 * @param {string} relativePath - Relative path for folder field
 * @returns {string} - Valid YAML frontmatter string
 */
function generateValidFrontmatter(metadata, relativePath) {
  // Build frontmatter data object
  const frontmatterData = {};

  // Add metadata in a consistent order
  if (metadata.title) frontmatterData.title = metadata.title;

  if (metadata.tags && metadata.tags.length > 0) {
    frontmatterData.tags = metadata.tags;
  }

  if (metadata.aliases && metadata.aliases.length > 0) {
    frontmatterData.aliases = metadata.aliases;
  }

  if (metadata.notionId) frontmatterData['notion-id'] = metadata.notionId;

  // Add folder path for disambiguation
  if (relativePath && relativePath !== '.') {
    frontmatterData.folder = relativePath;
  }

  // Add banner image if provided
  if (metadata.banner) frontmatterData.banner = metadata.banner;

  // Add inline metadata if found
  if (metadata.status) frontmatterData.status = metadata.status;
  if (metadata.owner) frontmatterData.owner = metadata.owner;
  if (metadata.dates) frontmatterData.dates = metadata.dates;
  if (metadata.priority) frontmatterData.priority = metadata.priority;
  if (metadata.completion !== undefined) frontmatterData.completion = metadata.completion;
  if (metadata.summary) frontmatterData.summary = metadata.summary;

  // Always set published to false
  frontmatterData.published = false;

  try {
    // Use gray-matter to generate properly formatted YAML
    const result = matter.stringify('', frontmatterData);

    // Extract just the frontmatter part (remove empty content)
    const frontmatterMatch = result.match(/^---\n([\s\S]*?)\n---\n$/);
    if (frontmatterMatch) {
      return `---\n${frontmatterMatch[1]}\n---`;
    }

    // Fallback: generate manually if matter.stringify doesn't work as expected
    return generateFallbackFrontmatter(frontmatterData);

  } catch (error) {
    console.warn(chalk.yellow(`Warning: Failed to generate frontmatter with gray-matter: ${error.message}`));
    return generateFallbackFrontmatter(frontmatterData);
  }
}

/**
 * Fallback frontmatter generation for edge cases
 * @param {Object} data - The frontmatter data object
 * @returns {string} - Manually formatted YAML frontmatter
 */
function generateFallbackFrontmatter(data) {
  const lines = ['---'];

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      value.forEach(item => {
        lines.push(`  - ${JSON.stringify(item)}`);
      });
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Validates that generated frontmatter is proper YAML
 * @param {string} frontmatterString - The frontmatter to validate
 * @returns {boolean} - True if valid
 */
function validateFrontmatter(frontmatterString) {
  try {
    // Parse the frontmatter to ensure it's valid YAML
    const parsed = matter(`${frontmatterString}\n\ntest content`);
    return parsed.data && typeof parsed.data === 'object';
  } catch (error) {
    return false;
  }
}

// ============================================================================
// Asset Path Conversion
// ============================================================================

function cleanAssetPaths(content, dirNameMap) {
  // Update all asset references (images, files) to use cleaned directory names
  // Pattern matches: ![alt](path) and [text](path) for local files
  const assetPattern = /(!?\[[^\]]*\]\()([^)]+)(\))/g;

  return content.replace(assetPattern, (match, prefix, path, suffix) => {
    // Skip external URLs
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('mailto:')) {
      return match;
    }

    // Skip wiki links (already converted)
    if (match.startsWith('[[')) {
      return match;
    }

    // Decode URL-encoded paths
    const decodedPath = decodeURIComponent(path);

    // Replace old directory names with cleaned names
    let updatedPath = decodedPath;
    for (const [oldName, newName] of dirNameMap.entries()) {
      // Match directory name at start of path or after /
      const pattern = new RegExp(`(^|/)${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`, 'g');
      updatedPath = updatedPath.replace(pattern, `$1${newName}$2`);
    }

    // Re-encode if needed (preserve URL encoding for spaces, etc.)
    if (updatedPath !== decodedPath) {
      // Encode the path, but preserve / as separator
      const parts = updatedPath.split('/');
      const encodedParts = parts.map(part => encodeURIComponent(part));
      updatedPath = encodedParts.join('/');
    }

    return prefix + updatedPath + suffix;
  });
}

// ============================================================================
// File Processing
// ============================================================================

async function processFileContent(filePath, metadata, fileMap, baseDir, dirNameMap = new Map()) {
  const file = Bun.file(filePath);
  const content = await file.text();

  // Skip completely empty files
  if (!content || content.trim().length === 0) {
    return { newContent: content, linkCount: 0, hadFrontmatter: false, skipped: true };
  }

  const lines = content.split('\n');

  // Extract inline metadata from content
  const inlineMetadata = extractInlineMetadataFromLines(lines.slice(0, 30));
  Object.assign(metadata, inlineMetadata);

  // Check if file already has valid Obsidian frontmatter
  const hasFrontmatter = hasValidFrontmatter(content);

  // Add folder path to metadata
  const relativePath = relative(baseDir, dirname(filePath));
  metadata.folder = relativePath !== '.' ? relativePath : undefined;

  let newContent = content;

  // Convert Notion callouts to Obsidian callouts
  const { content: contentAfterCallouts, calloutsConverted } = convertNotionCallouts(newContent);
  newContent = contentAfterCallouts;

  // Detect and handle cover images
  const { bannerPath, content: contentAfterBanner } = detectCoverImage(newContent);
  if (bannerPath) {
    metadata.banner = bannerPath;
  }
  newContent = contentAfterBanner;

  // Add frontmatter if it doesn't exist
  if (!hasFrontmatter) {
    const frontmatter = generateValidFrontmatter(metadata, relativePath);

    // Validate the generated frontmatter
    if (!validateFrontmatter(frontmatter)) {
      console.warn(chalk.yellow(`Warning: Generated invalid frontmatter for ${filePath}`));
    }

    // Ensure content starts with frontmatter and has proper line endings
    newContent = frontmatter + '\n\n' + newContent.replace(/^\uFEFF/, ''); // Remove BOM if present
  }

  // Convert markdown links to wiki links and count them
  let linkCount = 0;
  newContent = newContent.replace(PATTERNS.mdLink, (match) => {
    const converted = convertMarkdownLinkToWiki(match, fileMap, filePath);
    if (converted !== match) {
      linkCount++;
    }
    return converted;
  });

  // Update asset paths to use cleaned directory names
  newContent = cleanAssetPaths(newContent, dirNameMap);

  return { newContent, linkCount, hadFrontmatter: hasFrontmatter, calloutsConverted: calloutsConverted || 0 };
}

async function updateFileContent(filePath, metadata, fileMap, baseDir, dirNameMap = new Map()) {
  try {
    const { newContent, linkCount, skipped, calloutsConverted } = await processFileContent(filePath, metadata, fileMap, baseDir, dirNameMap);

    // Skip completely empty files
    if (skipped) {
      return { success: true, linkCount: 0, skipped: true };
    }

    // Write file with explicit UTF-8 encoding, no BOM
    await Bun.write(filePath, newContent);

    return { success: true, linkCount, calloutsConverted };
  } catch (err) {
    return { success: false, error: err.message, linkCount: 0, calloutsConverted: 0 };
  }
}

// ============================================================================
// Notion Visual Element Conversion
// ============================================================================

/**
 * Converts Notion callouts to Obsidian callout syntax
 * @param {string} content - The markdown content to process
 * @returns {Object} - { content: string, calloutsConverted: number }
 */
function convertNotionCallouts(content) {
  let calloutsConverted = 0;
  let processedContent = content;

  // Handle <aside> callouts (like wind_blue.svg example)
  processedContent = processedContent.replace(PATTERNS.notionAsideCallout, (match, iconFile, calloutContent) => {
    const calloutInfo = ICON_TO_CALLOUT[iconFile] || { type: 'note', emoji: '📄' };

    // Clean up the content - remove extra whitespace and newlines
    const cleanContent = calloutContent
      .replace(/^\s*\n+/, '') // Remove leading newlines
      .replace(/\n+\s*$/, '') // Remove trailing newlines
      .replace(/\n\n+/g, '\n\n') // Normalize multiple newlines
      .split('\n')
      .map(line => line.trim() ? `> ${line}` : '>')
      .join('\n');

    // Extract title if it starts with **text**
    const titleMatch = calloutContent.match(/^\s*\*\*([^*]+)\*\*/);
    const title = titleMatch ? titleMatch[1] : '';
    const contentWithoutTitle = titleMatch ?
      calloutContent.replace(/^\s*\*\*[^*]+\*\*\s*\n?/, '') : calloutContent;

    const finalTitle = title ? ` ${calloutInfo.emoji} ${title}` : '';

    calloutsConverted++;
    return `> [!${calloutInfo.type}]${finalTitle}\n> ${contentWithoutTitle.trim().split('\n').join('\n> ')}`;
  });

  // Handle standalone callouts (img + ** pattern, less common)
  processedContent = processedContent.replace(PATTERNS.notionCallout, (match, iconFile, title, content) => {
    const calloutInfo = ICON_TO_CALLOUT[iconFile] || { type: 'note', emoji: '📄' };

    // Clean up the content
    const cleanContent = content
      .replace(/^\s*\n+/, '')
      .replace(/\n+\s*$/, '')
      .trim();

    const finalTitle = title ? ` ${calloutInfo.emoji} ${title}` : '';

    calloutsConverted++;
    return `> [!${calloutInfo.type}]${finalTitle}\n> ${cleanContent.split('\n').join('\n> ')}`;
  });

  return { content: processedContent, calloutsConverted };
}

/**
 * Detects cover images and generates banner frontmatter
 * @param {string} content - The markdown content
 * @returns {Object} - { bannerPath: string|null, content: string }
 */
function detectCoverImage(content) {
  const coverMatch = content.match(PATTERNS.coverImage);

  if (coverMatch) {
    const [fullMatch, altText, imagePath] = coverMatch;

    // Check if this looks like a cover/banner image
    const isCoverCandidate =
      content.indexOf(fullMatch) < 200 || // First 200 chars
      imagePath.includes('cover') ||
      imagePath.includes('banner') ||
      imagePath.includes('hero');

    if (isCoverCandidate) {
      // Convert to wiki-link format and clean path
      const cleanPath = imagePath.split('/').pop(); // Get just filename
      const bannerPath = `[[${cleanPath}]]`;

      // Remove the cover image from content to avoid duplication
      const contentWithoutCover = content.replace(fullMatch, '').replace(/^\n+/, '');

      return { bannerPath, content: contentWithoutCover };
    }
  }

  return { bannerPath: null, content };
}

/**
 * Processes CSV database files and creates index pages
 * @param {string} targetDir - The directory to scan for CSV files
 * @returns {Array} - Array of processed CSV info
 */
async function processCsvDatabases(targetDir) {
  const csvFiles = [];
  const csvGlob = new Glob('**/*.csv');

  for (const csvPath of csvGlob.scanSync(targetDir)) {
    const fullPath = join(targetDir, csvPath);

    try {
      const csvContent = await Bun.file(fullPath).text();
      const lines = csvContent.split('\n').filter(line => line.trim());

      if (lines.length < 2) continue; // Skip empty or header-only files

      // Parse CSV header
      const header = lines[0].replace(/^\uFEFF/, '').split(',').map(col => col.trim().replace(/"/g, ''));
      const rows = lines.slice(1).map(line => {
        // Simple CSV parsing (handles basic cases)
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());
        return values;
      });

      // Extract database name from filename
      const fileName = basename(csvPath, '.csv');
      const databaseName = fileName.replace(/\s[0-9a-fA-F]{32}(_all)?$/, ''); // Remove hash

      csvFiles.push({
        path: fullPath,
        fileName,
        databaseName,
        header,
        rows,
        recordCount: rows.length
      });

    } catch (error) {
      console.warn(chalk.yellow(`Warning: Failed to process CSV ${csvPath}: ${error.message}`));
    }
  }

  return csvFiles;
}

/**
 * Creates a markdown index page for a CSV database
 * @param {Object} csvInfo - CSV file information
 * @param {string} targetDir - Target directory
 * @returns {string} - Generated markdown content
 */
function generateDatabaseIndex(csvInfo, targetDir) {
  const { databaseName, header, rows, fileName } = csvInfo;
  const relativeCsvPath = `${databaseName}.csv`;

  let markdown = `# ${databaseName}\n\n`;
  markdown += `Database with ${rows.length} records.\n\n`;

  // Add CSV file link
  markdown += `**CSV File:** [[${relativeCsvPath}|Open in spreadsheet app]]\n\n`;

  // Create Dataview query to show all records
  markdown += `## All Records\n\n`;
  markdown += '```dataview\n';
  markdown += 'TABLE WITHOUT ID ';

  // Use first 5 columns for the table view
  const displayColumns = header.slice(0, 5);
  markdown += displayColumns.join(', ') + '\n';
  markdown += `FROM csv("${relativeCsvPath}")\n`;
  markdown += '```\n\n';

  // Look for corresponding directory with individual MD files
  const baseDir = dirname(csvInfo.path);
  const dbDir = join(baseDir, databaseName);

  try {
    statSync(dbDir);

    // Directory exists - reference the _data folder
    markdown += `## Individual Pages\n\n`;
    markdown += `Individual database pages are stored in [[${databaseName}/_data|${databaseName}/_data/]]\n\n`;
  } catch (error) {
    // No individual pages directory
  }

  return markdown;
}

/**
 * Creates individual markdown notes from CSV rows (Dataview mode)
 * @param {Object} csvInfo - CSV file information
 * @param {string} targetDir - Target directory
 * @param {string} databasesDir - _databases subdirectory path
 * @returns {Array} - Array of created note file paths
 */
async function createNotesFromCsvRows(csvInfo, targetDir, databasesDir) {
  const { databaseName, header, rows, fileName } = csvInfo;
  const createdNotes = [];

  // Create a folder for the database notes
  const notesDir = join(targetDir, databaseName);
  await mkdir(notesDir, { recursive: true });

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Create note content with frontmatter
    const noteData = {};
    const frontmatter = {
      tags: [`database/${databaseName.toLowerCase().replace(/\s+/g, '-')}`],
      'database-source': `_databases/${fileName}`,
      'database-row': i + 1,
      published: false
    };

    // Extract title from first column or generate one
    let title = '';
    if (row[0] && row[0].trim()) {
      title = row[0].replace(/"/g, '').trim();
    } else {
      title = `${databaseName} Record ${i + 1}`;
    }

    frontmatter.title = title;

    // Add CSV columns as frontmatter properties
    header.forEach((column, idx) => {
      if (row[idx] && row[idx].trim()) {
        const value = row[idx].replace(/"/g, '').trim();
        const key = column.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

        // Special handling for common Notion database columns
        if (key === 'notion-id' || column === 'notion-id') {
          frontmatter['notion-id'] = value;
        } else if (key === 'status' || key === 'priority' || key === 'assignee' || key === 'owner') {
          frontmatter[key] = value;
        } else {
          frontmatter[key] = value;
        }
      }
    });

    // Generate clean filename
    const cleanTitle = title
      .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-')            // Spaces to hyphens
      .toLowerCase()
      .slice(0, 50);                   // Limit length

    const noteFileName = `${cleanTitle || `record-${i + 1}`}.md`;
    const notePath = join(notesDir, noteFileName);

    // Generate markdown content
    let content = generateValidFrontmatter(frontmatter, '');
    content += `\n# ${title}\n\n`;

    // Add table with all properties
    content += '## Properties\n\n';
    content += '| Property | Value |\n';
    content += '| --- | --- |\n';

    header.forEach((column, idx) => {
      if (row[idx] && row[idx].trim()) {
        const value = row[idx].replace(/"/g, '').trim().replace(/\|/g, '\\|');
        content += `| ${column} | ${value} |\n`;
      }
    });

    content += `\n## Database Info\n\n`;
    content += `Source: [[${databaseName}_Index|${databaseName} Database]]\n`;
    content += `Record: ${i + 1} of ${rows.length}\n`;

    await Bun.write(notePath, content);
    createdNotes.push(notePath);
  }

  return createdNotes;
}

/**
 * Generates a Dataview-compatible database index page
 * @param {Object} csvInfo - CSV file information
 * @param {string} targetDir - Target directory
 * @param {Array} createdNotes - Array of created note paths
 * @returns {string} - Generated markdown content
 */
function generateDataviewIndex(csvInfo, targetDir, createdNotes) {
  const { databaseName, header, rows, fileName } = csvInfo;

  let markdown = `# ${databaseName}\n\n`;
  markdown += `Database with ${rows.length} records converted to individual notes.\n\n`;

  // Add Dataview queries
  markdown += '## All Records\n\n';
  markdown += '```dataview\n';
  markdown += 'TABLE WITHOUT ID file.link as "Record", ';

  // Add common columns to the query
  const commonColumns = ['status', 'priority', 'assignee', 'owner', 'due'];
  const availableColumns = commonColumns.filter(col =>
    header.some(h => h.toLowerCase().includes(col))
  );

  if (availableColumns.length > 0) {
    markdown += availableColumns.join(', ') + '\n';
  } else {
    markdown += 'title\n';
  }

  markdown += `FROM #database/${databaseName.toLowerCase().replace(/\s+/g, '-')}\n`;
  markdown += '```\n\n';

  // Add filtered views
  if (availableColumns.includes('status')) {
    markdown += '## Active Records\n\n';
    markdown += '```dataview\n';
    markdown += 'TABLE WITHOUT ID file.link as "Record", status, priority\n';
    markdown += `FROM #database/${databaseName.toLowerCase().replace(/\s+/g, '-')}\n`;
    markdown += 'WHERE status != "Done" AND status != "Completed"\n';
    markdown += 'SORT priority DESC\n';
    markdown += '```\n\n';
  }

  // Add CSV source info
  markdown += '## CSV Data Source\n\n';
  markdown += `Raw CSV file: \`_databases/${fileName}.csv\`\n\n`;
  markdown += 'You can query the CSV directly with Dataview:\n\n';
  markdown += '```dataview\n';
  markdown += `TABLE WITHOUT ID ${header.slice(0, 3).join(', ')}\n`;
  markdown += `FROM csv("_databases/${fileName}.csv")\n`;
  markdown += '```\n\n';

  // Add individual note links
  markdown += `## Individual Notes (${createdNotes.length})\n\n`;
  createdNotes.slice(0, 10).forEach(notePath => {
    const noteName = basename(notePath, '.md');
    const displayName = noteName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    markdown += `- [[${noteName}|${displayName}]]\n`;
  });

  if (createdNotes.length > 10) {
    markdown += `\n*Showing first 10 of ${createdNotes.length} notes. Use Dataview queries above to see all.*\n`;
  }

  return markdown;
}

// ============================================================================
// Directory Operations
// ============================================================================

async function getAllDirectories(dir) {
  const dirs = [];
  const visited = new Set();

  async function scan(currentDir) {
    // Resolve symlinks to detect circular references
    let realPath;
    try {
      realPath = await realpath(currentDir);
    } catch {
      return; // Skip if can't resolve path
    }

    if (visited.has(realPath)) {
      return; // Already visited (circular symlink)
    }
    visited.add(realPath);

    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      // Check if it's a symlink
      const stats = await lstat(fullPath).catch(() => null);
      if (!stats || stats.isSymbolicLink()) {
        continue; // Skip symlinks
      }

      if (entry.isDirectory()) {
        dirs.push(fullPath);
        await scan(fullPath);
      }
    }
  }

  await scan(dir);
  return dirs;
}

// ============================================================================
// Duplicate Detection
// ============================================================================

async function findDuplicateNames(files) {
  const nameMap = new Map();

  for (const filePath of files) {
    const cleanedName = cleanName(basename(filePath));
    if (!nameMap.has(cleanedName)) {
      nameMap.set(cleanedName, []);
    }
    nameMap.get(cleanedName).push(filePath);
  }

  const duplicates = new Map();
  for (const [name, paths] of nameMap.entries()) {
    if (paths.length > 1) {
      duplicates.set(name, paths);
    }
  }

  return duplicates;
}

// ============================================================================
// Migration Statistics
// ============================================================================

class MigrationStats {
  constructor() {
    this.totalFiles = 0;
    this.processedFiles = 0;
    this.renamedFiles = 0;
    this.renamedDirs = 0;
    this.totalLinks = 0;
    this.namingConflicts = [];
    this.duplicates = 0;
    this.csvFilesProcessed = 0;
    this.csvIndexesCreated = 0;
    this.calloutsConverted = 0;
  }

  addNamingConflict(filePath, resolution) {
    this.namingConflicts.push({ filePath, resolution });
  }

  getSummary() {
    return {
      totalFiles: this.totalFiles,
      processedFiles: this.processedFiles,
      renamedFiles: this.renamedFiles,
      renamedDirs: this.renamedDirs,
      totalLinks: this.totalLinks,
      namingConflictCount: this.namingConflicts.length,
      duplicates: this.duplicates,
      csvFilesProcessed: this.csvFilesProcessed,
      csvIndexesCreated: this.csvIndexesCreated,
      calloutsConverted: this.calloutsConverted
    };
  }
}

// ============================================================================
// Zip Extraction
// ============================================================================

async function extractZipToSameDirectory(zipPath, options = {}) {
  const { sample = false, samplePercentage = 0.10, maxSampleBytes = 10_000_000, mergeToDir = null, suppressMessages = false } = options;

  const zipDir = dirname(zipPath);
  const zipBaseName = basename(zipPath, '.zip');

  let extractDir;
  if (mergeToDir) {
    // Use the provided merge directory
    extractDir = mergeToDir;
  } else {
    // Shorten the directory name by truncating long hashes/UUIDs
    // Pattern: Export-2d6fa1e5-8571-4845-8e81-f7d5ca30194a-Part-1 → Export-2d6f
    let shortName = zipBaseName;
    // Match UUID format (with hyphens) or plain hex (without hyphens)
    const uuidPattern = /^(Export-[0-9a-fA-F]{4})[0-9a-fA-F-]{24,}/;
    const match = zipBaseName.match(uuidPattern);
    if (match) {
      shortName = match[1];  // e.g., "Export-2d6f"
    }

    extractDir = join(zipDir, `${shortName}-extracted`);
  }

  if (!suppressMessages) {
    console.log(chalk.cyan('📦 Extracting zip file...'));
    console.log(chalk.gray(`Extracting to: ${extractDir}`));

    if (sample) {
      console.log(chalk.yellow(`Sample mode: extracting up to ${samplePercentage * 100}% or ${Math.round(maxSampleBytes / 1_000_000)}MB for preview`));
    }
    console.log();
  }

  try {
    // Read zip file
    const zipData = await Bun.file(zipPath).arrayBuffer();
    const zipBuffer = new Uint8Array(zipData);

    // Extract using fflate
    const unzipped = unzipSync(zipBuffer, {
      filter(file) {
        // Skip macOS metadata files and directories
        return !file.name.includes('__MACOSX') &&
               !file.name.split('/').some(p => p.startsWith('.'));
      }
    });

    // Convert to array and filter out directories (entries ending with /)
    const filesToExtract = Object.entries(unzipped).filter(([path]) => !path.endsWith('/'));

    let isSampled = false;
    let totalFiles = filesToExtract.length;
    let selectedFiles = filesToExtract;

    if (sample) {
      // Calculate sample size
      const targetCount = Math.ceil(totalFiles * samplePercentage);

      // Sample evenly distributed files
      const step = Math.max(1, Math.floor(totalFiles / targetCount));
      const sampledFiles = [];
      let totalBytes = 0;

      for (let i = 0; i < totalFiles && sampledFiles.length < targetCount; i += step) {
        const [path, data] = filesToExtract[i];
        if (totalBytes + data.length > maxSampleBytes && sampledFiles.length > 0) {
          break; // Stop if we exceed size limit
        }
        sampledFiles.push([path, data]);
        totalBytes += data.length;
      }

      selectedFiles = sampledFiles;
      isSampled = true;
    }

    // Create extraction directory
    await mkdir(extractDir, { recursive: true });

    // Write files and track nested zip files
    let fileCount = 0;
    const nestedZips = [];

    for (const [filePath, content] of selectedFiles) {
      const fullPath = join(extractDir, filePath);

      // Create directory structure
      await mkdir(dirname(fullPath), { recursive: true });

      // Write file
      await writeFile(fullPath, content);

      // Check if this is a nested zip file
      if (filePath.toLowerCase().endsWith('.zip')) {
        nestedZips.push(fullPath);
      }

      fileCount++;
    }

    // If we found nested zip files, extract them too
    if (nestedZips.length > 0) {
      if (!suppressMessages) {
        console.log(chalk.yellow(`  Found ${nestedZips.length} nested zip file(s), extracting...`));
      }

      for (const nestedZipPath of nestedZips) {
        try {
          const nestedResult = await extractZipToSameDirectory(nestedZipPath, {
            sample,
            samplePercentage,
            maxSampleBytes,
            mergeToDir: extractDir,
            suppressMessages: true
          });

          // Update counts with nested content
          fileCount += nestedResult.sampleCount;
          totalFiles += nestedResult.totalCount;
          if (nestedResult.isSampled) isSampled = true;

          // Remove the nested zip file after extraction
          await rm(nestedZipPath);
        } catch (err) {
          if (!suppressMessages) {
            console.log(chalk.yellow(`    Warning: Could not extract nested zip ${basename(nestedZipPath)}: ${err.message}`));
          }
        }
      }
    }

    if (!suppressMessages) {
      if (isSampled) {
        console.log(chalk.green(`✓ Extracted ${fileCount} of ${totalFiles} files (${Math.round(fileCount / totalFiles * 100)}% sample)\n`));
      } else {
        console.log(chalk.green(`✓ Extraction complete (${fileCount} files)\n`));
      }
    }

    // Check if zip extracted to subdirectories that might contain the actual content
    const entries = await readdir(extractDir);

    // If there's exactly one subdirectory, use it
    if (entries.length === 1) {
      const potentialSubdir = join(extractDir, entries[0]);
      const subdirStat = await stat(potentialSubdir).catch(() => null);
      if (subdirStat?.isDirectory()) {
        if (!suppressMessages) {
          console.log(chalk.gray(`Found subdirectory inside zip: ${entries[0]}`));
          console.log(chalk.gray(`Working directory: ${extractDir}\n`));
        }
        return {
          path: potentialSubdir,
          extractDir, // Return parent for cleanup
          isSampled,
          sampleCount: fileCount,
          totalCount: totalFiles
        };
      }
    }

    // If there are multiple entries, check if any contain markdown files
    if (!suppressMessages && entries.length > 1) {
      let bestSubdir = null;
      let maxMdFiles = 0;

      for (const entry of entries) {
        const entryPath = join(extractDir, entry);
        const entryStat = await stat(entryPath).catch(() => null);
        if (entryStat?.isDirectory()) {
          // Count markdown files in this subdirectory
          const mdGlob = new Glob("**/*.md");
          const mdFiles = [];
          for await (const file of mdGlob.scan({ cwd: entryPath, absolute: false })) {
            mdFiles.push(file);
          }

          if (mdFiles.length > maxMdFiles) {
            maxMdFiles = mdFiles.length;
            bestSubdir = entryPath;
          }
        }
      }

      if (bestSubdir && maxMdFiles > 0) {
        console.log(chalk.gray(`Found ${maxMdFiles} markdown files in subdirectory: ${basename(bestSubdir)}`));
        console.log(chalk.gray(`Working directory: ${extractDir}\n`));
        return {
          path: bestSubdir,
          extractDir, // Return parent for cleanup
          isSampled,
          sampleCount: fileCount,
          totalCount: totalFiles
        };
      }
    }

    return { path: extractDir, extractDir, isSampled, sampleCount: fileCount, totalCount: totalFiles };
  } catch (err) {
    // Clean up on error
    await rm(extractDir, { recursive: true, force: true });
    throw err;
  }
}

async function extractMultipleZips(zipPaths, options = {}) {
  const { sample = false, outputDir = null } = options;

  // Always use a temporary processing directory when outputDir is specified
  let processingDir;
  let isUsingCustomOutput = false;

  if (outputDir) {
    // Use system temp directory for processing to avoid nesting in user's output
    const timestamp = Date.now().toString(36);
    processingDir = join(homedir(), '.cache', `notion2obsidian-${timestamp}`);
    isUsingCustomOutput = true;
  } else {
    // No custom output - use original behavior (extract next to zip files)
    const firstZipDir = dirname(zipPaths[0]);
    const timestamp = Date.now().toString(36);
    processingDir = join(firstZipDir, `notion-export-merged-${timestamp}`);
  }

  const mergeDir = processingDir;

  console.log(chalk.cyan.bold(`📦 Extracting ${zipPaths.length} zip files to unified directory...`));
  console.log(chalk.gray(`Merge directory: ${mergeDir}`));
  console.log(chalk.gray(`Note: Will automatically extract any nested zip files found\n`));

  // Create the merge directory
  await mkdir(mergeDir, { recursive: true });

  let totalExtractedFiles = 0;
  let totalOriginalFiles = 0;
  let anySampled = false;
  const duplicateFiles = new Set();

  try {
    for (let i = 0; i < zipPaths.length; i++) {
      const zipPath = zipPaths[i];
      const zipName = basename(zipPath);
      const shortName = shortenFilename(zipName, 50); // More generous for zip files

      console.log(chalk.blue(`[${i + 1}/${zipPaths.length}] ${shortName}`));

      const result = await extractZipToSameDirectory(zipPath, {
        ...options,
        mergeToDir: mergeDir,
        suppressMessages: true  // Suppress individual zip messages
      });

      totalExtractedFiles += result.sampleCount;
      totalOriginalFiles += result.totalCount;
      if (result.isSampled) anySampled = true;
    }

    console.log(chalk.green.bold(`✓ Extracted ${zipPaths.length} zip files successfully!`));
    if (anySampled) {
      console.log(chalk.yellow(`  Sample mode: ${totalExtractedFiles} of ${totalOriginalFiles} total files (${Math.round(totalExtractedFiles / totalOriginalFiles * 100)}% preview)`));
    } else {
      console.log(chalk.green(`  Total files: ${totalExtractedFiles}`));
    }
    console.log();
    console.log();

    // Check if merge directory has subdirectories that might contain the actual content
    const entries = await readdir(mergeDir);
    let contentPath = mergeDir;

    // If there's exactly one subdirectory, use it
    if (entries.length === 1) {
      const potentialSubdir = join(mergeDir, entries[0]);
      const subdirStat = await stat(potentialSubdir).catch(() => null);
      if (subdirStat?.isDirectory()) {
        console.log(chalk.gray(`Found content in subdirectory: ${entries[0]}`));
        contentPath = potentialSubdir;
      }
    } else {
      // If there are multiple entries, check if any contain markdown files
      let bestSubdir = null;
      let maxMdFiles = 0;

      for (const entry of entries) {
        const entryPath = join(mergeDir, entry);
        const entryStat = await stat(entryPath).catch(() => null);
        if (entryStat?.isDirectory()) {
          // Count markdown files in this subdirectory
          const mdGlob = new Glob("**/*.md");
          const mdFiles = [];
          for await (const file of mdGlob.scan({ cwd: entryPath, absolute: false })) {
            mdFiles.push(file);
          }

          if (mdFiles.length > maxMdFiles) {
            maxMdFiles = mdFiles.length;
            bestSubdir = entryPath;
          }
        }
      }

      if (bestSubdir && maxMdFiles > 0) {
        console.log(chalk.gray(`Found ${maxMdFiles} markdown files in subdirectory: ${basename(bestSubdir)}`));
        contentPath = bestSubdir;
      }
    }

    // If using custom output directory, move content there
    if (isUsingCustomOutput && outputDir) {
      console.log(chalk.cyan('📋 Moving content to output directory...'));

      // Ensure output directory exists
      await mkdir(outputDir, { recursive: true });

      // Move all content from processing directory to output directory
      const contentEntries = await readdir(contentPath);
      for (const entry of contentEntries) {
        const sourcePath = join(contentPath, entry);
        const targetPath = join(outputDir, entry);

        // If target exists, we need to handle it gracefully
        try {
          await stat(targetPath);
          // Target exists, remove it first
          await rm(targetPath, { recursive: true, force: true });
        } catch {
          // Target doesn't exist, which is fine
        }

        await rename(sourcePath, targetPath);
      }

      console.log(chalk.green('✓ Content moved to output directory'));

      return {
        path: outputDir,
        extractDir: mergeDir,
        isSampled: anySampled,
        sampleCount: totalExtractedFiles,
        totalCount: totalOriginalFiles
      };
    }

    // No custom output - return the content path as-is
    return {
      path: contentPath,
      extractDir: mergeDir,
      isSampled: anySampled,
      sampleCount: totalExtractedFiles,
      totalCount: totalOriginalFiles
    };

  } catch (err) {
    // Clean up on error
    await rm(mergeDir, { recursive: true, force: true });
    throw err;
  }
}


async function openDirectory(dirPath) {
  const fullPath = resolve(dirPath);

  console.log(chalk.cyan.bold('\n🎉 Migration Complete!'));
  console.log(`Directory: ${chalk.blue(fullPath)}`);
  console.log(chalk.gray('\nYour Notion export is now ready for Obsidian!'));

  try {
    // Detect platform and use appropriate open command
    const platform = process.platform;
    let openCommand;

    if (platform === 'darwin') {
      openCommand = 'open';
    } else if (platform === 'win32') {
      openCommand = 'start';
    } else {
      openCommand = 'xdg-open';
    }

    spawn(openCommand, [fullPath], { detached: true, stdio: 'ignore' });

    console.log(chalk.green('✓ Opening directory...'));
  } catch (err) {
    console.log(chalk.yellow(`Could not open directory automatically.`));
  }

  console.log();
}

// ============================================================================
// User Confirmation
// ============================================================================

async function promptForConfirmation(dryRun) {
  if (dryRun) {
    console.log(chalk.yellow.bold('\n🔍 DRY RUN MODE - No changes will be made\n'));
    return;
  }

  console.log(chalk.yellow('\nPress ENTER to proceed with the migration, or Ctrl+C/ESC to cancel...'));

  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();

  // Check if ESC key was pressed (ASCII 27 or sequence starting with \x1b)
  if (value && value.length > 0) {
    // ESC key sends ASCII 27 (0x1B) or escape sequences starting with it
    if (value[0] === 27 || (value.length >= 3 && value[0] === 0x1B)) {
      console.log(chalk.red('\n✖ Migration cancelled'));
      process.exit(0);
    }
  }
}

// ============================================================================
// Main Migration Logic
// ============================================================================

async function main() {
  const { Glob } = await import('bun');
  const config = parseArgs();
  const stats = new MigrationStats();
  let extractedTempDir = null;

  // Show header
  console.log(chalk.blueBright.bold('💎 Notion 2 Obsidian') + ' ' + chalk.gray(`v${getVersion()}`) + '\n');

  // Resolve glob patterns and validate paths
  console.log(chalk.cyan('🔍 Resolving input paths...'));
  const { resolvedPaths, errors } = await resolveGlobPatterns(config.targetPaths);

  if (errors.length > 0) {
    console.log(chalk.red('❌ Errors resolving paths:'));
    errors.forEach(error => console.log(chalk.red(`  ${error}`)));
    process.exit(1);
  }

  if (resolvedPaths.length === 0) {
    console.log(chalk.red('❌ No valid paths found'));
    process.exit(1);
  }

  // Separate zip files from directories
  const zipFiles = [];
  const directories = [];

  for (const path of resolvedPaths) {
    const pathStat = await stat(path);
    if (pathStat.isFile() && path.toLowerCase().endsWith('.zip')) {
      zipFiles.push(path);
    } else if (pathStat.isDirectory()) {
      directories.push(path);
    } else {
      console.log(chalk.yellow(`⚠ Skipping: ${path} (not a zip file or directory)`));
    }
  }

  let targetDir;

  // Handle zip files
  if (zipFiles.length > 0) {
    console.log(chalk.blue(`Found ${zipFiles.length} zip file(s) to process`));
    console.log();

    try {
      const result = await extractMultipleZips(zipFiles, {
        sample: config.dryRun,
        samplePercentage: 0.10,
        maxSampleBytes: 10_000_000,
        outputDir: config.outputDir
      });

      extractedTempDir = result.extractDir;
      targetDir = result.path;
      config.zipSampleInfo = result.isSampled ? {
        sampled: result.sampleCount,
        total: result.totalCount
      } : null;
    } catch (err) {
      console.log(chalk.red(`Error extracting zip files: ${err.message}`));
      process.exit(1);
    }
  } else if (directories.length === 1) {
    // Single directory
    targetDir = directories[0];

    // Check write permissions
    try {
      await access(targetDir, constants.W_OK);
    } catch {
      console.log(chalk.red(`Error: No write permission for directory ${targetDir}`));
      process.exit(1);
    }

    // Test actual write capability
    const testFile = join(targetDir, `.notion2obsidian-test-${Date.now()}`);
    try {
      await writeFile(testFile, 'test');
      await rm(testFile);
    } catch (err) {
      console.log(chalk.red(`Error: Cannot write to directory: ${err.message}`));
      process.exit(1);
    }

    // Confirm if using current directory without explicit argument
    if (!config.pathsExplicitlyProvided) {
      const cwd = process.cwd();
      console.log(chalk.yellow('⚠ No directory specified. This will run on the current directory:'));
      console.log(chalk.blue(`  ${cwd}\n`));
      console.log(chalk.yellow('Press ENTER to continue, or Ctrl+C to cancel...'));

      const reader = Bun.stdin.stream().getReader();
      await reader.read();
      reader.releaseLock();
      console.log();
    }
  } else if (directories.length > 1) {
    console.log(chalk.red('❌ Multiple directories not supported. Please specify zip files or a single directory.'));
    process.exit(1);
  } else {
    console.log(chalk.red('❌ No valid input paths found'));
    process.exit(1);
  }

  console.log(chalk.blueBright.bold('💎 Notion 2 Obsidian') + ' ' + chalk.gray(`v${getVersion()}`));
  console.log(`Directory: ${chalk.blue(targetDir)}`);
  if (config.dryRun) {
    console.log(chalk.yellow.bold('Mode: DRY RUN (no changes will be made)'));
  }
  console.log();

  console.log(chalk.yellow('Phase 1: Analyzing files and building migration map...\n'));

  // Debug: Show what's actually in the target directory
  if (config.verbose || zipFiles.length > 0) {
    console.log(chalk.cyan('🔍 Directory structure analysis:'));
    try {
      const entries = await readdir(targetDir);
      console.log(chalk.gray(`  Target directory contains ${entries.length} items:`));
      for (const entry of entries.slice(0, 10)) { // Show first 10 items
        const entryPath = join(targetDir, entry);
        const entryStat = await stat(entryPath).catch(() => null);
        if (entryStat) {
          const type = entryStat.isDirectory() ? '📁' : '📄';
          console.log(chalk.gray(`    ${type} ${entry}`));
        }
      }
      if (entries.length > 10) {
        console.log(chalk.gray(`    ... and ${entries.length - 10} more items`));
      }
      console.log();
    } catch (err) {
      console.log(chalk.red(`  Error reading directory: ${err.message}\n`));
    }
  }

  // Scan for all files (excluding backups)
  const glob = new Glob("**/*.md");
  const files = [];

  for await (const file of glob.scan({
    cwd: targetDir,
    absolute: true,
    dot: false
  })) {
    // Skip backup files from previous runs
    if (!file.endsWith('.backup')) {
      files.push(file);
    }
  }

  // Scan for all directories
  const dirs = await getAllDirectories(targetDir);

  stats.totalFiles = files.length;

  console.log(`Found ${chalk.blue(files.length)} markdown files`);
  console.log(`Found ${chalk.blue(dirs.length)} directories`);

  // Show sample info if applicable
  if (config.zipSampleInfo) {
    console.log(chalk.yellow(`⚠ Dry-run preview based on ${config.zipSampleInfo.sampled} of ${config.zipSampleInfo.total} files from zip`));
  }
  console.log();

  // Check if any files were found
  if (files.length === 0) {
    console.log(chalk.yellow('⚠ No markdown files found in this directory.'));
    console.log(chalk.gray('Make sure you\'re running this in a Notion export directory.\n'));
    process.exit(0);
  }

  // Validate that this looks like a Notion export
  const notionFiles = files.filter(f => extractNotionId(basename(f)) !== null);
  if (notionFiles.length === 0 && files.length > 0) {
    console.log(chalk.yellow('⚠ Warning: No Notion ID patterns detected in filenames.'));
    console.log(chalk.gray('This directory may not be a Notion export.'));
    console.log(chalk.gray('Expected filenames like: "Document abc123def456...xyz.md"\n'));
    console.log(chalk.yellow('Continue anyway? Press ENTER to proceed, or Ctrl+C to cancel...'));

    const reader = Bun.stdin.stream().getReader();
    await reader.read();
    reader.releaseLock();
    console.log();
  }

  // Check for duplicates
  const duplicates = await findDuplicateNames(files);
  stats.duplicates = duplicates.size;

  if (duplicates.size > 0) {
    console.log(chalk.yellow(`⚠ Warning: ${duplicates.size} duplicate filenames found`));
    console.log(chalk.gray('These will be disambiguated using folder paths in frontmatter.\n'));
  }

  // Build file map for link resolution
  const fileMap = buildFileMap(files, targetDir);

  // Build migration maps
  const fileMigrationMap = [];
  const dirMigrationMap = [];

  // Process files metadata
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const filename = basename(filePath);
    const cleanedName = cleanName(filename);
    const notionId = extractNotionId(filename);

    const tags = getTagsFromPath(filePath, targetDir);

    // Build aliases
    const aliases = [];
    if (filename !== cleanedName) {
      aliases.push(filename.replace('.md', ''));
    }

    const metadata = {
      title: cleanedName.replace('.md', ''),
      tags: tags,
      aliases: aliases,
      notionId: notionId
    };

    fileMigrationMap.push({
      oldPath: filePath,
      newPath: join(dirname(filePath), cleanedName),
      oldName: filename,
      newName: cleanedName,
      metadata: metadata,
      needsRename: filename !== cleanedName
    });
  }

  // Process directories
  for (const dirPath of dirs) {
    const dirName = basename(dirPath);
    const cleanedDirName = cleanDirName(dirName);

    if (dirName !== cleanedDirName) {
      dirMigrationMap.push({
        oldPath: dirPath,
        newPath: join(dirname(dirPath), cleanedDirName),
        oldName: dirName,
        newName: cleanedDirName,
        depth: dirPath.split(sep).length
      });
    }
  }

  // Sort directories by depth (deepest first)
  dirMigrationMap.sort((a, b) => b.depth - a.depth);

  // Show preview
  console.log(chalk.cyan.bold('\n═══ MIGRATION PREVIEW ═══\n'));

  // Show sample file changes
  const filesToRename = fileMigrationMap.filter(f => f.needsRename);
  console.log(chalk.green(`Files to rename: ${filesToRename.length}`));

  if (filesToRename.length > 0) {
    console.log(chalk.gray('\nSample:'));
    const file = filesToRename[0];
    console.log(`  ${chalk.red('−')} ${file.oldName}`);
    console.log(`  ${chalk.green('+')} ${file.newName}\n`);
  }

  // Show directory renames
  if (dirMigrationMap.length > 0) {
    console.log(chalk.green(`Directories to rename: ${dirMigrationMap.length}`));
    console.log(chalk.gray('\nSample:'));
    const dir = dirMigrationMap[0];
    console.log(`  ${chalk.red('−')} ${dir.oldName}`);
    console.log(`  ${chalk.green('+')} ${dir.newName}\n`);
  }

  // Show duplicate handling
  if (duplicates.size > 0) {
    console.log(chalk.yellow('Duplicate handling:'));
    let shown = 0;
    for (const [name, paths] of duplicates.entries()) {
      if (shown++ >= 3) break;
      console.log(chalk.gray(`  "${name}" will be disambiguated by folder path in frontmatter`));
    }
    console.log();
  }

  // Show sample frontmatter
  console.log(chalk.cyan('Sample frontmatter:'));
  if (fileMigrationMap.length > 0) {
    const sample = fileMigrationMap[0];
    console.log(`\nFor file: ${chalk.blue(sample.newName)}\n`);
    const relativePath = relative(targetDir, dirname(sample.oldPath));
    console.log(chalk.gray(generateValidFrontmatter(sample.metadata, relativePath)));
  }

  // Build directory name mapping for asset path updates
  const dirNameMap = new Map();
  for (const dir of dirMigrationMap) {
    dirNameMap.set(dir.oldName, dir.newName);
  }

  // Calculate link count estimate
  let estimatedLinkCount = 0;
  const sampleSize = Math.min(10, fileMigrationMap.length);
  for (let i = 0; i < sampleSize; i++) {
    const sample = fileMigrationMap[i];
    const { linkCount } = await processFileContent(sample.oldPath, sample.metadata, fileMap, targetDir, dirNameMap);
    estimatedLinkCount += linkCount;
  }
  const avgLinksPerFile = sampleSize > 0 ? estimatedLinkCount / sampleSize : 0;
  const totalEstimatedLinks = Math.round(avgLinksPerFile * fileMigrationMap.length);

  console.log(chalk.yellow.bold('\n═══ SUMMARY ═══'));
  console.log(`  📄 Add frontmatter to ${chalk.blue(fileMigrationMap.length)} files`);
  console.log(`  🔗 Convert ~${chalk.blue(totalEstimatedLinks)} markdown links to wiki links`);
  console.log(`  📋 Handle ${chalk.blue(duplicates.size)} duplicate filenames with folder context`);
  console.log(`  ✏️  Rename ${chalk.blue(filesToRename.length)} files`);
  console.log(`  📁 Rename ${chalk.blue(dirMigrationMap.length)} directories`);

  // Wait for confirmation
  await promptForConfirmation(config.dryRun);

  if (config.dryRun) {
    console.log(chalk.green.bold('\n✅ Dry run complete! No changes were made.'));
    console.log(chalk.gray('Run without --dry-run to apply changes.'));
    console.log(chalk.yellow('\n💡 Scroll up to review the migration preview and sample frontmatter.'));

    // Handle temp directory cleanup if zip was extracted
    if (extractedTempDir) {
      await rm(extractedTempDir, { recursive: true, force: true });
      console.log(chalk.gray('\nTemporary extracted files removed.'));
    }
    return;
  }

  console.log(chalk.yellow.bold('\nPhase 2: Executing migration...\n'));

  // Start timer
  const migrationStartTime = Date.now();

  // Step 1: Add frontmatter and convert links
  console.log(chalk.green('Step 1: Adding frontmatter and converting links...'));

  // Process files in batches
  for (let i = 0; i < fileMigrationMap.length; i += BATCH_SIZE) {
    const batch = fileMigrationMap.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(file =>
        updateFileContent(file.oldPath, file.metadata, fileMap, targetDir, dirNameMap)
      )
    );

    results.forEach((result, idx) => {
      if (result.success) {
        stats.processedFiles++;
        stats.totalLinks += result.linkCount;
        stats.calloutsConverted += result.calloutsConverted || 0;
      } else {
        stats.addNamingConflict(batch[idx].oldPath, result.error);
      }
    });
  }

  console.log(`  ${chalk.green('✓')} Processed ${stats.processedFiles} files, converted ${stats.totalLinks} links\n`);

  // Step 2: Organize attachments (before renaming, while names still match!)
  console.log(chalk.green('Step 2: Organizing files with attachments...'));

  let movedFiles = 0;
  const filesMovedIntoFolders = new Set(); // Track which files were moved

  for (const file of fileMigrationMap) {
    const mdFile = file.oldPath; // Use original path (still has Notion ID)
    const mdFileBase = basename(mdFile, '.md');
    const mdFileDir = dirname(mdFile);
    const potentialAttachmentFolder = join(mdFileDir, mdFileBase);

    try {
      // Check if there's a folder with the same name as the .md file (both have Notion IDs)
      const folderStats = await stat(potentialAttachmentFolder).catch(() => null);

      if (folderStats && folderStats.isDirectory()) {
        // Move the .md file into its attachment folder AND rename it (remove Notion ID)
        const newMdPath = join(potentialAttachmentFolder, file.newName);
        await rename(mdFile, newMdPath);
        movedFiles++;
        if (file.needsRename) {
          stats.renamedFiles++; // Count file renames
        }
        filesMovedIntoFolders.add(file.oldPath);

        // Update file paths in the migration map
        file.oldPath = newMdPath;
        file.newPath = newMdPath; // Already at final name

        // Normalize and rename image files in the attachment folder
        const filesInFolder = await readdir(potentialAttachmentFolder);

        // Common image extensions
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'];

        // Build map of normalized name → original name for images
        const imageMap = new Map();

        for (const fileName of filesInFolder) {
          const ext = extname(fileName).toLowerCase();
          if (imageExtensions.includes(ext)) {
            // Normalize: spaces → hyphens, lowercase
            const nameWithoutExt = basename(fileName, extname(fileName));
            const normalizedName = nameWithoutExt
              .replace(/\s+/g, '-')
              .toLowerCase() + ext;

            // Only rename if needed
            if (fileName !== normalizedName) {
              const originalPath = join(potentialAttachmentFolder, fileName);
              const normalizedPath = join(potentialAttachmentFolder, normalizedName);

              // Check if normalized path already exists
              if (await stat(normalizedPath).catch(() => false)) {
                // Add counter to avoid collision
                let counter = 1;
                let altName = `${basename(normalizedName, ext)}-${counter}${ext}`;
                while (await stat(join(potentialAttachmentFolder, altName)).catch(() => false)) {
                  counter++;
                  altName = `${basename(normalizedName, ext)}-${counter}${ext}`;
                }
                await rename(originalPath, join(potentialAttachmentFolder, altName));
                imageMap.set(fileName, altName);
              } else {
                await rename(originalPath, normalizedPath);
                imageMap.set(fileName, normalizedName);
              }
            }
          }
        }

        // Update image references in the MD file
        let content = await Bun.file(newMdPath).text();

        // Replace image references
        content = content.replace(
          /(!?\[[^\]]*\]\()([^)]+)(\))/g,
          (match, prefix, path, suffix) => {
            // Skip external URLs
            if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('mailto:')) {
              return match;
            }
            // Skip wiki links
            if (match.startsWith('[[')) {
              return match;
            }

            // Decode URL-encoded paths and get just the filename
            const decodedPath = decodeURIComponent(path);
            const fileName = basename(decodedPath);

            // Check if this image was renamed
            if (imageMap.has(fileName)) {
              return `${prefix}${imageMap.get(fileName)}${suffix}`;
            }

            // Otherwise, check if it's an image in our folder - just use the filename
            const ext = extname(fileName).toLowerCase();
            if (imageExtensions.includes(ext)) {
              // Normalize the filename reference
              const nameWithoutExt = basename(fileName, extname(fileName));
              const normalizedFileName = nameWithoutExt
                .replace(/\s+/g, '-')
                .toLowerCase() + ext;
              return `${prefix}${normalizedFileName}${suffix}`;
            }

            return match;
          }
        );

        await Bun.write(newMdPath, content);
      }
    } catch (err) {
      stats.addNamingConflict(file.oldPath, `Error organizing attachments: ${err.message}`);
    }
  }

  console.log(`  ${chalk.green('✓')} Moved ${movedFiles} files into their attachment folders\n`);

  // Step 3: Rename directories (deepest first to avoid path conflicts)
  console.log(chalk.green('Step 3: Renaming directories...'));

  for (let i = 0; i < dirMigrationMap.length; i++) {
    const dir = dirMigrationMap[i];
    try {
      // Check if target already exists
      if (await stat(dir.newPath).catch(() => false)) {
        // Directory exists - create alternative name
        const dirName = basename(dir.newPath);
        const parentDir = dirname(dir.newPath);
        let counter = 1;
        let alternativePath = join(parentDir, `${dirName}-${counter}`);
        while (await stat(alternativePath).catch(() => false)) {
          counter++;
          alternativePath = join(parentDir, `${dirName}-${counter}`);
        }
        await rename(dir.oldPath, alternativePath);
        // Update the actual final path in the map
        dir.actualNewPath = alternativePath;
        stats.addNamingConflict(dir.oldPath, `Target exists, renamed to ${basename(alternativePath)}`);
        stats.renamedDirs++;
      } else {
        await rename(dir.oldPath, dir.newPath);
        // Track the actual final path
        dir.actualNewPath = dir.newPath;
        stats.renamedDirs++;
      }
    } catch (err) {
      stats.addNamingConflict(dir.oldPath, err.message);
    }
  }

  console.log(`  ${chalk.green('✓')} Renamed ${stats.renamedDirs} directories\n`);

  // Update file paths in fileMigrationMap to reflect renamed directories
  // Process directories from deepest to shallowest to handle nested renames correctly
  for (const file of fileMigrationMap) {
    let originalPath = file.oldPath;
    for (const dir of dirMigrationMap) {
      if (file.oldPath.startsWith(dir.oldPath + '/') && dir.actualNewPath) {
        file.oldPath = file.oldPath.replace(dir.oldPath, dir.actualNewPath);
        // Don't break - a file might be affected by multiple directory renames
      }
    }
    // Debug logging for problematic files
    if (originalPath !== file.oldPath && config.verbose) {
      console.log(`    Updated file path: ${originalPath} → ${file.oldPath}`);
    }
  }

  // Step 4: Rename individual files that weren't moved to attachment folders
  console.log(chalk.green('Step 4: Renaming individual files...'));

  for (const file of fileMigrationMap) {
    // Skip files that were already moved into attachment folders
    if (filesMovedIntoFolders.has(file.oldPath)) {
      continue;
    }

    // Skip files that don't need renaming
    if (!file.needsRename) {
      continue;
    }

    try {
      const oldPath = file.oldPath;
      const newPath = join(dirname(oldPath), file.newName);

      // Check if target already exists
      const targetStat = await stat(newPath).catch(() => null);
      if (targetStat) {
        const baseName = basename(file.newName, extname(file.newName));
        const extension = extname(file.newName);
        const dir = dirname(oldPath);
        let alternativeName;
        let alternativePath;

        if (targetStat.isDirectory()) {
          // Directory exists with same name - add " Overview" suffix
          alternativeName = `${baseName} Overview${extension}`;
          alternativePath = join(dir, alternativeName);

          // If "Overview" also exists, fall back to counter
          if ((await stat(alternativePath).catch(() => null))) {
            let counter = 1;
            alternativeName = `${baseName}-${counter}${extension}`;
            alternativePath = join(dir, alternativeName);

            while ((await stat(alternativePath).catch(() => null))) {
              counter++;
              alternativeName = `${baseName}-${counter}${extension}`;
              alternativePath = join(dir, alternativeName);
            }
          }
        } else {
          // File exists - create alternative name with counter
          let counter = 1;
          alternativeName = `${baseName}-${counter}${extension}`;
          alternativePath = join(dir, alternativeName);

          while ((await stat(alternativePath).catch(() => null))?.isFile()) {
            counter++;
            alternativeName = `${baseName}-${counter}${extension}`;
            alternativePath = join(dir, alternativeName);
          }
        }

        await rename(oldPath, alternativePath);
        stats.addNamingConflict(oldPath, `Target exists, renamed to ${alternativeName}`);
        stats.renamedFiles++;
      } else {
        await rename(oldPath, newPath);
        stats.renamedFiles++;
      }
    } catch (error) {
      console.warn(chalk.yellow(`    ⚠ Failed to rename ${file.oldPath}: ${error.message}`));
    }
  }

  console.log(`  ${chalk.green('✓')} Renamed ${stats.renamedFiles} individual files\n`);

  // Step 5: Normalize all images and references
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'];

  // Step 5a: Normalize ALL image files in ALL directories
  console.log(chalk.green('Step 5a: Normalizing all image files...'));

  let normalizedImages = 0;

  // Get all directories
  const allDirs = [targetDir];
  const dirGlob = new Glob('**/', { onlyFiles: false });
  for (const dir of dirGlob.scanSync(targetDir)) {
    allDirs.push(join(targetDir, dir));
  }

  // Normalize images in each directory
  for (const dir of allDirs) {
    try {
      const filesInDir = await readdir(dir);

      for (const fileName of filesInDir) {
        const ext = extname(fileName).toLowerCase();
        if (imageExtensions.includes(ext)) {
          const nameWithoutExt = basename(fileName, extname(fileName));
          const normalizedName = nameWithoutExt
            .replace(/\s+/g, '-')
            .toLowerCase() + ext;

          if (fileName !== normalizedName) {
            const originalPath = join(dir, fileName);
            const normalizedPath = join(dir, normalizedName);

            // Check if normalized path already exists
            if (await stat(normalizedPath).catch(() => false)) {
              let counter = 1;
              let altName = `${basename(normalizedName, ext)}-${counter}${ext}`;
              while (await stat(join(dir, altName)).catch(() => false)) {
                counter++;
                altName = `${basename(normalizedName, ext)}-${counter}${ext}`;
              }
              await rename(originalPath, join(dir, altName));
              normalizedImages++;
            } else {
              await rename(originalPath, normalizedPath);
              normalizedImages++;
            }
          }
        }
      }
    } catch (err) {
      // Skip if can't read directory
    }
  }

  console.log(`  ${chalk.green('✓')} Normalized ${normalizedImages} image files\n`);

  // Step 5b: Update all image references using remark (proper markdown parsing)
  console.log(chalk.green('Step 5b: Normalizing all image references...'));

  const { unified } = await import('unified');
  const { remark } = await import('remark');
  const remarkFrontmatter = await import('remark-frontmatter');
  const { visit } = await import('unist-util-visit');

  // Build a map of old folder names → new folder names (without Notion IDs)
  const folderNameMap = new Map();
  for (const dir of dirMigrationMap) {
    const oldName = basename(dir.oldPath);
    const newName = basename(dir.newPath);
    folderNameMap.set(oldName, newName);
  }

  // Build a comprehensive map of actual files in each directory
  const filesByDir = new Map();
  for (const dir of allDirs) {
    try {
      const filesInDir = await readdir(dir);
      filesByDir.set(dir, filesInDir);
    } catch (err) {
      // Skip if can't read
    }
  }

  let updatedReferences = 0;

  // Process all MD files
  const mdGlob = new Glob('**/*.md');
  const allMdFiles = Array.from(mdGlob.scanSync(targetDir));

  for (const mdFile of allMdFiles) {
    const mdPath = join(targetDir, mdFile);
    const mdDir = dirname(mdPath);
    const content = await Bun.file(mdPath).text();

    // Track modifications
    let hasChanges = false;

    // Parse markdown to AST and transform
    const processor = remark()
      .use(remarkFrontmatter.default, ['yaml'])
      .use(() => (tree) => {
        visit(tree, 'image', (node) => {
          const url = node.url;

          // Skip external URLs
          if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
            return;
          }

          // Decode URL-encoded path
          const decodedUrl = decodeURIComponent(url);
          const pathParts = decodedUrl.split('/');

          // Build absolute path to the referenced file
          const imagePath = join(mdDir, decodedUrl);
          const imageDir = dirname(imagePath);
          const fileName = pathParts[pathParts.length - 1];

          // Get actual files in that directory
          const actualFiles = filesByDir.get(imageDir) || [];

          // Try to find the actual file (case-insensitive, with/without extension)
          const nameWithoutExt = basename(fileName, extname(fileName));
          const normalizedBaseName = nameWithoutExt.replace(/\s+/g, '-').toLowerCase();

          let matchedFile = null;

          // First try: exact match with extension
          const ext = extname(fileName).toLowerCase();
          if (ext) {
            const expectedName = normalizedBaseName + ext;
            matchedFile = actualFiles.find(f => f.toLowerCase() === expectedName);
          }

          // Second try: find any file with matching base name (any extension)
          if (!matchedFile) {
            matchedFile = actualFiles.find(f => {
              const fBase = basename(f, extname(f)).toLowerCase();
              return fBase === normalizedBaseName;
            });
          }

          if (matchedFile) {
            // Update folder paths to remove Notion IDs
            const updatedPathParts = pathParts.slice(0, -1).map(part => {
              return folderNameMap.get(part) || part;
            });

            // Rebuild path with actual filename
            updatedPathParts.push(matchedFile);
            const newUrl = updatedPathParts.join('/');

            if (newUrl !== url) {
              node.url = newUrl;
              hasChanges = true;
              updatedReferences++;
            }
          }
        });
      });

    // Always process to run the transformations
    const result = await processor.process(content);
    let newContent = String(result);

    // Fix callout syntax and wiki links that get escaped by remark
    newContent = newContent.replace(/\\(\[![\w-]+\])/g, '$1'); // Fix callout brackets
    newContent = newContent.replace(/\\(\[)/g, '$1'); // Fix any escaped opening bracket
    newContent = newContent.replace(/\\(\])/g, '$1'); // Fix any escaped closing bracket
    newContent = newContent.replace(/\\(\()/g, '$1'); // Fix any escaped opening parenthesis
    newContent = newContent.replace(/\\(\))/g, '$1'); // Fix any escaped closing parenthesis
    newContent = newContent.replace(/\\(~)/g, '$1'); // Fix any escaped tildes (strikethrough)

    // Only write if content actually changed
    if (newContent !== content) {
      await Bun.write(mdPath, newContent);
    }
  }

  console.log(`  ${chalk.green('✓')} Normalized ${updatedReferences} image references\n`);

  // Step 6: Process CSV databases if enabled
  if (config.processCsv) {
    console.log(chalk.green(config.dataviewMode ?
      'Step 6: Processing CSV databases with Dataview support...' :
      'Step 6: Processing CSV databases...'));

    const csvFiles = await processCsvDatabases(targetDir);
    let csvIndexesCreated = 0;
    let totalNotesCreated = 0;

    // Create _databases folder if in Dataview mode
    let databasesDir = null;
    if (config.dataviewMode && csvFiles.length > 0) {
      databasesDir = join(targetDir, '_databases');
      await mkdir(databasesDir, { recursive: true });
    }

    for (const csvInfo of csvFiles) {
      try {
        if (config.dataviewMode) {
          // Dataview mode: Copy CSV to _databases folder and create individual notes
          const csvDestPath = join(databasesDir, csvInfo.fileName + '.csv');
          await copyFile(csvInfo.path, csvDestPath);

          // Create individual notes from CSV rows
          const createdNotes = await createNotesFromCsvRows(csvInfo, targetDir, databasesDir);
          totalNotesCreated += createdNotes.length;

          // Generate Dataview index
          const indexMarkdown = generateDataviewIndex(csvInfo, targetDir, createdNotes);
          const indexPath = join(targetDir, `${csvInfo.databaseName}_Index.md`);
          await Bun.write(indexPath, indexMarkdown);

          if (config.verbose) {
            console.log(`    ✓ Created ${createdNotes.length} notes and Dataview index for ${csvInfo.databaseName}`);
          }
        } else {
          // Traditional mode: Create static table index
          const baseDir = dirname(csvInfo.path);
          const dbDir = join(baseDir, csvInfo.databaseName);

          // Move individual MD files to _data subfolder if database directory exists
          try {
            const dirStat = statSync(dbDir);

            if (dirStat.isDirectory()) {
              const dataDir = join(dbDir, '_data');
              await mkdir(dataDir, { recursive: true });

              // Move all .md files from database directory to _data
              const files = readdirSync(dbDir);
              for (const file of files) {
                if (file.endsWith('.md')) {
                  const sourcePath = join(dbDir, file);
                  const destPath = join(dataDir, file);
                  await rename(sourcePath, destPath);
                }
              }

              if (config.verbose) {
                console.log(`    ✓ Moved ${files.filter(f => f.endsWith('.md')).length} MD files to ${csvInfo.databaseName}/_data/`);
              }
            }
          } catch (error) {
            // Directory doesn't exist, skip
          }

          // Keep only _all.csv and rename to {databaseName}.csv
          const currentFileName = basename(csvInfo.path);
          const finalCsvPath = join(baseDir, `${csvInfo.databaseName}.csv`);
          let csvToUse = csvInfo.path;

          // Check if current file ends with _all.csv
          if (currentFileName.endsWith('_all.csv')) {
            // Current file is the _all version, use it
            csvToUse = csvInfo.path;

            // Check if there's also a non-_all version to remove
            const nonAllPath = csvInfo.path.replace(/_all\.csv$/, '.csv');
            if (nonAllPath !== csvInfo.path) {
              try {
                await rm(nonAllPath).catch(() => {});
              } catch (e) { /* ignore */ }
            }
          } else {
            // Current file is NOT _all, check if _all version exists
            const allCsvPath = csvInfo.path.replace(/\.csv$/, '_all.csv');

            try {
              statSync(allCsvPath);
              // _all version exists, use it instead
              csvToUse = allCsvPath;

              // Remove the non-_all version
              try {
                await rm(csvInfo.path).catch(() => {});
              } catch (e) { /* ignore */ }
            } catch (error) {
              // _all doesn't exist, use current file
              csvToUse = csvInfo.path;
            }
          }

          // Rename to final destination
          if (csvToUse !== finalCsvPath) {
            try {
              // Check if source file exists before renaming
              statSync(csvToUse);
              await rename(csvToUse, finalCsvPath);
            } catch (error) {
              // If file doesn't exist, it was likely already processed - skip silently
              if (error.code === 'ENOENT') {
                continue;
              }
              // For other errors, log warning
              console.warn(chalk.yellow(`    ⚠ Could not rename ${basename(csvToUse)}: ${error.message}`));
              continue; // Skip to next CSV file
            }
          }

          const indexMarkdown = generateDatabaseIndex(csvInfo, targetDir);
          const indexPath = join(baseDir, `${csvInfo.databaseName}_Index.md`);
          await Bun.write(indexPath, indexMarkdown);

          if (config.verbose) {
            console.log(`    ✓ Created index for ${csvInfo.databaseName} (${csvInfo.rows.length} records)`);
          }
        }

        csvIndexesCreated++;
      } catch (error) {
        console.warn(chalk.yellow(`    ⚠ Failed to process ${csvInfo.databaseName}: ${error.message}`));
      }
    }

    stats.csvFilesProcessed = csvFiles.length;
    stats.csvIndexesCreated = csvIndexesCreated;

    if (config.dataviewMode && totalNotesCreated > 0) {
      stats.csvNotesCreated = totalNotesCreated;
      console.log(`  ${chalk.green('✓')} Processed ${csvFiles.length} CSV files, created ${totalNotesCreated} individual notes and ${csvIndexesCreated} Dataview indexes\n`);
    } else {
      console.log(`  ${chalk.green('✓')} Processed ${csvFiles.length} CSV files, created ${csvIndexesCreated} database indexes\n`);
    }
  }

  // Calculate migration time and size
  const migrationTime = ((Date.now() - migrationStartTime) / 1000).toFixed(1);

  // Calculate total size of migrated directory
  let totalSize = 0;
  const calculateSize = async (dir) => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await calculateSize(fullPath);
        } else if (entry.isFile()) {
          const stats = await stat(fullPath);
          totalSize += stats.size;
        }
      }
    } catch (err) {
      // Ignore errors
    }
  };
  await calculateSize(targetDir);

  // Format size (bytes → GB/MB)
  let sizeStr;
  if (totalSize >= 1024**3) {
    sizeStr = `${(totalSize / (1024**3)).toFixed(2)} GB`;
  } else if (totalSize >= 1024**2) {
    sizeStr = `${(totalSize / (1024**2)).toFixed(2)} MB`;
  } else if (totalSize >= 1024) {
    sizeStr = `${(totalSize / 1024).toFixed(2)} KB`;
  } else {
    sizeStr = `${totalSize} bytes`;
  }

  // Final summary
  console.log(chalk.green.bold(`✅ Migration complete! Processed ${sizeStr} in ${migrationTime} seconds\n`));
  console.log(chalk.white('Summary:'));
  console.log(`   📄 Added frontmatter to ${chalk.cyan(stats.processedFiles)} files`);
  console.log(`   🔗 Converted ${chalk.cyan(stats.totalLinks)} markdown links to wiki links`);
  if (stats.calloutsConverted > 0) {
    console.log(`   💬 Converted ${chalk.cyan(stats.calloutsConverted)} Notion callouts to Obsidian format`);
  }
  if (stats.csvIndexesCreated > 0) {
    if (config.dataviewMode && stats.csvNotesCreated > 0) {
      console.log(`   📊 Created ${chalk.cyan(stats.csvNotesCreated)} individual notes and ${chalk.cyan(stats.csvIndexesCreated)} Dataview indexes from ${stats.csvFilesProcessed} CSV files`);
    } else {
      console.log(`   📊 Created ${chalk.cyan(stats.csvIndexesCreated)} database index pages from ${stats.csvFilesProcessed} CSV files`);
    }
  }
  console.log(`   ✏️  Renamed ${chalk.cyan(stats.renamedFiles)} files`);
  console.log(`   📁 Renamed ${chalk.cyan(stats.renamedDirs)} directories`);
  if (movedFiles > 0) {
    console.log(`   📦 Moved ${chalk.cyan(movedFiles)} files into attachment folders`);
  }

  if (stats.namingConflicts.length > 0) {
    console.log(chalk.yellow(`\n📝 ${stats.namingConflicts.length} naming conflicts resolved:`));
    stats.namingConflicts.slice(0, 5).forEach(({ filePath, resolution }) => {
      console.log(chalk.gray(`   • ${basename(filePath)}: ${resolution}`));
    });
    if (stats.namingConflicts.length > 5) {
      console.log(chalk.gray(`   ... and ${stats.namingConflicts.length - 5} more`));
    }
  }

  console.log(chalk.cyan.bold('\nNotes:'));
  console.log(chalk.gray('   • Duplicate filenames preserved with folder context'));
  console.log(chalk.gray('   • Original filenames stored as aliases'));
  console.log(chalk.gray('   • URL-encoded links converted to wiki links'));

  // Open the final directory automatically
  await openDirectory(targetDir);

  console.log(chalk.yellow('💡 Scroll up to review the full migration summary and any warnings.'));

  // Clean up temporary extraction directory if zip was extracted
  if (extractedTempDir && !config.dryRun) {
    try {
      await rm(extractedTempDir, { recursive: true, force: true });
      console.log(chalk.gray(`\n🗑️  Cleaned up temporary extraction directory`));
    } catch (err) {
      console.log(chalk.yellow(`\n⚠️  Could not clean up temporary directory: ${extractedTempDir}`));
    }
  } else if (extractedTempDir && config.dryRun) {
    console.log(chalk.gray(`\n📁 Temporary extraction directory: ${chalk.blue(extractedTempDir)}`));
    console.log(chalk.gray(`   To remove after migration, run: ${chalk.white(`rm -rf "${extractedTempDir}"`)}`));
  }
}

main().catch(err => {
  console.error(chalk.red.bold(`\n❌ Fatal Error: ${err.message}`));
  if (err.stack) {
    console.error(chalk.gray(err.stack));
  }
  process.exit(1);
});
