import { join, dirname, basename } from "node:path";
import { mkdir } from "node:fs/promises";
import { statSync } from "node:fs";
import { Glob } from "bun";
import chalk from "chalk";
import { generateValidFrontmatter } from "./frontmatter.js";

// ============================================================================
// CSV Database Processing
// ============================================================================

/**
 * Processes CSV database files and creates index pages
 * @param {string} targetDir - The directory to scan for CSV files
 * @returns {Array} - Array of processed CSV info
 */
export async function processCsvDatabases(targetDir) {
  const csvFiles = [];
  const csvGlob = new Glob('**/*.csv');

  for (const csvPath of csvGlob.scanSync(targetDir)) {
    const fullPath = join(targetDir, csvPath);

    try {
      const csvContent = await Bun.file(fullPath).text();
      const lines = csvContent.split('\n').filter(line => line.trim());

      if (lines.length < 2) continue; // Skip empty or header-only files

      // Parse CSV header
      const header = lines[0].replace(/^\uFEFF/, '').split(',').map(col => col.trim().replace(/"/g, ''));
      const rows = lines.slice(1).map(line => {
        // Simple CSV parsing (handles basic cases)
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

      // Extract database name from filename
      const fileName = basename(csvPath, '.csv');
      const databaseName = fileName.replace(/\s[0-9a-fA-F]{32}(_all)?$/, ''); // Remove hash

      csvFiles.push({
        path: fullPath,
        fileName,
        databaseName,
        header,
        rows,
        recordCount: rows.length
      });

    } catch (error) {
      console.warn(chalk.yellow(`Warning: Failed to process CSV ${csvPath}: ${error.message}`));
    }
  }

  return csvFiles;
}

/**
 * Creates a markdown index page for a CSV database
 * @param {Object} csvInfo - CSV file information
 * @param {string} targetDir - Target directory
 * @returns {string} - Generated markdown content
 */
export function generateDatabaseIndex(csvInfo, targetDir) {
  const { databaseName, header, rows, fileName } = csvInfo;
  const relativeCsvPath = `${databaseName}.csv`;

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
  const dbDir = join(baseDir, databaseName);

  try {
    statSync(dbDir);

    // Directory exists - reference the _data folder
    markdown += `## Individual Pages\n\n`;
    markdown += `Individual database pages are stored in [[${databaseName}/_data|${databaseName}/_data/]]\n\n`;
  } catch (error) {
    // No individual pages directory
  }

  return markdown;
}

/**
 * Creates individual markdown notes from CSV rows (Dataview mode)
 * @param {Object} csvInfo - CSV file information
 * @param {string} targetDir - Target directory
 * @param {string} databasesDir - _databases subdirectory path
 * @returns {Array} - Array of created note file paths
 */
export async function createNotesFromCsvRows(csvInfo, targetDir, databasesDir) {
  const { databaseName, header, rows, fileName } = csvInfo;
  const createdNotes = [];

  // Create a folder for the database notes
  const notesDir = join(targetDir, databaseName);
  await mkdir(notesDir, { recursive: true });

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Create note content with frontmatter
    const noteData = {};
    const frontmatter = {
      tags: [`database/${databaseName.toLowerCase().replace(/\s+/g, '-')}`],
      'database-source': `_databases/${fileName}`,
      'database-row': i + 1,
      published: false
    };

    // Extract title from first column or generate one
    let title = '';
    if (row[0] && row[0].trim()) {
      title = row[0].replace(/"/g, '').trim();
    } else {
      title = `${databaseName} Record ${i + 1}`;
    }

    frontmatter.title = title;

    // Add CSV columns as frontmatter properties
    header.forEach((column, idx) => {
      if (row[idx] && row[idx].trim()) {
        const value = row[idx].replace(/"/g, '').trim();
        const key = column.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

        // Special handling for common Notion database columns
        if (key === 'notion-id' || column === 'notion-id') {
          frontmatter['notion-id'] = value;
        } else if (key === 'status' || key === 'priority' || key === 'assignee' || key === 'owner') {
          frontmatter[key] = value;
        } else {
          frontmatter[key] = value;
        }
      }
    });

    // Generate clean filename
    const cleanTitle = title
      .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-')            // Spaces to hyphens
      .toLowerCase()
      .slice(0, 50);                   // Limit length

    const noteFileName = `${cleanTitle || `record-${i + 1}`}.md`;
    const notePath = join(notesDir, noteFileName);

    // Generate markdown content
    let content = generateValidFrontmatter(frontmatter, '');
    content += `\n# ${title}\n\n`;

    // Add table with all properties
    content += '## Properties\n\n';
    content += '| Property | Value |\n';
    content += '| --- | --- |\n';

    header.forEach((column, idx) => {
      if (row[idx] && row[idx].trim()) {
        const value = row[idx].replace(/"/g, '').trim().replace(/\|/g, '\\|');
        content += `| ${column} | ${value} |\n`;
      }
    });

    content += `\n## Database Info\n\n`;
    content += `Source: [[${databaseName}_Index|${databaseName} Database]]\n`;
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
