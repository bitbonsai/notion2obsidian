import { join, dirname, basename, relative } from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { statSync } from "node:fs";
import { Glob } from "bun";
import chalk from "chalk";
import matter from "gray-matter";
import { generateValidFrontmatter, getTagsFromPath } from "./frontmatter.js";
import { cleanName, normalizeTitle, skeletonsMatch, sanitizeKey } from "./utils.js";
import { convertBacklinksProperty, convertPropertyRelations } from "./links.js";
export { normalizeTitle, skeletonsMatch } from "./utils.js";

// ============================================================================
// CSV Database Processing
// ============================================================================

/**
 * Processes CSV database files and creates index pages
 * @param {string} targetDir - The directory to scan for CSV files
 * @returns {Array} - Array of processed CSV info
 */
export async function processCsvDatabases(targetDir) {
  const allCsvFiles = [];
  const csvGlob = new Glob('**/*.csv');

  for (const csvPath of csvGlob.scanSync(targetDir)) {
    const fullPath = join(targetDir, csvPath);

    try {
      const csvContent = await Bun.file(fullPath).text();
      const rawLines = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

      // Merge multi-line quoted fields into single logical rows
      const lines = [];
      let current = '';
      let inQuotes = false;
      for (const rawLine of rawLines) {
        if (current) {
          current += '\n' + rawLine;
        } else {
          current = rawLine;
        }
        for (const ch of rawLine) {
          if (ch === '"') inQuotes = !inQuotes;
        }
        if (!inQuotes) {
          if (current.trim()) lines.push(current);
          current = '';
        }
      }
      if (current && current.trim()) lines.push(current);

      if (lines.length < 1) continue;

      const header = lines[0].replace(/^\uFEFF/, '').split(',').map(col => col.trim().replace(/"/g, ''));
      const rows = lines.slice(1).map(line => {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());
        return values;
      });

      const fileName = basename(csvPath, '.csv');
      const isAllVersion = /(?:\s|^)[0-9a-fA-F]{32}_all$/i.test(fileName);
      const idMatch = fileName.match(/(?:\s|^)([0-9a-fA-F]{32})(?:_all)?$/);
      const notionObjectId = idMatch ? idMatch[1].toLowerCase() : null;
      const databaseName = fileName.replace(/\s[0-9a-fA-F]{32}(_all)?$/, '');
      const relativeDir = relative(targetDir, dirname(fullPath)) || '.';
      const fallbackIdentity = fileName.replace(/_all$/i, '').toLowerCase();
      const dedupeKey = notionObjectId
        ? `${relativeDir.toLowerCase()}::${databaseName.toLowerCase()}::${notionObjectId}`
        : `${relativeDir.toLowerCase()}::${databaseName.toLowerCase()}::${fallbackIdentity}`;

      allCsvFiles.push({
        path: fullPath,
        fileName,
        databaseName,
        notionObjectId,
        relativeDir,
        dedupeKey,
        header,
        rows,
        recordCount: rows.length,
        isAllVersion
      });

    } catch (error) {
      console.warn(chalk.yellow(`Warning: Failed to process CSV ${csvPath}: ${error.message}`));
    }
  }

  const dbMap = new Map();
  for (const csvInfo of allCsvFiles) {
    const existing = dbMap.get(csvInfo.dedupeKey);
    if (!existing || csvInfo.isAllVersion) {
      dbMap.set(csvInfo.dedupeKey, csvInfo);
    }
  }

  const deduped = [...dbMap.values()];
  assignResolvedOutputNames(deduped);
  return deduped;
}

/**
 * Creates a markdown index page for a CSV database
 * @param {Object} csvInfo - CSV file information
 * @param {string} targetDir - Target directory
 * @returns {string} - Generated markdown content
 */
export function generateDatabaseIndex(csvInfo, targetDir) {
  const { databaseName, header, rows, fileName } = csvInfo;
  const relativeCsvPath = csvInfo.resolvedCsvFileName || `${databaseName}.csv`;
  const notesDirName = csvInfo.resolvedNotesDirName || databaseName;

  let markdown = `# ${databaseName}\n\n`;
  markdown += `Database with ${rows.length} records.\n\n`;

  // Add CSV file link
  markdown += `**CSV File:** [[${relativeCsvPath}|Open in spreadsheet app]]\n\n`;

  // Create Dataview query to show all records
  markdown += `## All Records\n\n`;
  markdown += '```dataview\n';
  markdown += 'TABLE WITHOUT ID ';

  // Use first 5 columns for the table view
  const displayColumns = header.slice(0, 5);
  markdown += displayColumns.join(', ') + '\n';
  markdown += `FROM csv("${relativeCsvPath}")\n`;
  markdown += '```\n\n';

  // Look for corresponding directory with individual MD files
  const baseDir = dirname(csvInfo.path);
  const dbDir = join(baseDir, notesDirName);

  try {
    statSync(dbDir);

    // Directory exists - reference the _data folder
    markdown += `## Individual Pages\n\n`;
    markdown += `Individual database pages are stored in [[${notesDirName}/_data|${notesDirName}/_data/]]\n\n`;
  } catch (error) {
    // No individual pages directory
  }

  return markdown;
}

/**
 * Creates a markdown index page for a CSV database using SQL Seal syntax
 * @param {Object} csvInfo - CSV file information
 * @param {string} targetDir - Target directory
 * @returns {string} - Generated markdown content
 */
export function generateSqlSealIndex(csvInfo, targetDir) {
  const { databaseName, header, rows, fileName } = csvInfo;
  const relativeCsvPath = csvInfo.resolvedCsvFileName || `${databaseName}.csv`;
  const notesDirName = csvInfo.resolvedNotesDirName || databaseName;

  // Create SQL-safe table name (lowercase, underscores, no spaces)
  const tableName = databaseName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  let markdown = `# ${databaseName}\n\n`;
  markdown += `Database with ${rows.length} records.\n\n`;

  // Add CSV file link
  markdown += `**CSV File:** [[${relativeCsvPath}|Open in spreadsheet app]]\n\n`;

  // Create SQL Seal query to show all records
  markdown += `## All Records\n\n`;
  markdown += '```sqlseal\n';
  markdown += `TABLE ${tableName} = file("${relativeCsvPath}")\n\n`;

  // Use first 5 columns for the table view
  const displayColumns = header.slice(0, 5);
  markdown += `SELECT ${displayColumns.join(', ')}\n`;
  markdown += `FROM ${tableName}\n`;
  markdown += '```\n\n';

  // Look for corresponding directory with individual MD files
  const baseDir = dirname(csvInfo.path);
  const dbDir = join(baseDir, notesDirName);

  try {
    statSync(dbDir);

    // Directory exists - reference the _data folder
    markdown += `## Individual Pages\n\n`;
    markdown += `Individual database pages are stored in [[${notesDirName}/_data|${notesDirName}/_data/]]\n\n`;
  } catch (error) {
    // No individual pages directory
  }

  // Add example queries section
  markdown += `## Example Queries\n\n`;
  markdown += '```sqlseal\n';
  markdown += `-- Filter records\n`;
  markdown += `SELECT * FROM ${tableName}\n`;
  markdown += `WHERE ${displayColumns[0]} LIKE '%search%'\n\n`;

  markdown += `-- Sort by column\n`;
  markdown += `SELECT * FROM ${tableName}\n`;
  markdown += `ORDER BY ${displayColumns[0]} ASC\n\n`;

  markdown += `-- Count records\n`;
  markdown += `SELECT COUNT(*) as total FROM ${tableName}\n`;
  markdown += '```\n\n';

  return markdown;
}

/**
 * Creates individual markdown notes from CSV rows (Dataview mode)
 * @param {Object} csvInfo - CSV file information
 * @param {string} targetDir - Target directory (for tag generation)
 * @param {string} databasesDir - _databases subdirectory path (for CSV copy)
 * @returns {Array} - Array of created note file paths
 */
export async function createNotesFromCsvRows(csvInfo, targetDir, databasesDir) {
  const { databaseName, header, rows, fileName } = csvInfo;
  const createdNotes = [];
  const columnTypes = detectColumnTypes(header, rows);
  const threeDPrintModelIndex = header.findIndex(column => sanitizeKey(column) === '3d-print-model');

  // Notes are created in _data subfolder next to the database folder
  // CSV at Gemology/Gem Catalogue.csv → Notes in Gemology/Gem Catalogue/_data/
  const csvDir = dirname(csvInfo.path);
  const notesDir = join(csvDir, csvInfo.resolvedNotesDirName || databaseName, '_data');
  await mkdir(notesDir, { recursive: true });

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Generate tags from the notes directory path (matches .base file filters)
    const tags = getTagsFromPath(join(notesDir, 'placeholder.md'), targetDir);

    // Create note content with frontmatter
    const frontmatter = {
      tags: tags,
      'database-source': `_databases/${fileName}`,
      'database-row': i + 1,
      published: false
    };

    // Extract title from first column or generate one
    let title = '';
    if (row[0] && row[0].trim()) {
      title = normalizeGeneratedRowTitle(row[0], `${databaseName} Record ${i + 1}`);
    } else {
      title = `${databaseName} Record ${i + 1}`;
    }

    frontmatter.title = title;
    header.forEach((column, idx) => {
      if (row[idx] && row[idx].trim()) {
        const value = row[idx].replace(/"/g, '').trim();
        // Convert to kebab case - preserve non-ASCII characters (like Chinese, Unicode)
        const key = sanitizeKey(column);
        
        if (!key) return; // Skip if key is empty after processing
        if (key === 'model' && threeDPrintModelIndex >= 0) {
          const alternative = (row[threeDPrintModelIndex] || '').replace(/"/g, '').trim();
          if (alternative) {
            const modelLink = convertRelationToWikilink(value);
            const alternativeLink = convertRelationToWikilink(alternative);
            if (relationTargetsEquivalent(modelLink, alternativeLink)) return;
          }
        }

        if (key === 'notion-id' || column === 'notion-id') {
          frontmatter['notion-id'] = value;
        } else if (key === 'tags') {
          frontmatter[key] = value.split(',').map(t => t.trim()).filter(t => t);
        } else if (columnTypes[column] === 'relation') {
          frontmatter[key] = convertRelationToWikilink(value);
        } else {
          let processed = stripImagePlaceholders(value);
          if (typeof processed === 'string' && processed.includes('.md)')) {
            const result = convertBacklinksProperty(processed);
            processed = result.wikilinks.length > 0 ? result.wikilinks : convertPropertyRelations(processed);
          }
          frontmatter[key] = processed;
        }
      }
    });

    const cleanTitle = sanitizeGeneratedFileStem(title, {
      fallback: `record-${i + 1}`,
      maxLength: 50,
      spaceAsDash: true
    });

    const noteFileName = `${cleanTitle || `record-${i + 1}`}.md`;
    const notePath = join(notesDir, noteFileName);

    // Skip if note already exists (avoid duplicates)
    try {
      await Bun.file(notePath).text();
      createdNotes.push(notePath);
      continue;
    } catch {
      // File doesn't exist, proceed with creation
    }

    // Generate markdown content
    let content = generateValidFrontmatter(frontmatter, '');
    content += `\n# ${title}\n\n`;

    // Add table with all properties
    content += '## Properties\n\n';
    content += '| Property | Value |\n';
    content += '| --- | --- |\n';

    header.forEach((column, idx) => {
      if (row[idx] && row[idx].trim()) {
        let value = row[idx].replace(/"/g, '').trim().replace(/\|/g, '\\|');
        if (value.includes('.md)')) {
          const result = convertBacklinksProperty(value);
          value = result.converted.replace(/\|/g, '\\|');
        }
        if (columnTypes[column] === 'relation') {
          const converted = convertRelationToWikilink(value);
          value = (Array.isArray(converted) ? converted.join(', ') : converted).replace(/\|/g, '\\|');
        }
        content += `| ${column} | ${value} |\n`;
      }
    });

    content += `\n## Database Info\n\n`;
    const resolvedIndexName = (csvInfo.resolvedIndexFileName || `${databaseName}_Index.md`).replace(/\.md$/, '');
    content += `Source: [[${resolvedIndexName}|${databaseName} Database]]\n`;
    content += `Record: ${i + 1} of ${rows.length}\n`;

    await Bun.write(notePath, content);
    createdNotes.push(notePath);
  }

  return createdNotes;
}

/**
 * Generates a Dataview-compatible database index page
 * @param {Object} csvInfo - CSV file information
 * @param {string} targetDir - Target directory
 * @param {Array} createdNotes - Array of created note paths
 * @returns {string} - Generated markdown content
 */
export function generateDataviewIndex(csvInfo, targetDir, createdNotes) {
  const { databaseName, header, rows, fileName } = csvInfo;

  let markdown = `# ${databaseName}\n\n`;
  markdown += `Database with ${rows.length} records converted to individual notes.\n\n`;

  // Add Dataview queries
  markdown += '## All Records\n\n';
  markdown += '```dataview\n';
  markdown += 'TABLE WITHOUT ID file.link as "Record", ';

  // Add common columns to the query
  const commonColumns = ['status', 'priority', 'assignee', 'owner', 'due'];
  const availableColumns = commonColumns.filter(col =>
    header.some(h => h.toLowerCase().includes(col))
  );

  if (availableColumns.length > 0) {
    markdown += availableColumns.join(', ') + '\n';
  } else {
    markdown += 'title\n';
  }

  markdown += `FROM #database/${databaseName.toLowerCase().replace(/\s+/g, '-')}\n`;
  markdown += '```\n\n';

  // Add filtered views
  if (availableColumns.includes('status')) {
    markdown += '## Active Records\n\n';
    markdown += '```dataview\n';
    markdown += 'TABLE WITHOUT ID file.link as "Record", status, priority\n';
    markdown += `FROM #database/${databaseName.toLowerCase().replace(/\s+/g, '-')}\n`;
    markdown += 'WHERE status != "Done" AND status != "Completed"\n';
    markdown += 'SORT priority DESC\n';
    markdown += '```\n\n';
  }

  // Add CSV source info
  markdown += '## CSV Data Source\n\n';
  markdown += `Raw CSV file: \`_databases/${fileName}.csv\`\n\n`;
  markdown += 'You can query the CSV directly with Dataview:\n\n';
  markdown += '```dataview\n';
  markdown += `TABLE WITHOUT ID ${header.slice(0, 3).join(', ')}\n`;
  markdown += `FROM csv("_databases/${fileName}.csv")\n`;
  markdown += '```\n\n';

  // Add individual note links
  markdown += `## Individual Notes (${createdNotes.length})\n\n`;
  createdNotes.slice(0, 10).forEach(notePath => {
    const noteName = basename(notePath, '.md');
    const displayName = noteName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    markdown += `- [[${noteName}|${displayName}]]\n`;
  });

  if (createdNotes.length > 10) {
    markdown += `\n*Showing first 10 of ${createdNotes.length} notes. Use Dataview queries above to see all.*\n`;
  }

  return markdown;
}

// ============================================================================
// Obsidian Bases Support
// ============================================================================

/**
 * Generates an Obsidian Bases (.base) file from CSV data
 * @param {Object} csvInfo - CSV file information  
 * @param {string} targetDir - Target directory (for tag generation)
 * @returns {string} - Generated .base YAML content
 */
export function generateBaseFile(csvInfo, targetDir, dbDir) {
  const { databaseName, header, rows, fileName } = csvInfo;
  
  const columnTypes = detectColumnTypes(header, rows);
  
  const base = {
    filters: generateBaseFilters(dbDir, targetDir),
    properties: generateBaseProperties(header, columnTypes),
    formulas: generateBaseFormulas(header, columnTypes),
    views: generateBaseViews(header, columnTypes, databaseName)
  };
  
  return convertBaseToYaml(base);
}

/**
 * Detects the type of each column from sample data
 * @param {Array} header - Column headers
 * @param {Array} rows - Data rows
 * @returns {Object} - Map of column name to type
 */
function detectColumnTypes(header, rows) {
  const types = {};
  const sampleSize = Math.min(rows.length, 10);
  
  for (const col of header) {
    const colIndex = header.indexOf(col);
    const samples = rows.slice(0, sampleSize).map(r => r[colIndex]).filter(v => v && v.trim());
    
    if (samples.length === 0) {
      types[col] = 'text';
      continue;
    }

    const relationPattern = /\((?:https?:\/\/)?(?:www\.)?notion\.so\/[^)]+\)/i;
    if (samples.some(s => relationPattern.test(s))) {
      types[col] = 'relation';
      continue;
    }
    
    // Check for dates
    const datePattern = /^\d{4}-\d{2}-\d{2}|^\d{2}\/\d{2}\/\d{4}/;
    if (samples.every(s => datePattern.test(s))) {
      types[col] = 'date';
      continue;
    }
    
    // Check for numbers
    if (samples.every(s => !isNaN(parseFloat(s)) && isFinite(s))) {
      types[col] = 'number';
      continue;
    }
    
    // Check for boolean
    const boolPattern = /^(true|false|yes|no)$/i;
    if (samples.every(s => boolPattern.test(s))) {
      types[col] = 'boolean';
      continue;
    }
    
    types[col] = 'text';
  }
  
  return types;
}

/**
 * Generates base filters for selecting database notes
 * @param {Array} tags - Tags from getTagsFromPath
 * @returns {Object} - Filter configuration
 */
function generateBaseFilters(dbDir, targetDir) {
  const relativePath = relative(targetDir, dbDir);
  const filters = [];
  if (relativePath && relativePath !== '.') {
    filters.push(`file.inFolder("${relativePath}")`);
  }
  filters.push('file.ext == "md"');
  return { and: filters };
}

/**
 * Generates properties configuration for each column
 * @param {Array} header - Column headers
 * @param {Object} types - Column type map
 * @returns {Object} - Properties configuration
 */
function generateBaseProperties(header, types) {
  const properties = {};
  
  for (const col of header) {
    const trimmedCol = col.trim();
    if (!trimmedCol) continue;
    
    // Convert to kebab case - preserve non-ASCII characters (like Chinese, Unicode)
    const key = sanitizeKey(trimmedCol);
    if (key) {
      properties[key] = {
        displayName: trimmedCol
      };
    }
  }
  
  return properties;
}

/**
 * Generates useful formulas based on column types
 * @param {Array} header - Column headers
 * @param {Object} types - Column type map
 * @returns {Object} - Formulas configuration
 */
function generateBaseFormulas(header, types) {
  const formulas = {};
  
  // Look for date columns to create days_until/days_since formulas
  for (const col of header) {
    const key = sanitizeKey(col);
    
    if (types[col] === 'date') {
      if (col.toLowerCase().includes('due') || col.toLowerCase().includes('deadline')) {
        formulas[`days_until_${key}`] = `if(${key}, (date(${key}) - today()).days, "")`;
        formulas[`is_overdue`] = `if(${key}, date(${key}) < today() && status != "done", false)`;
      } else if (col.toLowerCase().includes('created') || col.toLowerCase().includes('start')) {
        formulas[`days_since_${key}`] = `if(${key}, (today() - date(${key})).days, "")`;
      }
    }
  }
  
  return formulas;
}

/**
 * Generates views configuration for the base
 * @param {Array} header - Column headers
 * @param {Object} types - Column type map
 * @param {string} databaseName - Database name
 * @returns {Array} - Views configuration
 */
function generateBaseViews(header, types, databaseName) {
  const views = [];
  const displayColumns = header.slice(0, 7).filter(col => col.trim());
  
  // Convert column names to property keys
  const orderKeys = displayColumns.map(col => {
    const trimmedCol = col.trim();
    return sanitizeKey(trimmedCol);
  });
  
  // Main table view with all records
  const mainView = {
    type: 'table',
    name: `All ${databaseName}`,
    order: ['file.name', ...orderKeys]
  };
  views.push(mainView);
  
  // Check for status column to create filtered views
  const statusCol = header.find(col => col.toLowerCase().includes('status'));
  if (statusCol) {
    const statusKey = sanitizeKey(statusCol);
    
    views.push({
      type: 'table',
      name: 'Active',
      filters: {
        and: [
          `${statusKey} != "done"`,
          `${statusKey} != "completed"`,
          `${statusKey} != "archived"`
        ]
      },
      order: mainView.order
    });
  }
  
  // Check for due date column to create overdue view
  const dueCol = header.find(col => 
    col.toLowerCase().includes('due') || 
    col.toLowerCase().includes('deadline')
  );
  if (dueCol) {
    const dueKey = sanitizeKey(dueCol);
    const priorityCol = header.find(col => col.toLowerCase().includes('priority'));
    const orderCols = ['file.name', dueKey];
    if (priorityCol) {
      orderCols.push(sanitizeKey(priorityCol));
    }
    
    views.push({
      type: 'table',
      name: 'Overdue',
      filters: {
        and: [
          `formula.is_overdue == true`
        ]
      },
      order: orderCols
    });
  }
  
  return views;
}

/**
 * Converts a base configuration object to YAML string
 * @param {Object} base - Base configuration
 * @returns {string} - YAML formatted string
 */
function convertBaseToYaml(base) {
  const lines = [];
  
  // Filters
  lines.push('filters:');
  lines.push('  and:');
  for (const filter of base.filters.and) {
    lines.push(`    - '${filter}'`);
  }
  lines.push('');
  
  // Formulas
  if (Object.keys(base.formulas).length > 0) {
    lines.push('formulas:');
    for (const [name, expr] of Object.entries(base.formulas)) {
      lines.push(`  ${name}: '${expr}'`);
    }
    lines.push('');
  }
  
  // Properties
  lines.push('properties:');
  for (const [key, config] of Object.entries(base.properties)) {
    lines.push(`  ${key}:`);
    const escapedName = config.displayName.replace(/"/g, '\\"');
    lines.push(`    displayName: "${escapedName}"`);
  }
  lines.push('');
  
  // Views
  lines.push('views:');
  for (const view of base.views) {
    lines.push('  - type: table');
    lines.push(`    name: "${view.name.replace(/"/g, '\\"')}"`);
    
    if (view.filters) {
      lines.push('    filters:');
      lines.push('      and:');
      for (const filter of view.filters.and) {
        lines.push(`        - '${filter}'`);
      }
    }
    
    lines.push('    order:');
    for (const col of view.order) {
      lines.push(`      - ${col}`);
    }
  }
  
  return lines.join('\n') + '\n';
}

// ============================================================================
// CSV Value Processing Utilities
// ============================================================================

const NOTION_URL_PATTERN = /\s*\((?:https?---www\.notion\.so-[0-9a-f]+(?:-pvs=\d+)?|https?:\/\/(?:www\.)?notion\.so\/[^)]+|(?:www\.)?notion\.so\/[^)]+)\)/gi;
const IMAGE_PLACEHOLDER_PATTERN = /\[Image(?:\s+\d+)?\]/gi;
const EXTERNAL_URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s)]+/gi;
const FILESAFE_URL_PATTERN = /\bhttps?---[^\s)]+/gi;
const URL_TOKEN_PATTERN = /https?(?:\s*[-:/]+\s*)+/gi;
const NOT_FOUND_TOKEN_PATTERN = /@not\s+found\b/gi;
const LEADING_MENTION_DATE_PATTERN = /^@(?=(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},\s*\d{4}\b)/i;
const DATE_PREFIX_PATTERN = /^(?:@)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},\s*\d{4}\s+/i;
const DATE_TOKEN_PATTERN = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},\s*\d{4}\b/ig;
const INLINE_MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+\.md)\)/gi;
const PAREN_MD_REFERENCE_PATTERN = /\s*\([^)]*\.md\);?\s*/gi;
const URL_CAPTURE_PATTERN = /\b(?:https?:\/\/|www\.)[^\s)]+/gi;
const GENERIC_URL_TOKENS = new Set(['www', 'http', 'https', 'com', 'org', 'net', 'io', 'co', 'cn', 'html', 'product', 'products', 'item', 'items', 'order', 'orders', 'listing', 'listings', 'shop', 'design', 'designs', 'thingiverse']);
const NO_AUTOGEN_DB_SKELETONS = new Set(['homeviews']);

function shouldSkipDatabaseAutoGeneration(databaseName) {
  const normalizedDb = normalizeTitle(String(databaseName || ''));
  return NO_AUTOGEN_DB_SKELETONS.has(normalizedDb);
}

export function stripNotionUrlFromTitle(title) {
  if (!title) return title;
  NOTION_URL_PATTERN.lastIndex = 0;
  return title.replace(NOTION_URL_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
}

export function normalizeGeneratedRowTitle(rawTitle, fallback = 'Untitled') {
  let title = (rawTitle || '').replace(/^"|"$/g, '').trim();

  title = title.replace(INLINE_MARKDOWN_LINK_PATTERN, '$1');
  title = stripNotionUrlFromTitle(title);
  title = title.replace(PAREN_MD_REFERENCE_PATTERN, ' ');

  EXTERNAL_URL_PATTERN.lastIndex = 0;
  title = title.replace(EXTERNAL_URL_PATTERN, ' ');
  title = title.replace(FILESAFE_URL_PATTERN, ' ');
  title = title.replace(URL_TOKEN_PATTERN, ' ');
  title = title.replace(NOT_FOUND_TOKEN_PATTERN, ' ');
  title = title.replace(LEADING_MENTION_DATE_PATTERN, '');
  title = title.replace(/\s*;\s*/g, '; ');
  title = title.replace(/\s*[,:]\s*/g, (m) => m.trim() + ' ');
  title = title.replace(/[;,:\-]+\s*$/g, '');
  title = title.replace(/\s{2,}/g, ' ').trim();

  return title || fallback;
}

function extractUrlKeywordTokens(rawTitle) {
  const source = String(rawTitle || '');
  const seen = new Set();
  const tokens = [];
  URL_CAPTURE_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(URL_CAPTURE_PATTERN)) {
    let candidate = match[0].replace(/[),.;]+$/g, '').trim();
    if (!candidate) continue;
    if (!/^https?:\/\//i.test(candidate)) {
      candidate = `https://${candidate}`;
    }

    let parts = [];
    try {
      const parsed = new URL(candidate);
      parts = `${parsed.hostname} ${decodeURIComponent(parsed.pathname || '')}`.split(/[\s/._-]+/);
    } catch {
      parts = candidate.split(/[\s/._:-]+/);
    }

    for (const part of parts) {
      const cleaned = part.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
      if (!cleaned) continue;
      if (GENERIC_URL_TOKENS.has(cleaned)) continue;
      if (cleaned.length < 2) continue;
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);
      tokens.push(cleaned);
    }
  }
  return tokens;
}

export function buildRowTitleMatchSkeletons(rawTitle, fallback = 'Untitled') {
  const raw = (rawTitle || '').replace(/^"|"$/g, '').trim();
  const cleaned = normalizeGeneratedRowTitle(raw, fallback);
  const variants = new Set([raw, cleaned]);

  const rawWithUrlKeywords = raw.replace(URL_CAPTURE_PATTERN, (urlMatch) => {
    const tokens = extractUrlKeywordTokens(urlMatch);
    return tokens.length > 0 ? ` ${tokens.join(' ')} ` : ' ';
  }).replace(/\s{2,}/g, ' ').trim();
  if (rawWithUrlKeywords && rawWithUrlKeywords !== raw) {
    variants.add(rawWithUrlKeywords);
    variants.add(normalizeGeneratedRowTitle(rawWithUrlKeywords, fallback));
  }

  const urlKeywords = extractUrlKeywordTokens(raw);
  if (urlKeywords.length > 0) {
    variants.add(`${cleaned} ${urlKeywords.join(' ')}`.trim());
    variants.add(urlKeywords.join(' '));
    const numericKeywords = urlKeywords.filter(token => /^\d{4,}$/.test(token));
    if (numericKeywords.length > 0) {
      variants.add(`${cleaned} ${numericKeywords.join(' ')}`.trim());
    }
  }

  const dateStripped = cleaned.replace(DATE_TOKEN_PATTERN, ' ').replace(/\s{2,}/g, ' ').trim();
  if (dateStripped && dateStripped !== cleaned) {
    variants.add(dateStripped);
  }

  const skeletons = [];
  const seen = new Set();
  for (const variant of variants) {
    if (!variant) continue;
    const normalized = normalizeTitle(variant);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    skeletons.push(normalized);
  }
  return skeletons;
}

function isWeakGeneratedRowTitle(title) {
  const trimmed = String(title || '').trim();
  if (!trimmed) return true;
  const lowered = trimmed.toLowerCase();
  const datePrefixed = trimmed.match(DATE_PREFIX_PATTERN);
  if (datePrefixed) {
    const remainder = trimmed.slice(datePrefixed[0].length).trim();
    const remainderSkeleton = normalizeTitle(remainder);
    if (!remainderSkeleton || remainderSkeleton.length < 3) return true;
  }
  const genericFragments = new Set([
    'find a',
    'find an',
    'find the',
    'browse',
    'browse a',
    'browse an',
    'browse the',
    'check',
    'update',
    'open',
    'read more'
  ]);
  if (genericFragments.has(lowered)) return true;
  if (/^(find|browse|check|update|open|visit|click)\b(?:\s+(?:a|an|the))?$/i.test(trimmed)) return true;
  if (/(?:\b(?:browse|list(?:ing)?|create|update|ship|order|task|todo)\b)/i.test(trimmed) && /[;；]|\b(?:and|then)\b/i.test(trimmed)) return true;
  return false;
}

function hasStrongFuzzyExistingMatch(titleSkeletons, existingSkeletons, title) {
  const skeletonList = Array.isArray(titleSkeletons) ? titleSkeletons : [titleSkeletons];
  const nonEmpty = skeletonList.filter(Boolean);
  if (nonEmpty.length === 0) return false;
  const titleHasCjk = /[\u4E00-\u9FFF]/.test(String(title || ''));
  const minLen = titleHasCjk ? 2 : 8;
  return nonEmpty.some(titleSkeleton => {
    if (titleSkeleton.length < minLen) return false;
    return existingSkeletons.some(existing => {
      if (!existing) return false;
      if (skeletonsMatch(existing, titleSkeleton) || skeletonsMatch(titleSkeleton, existing)) return true;
      return existing.includes(titleSkeleton) || titleSkeleton.includes(existing);
    });
  });
}

function looksLikeCompositeEntityTitle(title, titleSkeleton, existingSkeletons) {
  if (!title || !titleSkeleton) return false;
  if (!/[;；,+/&]|\band\b/i.test(title)) return false;
  let matches = 0;
  for (const existing of existingSkeletons) {
    if (!existing) continue;
    const existingHasCjk = /[\u4E00-\u9FFF]/.test(existing);
    const minLen = existingHasCjk ? 2 : 6;
    if (existing.length < minLen) continue;
    if (titleSkeleton.includes(existing)) {
      matches++;
      if (matches >= 2) return true;
    }
  }
  return false;
}

function hasNumericAnchorMatch(rawTitle, titleSkeletons, existingSkeletons) {
  const skeletonList = Array.isArray(titleSkeletons) ? titleSkeletons : [titleSkeletons];
  const nonEmpty = skeletonList.filter(Boolean);
  if (nonEmpty.length === 0) return false;
  const numericTokens = Array.from(new Set(String(rawTitle || '').match(/\d{4,}/g) || []));
  if (numericTokens.length === 0) return false;
  return nonEmpty.some(titleSkeleton => {
    const baseNoDigits = titleSkeleton.replace(/\d+/g, '');
    if (!baseNoDigits) return false;
    return existingSkeletons.some(existing => {
      if (!existing) return false;
      if (!numericTokens.some(token => existing.includes(token))) return false;
      const existingNoDigits = existing.replace(/\d+/g, '');
      if (!existingNoDigits) return false;
      return existingNoDigits.includes(baseNoDigits) || baseNoDigits.includes(existingNoDigits);
    });
  });
}

function computeCandidateSignalScore(titleSkeletons, rawTitle, existingSkeleton) {
  if (!existingSkeleton) return 0;

  const skeletonList = Array.isArray(titleSkeletons) ? titleSkeletons.filter(Boolean) : [titleSkeletons].filter(Boolean);
  if (skeletonList.length === 0) return 0;

  let best = 0;
  const numericTokens = Array.from(new Set(String(rawTitle || '').match(/\d{4,}/g) || []));

  for (const skeleton of skeletonList) {
    let score = 0;

    if (existingSkeleton === skeleton) score += 120;
    if (skeletonsMatch(existingSkeleton, skeleton) || skeletonsMatch(skeleton, existingSkeleton)) score += 55;

    const minLen = Math.min(existingSkeleton.length, skeleton.length);
    if (minLen >= 6 && (existingSkeleton.includes(skeleton) || skeleton.includes(existingSkeleton))) {
      score += 60;
    }

    const prefixLen = commonPrefixLength(existingSkeleton, skeleton);
    const suffixLen = commonSuffixLength(existingSkeleton, skeleton);
    if (prefixLen >= 5 && suffixLen >= 6) {
      score += 62;
    }

    if (numericTokens.length > 0 && numericTokens.some(token => existingSkeleton.includes(token))) {
      score += 28;
    }

    if (/^\d+$/.test(existingSkeleton) && existingSkeleton.length >= 6) {
      score -= 25;
    }

    if (score > best) best = score;
  }

  return best;
}

function commonPrefixLength(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLength(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

function evaluateRowMatchDecision(rawTitle, title, titleSkeletons, existingSkeletons) {
  const scoreBySkeleton = new Map();
  for (const skeleton of existingSkeletons) {
    if (!skeleton) continue;
    const score = computeCandidateSignalScore(titleSkeletons, rawTitle, skeleton);
    if (score > (scoreBySkeleton.get(skeleton) || 0)) {
      scoreBySkeleton.set(skeleton, score);
    }
  }

  const ranked = [...scoreBySkeleton.entries()]
    .map(([skeleton, score]) => ({ skeleton, score }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0] || { score: 0, skeleton: null };
  const second = ranked[1] || { score: 0, skeleton: null };
  const margin = best.score - second.score;

  if (best.score >= 95 || (best.score >= 75 && margin >= 15)) {
    return { decision: 'match', confidence: 'high', best, second, margin };
  }

  if (best.score >= 55) {
    return { decision: 'abstain', confidence: 'medium', best, second, margin };
  }

  return { decision: 'generate', confidence: 'low', best, second, margin };
}

function sanitizeGeneratedFileStem(title, { fallback = 'Untitled', maxLength = 100, spaceAsDash = false } = {}) {
  let stem = String(title || '').replace(/[<>:"/\\|?*]/g, '-');
  stem = spaceAsDash
    ? stem.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    : stem.replace(/\s+/g, ' ').trim();

  if (!normalizeTitle(stem)) {
    stem = fallback;
  }

  stem = stem.slice(0, maxLength).trim();
  if (!normalizeTitle(stem)) {
    stem = fallback;
  }

  return stem;
}

export function convertRelationToWikilink(value) {
  if (!value || typeof value !== 'string') return value;
  
  const lines = value.split('\n');
  const isMultiLineList = lines.length > 1 && lines.every(line => line.trim().startsWith('- '));
  
  const targetPattern = '(?:https?---www\\.notion\\.so-[0-9a-f]+(?:-pvs=\\d+)?|https?:\\/\\/(?:www\\.)?notion\\.so\\/[^\\s)]+|(?:www\\.)?notion\\.so\\/[^\\s)]+|[^\\s)]+\\.md)';
  const segmentPattern = new RegExp(`\\(\\s*(${targetPattern})\\s*\\)`, 'gi');

  const formatWikilinkTarget = (name) => {
    const cleaned = String(name || '').trim();
    if (!cleaned) return cleaned;
    if (!/[\[\]]/.test(cleaned)) return `[[${cleaned}]]`;
    const escapedTarget = cleaned.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
    return `[[${escapedTarget}|${cleaned}]]`;
  };

  const extractLinks = (input) => {
    const links = [];
    segmentPattern.lastIndex = 0;
    let cursor = 0;
    for (const match of input.matchAll(segmentPattern)) {
      let cleaned = input.slice(cursor, match.index).trim();
      cursor = match.index + match[0].length;
      cleaned = cleaned.replace(/^[,;，；]+\s*/, '');
      cleaned = stripNotionUrlFromTitle(cleaned);
      cleaned = cleaned.replace(/\s+/g, ' ');
      cleaned = cleaned.replace(/\s+(?:xs|s|m|l|xl|xxl|xxxl)$/i, '').trim();
      if (cleaned) {
        links.push(formatWikilinkTarget(cleaned));
      }
    }
    return links;
  };
  
  if (isMultiLineList) {
    const processedLines = lines.map(line => {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('- ')) {
        const links = extractLinks(trimmedLine.slice(2));
        return links.join(', ');
      }
      const links = extractLinks(trimmedLine);
      return links.join(', ');
    }).filter(line => line.length > 0);
    
    return processedLines.join('\n');
  }

  const links = extractLinks(value);
  if (links.length === 0) return value;
  if (links.length === 1) return links[0];
  return links;
}

export function stripImagePlaceholders(value) {
  if (!value || typeof value !== 'string') return value;
  IMAGE_PLACEHOLDER_PATTERN.lastIndex = 0;
  return value
    .replace(IMAGE_PLACEHOLDER_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ============================================================================
// CSV Enrichment for Bases Mode
// ============================================================================

export async function enrichMdWithCsvProperties(csvInfo, dbDir) {
  const { header, rows } = csvInfo;
  let enriched = 0;
  let skipped = 0;

  let mdFiles;
  try {
    const entries = await readdir(dbDir);
    mdFiles = entries.filter(f => f.endsWith('.md'));
  } catch {
    return { enriched: 0, skipped: 0 };
  }

  if (mdFiles.length === 0 || rows.length === 0) return { enriched: 0, skipped: 0 };

  const csvRowMap = buildCsvRowMap(header, rows);
  const columnTypes = detectColumnTypes(header, rows);
  const threeDPrintModelIndex = header.findIndex(column => sanitizeKey(column) === '3d-print-model');

  for (const mdFile of mdFiles) {
    const mdPath = join(dbDir, mdFile);
    const content = await Bun.file(mdPath).text();
    const parsed = matter(content);

    const titleFromFrontmatter = parsed.data?.title;
    const titleFromFilename = basename(mdFile, '.md');
    const cleanedFilename = cleanName(mdFile).replace(/\.md$/, '');
    const headingFromBody = extractFirstHeading(parsed.content);

    const row = findMatchingCsvRow(csvRowMap, titleFromFrontmatter, titleFromFilename, cleanedFilename, headingFromBody);
    if (!row) {
      skipped++;
      continue;
    }

    let modified = false;
    for (let i = 0; i < header.length; i++) {
      const colName = header[i].trim();
      if (!colName) continue;

      const value = (row[i] || '').replace(/^"|"$/g, '').trim();
      if (!value) continue;

      const key = sanitizeKey(colName);
      if (!key) continue;
      if (key === 'model' && threeDPrintModelIndex >= 0) {
        const alternative = (row[threeDPrintModelIndex] || '').replace(/^"|"$/g, '').trim();
        if (alternative) {
          const modelLink = convertRelationToWikilink(value);
          const alternativeLink = convertRelationToWikilink(alternative);
          if (relationTargetsEquivalent(modelLink, alternativeLink)) continue;
        }
      }

      const lines = value.split('\n');
      const isMultiLineList = lines.length > 1 && lines.every(line => line.trim().startsWith('- '));
      
      if (key === 'tags') {
        const newTags = value.split(',').map(t => t.trim()).filter(t => t);
        const existing = Array.isArray(parsed.data.tags) ? parsed.data.tags : [];
        parsed.data[key] = [...new Set([...existing, ...newTags])];
        modified = true;
      } else if (isMultiLineList || columnTypes[colName] === 'relation') {
        if (!parsed.data[key]) {
          parsed.data[key] = convertRelationToWikilink(value);
          modified = true;
        }
      } else if (!parsed.data[key]) {
        let processed = stripImagePlaceholders(value);
        if (typeof processed === 'string' && processed.includes('.md)')) {
          const result = convertBacklinksProperty(processed);
          processed = result.wikilinks.length > 0 ? result.wikilinks : convertPropertyRelations(processed);
        }
        parsed.data[key] = processed;
        modified = true;
      }
    }

    if (modified) {
      const newContent = matter.stringify(parsed.content, parsed.data);
      await Bun.write(mdPath, newContent);
      enriched++;
    } else {
      skipped++;
    }
  }

  return { enriched, skipped };
}

export async function generateMissingMdFromCsv(csvInfo, dbDir, options = {}) {
  const { header, rows, databaseName } = csvInfo;
  if (shouldSkipDatabaseAutoGeneration(databaseName)) {
    return 0;
  }

  let created = 0;
  const globalExistingSkeletons = Array.isArray(options.globalExistingSkeletons)
    ? options.globalExistingSkeletons
    : [];
  const allowCreateDir = options.allowCreateDir !== false;
  const abstainCollector = Array.isArray(options.abstainCollector)
    ? options.abstainCollector
    : null;

  if (allowCreateDir) {
    await mkdir(dbDir, { recursive: true });
  }

  let existingFiles;
  try {
    const entries = await readdir(dbDir);
    existingFiles = entries.filter(f => f.endsWith('.md'));
  } catch {
    if (!allowCreateDir) {
      return 0;
    }
    existingFiles = [];
  }

  const existingSkeletons = [];
  for (const f of existingFiles) {
    const nameNoExt = basename(f, '.md');
    existingSkeletons.push(normalizeTitle(nameNoExt));
    const cleaned = cleanName(f).replace(/\.md$/, '');
    existingSkeletons.push(normalizeTitle(cleaned));
    const recovered = tryRecoverMojibake(nameNoExt);
    if (recovered) existingSkeletons.push(normalizeTitle(recovered));
  }

  const usedFilenames = new Set(existingFiles.map(f => f.toLowerCase()));
  const columnTypes = detectColumnTypes(header, rows);
  const threeDPrintModelIndex = header.findIndex(column => sanitizeKey(column) === '3d-print-model');

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawTitle = (row[0] || '').replace(/^"|"$/g, '').trim();
    let title = normalizeGeneratedRowTitle(rawTitle, 'Untitled');
    if (title === 'Untitled' && (!rawTitle || !(/[\p{L}\p{N}]/u.test(rawTitle)))) continue;
    if (isWeakGeneratedRowTitle(title)) continue;

    const titleMatchSkeletons = buildRowTitleMatchSkeletons(rawTitle, 'Untitled');
    const titleSkeleton = titleMatchSkeletons[0] || normalizeTitle(title);
    if (!titleSkeleton) continue;
    const allKnownSkeletons = [...existingSkeletons, ...globalExistingSkeletons];
    if (hasNumericAnchorMatch(rawTitle, titleMatchSkeletons, allKnownSkeletons)) continue;
    if (looksLikeCompositeEntityTitle(title, titleSkeleton, allKnownSkeletons)) continue;

    const scoringDecision = evaluateRowMatchDecision(rawTitle, title, titleMatchSkeletons, allKnownSkeletons);
    if (scoringDecision.decision === 'match') continue;
    if (scoringDecision.decision === 'abstain') {
      if (abstainCollector) {
        abstainCollector.push({
          databaseName,
          databaseSource: csvInfo.path ? basename(csvInfo.path) : (csvInfo.resolvedCsvFileName || `${databaseName}.csv`),
          rowIndex: i + 1,
          rawTitle,
          normalizedTitle: title,
          score: scoringDecision.best.score,
          margin: scoringDecision.margin,
          bestSkeleton: scoringDecision.best.skeleton
        });
      }
      continue;
    }

    const sourceCsvName = csvInfo.path
      ? basename(csvInfo.path)
      : (csvInfo.resolvedCsvFileName || `${databaseName}.csv`);

    const frontmatterData = {
      title,
      published: false,
      'database-source': sourceCsvName,
      'database-row': i + 1
    };
    for (let j = 0; j < header.length; j++) {
      const colName = header[j].trim();
      if (!colName) continue;
      const value = (row[j] || '').replace(/^"|"$/g, '').trim();
      if (!value) continue;
      const key = sanitizeKey(colName);
      if (!key || key === 'title') continue;
      if (key === 'model' && threeDPrintModelIndex >= 0) {
        const alternative = (row[threeDPrintModelIndex] || '').replace(/^"|"$/g, '').trim();
        if (alternative) {
          const modelLink = convertRelationToWikilink(value);
          const alternativeLink = convertRelationToWikilink(alternative);
          if (relationTargetsEquivalent(modelLink, alternativeLink)) continue;
        }
      }
      if (key === 'tags') {
        frontmatterData[key] = value.split(',').map(t => t.trim()).filter(t => t);
      } else if (columnTypes[colName] === 'relation') {
        frontmatterData[key] = convertRelationToWikilink(value);
      } else {
        let processed = stripImagePlaceholders(value);
        if (typeof processed === 'string' && processed.includes('.md)')) {
          const result = convertBacklinksProperty(processed);
          processed = result.wikilinks.length > 0 ? result.wikilinks : convertPropertyRelations(processed);
        }
        frontmatterData[key] = processed;
      }
    }

    let safeTitle = sanitizeGeneratedFileStem(title, {
      fallback: 'Untitled',
      maxLength: 100,
      spaceAsDash: false
    });

    let fileName = `${safeTitle}.md`;
    let counter = 2;
    while (usedFilenames.has(fileName.toLowerCase())) {
      fileName = `${safeTitle}-${counter}.md`;
      counter++;
    }
    usedFilenames.add(fileName.toLowerCase());
    existingSkeletons.push(normalizeTitle(title));
    globalExistingSkeletons.push(normalizeTitle(title));

    const mdContent = matter.stringify(`\n# ${title}\n`, frontmatterData);
    await Bun.write(join(dbDir, fileName), mdContent);
    created++;
  }

  return created;
}

function buildCsvRowMap(header, rows) {
  const exact = new Map();
  const normalized = [];
  const normalizedSeen = new Set();

  for (const row of rows) {
    const title = (row[0] || '').replace(/^"|"$/g, '').trim();
    const normalizedGenerated = normalizeGeneratedRowTitle(title, 'Untitled');
    const key = title ? title.toLowerCase() : 'untitled';
    if (!exact.has(key)) exact.set(key, row);

    const cleaned = stripNotionUrlFromTitle(title);
    if (cleaned !== title) {
      const cleanKey = cleaned.toLowerCase();
      if (!exact.has(cleanKey)) exact.set(cleanKey, row);
    }

    if (normalizedGenerated !== title && normalizedGenerated !== cleaned) {
      const normalizedGeneratedKey = normalizedGenerated.toLowerCase();
      if (!exact.has(normalizedGeneratedKey)) exact.set(normalizedGeneratedKey, row);
    }

    const variants = [title, cleaned, normalizedGenerated];
    for (const variant of variants) {
      if (!variant) continue;
      const normalizedKey = normalizeTitle(variant);
      if (!normalizedKey) continue;
      const marker = `${normalizedKey}::${title}`;
      if (normalizedSeen.has(marker)) continue;
      normalizedSeen.add(marker);
      normalized.push([normalizedKey, row]);
    }
  }

  return { exact, normalized };
}

function tryRecoverMojibake(str) {
  try {
    const bytes = new Uint8Array([...str].map(c => c.charCodeAt(0)));
    if (bytes.every(b => b < 0x80)) return null;
    const recovered = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return recovered !== str ? recovered : null;
  } catch {
    return null;
  }
}

function findMatchingCsvRow(csvRowMap, titleFromFrontmatter, titleFromFilename, cleanedFilename, headingFromBody) {
  const candidates = [titleFromFrontmatter, titleFromFilename, cleanedFilename, headingFromBody];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = csvRowMap.exact.get(candidate.toLowerCase());
    if (match) return match;
    const recovered = tryRecoverMojibake(candidate);
    if (recovered) {
      const match2 = csvRowMap.exact.get(recovered.toLowerCase());
      if (match2) return match2;
    }
  }

  const normalizedCandidates = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeTitle(candidate);
    if (normalized) normalizedCandidates.push(normalized);
    const recovered = tryRecoverMojibake(candidate);
    if (recovered) {
      const recoveredNormalized = normalizeTitle(recovered);
      if (recoveredNormalized) normalizedCandidates.push(recoveredNormalized);
    }
  }

  for (const candidate of normalizedCandidates) {
    for (const [normalizedTitle, row] of csvRowMap.normalized) {
      if (candidate === normalizedTitle) return row;
    }
  }

  for (const candidate of normalizedCandidates) {
    for (const [normalizedTitle, row] of csvRowMap.normalized) {
      if (skeletonsMatch(candidate, normalizedTitle)) return row;
    }
  }

  return null;
}

function extractFirstHeading(content) {
  if (!content || typeof content !== 'string') return null;
  const match = content.match(/^#\s+(.+)$/m);
  if (!match) return null;
  return match[1].trim();
}

function assignResolvedOutputNames(csvFiles) {
  const groupMap = new Map();
  for (const csvInfo of csvFiles) {
    const key = `${csvInfo.relativeDir.toLowerCase()}::${csvInfo.databaseName.toLowerCase()}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(csvInfo);
  }

  const usedByDir = new Map();
  for (const csvInfo of csvFiles) {
    const dirKey = csvInfo.relativeDir.toLowerCase();
    if (!usedByDir.has(dirKey)) usedByDir.set(dirKey, new Set());
  }

  for (const group of groupMap.values()) {
    group.sort((a, b) => a.path.localeCompare(b.path));

    const dirKey = group[0].relativeDir.toLowerCase();
    const used = usedByDir.get(dirKey);

    for (let i = 0; i < group.length; i++) {
      const csvInfo = group[i];
      let stem = csvInfo.databaseName;
      if (group.length > 1) {
        const shortId = csvInfo.notionObjectId ? csvInfo.notionObjectId.slice(0, 8) : `${i + 1}`;
        stem = `${csvInfo.databaseName} [${shortId}]`;
      }

      let candidate = stem;
      let counter = 2;
      while (used.has(candidate.toLowerCase())) {
        candidate = `${stem} ${counter}`;
        counter++;
      }
      used.add(candidate.toLowerCase());

      csvInfo.outputStem = candidate;
      csvInfo.resolvedCsvFileName = `${candidate}.csv`;
      csvInfo.resolvedBaseFileName = `${candidate}.base`;
      csvInfo.resolvedIndexFileName = `${candidate}_Index.md`;
      csvInfo.resolvedNotesDirName = candidate;
    }
  }

  const usedRootIndexes = new Set();
  const usedDataviewCsv = new Set();

  for (const csvInfo of csvFiles.sort((a, b) => a.path.localeCompare(b.path))) {
    let rootIndex = `${csvInfo.databaseName}_Index.md`;
    if (usedRootIndexes.has(rootIndex.toLowerCase())) {
      rootIndex = `${csvInfo.outputStem}_Index.md`;
    }
    let indexCounter = 2;
    while (usedRootIndexes.has(rootIndex.toLowerCase())) {
      rootIndex = `${csvInfo.outputStem}_Index ${indexCounter}.md`;
      indexCounter++;
    }
    usedRootIndexes.add(rootIndex.toLowerCase());
    csvInfo.resolvedRootIndexFileName = rootIndex;

    let dataviewCsv = `${csvInfo.fileName}.csv`;
    if (usedDataviewCsv.has(dataviewCsv.toLowerCase())) {
      dataviewCsv = `${csvInfo.outputStem}.csv`;
    }
    let csvCounter = 2;
    while (usedDataviewCsv.has(dataviewCsv.toLowerCase())) {
      dataviewCsv = `${csvInfo.outputStem} ${csvCounter}.csv`;
      csvCounter++;
    }
    usedDataviewCsv.add(dataviewCsv.toLowerCase());
    csvInfo.resolvedDataviewCsvFileName = dataviewCsv;
  }
}

export function findBasesReconciliationIssues(targetDir, csvFiles) {
  const rawIdCsvPattern = /(?:\s|^)[0-9a-fA-F]{32}(?:_all)?\.csv$/i;
  const allVariantPattern = /_all\.csv$/i;
  const csvGlob = new Glob('**/*.csv');

  const leftoverRawCsvPaths = [];
  for (const relCsvPath of csvGlob.scanSync(targetDir)) {
    const fileName = basename(relCsvPath);
    if (!rawIdCsvPattern.test(fileName) && !allVariantPattern.test(fileName)) continue;
    leftoverRawCsvPaths.push(join(targetDir, relCsvPath));
  }

  const expectedBasePaths = new Set();
  for (const csvInfo of csvFiles) {
    const csvDir = dirname(csvInfo.path);
    const baseFileName = csvInfo.resolvedBaseFileName || `${csvInfo.databaseName}.base`;
    expectedBasePaths.add(join(csvDir, baseFileName));
  }

  const missingBaseFiles = [];
  for (const basePath of expectedBasePaths) {
    try {
      statSync(basePath);
    } catch {
      missingBaseFiles.push(basePath);
    }
  }

  return {
    leftoverRawCsvPaths,
    missingBaseFiles,
    hasIssues: leftoverRawCsvPaths.length > 0 || missingBaseFiles.length > 0
  };
}

function relationTargetsEquivalent(a, b) {
  if (!a || !b) return false;
  const normalize = (value) => {
    const raw = Array.isArray(value) ? value.join(',') : String(value);
    return normalizeTitle(raw.replace(/\[\[|\]\]/g, ''));
  };
  return normalize(a) === normalize(b);
}
