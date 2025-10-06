# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a high-performance CLI tool that migrates Notion exports to Obsidian-compatible markdown format. The tool is written in JavaScript and uses Bun as the runtime.

## Commands

### Running the migration

```bash
# Basic migration (current directory)
./notion2obsidian.js

# Single zip file
./notion2obsidian.js ./Export-abc123.zip

# Multiple zip files with glob patterns
./notion2obsidian.js *.zip
./notion2obsidian.js Export-*.zip

# Multiple zip files with custom output
./notion2obsidian.js *.zip -o ~/Obsidian/Notion-Import

# Directory processing with output
./notion2obsidian.js ./my-notion-export -o ~/Documents/Obsidian

# Using bun directly
bun run notion2obsidian.js ./my-export

# Using npm scripts
bun run migrate ./my-export
bun run dry-run ./my-export
```

### Command line options

- `-o, --output DIR` - Output directory for processed files (default: extract location)
- `-d, --dry-run` - Preview changes without modifying files (extracts 10% sample or 10MB max for zip files)
- `-v, --verbose` - Show detailed processing information
- `-h, --help` - Show help message
- `-V, --version` - Show version number
- `--no-callouts` - Disable Notion callout conversion to Obsidian callouts
- `--no-csv` - Disable CSV database processing and index generation
- `--dataview` - Create individual MD files from CSV rows (default: keep CSV only)
- `--no-banners` - Disable cover image detection and banner frontmatter

### Testing

```bash
# Run tests
bun test

# Watch mode
bun test --watch
```

### Dependencies

```bash
# Install dependencies
bun install
```

## Architecture

### Modular Structure (v2.4.0+)

The tool is organized into focused modules for maintainability and AI-context-friendliness:

**Core Libraries** (`src/lib/`):
- `utils.js` (88 lines) - Shared utilities and regex patterns (PATTERNS, BATCH_SIZE)
- `stats.js` (37 lines) - Migration statistics tracking (MigrationStats class)
- `cli.js` (134 lines) - Command-line argument parsing and help text
- `links.js` (99 lines) - Markdown to wiki-link conversion and file mapping
- `callouts.js` (113 lines) - Notion callout transformation to Obsidian format
- `frontmatter.js` (341 lines) - YAML frontmatter generation and metadata extraction
- `scanner.js` (96 lines) - File and directory traversal with glob patterns
- `assets.js` (66 lines) - User interaction and directory operations
- `zip.js` (371 lines) - Archive extraction and merging with fflate
- `csv.js` (275 lines) - Database processing and Dataview integration
- `enrich.js` (735 lines) - Notion API enrichment functionality (experimental)

**Main Entry Point:**
- `notion2obsidian.js` (1,146 lines) - Runtime check, main migration logic, CLI routing

**Benefits of Modular Design:**
- Each module < 400 lines (fits in AI context windows)
- Clear separation of concerns
- Easy to locate and modify functionality
- Fully tested (94 tests passing)
- Backward compatible

### Core Processing Pipeline

The migration happens in two phases:

**Phase 0: Zip Extraction (if needed)**

- Detects `.zip` files and extracts to same directory as zip
- Creates shortened directory names: `Export-2d6f-extracted/` (first 4 chars of hash instead of full UUID)
- Uses pure JS `fflate` library for reliable extraction (handles special characters)
- Filters out macOS metadata files (`__MACOSX`, hidden files)
- Automatically identifies single top-level directory after extraction
- Shows extracted directory location and `rm -rf` command for cleanup after migration

**Phase 1: Analysis & Planning**

1. Scans directory for all `.md` files and directories using `Glob`
2. Builds a file map for link resolution (handles URL-encoded names)
3. Extracts metadata (Notion IDs, folder structure, tags)
4. Detects duplicate filenames across different folders
5. Generates preview of changes with estimated link conversion count (samples 10 files)

**Phase 2: Execution**

1. **Content Processing**: Adds frontmatter and converts markdown links to wiki links (batch processed, 50 files at a time)
2. **File Renaming**: Removes Notion IDs from filenames
3. **Directory Renaming**: Removes Notion IDs from folder names (processed deepest-first to avoid path conflicts)

### Key Patterns & Optimizations

**Regex Patterns** (defined in `PATTERNS` object at top of script):

- `hexId`: Matches 32-character hexadecimal Notion IDs
- `mdLink`: Matches markdown links `[text](file.md)`
- `frontmatter`: Detects existing frontmatter (handles BOM and whitespace)
- `notionIdExtract`: Extracts Notion ID from filename

**Performance Features**:

- Single file read per file (combines metadata extraction and content processing)
- Batch processing with `Promise.all()` (default: 50 files at a time, configurable via `BATCH_SIZE` constant)
- Pre-compiled regex patterns
- `Map` data structures for O(1) file lookups
- Sampling technique to estimate total link count (processes 10 files to calculate average)

**Duplicate Handling**:

- Files with identical names after ID removal are tracked in `duplicates` Map
- Folder paths stored in frontmatter `folder` field for disambiguation
- Original filenames preserved as aliases

### Link Conversion Logic

The `convertMarkdownLinkToWiki()` function handles:

- URL-encoded paths (decodes automatically)
- Anchor links: `[text](file.md#section)` → `[[file#section|text]]`
- Relative paths (including `../`)
- Skips external URLs and non-markdown files
- Preserves images and other assets

### Frontmatter Generation

Generated frontmatter includes:

- Standard metadata: `title`, `tags`, `aliases`, `notion-id`
- Folder path for duplicate disambiguation
- Inline metadata extracted from content: `status`, `owner`, `dates`, `priority`, `completion`, `summary`
- Always sets `published: false`

**Note**: Created/modified dates are NOT included as they're meaningless for Notion exports (zip timestamps reflect export time, not document creation).

Tags are auto-generated from folder structure (normalized to lowercase with hyphens).

### Safety Features

- **Dry run mode**: Preview all changes without applying them (with smart sampling for zip files)
- **User confirmation**: Requires ENTER keypress before proceeding with actual migration
- **Error tracking**: `MigrationStats` class tracks all errors with file paths
- **Clean output**: Minimal, focused output without unnecessary progress bars

### File Structure

```
.
├── notion2obsidian.js            # Main entry point (1,146 lines)
├── notion2obsidian.test.js       # Migration test suite
├── package.json                  # Dependencies: chalk, fflate, gray-matter, remark
├── README.md                     # User documentation
├── CLAUDE.md                     # AI assistant instructions
├── src/
│   └── lib/                      # Modular library files
│       ├── utils.js              # Utilities & regex patterns
│       ├── stats.js              # Migration statistics
│       ├── cli.js                # Argument parsing
│       ├── links.js              # Link conversion
│       ├── callouts.js           # Callout processing
│       ├── frontmatter.js        # Frontmatter generation
│       ├── scanner.js            # File traversal
│       ├── assets.js             # User interaction
│       ├── zip.js                # Archive extraction
│       ├── csv.js                # Database processing
│       ├── enrich.js             # Notion API enrichment
│       └── enrich.test.js        # Enrichment tests
└── docs/                         # Additional documentation
    ├── ARCHITECTURE.md
    ├── EXAMPLES.md
    ├── GETTING_STARTED.md
    └── QUICK_REFERENCE.md
```

## Important Implementation Notes

### Bun APIs and Node.js Compatibility

The tool uses a mix of Bun native APIs and Node.js compatibility:

**Native Bun APIs:**

- `Glob` from "bun" - Fast file globbing
- `Bun.file()` - Efficient file reading
- `Bun.write()` - Fast file writing
- `Bun.stdin.stream()` - User input handling
- Runtime check at startup exits if Bun is not available

**Node.js Compatibility (via Bun):**

- `node:fs/promises` - Directory operations (stat, readdir, rename, copyFile, mkdir, rm, writeFile)
- `node:path` - Path utilities (join, dirname, basename, extname, relative)
- Uses `node:` prefix to explicitly indicate Node.js compatibility APIs

**Third-party Dependencies:**

- **chalk** - Terminal colors and formatting
- **fflate** - Pure JS zip extraction (handles special characters, no system dependencies)
- **gray-matter** - YAML frontmatter parsing and generation
- **remark** - Markdown processing for image link updates
- **remark-frontmatter** - Frontmatter support for remark
- **unist-util-visit** - AST traversal utility for remark processing

### Key Implementation Details

- **Directory renaming**: Must happen deepest-first to avoid path conflicts (sorted by depth in `dirMigrationMap`)
- **File map**: Stores both original and URL-encoded names for link resolution
- **Link counting**: Estimated by sampling first 10 files to avoid double-processing
- **Zip handling**: Uses `fflate` library for pure JS extraction (no system dependencies)
- **Extraction location**: Extracts to shortened directory name (e.g., `Export-2d6f-extracted/`) in same directory as zip file
- **macOS metadata filtering**: Automatically skips `__MACOSX` and hidden files during extraction
- **Windows compatibility**: Sanitizes filenames by replacing forbidden characters with hyphens, uses `sep` for path splitting
- **Empty file handling**: Skips completely empty files during processing
- **Frontmatter detection**: Handles BOM (Byte Order Mark) and whitespace variations
- **Quote escaping**: All YAML frontmatter values are properly escaped
- **No backups**: Files are modified directly (use git or dry-run for safety)
- **CSV database handling**: Keeps only `_all.csv` and renames to `{DatabaseName}.csv`, moves individual database MD files to `_data` subfolder, creates Dataview-compatible Index files

### Robustness Features

- **Rename collision detection**: If target filename exists, appends counter (e.g., `Document-1.md`, `Document-2.md`)
- **Symlink protection**: Detects and skips symbolic links to prevent infinite loops in directory traversal
- **Circular reference detection**: Uses `realpath()` and visited set to detect circular directory references
- **Write permission check**: Validates write access before starting migration (saves time on permission errors)
- **Test write capability**: Creates and removes test file to verify actual write permissions

### Testing Notes

- Tests are in `notion2obsidian.test.js` using Bun's built-in test runner
- Core utility functions are duplicated in test file for testing (not exported from main script)
- Test suites cover: Notion ID detection, filename cleaning, sanitization
- Run tests with `bun test` or `bun run test`
