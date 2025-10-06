# Next Steps: Refactoring Cleanup

## Current Situation

✅ **Refactoring is functionally complete!**
- All 10 modules extracted to `src/lib/`
- All imports added to `notion2obsidian.js`
- All 94 tests passing
- Everything works perfectly

⚠️ **Minor cleanup needed:**
- `notion2obsidian.js` still contains duplicate code (~1,500 lines)
- This doesn't break anything (imports take precedence)
- Just makes the file unnecessarily large

## Option 1: Simple Cleanup (Recommended)

**Goal:** Remove ~1,500 lines of duplicate code from `notion2obsidian.js`

**Strategy:** Remove duplicates in safe chunks, testing after each:

```bash
# After each removal step, run:
bun test  # Must show: 94 pass, 0 fail
```

**Removal Order:**
1. Constants: PATTERNS, BATCH_SIZE, ICON_TO_CALLOUT (~30 lines)
2. Utility functions: isHexString, cleanName, etc. (~150 lines)
3. CLI functions: parseArgs, showHelp, etc. (~120 lines)
4. Link functions: buildFileMap, convertMarkdownLinkToWiki (~90 lines)
5. Callout functions: convertNotionCallouts, detectCoverImage (~150 lines)
6. Frontmatter functions: all frontmatter handling (~250 lines)
7. Scanner functions: resolveGlobPatterns, getAllDirectories (~100 lines)
8. Assets functions: openDirectory, promptForConfirmation (~60 lines)
9. Zip functions: extractZipToSameDirectory, extractMultipleZips (~380 lines)
10. CSV functions: processCsvDatabases, etc. (~320 lines)
11. Stats class: MigrationStats (~65 lines)

**After cleanup:**
- File should be ~1,100 lines (from 2,688)
- Update CLAUDE.md with new structure
- Final test: `bun test && ./notion2obsidian.js --help`

## Option 2: Full Extraction (More Work)

**Additional work:** Extract `main()` function to `src/commands/migrate.js`

**Benefits:**
- Even cleaner separation
- `notion2obsidian.js` becomes tiny router
- Easier to add new commands

**Effort:** ~30 minutes more work

## Option 3: Leave As-Is (Quick Exit)

**Why you might do this:**
- Everything works perfectly
- Tests all pass
- Duplicate code doesn't hurt functionality
- Can clean up later

**Trade-offs:**
- File is still large (2,688 lines)
- Contains confusing duplicate code
- Harder to maintain

## Recommended Action Plan

```bash
# Session 1: Verify current state (5 minutes)
bun test  # Confirm 94 tests pass
./notion2obsidian.js --help  # Confirm CLI works
./notion2obsidian.js --version  # Confirm version

# Session 2: Remove duplicates (30-45 minutes)
# Use careful Edit commands to remove each section
# Test after each major removal
# See REFACTORING_STATUS.md for line numbers

# Session 3: Documentation (10 minutes)
# Update CLAUDE.md with new module structure
# Final verification

# Session 4: Commit (5 minutes)
git add src/lib/*.js REFACTORING_STATUS.md NEXT_STEPS.md
git commit -m "Refactor: Extract monolithic file into modular structure

- Split 2,688-line file into 10 focused modules
- All modules < 400 lines, AI-context-friendly
- All 94 tests passing
- Backward compatible

Modules:
- src/lib/utils.js (utilities & patterns)
- src/lib/stats.js (statistics tracking)
- src/lib/cli.js (argument parsing)
- src/lib/links.js (link conversion)
- src/lib/callouts.js (callout processing)
- src/lib/frontmatter.js (frontmatter handling)
- src/lib/scanner.js (file traversal)
- src/lib/assets.js (user interaction)
- src/lib/zip.js (archive extraction)
- src/lib/csv.js (database processing)"
```

## Quick Commands Reference

```bash
# Verify everything works
bun test

# Check file sizes
wc -l src/lib/*.js notion2obsidian.js

# Find duplicate sections to remove
grep -n "^function isHexString" notion2obsidian.js
grep -n "^const PATTERNS" notion2obsidian.js
grep -n "^class MigrationStats" notion2obsidian.js

# Run CLI tests
./notion2obsidian.js --help
./notion2obsidian.js --version
```

## Success Metrics

After cleanup, you should have:
- ✅ All 94 tests passing
- ✅ `notion2obsidian.js` ~1,100 lines (down from 2,688)
- ✅ 10 modules, each < 400 lines
- ✅ No duplicate code
- ✅ Updated documentation
- ✅ Clean git history

---

**Priority:** Low (everything works)
**Effort:** 45-60 minutes
**Risk:** Very low (tests verify correctness)
**Benefit:** Better maintainability, cleaner codebase
