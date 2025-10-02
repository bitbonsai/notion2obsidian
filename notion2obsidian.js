#!/usr/bin/env bun

import { Glob } from "bun";
import { stat, readdir, rename, copyFile, mkdir, rm, writeFile, lstat, realpath, access, constants } from "node:fs/promises";
import { join, dirname, basename, extname, relative, sep } from "node:path";
import { unzipSync } from "fflate";
import chalk from "chalk";

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
  mdLink: /\[([^\]]+)\]\(([^)]+\.md)\)/g,
  frontmatter: /^\uFEFF?\s*---\s*\n/,  // Handle BOM and whitespace
  notionIdExtract: /\s([0-9a-fA-F]{32})(?:\.[^.]+)?$/
};

const BATCH_SIZE = 50;

// ============================================================================
// CLI Arguments Parser
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    targetDir: '.',
    dryRun: false,
    verbose: false,
    dirExplicitlyProvided: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run' || arg === '-d') {
      config.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      config.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      config.targetDir = arg;
      config.dirExplicitlyProvided = true;
    }
  }

  return config;
}

function showHelp() {
  console.log(`
${chalk.blueBright.bold('💎 Notion to Obsidian')}

${chalk.yellow('Usage:')}
  notion2obsidian [directory|zip-file] [options]

${chalk.yellow('Options:')}
  -d, --dry-run       Preview changes without modifying files
                      (extracts 10% sample or 10MB max for zip files)
  -v, --verbose       Show detailed processing information
  -h, --help          Show this help message

${chalk.yellow('Examples:')}
  notion2obsidian ./Export-abc123.zip
  notion2obsidian ./Export-abc123.zip --dry-run
  notion2obsidian ./my-notion-export
  notion2obsidian ./my-export --dry-run

${chalk.blueBright('Features:')}
  • Accepts zip files directly (extracts to same directory)
  • Removes Notion IDs from filenames and directories
  • Adds YAML frontmatter with metadata
  • Converts markdown links to wiki links
  • Handles duplicate filenames with folder context
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

  // Skip non-md files (images, etc)
  if (!pathPart.endsWith('.md')) {
    return link;
  }

  // Decode the URL-encoded path
  const decodedPath = decodeURIComponent(pathPart);

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
// Frontmatter Generation
// ============================================================================

function escapeYamlString(str) {
  // Escape double quotes in YAML string values
  return str.replace(/"/g, '\\"');
}

function generateFrontmatter(metadata, relativePath) {
  const lines = ['---'];

  if (metadata.title) lines.push(`title: "${escapeYamlString(metadata.title)}"`);
  if (metadata.tags && metadata.tags.length > 0) {
    lines.push(`tags: [${metadata.tags.join(', ')}]`);
  }
  if (metadata.aliases && metadata.aliases.length > 0) {
    lines.push(`aliases:`);
    metadata.aliases.forEach(alias => {
      lines.push(`  - "${escapeYamlString(alias)}"`);
    });
  }
  if (metadata.notionId) lines.push(`notion-id: "${metadata.notionId}"`);

  // Add folder path for disambiguation
  if (relativePath && relativePath !== '.') {
    lines.push(`folder: "${escapeYamlString(relativePath)}"`);
  }

  // Add inline metadata if found
  if (metadata.status) lines.push(`status: "${escapeYamlString(metadata.status)}"`);
  if (metadata.owner) lines.push(`owner: "${escapeYamlString(metadata.owner)}"`);
  if (metadata.dates) lines.push(`dates: "${escapeYamlString(metadata.dates)}"`);
  if (metadata.priority) lines.push(`priority: "${escapeYamlString(metadata.priority)}"`);
  if (metadata.completion !== undefined) lines.push(`completion: ${metadata.completion}`);
  if (metadata.summary) lines.push(`summary: "${escapeYamlString(metadata.summary)}"`);

  lines.push(`published: false`);

  lines.push('---');
  return lines.join('\n');
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

  // Check if file already has frontmatter
  const hasFrontmatter = PATTERNS.frontmatter.test(content);

  // Add folder path to metadata
  const relativePath = relative(baseDir, dirname(filePath));
  metadata.folder = relativePath !== '.' ? relativePath : undefined;

  let newContent = content;

  // Add frontmatter if it doesn't exist
  if (!hasFrontmatter) {
    const frontmatter = generateFrontmatter(metadata, relativePath);
    newContent = frontmatter + '\n\n' + content;
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

  return { newContent, linkCount, hadFrontmatter: hasFrontmatter };
}

async function updateFileContent(filePath, metadata, fileMap, baseDir, dirNameMap = new Map()) {
  try {
    const { newContent, linkCount, skipped } = await processFileContent(filePath, metadata, fileMap, baseDir, dirNameMap);

    // Skip completely empty files
    if (skipped) {
      return { success: true, linkCount: 0, skipped: true };
    }

    await Bun.write(filePath, newContent);

    return { success: true, linkCount };
  } catch (err) {
    return { success: false, error: err.message, linkCount: 0 };
  }
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
      duplicates: this.duplicates
    };
  }
}

// ============================================================================
// Zip Extraction
// ============================================================================

async function extractZipToSameDirectory(zipPath, options = {}) {
  const { sample = false, samplePercentage = 0.10, maxSampleBytes = 10_000_000 } = options;

  const zipDir = dirname(zipPath);
  const zipBaseName = basename(zipPath, '.zip');

  // Shorten the directory name by truncating long hashes/UUIDs
  // Pattern: Export-2d6fa1e5-8571-4845-8e81-f7d5ca30194a-Part-1 → Export-2d6f
  let shortName = zipBaseName;
  // Match UUID format (with hyphens) or plain hex (without hyphens)
  const uuidPattern = /^(Export-[0-9a-fA-F]{4})[0-9a-fA-F-]{24,}/;
  const match = zipBaseName.match(uuidPattern);
  if (match) {
    shortName = match[1];  // e.g., "Export-2d6f"
  }

  const extractDir = join(zipDir, `${shortName}-extracted`);

  console.log(chalk.cyan('📦 Extracting zip file...'));
  console.log(chalk.gray(`Extracting to: ${extractDir}`));

  if (sample) {
    console.log(chalk.yellow(`Sample mode: extracting up to ${samplePercentage * 100}% or ${Math.round(maxSampleBytes / 1_000_000)}MB for preview`));
  }
  console.log();

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

    // Write files
    let fileCount = 0;
    for (const [filePath, content] of selectedFiles) {
      const fullPath = join(extractDir, filePath);

      // Create directory structure
      await mkdir(dirname(fullPath), { recursive: true });

      // Write file
      await writeFile(fullPath, content);

      fileCount++;
    }

    if (isSampled) {
      console.log(chalk.green(`✓ Extracted ${fileCount} of ${totalFiles} files (${Math.round(fileCount / totalFiles * 100)}% sample)\n`));
    } else {
      console.log(chalk.green(`✓ Extraction complete (${fileCount} files)\n`));
    }

    // Check if zip extracted to a single top-level directory
    const entries = await readdir(extractDir);
    if (entries.length === 1) {
      const potentialSubdir = join(extractDir, entries[0]);
      const subdirStat = await stat(potentialSubdir).catch(() => null);
      if (subdirStat?.isDirectory()) {
        console.log(chalk.gray(`Using subdirectory: ${entries[0]}\n`));
        return {
          path: potentialSubdir,
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

async function showExtractedDirectoryInfo(extractedDir) {
  console.log(chalk.cyan.bold('\n📁 Extracted Directory:'));
  console.log(chalk.blue(`   ${extractedDir}`));
  console.log(chalk.gray('\n   You can now open this directory in Obsidian.'));
  console.log(chalk.gray(`   To remove the extracted files, run: ${chalk.white(`rm -rf "${extractedDir}"`)}\n`));
}

// ============================================================================
// User Confirmation
// ============================================================================

async function promptForConfirmation(dryRun) {
  if (dryRun) {
    console.log(chalk.yellow.bold('\n🔍 DRY RUN MODE - No changes will be made\n'));
    return;
  }

  console.log(chalk.yellow('\nPress ENTER to proceed with the migration, or Ctrl+C to cancel...'));

  const reader = Bun.stdin.stream().getReader();
  await reader.read();
  reader.releaseLock();
}

// ============================================================================
// Main Migration Logic
// ============================================================================

async function main() {
  const config = parseArgs();
  const stats = new MigrationStats();
  let extractedTempDir = null;

  // Check if input is a zip file
  const isZipFile = config.targetDir.toLowerCase().endsWith('.zip');

  if (isZipFile) {
    // Check if zip file exists
    try {
      await stat(config.targetDir);
    } catch {
      console.log(chalk.red(`Error: Zip file ${config.targetDir} does not exist`));
      process.exit(1);
    }

    // Extract zip to same directory (use sampling for dry-run)
    try {
      const result = await extractZipToSameDirectory(config.targetDir, {
        sample: config.dryRun,
        samplePercentage: 0.10,
        maxSampleBytes: 10_000_000
      });
      extractedTempDir = result.extractDir;  // Store parent dir for cleanup
      config.targetDir = result.path;        // Use subdirectory for migration
      config.zipSampleInfo = result.isSampled ? {
        sampled: result.sampleCount,
        total: result.totalCount
      } : null;
    } catch (err) {
      console.log(chalk.red(`Error extracting zip file: ${err.message}`));
      process.exit(1);
    }
  } else {
    // Check if directory exists
    try {
      await stat(config.targetDir);
    } catch {
      console.log(chalk.red(`Error: Directory ${config.targetDir} does not exist`));
      process.exit(1);
    }

    // Check write permissions
    try {
      await access(config.targetDir, constants.W_OK);
    } catch {
      console.log(chalk.red(`Error: No write permission for directory ${config.targetDir}`));
      process.exit(1);
    }

    // Test actual write capability
    const testFile = join(config.targetDir, `.notion2obsidian-test-${Date.now()}`);
    try {
      await writeFile(testFile, 'test');
      await rm(testFile);
    } catch (err) {
      console.log(chalk.red(`Error: Cannot write to directory: ${err.message}`));
      process.exit(1);
    }

    // Confirm if using current directory without explicit argument
    if (!config.dirExplicitlyProvided) {
      const cwd = process.cwd();
      console.log(chalk.yellow('⚠ No directory specified. This will run on the current directory:'));
      console.log(chalk.blue(`  ${cwd}\n`));
      console.log(chalk.yellow('Press ENTER to continue, or Ctrl+C to cancel...'));

      const reader = Bun.stdin.stream().getReader();
      await reader.read();
      reader.releaseLock();
      console.log();
    }
  }

  console.log(chalk.cyan.bold('📦 Notion to Obsidian'));
  console.log(`Directory: ${chalk.blue(config.targetDir)}`);
  if (config.dryRun) {
    console.log(chalk.yellow.bold('Mode: DRY RUN (no changes will be made)'));
  }
  console.log();

  console.log(chalk.yellow('Phase 1: Analyzing files and building migration map...\n'));

  // Scan for all files (excluding backups)
  const glob = new Glob("**/*.md");
  const files = [];

  for await (const file of glob.scan({
    cwd: config.targetDir,
    absolute: true,
    dot: false
  })) {
    // Skip backup files from previous runs
    if (!file.endsWith('.backup')) {
      files.push(file);
    }
  }

  // Scan for all directories
  const dirs = await getAllDirectories(config.targetDir);

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
  const fileMap = buildFileMap(files, config.targetDir);

  // Build migration maps
  const fileMigrationMap = [];
  const dirMigrationMap = [];

  // Process files metadata
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const filename = basename(filePath);
    const cleanedName = cleanName(filename);
    const notionId = extractNotionId(filename);

    const tags = getTagsFromPath(filePath, config.targetDir);

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
    const relativePath = relative(config.targetDir, dirname(sample.oldPath));
    console.log(chalk.gray(generateFrontmatter(sample.metadata, relativePath)));
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
    const { linkCount } = await processFileContent(sample.oldPath, sample.metadata, fileMap, config.targetDir, dirNameMap);
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

    // Handle temp directory cleanup if zip was extracted
    if (extractedTempDir) {
      await rm(extractedTempDir, { recursive: true, force: true });
      console.log(chalk.gray('\nTemporary extracted files removed.'));
    }
    return;
  }

  console.log(chalk.yellow.bold('\nPhase 2: Executing migration...\n'));

  // Step 1: Add frontmatter and convert links
  console.log(chalk.green('Step 1: Adding frontmatter and converting links...'));

  // Process files in batches
  for (let i = 0; i < fileMigrationMap.length; i += BATCH_SIZE) {
    const batch = fileMigrationMap.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(file =>
        updateFileContent(file.oldPath, file.metadata, fileMap, config.targetDir, dirNameMap)
      )
    );

    results.forEach((result, idx) => {
      if (result.success) {
        stats.processedFiles++;
        stats.totalLinks += result.linkCount;
      } else {
        stats.addNamingConflict(batch[idx].oldPath, result.error);
      }
    });
  }

  console.log(`  ${chalk.green('✓')} Processed ${stats.processedFiles} files, converted ${stats.totalLinks} links\n`);

  // Step 2: Rename files
  console.log(chalk.green('Step 2: Renaming files...'));

  for (let i = 0; i < filesToRename.length; i++) {
    const file = filesToRename[i];
    try {
      // Check if target already exists
      if (await stat(file.newPath).catch(() => false)) {
        // File exists - create alternative name
        const ext = extname(file.newPath);
        const nameWithoutExt = basename(file.newPath, ext);
        const dir = dirname(file.newPath);
        let counter = 1;
        let alternativePath = join(dir, `${nameWithoutExt}-${counter}${ext}`);
        while (await stat(alternativePath).catch(() => false)) {
          counter++;
          alternativePath = join(dir, `${nameWithoutExt}-${counter}${ext}`);
        }
        await rename(file.oldPath, alternativePath);
        stats.addNamingConflict(file.oldPath, `Target exists, renamed to ${basename(alternativePath)}`);
        stats.renamedFiles++;
      } else {
        await rename(file.oldPath, file.newPath);
        stats.renamedFiles++;
      }
    } catch (err) {
      stats.addNamingConflict(file.oldPath, err.message);
    }
  }

  console.log(`  ${chalk.green('✓')} Renamed ${stats.renamedFiles} files\n`);

  // Step 3: Rename directories
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
        stats.addNamingConflict(dir.oldPath, `Target exists, renamed to ${basename(alternativePath)}`);
        stats.renamedDirs++;
      } else {
        await rename(dir.oldPath, dir.newPath);
        stats.renamedDirs++;
      }
    } catch (err) {
      stats.addNamingConflict(dir.oldPath, err.message);
    }
  }

  console.log(`  ${chalk.green('✓')} Renamed ${stats.renamedDirs} directories\n`);

  // Final summary
  console.log(chalk.green.bold('✅ Migration complete!\n'));
  console.log(chalk.white('Summary:'));
  console.log(`   📄 Added frontmatter to ${chalk.cyan(stats.processedFiles)} files`);
  console.log(`   🔗 Converted ${chalk.cyan(stats.totalLinks)} markdown links to wiki links`);
  console.log(`   ✏️  Renamed ${chalk.cyan(stats.renamedFiles)} files`);
  console.log(`   📁 Renamed ${chalk.cyan(stats.renamedDirs)} directories`);

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

  console.log(chalk.cyan.bold('\n🎉 Your Notion export is now ready for Obsidian!'));
  console.log(`Open directory: ${chalk.blue(basename(config.targetDir))}`);

  // Show extracted directory info if zip was extracted
  if (extractedTempDir) {
    await showExtractedDirectoryInfo(extractedTempDir);
  }
}

main().catch(err => {
  console.error(chalk.red.bold(`\n❌ Fatal Error: ${err.message}`));
  if (err.stack) {
    console.error(chalk.gray(err.stack));
  }
  process.exit(1);
});
