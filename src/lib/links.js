import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { cleanName, extractNotionId } from "./utils.js";

const KNOWN_EXTENSIONS = new Set([
  '.aac', '.amr', '.bin', '.csv', '.docx', '.gif', '.heic', '.html',
  '.jpeg', '.jpg', '.m4a', '.mov', '.mp4', '.pdf', '.png', '.wav', '.webp',
]);

// ============================================================================
// File Map Builder
// ============================================================================

export function buildFileMap(files, baseDir) {
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

function encodeMarkerAnchor(anchor) {
  const normalized = String(anchor || '').trim();
  if (!normalized) return '';
  return Buffer.from(normalized, 'utf8').toString('base64url');
}

// ============================================================================
// Property Value Link Conversion
// ============================================================================

/**
 * Extracts a wiki-link from a single "text (url-encoded-path.md)" segment.
 * Returns the cleaned page name or null if the segment doesn't contain a Notion backlink.
 */
function extractWikilinkFromBacklink(segment) {
  const match = segment.match(/^([^()]*?)\s*\(([^\n\r)]+\.md)\)\s*$/);
  if (!match) return null;
  const url = match[2];
  // Only treat as backlink if the URL has path separators, URL-encoding, or a 32-char hex ID
  if (!url.includes('/') && !url.includes('%') && !url.match(/[0-9a-fA-F]{32}/)) {
    return null;
  }
  const decodedPath = decodeURIComponent(url);
  const filename = basename(decodedPath);
  return cleanName(filename).replace(/\.md$/, '');
}

function formatWikilinkTarget(name) {
  const cleaned = String(name || '').trim();
  if (!cleaned) return cleaned;
  if (!/[\[\]]/.test(cleaned)) {
    return `[[${cleaned}]]`;
  }
  const escapedTarget = cleaned.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  return `[[${escapedTarget}|${cleaned}]]`;
}

/**
 * Converts parenthesized links in property values: "text (../path/file.md)" → "[[cleanedName]]"
 * Notion exports relation/link property values in this format (no square brackets).
 */
export function convertPropertyValueLinks(value) {
  const converted = value.replace(/([^,\n\r()]+?)\s*\(([^\n\r)]+\.md)\)/g, (match, text, url) => {
    if (!url.includes('/') && !url.includes('%') && !url.match(/[0-9a-fA-F]{32}/)) {
      return match;
    }
    const decodedPath = decodeURIComponent(url);
    const filename = basename(decodedPath);
    const cleaned = cleanName(filename).replace(/\.md$/, '');
    return formatWikilinkTarget(cleaned);
  });
  return converted.replace(/\]\]\s*\[\[/g, ']], [[');
}

/**
 * Converts parenthesized links in property values (single or comma-separated).
 * For multi-line list values, delegates to convertBacklinksProperty().
 */
export function convertPropertyRelations(value) {
  if (!value.includes('.md)')) return value;
  
  const lines = value.split('\n');
  const isMultiLineList = lines.length > 1 && lines.some(line => line.trim().startsWith('- ') || line.trim().startsWith('* '));
  if (isMultiLineList) {
    const result = convertBacklinksProperty(value);
    return result.converted.replace(/\]\]\s*\[\[/g, ']], [[');
  }
  
  const parts = value.split(',');
  const normalized = parts.map(part => convertPropertyValueLinks(part.trim())).join(', ').replace(/\]\]\s*\[\[/g, ']], [[');
  const wikilinks = normalized.match(/\[\[[^\]]+\]\]/g) || [];
  if (wikilinks.length > 1) {
    const residue = normalized.replace(/\[\[[^\]]+\]\]/g, '').replace(/[\s,]/g, '');
    if (residue.length === 0) {
      return wikilinks;
    }
  }
  return normalized;
}

/**
 * Converts Notion backlink property values (single or multi-line list) to wiki-links.
 * Returns both a frontmatter-ready array and body-ready markdown list.
 *
 * Input formats:
 *   Single: "display text (url-encoded-path.md)"
 *   Multi:  "- display text (path.md)\n- display text2 (path2.md)"
 *   Mixed:  "- display text (path.md)\n- plain text without link"
 *
 * Returns: {
 *   wikilinks: string[]    // e.g. ["[[Page A]]", "[[Page B]]"] — for frontmatter YAML list
 *   bodyLines: string[]    // e.g. ["- [[Page A]]", "- [[Page B]]"] — for body injection
 *   converted: string      // inline-converted string (backlinks replaced with [[...]])
 * }
 */
export function convertBacklinksProperty(value) {
  if (!value || typeof value !== 'string') {
    return { wikilinks: [], bodyLines: [], converted: value || '' };
  }

  const lines = value.split('\n');
  const isBullet = line => line.trim().startsWith('- ') || line.trim().startsWith('* ');
  const isMultiLineList = lines.length > 1 && lines.some(isBullet);

  if (isMultiLineList) {
    const wikilinks = [];
    const bodyLines = [];
    const convertedLines = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Strip leading "- " or "* " bullet prefix
      let content = trimmed;
      let bulletPrefix = '';
      if (trimmed.startsWith('- ')) {
        bulletPrefix = '- ';
        content = trimmed.slice(2).trim();
      } else if (trimmed.startsWith('* ')) {
        bulletPrefix = '- '; // normalize to "- "
        content = trimmed.slice(2).trim();
      }

      const pageName = extractWikilinkFromBacklink(content);
      if (pageName) {
        const wikilink = formatWikilinkTarget(pageName);
        wikilinks.push(wikilink);
        bodyLines.push(`- ${wikilink}`);
        convertedLines.push(`${bulletPrefix}${wikilink}`);
      } else {
        // Not a backlink — preserve as-is
        if (bulletPrefix) {
          bodyLines.push(`- ${content}`);
        }
        convertedLines.push(trimmed);
      }
    }

    return {
      wikilinks,
      bodyLines,
      converted: convertedLines.join('\n')
    };
  }

  // Single-value: may be comma-separated
  const pageName = extractWikilinkFromBacklink(value.trim());
  if (pageName) {
    const wikilink = formatWikilinkTarget(pageName);
    return {
      wikilinks: [wikilink],
      bodyLines: [`- ${wikilink}`],
      converted: wikilink
    };
  }

  // Try comma-separated
  if (value.includes(',') && value.includes('.md)')) {
    const parts = value.split(',');
    const wikilinks = [];
    const bodyLines = [];
    const convertedParts = [];
    for (const part of parts) {
      const name = extractWikilinkFromBacklink(part.trim());
      if (name) {
        const wikilink = formatWikilinkTarget(name);
        wikilinks.push(wikilink);
        bodyLines.push(`- ${wikilink}`);
        convertedParts.push(wikilink);
      } else {
        convertedParts.push(part.trim());
      }
    }
    return { wikilinks, bodyLines, converted: convertedParts.join(', ') };
  }

  return { wikilinks: [], bodyLines: [], converted: value };
}

export function convertMarkdownLinkToWiki(link, fileMap, currentFilePath, baseDir = null) {
  const match = link.match(/\[([^\]]*)\]\(([^)]+)\)/);
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

  if (!pathPart.endsWith('.md')) {
    const targetFilename = basename(decodedPath);
    const ext = extname(targetFilename).toLowerCase();

    if (KNOWN_EXTENSIONS.has(ext)) {
      if (ext === '.csv') {
        const databaseName = decodeURIComponent(linkText).trim();
        // Extract notionObjectId from CSV filename (32 hex chars before .csv)
        const csvBasename = basename(decodedPath, '.csv');
        const idMatch = csvBasename.match(/(?:\s|^)([0-9a-fA-F]{32})(?:_all)?$/);
        const notionObjectId = idMatch ? idMatch[1].toLowerCase() : null;
        if (notionObjectId) {
          let encodedRelativeDir = '';
          if (baseDir) {
            const resolvedCsvPath = resolve(dirname(currentFilePath), decodedPath);
            const intendedRelativeDir = relative(baseDir, dirname(resolvedCsvPath)).replace(/\\/g, '/');
            const normalizedRelativeDir = intendedRelativeDir === '.' ? '' : intendedRelativeDir;
            if (normalizedRelativeDir) {
              encodedRelativeDir = Buffer.from(normalizedRelativeDir, 'utf8').toString('base64url');
            }
          }
          const marker = `__CSV_${notionObjectId}__`;
          return encodedRelativeDir
            ? `[[${databaseName}|${marker}~${encodedRelativeDir}]]`
            : `[[${databaseName}|${marker}]]`;
        }
        return `[[${databaseName}]]`;
      }
      const cleanedFilename = cleanName(targetFilename);
      const decodedLinkText = decodeURIComponent(linkText);
      if (decodedLinkText === cleanedFilename || decodedLinkText === targetFilename) {
        return `[[${cleanedFilename}]]`;
      }
      return `[[${cleanedFilename}|${decodedLinkText}]]`;
    }

    const cleanedFilename = cleanName(targetFilename);
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
  const notionObjectId = extractNotionId(targetFilename)?.toLowerCase() || null;

  if (notionObjectId) {
    const decodedAnchor = anchor ? decodeURIComponent(anchor) : '';
    const encodedAnchor = decodedAnchor ? encodeMarkerAnchor(decodedAnchor) : '';
    const marker = encodedAnchor
      ? `__MD_${notionObjectId}__~${encodedAnchor}`
      : `__MD_${notionObjectId}__`;
    const displayText = (decodedLinkText || cleanedName).trim();
    if (!displayText) return link;
    return `[[${displayText}|${marker}]]`;
  }

  // Build wiki link with optional anchor
  const decodedAnchor = anchor ? decodeURIComponent(anchor) : '';
  const anchorPart = decodedAnchor ? `#${decodedAnchor}` : '';

  if (decodedLinkText === cleanedName || decodedLinkText === cleanedFilename) {
    // Simple wiki link
    return `[[${cleanedName}${anchorPart}]]`;
  } else {
    // Aliased wiki link
    return `[[${cleanedName}${anchorPart}|${decodedLinkText}]]`;
  }
}

// ============================================================================
// @ Mention Conversion
// ============================================================================

export function buildPageNameSet(fileMap) {
  const nameCounts = new Map();
  for (const [, entry] of fileMap) {
    const name = entry.cleanedName.replace(/\.md$/, '');
    if (name) {
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }
  }

  const names = new Set();
  for (const [name, count] of nameCounts) {
    if (count === 1) names.add(name);
  }
  return names;
}

/**
 * Converts @PageName mentions to [[PageName]] wikilinks.
 * Only converts when the name matches an existing page in the vault.
 * Sorts by length descending to prevent partial matches.
 */
export function convertAtMentions(text, pageNameSet) {
  if (!text.includes('@')) return text;

  const sortedNames = [...pageNameSet].sort((a, b) => b.length - a.length);

  for (const name of sortedNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<!\\[\\[)@${escaped}(?=@|\\[|\\s|$|[,;.!?)\\]}>])`, 'g');
    text = text.replace(pattern, `[[${name}]]`);
  }

  return text;
}
