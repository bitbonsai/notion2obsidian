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
3. **Converts links**: Transforms `[text](file.md)` → `[[file|text]]`
4. **Handles anchors**: Preserves section links like `[text](file.md#section)` → `[[file#section|text]]`
5. **Processes duplicates**: Uses folder context to handle files with identical names
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
    --no-callouts   # Disable Notion callout conversion to Obsidian callouts
    --no-csv        # Disable CSV database processing and index generation
    --dataview      # Generate Dataview-compatible CSV structure with individual notes
-h, --help          # Show help message
```

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

# Enable Dataview-compatible CSV processing
notion2obsidian ./Export-abc123.zip ~/Vault --dataview

# Disable specific features
notion2obsidian ./Export-abc123.zip ~/Vault --no-callouts --no-csv

# Using bunx (no install required)
bunx notion2obsidian ./Export-abc123.zip ~/Vault
```

## 📦 Zip File Support

The tool can directly process Notion zip exports:

- **Automatic extraction**: Extracts to `Export-2d6f-extracted/` (uses first 4 chars of hash for short names)
- **Smart sampling**: Dry-run mode extracts only 10% or 10MB for quick preview
- **Single directory detection**: Automatically uses subdirectory if zip contains only one folder
- **Cleanup guidance**: Shows extracted location and removal command after completion

## 📊 Database & Dataview Support

> **📦 Required Plugin**: Install the [Dataview plugin](https://github.com/blacksmithgu/obsidian-dataview) in Obsidian to view and query database records. Without it, you'll only see the raw Dataview query code.

> **🖼️ Cover Images & Icons**: If using `--enrich` to fetch Notion covers and icons:
> - Install [Obsidian Banners plugin](https://github.com/noatpad/obsidian-banners) to display cover images
> - Install [Obsidian Iconize plugin](https://github.com/FlorianWoelki/obsidian-iconize) to display emoji icons in file explorer and notes
> - Covers are stored in the `_banners/` folder and referenced in frontmatter

### CSV Database Processing (Default Mode)

When your Notion export includes CSV database files, the tool organizes them for optimal Dataview integration:

#### Default Behavior
- **Clean CSV files**: Removes duplicate `_all.csv` files, keeps single clean copy (e.g., `Tasks.csv`)
- **Organized structure**: Individual database pages moved to `_data/` subfolders
- **Dataview Index files**: Index pages with queries showing ALL records
- **Clickable CSV links**: Easy access to edit data in spreadsheet apps

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

#### Alternative: Dataview Mode (`--dataview`)
- Creates individual markdown notes for each CSV row (not recommended for large databases)
- Copies CSV files to `_databases/` folder
- Generates individual notes with database tags and frontmatter

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

## 💬 Callout & Visual Element Support

### Notion Callouts
Converts Notion callouts with icons to Obsidian format:

```markdown
<!-- Notion format -->
<aside>
<img src="https://www.notion.so/icons/token_blue.svg" width="40px" />
Important information here
</aside>

<!-- Becomes Obsidian format -->
> [!note] 📘 Important information here
```

### Cover Images & Icons (with --enrich)

When using `--enrich` mode with the Notion API, cover images and emoji icons are fetched from Notion:

**Required Plugins:**
- [Obsidian Banners](https://github.com/noatpad/obsidian-banners) - Displays cover images
- [Obsidian Iconize](https://github.com/FlorianWoelki/obsidian-iconize) - Displays emoji icons in file explorer and note titles

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

**Setup Iconize:**
1. Install Iconize plugin from Community Plugins
2. Enable it in Settings → Community Plugins
3. In Iconize settings, enable "Use frontmatter" option
4. Icons will automatically appear in file explorer and note titles

### CSS Snippet for Banner Display

Enrichment automatically creates a CSS snippet (`.obsidian/snippets/notion2obsidian-banners.css`) that:
- Hides the properties header behind banners for a cleaner look
- Hides the inline title in the document body
- Hides metadata in Reading View while keeping it visible in Edit mode

**Enable the snippet:**
1. Open Obsidian Settings
2. Go to **Appearance** → **CSS snippets**
3. Enable `notion2obsidian-banners`

The snippet is only created once and won't overwrite existing customizations.

## 📊 Sample Output

```
📦 Extracting zip file...
Extracting to: Export-2d6f-extracted
Sample mode: extracting up to 10% or 10MB for preview

✓ Extracted 12 of 2088 files (1% sample)

Using subdirectory: Export-abc123...

📦 Notion to Obsidian
Directory: Export-2d6f-extracted/Export-abc123...
Mode: DRY RUN (no changes will be made)

Phase 1: Analyzing files and building migration map...

Found 542 markdown files
Found 23 directories

⚠ Warning: 5 duplicate filenames found
These will be disambiguated using folder paths in frontmatter.

═══ MIGRATION PREVIEW ═══

Files to rename: 542

Sample:
  − My Note abc123def456...xyz.md
  + My Note.md

Directories to rename: 23

Sample:
  − Project Folder abc123...
  + Project Folder

Sample frontmatter:

For file: My Note.md

---
title: "My Note"
tags: [projects, work]
aliases:
  - "My Note abc123def456...xyz"
notion-id: "abc123def456789012345678901234567"
folder: "Work/Projects"
published: false
---

═══ SUMMARY ═══
  📄 Add frontmatter to 542 files
  🔗 Convert ~1247 markdown links to wiki links
  📋 Handle 5 duplicate filenames with folder context
  ✏️  Rename 542 files
  📁 Rename 23 directories

Press ENTER to proceed with the migration, or Ctrl+C to cancel...

Phase 2: Executing migration...

Step 1: Adding frontmatter and converting links...
  ✓ Processed 542 files, converted 1247 links

Step 2: Renaming files...
  ✓ Renamed 542 files

Step 3: Renaming directories...
  ✓ Renamed 23 directories

✅ Migration complete!

Summary:
   📄 Added frontmatter to 542 files
   🔗 Converted 1247 markdown links to wiki links
   ✏️  Renamed 542 files
   📁 Renamed 23 directories

Notes:
   • Duplicate filenames preserved with folder context
   • Original filenames stored as aliases
   • URL-encoded links converted to wiki links

🎉 Your Notion export is now ready for Obsidian!
Open directory: my-export

📁 Extracted Directory:
   Export-2d6f-extracted

   You can now open this directory in Obsidian.
   To remove the extracted files, run: rm -rf "Export-2d6f-extracted"
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
├── notion2obsidian.js            # Main migration script (executable)
├── notion2obsidian.test.js       # Migration test suite
├── enrich.js                     # Notion API enrichment module
├── enrich.test.js                # Enrichment test suite
├── package.json                  # Dependencies and scripts
├── README.md                     # This file
└── docs/                         # Additional documentation
    ├── ARCHITECTURE.md
    ├── EXAMPLES.md
    ├── GETTING_STARTED.md
    └── QUICK_REFERENCE.md
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
