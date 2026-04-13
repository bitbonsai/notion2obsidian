import { dirname, relative, basename } from "node:path";
import chalk from "chalk";
import matter from "gray-matter";
import { PATTERNS, cleanName, cleanDirName, normalizeTitle, skeletonsMatch, sanitizeKey } from "./utils.js";
import { convertNotionCallouts } from "./callouts.js";
import { convertPropertyRelations, convertBacklinksProperty, buildPageNameSet, convertAtMentions } from "./links.js";

// ============================================================================
// Metadata Extraction
// ============================================================================

function isRecognizedInlineMetadataKey(line) {
  return line.startsWith('Status:') ||
    line.startsWith('Owner:') ||
    line.startsWith('Dates:') ||
    line.startsWith('Priority:') ||
    line.startsWith('Completion:') ||
    line.startsWith('Summary:');
}

function extractGenericInlineProperty(lines, index) {
  const line = lines[index];
  const match = line.match(/^([^:#!\[\]*\->`•│├└\n\r][^:\n\r]*):\s*(.+)$/);
  if (!match) return null;

  const key = sanitizeKey(match[1]);
  let value = match[2].trim();
  const continuationIndices = [];

  let j = index + 1;
  while (j < lines.length && (lines[j].startsWith('- ') || lines[j].startsWith('* '))) {
    value += '\n' + lines[j];
    continuationIndices.push(j);
    j++;
  }

  if (!key || !value) return null;

  return { key, value, continuationIndices };
}

export function extractInlineMetadataFromLines(lines, options = {}) {
  const { inferMetadata = false } = options;
  const metadata = {};
  const matchedIndices = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('Status:')) { metadata.status = line.substring(7).trim(); matchedIndices.add(i); }
    else if (line.startsWith('Owner:')) { metadata.owner = line.substring(6).trim(); matchedIndices.add(i); }
    else if (line.startsWith('Dates:')) { metadata.dates = line.substring(6).trim(); matchedIndices.add(i); }
    else if (line.startsWith('Priority:')) { metadata.priority = line.substring(9).trim(); matchedIndices.add(i); }
    else if (line.startsWith('Completion:')) { metadata.completion = parseFloat(line.substring(11).trim()); matchedIndices.add(i); }
    else if (line.startsWith('Summary:')) { metadata.summary = line.substring(8).trim(); matchedIndices.add(i); }
    else if (inferMetadata) {
      const genericProperty = extractGenericInlineProperty(lines, i);
      if (genericProperty && !metadata[genericProperty.key]) {
        if (genericProperty.key === 'tags') {
          metadata[genericProperty.key] = genericProperty.value.split(',').map(t => t.trim()).filter(t => t);
        } else {
          metadata[genericProperty.key] = genericProperty.value;
        }
        matchedIndices.add(i);
        for (const continuationIndex of genericProperty.continuationIndices) {
          matchedIndices.add(continuationIndex);
        }
      }
    }
  }

  return { metadata, matchedIndices };
}

function collectInlineScanLines(lines, inferMetadata) {
  const inlineScanLines = [];
  let sawMetadataLine = false;

  for (let i = 0; i < Math.min(30, lines.length); i++) {
    const line = lines[i];
    inlineScanLines.push(line);

    if (!line.trim()) {
      if (sawMetadataLine) {
        break;
      }
      continue;
    }

    const genericProperty = inferMetadata ? extractGenericInlineProperty(lines, i) : null;
    if (isRecognizedInlineMetadataKey(line) || genericProperty) {
      sawMetadataLine = true;
      continue;
    }

    break;
  }

  return inlineScanLines;
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

  // Add inline metadata and database properties dynamically
  // Skip keys that are handled separately or are internal
  const skipKeys = new Set(['title', 'tags', 'aliases', 'notionId', 'folder', 'banner', 'published']);
  
  for (const [key, value] of Object.entries(metadata)) {
    if (!skipKeys.has(key) && value) {
      // Convert key to kebab-case for consistency
      const normalizedKey = sanitizeKey(key);
      if (normalizedKey && !frontmatterData[normalizedKey]) {
        frontmatterData[normalizedKey] = value;
      }
    }
  }

  // Always set published to false
  frontmatterData.published = false;

  const escapedFrontmatterData = escapeBackslashesForQuotedYaml(frontmatterData);

  try {
    // Use gray-matter to generate properly formatted YAML
    // Force quotes to ensure proper parsing of special characters
    const result = matter.stringify('', escapedFrontmatterData, {
      forceQuotes: true
    });

    // Extract just the frontmatter part (remove empty content)
    const frontmatterMatch = result.match(/^---\n([\s\S]*?)\n---\n$/);
    if (frontmatterMatch) {
      return `---\n${frontmatterMatch[1]}\n---`;
    }

    // Fallback: generate manually if matter.stringify doesn't work as expected
    return generateFallbackFrontmatter(escapedFrontmatterData);

  } catch (error) {
    console.warn(chalk.yellow(`Warning: Failed to generate frontmatter with gray-matter: ${error.message}`));
    return generateFallbackFrontmatter(escapedFrontmatterData);
  }
}

function escapeBackslashesForQuotedYaml(value) {
  if (typeof value === 'string') {
    return value
      .replace(/\\([\[\]])/g, '$1')
      .replace(/\\/g, '\\\\');
  }
  if (Array.isArray(value)) {
    return value.map(item => escapeBackslashesForQuotedYaml(item));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = escapeBackslashesForQuotedYaml(v);
    }
    return out;
  }
  return value;
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

/**
 * Extracts Notion database properties from content body to frontmatter
 * Properties are in format: Key: Value (one per line, after first heading)
 * @param {Array} lines - Content lines
 * @returns {Object} - Extracted properties and remaining content lines
 */
export function extractDatabaseProperties(lines, options = {}) {
  const { inferMetadata = true } = options;
  const properties = {};
  let foundFirstHeading = false;
  let headingIndex = -1;
  let lastPropertyIndex = -1;
  let propertiesEndIndex = -1;
  let consecutiveNonPropertyLines = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line && !foundFirstHeading) {
      continue;
    }
    
    if (line.startsWith('#') && !foundFirstHeading) {
      foundFirstHeading = true;
      headingIndex = i;
      continue;
    }
    
    if (foundFirstHeading) {
      const propertyMatch = line.match(/^([^:#!\[\]*\->`•│├└\n\r][^:\n\r]*):\s+(.+)$/);
      
      if (propertyMatch && inferMetadata) {
        const key = propertyMatch[1];
        let value = propertyMatch[2].trim();
        
        // Always look ahead for continuation bullet lines (- or * )
        // This handles both "Key: - item1\n- item2" and "Key: plain text\n* bullet1\n* bullet2"
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j].trim();
          if (nextLine.startsWith('- ') || nextLine.startsWith('* ')) {
            value += '\n' + nextLine;
            j++;
          } else {
            break;
          }
        }
        if (j > i + 1) {
          // Consumed continuation lines — advance past them
          propertiesEndIndex = j;
          i = j - 1; // outer loop will increment
        } else if (line.startsWith('!') || line.startsWith('[')) {
          // No continuations and line looks like content (image/link)
          propertiesEndIndex = i;
          break;
        }
        
        const frontmatterKey = sanitizeKey(key);
        
        if (!frontmatterKey) {
          // Key became empty after sanitization — treat as non-property line
          consecutiveNonPropertyLines++;
          continue;
        }
        
        if (frontmatterKey === 'tags') {
          properties[frontmatterKey] = value.split(',').map(t => t.trim()).filter(t => t);
        } else {
          properties[frontmatterKey] = value;
        }
        lastPropertyIndex = i;
        consecutiveNonPropertyLines = 0;
      } else if (line) {
        const looksLikeContent = line.startsWith('#') || line.startsWith('!') || line.startsWith('[') ||
          (line.startsWith('*') && !line.startsWith('* ')) || line.startsWith('>') || line.startsWith('```') ||
          line.startsWith('---');
        consecutiveNonPropertyLines++;
        if (looksLikeContent || consecutiveNonPropertyLines >= 2) {
          propertiesEndIndex = i - (consecutiveNonPropertyLines - 1);
          break;
        }
      } else {
        if (lastPropertyIndex >= 0) {
          propertiesEndIndex = i;
          break;
        }
        consecutiveNonPropertyLines = 0;
      }
    }
  }
  
  if (Object.keys(properties).length > 0 && headingIndex >= 0) {
    if (propertiesEndIndex < 0) {
      propertiesEndIndex = lastPropertyIndex + 1;
    }
    const remainingLines = [lines[headingIndex], ...lines.slice(propertiesEndIndex)];
    return { properties, remainingLines };
  }
  
  return { properties, remainingLines: lines };
}

export async function processFileContent(filePath, metadata, fileMap, baseDir, dirNameMap = new Map(), options = {}) {
  const { inferMetadata = false } = options;
  const file = Bun.file(filePath);
  const content = await file.text();

  // Skip completely empty files
  if (!content || content.trim().length === 0) {
    return { newContent: content, linkCount: 0, hadFrontmatter: false, skipped: true };
  }

  const lines = content.split('\n');

  // Extract Notion database properties from content body
  const { properties: dbProperties, remainingLines } = extractDatabaseProperties(lines, { inferMetadata });
  // Merge tags arrays instead of overwriting
  if (dbProperties.tags && Array.isArray(metadata.tags)) {
    const newTags = Array.isArray(dbProperties.tags) ? dbProperties.tags : [dbProperties.tags];
    metadata.tags = [...new Set([...metadata.tags, ...newTags])];
    delete dbProperties.tags;
  }
  Object.assign(metadata, dbProperties);

  const inlineScanLines = collectInlineScanLines(remainingLines, inferMetadata);
  const { metadata: inlineMetadata, matchedIndices } = extractInlineMetadataFromLines(inlineScanLines, { inferMetadata });
  // Merge tags arrays instead of overwriting
  if (inlineMetadata.tags && Array.isArray(metadata.tags)) {
    const newTags = Array.isArray(inlineMetadata.tags) ? inlineMetadata.tags : [inlineMetadata.tags];
    metadata.tags = [...new Set([...metadata.tags, ...newTags])];
    delete inlineMetadata.tags;
  }
  Object.assign(metadata, inlineMetadata);

  // matchedIndices are relative to slice(0, 30), so they map directly to remainingLines indices
  const filteredLines = remainingLines.filter((_, idx) => idx >= 30 || !matchedIndices.has(idx));

  const headingTitle = extractFirstHeading(filteredLines);
  if (headingTitle) {
    const currentTitle = typeof metadata.title === 'string' ? metadata.title : '';
    const normalizedCurrent = normalizeTitle(currentTitle);
    const normalizedHeading = normalizeTitle(headingTitle);
    const isLikelyTruncated = normalizedCurrent && normalizedHeading &&
      normalizedCurrent.length >= 20 && normalizedHeading.startsWith(normalizedCurrent);
    if (!currentTitle || isLikelyTruncated || (normalizedCurrent && normalizedHeading && skeletonsMatch(normalizedCurrent, normalizedHeading))) {
      if (headingTitle.length > currentTitle.length) {
        metadata.title = headingTitle;
      }
    }
  }

  const hasFrontmatter = hasValidFrontmatter(filteredLines.join('\n'));

  const relativePath = relative(baseDir, dirname(filePath));
  metadata.folder = relativePath !== '.' ? relativePath : undefined;

  const backlinkBodySections = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string' && value.includes('.md)')) {
      const result = convertBacklinksProperty(value);
      if (result.wikilinks.length > 0) {
        metadata[key] = result.wikilinks;
        if (result.bodyLines.length > 0) {
          const heading = key.charAt(0).toUpperCase() + key.slice(1);
          backlinkBodySections.push(`## ${heading}\n\n${result.bodyLines.join('\n')}`);
        }
      } else {
        metadata[key] = convertPropertyRelations(value);
      }
    }
  }

  const pageNameSet = buildPageNameSet(fileMap);

  for (const [key, value] of Object.entries(metadata)) {
    if (key === 'title' || key === 'aliases') continue;
    if (typeof value === 'string' && value.includes('@')) {
      metadata[key] = convertAtMentions(value, pageNameSet);
    }
  }

  let newContent = filteredLines.join('\n');

  if (backlinkBodySections.length > 0) {
    const headingMatch = newContent.match(/^(# .+\n?)/m);
    if (headingMatch) {
      const insertPos = headingMatch.index + headingMatch[0].length;
      const before = newContent.slice(0, insertPos);
      const after = newContent.slice(insertPos);
      newContent = before + '\n' + backlinkBodySections.join('\n\n') + '\n' + after;
    } else {
      newContent = backlinkBodySections.join('\n\n') + '\n\n' + newContent;
    }
  }

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

  const { convertMarkdownLinkToWiki } = await import('./links.js');
  let linkCount = 0;
  newContent = replaceOutsideFrontmatter(newContent, (body) =>
    body.replace(PATTERNS.mdLink, (match) => {
      const converted = convertMarkdownLinkToWiki(match, fileMap, filePath, baseDir);
      if (converted !== match) {
        linkCount++;
      }
      return converted;
    })
  );

  newContent = convertAtMentionsOutsideFrontmatter(newContent, pageNameSet);

  newContent = cleanAssetPaths(newContent, dirNameMap);

  return { newContent, linkCount, hadFrontmatter: hasFrontmatter, calloutsConverted: calloutsConverted || 0 };
}

function extractFirstHeading(lines) {
  if (!Array.isArray(lines)) return null;
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/);
    if (match) return match[1].trim();
  }
  return null;
}

function convertAtMentionsOutsideFrontmatter(content, pageNameSet) {
  const match = content.match(/^\uFEFF?\s*---\n([\s\S]*?)\n---\n?/);
  if (!match || match.index !== 0) {
    return convertAtMentions(content, pageNameSet);
  }
  const frontmatterBlock = match[0];
  const body = content.slice(frontmatterBlock.length);
  return frontmatterBlock + convertAtMentions(body, pageNameSet);
}

function replaceOutsideFrontmatter(content, replacer) {
  const match = content.match(/^\uFEFF?\s*---\n([\s\S]*?)\n---\n?/);
  if (!match || match.index !== 0) {
    return replacer(content);
  }
  const frontmatterBlock = match[0];
  const body = content.slice(frontmatterBlock.length);
  return frontmatterBlock + replacer(body);
}

export async function updateFileContent(filePath, metadata, fileMap, baseDir, dirNameMap = new Map(), options = {}) {
  try {
    const { newContent, linkCount, skipped, calloutsConverted } = await processFileContent(filePath, metadata, fileMap, baseDir, dirNameMap, options);

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

  // First: exact cleanedName duplicates (original behavior)
  for (const [name, paths] of nameMap.entries()) {
    if (paths.length > 1) {
      duplicates.set(name, paths);
    }
  }

  return duplicates;
}
