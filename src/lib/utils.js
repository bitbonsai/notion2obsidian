import { extname } from "node:path";

// ============================================================================
// Configuration & Constants
// ============================================================================

export const PATTERNS = {
  hexId: /^[0-9a-fA-F]{32}$/,
  mdLink: /\[([^\]]*)\]\(([^)]+)\)/g,
  frontmatter: /^\uFEFF?\s*---\s*\n/,  // Only accept --- delimiters (Obsidian requirement)
  notionIdExtract: /\s([0-9a-fA-F]{32})(?:\.[^.]+)?$/,
  // Visual patterns for Notion callouts
  notionCallout: /<img src="https:\/\/www\.notion\.so\/icons\/([^"]+)" alt="[^"]*" width="[^"]*"\s*\/>\s*\n\s*\n\s*\*\*([^*]+)\*\*\s*\n\s*\n\s*([\s\S]*?)(?=<aside>|<\/aside>|\n\n[#*]|\n\n<|\Z)/g,
  notionAsideCallout: /<aside>\s*<img src="https:\/\/www\.notion\.so\/icons\/([^"]+)" alt="[^"]*" width="[^"]*"\s*\/>\s*([\s\S]*?)<\/aside>/g
};

export const BATCH_SIZE = 50;

// ============================================================================
// Utility Functions
// ============================================================================

export function isHexString(str) {
  return PATTERNS.hexId.test(str);
}

export function extractNotionId(filename) {
  const match = filename.match(PATTERNS.notionIdExtract);
  return match ? match[1] : null;
}

export function sanitizeFilename(name) {
  // Replace Windows forbidden characters: < > : " / \ | ? *
  // Also replace any other control characters
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-');
}

export function shortenFilename(filename, maxLength = 50) {
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

export function cleanName(filename) {
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

export function cleanDirName(dirname) {
  const parts = dirname.split(' ');
  if (parts.length > 1 && isHexString(parts[parts.length - 1])) {
    parts.pop();
    return sanitizeFilename(parts.join(' '));
  }
  return sanitizeFilename(dirname);
}

/**
 * Sanitizes a property name into a valid kebab-case frontmatter key.
 * Strips non-alphanumeric/CJK/hyphen characters and trims leading/trailing hyphens.
 * @param {string} name - Raw property/column name (e.g. "🛒 Shop Listing")
 * @returns {string} - Sanitized key (e.g. "shop-listing")
 */
export function sanitizeKey(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '')
    .replace(/^-+|-+$/g, '');
}

// Skeleton-based title normalization for dedup.
// Notion's zip export mangles filenames unpredictably (colons→spaces, dots→spaces,
// mailto: prefixes, @mentions, truncation). Instead of reverse-engineering each rule,
// we strip ALL non-alphanumeric/CJK characters to get a comparable "skeleton".
export function normalizeTitle(title) {
  return title
    .replace(/\s*\(https---www\.notion\.so-[0-9a-f]+-pvs=\d+\)/gi, '')
    .replace(/\s*\(https?:\/\/www\.notion\.so\/[^)]+\)/gi, '')
    .replace(/\b(mailto|https?|ftp)[-:]/gi, '')
    .replace(/@/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

// Prefix-aware skeleton match to handle Notion filename truncation.
// Requires ≥40 chars to prevent false positives on short titles.
// (Notion's typical filename truncation happens around 40+ characters.)
export function skeletonsMatch(skeletonA, skeletonB) {
  if (skeletonA === skeletonB) return true;
  const minLen = Math.min(skeletonA.length, skeletonB.length);
  if (minLen >= 40) {
    const shorter = skeletonA.length <= skeletonB.length ? skeletonA : skeletonB;
    const longer = skeletonA.length > skeletonB.length ? skeletonA : skeletonB;
    if (longer.startsWith(shorter)) return true;
  }
  return false;
}
