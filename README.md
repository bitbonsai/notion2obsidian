<div align="center">
  <img src="logo.svg" alt="notion2obsidian logo" width="120" height="120">

  # Notion to Obsidian Migration Tool

  A high-performance CLI tool to migrate Notion exports to Obsidian-compatible markdown format. Fast, clean, and simple.

  [![GitHub Stars](https://img.shields.io/github/stars/bitbonsai/notion2obsidian?style=flat&logo=github&logoColor=white&color=8250E7&labelColor=262626)](https://github.com/bitbonsai/notion2obsidian)
  [![npm version](https://img.shields.io/npm/v/notion2obsidian?style=flat&color=8250E7&labelColor=262626)](https://www.npmjs.com/package/notion2obsidian)
  [![License](https://img.shields.io/badge/license-MIT-8250E7?style=flat&labelColor=262626)](LICENSE)
  [![Tests](https://img.shields.io/badge/tests-104_passing-00B863?style=flat&labelColor=262626)](notion2obsidian.test.js)

  **[📖 View Documentation & Examples →](https://bitbonsai.github.io/notion2obsidian/)**

</div>

## ✨ Features

- **🚀 Performance Optimized**: Batch processing with concurrent file operations
- **📦 Multiple Zip Support**: Process multiple zip files with glob patterns (*.zip)
- **📂 Custom Output Directory**: Specify where processed files should go (-o/--output)
- **🔍 Dry Run Mode**: Preview changes before applying them (with sampling for large zips)
- **🔗 Smart Link Conversion**: Converts markdown links to Obsidian wiki links
- **🏷️ Auto-tagging**: Generates tags from folder structure
- **📝 Frontmatter Generation**: Adds YAML metadata to all files
- **🔄 Duplicate Handling**: Intelligently disambiguates files with same names
- **⚡ Batch Processing**: Processes files in chunks for optimal performance
- **🎯 Automatic Directory Opening**: Automatically opens the completed migration directory
- **🗑️ Automatic Cleanup**: Removes temporary extraction directories after successful migration
- **📊 Database Integration**: Converts CSV database exports to Obsidian-compatible formats
- **🔍 Dataview Support**: Creates individual notes and query-based indexes from CSV data
- **💬 Callout Conversion**: Transforms Notion callouts to Obsidian format with icon mapping
- **🖼️ Cover Images**: Detects and preserves Notion cover images as banner frontmatter
- **🔮 API Enrichment**: Fetch creation dates, public URLs, and assets from Notion API

## 📋 What It Does

1. **Cleans filenames**: Removes 32-character Notion IDs from files and directories
2. **Adds frontmatter**: Generates YAML metadata including:
   - Title
   - Tags derived from folder structure
   - Aliases (preserves original filenames)
   - Notion IDs for reference
   - Folder paths for duplicate disambiguation
   - Inline metadata (Status, Owner, Dates, Priority, Completion, Summary)
   - Conservative default handling for generic `Key: value` prose
   - Optional top-of-note `Key: value` inference with `--infer-metadata`
3. **Converts links**: Transforms `[text](file.md)` → `[[file|text]]`
4. **Handles anchors**: Preserves section links like `[text](file.md#section)` → `[[file#section|text]]`, including links restored through Notion object IDs
5. **Processes duplicates**: Uses folder context to handle files with identical names and avoids ambiguous auto-linked `@mentions`
6. **Renames files and directories**: Strips Notion IDs from all names
7. **Updates asset paths**: Fixes image and file references after directory renaming
8. **Converts callouts**: Transforms Notion callouts (with icons) to Obsidian format
9. **Processes databases**: Converts CSV exports to markdown tables or individual notes
10. **Preserves cover images**: Adds banner frontmatter for Notion cover images

## 🚀 Installation

> **⚠️ Requires Bun:** This tool uses Bun-specific APIs and must be run with [Bun](https://bun.sh), not Node.js. Install Bun with: `curl -fsSL https://bun.sh/install | bash`

### Global Installation (Recommended)

```bash
# Install globally with bun
bun install -g notion2obsidian

# Now use from anywhere
notion2obsidian ./Export-abc123.zip ~/Obsidian/Vault
```

### One-Time Usage with bunx (No Install)

```bash
# Run directly without installing
bunx notion2obsidian ./Export-abc123.zip ~/Obsidian/Vault
```

### Local Development

```bash
# Clone and install dependencies
git clone https://github.com/bitbonsai/notion2obsidian.git
cd notion2obsidian
bun install

# Option 1: Link globally for development
bun link
notion2obsidian ./Export-abc123.zip  # Now available globally

# Option 2: Run directly with bun
bun run notion2obsidian.js ./Export-abc123.zip
```

## 📖 Usage

### Basic Usage

```bash
# Run on a zip file with output directory (recommended)
notion2obsidian ./Export-abc123.zip ~/Obsidian/Vault

# Run on a zip file (extracts in place)
notion2obsidian ./Export-abc123.zip

# Run on a directory with output
notion2obsidian ./my-notion-export ~/Obsidian/Vault

# Run on current directory
notion2obsidian
```

### Command Line Options

```bash
# Positional Arguments
<input>             # Directory, zip file(s), or glob pattern (*.zip)
[output]            # Output directory (optional, defaults to extract location)

# Options
-o, --output DIR    # Output directory (alternative to positional argument)
-d, --dry-run       # Preview changes without modifying files
                    # (extracts 10% sample or 10MB max for zip files)
-v, --verbose       # Show detailed processing information
    --enrich        # Enrich vault with Notion API metadata (dates, URLs, assets)
    --infer-metadata
                    # Heuristically infer generic Key: value metadata near note tops
    --no-callouts   # Disable Notion callout conversion to Obsidian callouts
    --no-csv        # Disable CSV database processing and index generation
    --dataview      # Create individual markdown notes from CSV rows (default: CSV only)
    --sqlseal       # Use SQL Seal query syntax instead of Dataview (default: Dataview)
    --bases         # Use Obsidian Bases format for CSV databases
-h, --help          # Show help message
```

`--infer-metadata` is off by default. Without it, the tool only promotes the documented inline fields (`Status`, `Owner`, `Dates`, `Priority`, `Completion`, `Summary`) and leaves generic opening prose such as `Note: draft` in the note body.

### Examples

```bash
# Single zip file with output directory
notion2obsidian ./Export-abc123.zip ~/Obsidian/Vault

# Single zip file (extracts in place)
notion2obsidian ./Export-abc123.zip

# Multiple zip files with output
notion2obsidian *.zip ~/Obsidian/Vault

# Using -o flag (backward compatible)
notion2obsidian Export-*.zip -o ~/Obsidian/Vault

# Directory processing
notion2obsidian ./my-notion-export ~/Documents/Obsidian

# Preview changes (dry run)
notion2obsidian *.zip ~/Vault --dry-run

# Create individual notes from CSV rows (optional)
notion2obsidian ./Export-abc123.zip ~/Vault --dataview

# Opt in to broader inline metadata inference
notion2obsidian ./Export-abc123.zip ~/Vault --infer-metadata

# Use SQL Seal for database queries (alternative to Dataview)
notion2obsidian ./Export-abc123.zip ~/Vault --sqlseal

# Disable specific features
notion2obsidian ./Export-abc123.zip ~/Vault --no-callouts --no-csv

# Using bunx (no install required)
bunx notion2obsidian ./Export-abc123.zip ~/Vault
```

### Inline Metadata Behavior

By default, notion2obsidian keeps generic colon-delimited prose in the note body and only extracts the documented inline fields:

- `Status:`
- `Owner:`
- `Dates:`
- `Priority:`
- `Completion:`
- `Summary:`

Use `--infer-metadata` if you want the tool to also promote other top-of-note `Key: value` lines into frontmatter. This inference is intentionally bounded to the opening metadata block so later body prose is not silently removed.

## 📦 Zip File Support

The tool can directly process Notion zip exports:

- **Automatic extraction**: Extracts to `Export-2d6f-extracted/` (uses first 4 chars of hash for short names)
- **Smart sampling**: Dry-run mode extracts only 10% or 10MB for quick preview
- **Single directory detection**: Automatically uses subdirectory if zip contains only one folder
- **Cleanup guidance**: Shows extracted location and removal command after completion

## 📊 CSV Database & Dataview Support

> **📦 Required Plugin**: Install the [Dataview plugin](https://github.com/blacksmithgu/obsidian-dataview) in Obsidian to view and query database records. Without it, you'll only see the raw Dataview query code.

> **💡 TL;DR**: Both modes support Dataview! The **default** creates index files that query the CSV (lightweight, recommended). The **`--dataview` flag** creates individual markdown notes from each CSV row (heavier, optional).

When your Notion export includes CSV database files, the tool automatically organizes them for optimal Dataview integration.

#### Default Mode (Recommended)

By default, the tool creates Dataview-compatible indexes **without** creating individual notes from CSV rows:

- **Clean CSV files**: Removes duplicate `_all.csv` files, keeps single clean copy (e.g., `Tasks.csv`)
- **Organized structure**: Individual database pages moved to `_data/` subfolders
- **Dataview Index files**: Index pages with queries showing ALL records from CSV
- **Clickable CSV links**: Easy access to edit data in spreadsheet apps
- **Lightweight**: Keeps your vault clean by not duplicating CSV data into notes

Example structure:
```
output/
├── Tasks.csv                 # Clean CSV file for Dataview queries
├── Tasks_Index.md            # Index with Dataview query
└── Tasks/
    └── _data/                # Individual page content (if exists)
        ├── add-new-task.md
        └── write-proposal.md
```

Index file format:
```markdown
# Tasks

Database with 6 records.

**CSV File:** [[Tasks.csv|Open in spreadsheet app]]

## All Records

```dataview
TABLE WITHOUT ID Task name, Status, Assignee, Due, Priority
FROM csv("Tasks.csv")
```

## Individual Pages

Individual database pages are stored in [[Tasks/_data|Tasks/_data/]]
```

#### Alternative: Individual Notes Mode (`--dataview`)

For those who prefer individual markdown notes for each CSV row:

```bash
notion2obsidian ./Export-abc123.zip ~/Vault --dataview
```

- Creates individual markdown notes for each CSV row
- Copies CSV files to `_databases/` folder
- Generates notes with database tags and frontmatter
- **Not recommended for large databases** (can create hundreds of files)

#### Alternative: SQL Seal Mode (`--sqlseal`)

For users who prefer SQL syntax over Dataview, use the `--sqlseal` flag to generate SQL Seal-compatible queries:

```bash
notion2obsidian ./Export-abc123.zip ~/Vault --sqlseal
```

**What changes:**
- Index files use SQL Seal syntax instead of Dataview
- Queries use standard SQL (`SELECT`, `FROM`, `WHERE`, `ORDER BY`)
- Includes example queries for filtering, sorting, and aggregation
- Requires [SQL Seal plugin](https://github.com/h-sphere/sql-seal) instead of Dataview

**SQL Seal Index format:**
```markdown
# Tasks

Database with 6 records.

**CSV File:** [[Tasks.csv|Open in spreadsheet app]]

## All Records

```sqlseal
TABLE tasks = file("Tasks.csv")

SELECT Task name, Status, Assignee, Due, Priority
FROM tasks
```

## Example Queries

```sqlseal
-- Filter records
SELECT * FROM tasks
WHERE Status LIKE '%Active%'

-- Sort by column
SELECT * FROM tasks
ORDER BY Due ASC

-- Count records
SELECT COUNT(*) as total FROM tasks
```
\```

**Why use SQL Seal?**
- More familiar for users with SQL experience
- More powerful query capabilities (JOINs, CTEs, aggregations)
- Parameterized queries using note properties

#### Alternative: Bases Mode (`--bases`)

For users who prefer a visual database view, use the `--bases` flag to create [Obsidian Bases](https://github.com/obsidian-bases/obsidian-bases) `.base` view files from your CSV databases:

```bash
notion2obsidian ./Export-abc123.zip ~/Vault --bases
```

**Key behaviors:**
- Creates `.base` files for CSV databases where corresponding row directories are found
- Falls back to `_Index.md` with Dataview query when the row directory cannot be matched
- Automatically disambiguates same-name databases (e.g., `Tasks [abc12345].base`)
- Enriches existing notes with CSV properties from the export
- Generates missing row notes from CSV data when they don't exist
- Requires the [Obsidian Bases plugin](https://github.com/obsidian-bases/obsidian-bases)

**Note:** If the tool can't find the directory containing database row pages, it creates a `_Index.md` fallback instead of a `.base` file to prevent scope pollution in your Bases plugin.

## 🔮 Notion API Enrichment

After migrating your Notion export, you can enrich your vault with additional metadata from the Notion API. This adds information that's not included in standard exports.

### What Gets Added

- **📅 Creation & modification dates**: Real document timestamps (not export times)
- **🔗 Public URLs**: Links to publicly-shared pages (if available)
- **🎨 Icons**: Page icons (emoji or downloaded images)
- **🖼️ Cover images**: Downloaded cover images stored in `_banners/` folder

### Setup Instructions

#### 1. Create a Notion Integration

1. Visit [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Name it (e.g., "Obsidian Enrichment")
4. Select your workspace
5. Copy the "Internal Integration Token"

#### 2. Grant Integration Access

1. Go to https://www.notion.so/profile/integrations/internal/
2. Select your integration
3. Choose pages to share (select both private and shared pages you want to enrich)
4. **Important**: Integration must be internal (not public)

#### 3. Set Up Authentication

Set the `NOTION_TOKEN` environment variable with your integration token.

**Temporary (current session only):**

```bash
# macOS/Linux
export NOTION_TOKEN="ntn_xxx"

# Windows (PowerShell)
$env:NOTION_TOKEN="ntn_xxx"
```

**Permanent (recommended):**

```bash
# For bash - add to ~/.bashrc
echo 'export NOTION_TOKEN="ntn_xxx"' >> ~/.bashrc
source ~/.bashrc

# For zsh - add to ~/.zshrc
echo 'export NOTION_TOKEN="ntn_xxx"' >> ~/.zshrc
source ~/.zshrc

# For fish - add to ~/.config/fish/config.fish
echo 'set -x NOTION_TOKEN "ntn_xxx"' >> ~/.config/fish/config.fish
source ~/.config/fish/config.fish
```

#### 4. Run Enrichment

```bash
# Basic enrichment
notion2obsidian --enrich /path/to/vault

# With dry-run to preview
notion2obsidian --enrich /path/to/vault --dry-run

# Verbose output
notion2obsidian --enrich /path/to/vault -v
```

### How It Works

1. **Scans vault** for pages with `notion-id` frontmatter
2. **Fetches metadata** from Notion API (respects 3 req/s rate limit)
3. **Caches responses** in `.notion-cache.json` for fast re-runs
4. **Downloads assets** (icons and covers) next to markdown files
5. **Updates frontmatter** while preserving existing fields

### Example Output

**Before enrichment:**
```yaml
---
title: "Design Manifesto"
notion-id: "c27e422ef0b04e1d9e57fb3b10b498b3"
tags: [design, principles]
published: false
---
```

**After enrichment:**
```yaml
---
title: "Design Manifesto"
notion-id: "c27e422ef0b04e1d9e57fb3b10b498b3"
public-url: "https://username.notion.site/Design-Manifesto-c27e422e"
created: "2023-04-15T10:30:00.000Z"
modified: "2024-10-02T14:22:00.000Z"
icon: "🎨"
banner: "![[_banners/Design Manifesto-cover.jpg]]"
tags:
  - "design"
  - "principles"
published: false
---
```

**Note**: Emoji icons display in file explorer and note titles via the Iconize plugin. Image icons from Notion are saved to `_banners/` folder with the `icon-file` field for reference, but Iconize works best with emoji icons.

### Features

- **🔄 Caching**: Responses cached locally to speed up re-runs
- **⚡ Rate limiting**: Automatic 3 req/s limit (Notion API requirement)
- **💾 Idempotent**: Safe to run multiple times
- **📊 Progress tracking**: Real-time progress with ETA
- **🛡️ Error handling**: Continues on individual page errors
- **🖼️ Asset storage**: Covers saved to `_banners/` folder (e.g., `_banners/PageName-cover.jpg`)
- **😀 Emoji icons**: Stored in `icon` field for Iconize plugin compatibility

### Important Notes

- Private pages won't have `public-url` field (normal behavior)
- Notion SVG icons are not downloaded (they're just reference URLs)
- Cache file (`.notion-cache.json`) persists between runs
- Assets are skipped if they already exist
- Emoji icons work best with Iconize plugin (enable "Use frontmatter" in plugin settings)

## 🖼️ Cover Images & Icons (Obsidian Plugins)

When using `--enrich` mode, the tool fetches cover images and emoji icons from the Notion API. To display them in Obsidian, you'll need these plugins:

- **[Obsidian Banners](https://github.com/noatpad/obsidian-banners)** - Displays cover images at the top of notes
- **[Obsidian Iconize](https://github.com/FlorianWoelki/obsidian-iconize)** - Displays emoji icons in file explorer and note titles

### How It Works

**Emoji icons** (displayed by Iconize):
```yaml
---
title: "My Page"
icon: 🏠
banner: "![[_banners/My Page-cover.jpg]]"
published: false
---
```

**Image icons** are downloaded but stored separately (Iconize prefers emoji):
```yaml
---
title: "My Page"
icon: 🏠
icon-file: "_banners/My Page-icon.png"  # Downloaded for reference
banner: "![[_banners/My Page-cover.jpg]]"
published: false
---
```

### Plugin Setup

**Iconize:**
1. Install Iconize plugin from Community Plugins
2. Enable it in Settings → Community Plugins
3. In Iconize settings, enable "Use frontmatter" option
4. Icons will automatically appear in file explorer and note titles

**Banners:**
1. Install Banners plugin from Community Plugins
2. Enable the CSS snippet created by enrichment (see below)

### CSS Snippet for Banner Display

The enrichment process automatically creates a CSS snippet (`.obsidian/snippets/notion2obsidian-banners.css`) that:
- Hides the properties header behind banners for a cleaner look
- Hides the inline title in the document body
- Hides metadata in Reading View while keeping it visible in Edit mode

**Enable the snippet:**
1. Open Obsidian Settings
2. Go to **Appearance** → **CSS snippets**
3. Enable `notion2obsidian-banners`

The snippet is only created once and won't overwrite existing customizations.

## 💬 Notion Callout Conversion

The tool automatically converts Notion callouts with icons to Obsidian callout format:

**Before (Notion export):**
```markdown
<aside>
<img src="https://www.notion.so/icons/token_blue.svg" width="40px" />
Important information here
</aside>
```

**After (Obsidian format):**
```markdown
> [!note] 📘 Important information here
```

Callout conversion is enabled by default. To disable, use `--no-callouts` flag.

## 📊 Sample Output

```
💎 Notion 2 Obsidian v2.6.0

🔍 Resolving input paths...
Found 1 zip file(s) to process

📦 Extracting 1 zip files to unified directory...
Merge directory: /Users/user/.cache/notion2obsidian-xyz123
Note: Will automatically extract any nested zip files found

[1/1] Export-abc123.zip
✓ Extracted 1 zip files successfully!
  Total files: 2089

Found content in subdirectory: Export-abc123...
📋 Moving content to output directory...
✓ Content moved to output directory

💎 Notion 2 Obsidian v2.6.0
Directory: /Users/user/Obsidian/Vault

Phase 1: Analyzing files and building migration map...

🔍 Directory structure analysis:
  Target directory contains 190 items:
    📁 Projects abc123...
    📄 Travel Notes xyz789....md
    📄 Meeting Minutes.md
    📁 Work Documents def456...
    📁 Personal
    ... and 185 more items

Found 2404 markdown files
Found 516 directories

⚠ Warning: 865 duplicate filenames found
These will be disambiguated using folder paths in frontmatter.

═══ MIGRATION PREVIEW ═══

Files to rename: 1178

Sample:
  − Travel Notes xyz789abc123def456...890.md
  + Travel Notes.md

Directories to rename: 233

Sample:
  − Project Archive abc123def456...789
  + Project Archive

Duplicate handling:
  "Travel Notes.md" will be disambiguated by folder path in frontmatter
  "Meeting Minutes.md" will be disambiguated by folder path in frontmatter
  "Documentation.md" will be disambiguated by folder path in frontmatter

Sample frontmatter:

For file: Travel Notes.md

---
title: "Travel Notes"
aliases:
  - "Travel Notes xyz789abc123def456...890"
notion-id: "xyz789abc123def456789012345678901"
published: false
---

═══ SUMMARY ═══
  📄 Add frontmatter to 2404 files
  🔗 Convert ~8654 markdown links to wiki links
  📋 Handle 865 duplicate filenames with folder context
  ✏️  Rename 1178 files
  📁 Rename 233 directories

Phase 2: Executing migration...

✔ Step 1/5: Processed 2404 files, converted 370 links
✔ Step 2/5: Moved 179 files into their attachment folders
✔ Step 3/5: Renamed 233 directories
✔ Step 4/5: Renamed 1178 individual files
✔ Step 5/5: Normalized 0 images and 0 references
Step 6: Processing CSV databases...
  ✓ Processed 159 CSV files, created 108 database indexes

✅ Migration complete! Processed 3.55 GB in 3.6 seconds

Summary:
   📄 Added frontmatter to 2404 files
   🔗 Converted 370 markdown links to wiki links
   💬 Converted 23 Notion callouts to Obsidian format
   📊 Created 108 database index pages from 159 CSV files
   ✏️  Renamed 1178 files
   📁 Renamed 233 directories
   📦 Moved 179 files into attachment folders

📝 328 naming conflicts resolved:
   • Untitled abc123...: Target exists, renamed to Untitled-1
   • Untitled def456...: Target exists, renamed to Untitled-2
   • Untitled xyz789...: Target exists, renamed to Untitled-3
   ... and 325 more

Notes:
   • Duplicate filenames preserved with folder context
   • Original filenames stored as aliases
   • URL-encoded links converted to wiki links

🎉 Migration Complete!
Time: 3.6s  •  Size: 3.55 GB
Directory: /Users/user/Obsidian/Vault

Your Notion export is now ready for Obsidian!
✓ Opening directory...

💡 Scroll up to review the full migration summary and any warnings.

🗑️  Cleaned up temporary extraction directory
```

### Enrichment Output Example

```
💎 Notion 2 Obsidian v2.6.0

💎 Notion API Enrichment
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 Scanning vault for pages with Notion IDs...
✓ Found 2353 pages with Notion IDs

🔌 Testing Notion API connection... ✓

✔ Enriched 2341 pages in 114s

⚠ 16 warnings:
  • Failed to download icon for Page1.md: Download failed: 403 Forbidden
  • Failed to download icon for Page2.md: Download failed: 403 Forbidden
  • Failed to download icon for Page3.md: Download failed: 403 Forbidden
  ... and 13 more

Enrichment Complete!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Results:
  ✓ 2341 pages enriched (2341 from cache, 0 fetched)
  ✓ 182 assets downloaded (178 covers, 4 icons)
  ✗ 12 errors encountered

Metadata Added:
  • Creation dates: 2341 pages
  • Modification dates: 2341 pages
  • Public URLs: 899 pages (1442 private)
  • Page icons: 156 pages (152 emoji, 4 images)
  • Cover images: 178 pages

Cache: .notion-cache.json updated
Banners: Stored in _banners/ folder (install Obsidian Banners plugin to display)
Icons: Emoji icons stored in "icon" field (install Obsidian Iconize plugin to display)

CSS snippet already exists: .obsidian/snippets/notion2obsidian-banners.css

Time elapsed: 114s

ENRICHMENT ERRORS

Notion pages not found: 12 pages
  (Pages may be deleted, in trash, or integration lacks access)
  • Document1.md
  • Document2.md
  • Notes.md
  ... and 9 more
```

## 🏗️ Architecture & Optimizations

### Performance Improvements

1. **Single File Read**: Combines metadata extraction and content processing into one read operation
2. **Batch Processing**: Processes files in batches of 50 using `Promise.all()` for concurrent I/O
3. **Optimized Regex**: Pre-compiled patterns for better performance
4. **Efficient Data Structures**: Uses `Map` for O(1) lookups in file resolution
5. **Smart Sampling**: Estimates link counts from a sample to avoid processing all files twice
6. **Fast Extraction**: Uses `fflate` for high-performance zip extraction

### Key Features

| Feature | Implementation |
|---------|---------------|
| File reads | 1x per file (optimized) |
| Processing | Batched (50 at a time) |
| Link count | Calculated dynamically |
| Zip extraction | Direct support with fflate |
| Output | Clean, minimal |
| Safety | Dry-run mode |

## 📁 File Structure

```
.
├── notion2obsidian.js            # Main entry point and migration logic
├── notion2obsidian.test.js       # Migration test suite
├── package.json                  # Dependencies and metadata
├── README.md                     # Documentation
├── CHANGELOG.md                  # Version history
├── LICENSE                       # MIT license
└── src/
    └── lib/                      # Modular library files
        ├── assets.js             # Directory operations and user interaction
        ├── callouts.js           # Notion callout conversion
        ├── cli.js                # Command-line argument parsing
        ├── csv.js                # Database processing and Dataview integration
        ├── enrich.js             # Notion API enrichment (experimental)
        ├── enrich.test.js        # Enrichment test suite
        ├── frontmatter.js        # YAML frontmatter generation
        ├── links.js              # Markdown to wiki-link conversion
        ├── scanner.js            # File and directory traversal
        ├── stats.js              # Migration statistics tracking
        ├── utils.js              # Shared utilities and regex patterns
        └── zip.js                # Archive extraction with fflate
```

## 🐛 Troubleshooting

### Memory Issues (Large Exports)

For very large exports (10,000+ files), the tool automatically processes files in batches of 50 for optimal performance. If you encounter memory issues, you can adjust the `BATCH_SIZE` constant in the source code.

### Link Conversion Issues

Check the error summary at the end of migration. Common issues:
- Relative path links (`../other/file.md`) - fully supported!
- External links - correctly skipped
- Image links - correctly preserved
- Asset paths - automatically updated when directories are renamed

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
Check out [[My Other Note|this document]]
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

## 🚦 Workflow Recommendation

```bash
# 1. Always start with a dry run (fast preview with sampling)
notion2obsidian ./Export-abc123.zip --dry-run

# 2. Review the preview carefully

# 3. Run the actual migration
notion2obsidian ./Export-abc123.zip ~/Obsidian/Vault

# 4. (Optional) Enrich with Notion API metadata
#    First, set the NOTION_TOKEN environment variable
export NOTION_TOKEN="ntn_xxx"
notion2obsidian --enrich ~/Obsidian/Vault

# 5. Open the vault in Obsidian

# 6. Test your vault

# 7. If satisfied, optionally remove extracted files
rm -rf Export-2d6f-extracted
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

### Zip Extraction

- Uses `fflate` for pure JavaScript extraction (no system dependencies)
- Filters out macOS metadata (`__MACOSX`, hidden files)
- Preserves directory structure
- Shortens extracted directory names for convenience

## 🔒 Safety Features

1. **Dry Run Mode**: Test migration without changes (with smart sampling for zips)
2. **Error Tracking**: Tracks all errors with file paths
3. **Duplicate Detection**: Warns about potential conflicts
4. **Confirmation Prompt**: Requires user confirmation before proceeding
5. **Naming Conflict Resolution**: Automatically handles file/directory name collisions
6. **Symlink Protection**: Detects and skips symbolic links
7. **Write Permission Check**: Validates access before starting

## 🧪 Testing

```bash
# Run test suite
bun test

# Watch mode
bun test --watch
```

## 🤝 Contributing

Suggestions for improvements:
1. Support for custom frontmatter templates
2. Interactive mode for resolving conflicts
3. Support for other export formats
4. Plugin system for custom transformations

## 📄 License

MIT

## 🙏 Credits

Built with:
- [Bun](https://bun.sh) - Fast JavaScript runtime
- [chalk](https://github.com/chalk/chalk) - Terminal styling
- [fflate](https://github.com/101arrowz/fflate) - High-performance zip extraction
- [gray-matter](https://github.com/jonschlinkert/gray-matter) - YAML frontmatter parsing
- [ora](https://github.com/sindresorhus/ora) - Elegant terminal spinners
- [remark](https://github.com/remarkjs/remark) - Markdown processor
- [remark-frontmatter](https://github.com/remarkjs/remark-frontmatter) - Frontmatter support
- [unist-util-visit](https://github.com/syntax-tree/unist-util-visit) - AST traversal

## 🔗 Related Tools

- [Obsidian](https://obsidian.md) - Knowledge base app
- [Notion](https://notion.so) - Note-taking and collaboration
- [Marksman](https://github.com/artempyanykh/marksman) - Markdown LSP server

---

**Made with ❤️ by [bitbonsai](https://github.com/bitbonsai) for the Obsidian community**
