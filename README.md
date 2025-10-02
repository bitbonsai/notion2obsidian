# Notion to Obsidian Migration Tool (Optimized)

A high-performance CLI tool to migrate Notion exports to Obsidian-compatible markdown format with beautiful progress bars and comprehensive error handling.

## ✨ Features

- **🚀 Performance Optimized**: Batch processing with concurrent file operations
- **🎨 Beautiful UI**: Chalk-powered colors and cli-progress bars
- **🔍 Dry Run Mode**: Preview changes before applying them
- **🛡️ Safe**: Automatic backup creation (optional)
- **📊 Progress Tracking**: Real-time progress bars for all operations
- **🔗 Smart Link Conversion**: Converts markdown links to Obsidian wiki links
- **🏷️ Auto-tagging**: Generates tags from folder structure
- **📝 Frontmatter Generation**: Adds rich YAML metadata to all files
- **🔄 Duplicate Handling**: Intelligently disambiguates files with same names
- **⚡ Batch Processing**: Processes files in chunks for optimal performance

## 📋 What It Does

1. **Cleans filenames**: Removes 32-character Notion IDs from files and directories
2. **Adds frontmatter**: Generates YAML metadata including:
   - Title, creation/modification dates
   - Tags derived from folder structure
   - Aliases (preserves original filenames)
   - Notion IDs for reference
   - Folder paths for duplicate disambiguation
   - Inline metadata (Status, Owner, Dates, Priority, Completion, Summary)
3. **Converts links**: Transforms `[text](file.md)` → `[[file]]` or `[[file|alias]]`
4. **Handles anchors**: Preserves section links like `[text](file.md#section)` → `[[file#section|text]]`
5. **Processes duplicates**: Uses folder context to handle files with identical names
6. **Renames files and directories**: Strips Notion IDs from all names

## 🚀 Installation

```bash
# Install dependencies
bun install

# Make script executable
chmod +x migrate-notion-optimized.js
```

## 📖 Usage

### Basic Usage

```bash
# Run on current directory
./migrate-notion-optimized.js

# Run on specific directory
./migrate-notion-optimized.js ./my-notion-export

# Use bun directly
bun run migrate-notion-optimized.js ./my-notion-export
```

### Command Line Options

```bash
-d, --dry-run       # Preview changes without modifying files
--skip-backup       # Skip creating backup files (faster but risky)
-v, --verbose       # Show detailed processing information
-h, --help          # Show help message
```

### Examples

```bash
# Preview changes without modifying anything
./migrate-notion-optimized.js ./my-export --dry-run

# Run migration with all safety features
./migrate-notion-optimized.js ./my-export

# Fast migration without backups (use with caution!)
./migrate-notion-optimized.js ./my-export --skip-backup

# Verbose mode for debugging
./migrate-notion-optimized.js ./my-export --verbose

# Using npm scripts
bun run dry-run ./my-export
bun run migrate ./my-export
```

## 📊 Sample Output

```
🔍 Notion Export Migration Tool (Optimized)
Directory: ./my-notion-export

Phase 1: Analyzing files and building migration map...

Scanning |████████████████████| 100% | 100/100 files
Found 542 markdown files
Found 23 directories

⚠ Warning: 5 duplicate filenames found
These will be disambiguated using folder paths in frontmatter.

Analyzing |████████████████████| 100% | 542/542 files

═══ MIGRATION PREVIEW ═══

Files to rename: 542

Sample files (first 3):
  − My Note abc123def456...xyz.md
  + My Note.md

  − Another Document 789012345...678.md
  + Another Document.md

Sample frontmatter:

For file: My Note.md

---
title: "My Note"
created: 2024-01-15
modified: 2024-10-01
tags: [projects, work]
aliases:
  - "My Note abc123def456...xyz"
notion-id: "abc123def456789012345678901234567"
published: false
---

═══ SUMMARY ═══
  • Add frontmatter to 542 files
  • Convert ~1247 markdown links to wiki links
  • Handle 5 duplicate filenames with folder context
  • Rename 542 files
  • Rename 23 directories

Press ENTER to proceed with the migration, or Ctrl+C to cancel...

Phase 2: Executing migration...

Step 1: Adding frontmatter and converting links...
Processing |████████████████████| 100% | 542/542 files
  ✓ Processed 542 files, converted 1247 links

Step 2: Renaming files...
Renaming |████████████████████| 100% | 542/542 files
  ✓ Renamed 542 files

Step 3: Renaming directories...
Renaming |████████████████████| 100% | 23/23 directories
  ✓ Renamed 23 directories

✅ Migration complete!

Summary:
   • Added frontmatter to 542 files
   • Converted 1247 markdown links to wiki links
   • Renamed 542 files
   • Renamed 23 directories

Notes:
   • Duplicate filenames preserved with folder context
   • Original filenames stored as aliases
   • URL-encoded links converted to wiki links
   • Backup files created (.backup extension)

🎉 Your Notion export is now ready for Obsidian!
Open Obsidian and select: ./my-notion-export
```

## 🏗️ Architecture & Optimizations

### Performance Improvements

1. **Single File Read**: Combines metadata extraction and content processing into one read operation
2. **Batch Processing**: Processes files in batches of 50 using `Promise.all()` for concurrent I/O
3. **Optimized Regex**: Pre-compiled patterns for better performance
4. **Efficient Data Structures**: Uses `Map` for O(1) lookups in file resolution
5. **Smart Sampling**: Estimates link counts from a sample to avoid processing all files twice

### Key Optimizations from Original

| Aspect | Original | Optimized |
|--------|----------|-----------|
| File reads | 2x per file | 1x per file |
| Processing | Sequential | Batched (50 at a time) |
| Link count | Hardcoded | Calculated dynamically |
| Progress feedback | Console logs | Progress bars |
| Error handling | Basic | Comprehensive |
| Safety features | None | Backups + dry-run |

## 📁 File Structure

```
.
├── migrate-notion-optimized.js   # Main migration script
├── package.json                  # Dependencies and scripts
└── README.md                     # This file
```

## 🔧 Configuration

### Batch Size

Adjust the `BATCH_SIZE` constant in the script (default: 50):

```javascript
const BATCH_SIZE = 50; // Process 50 files concurrently
```

### Patterns

Customize regex patterns at the top of the script:

```javascript
const PATTERNS = {
  hexId: /^[0-9a-fA-F]{32}$/,
  mdLink: /\[([^\]]+)\]\(([^)]+\.md)\)/g,
  frontmatter: /^---\n/,
  notionIdExtract: /\s([0-9a-fA-F]{32})(?:\.[^.]+)?$/
};
```

## 🐛 Troubleshooting

### Permission Errors

```bash
# Make script executable
chmod +x migrate-notion-optimized.js
```

### Memory Issues (Large Exports)

If processing 10,000+ files, reduce batch size:

```javascript
const BATCH_SIZE = 25; // Reduce from 50 to 25
```

### Backup Files Taking Too Much Space

```bash
# Skip backups (use with caution!)
./migrate-notion-optimized.js ./my-export --skip-backup

# Or manually delete backups after successful migration
find ./my-export -name "*.backup" -delete
```

### Link Conversion Issues

Check the error summary at the end of migration. Common issues:
- Relative path links (`../other/file.md`) - now supported!
- External links - correctly skipped
- Image links - correctly preserved

## 📝 Before & After Examples

### Filename Transformation

**Before:**
```
My Project abc123def456789012345678901234567.md
Meeting Notes 111222333444555666777888999000.md
```

**After:**
```
My Project.md
Meeting Notes.md
```

### Link Transformation

**Before:**
```markdown
Check out [this document](My%20Other%20Note%20abc123def.md)
See [Section 2](Another%20Doc%20xyz789.md#section-2)
```

**After:**
```markdown
Check out [[My Other Note]]
See [[Another Doc#section-2|Section 2]]
```

### Frontmatter Addition

**Before:**
```markdown
# My Note

This is the content...
```

**After:**
```markdown
---
title: "My Note"
created: 2024-01-15
modified: 2024-10-01
tags: [projects, documentation]
aliases:
  - "My Note abc123def456789012345678901234567"
notion-id: "abc123def456789012345678901234567"
folder: "Work/Projects"
published: false
---

# My Note

This is the content...
```

## 🔒 Safety Features

1. **Dry Run Mode**: Test migration without changes
2. **Automatic Backups**: Creates `.backup` files before modification
3. **Error Logging**: Tracks all errors with file paths
4. **Duplicate Detection**: Warns about potential conflicts
5. **Confirmation Prompt**: Requires user confirmation before proceeding

## 🚦 Workflow Recommendation

```bash
# 1. Always start with a dry run
./migrate-notion-optimized.js ./my-export --dry-run

# 2. Review the preview carefully

# 3. Run the actual migration
./migrate-notion-optimized.js ./my-export

# 4. Test in Obsidian

# 5. If satisfied, clean up backups
find ./my-export -name "*.backup" -delete
```

## 📚 Technical Details

### Notion ID Detection

Notion appends 32-character hexadecimal IDs to exported files:
- Pattern: `Filename abc123def456789012345678901234567.md`
- Extracted and stored in frontmatter as `notion-id`
- Used for reference and debugging

### Duplicate Handling

When multiple files have the same name after cleaning:
- Folder paths stored in `folder` frontmatter field
- Original filenames preserved as aliases
- No files are lost or overwritten

### Tag Generation

Tags automatically generated from folder structure:
- `Work/Projects/Active` → `[work, projects, active]`
- Special characters normalized to hyphens
- Duplicate tags removed

## 🤝 Contributing

Suggestions for improvements:
1. Add undo/rollback functionality
2. Support for custom frontmatter templates
3. Parallel processing with worker threads
4. Interactive mode for resolving conflicts
5. Support for other export formats

## 📄 License

MIT

## 🙏 Credits

Built with:
- [Bun](https://bun.sh) - Fast JavaScript runtime
- [Chalk](https://github.com/chalk/chalk) - Terminal styling
- [cli-progress](https://github.com/npkgz/cli-progress) - Progress bars

## 🔗 Related Tools

- [Obsidian](https://obsidian.md) - Knowledge base app
- [Notion](https://notion.so) - Note-taking and collaboration
- [Marksman](https://github.com/artempyanykh/marksman) - Markdown LSP server

---

**Made with ❤️ for the Obsidian community**
