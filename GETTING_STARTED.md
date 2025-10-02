# 🚀 Getting Started Guide

Welcome! This guide will help you migrate your Notion export to Obsidian in just a few minutes.

## ✅ Prerequisites

- **Bun** installed ([https://bun.sh](https://bun.sh))
- A Notion export (see how to export below)
- 5-10 minutes of your time

## 📦 Step 1: Export from Notion

1. Open Notion
2. Go to **Settings & Members** → **Settings**
3. Click **Export all workspace content**
4. Select **Markdown & CSV** format
5. Click **Export**
6. Download and unzip the export

You should now have a folder like `Export-abc123/`

## 🛠️ Step 2: Setup the Migration Tool

```bash
# Navigate to the directory with the migration tool
cd /Users/mwolff

# Install dependencies (one-time setup)
bun install

# Make the script executable
chmod +x migrate-notion-optimized.js
```

## 👀 Step 3: Preview the Migration (IMPORTANT!)

**Always start with a dry run to see what will happen:**

```bash
./migrate-notion-optimized.js ./path/to/Export-abc123 --dry-run
```

This will show you:
- ✅ How many files will be processed
- ✅ Sample filename changes
- ✅ Example frontmatter
- ✅ Number of links to convert
- ✅ Any duplicate filenames

**Review the output carefully!**

## 🎯 Step 4: Run the Migration

If the preview looks good:

```bash
./migrate-notion-optimized.js ./path/to/Export-abc123
```

You'll see:
1. **Phase 1**: Analysis with progress bars
2. **Preview**: Summary of changes
3. **Confirmation**: Press ENTER to proceed
4. **Phase 2**: Migration with real-time progress
5. **Summary**: Final statistics

The process takes **~5 seconds for 100 files**, **~35 seconds for 1000 files**.

## 🎉 Step 5: Open in Obsidian

1. Open Obsidian
2. Click **Open folder as vault**
3. Select your migrated export folder
4. Your notes are now ready! ✨

## 🧪 Test First (Recommended)

Create a small test to verify everything works:

```bash
# Create a test directory with a few files
mkdir test-notion-export
cd test-notion-export

# Create sample files
echo "# Test Note\nSee [Other](Other%20abc123.md)." > "Test abc123.md"
echo "# Other Note\nContent here." > "Other abc123.md"

# Go back
cd ..

# Test the migration
./migrate-notion-optimized.js ./test-notion-export --dry-run
./migrate-notion-optimized.js ./test-notion-export

# Check results
cat test-notion-export/Test.md
cat test-notion-export/Other.md
```

## 📊 What Happens During Migration

### Before
```
My Export/
├── Note abc123def456.md
├── Folder abc123/
│   └── Doc xyz789.md
```

### After
```
My Export/
├── Note.md                    (with frontmatter + wiki links)
├── Note.md.backup            (backup of original)
├── Folder/
│   ├── Doc.md                (with frontmatter + wiki links)
│   └── Doc.md.backup         (backup of original)
```

## 🎛️ Command Options

```bash
# Preview only (no changes)
./migrate-notion-optimized.js ./my-export --dry-run

# Normal migration (with backups)
./migrate-notion-optimized.js ./my-export

# Fast mode (no backups - use with caution!)
./migrate-notion-optimized.js ./my-export --skip-backup

# Verbose output for debugging
./migrate-notion-optimized.js ./my-export --verbose

# Show help
./migrate-notion-optimized.js --help
```

## ⚠️ Important Notes

1. **Always backup your Notion export first** - Keep the original .zip file
2. **Run --dry-run first** - Preview before making changes
3. **Check disk space** - Migration creates backups that double file count
4. **Close Obsidian** - Don't have the vault open during migration
5. **Review errors** - Check the error summary at the end

## 🆘 Troubleshooting

### "Permission denied"
```bash
chmod +x migrate-notion-optimized.js
```

### "Cannot find module"
```bash
bun install
```

### "Directory does not exist"
```bash
# Check your path
ls -la ./path/to/Export-abc123
```

### Migration seems stuck
- Check the progress bar - it shows current progress
- For large exports (5000+ files), it may take 2-3 minutes
- Press Ctrl+C to cancel if needed

### Errors during migration
- Review the error summary at the end
- Check the specific files mentioned
- You can restore from `.backup` files if needed

## 🔙 Rolling Back

If something goes wrong, restore from backups:

```bash
# Restore all files
find ./my-export -name "*.backup" -exec sh -c 'mv "$1" "${1%.backup}"' _ {} \;

# Or restore a single file
mv "My File.md.backup" "My File.md"
```

## 🧹 Cleanup (After Successful Migration)

Once you've verified everything works in Obsidian:

```bash
# Remove all backup files
find ./my-export -name "*.backup" -delete

# Count backups first to see how many
find ./my-export -name "*.backup" | wc -l
```

## ✨ What Gets Migrated

### ✅ Converted
- Filenames (Notion IDs removed)
- Directory names (Notion IDs removed)
- Markdown links → Wiki links
- Metadata → Frontmatter

### ✅ Preserved
- All content
- Images and attachments
- Code blocks
- Tables and lists
- External links
- Formatting

## 📈 Expected Results

After migration, each file will have:

1. **Clean filename** - No more Notion IDs
2. **YAML frontmatter** - Metadata at the top
3. **Wiki links** - `[[Note]]` instead of `[Note](Note%20abc.md)`
4. **Tags** - Generated from folder structure
5. **Aliases** - Original filename preserved

## 🎓 Next Steps

1. ✅ Open vault in Obsidian
2. ✅ Test wiki links work
3. ✅ Check frontmatter looks correct
4. ✅ Customize as needed
5. ✅ Delete backup files
6. ✅ Start using Obsidian!

## 💡 Pro Tips

- **Start small**: Test with 10-20 files first
- **Keep originals**: Don't delete your Notion export immediately
- **Check samples**: Manually verify a few files look correct
- **Use backups**: They're there for a reason!
- **Ask for help**: Check QUICK_REFERENCE.md for more info

## 📚 Additional Resources

- **README.md** - Full documentation
- **QUICK_REFERENCE.md** - Command cheat sheet
- **EXAMPLES.md** - Before/after examples
- **OPTIMIZATION_SUMMARY.md** - Technical details
- **ARCHITECTURE.md** - How it works

## 🎉 Success Checklist

After migration, verify:

- [ ] All files renamed correctly
- [ ] Frontmatter added to files
- [ ] Wiki links work in Obsidian
- [ ] No broken links
- [ ] Images still display
- [ ] Folder structure preserved
- [ ] No data lost

## 🚨 Emergency Contacts

If you encounter issues:

1. Check **QUICK_REFERENCE.md** troubleshooting section
2. Review error messages carefully
3. Try verbose mode: `--verbose`
4. Restore from backups if needed
5. Start over with a fresh export if necessary

---

## Quick Reference Card

```bash
# The Three Essential Commands

# 1. Preview
./migrate-notion-optimized.js ./my-export --dry-run

# 2. Migrate
./migrate-notion-optimized.js ./my-export

# 3. Clean up (after verification)
find ./my-export -name "*.backup" -delete
```

---

**That's it! You're ready to migrate your Notion notes to Obsidian!** 🎊

**Remember**: Always `--dry-run` first! 🎯
