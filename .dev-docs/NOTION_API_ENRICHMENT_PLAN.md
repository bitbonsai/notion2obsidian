# Notion API Enrichment Feature - Implementation Plan

## Overview

Add a post-migration enrichment feature that uses Notion's API to fetch missing metadata and assets that aren't included in standard exports. This runs AFTER the initial vault migration is complete.

## Problem Statement

Notion exports are missing critical metadata:
- **Creation & modification dates**: Export timestamps reflect export time, not actual document dates
- **Public URLs**: Only available if page is shared publicly (not the internal notion.so URLs)
- **Cover images**: Only URL references are exported (e.g., `https://www.notion.so/icons/checkmark_green.svg`)
- **Page icons**: Emoji or image icons aren't fully exported
- **Page properties**: Custom properties beyond basic text

The tool already preserves Notion IDs as frontmatter metadata, which can be used to query the API.

## Feature Scope

### What to Fetch from Notion API

1. **Dates** (high priority)
   - `created_time` - Original page creation timestamp
   - `last_edited_time` - Last modification timestamp

2. **Public URLs** (high priority)
   - `public_url` - ONLY if page is shared publicly with web
   - Store as `public-url` in frontmatter
   - Skip if page is private (no URL stored)

3. **Visual Assets** (medium priority)
   - `icon` - Page icon (emoji or file URL)
   - `cover` - Cover image URL
   - Download and save locally to vault

4. **Enhanced Properties** (optional/future)
   - Custom database properties
   - Relations and rollups
   - Page status

### What NOT to Include (Out of Scope)

- Internal Notion URLs (notion.so workspace links)
- Real-time sync (one-time enrichment only)
- Bi-directional sync
- Content re-processing (only metadata)
- Database views and filters

## Technical Design

### Command Structure

```bash
# Run enrichment on already-migrated vault
notion2obsidian --enrich /path/to/vault

# With Notion integration token (can use .env file or environment variable)
NOTION_TOKEN=secret_xxx notion2obsidian --enrich /path/to/vault

# Or use .env file in vault directory
echo "NOTION_TOKEN=secret_xxx" > /path/to/vault/.env
notion2obsidian --enrich /path/to/vault

# Dry run to preview changes
notion2obsidian --enrich /path/to/vault --dry-run

# Verbose output
notion2obsidian --enrich /path/to/vault -v
```

### Prerequisites Check

Before enrichment starts:
1. Verify vault has already been migrated (check for files with `notion-id` frontmatter)
2. Load `NOTION_TOKEN` from:
   - `.env` file in vault directory (first priority)
   - Environment variable (fallback)
   - Exit with error if neither exists
3. Test API connectivity with a single page request
4. Display summary of pages found with Notion IDs

### Rate Limiting & Caching Strategy

Notion API limits: **3 requests/second**

**Rate Limiting:**
- Sequential requests only (no parallelization to avoid rate limits)
- Token bucket or sliding window rate limiter
- 333ms minimum delay between requests (~3 req/s)
- Progress indicator showing: `Enriching pages: 45/250 (18%) - Rate: 2.9 req/s`
- Calculate and display estimated completion time
- Handle 429 rate limit responses with exponential backoff

**Response Caching:**
- Cache API responses in `.notion-cache.json` in vault root
- Cache structure: `{ "page_id": { "data": {...}, "fetched_at": "timestamp" } }`
- Use cached data on re-runs (skip API call if cache exists)
- Enables faster re-enrichment and recovery from failures
- Cache persists between runs (user can delete to force refresh)

### Data Flow

```
1. Scan vault for .md files
   └─> Extract notion-id and current modified date from frontmatter

2. Load cache and build enrichment queue
   └─> Check .notion-cache.json for existing data
   └─> For incremental updates: compare Notion's last_edited_time with frontmatter modified date
   └─> Queue only pages that need updating (new or changed)

3. Rate-limited API requests (sequential)
   └─> For each notion_id not in cache or outdated:
       - GET /v1/pages/{page_id}
       - Extract: dates, public_url (if exists), icon, cover
       - Save to cache immediately

4. Download assets (if applicable)
   └─> Save icons/covers next to the markdown file
   └─> Naming: same as .md file with suffix
       - Example: "Design Manifesto.md" → "Design Manifesto-cover.jpg", "Design Manifesto-icon.png"
   └─> Skip download if file already exists

5. Update frontmatter
   └─> Merge new metadata without losing existing data
   └─> Preserve user-added frontmatter fields
   └─> Update relative paths for assets

6. Generate summary report
   └─> Pages enriched: X (Y from cache, Z fetched)
   └─> Public URLs found: N
   └─> Assets downloaded: M
   └─> Errors encountered: E
```

### Frontmatter Updates

**Current frontmatter** (after migration):
```yaml
---
title: "Design Manifesto"
notion-id: "c27e422ef0b04e1d9e57fb3b10b498b3"
tags: [design, principles]
published: false
---
```

**After enrichment (page with public URL):**
```yaml
---
title: "Design Manifesto"
notion-id: "c27e422ef0b04e1d9e57fb3b10b498b3"
public-url: "https://username.notion.site/Design-Manifesto-c27e422e"
created: 2023-04-15T10:30:00.000Z
modified: 2024-10-02T14:22:00.000Z
icon: "🎨"  # or "Design Manifesto-icon.png" if downloaded
banner: "Design Manifesto-cover.jpg"  # stored next to .md file
tags: [design, principles]
published: false
---
```

**After enrichment (private page):**
```yaml
---
title: "Private Notes"
notion-id: "b5d358b4e66446898da5cb28117de98a"
created: 2023-06-20T08:15:00.000Z
modified: 2024-09-15T11:30:00.000Z
tags: [notes]
published: false
---
```
*Note: No `public-url` field for private pages*

### Asset Management

**Cover images & icons:**
- Store assets **next to the markdown file** (same directory)
- Filename pattern: `{markdown-filename}-{type}.{ext}`
  - Example: "Design Manifesto.md" → "Design Manifesto-cover.jpg", "Design Manifesto-icon.png"
- For nested pages: assets stay with their markdown file
  - Example: "Projects/Web App.md" → "Projects/Web App-cover.jpg"
- Update frontmatter with just the filename (same directory)
- Skip if asset already exists (idempotent)

**Supported formats:**
- Icons: emoji (store as-is in frontmatter), PNG, JPG (download if URL)
- Covers: PNG, JPG, GIF

### Error Handling

**API Errors:**
- 401 Unauthorized → Invalid token, show setup instructions
- 404 Not Found → Page deleted/not shared with integration
- 429 Rate Limited → Exponential backoff (wait longer)
- 503 Service Unavailable → Retry with backoff

**Strategy:**
- Continue on individual page errors (don't fail entire enrichment)
- Collect errors in report: `errors.log`
- Distinguish between critical (auth) and non-critical errors

**Error report format:**
```
ENRICHMENT ERRORS

Critical Errors (stop processing):
  None

Page Errors (skipped):
  - Design Manifesto.md: 404 Page not found (may have been deleted)
  - Ideas.md: 403 Access denied (integration lacks permission)

Asset Download Errors:
  - c27e422e-cover.jpg: Network timeout (retried 3 times)
```

## User Experience

### Setup Instructions (First-time Users)

Create clear documentation for:

1. **Creating a Notion Integration** (step-by-step)
   - Visit https://www.notion.so/my-integrations
   - Click "New integration"
   - Name: "Obsidian Enrichment" (or user's choice)
   - Select workspace
   - Copy "Internal Integration Token"

2. **Granting Integration Access**
   - Open Notion workspace
   - Navigate to pages you want to enrich
   - Click "..." → "Connections" → Add integration
   - NOTE: Must grant access to ALL pages (or at least parent pages)

3. **Setting Up Authentication**

   **Option 1: .env file (Recommended)**
   ```bash
   # Create .env file in your vault directory
   echo "NOTION_TOKEN=secret_xxx" > /path/to/vault/.env
   ```

   **Option 2: Environment variable**
   ```bash
   # macOS/Linux (temporary)
   export NOTION_TOKEN="secret_xxx"

   # macOS/Linux (persistent - add to ~/.zshrc or ~/.bashrc)
   echo 'export NOTION_TOKEN="secret_xxx"' >> ~/.zshrc

   # Windows (PowerShell)
   $env:NOTION_TOKEN="secret_xxx"
   ```

4. **Running Enrichment**
   ```bash
   notion2obsidian --enrich /path/to/vault
   ```

### Progress Display

```
Notion API Enrichment
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Found 247 pages with Notion IDs
✓ Notion API connected successfully

Enriching pages: 045/247 (18%) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Rate: 2.9 req/s | Elapsed: 15s | Remaining: ~1m 10s

Downloaded assets: 23 covers, 18 icons
```

### Completion Summary

```
Enrichment Complete!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ 247 pages enriched (185 from cache, 62 fetched)
✓ 41 assets downloaded (23 covers, 18 icons)
✗ 3 pages failed (see errors.log)

Added metadata:
  - Creation dates: 247 pages
  - Modification dates: 247 pages
  - Public URLs: 12 pages (235 private)
  - Page icons: 68 pages (50 emoji, 18 images)
  - Cover images: 23 pages

Cache: .notion-cache.json updated
Assets: Stored next to markdown files

Time elapsed: 1m 24s (saved ~2m via caching)
```

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- [ ] Add `--enrich` flag and command parsing
- [ ] Implement .env file loading (with environment variable fallback)
- [ ] Implement Notion API client with authentication
- [ ] Build rate limiter (3 req/s sequential, no parallelization)
- [ ] Create vault scanner (find files with notion-id)
- [ ] Implement API response caching (.notion-cache.json)
- [ ] Implement basic page metadata fetching (dates, public_url)

### Phase 2: Frontmatter Update (Week 1)
- [ ] Safe frontmatter merging (preserve existing fields)
- [ ] Date formatting (ISO 8601)
- [ ] Public URL detection (only add if page is publicly shared)
- [ ] Incremental update logic (compare modified dates, skip unchanged)
- [ ] Dry-run mode implementation
- [ ] Progress tracking and display (show cache hits vs API calls)

### Phase 3: Asset Management (Week 2)
- [ ] Icon and cover image detection from API response
- [ ] Asset download with retry logic
- [ ] Local storage next to markdown files (Page Name-cover.jpg pattern)
- [ ] Frontmatter path updates (relative paths)
- [ ] Skip download if asset already exists (idempotent)

### Phase 4: Error Handling & UX (Week 2)
- [ ] Comprehensive error collection
- [ ] Error report generation
- [ ] User-friendly error messages
- [ ] Setup instructions and validation

### Phase 5: Documentation & Polish (Week 2)
- [ ] README updates with enrichment instructions
- [ ] Notion integration setup guide (step-by-step)
- [ ] .env file and environment variable documentation
- [ ] Incremental update workflow documentation
- [ ] Cache management guide (.notion-cache.json)
- [ ] Example outputs and use cases

## Design Decisions

### 1. **Token Storage**
✅ Support both `.env` file (in vault directory) and environment variable
- Priority: .env file first, then fall back to environment variable
- No CLI flag (keeps interface simple)

### 2. **Incremental Updates**
✅ Support re-running enrichment to update only changed pages
- Compare Notion's `last_edited_time` with frontmatter `modified` date
- Skip API call if page hasn't changed
- Enables efficient re-enrichment of large vaults

### 3. **Asset Organization**
✅ Store assets next to markdown files
- Pattern: "Page Name.md" → "Page Name-cover.jpg", "Page Name-icon.png"
- Keeps related files together
- Simpler relative paths in frontmatter

### 4. **Selective Enrichment**
✅ All-or-nothing approach
- No granular flags (--dates-only, --no-covers, etc.)
- Keeps CLI simple and predictable
- User can manually remove unwanted fields after enrichment

### 5. **Database Properties**
✅ Not included in MVP
- Focus on core metadata (dates, URLs, basic assets)
- Can be added in future if there's demand
- Complexity of mapping custom properties to frontmatter

### 6. **Performance & Caching**
✅ Sequential requests (no parallelization)
- Avoids rate limit complexity
- Predictable 3 req/s throughput

✅ Cache API responses
- Save to `.notion-cache.json` in vault root
- Persist between runs for faster re-enrichment
- Enables recovery from failures without re-fetching

## Success Metrics

- **Functional**: Successfully enriches 95%+ of pages with valid Notion IDs
- **Performance**: Maintains ~3 req/s rate without throttling
- **Reliability**: Handles API errors gracefully, generates useful error reports
- **UX**: Clear setup instructions, users can complete enrichment in <5 minutes
- **Safety**: Preserves all existing frontmatter, idempotent (can re-run)

## Future Enhancements (Post-MVP)

- Selective re-enrichment (only update changed pages)
- Webhook support for real-time updates (advanced)
- Database property mapping configuration
- Custom frontmatter field mapping (YAML config)
- Batch operations for multiple vaults
- API response caching for faster re-runs
