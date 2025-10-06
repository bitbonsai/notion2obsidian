import { basename, dirname, join, relative } from "node:path";
import { cleanName } from "./utils.js";

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

// ============================================================================
// Link Conversion
// ============================================================================

export function convertMarkdownLinkToWiki(link, fileMap, currentFilePath) {
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
