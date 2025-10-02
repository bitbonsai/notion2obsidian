---
title: "QUICK_REFERENCE"
created: 2025-10-02
modified: 2025-10-02
tags: [docs]
folder: "docs"
published: false
---

# Quick Reference Guide

## 🚀 Quick Start

```bash
# Install dependencies
bun install

# Make executable
chmod +x migrate-notion-optimized.js

# Preview changes (RECOMMENDED FIRST STEP)
./migrate-notion-optimized.js ./my-export --dry-run

# Run migration
./migrate-notion-optimized.js ./my-export
```

## 📝 Common Commands

```bash
# Dry run (preview only)
./migrate-notion-optimized.js ./my-export --dry-run

# Normal migration with backups
./migrate-notion-optimized.js ./my-export

# Fast migration without backups
./migrate-notion-optimized.js ./my-export --skip-backup

# Show help
./migrate-notion-optimized.js --help

# Using npm scripts
bun run migrate ./my-export
bun run dry-run ./my-export
```

## 🎯 Flags at a Glance

| Flag | Short | Description | Use When |
|------|-------|-------------|----------|
| `--dry-run` | `-d` | Preview without changes | Always test first |
| `--skip-backup` | N/A | No backup files | You're confident + need speed |
| `--verbose` | `-v` | Detailed output | Debugging issues |
| `--help` | `-h` | Show help | Learning the tool |

## ⚡ Performance Tips

### For Large Exports (1000+ files)

```javascript
// In migrate-notion-optimized.js, adjust:
const BATCH_SIZE = 50;  // Default (good for most)
const BATCH_SIZE = 100; // Faster, more memory
const BATCH_SIZE = 25;  // Slower, less memory
```

### Clean Up After Success

```bash
# Remove all backup files
find ./my-export -name "*.backup" -delete

# Count backup files first
find ./my-export -name "*.backup" | wc -l
```

## 🐛 Troubleshooting Quick Fixes

### "Permission denied"
```bash
chmod +x migrate-notion-optimized.js
```

### "Cannot find module 'chalk'"
```bash
bun install
```

### "Directory does not exist"
```bash
# Check path is correct
ls -la ./my-export
```

### Too many errors during migration
```bash
# Run with verbose for details
./migrate-notion-optimized.js ./my-export --verbose
```

### Out of memory (very large exports)
```javascript
// Reduce batch size in script
const BATCH_SIZE = 25;
```

## 📊 Understanding Output

### Phase 1: Analysis
```
Scanning |████████████████████| 100% | 100/100 files
```
- Counting files and directories

```
Analyzing |████████████████████| 100% | 542/542 files
```
- Extracting metadata from each file

### Phase 2: Migration
```
Processing |████████████████████| 100% | 542/542 files
```
- Adding frontmatter + converting links

```
Renaming |████████████████████| 100% | 542/542 files
```
- Removing Notion IDs from filenames

```
Renaming |████████████████████| 100% | 23/23 directories
```
- Removing Notion IDs from folders

## 🎨 What the Colors Mean

- **🔵 Blue**: Numbers, file paths, info
- **🟢 Green**: Success, completed operations
- **🟡 Yellow**: Warnings, prompts for action
- **🔴 Red**: Errors, failed operations
- **⚪ Gray**: Additional details, notes

## 📋 Pre-Migration Checklist

- [ ] Backup original Notion export
- [ ] Install dependencies (`bun install`)
- [ ] Run dry-run first
- [ ] Review preview output
- [ ] Check disk space (exports can grow with frontmatter)
- [ ] Close Obsidian if vault is open

## ✅ Post-Migration Checklist

- [ ] Open vault in Obsidian
- [ ] Test wiki links work
- [ ] Check a few files have proper frontmatter
- [ ] Search for any broken links
- [ ] Clean up backup files if satisfied
- [ ] Delete original Notion export if no longer needed

## 🔧 Customization Quick Reference

### Change Frontmatter Template

Edit `generateFrontmatter()` function:

```javascript
function generateFrontmatter(metadata, relativePath) {
  const lines = ['---'];
  
  // Add your custom fields here
  if (metadata.title) lines.push(`title: "${metadata.title}"`);
  if (metadata.myCustomField) lines.push(`custom: "${metadata.myCustomField}"`);
  
  lines.push('---');
  return lines.join('\n');
}
```

### Change Tag Format

Edit `getTagsFromPath()` function:

```javascript
function getTagsFromPath(filePath, baseDir) {
  // Customize tag generation logic
  const parts = dir.split('/');
  const tags = parts.map(part => 
    cleanDirName(part)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')  // Use underscores instead of hyphens
  );
  return tags;
}
```

### Change Batch Size

```javascript
const BATCH_SIZE = 50;  // Adjust this constant at top of file
```

## 💡 Pro Tips

1. **Always dry-run first**: `--dry-run` is your friend
2. **Keep backups initially**: Don't use `--skip-backup` until you're confident
3. **Test on small export**: Try on 10-20 files first
4. **Monitor progress**: Progress bars show if something is stuck
5. **Check errors**: Review error summary at end
6. **Backup before cleanup**: Don't delete .backup files immediately

## 🆘 Emergency Recovery

If something goes wrong:

```bash
# Restore from backups
find ./my-export -name "*.backup" -exec sh -c 'mv "$1" "${1%.backup}"' _ {} \;

# Or restore single file
mv "My File.md.backup" "My File.md"
```

## 📞 When to Ask for Help

- Migration crashes repeatedly
- All links are broken after migration
- Frontmatter format is corrupted
- Files are missing after migration
- Performance is extremely slow (>1 min per 100 files)

## 🔗 Useful Commands

```bash
# Count markdown files
find ./my-export -name "*.md" | wc -l

# Count Notion IDs in filenames
find ./my-export -name "*[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*.md" | wc -l

# Find duplicate filenames (after cleaning)
find ./my-export -name "*.md" -exec basename {} \; | sort | uniq -d

# Check frontmatter format
head -n 20 ./my-export/some-file.md

# Find files without frontmatter
grep -L "^---" ./my-export/**/*.md
```

## 📈 Benchmarks

Approximate processing times:

| Files | Time (with backups) | Time (no backups) |
|-------|---------------------|-------------------|
| 100   | ~5s                 | ~3s               |
| 500   | ~20s                | ~12s              |
| 1000  | ~35s                | ~23s              |
| 5000  | ~3min               | ~2min             |

*Times vary based on file size, link count, and system performance*

## 🎓 Learning Resources

- [Obsidian Documentation](https://help.obsidian.md)
- [Notion Export Guide](https://notion.so/help/export-your-content)
- [Markdown Guide](https://www.markdownguide.org)
- [YAML Frontmatter](https://jekyllrb.com/docs/front-matter/)

---

**Remember**: Always `--dry-run` first! 🎯
