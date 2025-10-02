---
title: "CLAUDE"
created: 2025-10-02
modified: 2025-10-02
published: false
---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a high-performance CLI tool that migrates Notion exports to Obsidian-compatible markdown format. The tool is written in JavaScript and uses Bun as the runtime.

## Commands

### Running the migration
```bash
# Basic migration (current directory)
./notion2obsidian.js

# Migrate specific directory or zip file
./notion2obsidian.js ./my-notion-export
./notion2obsidian.js ./Export-abc123.zip

# Using bun directly
bun run notion2obsidian.js ./my-export

# Using npm scripts
bun run migrate ./my-export
bun run dry-run ./my-export
```

### Command line options
- `-d, --dry-run` - Preview changes without modifying files
- `--skip-backup` - Skip creating backup files (faster but risky)
- `-v, --verbose` - Show detailed processing information
- `-h, --help` - Show help message

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

### Core Processing Pipeline

The migration happens in two phases:

**Phase 0: Zip Extraction (if needed)**
- Detects `.zip` files and extracts to same directory as zip (creates `{zipname}-extracted/` folder)
- Uses pure JS `fflate` library for reliable extraction (handles special characters)
- Filters out macOS metadata files (`__MACOSX`, hidden files)
- Automatically identifies single top-level directory after extraction
- Prompts user to keep or delete extracted files after migration

**Phase 1: Analysis & Planning**
1. Scans directory for all `.md` files and directories using `Glob`
2. Builds a file map for link resolution (handles URL-encoded names)
3. Extracts metadata (dates, Notion IDs, folder structure)
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
- Standard metadata: `title`, `created`, `modified`, `tags`, `aliases`, `notion-id`
- Folder path for duplicate disambiguation
- Inline metadata extracted from content: `status`, `owner`, `dates`, `priority`, `completion`, `summary`
- Always sets `published: false`

Tags are auto-generated from folder structure (normalized to lowercase with hyphens).

### Safety Features

- **Backups**: Creates `.backup` files before modification (unless `--skip-backup` is used)
- **Dry run mode**: Preview all changes without applying them
- **User confirmation**: Requires ENTER keypress before proceeding with actual migration
- **Error tracking**: `MigrationStats` class tracks all errors with file paths
- **Progress bars**: Real-time progress feedback using `cli-progress`

### File Structure

```
.
├── notion2obsidian.js            # Main migration script (executable)
├── notion2obsidian.test.js       # Test suite (uses Bun test runner)
├── package.json                  # Dependencies: chalk, cli-progress
├── README.md                     # User documentation
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
- **cli-progress** - Progress bars for long operations
- **fflate** - Pure JS zip extraction (handles special characters, no system dependencies)

### Key Implementation Details
- **Directory renaming**: Must happen deepest-first to avoid path conflicts (sorted by depth in `dirMigrationMap`)
- **File map**: Stores both original and URL-encoded names for link resolution
- **Link counting**: Estimated by sampling first 10 files to avoid double-processing
- **Zip handling**: Uses `fflate` library for pure JS extraction (no system dependencies)
- **Extraction location**: Extracts to `{zipname}-extracted/` in same directory as zip file
- **macOS metadata filtering**: Automatically skips `__MACOSX` and hidden files during extraction
- **Windows compatibility**: Sanitizes filenames by replacing forbidden characters with hyphens, uses `sep` for path splitting
- **Empty file handling**: Skips completely empty files during processing (no backup created)
- **Backup file exclusion**: `.backup` files from previous runs are excluded from processing
- **Frontmatter detection**: Handles BOM (Byte Order Mark) and whitespace variations
- **Quote escaping**: All YAML frontmatter values are properly escaped

### Robustness Features
- **Backup versioning**: Creates versioned backups (`.backup`, `.backup.1`, `.backup.2`) to prevent overwriting existing backups
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
