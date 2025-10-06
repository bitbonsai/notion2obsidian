---
title: "CHANGELOG"
created: 2025-10-02
modified: 2025-10-06
published: false
---

# Changelog

All notable changes to the Notion to Obsidian Migration Tool.

## [2.4.3] - 2025-10-06 - Enrichment Fixes & Token Update

### 🐛 Bug Fixes
- Fixed `--enrich` flag not executing enrichment logic (was running migration instead)
- Added proper validation for enrichment mode (requires single directory path)

### 📝 Documentation
- Updated Notion token format: `secret_` → `ntn_` (new format since Sept 2024)
- Added comprehensive FAQ section for enrichment setup with step-by-step guide
- Added direct link to FAQ from CLI error messages

### ✨ Improvements
- Enrichment now shows clear setup instructions when NOTION_TOKEN is missing
- Better error messages pointing to https://bitbonsai.github.io/notion2obsidian/#enrich

---

## [2.4.1] - 2025-10-06 - Bug Fixes & Documentation

### 🐛 Bug Fixes
- Fixed runtime error from unused `detectCoverImage` import in frontmatter.js
- Removed cover image detection feature (unreliable, never used)

### 📝 Documentation
- Updated website with real execution data (1177 files, 1.71 GB in 1.7s)
- Improved FAQ terminology: "extracted folder" → "output directory"
- Added actual duplicate handling examples with sequential suffixes (-1, -2, etc.)
- Updated terminal demo with realistic file counts and performance metrics

### 🧹 Cleanup
- Removed `detectCoverImage()` function and `coverImage` pattern from codebase
- Removed non-functional `--no-banners` CLI flag

---

## [2.4.0] - 2025-10-06 - Modular Architecture

### 🏗️ Major Refactoring
- **Modular file structure**: Split monolithic 2,725-line file into 10 focused modules (58% reduction in main file size)
- **AI-context-friendly**: Each module < 400 lines, easy to understand and maintain
- **Clear separation of concerns**: Dedicated modules for utilities, stats, CLI, links, callouts, frontmatter, scanner, assets, zip, and CSV processing

### 📦 New Modules (`src/lib/`)
- `utils.js` (88 lines) - Shared utilities and regex patterns
- `stats.js` (37 lines) - Migration statistics tracking
- `cli.js` (134 lines) - Command-line argument parsing
- `links.js` (99 lines) - Markdown to wiki-link conversion
- `callouts.js` (113 lines) - Notion callout transformation
- `frontmatter.js` (341 lines) - YAML frontmatter generation
- `scanner.js` (96 lines) - File and directory traversal
- `assets.js` (66 lines) - User interaction
- `zip.js` (371 lines) - Archive extraction
- `csv.js` (275 lines) - Database processing

### ✨ New Features
- **Notion API enrichment tool** (`enrich.js`) - Experimental tool to enrich migrated vaults with additional metadata from Notion API

### 🧪 Testing
- All 94 tests passing (62 migration + 32 enrichment tests)
- Comprehensive test coverage across all modules
- Fully backward compatible - no breaking changes

### 📚 Documentation
- Updated CLAUDE.md with modular architecture details
- Added REFACTORING_STATUS.md documenting the refactoring process
- Complete file structure diagram showing all modules

### 🔧 Improvements
- Better code organization and maintainability
- Easier to locate and modify functionality
- Faster context loading for AI assistants
- Foundation for future feature additions

---

## [2.3.4] - 2025-10-05 - Version Bump

### 📦 Maintenance
- Version bump for consistency

---

## [2.3.3] - 2025-10-05 - Enhanced Collision Handling

### 🐛 Bug Fixes
- **Fixed path tracking after directory renames**: Files moved into attachment folders in Step 2 are now properly tracked after directories are renamed in Step 3, preventing duplicate `-1` suffixes
- **Improved collision detection**: Enhanced logic to detect when files should be moved into matching directories instead of receiving number suffixes

### 🔧 Improvements
- **Better file organization**: Files that collide with directory names are now consistently moved into those directories across all migration steps
- **Cleaner output**: Eliminated spurious `-1` suffixes that appeared when file paths weren't properly updated after directory renames

---

## [2.3.2] - 2025-10-05 - Collision Handling Improvements

### 🐛 Bug Fixes
- **Fixed file/directory collision handling**: When a file has the same name as a directory (e.g., `Atlassian.md` and `Atlassian/`), the file is now moved into the directory (`Atlassian/Atlassian.md`) instead of getting a `-1` suffix
- **Removed Notion's collision suffixes**: Automatically strips `-\d+` suffixes from filenames when the base name matches the parent directory (e.g., `Atlassian/Atlassian-1.md` → `Atlassian/Atlassian.md`)

### 🔧 Improvements
- **Cleaner file organization**: Files with attachments are properly moved into their matching directories without unnecessary number suffixes
- **Better handling of Notion's export naming**: Detects and removes collision numbers added by Notion during export

---

## [2.3.0] - 2025-10-04 - Enhanced Database & Visual Element Support

### ✨ New Features
- **Improved Database Handling** (DEFAULT):
  - CSV files kept in original locations with clean names (e.g., `Odara - pages.csv`)
  - Individual database pages moved to `_data/` subfolders for clean organization
  - Index files with Dataview queries showing ALL records (not just 10)
  - Clickable CSV links in Index files for easy editing
  - Removes duplicate `_all.csv` files
- **Dataview Integration**: Optional `--dataview` flag creates individual notes from CSV rows with query-based indexes
- **Smart File Naming**: Files with same name as folders get " Overview" suffix instead of "-1"
- **Notion Callout Conversion**: Transforms Notion callouts with icons to Obsidian format (18+ icon mappings)
- **Cover Image Support**: Detects and preserves Notion cover images as banner frontmatter
- **Multiple Zip File Support**: Process multiple zip files with glob patterns (*.zip, Export-*.zip)
- **Custom Output Directory**: New `-o, --output DIR` parameter to specify where processed files should go
- **Automatic Directory Opening**: Automatically opens the completed migration directory (no user input required)
- **Enhanced File Progress Display**: Shortened long filenames in progress display (shows first part + last 5 characters)

### 🔧 Improvements
- **Clean Code Architecture**: Consolidated imports, removed inline `require()` calls
- **Robust Frontmatter Handling**: Replaced regex-based processing with gray-matter library for bulletproof YAML generation
- **Enhanced Visual Element Processing**: Comprehensive icon-to-callout mapping with 18+ Notion icons
- **Database Structure Options**: Traditional mode (CSV + Dataview) is now default; `--dataview` creates individual MD files
- **Flexible Feature Control**: New flags `--no-callouts`, `--no-csv`, `--dataview` for granular control
- **Better UX**: Cleaner spacing and progress messages during extraction
- **Automatic Cleanup**: Removes temporary extraction directories after successful migration

### 🐛 Bug Fixes
- **Fixed Callout Bracket Escaping**: Resolved issue where Obsidian callouts `[!note]` were incorrectly escaped to `\[!note]` during remark processing
- **Fixed File Path Updates**: Improved directory renaming logic to correctly update file paths for nested directory structures
- **Enhanced ENOENT Error Handling**: Fixed file renaming errors that occurred when directories were renamed before individual files
- **Fixed Frontmatter Format**: Changed `notion-alias` to `aliases` for proper Obsidian compatibility
- **Enhanced ESC Key Detection**: Improved cancellation handling for better terminal compatibility
- **Smarter Subdirectory Detection**: Better handling of complex nested directory structures

### 📚 Documentation
- Updated README.md with comprehensive Dataview and database feature documentation
- Added new callout and visual element processing sections
- Updated help text with all new command line options
- Added examples for Dataview mode and feature control flags

## [2.2.1] - 2025-10-02 - Documentation Update

### 📚 Documentation
- Updated README.md with all v2.2.0 changes
- Updated CLAUDE.md technical documentation
- Removed references to progress bars (no longer used)
- Removed references to backup files (no longer created)
- Removed created/modified dates from frontmatter examples
- Added comprehensive zip file support documentation
- Updated dependencies list (removed cli-progress, added fflate)
- Documented shortened directory name feature
- Clarified that dates are meaningless for Notion exports

### 🐛 Minor Fixes
- Fixed documentation inconsistencies
- Updated examples to match current behavior

---

## [2.2.0] - 2025-10-02 - UX Streamlining Release

### 🎯 Major UX Improvements
- **Removed progress bars**: Migration is too fast for progress bars to be useful
- **Removed backup file creation**: Cleaner output, original zip always preserved
- **Removed created/modified dates from frontmatter**: Meaningless for Notion exports (timestamps reflect export time, not document creation)
- **Shortened extracted directory names**: Now `Export-2d6f-extracted/` instead of full UUID for convenience

### ⚡ Performance & Reliability
- Switched from system `unzip` to pure JavaScript `fflate` library for better cross-platform compatibility
- Better handling of special characters in filenames during extraction
- Improved dry-run cleanup (properly removes extraction directory)

### 🔧 Technical Changes
- Removed `cli-progress` dependency (no longer needed)
- Added `fflate` dependency for high-performance zip extraction
- Simplified output messages for clarity
- Major code refactoring: 332 lines changed (144 insertions, 204 deletions)

### 🎨 Output Improvements
- Cleaner, more focused terminal output
- Better error messages
- Simplified completion messages

---

## [2.1.0] - 2025-10-02 - Smart Sampling Release

### 🎉 Major Feature: Smart Dry-Run Sampling
- **Sample extraction for dry-run with zip files**: Extracts only 10% of files or 10MB maximum for preview
- **Evenly distributed sampling**: Provides realistic preview without processing entire export
- **Significant performance improvement**: 10MB vs 1.8GB for large exports
- **Accurate link count estimates**: Still provides realistic migration preview

### 📖 Documentation
- Updated help text to document dry-run sampling behavior
- Reordered examples to show zip files first (recommended workflow)
- Clarified that dry-run works with both zip files and directories

### 🔧 Technical Details
- Intelligent file selection algorithm for representative samples
- Shows sample size in output (e.g., "54 of 542 files (10%)")
- Maintains compatibility with full extraction mode

---

## [2.0.0] - 2024-10-02 - Optimized Release

### 🎉 Major Features Added

- **Dry Run Mode**: Preview all changes before applying them with `--dry-run` flag
- **Progress Bars**: Beautiful real-time progress indicators using cli-progress
- **Color Output**: Enhanced terminal output with chalk for better readability
- **Automatic Backups**: Creates `.backup` files before modifying (optional with `--skip-backup`)
- **CLI Help System**: Comprehensive help text with `--help` flag
- **Verbose Mode**: Detailed output for debugging with `--verbose` flag

### ⚡ Performance Improvements

- **2x Faster Processing**: Reduced file I/O from 2 reads to 1 per file
- **Batch Processing**: Concurrent processing of 50 files at a time using Promise.all()
- **Optimized Regex**: Pre-compiled patterns for better performance
- **Efficient Data Structures**: Map-based lookups for O(1) file resolution
- **Smart Sampling**: Dynamic link count estimation instead of processing all files twice

### 🔧 Technical Enhancements

- **Better Error Handling**: Try-catch blocks with detailed error reporting
- **Error Summary**: Comprehensive error report at end of migration
- **Statistics Tracking**: Dedicated MigrationStats class for metrics
- **Code Organization**: Clear sections with descriptive comments
- **Configuration Constants**: Easy-to-modify settings at top of file

### 🐛 Bug Fixes

- Fixed hardcoded link count (was 551, now calculated dynamically)
- Added support for anchor links in markdown (e.g., `#section`)
- Improved URL decoding for special characters
- Better handling of edge cases in link conversion
- Fixed potential race conditions in file operations

### 📚 Documentation

- Comprehensive README.md with examples
- OPTIMIZATION_SUMMARY.md comparing original vs optimized
- QUICK_REFERENCE.md for common operations
- Inline code comments for maintainability

### 🔄 Breaking Changes

- Now requires dependencies (chalk, cli-progress)
- Requires `bun install` before first use
- Different command line interface with flags

### 🎯 Link Conversion Improvements

- Support for section anchors: `[text](file.md#section)` → `[[file#section|text]]`
- Better URL decoding: `My%20File.md` → `My File`
- Handles relative paths: `../other/file.md`
- Preserves external links correctly

---

## [1.0.0] - Original Version

### Features

- Basic Notion ID removal from filenames
- Frontmatter generation with metadata
- Markdown to wiki link conversion
- Directory renaming
- Duplicate detection with folder context
- Inline metadata extraction (Status, Owner, etc.)
- Tag generation from folder structure

### Limitations

- No dry-run mode
- No progress feedback beyond console logs
- Sequential file processing
- No backup creation
- Limited error handling
- No CLI argument parsing
- Hardcoded values

---

## Migration Guide: v1 → v2

### Prerequisites

```bash
# Install new dependencies
bun install
```

### Command Changes

```bash
# v1
./migrate-notion.js ./my-export

# v2 - Always test first!
./migrate-notion-optimized.js ./my-export --dry-run

# v2 - Run migration
./migrate-notion-optimized.js ./my-export
```

### New Capabilities

```bash
# Preview changes
./migrate-notion-optimized.js ./my-export --dry-run

# Fast mode (no backups)
./migrate-notion-optimized.js ./my-export --skip-backup

# Debug mode
./migrate-notion-optimized.js ./my-export --verbose

# Get help
./migrate-notion-optimized.js --help
```

### Benefits of Upgrading

1. **Safety**: Dry-run and backups prevent data loss
2. **Speed**: 2x faster for large exports
3. **Visibility**: Progress bars show exactly what's happening
4. **Recovery**: Automatic backups enable easy rollback
5. **Reliability**: Better error handling and reporting

### Compatibility

- Both versions produce identical output (frontmatter, links, etc.)
- v2 is backward compatible with v1 exports
- Can safely run v2 on directories previously processed by v1

---

## Roadmap / Future Enhancements

### Planned for v2.1

- [ ] Interactive mode for conflict resolution
- [ ] Custom frontmatter templates via config file
- [ ] Undo/rollback functionality with migration log
- [ ] Support for Notion databases/tables
- [ ] CSV export of migration statistics

### Planned for v3.0

- [ ] Worker threads for parallel processing
- [ ] Plugin system for custom transformations
- [ ] GUI version with Electron
- [ ] Support for other export formats (Evernote, OneNote)
- [ ] Cloud storage integration (Dropbox, Google Drive)

### Under Consideration

- Incremental migration (only changed files)
- Two-way sync between Notion and Obsidian
- Template library for different workflows
- Integration with Obsidian plugins
- Web-based version

---

## Performance Benchmarks

### v1.0.0 (Original)

```
100 files:   ~10s
500 files:   ~50s
1000 files:  ~90s
```

### v2.0.0 (Optimized)

```
100 files:   ~5s  (2x faster)
500 files:   ~20s (2.5x faster)
1000 files:  ~35s (2.6x faster)
```

### Memory Usage

```
v1.0.0: ~100MB peak
v2.0.0: ~75MB peak (25% reduction)
```

---

## Credits

### Contributors

- Original script by [Original Author]
- Optimizations and v2.0.0 by [Your Name]

### Libraries Used

- [Bun](https://bun.sh) - JavaScript runtime
- [Chalk](https://github.com/chalk/chalk) - Terminal styling  
- [cli-progress](https://github.com/npkgz/cli-progress) - Progress bars

### Community

Special thanks to:
- Obsidian community for feedback
- Notion users for testing
- Bug reporters and feature requesters

---

## Support

- GitHub Issues: [your-repo]/issues
- Documentation: See README.md
- Quick Reference: See QUICK_REFERENCE.md

---

## License

MIT License - See LICENSE file for details

---

**Last Updated**: October 2, 2024
