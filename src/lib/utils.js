import { extname } from "node:path";

// ============================================================================
// Configuration & Constants
// ============================================================================

export const PATTERNS = {
  hexId: /^[0-9a-fA-F]{32}$/,
  mdLink: /\[([^\]]+)\]\(([^)]+)\)/g,
  frontmatter: /^\uFEFF?\s*---\s*\n/,  // Only accept --- delimiters (Obsidian requirement)
  notionIdExtract: /\s([0-9a-fA-F]{32})(?:\.[^.]+)?$/,
  // Visual patterns for Notion callouts and images
  notionCallout: /<img src="https:\/\/www\.notion\.so\/icons\/([^"]+)" alt="[^"]*" width="[^"]*"\s*\/>\s*\n\s*\n\s*\*\*([^*]+)\*\*\s*\n\s*\n\s*([\s\S]*?)(?=<aside>|<\/aside>|\n\n[#*]|\n\n<|\Z)/g,
  notionAsideCallout: /<aside>\s*<img src="https:\/\/www\.notion\.so\/icons\/([^"]+)" alt="[^"]*" width="[^"]*"\s*\/>\s*([\s\S]*?)<\/aside>/g,
  coverImage: /^!\[([^\]]*)\]\(([^)]+)\)$/m  // First image in file
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
