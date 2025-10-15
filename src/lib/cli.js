import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import chalk from "chalk";

// ============================================================================
// CLI Arguments Parser
// ============================================================================

export function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    targetPaths: [],
    outputDir: null,
    dryRun: false,
    verbose: false,
    pathsExplicitlyProvided: false,
    convertCallouts: true,
    processCsv: true,
    dataviewMode: false,  // Default to traditional mode (CSV only, no individual MD files)
    sqlsealMode: false,  // Use SQL Seal queries instead of Dataview
    enrich: false  // Enrichment mode
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run' || arg === '-d') {
      config.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      config.verbose = true;
    } else if (arg === '--output' || arg === '-o') {
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        config.outputDir = args[i + 1];
        i++; // Skip the next argument since it's the output directory
      } else {
        console.error(chalk.red('Error: --output requires a directory path'));
        process.exit(1);
      }
    } else if (arg === '--version' || arg === '-V') {
      showVersion();
      process.exit(0);
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--no-callouts') {
      config.convertCallouts = false;
    } else if (arg === '--no-csv') {
      config.processCsv = false;
    } else if (arg === '--dataview') {
      config.dataviewMode = true;  // Enable individual MD file creation from CSV rows
    } else if (arg === '--sqlseal') {
      config.sqlsealMode = true;  // Use SQL Seal instead of Dataview for CSV queries
    } else if (arg === '--enrich') {
      config.enrich = true;
    } else if (!arg.startsWith('-')) {
      // Positional arguments: first is input(s), last is output (if more than one positional arg)
      config.targetPaths.push(arg);
      config.pathsExplicitlyProvided = true;
    }
  }

  // Handle positional output directory (if no -o flag was used)
  // If we have 2+ positional args and no explicit outputDir, treat last as output
  if (config.outputDir === null && config.targetPaths.length >= 2) {
    config.outputDir = config.targetPaths.pop(); // Remove and use last arg as output
  }

  // Default to current directory if no paths provided
  if (config.targetPaths.length === 0) {
    config.targetPaths.push('.');
  }

  return config;
}

export function getVersion() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packagePath = join(__dirname, '../../package.json');
    const packageText = readFileSync(packagePath, 'utf-8');
    const packageJson = JSON.parse(packageText);

    return packageJson.version;
  } catch (error) {
    return '2.3.0'; // Fallback version
  }
}

export function showVersion() {
  console.log(`${chalk.blueBright.bold('💎 Notion 2 Obsidian')} ${chalk.gray(`v${getVersion()}`)}`);
}

export function showHelp() {
  console.log(`
${chalk.blueBright.bold('💎 Notion 2 Obsidian')} ${chalk.gray(`v${getVersion()}`)}

${chalk.yellow('Usage:')}
  notion2obsidian <input> [output] [options]
  notion2obsidian <input> -o <output> [options]

${chalk.yellow('Arguments:')}
  input               Directory, zip file(s), or glob pattern (*.zip)
  output              Output directory (optional, defaults to extract location)

${chalk.yellow('Options:')}
  -o, --output DIR    Output directory (alternative to positional argument)
  -d, --dry-run       Preview changes without modifying files
                      (extracts 10% sample or 10MB max for zip files)
  -v, --verbose       Show detailed processing information
      --enrich        Enrich vault with Notion API metadata (dates, URLs, assets)
      --no-callouts   Disable Notion callout conversion to Obsidian callouts
      --no-csv        Disable CSV database processing and index generation
      --dataview      Create individual MD files from CSV rows (default: keep CSV only)
      --sqlseal       Use SQL Seal query syntax instead of Dataview (default: Dataview)
  -V, --version       Show version number
  -h, --help          Show this help message

${chalk.yellow('Examples:')}
  ${chalk.gray('# Single zip file with output directory')}
  notion2obsidian ./Export-abc123.zip ~/Obsidian/Vault

  ${chalk.gray('# Single zip file (extracts in place)')}
  notion2obsidian ./Export-abc123.zip

  ${chalk.gray('# Multiple zip files with output')}
  notion2obsidian *.zip ~/Obsidian/Vault

  ${chalk.gray('# Using -o flag (backward compatible)')}
  notion2obsidian Export-*.zip -o ~/Obsidian/Vault

  ${chalk.gray('# Directory processing')}
  notion2obsidian ./my-notion-export ~/Documents/Obsidian

  ${chalk.gray('# Dry run to preview changes')}
  notion2obsidian *.zip ~/Vault --dry-run

  ${chalk.gray('# Enrich with Notion API metadata (requires NOTION_TOKEN)')}
  notion2obsidian ./my-vault --enrich

  ${chalk.gray('# Full workflow: migrate + enrich')}
  notion2obsidian Export-abc123.zip -o ./vault && notion2obsidian ./vault --enrich

${chalk.blueBright('Features:')}
  • Accepts zip files directly (extracts and merges to unified directory)
  • Supports multiple zip files with glob patterns (*.zip, Export-*.zip)
  • Custom output directory with -o/--output option
  • Removes Notion IDs from filenames and directories
  • Adds YAML frontmatter with metadata
  • Converts markdown links to wiki links
  • Handles duplicate filenames with folder context
  • Organizes attachments in folders with simplified paths
`);
}
