import { join, dirname, basename, relative, sep } from "node:path";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { Glob } from "bun";
import chalk from "chalk";
import matter from "gray-matter";
import { parseFrontmatter } from "./frontmatter.js";
import { sanitizeFilename } from "./utils.js";

// ============================================================================
// Obsidian Bases (.base) Generation for CSV Databases
// ============================================================================

// Status values that mean "not active" (used for the Active view filter)
const DONE_LIKE_VALUES = new Set([
  'done',
  'complete',
  'completed',
  'archived',
  'cancelled',
  'canceled'
]);

/**
 * Converts a CSV column name into a frontmatter property key
 * (lowercase, whitespace -> '-', keeps Unicode letters/numbers)
 * @param {string} column - CSV column name
 * @returns {string} - Property key
 */
export function toPropertyKey(column) {
  return column
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '');
}

/**
 * Normalizes a title for matching CSV rows to existing notes
 * @param {string} title - Raw title
 * @returns {string} - Normalized title
 */
function normalizeTitle(title) {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Strips surrounding double quotes from a CSV value and trims it
 * @param {string} value - Raw CSV value
 * @returns {string} - Cleaned value
 */
function cleanCsvValue(value) {
  return (value ?? '').replace(/"/g, '').trim();
}

/**
 * Generates the YAML content of an Obsidian Bases (.base) file
 * @param {Object} options
 * @param {string} options.databaseName - Database name (without extension)
 * @param {Array} options.header - CSV header columns
 * @param {Array} options.rows - CSV rows (array of value arrays)
 * @param {string} options.folder - Folder containing the database notes (relative, forward slashes)
 * @returns {string} - .base file content
 */
export function generateBaseFile({ databaseName, header, rows, folder }) {
  const lines = [];

  // Filters: notes in the database folder
  lines.push('filters:');
  lines.push('  and:');
  lines.push(`    - 'file.inFolder("${folder}")'`);
  lines.push('    - file.ext == "md"');

  // Properties: all columns except the first (it is the title => file.name)
  lines.push('properties:');
  const propKeys = [];
  for (let i = 1; i < header.length; i++) {
    const key = toPropertyKey(header[i]);
    if (!key || propKeys.includes(key)) continue;
    propKeys.push(key);
    lines.push(`  ${key}:`);
    lines.push(`    displayName: "${header[i].trim()}"`);
  }

  // Views
  lines.push('views:');
  lines.push('  - type: table');
  lines.push(`    name: "All ${databaseName}"`);
  lines.push('    order:');
  lines.push('      - file.name');
  for (const key of propKeys) {
    lines.push(`      - ${key}`);
  }

  // Active view: filter out done-like status values (if any appear in the data)
  const statusIndex = header.findIndex(col => col.trim().toLowerCase() === 'status');
  if (statusIndex !== -1) {
    const doneValues = [];
    for (const row of rows) {
      const value = cleanCsvValue(row[statusIndex]);
      if (!value) continue;
      if (DONE_LIKE_VALUES.has(value.toLowerCase()) && !doneValues.includes(value)) {
        doneValues.push(value);
      }
    }
    if (doneValues.length > 0) {
      const statusKey = toPropertyKey(header[statusIndex]);
      lines.push('  - type: table');
      lines.push('    name: "Active"');
      lines.push('    filters:');
      lines.push('      and:');
      for (const value of doneValues) {
        lines.push(`        - '${statusKey} != "${value}"'`);
      }
      lines.push('    order:');
      lines.push('      - file.name');
      for (const key of propKeys) {
        lines.push(`      - ${key}`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Rewrites links to CSV databases into links to their .base files.
 * Pure function: does not modify files.
 * @param {string} content - Markdown content
 * @param {Array} databases - Processed databases: [{ databaseName, fileNames: [...] }]
 *                            where fileNames are the original CSV basenames (e.g. "Tasks <id>.csv")
 * @returns {string} - Content with rewritten links
 */
export function rewriteDatabaseLinks(content, databases) {
  if (!content || !databases || databases.length === 0) return content;

  // Map of CSV file basenames -> database name
  const csvNameMap = new Map();
  for (const db of databases) {
    if (!db || !db.databaseName) continue;
    csvNameMap.set(`${db.databaseName}.csv`, db.databaseName);
    for (const fileName of db.fileNames || []) {
      csvNameMap.set(fileName, db.databaseName);
    }
  }
  if (csvNameMap.size === 0) return content;

  // Map of wikilink targets -> database name
  const wikiNameMap = new Map();
  for (const db of databases) {
    if (!db || !db.databaseName) continue;
    const name = db.databaseName;
    wikiNameMap.set(name, name);
    wikiNameMap.set(`${name}.csv`, name);
    wikiNameMap.set(`${name}_Index`, name);
    wikiNameMap.set(`${name}_Index.md`, name);
  }

  // Split into code and non-code segments; only rewrite outside code
  const parts = content.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = rewriteMarkdownLinks(parts[i], csvNameMap);
    parts[i] = rewriteWikiLinks(parts[i], wikiNameMap);
  }
  return parts.join('');
}

/**
 * Rewrites markdown links pointing to a processed CSV database
 * @param {string} text - Text outside of code blocks
 * @param {Map} csvNameMap - CSV file basename -> database name
 * @returns {string} - Text with rewritten links
 */
function rewriteMarkdownLinks(text, csvNameMap) {
  return text.replace(/\[([^\]]*)\]\(([^()\s]+)\)/g, (match, label, target) => {
    // Skip external links
    if (/^(https?|mailto|obsidian):/i.test(target)) return match;

    let decoded;
    try {
      decoded = decodeURIComponent(target);
    } catch (error) {
      decoded = target;
    }

    const dbName = csvNameMap.get(basename(decoded));
    if (!dbName) return match;

    return `[[${dbName}.base|${label}]]`;
  });
}

/**
 * Rewrites wikilinks pointing to a processed database (or its index file)
 * @param {string} text - Text outside of code blocks
 * @param {Map} wikiNameMap - Wikilink target -> database name
 * @returns {string} - Text with rewritten links
 */
function rewriteWikiLinks(text, wikiNameMap) {
  return text.replace(/\[\[([^\]|\n]+)(\|([^\]\n]*))?\]\]/g, (match, target, _aliasPart, alias) => {
    const dbName = wikiNameMap.get(target.trim());
    if (!dbName) return match;

    return alias !== undefined
      ? `[[${dbName}.base|${alias}]]`
      : `[[${dbName}.base]]`;
  });
}

/**
 * Processes CSV databases into Obsidian Bases files:
 * - Renames CSV files (keeps only _all variant, renamed to <DatabaseName>.csv)
 * - Creates/updates row notes in a folder named after the database
 * - Writes a <DatabaseName>.base file next to the CSV
 * - Rewrites links to the CSV in all markdown files
 * @param {Array} csvFiles - CSV infos from processCsvDatabases()
 * @param {string} targetDir - Target directory of the migration
 * @param {Object} options - { verbose }
 * @returns {Object} - { baseFilesCreated, notesCreated, propertiesAdded }
 */
export async function processBasesDatabases(csvFiles, targetDir, { verbose = false } = {}) {
  let baseFilesCreated = 0;
  let notesCreated = 0;
  let propertiesAdded = 0;
  const processedDatabases = [];

  // Group CSV files by (directory, database name)
  const groups = new Map();
  for (const csvInfo of csvFiles) {
    const dir = dirname(csvInfo.path);
    const key = `${dir}\u0000${csvInfo.databaseName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(csvInfo);
  }

  for (const entries of groups.values()) {
    try {
      // Prefer the _all variant (it holds the full database)
      const chosen = entries.find(entry => entry.fileName.endsWith('_all')) || entries[0];
      const { databaseName, header, rows } = chosen;
      const dir = dirname(chosen.path);

      // Keep a single CSV named <databaseName>.csv, remove the other variants
      const finalCsvPath = join(dir, `${databaseName}.csv`);
      for (const entry of entries) {
        if (entry === chosen) continue;
        try {
          await rm(entry.path);
        } catch (error) { /* ignore */ }
      }
      if (chosen.path !== finalCsvPath) {
        try {
          await stat(chosen.path);
          await rename(chosen.path, finalCsvPath);
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          console.warn(chalk.yellow(`    ⚠ Could not rename ${basename(chosen.path)}: ${error.message}`));
          continue;
        }
      }

      // Folder holding the row notes (directories are already renamed without IDs)
      const dbDir = join(dir, databaseName);
      await mkdir(dbDir, { recursive: true });

      // Index existing notes by normalized title
      const noteIndex = new Map();
      let dirEntries = [];
      try {
        dirEntries = await readdir(dbDir, { withFileTypes: true });
      } catch (error) { /* ignore */ }
      for (const entry of dirEntries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
        const notePath = join(dbDir, entry.name);
        let title = entry.name.slice(0, -3);
        try {
          const { data, hasFrontmatter } = parseFrontmatter(await Bun.file(notePath).text());
          if (hasFrontmatter && typeof data.title === 'string' && data.title.trim()) {
            title = data.title;
          }
        } catch (error) { /* fall back to filename */ }
        const normalized = normalizeTitle(title);
        if (!noteIndex.has(normalized)) noteIndex.set(normalized, notePath);
      }

      // Match CSV rows to existing notes
      for (const row of rows) {
        let title = cleanCsvValue(row[0]);
        if (!title) title = `${databaseName} Record ${rows.indexOf(row) + 1}`;
        const notePath = noteIndex.get(normalizeTitle(title));

        if (notePath) {
          // Add missing properties to the existing note (never overwrite)
          const content = await Bun.file(notePath).text();
          const { data, content: body } = parseFrontmatter(content);
          const newData = { ...data };
          let added = 0;

          for (let i = 1; i < header.length; i++) {
            const value = cleanCsvValue(row[i]);
            if (!value) continue;
            const key = toPropertyKey(header[i]);
            if (!key || Object.prototype.hasOwnProperty.call(newData, key)) continue;
            newData[key] = value;
            added++;
          }

          if (added > 0) {
            await Bun.write(notePath, matter.stringify(body, newData));
            propertiesAdded += added;
          }
        } else {
          // Create a new note for this row
          const noteData = { title };
          for (let i = 1; i < header.length; i++) {
            const value = cleanCsvValue(row[i]);
            if (!value) continue;
            const key = toPropertyKey(header[i]);
            if (!key) continue;
            noteData[key] = value;
          }

          const newNotePath = join(dbDir, `${sanitizeFilename(title)}.md`);
          try {
            await stat(newNotePath);
            continue; // Already exists - do not overwrite
          } catch (error) { /* does not exist - create it */ }

          await Bun.write(newNotePath, matter.stringify(`\n# ${title}\n`, noteData));
          notesCreated++;
        }
      }

      // Write the .base file
      const folder = relative(targetDir, dbDir).split(sep).join('/');
      const baseContent = generateBaseFile({ databaseName, header, rows, folder });
      await Bun.write(join(dir, `${databaseName}.base`), baseContent);
      baseFilesCreated++;

      processedDatabases.push({
        databaseName,
        fileNames: entries.map(entry => `${entry.fileName}.csv`)
      });

      if (verbose) {
        console.log(`    ✓ Created Bases view for ${databaseName} (${rows.length} records)`);
      }
    } catch (error) {
      console.warn(chalk.yellow(`    ⚠ Failed to process CSV database: ${error.message}`));
    }
  }

  // Rewrite links to the processed databases in all markdown files
  if (processedDatabases.length > 0) {
    const mdGlob = new Glob('**/*.md');
    for (const relPath of mdGlob.scanSync(targetDir)) {
      const mdPath = join(targetDir, relPath);
      let content;
      try {
        content = await Bun.file(mdPath).text();
      } catch (error) {
        continue;
      }
      const newContent = rewriteDatabaseLinks(content, processedDatabases);
      if (newContent !== content) {
        await Bun.write(mdPath, newContent);
      }
    }
  }

  return { baseFilesCreated, notesCreated, propertiesAdded };
}
