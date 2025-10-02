# Example: Before and After Migration

This document shows what the migration tool does with concrete examples.

## File Structure

### Before Migration (Notion Export)

```
my-notion-export/
├── Work abc123def456789012345678901234567/
│   ├── Projects 111222333444555666777888999000/
│   │   ├── Project Alpha abc111222333444555666777888.md
│   │   └── Project Beta def999888777666555444333222.md
│   └── Meeting Notes 444555666777888999000111222.md
└── Personal xyz789012345678901234567890123456/
    ├── Ideas 123456789012345678901234567890ab.md
    └── Reading List 234567890123456789012345678901bc.md
```

### After Migration (Obsidian-Ready)

```
my-notion-export/
├── Work/
│   ├── Projects/
│   │   ├── Project Alpha.md
│   │   └── Project Beta.md
│   └── Meeting Notes.md
└── Personal/
    ├── Ideas.md
    └── Reading List.md
```

---

## File Content Examples

### Example 1: Simple Note

#### Before (Project Alpha abc111222333444555666777888.md)

```markdown
# Project Alpha

This project aims to improve our workflow.

## Goals

- Increase efficiency by 20%
- Reduce errors
- Improve team collaboration

## Links

Check out [Project Beta](Project%20Beta%20def999888777666555444333222.md) for related work.

See also [Meeting Notes](../Meeting%20Notes%20444555666777888999000111222.md).
```

#### After (Project Alpha.md)

```markdown
---
title: "Project Alpha"
created: 2024-01-15
modified: 2024-09-28
tags: [work, projects]
aliases:
  - "Project Alpha abc111222333444555666777888"
notion-id: "abc111222333444555666777888"
folder: "Work/Projects"
published: false
---

# Project Alpha

This project aims to improve our workflow.

## Goals

- Increase efficiency by 20%
- Reduce errors
- Improve team collaboration

## Links

Check out [[Project Beta]] for related work.

See also [[Meeting Notes]].
```

---

### Example 2: Note with Inline Metadata

#### Before (Meeting Notes 444555666777888999000111222.md)

```markdown
# Team Meeting - Q4 Planning

Status: In Progress
Owner: John Doe
Dates: 2024-09-15 to 2024-09-30
Priority: High
Completion: 0.75

## Agenda

1. Review Q3 results
2. Set Q4 goals
3. Resource allocation

## Action Items

- Follow up on [Project Alpha](Projects/Project%20Alpha%20abc111222333444555666777888.md)
- Schedule next meeting
```

#### After (Meeting Notes.md)

```markdown
---
title: "Meeting Notes"
created: 2024-09-15
modified: 2024-09-30
tags: [work]
aliases:
  - "Meeting Notes 444555666777888999000111222"
notion-id: "444555666777888999000111222"
folder: "Work"
status: "In Progress"
owner: "John Doe"
dates: "2024-09-15 to 2024-09-30"
priority: "High"
completion: 0.75
published: false
---

# Team Meeting - Q4 Planning

Status: In Progress
Owner: John Doe
Dates: 2024-09-15 to 2024-09-30
Priority: High
Completion: 0.75

## Agenda

1. Review Q3 results
2. Set Q4 goals
3. Resource allocation

## Action Items

- Follow up on [[Project Alpha]]
- Schedule next meeting
```

---

### Example 3: Note with Section Links

#### Before (Reading List 234567890123456789012345678901bc.md)

```markdown
# Reading List 2024

## Technical Books

See recommendations in [Ideas](Ideas%20123456789012345678901234567890ab.md#book-recommendations).

## Articles

Check out the [productivity section](Ideas%20123456789012345678901234567890ab.md#productivity-tips).
```

#### After (Reading List.md)

```markdown
---
title: "Reading List"
created: 2024-01-01
modified: 2024-09-30
tags: [personal]
aliases:
  - "Reading List 234567890123456789012345678901bc"
notion-id: "234567890123456789012345678901bc"
folder: "Personal"
published: false
---

# Reading List 2024

## Technical Books

See recommendations in [[Ideas#book-recommendations]].

## Articles

Check out the [[Ideas#productivity-tips|productivity section]].
```

---

## Link Transformation Examples

### Simple Links

| Before | After |
|--------|-------|
| `[My Note](My%20Note%20abc123.md)` | `[[My Note]]` |
| `[Document](Document%20xyz789.md)` | `[[Document]]` |

### Links with Different Text

| Before | After |
|--------|-------|
| `[click here](My%20Note%20abc123.md)` | `[[My Note\|click here]]` |
| `[see this](Document%20xyz789.md)` | `[[Document\|see this]]` |

### Links with Anchors

| Before | After |
|--------|-------|
| `[My Note](My%20Note%20abc123.md#section)` | `[[My Note#section]]` |
| `[click here](Note%20xyz789.md#heading)` | `[[Note#heading\|click here]]` |

### Relative Path Links

| Before | After |
|--------|-------|
| `[Note](../Other/Note%20abc123.md)` | `[[Note]]` |
| `[File](./Subfolder/File%20xyz789.md)` | `[[File]]` |

### External Links (Preserved)

| Before | After |
|--------|-------|
| `[Google](https://google.com)` | `[Google](https://google.com)` |
| `[Docs](https://notion.so/docs)` | `[Docs](https://notion.so/docs)` |

---

## Duplicate Handling Example

### Before: Two files with same name in different folders

```
my-export/
├── Work/
│   └── Notes abc123.md
└── Personal/
    └── Notes xyz789.md
```

### After: Both preserved with folder context

```
my-export/
├── Work/
│   └── Notes.md  (folder: "Work" in frontmatter)
└── Personal/
    └── Notes.md  (folder: "Personal" in frontmatter)
```

**Notes.md in Work folder**:
```yaml
---
title: "Notes"
folder: "Work"
aliases:
  - "Notes abc123"
notion-id: "abc123"
---
```

**Notes.md in Personal folder**:
```yaml
---
title: "Notes"
folder: "Personal"
aliases:
  - "Notes xyz789"
notion-id: "xyz789"
---
```

---

## Tag Generation Examples

Folder structures are converted to tags:

| Folder Path | Generated Tags |
|-------------|----------------|
| `Work/Projects/Active` | `[work, projects, active]` |
| `Personal/Learning/Programming` | `[personal, learning, programming]` |
| `Archive/2023/Q4` | `[archive, 2023, q4]` |

Special characters are normalized:

| Folder Name | Tag |
|-------------|-----|
| `My Projects` | `my-projects` |
| `Q&A` | `q-a` |
| `Notes (2024)` | `notes-2024` |

---

## Complete Migration Example

### Input Directory

```
my-export/
└── Meeting abc123.md
```

**Content**:
```markdown
# Team Sync

Status: Complete
Owner: Jane

Discussed [Project Alpha](Project%20Alpha%20xyz789.md).
```

### After Migration

**Filename**: `Meeting.md`

**Content**:
```markdown
---
title: "Meeting"
created: 2024-09-15
modified: 2024-09-30
tags: []
aliases:
  - "Meeting abc123"
notion-id: "abc123"
status: "Complete"
owner: "Jane"
published: false
---

# Team Sync

Status: Complete
Owner: Jane

Discussed [[Project Alpha]].
```

---

## What Stays the Same

✅ **Original content** - All text, formatting, and structure preserved  
✅ **Images** - Image links and embedded images unchanged  
✅ **External links** - URLs to websites preserved  
✅ **Code blocks** - Syntax and formatting maintained  
✅ **Tables** - Structure and content unchanged  
✅ **Lists** - Ordered and unordered lists preserved  

## What Changes

🔄 **Filenames** - Notion IDs removed  
🔄 **Folder names** - Notion IDs removed  
🔄 **Internal links** - Converted to wiki links  
🔄 **File metadata** - Frontmatter added  

---

## Testing the Migration

### Step 1: Create Test Export

```bash
mkdir test-export
cd test-export
echo "# Test Note\nSee [Other](Other%20abc123.md)." > "Test abc123.md"
echo "# Other\nContent here." > "Other abc123.md"
```

### Step 2: Run Dry-Run

```bash
../migrate-notion-optimized.js . --dry-run
```

### Step 3: Check Preview

Look for:
- ✅ 2 files to rename
- ✅ 1 link to convert
- ✅ Frontmatter sample looks correct

### Step 4: Run Migration

```bash
../migrate-notion-optimized.js .
```

### Step 5: Verify Result

```bash
cat "Test.md"
# Should show frontmatter and [[Other]] link

cat "Other.md"
# Should show frontmatter
```

---

## Common Scenarios

### Scenario 1: Simple Export (100 files, no duplicates)

**Before**: 2-3 minute manual process  
**After**: 5 seconds automated

### Scenario 2: Large Export (1000+ files, many links)

**Before**: Hours of manual work  
**After**: ~35 seconds automated

### Scenario 3: Complex Export (duplicates, nested folders)

**Before**: Prone to errors, manual disambiguation  
**After**: Automatic handling with folder context

---

This example guide shows the real transformations your Notion export will undergo! 🎉
