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
./migrate-notion-optimized.js

# Migrate specific directory
./migrate-notion-optimized.js ./my-notion-export

# Using bun directly
bun run migrate-notion-optimized.js ./my-notion-export

# Using npm scripts
bun run migrate ./my-export
bun run dry-run ./my-export
```

### Command line options
- `-d, --dry-run` - Preview changes without modifying files
- `--skip-backup` - Skip creating backup files (faster but risky)
- `-v, --verbose` - Show detailed processing information
- `-h, --help` - Show help message

### Dependencies
```bash
# Install dependencies
bun install
```

## Architecture

### Core Processing Pipeline

The migration happens in two phases:

**Phase 1: Analysis & Planning**
1. Scans directory for all `.md` files and directories using `Glob`
2. Builds a file map for link resolution (handles URL-encoded names)
3. Extracts metadata (dates, Notion IDs, folder structure)
4. Detects duplicate filenames across different folders
5. Generates preview of changes with estimated link conversion count

**Phase 2: Execution**
1. **Content Processing**: Adds frontmatter and converts markdown links to wiki links (batch processed, 50 files at a time)
2. **File Renaming**: Removes Notion IDs from filenames
3. **Directory Renaming**: Removes Notion IDs from folder names (processed deepest-first to avoid path conflicts)

### Key Patterns & Optimizations

**Regex Patterns** (defined in `PATTERNS` object at top of script):
- `hexId`: Matches 32-character hexadecimal Notion IDs
- `mdLink`: Matches markdown links `[[file|text]]`
- `frontmatter`: Detects existing frontmatter
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
├── migrate-notion-optimized.js   # Main script (single file)
├── package.json                  # Dependencies: chalk, cli-progress
└── README.md                     # User documentation
```

## Important Implementation Notes

- The tool uses Bun-specific APIs (`Bun.file()`, `Bun.write()`, `Bun.stdin`)
- Directory renaming must happen deepest-first to avoid path conflicts (sorted by depth in `dirMigrationMap`)
- File map stores both original and URL-encoded names for link resolution
- Link count is estimated by sampling first 10 files to avoid double-processing
- All file operations are async and use batch processing for performance
