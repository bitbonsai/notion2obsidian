import { dirname, relative, basename } from "node:path";
import chalk from "chalk";
import matter from "gray-matter";
import { PATTERNS, cleanName, cleanDirName } from "./utils.js";
import { convertNotionCallouts } from "./callouts.js";

// ============================================================================
// Metadata Extraction
// ============================================================================

export function extractInlineMetadataFromLines(lines) {
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

export function getTagsFromPath(filePath, baseDir) {
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

// ============================================================================
// Frontmatter Handling (Gray-Matter Based)
// ============================================================================

/**
 * Validates if content has proper Obsidian-compatible frontmatter
 * @param {string} content - The file content to check
 * @returns {boolean} - True if valid frontmatter is detected
 */
export function hasValidFrontmatter(content) {
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
export function parseFrontmatter(content) {
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
export function generateValidFrontmatter(metadata, relativePath) {
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
export function generateFallbackFrontmatter(data) {
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
export function validateFrontmatter(frontmatterString) {
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

export function cleanAssetPaths(content, dirNameMap) {
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

export async function processFileContent(filePath, metadata, fileMap, baseDir, dirNameMap = new Map()) {
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
  // Import at point of use to avoid circular dependency
  const { convertMarkdownLinkToWiki } = await import('./links.js');
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

export async function updateFileContent(filePath, metadata, fileMap, baseDir, dirNameMap = new Map()) {
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
// Duplicate Detection
// ============================================================================

export async function findDuplicateNames(files) {
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
