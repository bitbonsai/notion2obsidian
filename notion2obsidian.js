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
import ora from "ora";

// Import from modular files
import {
  PATTERNS,
  BATCH_SIZE,
  isHexString,
  extractNotionId,
  normalizeTitle,
  sanitizeFilename,
  shortenFilename,
  cleanName,
  cleanDirName,
  skeletonsMatch
} from "./src/lib/utils.js";
import { MigrationStats } from "./src/lib/stats.js";
import { parseArgs, getVersion, showVersion, showHelp } from "./src/lib/cli.js";
import { buildFileMap, convertMarkdownLinkToWiki } from "./src/lib/links.js";
import { ICON_TO_CALLOUT, convertNotionCallouts } from "./src/lib/callouts.js";
import {
  extractInlineMetadataFromLines,
  getTagsFromPath,
  hasValidFrontmatter,
  parseFrontmatter,
  generateValidFrontmatter,
  generateFallbackFrontmatter,
  validateFrontmatter,
  cleanAssetPaths,
  processFileContent,
  updateFileContent,
  findDuplicateNames
} from "./src/lib/frontmatter.js";
import { resolveGlobPatterns, getAllDirectories } from "./src/lib/scanner.js";
import { openDirectory, promptForConfirmation } from "./src/lib/assets.js";
import { extractZipToSameDirectory, extractMultipleZips } from "./src/lib/zip.js";
import {
  processCsvDatabases,
  generateDatabaseIndex,
  generateSqlSealIndex,
  createNotesFromCsvRows,
  generateDataviewIndex,
  generateBaseFile,
  enrichMdWithCsvProperties,
  generateMissingMdFromCsv,
  stripNotionUrlFromTitle,
  findBasesReconciliationIssues,
  buildRowTitleMatchSkeletons
} from "./src/lib/csv.js";
import { enrichVault } from "./src/lib/enrich.js";

async function deriveNameFromHeading(filePath, cleanedName) {
  const currentBase = basename(cleanedName, '.md');
  const currentNormalized = normalizeTitle(currentBase);
  if (!currentNormalized || currentNormalized.length < 20) return cleanedName;

  let content;
  try {
    content = await Bun.file(filePath).text();
  } catch {
    return cleanedName;
  }

  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (!headingMatch) return cleanedName;

  const headingTitle = sanitizeFilename(headingMatch[1].trim()).slice(0, 180).trim();
  if (!headingTitle) return cleanedName;

  const headingNormalized = normalizeTitle(headingTitle);
  if (!headingNormalized) return cleanedName;
  const looksMojibake = /[ÃÂâ]/.test(currentBase);
  if (!headingNormalized.startsWith(currentNormalized)) {
    if (!looksMojibake) return cleanedName;
  }
  if (headingTitle.length <= currentBase.length && !looksMojibake) return cleanedName;

  return `${headingTitle}.md`;
}

async function buildMdDirectoryIndex(targetDir) {
  const index = new Map();
  const mdGlob = new Glob('**/*.md');
  for (const relPath of mdGlob.scanSync(targetDir)) {
    const fullPath = join(targetDir, relPath);
    const dir = dirname(fullPath);
    const base = basename(fullPath, '.md');
    const cleaned = cleanName(`${base}.md`).replace(/\.md$/, '');
    const normalizedBase = normalizeTitle(base);
    const normalizedCleaned = normalizeTitle(cleaned);
    
    let heading = null;
    let frontmatterTitle = null;
    
    let content = '';
    try {
      content = readFileSync(fullPath, 'utf-8');
      
      // Extract first H1 heading
      const headingMatch = content.match(/^#\s+(.+)$/m);
      if (headingMatch) {
        heading = headingMatch[1].trim() || null;
      }
      
      // Extract frontmatter title
      try {
        const parsed = matter(content);
        if (parsed.data && parsed.data.title) {
          frontmatterTitle = String(parsed.data.title).trim() || null;
        }
      } catch { /* skip */ }
    } catch { /* skip */ }
    
    const entry = { fullPath, normalizedBase, normalizedCleaned, heading, frontmatterTitle };
    if (!index.has(dir)) index.set(dir, []);
    index.get(dir).push(entry);
  }
  return index;
}

function matchesRowTitleSet(candidate, rowTitleSet) {
  const normalizedCandidate = normalizeTitle(candidate);
  if (!normalizedCandidate) return false;
  if (rowTitleSet.has(normalizedCandidate)) return true;
  for (const rowTitle of rowTitleSet) {
    if (skeletonsMatch(normalizedCandidate, rowTitle)) {
      return true;
    }
  }
  return false;
}

function resolveDatabaseRowDirectory(csvInfo, mdDirectoryIndex, targetDir) {
  const csvDir = dirname(csvInfo.path);
  const rowTitleSet = new Set();
  for (const row of csvInfo.rows) {
    const raw = (row[0] || '').replace(/^"|"$/g, '').trim();
    const titleSkeletons = buildRowTitleMatchSkeletons(raw, 'Untitled');
    for (const normalized of titleSkeletons) {
      if (normalized) rowTitleSet.add(normalized);
    }
  }

  if (rowTitleSet.size === 0) {
    return { type: 'none', dir: csvDir, bestScore: 0 };
  }

  const scores = [];
  for (const [dir, entries] of mdDirectoryIndex.entries()) {
    let matchCount = 0;
    for (const entry of entries) {
      const entryMatched = [
        entry.normalizedBase,
        entry.normalizedCleaned,
        entry.heading,
        entry.frontmatterTitle
      ].some(candidate => candidate && matchesRowTitleSet(candidate, rowTitleSet));

      if (entryMatched) {
        matchCount++;
      }
    }
    if (matchCount > 0) {
      const ratio = matchCount / Math.max(1, Math.min(entries.length, rowTitleSet.size));
      const csvParent = dirname(csvDir);
      const isSameDir = dir === csvDir;
      const isNearby = dir.startsWith(`${csvParent}${sep}`) || csvDir.startsWith(`${dir}${sep}`);
      const localityBonus = isSameDir ? 0.2 : isNearby ? 0.1 : 0;
      scores.push({ dir, matchCount, ratio, weightedScore: matchCount + ratio + localityBonus });
    }
  }

  if (scores.length === 0) {
    return { type: 'none', dir: csvDir, bestScore: 0 };
  }

  scores.sort((a, b) => b.weightedScore - a.weightedScore || b.matchCount - a.matchCount || b.ratio - a.ratio);
  const best = scores[0];
  const second = scores[1];
  const minRequired = rowTitleSet.size >= 20 ? 5 : rowTitleSet.size >= 10 ? 3 : rowTitleSet.size >= 4 ? 2 : 1;
  const coverage = best.matchCount / Math.max(1, rowTitleSet.size);
  const confident = best.matchCount >= minRequired && best.ratio >= 0.25 && coverage >= 0.2;

  if (!confident) {
    return { type: 'none', dir: csvDir, bestScore: best.matchCount, bestDir: best.dir };
  }

  if (second) {
    const tieLike = Math.abs(second.weightedScore - best.weightedScore) < 0.5;
    const weakLead = (best.matchCount - second.matchCount) < 2;
    if (tieLike || weakLead) {
      return { type: 'ambiguous', dir: csvDir, bestScore: best.matchCount, bestDir: best.dir };
    }
  }

  if (coverage < 0.3 && rowTitleSet.size >= 6) {
    return { type: 'ambiguous', dir: csvDir, bestScore: best.matchCount, bestDir: best.dir };
  }

  return { type: 'matched', dir: best.dir, bestScore: best.matchCount, bestDir: best.dir };
}

function normalizeRelativeDirPath(relPath) {
  if (!relPath || relPath === '.') return '';
  return String(relPath).replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '');
}

function splitRelativeDir(relPath) {
  const normalized = normalizeRelativeDirPath(relPath);
  return normalized ? normalized.split('/') : [];
}

function isSegmentPrefix(prefix, value) {
  if (prefix.length > value.length) return false;
  return prefix.every((segment, index) => value[index] === segment);
}

function scoreCsvTargetLocality(noteRelativePath, candidateRelativeDir) {
  const noteDir = normalizeRelativeDirPath(dirname(noteRelativePath));
  const noteSegments = splitRelativeDir(noteDir);
  const candidateSegments = splitRelativeDir(candidateRelativeDir);
  const normalizedNoteBase = normalizeTitle(basename(noteRelativePath, '.md'));
  const normalizedCandidateLeaf = normalizeTitle(basename(normalizeRelativeDirPath(candidateRelativeDir)));

  if (normalizedNoteBase && normalizedCandidateLeaf && normalizedNoteBase === normalizedCandidateLeaf) {
    return { rank: -1, distance: 0, noteDir };
  }

  if (noteDir === normalizeRelativeDirPath(candidateRelativeDir)) {
    return { rank: 0, distance: 0, noteDir };
  }

  if (isSegmentPrefix(noteSegments, candidateSegments)) {
    return {
      rank: 1,
      distance: candidateSegments.length - noteSegments.length,
      noteDir
    };
  }

  if (isSegmentPrefix(candidateSegments, noteSegments)) {
    return {
      rank: 2,
      distance: noteSegments.length - candidateSegments.length,
      noteDir
    };
  }

  return { rank: 3, distance: Number.POSITIVE_INFINITY, noteDir };
}

function selectBestCsvTargetForNote(noteRelativePath, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { status: 'no-candidate', candidates: [] };
  }

  const scoredCandidates = candidates.map(candidate => ({
    ...candidate,
    ...scoreCsvTargetLocality(noteRelativePath, candidate.relativeDir)
  }));

  const bestRank = Math.min(...scoredCandidates.map(candidate => candidate.rank));
  const bestRankCandidates = scoredCandidates.filter(candidate => candidate.rank === bestRank);

  if (bestRank === 3) {
    if (bestRankCandidates.length === 1) {
      return { status: 'matched', target: bestRankCandidates[0], candidates: scoredCandidates };
    }
    return { status: 'ambiguous', candidates: scoredCandidates };
  }

  const bestDistance = Math.min(...bestRankCandidates.map(candidate => candidate.distance));
  const bestCandidates = bestRankCandidates.filter(candidate => candidate.distance === bestDistance);

  if (bestCandidates.length !== 1) {
    return { status: 'ambiguous', candidates: scoredCandidates };
  }

  return { status: 'matched', target: bestCandidates[0], candidates: scoredCandidates };
}

function addCsvRewriteTarget(targetsByName, databaseName, targetInfo) {
  const key = String(databaseName || '').toLowerCase();
  if (!targetsByName.has(key)) targetsByName.set(key, []);
  targetsByName.get(key).push(targetInfo);
}

function createCsvReviewEntry({
  notePath,
  originalLinkText,
  linkClass,
  databaseName = null,
  objectId = null,
  candidates = [],
  chosenTarget = null,
  reason
}) {
  return {
    notePath,
    originalLinkText,
    linkClass,
    databaseName,
    objectId,
    reason,
    chosenTarget: chosenTarget ? {
      targetPath: chosenTarget.targetPath,
      targetType: chosenTarget.targetType
    } : null,
    candidates: candidates.map(candidate => ({
      targetPath: candidate.targetPath,
      targetType: candidate.targetType,
      relativeDir: candidate.relativeDir
    }))
  };
}

const CSV_MARKER_TOKEN_PATTERN = '(?:__|\\*\\*)CSV_([a-f0-9]{32})(?:__|\\*\\*)(?:~([A-Za-z0-9_-]+))?';
const MD_MARKER_TOKEN_PATTERN = '(?:__|\\*\\*)MD_([a-f0-9]{32})(?:__|\\*\\*)(?:~([A-Za-z0-9_-]+))?';

function decodeCsvMarkerRelativeDir(encodedRelativeDir) {
  if (!encodedRelativeDir) return null;
  try {
    const decoded = Buffer.from(encodedRelativeDir, 'base64url').toString('utf8').trim();
    if (!decoded || decoded === '.') return '';
    return decoded.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '');
  } catch {
    return null;
  }
}

function buildMissingCsvRecoveryContext(targetDir) {
  const mdGlob = new Glob('**/*.md');
  const subtreeMarkdownCount = new Map();

  for (const mdRelPath of mdGlob.scanSync(targetDir)) {
    let currentDir = normalizeRelativeDirPath(dirname(mdRelPath));
    while (true) {
      subtreeMarkdownCount.set(currentDir, (subtreeMarkdownCount.get(currentDir) || 0) + 1);
      if (!currentDir) break;
      const parentDir = normalizeRelativeDirPath(dirname(currentDir));
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }
  }

  const childDirsByParent = new Map();
  for (const dirRelPathRaw of getAllDirectoriesSync(targetDir)) {
    const dirRelPath = normalizeRelativeDirPath(dirRelPathRaw);
    const parentDir = normalizeRelativeDirPath(dirname(dirRelPath));
    if (!childDirsByParent.has(parentDir)) childDirsByParent.set(parentDir, []);
    childDirsByParent.get(parentDir).push({
      relativeDir: dirRelPath,
      dirName: basename(dirRelPath),
      normalizedName: normalizeTitle(cleanDirName(basename(dirRelPath))),
      hasMarkdown: (subtreeMarkdownCount.get(dirRelPath) || 0) > 0
    });
  }

  return { childDirsByParent };
}

function getAllDirectoriesSync(rootDir) {
  const dirs = [];
  const stack = [''];
  while (stack.length > 0) {
    const currentRel = stack.pop();
    const currentAbs = currentRel ? join(rootDir, currentRel) : rootDir;
    for (const entry of readdirSync(currentAbs, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const childRel = normalizeRelativeDirPath(join(currentRel, entry.name));
        dirs.push(childRel);
        stack.push(childRel);
      }
    }
  }
  return dirs;
}

function generateRecoveredDirectoryIndex(dbName, childDirAbs, targetDir, intendedRelativeDir) {
  const noteGlob = new Glob('**/*.md');
  const noteLinks = [];
  for (const noteRelUnderChild of noteGlob.scanSync(childDirAbs)) {
    const absoluteNotePath = join(childDirAbs, noteRelUnderChild);
    const relativeToIntended = relative(join(targetDir, intendedRelativeDir), absoluteNotePath).replace(/\\/g, '/');
    const wikiTarget = relativeToIntended.replace(/\.md$/, '');
    const label = basename(noteRelUnderChild, '.md');
    noteLinks.push(`- [[${wikiTarget}|${label}]]`);
  }

  let markdown = `# ${dbName}\n\n`;
  markdown += `Recovered index for a database link whose CSV file was not present in the export.\n\n`;
  if (noteLinks.length > 0) {
    markdown += `## Notes\n\n${noteLinks.join('\n')}\n`;
  } else {
    markdown += `No child notes were found in the recovered directory.\n`;
  }
  return markdown;
}

async function materializeMissingCsvDirectoryTargets(targetDir, missingMarkerHints, csvTargetsByName, recoveryContext) {
  const createdTargets = new Map();
  let createdCount = 0;

  for (const hint of missingMarkerHints) {
    const intendedRelativeDir = decodeCsvMarkerRelativeDir(hint.encodedRelativeDir);
    if (intendedRelativeDir == null) continue;

    const dbKey = String(hint.databaseName || '').trim().toLowerCase();
    const existingCandidates = csvTargetsByName.get(dbKey) || [];
    const exactDirCandidates = existingCandidates.filter(candidate =>
      normalizeRelativeDirPath(candidate.relativeDir) === normalizeRelativeDirPath(intendedRelativeDir)
    );
    if (exactDirCandidates.length > 0) continue;

    const recoveryKey = `${normalizeRelativeDirPath(intendedRelativeDir)}::${dbKey}`;
    if (createdTargets.has(recoveryKey)) {
      continue;
    }

    const childDirCandidates = (recoveryContext.childDirsByParent.get(normalizeRelativeDirPath(intendedRelativeDir)) || [])
      .filter(candidate => candidate.hasMarkdown && candidate.normalizedName === normalizeTitle(hint.databaseName));

    if (childDirCandidates.length !== 1) continue;

    const childDir = childDirCandidates[0];
    const intendedAbsDir = join(targetDir, intendedRelativeDir);
    let fileName = `${hint.databaseName}_Index.md`;
    let counter = 2;
    while (statSync(join(intendedAbsDir, fileName), { throwIfNoEntry: false })) {
      fileName = `${hint.databaseName}_Index ${counter}.md`;
      counter++;
    }

    const indexContent = generateRecoveredDirectoryIndex(
      hint.databaseName,
      join(targetDir, childDir.relativeDir),
      targetDir,
      intendedRelativeDir
    );
    await Bun.write(join(intendedAbsDir, fileName), indexContent);

    const targetInfo = {
      databaseName: hint.databaseName,
      targetPath: fileName,
      relativeDir: intendedRelativeDir,
      targetType: 'index'
    };
    createdTargets.set(recoveryKey, targetInfo);
    addCsvRewriteTarget(csvTargetsByName, hint.databaseName, targetInfo);
    createdCount++;
  }

  return createdCount;
}

function resolveMissingExportCsvLink(dbName, encodedRelativeDir, csvTargetsByName, noteTargetsByName = new Map()) {
  const csvCandidates = csvTargetsByName.get(String(dbName || '').trim().toLowerCase()) || [];
  const noteCandidates = noteTargetsByName.get(String(dbName || '').trim().toLowerCase()) || [];
  const intendedRelativeDir = decodeCsvMarkerRelativeDir(encodedRelativeDir);

  if (!intendedRelativeDir) {
    return {
      status: csvCandidates.length + noteCandidates.length === 0 ? 'missing-export-file' : 'missing-export-file-ambiguous',
      candidates: [...csvCandidates, ...noteCandidates]
    };
  }

  const csvResolution = resolveMissingExportTargetInSubtree(intendedRelativeDir, csvCandidates);
  if (csvResolution.status === 'matched') {
    return { status: 'matched', target: csvResolution.target, candidates: csvCandidates };
  }
  if (csvResolution.status === 'ambiguous') {
    return { status: 'missing-export-file-ambiguous', candidates: csvResolution.candidates };
  }

  const noteResolution = resolveMissingExportTargetInSubtree(intendedRelativeDir, noteCandidates);
  if (noteResolution.status === 'matched') {
    return { status: 'matched', target: noteResolution.target, candidates: noteCandidates };
  }
  if (noteResolution.status === 'ambiguous') {
    return { status: 'missing-export-file-ambiguous', candidates: noteResolution.candidates };
  }

  return {
    status: csvCandidates.length + noteCandidates.length === 0 ? 'missing-export-file' : 'missing-export-file-ambiguous',
    candidates: [...csvCandidates, ...noteCandidates]
  };
}

function csvQualifiedWikiTarget(relativeDir, targetPath, notePath, ambiguous) {
  const bareName = targetPath.replace(/\.(md|base)$/, '');
  if (!ambiguous) return bareName;
  if (relativeDir) return `${relativeDir}/${bareName}`;
  const noteDir = normalizeRelativeDirPath(dirname(String(notePath || '').replace(/\\/g, '/')));
  if (!noteDir) return bareName;
  const depth = noteDir.split('/').length;
  if (depth === 1) return `../${bareName}`;
  return `${Array(depth).fill('..').join('/')}/${bareName}`;
}

function isCsvNameAmbiguous(dbName, csvTargetsByName) {
  const candidates = csvTargetsByName.get(String(dbName || '').trim().toLowerCase());
  if (!candidates || candidates.length <= 1) return false;
  const uniqueDirs = new Set(candidates.map(c => normalizeRelativeDirPath(c.relativeDir)));
  return uniqueDirs.size > 1;
}

function resolveCsvMarkerLink(dbName, notionObjectId, encodedRelativeDir, csvObjectIdMap, noteObjectIdMap, csvTargetsByName, noteTargetsByName, csvWikilinkReview, notePath, originalLinkText) {
  const targetInfo = csvObjectIdMap.get(notionObjectId);
  if (targetInfo) {
    const wikiTarget = csvQualifiedWikiTarget(targetInfo.relativeDir, targetInfo.targetPath, notePath, isCsvNameAmbiguous(dbName, csvTargetsByName));
    return {
      resolvedText: `[[${wikiTarget}|${dbName}]]`,
      exactRestored: true
    };
  }

  const noteTargetInfo = noteObjectIdMap.get(String(notionObjectId || '').toLowerCase());
  if (noteTargetInfo) {
    return {
      resolvedText: `[[${noteTargetInfo.wikiTarget}|${dbName}]]`,
      exactRestored: true
    };
  }

  const missingExportResolution = resolveMissingExportCsvLink(dbName, encodedRelativeDir, csvTargetsByName, noteTargetsByName);
  if (missingExportResolution.status === 'matched') {
    const target = missingExportResolution.target;
    const wikiTarget = csvQualifiedWikiTarget(target.relativeDir, target.targetPath, notePath, isCsvNameAmbiguous(dbName, csvTargetsByName));
    return {
      resolvedText: `[[${wikiTarget}|${dbName}]]`,
      exactRestored: true
    };
  }

  csvWikilinkReview.push(createCsvReviewEntry({
    notePath,
    originalLinkText,
    linkClass: 'marker',
    databaseName: dbName,
    objectId: notionObjectId,
    reason: missingExportResolution.status,
    candidates: missingExportResolution.candidates
  }));

  return {
    resolvedText: `[[${dbName}]]`,
    exactRestored: false
  };
}

function buildNoteObjectIdMap(targetDir) {
  const noteObjectIdMap = new Map();
  const mdGlob = new Glob('**/*.md');

  for (const mdRelPathRaw of mdGlob.scanSync(targetDir)) {
    const mdRelPath = mdRelPathRaw.replace(/\\/g, '/');
    let content;
    try {
      content = readFileSync(join(targetDir, mdRelPath), 'utf8');
    } catch {
      continue;
    }

    let parsed;
    try {
      parsed = matter(content);
    } catch {
      continue;
    }

    const notionId = String(parsed?.data?.['notion-id'] || '').trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(notionId)) continue;

    noteObjectIdMap.set(notionId, {
      relativePath: mdRelPath,
      wikiTarget: mdRelPath.replace(/\.md$/, ''),
      title: basename(mdRelPath, '.md')
    });
  }

  return noteObjectIdMap;
}

function buildNoteTargetsByName(noteObjectIdMap) {
  const noteTargetsByName = new Map();
  for (const targetInfo of noteObjectIdMap.values()) {
    addCsvRewriteTarget(noteTargetsByName, targetInfo.title, {
      targetPath: `${basename(targetInfo.relativePath)}`,
      relativeDir: normalizeRelativeDirPath(dirname(targetInfo.relativePath)),
      targetType: 'note',
      databaseName: targetInfo.title
    });
  }
  return noteTargetsByName;
}

function resolveMissingExportTargetInSubtree(intendedRelativeDir, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { status: 'none', candidates: [] };
  }

  const normalizedIntendedDir = normalizeRelativeDirPath(intendedRelativeDir);
  if (!normalizedIntendedDir) {
    return {
      status: candidates.length === 1 ? 'matched' : 'ambiguous',
      target: candidates.length === 1 ? candidates[0] : null,
      candidates
    };
  }

  const exactDirCandidates = candidates.filter(candidate =>
    normalizeRelativeDirPath(candidate.relativeDir) === normalizedIntendedDir
  );
  if (exactDirCandidates.length === 1) {
    return { status: 'matched', target: exactDirCandidates[0], candidates };
  }
  if (exactDirCandidates.length > 1) {
    return { status: 'ambiguous', candidates: exactDirCandidates };
  }

  const descendantCandidates = candidates.filter((candidate) => {
    const candidateDir = normalizeRelativeDirPath(candidate.relativeDir);
    return candidateDir.startsWith(`${normalizedIntendedDir}/`);
  });
  if (descendantCandidates.length === 1) {
    return { status: 'matched', target: descendantCandidates[0], candidates };
  }
  if (descendantCandidates.length > 1) {
    return { status: 'ambiguous', candidates: descendantCandidates };
  }

  return { status: 'none', candidates };
}

function decodeMarkerAnchor(encodedAnchor) {
  if (!encodedAnchor) return '';
  try {
    return Buffer.from(encodedAnchor, 'base64url').toString('utf8').trim();
  } catch {
    return '';
  }
}

function appendAnchorToWikiTarget(wikiTarget, anchor) {
  const normalizedAnchor = String(anchor || '').trim();
  return normalizedAnchor ? `${wikiTarget}#${normalizedAnchor}` : wikiTarget;
}

function resolveMdMarkerLink(displayText, notionObjectId, encodedAnchor, noteObjectIdMap) {
  const anchor = decodeMarkerAnchor(encodedAnchor);
  const targetInfo = noteObjectIdMap.get(String(notionObjectId || '').toLowerCase());
  if (!targetInfo) {
    return {
      resolvedText: `[[${appendAnchorToWikiTarget(displayText, anchor)}]]`,
      exactRestored: false
    };
  }

  const targetWithAnchor = appendAnchorToWikiTarget(targetInfo.wikiTarget, anchor);

  if (!displayText || displayText === targetInfo.title) {
    return {
      resolvedText: `[[${targetWithAnchor}]]`,
      exactRestored: true
    };
  }

  return {
    resolvedText: `[[${targetWithAnchor}|${displayText}]]`,
    exactRestored: true
  };
}

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
// Main Migration Logic
// ============================================================================

async function main() {
  const { Glob } = await import('bun');
  const config = parseArgs();
  const stats = new MigrationStats();
  let extractedTempDir = null;

  // Show header
  console.log(chalk.blueBright.bold('💎 Notion 2 Obsidian') + ' ' + chalk.gray(`v${getVersion()}`) + '\n');

  // Handle enrichment mode
  if (config.enrich) {
    // Enrichment requires a single directory path
    if (config.targetPaths.length !== 1) {
      console.log(chalk.red('✗ Enrichment mode requires exactly one directory path'));
      console.log(chalk.gray('Usage: notion2obsidian <vault-directory> --enrich\n'));
      process.exit(1);
    }

    const vaultPath = config.targetPaths[0];
    const vaultStat = await stat(vaultPath).catch(() => null);

    if (!vaultStat || !vaultStat.isDirectory()) {
      console.log(chalk.red(`✗ Path is not a directory: ${vaultPath}`));
      console.log(chalk.gray('Enrichment requires a directory containing migrated Notion pages\n'));
      process.exit(1);
    }

    // Run enrichment
    await enrichVault(vaultPath, {
      dryRun: config.dryRun,
      verbose: config.verbose
    });

    process.exit(0);
  }

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

    // If output directory is specified, copy content there
    if (config.outputDir) {
      const { cp } = await import('node:fs/promises');
      console.log(chalk.cyan('📋 Copying content to output directory...'));
      await mkdir(config.outputDir, { recursive: true });

      // Copy all content from source to output directory
      const sourceEntries = await readdir(targetDir);
      for (const entry of sourceEntries) {
        const sourcePath = join(targetDir, entry);
        const targetPath = join(config.outputDir, entry);

        // Use recursive copy for directories
        if ((await stat(sourcePath)).isDirectory()) {
          await cp(sourcePath, targetPath, { recursive: true, force: true });
        } else {
          await copyFile(sourcePath, targetPath);
        }
      }

      targetDir = config.outputDir;
      console.log(chalk.green('✓ Content copied to output directory\n'));
    }

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

    // Show warning if using current directory without explicit argument
    if (!config.pathsExplicitlyProvided) {
      const cwd = process.cwd();
      console.log(chalk.yellow('⚠ No directory specified. Running on current directory:'));
      console.log(chalk.blue(`  ${cwd}\n`));
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
    console.log(chalk.gray('Expected filenames like: "Document abc123def456...xyz.md"'));
    console.log(chalk.gray('Proceeding anyway...\n'));
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
    let cleanedName = cleanName(filename);
    const notionId = extractNotionId(filename);

    // Remove trailing -\d+ suffix if it matches a sibling or parent directory
    // This handles Notion's collision naming (e.g., Atlassian-1.md when there's an Atlassian/ folder)
    const nameWithoutExt = cleanedName.replace(/\.md$/, '');
    const trailingNumberMatch = nameWithoutExt.match(/^(.+)-(\d+)$/);

    if (trailingNumberMatch) {
      const baseName = trailingNumberMatch[1];

      // Check if file is inside a directory with matching name
      const parentDir = basename(dirname(filePath));
      const cleanedParentDir = cleanDirName(parentDir);

      if (baseName === cleanedParentDir) {
        cleanedName = baseName + '.md';
      } else {
        // Check if there's a sibling directory that will receive this file
        const mdFileBase = basename(filePath, '.md');
        const siblingDirPath = join(dirname(filePath), mdFileBase);

        // If sibling directory exists, the file will be moved into it in Step 2
        if (dirs.includes(siblingDirPath)) {
          const cleanedSiblingDir = cleanDirName(basename(siblingDirPath));
          if (baseName === cleanedSiblingDir) {
            cleanedName = baseName + '.md';
          }
        }
      }
    }

    if (notionId) {
      cleanedName = await deriveNameFromHeading(filePath, cleanedName);
    }

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

  for (const file of fileMigrationMap) {
    const filename = basename(file.oldPath);
    const entry = fileMap.get(filename);
    if (entry) entry.cleanedName = file.newName;
    const encoded = encodeURIComponent(filename);
    const encodedEntry = fileMap.get(encoded);
    if (encodedEntry) encodedEntry.cleanedName = file.newName;
  }

  // Re-check for heading-derived collisions: deriveNameFromHeading() can cause
  // two previously distinct files in the same directory to converge on the same
  // cleanedName. Detect and suffix so that fileMap, frontmatter, and Step 4
  // all agree on the final name.
  {
    const dirFiles = new Map();
    for (let i = 0; i < fileMigrationMap.length; i++) {
      const f = fileMigrationMap[i];
      const dir = dirname(f.oldPath);
      if (!dirFiles.has(dir)) dirFiles.set(dir, []);
      dirFiles.get(dir).push({ index: i, newName: f.newName, oldName: f.oldName });
    }
    for (const [, entries] of dirFiles) {
      const nameCount = new Map();
      for (const e of entries) {
        nameCount.set(e.newName, (nameCount.get(e.newName) || 0) + 1);
      }
      for (const e of entries) {
        if (nameCount.get(e.newName) <= 1) continue;
        const base = e.newName.replace(/\.md$/, '');
        const ext = '.md';
        let counter = 1;
        let uniqueName = `${base}-${counter}${ext}`;
        while (nameCount.has(uniqueName)) {
          counter++;
          uniqueName = `${base}-${counter}${ext}`;
        }
        nameCount.set(uniqueName, 1);
        nameCount.set(e.newName, nameCount.get(e.newName) - 1);

        const file = fileMigrationMap[e.index];
        file.newName = uniqueName;
        file.newPath = join(dirname(file.oldPath), uniqueName);
        file.metadata.title = uniqueName.replace('.md', '');
        if (file.needsRename || e.oldName !== uniqueName) file.needsRename = true;

        const filename = basename(file.oldPath);
        const entry = fileMap.get(filename);
        if (entry) entry.cleanedName = uniqueName;
        const encoded = encodeURIComponent(filename);
        const encodedEntry = fileMap.get(encoded);
        if (encodedEntry) encodedEntry.cleanedName = uniqueName;
      }
    }
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
    const { linkCount } = await processFileContent(sample.oldPath, sample.metadata, fileMap, targetDir, dirNameMap, {
      inferMetadata: config.inferMetadata
    });
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
  // Create spinner for migration steps
  const spinner = ora({
    text: 'Step 1/5: Adding frontmatter and converting links...',
    color: 'cyan'
  }).start();

  // Process files in batches
  for (let i = 0; i < fileMigrationMap.length; i += BATCH_SIZE) {
    const batch = fileMigrationMap.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(file => {
        return updateFileContent(file.oldPath, file.metadata, fileMap, targetDir, dirNameMap, {
          inferMetadata: config.inferMetadata
        });
      })
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

  spinner.succeed(`Step 1/5: Processed ${stats.processedFiles} files, converted ${stats.totalLinks} links`);

  // Step 2: Organize attachments (before renaming, while names still match!)
  spinner.start('Step 2/5: Organizing files with attachments...');

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

        // Update file paths in the migration map
        file.oldPath = newMdPath;
        file.newPath = newMdPath; // Already at final name

        // Add the NEW path (after moving) to the set
        filesMovedIntoFolders.add(newMdPath);

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

  spinner.succeed(`Step 2/5: Moved ${movedFiles} files into their attachment folders`);

  // Step 3: Rename directories (deepest first to avoid path conflicts)
  spinner.start('Step 3/5: Renaming directories...');

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

  spinner.succeed(`Step 3/5: Renamed ${stats.renamedDirs} directories`);

  // Update file paths in fileMigrationMap and filesMovedIntoFolders to reflect renamed directories
  // Process directories from deepest to shallowest to handle nested renames correctly
  const updatedMovedFiles = new Set();
  for (const file of fileMigrationMap) {
    let originalPath = file.oldPath;
    // Apply directory renames in reverse order (deepest first already sorted)
    for (const dir of dirMigrationMap) {
      // Check if file is inside this renamed directory
      if (file.oldPath.startsWith(dir.oldPath + '/') && dir.actualNewPath) {
        // Replace only the first occurrence (the directory path prefix)
        const relativePath = file.oldPath.substring(dir.oldPath.length);
        file.oldPath = dir.actualNewPath + relativePath;
      }
    }
    // Debug logging for problematic files
    if (originalPath !== file.oldPath && config.verbose) {
      console.log(`    Updated file path: ${originalPath} → ${file.oldPath}`);
    }
    // Update the filesMovedIntoFolders set with new paths
    if (filesMovedIntoFolders.has(originalPath)) {
      updatedMovedFiles.add(file.oldPath);
    }
  }
  // Replace the old set with updated paths
  filesMovedIntoFolders.clear();
  for (const path of updatedMovedFiles) {
    filesMovedIntoFolders.add(path);
  }

  // Step 4: Rename individual files that weren't moved to attachment folders
  spinner.start('Step 4/5: Renaming individual files...');

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
        let alternativePath;

        if (targetStat.isDirectory()) {
          // Directory exists with same name - move file into the directory
          alternativePath = join(newPath, file.newName);

          // If file already exists inside directory, add counter
          if (await stat(alternativePath).catch(() => null)) {
            let counter = 1;
            let altName = `${baseName}-${counter}${extension}`;
            alternativePath = join(newPath, altName);

            while (await stat(alternativePath).catch(() => null)) {
              counter++;
              altName = `${baseName}-${counter}${extension}`;
              alternativePath = join(newPath, altName);
            }
          }

          await rename(oldPath, alternativePath);
          const relativePath = alternativePath.replace(targetDir + sep, '');
          stats.addNamingConflict(oldPath, `Moved into directory: ${relativePath}`);
          stats.renamedFiles++;
        } else {
          // File exists - create alternative name with counter
          let counter = 1;
          let alternativeName = `${baseName}-${counter}${extension}`;
          alternativePath = join(dir, alternativeName);

          while ((await stat(alternativePath).catch(() => null))?.isFile()) {
            counter++;
            alternativeName = `${baseName}-${counter}${extension}`;
            alternativePath = join(dir, alternativeName);
          }

          await rename(oldPath, alternativePath);
          stats.addNamingConflict(oldPath, `Target exists, renamed to ${alternativeName}`);
          stats.renamedFiles++;
        }
      } else {
        await rename(oldPath, newPath);
        stats.renamedFiles++;
      }
    } catch (error) {
      console.warn(chalk.yellow(`    ⚠ Failed to rename ${file.oldPath}: ${error.message}`));
    }
  }

  spinner.succeed(`Step 4/5: Renamed ${stats.renamedFiles} individual files`);

  // Step 5: Normalize all images and references
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'];

  // Step 5a: Normalize ALL image files in ALL directories
  spinner.start('Step 5/5: Normalizing image files and references...');

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


  // Step 5b: Update all image references using remark (proper markdown parsing)

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
    newContent = newContent.replace(/\\(_)/g, '$1'); // Fix any escaped underscores (emphasis)

    // Only write if content actually changed
    if (newContent !== content) {
      await Bun.write(mdPath, newContent);
    }
  }

  spinner.succeed(`Step 5/5: Normalized ${normalizedImages} images and ${updatedReferences} references`);

  // Step 6: Process CSV databases if enabled
  if (config.processCsv) {
    const modeText = config.basesMode 
      ? 'with Obsidian Bases support...' 
      : config.dataviewMode 
        ? 'with Dataview support...' 
        : '';
    console.log(chalk.green(`Step 6: Processing CSV databases ${modeText}`));

    const csvFiles = await processCsvDatabases(targetDir);
    let csvIndexesCreated = 0;
    let totalNotesCreated = 0;
    let baseFilesCreated = 0;
    const rowMatchAbstained = [];
    const mdDirectoryIndex = await buildMdDirectoryIndex(targetDir);
    const globalExistingSkeletons = [];
    const seenSkeletons = new Set();
    for (const entries of mdDirectoryIndex.values()) {
      for (const entry of entries) {
        for (const skeleton of [entry.normalizedBase, entry.normalizedCleaned]) {
          if (!skeleton || seenSkeletons.has(skeleton)) continue;
          seenSkeletons.add(skeleton);
          globalExistingSkeletons.push(skeleton);
        }
      }
    }

    // Create _databases folder if in Dataview mode (not used in bases mode)
    let databasesDir = null;
    if (config.dataviewMode && !config.basesMode && csvFiles.length > 0) {
      databasesDir = join(targetDir, '_databases');
      await mkdir(databasesDir, { recursive: true });
    }

    // Legacy name-based rewrite map for default/dataview flows.
    const csvWikilinkMap = new Map();
    const csvTargetsByName = new Map(); // lower(databaseName) → [{ targetPath, relativeDir, targetType, ... }]
    const csvObjectIdMap = new Map(); // notionObjectId → { targetPath, relativeDir, databaseName, targetType }
    const csvWikilinkReview = [];

    for (const csvInfo of csvFiles) {
      try {
        if (config.basesMode) {
          const csvDir = dirname(csvInfo.path);
          const resolvedRowDir = resolveDatabaseRowDirectory(csvInfo, mdDirectoryIndex, targetDir);
          csvInfo._resolvedType = resolvedRowDir.type;
          let dbDir = resolvedRowDir.dir;

          let enrichResult = { enriched: 0, skipped: 0 };
          let createdCount = 0;

          if (resolvedRowDir.type === 'matched') {
            enrichResult = await enrichMdWithCsvProperties(csvInfo, dbDir);
            const abstainBefore = rowMatchAbstained.length;
            createdCount = await generateMissingMdFromCsv(csvInfo, dbDir, {
              globalExistingSkeletons,
              allowCreateDir: false,
              abstainCollector: rowMatchAbstained
            });
            totalNotesCreated += createdCount;

            if (config.verbose) {
              const abstainedForDb = rowMatchAbstained.length - abstainBefore;
              if (abstainedForDb > 0) {
                console.log(`    ⚠ Abstained ${abstainedForDb} uncertain row-note match(es) for ${csvInfo.databaseName}`);
              }
            }
          }

          if (config.verbose) {
            console.log(`    ✓ Enriched ${enrichResult.enriched} MD files with CSV data`);
            if (resolvedRowDir.type === 'matched') {
              console.log(`    ✓ Row directory matched: ${relative(targetDir, dbDir)} (${resolvedRowDir.bestScore} title matches)`);
            } else {
              console.log(`    ⚠ Row directory unresolved (${resolvedRowDir.type}); skipped row-note generation for ${csvInfo.databaseName}`);
            }
          }

          if (config.verbose && createdCount > 0) {
            console.log(`    ✓ Generated ${createdCount} MD files from CSV rows`);
          }

          // Clean CSV filename: strip Notion ID, rename on disk
          const cleanCsvName = csvInfo.resolvedCsvFileName || `${csvInfo.databaseName}.csv`;
          const cleanCsvPath = join(csvDir, cleanCsvName);
          if (csvInfo.path !== cleanCsvPath) {
            try {
              await rename(csvInfo.path, cleanCsvPath);
              // Also remove the non-_all variant if it exists
              const nonAllPath = csvInfo.path.replace(/_all\.csv$/, '.csv');
              if (nonAllPath !== csvInfo.path) {
                await rm(nonAllPath).catch(() => {});
              }
            } catch {
              // If rename fails, it's non-critical
            }
          }

          csvInfo.path = cleanCsvPath;

          if (resolvedRowDir.type === 'matched') {
            // Matched: create .base file
            const baseFileContent = generateBaseFile(csvInfo, targetDir, dbDir);
            const baseFileName = csvInfo.resolvedBaseFileName || `${csvInfo.databaseName}.base`;
            const basePath = join(csvDir, baseFileName);
            await Bun.write(basePath, baseFileContent);
            addCsvRewriteTarget(csvTargetsByName, csvInfo.databaseName, {
              databaseName: csvInfo.databaseName,
              targetPath: baseFileName,
              relativeDir: csvInfo.relativeDir,
              targetType: 'base'
            });
            baseFilesCreated++;

            if (config.verbose) {
              console.log(`    ✓ Created .base file for ${csvInfo.databaseName}`);
            }
          } else {
            // Unmatched: create _Index.md fallback
            const indexContent = generateDatabaseIndex(csvInfo, targetDir);
            const indexFileName = csvInfo.resolvedRootIndexFileName || `${csvInfo.databaseName}_Index.md`;
            const indexPath = join(csvDir, indexFileName);
            await Bun.write(indexPath, indexContent);
            addCsvRewriteTarget(csvTargetsByName, csvInfo.databaseName, {
              databaseName: csvInfo.databaseName,
              targetPath: indexFileName,
              relativeDir: csvInfo.relativeDir,
              targetType: 'index'
            });

            console.log(`    ⚠ Row directory not found for ${csvInfo.databaseName}, created ${indexFileName} fallback`);
          }

          // Build object ID map for precise wikilink restoration
          if (csvInfo.notionObjectId) {
            const outputFileName = resolvedRowDir.type === 'matched'
              ? (csvInfo.resolvedBaseFileName || `${csvInfo.databaseName}.base`)
              : (csvInfo.resolvedRootIndexFileName || `${csvInfo.databaseName}_Index.md`);
            csvObjectIdMap.set(csvInfo.notionObjectId, {
              targetPath: outputFileName,
              relativeDir: csvInfo.relativeDir,
              databaseName: csvInfo.databaseName,
              targetType: resolvedRowDir.type === 'matched' ? 'base' : 'index'
            });
          }
        } else if (config.dataviewMode) {
          // Dataview mode: Copy CSV to _databases folder and create individual notes
          const csvDestPath = join(databasesDir, csvInfo.resolvedDataviewCsvFileName || `${csvInfo.fileName}.csv`);
          await copyFile(csvInfo.path, csvDestPath);

          // Create individual notes from CSV rows
          const createdNotes = await createNotesFromCsvRows(csvInfo, targetDir, databasesDir);
          totalNotesCreated += createdNotes.length;

          // Generate Dataview index
          const indexMarkdown = generateDataviewIndex(csvInfo, targetDir, createdNotes);
          const dataviewIndexFileName = csvInfo.resolvedRootIndexFileName || `${csvInfo.databaseName}_Index.md`;
          const indexPath = join(targetDir, dataviewIndexFileName);
          await Bun.write(indexPath, indexMarkdown);
          csvWikilinkMap.set(csvInfo.databaseName, dataviewIndexFileName);

          if (config.verbose) {
            console.log(`    ✓ Created ${createdNotes.length} notes and Dataview index for ${csvInfo.databaseName}`);
          }
        } else {
          // Traditional mode: Create static table index
          const baseDir = dirname(csvInfo.path);
          const dbDir = join(baseDir, csvInfo.resolvedNotesDirName || csvInfo.databaseName);

          // Move individual MD files to _data subfolder if database directory exists
          try {
            const dirStat = statSync(dbDir);

            if (dirStat.isDirectory()) {
              const dataDir = join(dbDir, '_data');
              await mkdir(dataDir, { recursive: true });

              // Move all .md files from database directory to _data and update frontmatter
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
          const finalCsvPath = join(baseDir, csvInfo.resolvedCsvFileName || `${csvInfo.databaseName}.csv`);
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

          csvInfo.path = finalCsvPath;

          // Generate index using SQL Seal or Dataview syntax based on config
          const indexMarkdown = config.sqlsealMode
            ? generateSqlSealIndex(csvInfo, targetDir)
            : generateDatabaseIndex(csvInfo, targetDir);
          const defaultIndexFileName = csvInfo.resolvedIndexFileName || `${csvInfo.databaseName}_Index.md`;
          const indexPath = join(baseDir, defaultIndexFileName);
          await Bun.write(indexPath, indexMarkdown);
          csvWikilinkMap.set(csvInfo.databaseName, defaultIndexFileName);

          if (config.verbose) {
            console.log(`    ✓ Created ${config.sqlsealMode ? 'SQL Seal' : 'Dataview'} index for ${csvInfo.databaseName} (${csvInfo.rows.length} records)`);
          }
        }

        csvIndexesCreated++;
      } catch (error) {
        console.warn(chalk.yellow(`    ⚠ Failed to process ${csvInfo.databaseName}: ${error.message}`));
      }
    }

    if (config.basesMode && rowMatchAbstained.length > 0) {
      const reviewPath = join(targetDir, '_csv_row_match_review.json');
      await Bun.write(reviewPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        total: rowMatchAbstained.length,
        items: rowMatchAbstained
      }, null, 2));
      if (config.verbose) {
        console.log(`    ⚠ Wrote ${rowMatchAbstained.length} abstained row-note candidate(s) to ${relative(targetDir, reviewPath)}`);
      }
    }

    if (config.basesMode) {
      const markerPattern = new RegExp(`\\[\\[([^|\\]]+)(?:\\|${CSV_MARKER_TOKEN_PATTERN})?\\]\\]`, 'gi');
      const missingMarkerHints = [];
      const mdGlob = new Glob('**/*.md');
      for await (const mdPath of mdGlob.scan({ cwd: targetDir, absolute: true })) {
        const content = await Bun.file(mdPath).text();
        for (const match of content.matchAll(markerPattern)) {
          const databaseName = match[1];
          const notionObjectId = match[2];
          const encodedRelativeDir = match[3];
          if (!notionObjectId || csvObjectIdMap.has(notionObjectId)) continue;
          missingMarkerHints.push({ databaseName, notionObjectId, encodedRelativeDir });
        }
      }

      if (missingMarkerHints.length > 0) {
        const recoveryContext = buildMissingCsvRecoveryContext(targetDir);
        await materializeMissingCsvDirectoryTargets(targetDir, missingMarkerHints, csvTargetsByName, recoveryContext);
      }
    }

    const noteObjectIdMap = buildNoteObjectIdMap(targetDir);
    const noteTargetsByName = buildNoteTargetsByName(noteObjectIdMap);

    // Rewrite CSV and exact note wikilinks to point to actual output files
    if (csvWikilinkMap.size > 0 || csvTargetsByName.size > 0 || csvObjectIdMap.size > 0 || noteObjectIdMap.size > 0) {
      const mdGlob = new Glob('**/*.md');
      let csvLinksRewritten = 0;
      let exactMarkerRestores = 0;
      let plainCsvRestores = 0;
      let exactNoteRestores = 0;
      for await (const mdPath of mdGlob.scan({ cwd: targetDir, absolute: true })) {
        let content = await Bun.file(mdPath).text();
        let changed = false;
        const mdRelPath = relative(targetDir, mdPath).replace(/\\/g, '/');

        const toSafeWikilink = (label) => {
          const trimmed = String(label || '').trim();
          if (!trimmed) return '';
          if (!/[\[\]]/.test(trimmed)) return `[[${trimmed}]]`;
          const escapedTarget = trimmed.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
          return `[[${escapedTarget}|${trimmed}]]`;
        };

        const rewrittenEmptyLinks = content.replace(/\[\]\(([^)]+\.md)\)/g, (match, linkPath) => {
          if (linkPath.startsWith('http://') || linkPath.startsWith('https://')) {
            return match;
          }
          const converted = convertMarkdownLinkToWiki(match, fileMap, mdPath, targetDir);
          return converted === match ? match : converted;
        });
        if (rewrittenEmptyLinks !== content) {
          content = rewrittenEmptyLinks;
          changed = true;
        }

        const rewrittenNotionMarkdownLinks = content.replace(/\[([^\]]+)\]\((https?:\/\/(?:www\.)?notion\.so(?:\/[^)\s]*)?)\)/gi, (match, label) => {
          const cleanedLabel = stripNotionUrlFromTitle(String(label || '')).trim();
          if (!cleanedLabel) return '';
          return toSafeWikilink(cleanedLabel);
        });
        if (rewrittenNotionMarkdownLinks !== content) {
          content = rewrittenNotionMarkdownLinks;
          changed = true;
        }

        const rewrittenNotionParenthesized = content.replace(/\s*\(https?:\/\/(?:www\.)?notion\.so(?:\/[^)\s]*)?\)/gi, '');
        if (rewrittenNotionParenthesized !== content) {
          content = rewrittenNotionParenthesized;
          changed = true;
        }

        const rewrittenNotionAutoLinks = content.replace(/<https?:\/\/(?:www\.)?notion\.so(?:\/[^>]*)?>/gi, '');
        if (rewrittenNotionAutoLinks !== content) {
          content = rewrittenNotionAutoLinks;
          changed = true;
        }

        const mdMarkerPattern = new RegExp(`\\[\\[([^|\\]]+)\\|${MD_MARKER_TOKEN_PATTERN}\\]\\]`, 'gi');
        const replacedMdMarkers = content.replace(mdMarkerPattern, (match, displayText, notionObjectId, encodedAnchor) => {
          const markerResolution = resolveMdMarkerLink(displayText, notionObjectId, encodedAnchor, noteObjectIdMap);
          if (markerResolution.exactRestored) {
            exactNoteRestores++;
          }
          return markerResolution.resolvedText;
        });
        if (replacedMdMarkers !== content) {
          content = replacedMdMarkers;
          changed = true;
        }

        if (config.basesMode) {
          const keepPlainTokens = new Map();
          let keepPlainTokenCounter = 0;
          const markerPattern = new RegExp(`\\[\\[([^|\\]]+)(?:\\|${CSV_MARKER_TOKEN_PATTERN})?\\]\\]`, 'gi');
          const replacedMarkers = content.replace(markerPattern, (match, dbName, notionObjectId, encodedRelativeDir) => {
            if (notionObjectId) {
              const markerResolution = resolveCsvMarkerLink(
                dbName,
                notionObjectId,
                encodedRelativeDir,
                csvObjectIdMap,
                noteObjectIdMap,
                csvTargetsByName,
                noteTargetsByName,
                csvWikilinkReview,
                mdRelPath,
                match
              );
              if (markerResolution.exactRestored) {
                exactMarkerRestores++;
                return markerResolution.resolvedText;
              }
              const token = `__CSV_KEEP_PLAIN_${keepPlainTokenCounter++}__`;
              keepPlainTokens.set(token, markerResolution.resolvedText);
              return token;
            }
            return match;
          });
          if (replacedMarkers !== content) {
            content = replacedMarkers;
            changed = true;
          }

          const plainWikilinkPattern = /\[\[([^|\]]+)(\|[^\]]*)?\]\]/gi;
          const replacedPlainLinks = content.replace(plainWikilinkPattern, (match, linkTarget, alias = '') => {
            const targetKey = String(linkTarget || '').trim().toLowerCase();
            const candidates = csvTargetsByName.get(targetKey);
            if (!candidates || candidates.length === 0) {
              return match;
            }

            const resolution = selectBestCsvTargetForNote(mdRelPath, candidates);
            if (resolution.status !== 'matched') {
              csvWikilinkReview.push(createCsvReviewEntry({
                notePath: mdRelPath,
                originalLinkText: match,
                linkClass: 'plain',
                reason: resolution.status === 'no-candidate' ? 'no-candidate' : 'ambiguous',
                candidates: resolution.candidates
              }));
              return match;
            }

            const target = resolution.target;
            const ambiguous = candidates.length > 1 && new Set(candidates.map(c => normalizeRelativeDirPath(c.relativeDir))).size > 1;
            const wikiTarget = csvQualifiedWikiTarget(target.relativeDir, target.targetPath, mdRelPath, ambiguous);
            plainCsvRestores++;
            return alias
              ? `[[${wikiTarget}${alias}]]`
              : `[[${wikiTarget}]]`;
          });
          if (replacedPlainLinks !== content) {
            content = replacedPlainLinks;
            changed = true;
          }

          for (const [token, plainWikilink] of keepPlainTokens) {
            if (content.includes(token)) {
              content = content.replaceAll(token, plainWikilink);
              changed = true;
            }
          }

          const leakedMarkerPattern = new RegExp(`\\[\\[([^|\\]]+)\\|${CSV_MARKER_TOKEN_PATTERN}\\]\\]`, 'gi');
          const cleanedLeakedMarkers = content.replace(leakedMarkerPattern, (match, dbName, notionObjectId, encodedRelativeDir) => {
            const markerResolution = resolveCsvMarkerLink(
              dbName,
              notionObjectId,
              encodedRelativeDir,
              csvObjectIdMap,
              noteObjectIdMap,
              csvTargetsByName,
              noteTargetsByName,
              csvWikilinkReview,
              mdRelPath,
              match
            );
            if (markerResolution.exactRestored) {
              exactMarkerRestores++;
            }
            return markerResolution.resolvedText;
          });
          if (cleanedLeakedMarkers !== content) {
            content = cleanedLeakedMarkers;
            changed = true;
          }
        } else {
          // Keep the legacy name-based rewrite path for default/dataview flows.
          for (const [dbName, targetFileName] of csvWikilinkMap) {
            const wikiTarget = targetFileName.endsWith('.md')
              ? targetFileName.slice(0, -3)
              : targetFileName;
            const pattern = new RegExp(
              `\\[\\[${dbName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\|[^\\]]*)?\\]\\]`,
              'gi'
            );
            const replacedByName = content.replace(pattern, (match, alias) => {
              if (alias) {
                return `[[${wikiTarget}${alias}]]`;
              }
              return `[[${wikiTarget}]]`;
            });
            if (replacedByName !== content) {
              content = replacedByName;
              changed = true;
              csvLinksRewritten++;
            }
          }
        }
        if (changed) {
          await Bun.write(mdPath, content);
        }
      }
      if (config.basesMode) {
        csvLinksRewritten = exactMarkerRestores + plainCsvRestores;
      }
      if (csvLinksRewritten > 0 && config.verbose) {
        console.log(`    ✓ Rewritten ${csvLinksRewritten} CSV database wikilinks`);
      }
      if (config.basesMode && config.verbose) {
        if (exactMarkerRestores > 0) {
          console.log(`    ✓ Restored ${exactMarkerRestores} exact CSV wikilink(s) by object ID`);
        }
        if (plainCsvRestores > 0) {
          console.log(`    ✓ Restored ${plainCsvRestores} plain CSV wikilink(s) by locality`);
        }
      }
      if (exactNoteRestores > 0 && config.verbose) {
        console.log(`    ✓ Restored ${exactNoteRestores} exact note wikilink(s) by notion-id`);
      }
    }

    if (config.basesMode && csvWikilinkReview.length > 0) {
      const reviewPath = join(targetDir, '_csv_wikilink_review.json');
      await Bun.write(reviewPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        total: csvWikilinkReview.length,
        items: csvWikilinkReview
      }, null, 2));
      if (config.verbose) {
        console.log(`    ⚠ Wrote ${csvWikilinkReview.length} CSV wikilink review item(s) to ${relative(targetDir, reviewPath)}`);
      }
    }

     if (config.basesMode) {
       const matchedCsvFiles = csvFiles.filter(csv => csv._resolvedType === 'matched');
       const reconciliation = findBasesReconciliationIssues(targetDir, matchedCsvFiles);
      if (reconciliation.hasIssues) {
        if (reconciliation.leftoverRawCsvPaths.length > 0) {
          console.error(chalk.red(`    ✗ Bases reconciliation found ${reconciliation.leftoverRawCsvPaths.length} leftover raw CSV file(s):`));
          reconciliation.leftoverRawCsvPaths.slice(0, 10).forEach((path) => {
            console.error(chalk.red(`      - ${relative(targetDir, path)}`));
          });
          if (reconciliation.leftoverRawCsvPaths.length > 10) {
            console.error(chalk.red(`      ... and ${reconciliation.leftoverRawCsvPaths.length - 10} more`));
          }
        }
        if (reconciliation.missingBaseFiles.length > 0) {
          console.error(chalk.red(`    ✗ Bases reconciliation found ${reconciliation.missingBaseFiles.length} missing .base file(s):`));
          reconciliation.missingBaseFiles.slice(0, 10).forEach((path) => {
            console.error(chalk.red(`      - ${relative(targetDir, path)}`));
          });
          if (reconciliation.missingBaseFiles.length > 10) {
            console.error(chalk.red(`      ... and ${reconciliation.missingBaseFiles.length - 10} more`));
          }
        }

        throw new Error('Bases reconciliation failed: migration ended in partial CSV finalize state');
      }
    }

    stats.csvFilesProcessed = csvFiles.length;
    stats.csvIndexesCreated = csvIndexesCreated;

    if (config.basesMode && totalNotesCreated > 0) {
      stats.csvNotesCreated = totalNotesCreated;
      console.log(`  ${chalk.green('✓')} Processed ${csvFiles.length} CSV files, created ${totalNotesCreated} notes, ${baseFilesCreated} .base files, and ${csvIndexesCreated} indexes\n`);
    } else if (config.dataviewMode && totalNotesCreated > 0) {
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
  await openDirectory(targetDir, migrationTime, sizeStr);

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
