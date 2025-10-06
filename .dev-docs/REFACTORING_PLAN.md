# Notion2Obsidian Refactoring Plan

## 🎯 Goal

Break up the 2,688-line `notion2obsidian.js` into modular, maintainable files that fit in AI context windows.

## 📊 Current State

- **File size**: 2,688 lines
- **Token count**: 28,149 tokens (exceeds context window limit)
- **Issues**: Hard to maintain, can't load into context, mixed concerns, difficult to test

## 🏗️ Proposed Structure

```
src/
├── commands/
│   └── migrate.js              # Main migration workflow
├── lib/
│   ├── cli.js                  # CLI argument parsing
│   ├── zip.js                  # Zip extraction
│   ├── scanner.js              # File/directory scanning
│   ├── frontmatter.js          # Frontmatter generation
│   ├── links.js                # Link conversion
│   ├── callouts.js             # Callout processing
│   ├── csv.js                  # CSV database handling
│   ├── assets.js               # Asset organization
│   ├── utils.js                # Shared utilities
│   └── stats.js                # Migration statistics
├── notion2obsidian.js          # Entry point
└── enrich.js                   # Already modular ✓
```

## 📝 Module Breakdown

### Entry Point (`notion2obsidian.js`)
**Lines**: ~50
**Responsibility**: Route to commands
```javascript
import { migrate } from './src/commands/migrate.js';
import { enrichVault } from './enrich.js';
import { parseArgs } from './src/lib/cli.js';

// Runtime check
// Parse args
// Route to migrate or enrich
```

### CLI Parser (`src/lib/cli.js`)
**Current lines**: 68-191
**Exports**: `parseArgs()`, `showHelp()`, `showVersion()`, `getVersion()`

### Utilities (`src/lib/utils.js`)
**Current lines**: 194-250
**Exports**:
- `isHexString()`
- `extractNotionId()`
- `sanitizeFilename()`
- `shortenFilename()`
- `cleanName()`
- `cleanDirName()`

### Link Conversion (`src/lib/links.js`)
**Current lines**: 251-337
**Exports**:
- `convertMarkdownLinkToWiki()`
- `buildFileMap()`

### Frontmatter (`src/lib/frontmatter.js`)
**Current lines**: 339-588
**Exports**:
- `extractInlineMetadata()`
- `generateValidFrontmatter()`
- `getTagsFromPath()`
- `findDuplicateNames()`
- `processFileContent()`
- `updateFileContent()`

### Callouts (`src/lib/callouts.js`)
**Current lines**: 589-733
**Exports**:
- `ICON_TO_CALLOUT` constant
- `convertNotionCallouts()`
- `extractCoverImage()`

### CSV Handling (`src/lib/csv.js`)
**Current lines**: 734-829 + 1223-1543
**Exports**:
- `parseCsv()`
- `processCsvDatabases()`
- `generateDatabaseIndex()`
- `generateDataviewIndex()`
- `createNotesFromCsvRows()`

### Zip Extraction (`src/lib/zip.js`)
**Current lines**: 830-1095
**Exports**:
- `extractZipFile()`
- `extractMultipleZips()`

### File Scanner (`src/lib/scanner.js`)
**Current lines**: 1096-1177
**Exports**:
- `getAllDirectories()`
- `resolveGlobPatterns()`

### Assets (`src/lib/assets.js`)
**Current lines**: 1178-1222
**Exports**:
- `openDirectory()`
- `promptForConfirmation()`

### Statistics (`src/lib/stats.js`)
**Current lines**: 1544-1607
**Exports**:
- `MigrationStats` class

### Migration Command (`src/commands/migrate.js`)
**Current lines**: 1608-2687
**Exports**:
- `migrate()` (main function)

## 🔄 Migration Strategy

### Phase 1: Setup
1. Create `src/` directory structure
2. Create `src/lib/` directory
3. Create `src/commands/` directory

### Phase 2: Extract Utilities (safest first)
1. Extract `src/lib/utils.js`
2. Extract `src/lib/stats.js`
3. Extract `src/lib/cli.js`
4. Update imports in main file
5. Run tests ✓

### Phase 3: Extract Processing Modules
1. Extract `src/lib/links.js`
2. Extract `src/lib/callouts.js`
3. Extract `src/lib/frontmatter.js`
4. Update imports
5. Run tests ✓

### Phase 4: Extract Infrastructure
1. Extract `src/lib/csv.js`
2. Extract `src/lib/zip.js`
3. Extract `src/lib/scanner.js`
4. Extract `src/lib/assets.js`
5. Update imports
6. Run tests ✓

### Phase 5: Extract Main Command
1. Extract `src/commands/migrate.js`
2. Update main entry point
3. Run tests ✓

### Phase 6: Update Tests
1. Update test imports to use new module structure
2. Ensure all 62 tests still pass
3. Add any new tests for exported functions

### Phase 7: Cleanup
1. Remove old `notion2obsidian.js` content (keep as entry point only)
2. Update documentation
3. Final test run
4. Update package.json if needed

## ✅ Success Criteria

- [ ] All 94 tests passing
- [ ] CLI works identically to before
- [ ] All modules < 600 lines
- [ ] All modules fit in AI context window
- [ ] No duplicate code
- [ ] Clear module responsibilities
- [ ] Easy to find functionality

## 🎯 Testing Strategy

After each phase:
```bash
bun test
./notion2obsidian.js --help
./notion2obsidian.js --version
```

After completion:
```bash
bun test
./notion2obsidian.js ./test-export.zip --dry-run
./notion2obsidian.js --enrich ./test-vault --dry-run
```

## 📦 Benefits

1. **AI-friendly**: Each module < 600 lines, fits in context
2. **Maintainable**: Clear separation of concerns
3. **Testable**: Export individual functions
4. **Scalable**: Easy to add new features
5. **Readable**: Find code by filename
6. **Collaborative**: Reduce merge conflicts

## ⚠️ Risks & Mitigations

**Risk**: Breaking existing functionality
**Mitigation**: Run tests after each phase, use same function signatures

**Risk**: Import path issues
**Mitigation**: Use absolute imports from root, test incrementally

**Risk**: Circular dependencies
**Mitigation**: Keep utils at lowest level, commands at highest

**Risk**: Test failures
**Mitigation**: Update test imports immediately after each extraction

## 🔧 Implementation Notes

- Keep all function signatures identical
- Use named exports for clarity
- Group related constants with their functions
- Keep PATTERNS object in utils.js
- Maintain backward compatibility
- Update CLAUDE.md with new structure
