#!/usr/bin/env bun

import { Glob } from "bun";
import { stat, readdir, rename, copyFile } from "fs/promises";
import { join, dirname, basename, extname, relative } from "path";
import chalk from "chalk";
import cliProgress from "cli-progress";

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
    skipBackup: false,
    verbose: false,
    dirExplicitlyProvided: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run' || arg === '-d') {
      config.dryRun = true;
    } else if (arg === '--skip-backup') {
      config.skipBackup = true;
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
${chalk.cyan.bold('Notion to Obsidian')}

${chalk.yellow('Usage:')}
  notion2obsidian [directory] [options]

${chalk.yellow('Options:')}
  -d, --dry-run       Preview changes without modifying files
  --skip-backup       Skip creating backup files (faster but risky)
  -v, --verbose       Show detailed processing information
  -h, --help          Show this help message

${chalk.yellow('Examples:')}
  notion2obsidian ./my-notion-export
  notion2obsidian ./my-notion-export --dry-run
  notion2obsidian --verbose

${chalk.cyan('Documentation:')}
  This tool migrates Notion exports to Obsidian-compatible format by:
  • Removing Notion IDs from filenames and directories
  • Adding YAML frontmatter with metadata
  • Converting markdown links to wiki links
  • Handling duplicate filenames with folder context
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

async function getFileStats(filePath) {
  const stats = await stat(filePath);
  return {
    created: stats.birthtime.toISOString().split('T')[0],
    modified: stats.mtime.toISOString().split('T')[0]
  };
}

// ============================================================================
// Frontmatter Generation
// ============================================================================

function generateFrontmatter(metadata, relativePath) {
  const lines = ['---'];
  
  if (metadata.title) lines.push(`title: "${metadata.title}"`);
  if (metadata.created) lines.push(`created: ${metadata.created}`);
  if (metadata.modified) lines.push(`modified: ${metadata.modified}`);
  if (metadata.tags && metadata.tags.length > 0) {
    lines.push(`tags: [${metadata.tags.join(', ')}]`);
  }
  if (metadata.aliases && metadata.aliases.length > 0) {
    lines.push(`aliases:`);
    metadata.aliases.forEach(alias => {
      lines.push(`  - "${alias}"`);
    });
  }
  if (metadata.notionId) lines.push(`notion-id: "${metadata.notionId}"`);
  
  // Add folder path for disambiguation
  if (relativePath && relativePath !== '.') {
    lines.push(`folder: "${relativePath}"`);
  }
  
  // Add inline metadata if found
  if (metadata.status) lines.push(`status: "${metadata.status}"`);
  if (metadata.owner) lines.push(`owner: "${metadata.owner}"`);
  if (metadata.dates) lines.push(`dates: "${metadata.dates}"`);
  if (metadata.priority) lines.push(`priority: "${metadata.priority}"`);
  if (metadata.completion !== undefined) lines.push(`completion: ${metadata.completion}`);
  if (metadata.summary) lines.push(`summary: "${metadata.summary}"`);
  
  lines.push(`published: false`);
  
  lines.push('---');
  return lines.join('\n');
}

// ============================================================================
// File Processing
// ============================================================================

async function processFileContent(filePath, metadata, fileMap, baseDir) {
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
    linkCount++;
    return convertMarkdownLinkToWiki(match, fileMap, filePath);
  });
  
  return { newContent, linkCount, hadFrontmatter: hasFrontmatter };
}

async function updateFileContent(filePath, metadata, fileMap, baseDir, skipBackup = false) {
  try {
    // Create backup unless skipped
    if (!skipBackup) {
      await copyFile(filePath, `${filePath}.backup`);
    }
    
    const { newContent, linkCount } = await processFileContent(filePath, metadata, fileMap, baseDir);
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
  
  async function scan(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = join(currentDir, entry.name);
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
    this.errors = [];
    this.duplicates = 0;
  }

  addError(filePath, error) {
    this.errors.push({ filePath, error });
  }

  getSummary() {
    return {
      totalFiles: this.totalFiles,
      processedFiles: this.processedFiles,
      renamedFiles: this.renamedFiles,
      renamedDirs: this.renamedDirs,
      totalLinks: this.totalLinks,
      errorCount: this.errors.length,
      duplicates: this.duplicates
    };
  }
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

  // Check if directory exists
  try {
    await stat(config.targetDir);
  } catch {
    console.log(chalk.red(`Error: Directory ${config.targetDir} does not exist`));
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

  console.log(chalk.cyan.bold('📦 Notion to Obsidian'));
  console.log(`Directory: ${chalk.blue(config.targetDir)}`);
  if (config.dryRun) {
    console.log(chalk.yellow.bold('Mode: DRY RUN (no changes will be made)'));
  }
  console.log();
  
  console.log(chalk.yellow('Phase 1: Analyzing files and building migration map...\n'));
  
  // Create progress bar for file scanning
  const scanBar = new cliProgress.SingleBar({
    format: 'Scanning |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} files',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });
  
  // Scan for all files
  const glob = new Glob("**/*.md");
  const files = [];
  
  scanBar.start(100, 0);
  let fileCount = 0;
  
  for await (const file of glob.scan({
    cwd: config.targetDir,
    absolute: true,
    dot: false
  })) {
    files.push(file);
    fileCount++;
    if (fileCount % 10 === 0) {
      scanBar.update(Math.min(50, fileCount / 10));
    }
  }
  
  scanBar.update(50);
  
  // Scan for all directories
  const dirs = await getAllDirectories(config.targetDir);
  scanBar.update(100);
  scanBar.stop();
  
  stats.totalFiles = files.length;

  console.log(`Found ${chalk.blue(files.length)} markdown files`);
  console.log(`Found ${chalk.blue(dirs.length)} directories\n`);

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
  const metadataBar = new cliProgress.SingleBar({
    format: 'Analyzing |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} files',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });
  
  metadataBar.start(files.length, 0);
  
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const filename = basename(filePath);
    const cleanedName = cleanName(filename);
    const notionId = extractNotionId(filename);
    
    const fileStats = await getFileStats(filePath);
    const tags = getTagsFromPath(filePath, config.targetDir);
    
    // Build aliases
    const aliases = [];
    if (filename !== cleanedName) {
      aliases.push(filename.replace('.md', ''));
      const encoded = encodeURIComponent(filename.replace('.md', ''));
      if (encoded !== filename.replace('.md', '')) {
        aliases.push(encoded);
      }
    }
    
    const metadata = {
      title: cleanedName.replace('.md', ''),
      created: fileStats.created,
      modified: fileStats.modified,
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
    
    metadataBar.update(i + 1);
  }
  
  metadataBar.stop();
  
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
        depth: dirPath.split('/').length
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
    console.log(chalk.gray('\nSample files (first 3):'));
    for (const file of filesToRename.slice(0, 3)) {
      console.log(`  ${chalk.red('−')} ${file.oldName}`);
      console.log(`  ${chalk.green('+')} ${file.newName}\n`);
    }
  }
  
  // Show directory renames
  if (dirMigrationMap.length > 0) {
    console.log(chalk.green(`Directories to rename: ${dirMigrationMap.length}`));
    console.log(chalk.gray('\nSample directories (first 3):'));
    for (const dir of dirMigrationMap.slice(0, 3)) {
      console.log(`  ${chalk.red('−')} ${dir.oldName}`);
      console.log(`  ${chalk.green('+')} ${dir.newName}\n`);
    }
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
  
  // Calculate link count estimate
  let estimatedLinkCount = 0;
  const sampleSize = Math.min(10, fileMigrationMap.length);
  for (let i = 0; i < sampleSize; i++) {
    const sample = fileMigrationMap[i];
    const { linkCount } = await processFileContent(sample.oldPath, sample.metadata, fileMap, config.targetDir);
    estimatedLinkCount += linkCount;
  }
  const avgLinksPerFile = sampleSize > 0 ? estimatedLinkCount / sampleSize : 0;
  const totalEstimatedLinks = Math.round(avgLinksPerFile * fileMigrationMap.length);
  
  console.log(chalk.yellow.bold('\n═══ SUMMARY ═══'));
  console.log(`  • Add frontmatter to ${chalk.blue(fileMigrationMap.length)} files`);
  console.log(`  • Convert ~${chalk.blue(totalEstimatedLinks)} markdown links to wiki links`);
  console.log(`  • Handle ${chalk.blue(duplicates.size)} duplicate filenames with folder context`);
  console.log(`  • Rename ${chalk.blue(filesToRename.length)} files`);
  console.log(`  • Rename ${chalk.blue(dirMigrationMap.length)} directories`);
  
  // Wait for confirmation
  await promptForConfirmation(config.dryRun);
  
  if (config.dryRun) {
    console.log(chalk.green.bold('\n✅ Dry run complete! No changes were made.'));
    console.log(chalk.gray('Run without --dry-run to apply changes.'));
    return;
  }
  
  console.log(chalk.yellow.bold('\nPhase 2: Executing migration...\n'));
  
  // Step 1: Add frontmatter and convert links
  console.log(chalk.green('Step 1: Adding frontmatter and converting links...'));
  
  const contentBar = new cliProgress.SingleBar({
    format: 'Processing |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} files',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });
  
  contentBar.start(fileMigrationMap.length, 0);
  
  // Process files in batches
  for (let i = 0; i < fileMigrationMap.length; i += BATCH_SIZE) {
    const batch = fileMigrationMap.slice(i, i + BATCH_SIZE);
    
    const results = await Promise.all(
      batch.map(file => 
        updateFileContent(file.oldPath, file.metadata, fileMap, config.targetDir, config.skipBackup)
      )
    );
    
    results.forEach((result, idx) => {
      if (result.success) {
        stats.processedFiles++;
        stats.totalLinks += result.linkCount;
      } else {
        stats.addError(batch[idx].oldPath, result.error);
      }
    });
    
    contentBar.update(Math.min(i + BATCH_SIZE, fileMigrationMap.length));
  }
  
  contentBar.stop();
  console.log(`  ${chalk.green('✓')} Processed ${stats.processedFiles} files, converted ${stats.totalLinks} links\n`);
  
  // Step 2: Rename files
  console.log(chalk.green('Step 2: Renaming files...'));
  
  const renameBar = new cliProgress.SingleBar({
    format: 'Renaming |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} files',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });
  
  renameBar.start(filesToRename.length, 0);
  
  for (let i = 0; i < filesToRename.length; i++) {
    const file = filesToRename[i];
    try {
      await rename(file.oldPath, file.newPath);
      stats.renamedFiles++;
    } catch (err) {
      stats.addError(file.oldPath, err.message);
    }
    renameBar.update(i + 1);
  }
  
  renameBar.stop();
  console.log(`  ${chalk.green('✓')} Renamed ${stats.renamedFiles} files\n`);
  
  // Step 3: Rename directories
  console.log(chalk.green('Step 3: Renaming directories...'));
  
  const dirBar = new cliProgress.SingleBar({
    format: 'Renaming |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} directories',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });
  
  dirBar.start(dirMigrationMap.length, 0);
  
  for (let i = 0; i < dirMigrationMap.length; i++) {
    const dir = dirMigrationMap[i];
    try {
      await rename(dir.oldPath, dir.newPath);
      stats.renamedDirs++;
    } catch (err) {
      stats.addError(dir.oldPath, err.message);
    }
    dirBar.update(i + 1);
  }
  
  dirBar.stop();
  console.log(`  ${chalk.green('✓')} Renamed ${stats.renamedDirs} directories\n`);
  
  // Final summary
  console.log(chalk.green.bold('✅ Migration complete!\n'));
  console.log(chalk.white('Summary:'));
  console.log(`   • Added frontmatter to ${chalk.cyan(stats.processedFiles)} files`);
  console.log(`   • Converted ${chalk.cyan(stats.totalLinks)} markdown links to wiki links`);
  console.log(`   • Renamed ${chalk.cyan(stats.renamedFiles)} files`);
  console.log(`   • Renamed ${chalk.cyan(stats.renamedDirs)} directories`);
  
  if (stats.errors.length > 0) {
    console.log(chalk.red(`\n⚠ ${stats.errors.length} errors occurred:`));
    stats.errors.slice(0, 5).forEach(({ filePath, error }) => {
      console.log(chalk.red(`   • ${basename(filePath)}: ${error}`));
    });
    if (stats.errors.length > 5) {
      console.log(chalk.gray(`   ... and ${stats.errors.length - 5} more`));
    }
  }
  
  console.log(chalk.cyan.bold('\nNotes:'));
  console.log(chalk.gray('   • Duplicate filenames preserved with folder context'));
  console.log(chalk.gray('   • Original filenames stored as aliases'));
  console.log(chalk.gray('   • URL-encoded links converted to wiki links'));
  if (!config.skipBackup) {
    console.log(chalk.gray('   • Backup files created (.backup extension)'));
  }
  
  console.log(chalk.cyan.bold('\n🎉 Your Notion export is now ready for Obsidian!'));
  console.log(`Open Obsidian and select: ${chalk.blue(config.targetDir)}`);
}

main().catch(err => {
  console.error(chalk.red.bold(`\n❌ Fatal Error: ${err.message}`));
  if (err.stack) {
    console.error(chalk.gray(err.stack));
  }
  process.exit(1);
});
