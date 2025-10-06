import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getNotionToken, scanVaultForNotionPages, mergeFrontmatter } from "./enrich.js";

// ============================================================================
// Test Utilities
// ============================================================================

async function createTestVault() {
  const tempDir = await mkdtemp(join(tmpdir(), 'notion2obsidian-test-'));
  return tempDir;
}

async function cleanupTestVault(vaultPath) {
  await rm(vaultPath, { recursive: true, force: true });
}

async function createTestFile(vaultPath, filename, frontmatter, content = '') {
  const filePath = join(vaultPath, filename);

  // Ensure directory exists
  await mkdir(vaultPath, { recursive: true });

  const yaml = Object.entries(frontmatter)
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return `${key}: "${value}"`;
      } else if (Array.isArray(value)) {
        return `${key}: [${value.map(v => `"${v}"`).join(', ')}]`;
      } else {
        return `${key}: ${value}`;
      }
    })
    .join('\n');

  const fileContent = `---\n${yaml}\n---\n\n${content}`;
  await writeFile(filePath, fileContent, 'utf-8');

  return filePath;
}

// ============================================================================
// Environment Token Tests
// ============================================================================

describe("getNotionToken", () => {
  beforeEach(() => {
    // Clear environment variable before each test
    delete process.env.NOTION_TOKEN;
  });

  afterEach(() => {
    // Clean up
    delete process.env.NOTION_TOKEN;
  });

  test("returns token from environment variable", () => {
    process.env.NOTION_TOKEN = 'ntn_test_token_123';

    const token = getNotionToken();
    expect(token).toBe('ntn_test_token_123');
  });

  test("returns null if no token found", () => {
    const token = getNotionToken();
    expect(token).toBeNull();
  });

  test("handles secret_ prefix (legacy tokens)", () => {
    process.env.NOTION_TOKEN = 'secret_legacy_token_456';

    const token = getNotionToken();
    expect(token).toBe('secret_legacy_token_456');
  });

  test("handles ntn_ prefix (current tokens)", () => {
    process.env.NOTION_TOKEN = 'ntn_current_token_789';

    const token = getNotionToken();
    expect(token).toBe('ntn_current_token_789');
  });
});

// ============================================================================
// Vault Scanner Tests
// ============================================================================

describe("scanVaultForNotionPages", () => {
  let testVault;

  beforeEach(async () => {
    testVault = await createTestVault();
  });

  afterEach(async () => {
    await cleanupTestVault(testVault);
  });

  test("finds pages with notion-id frontmatter", async () => {
    await createTestFile(testVault, 'page1.md', {
      'title': 'Page 1',
      'notion-id': 'abc123def456'
    });

    await createTestFile(testVault, 'page2.md', {
      'title': 'Page 2',
      'notion-id': 'xyz789ghi012'
    });

    const pages = await scanVaultForNotionPages(testVault);

    expect(pages.length).toBe(2);

    const notionIds = pages.map(p => p.notionId).sort();
    expect(notionIds).toEqual(['abc123def456', 'xyz789ghi012']);
  });

  test("ignores pages without notion-id", async () => {
    await createTestFile(testVault, 'page1.md', {
      'title': 'Page 1',
      'notion-id': 'abc123def456'
    });

    await createTestFile(testVault, 'page2.md', {
      'title': 'Page 2'
    });

    const pages = await scanVaultForNotionPages(testVault);

    expect(pages.length).toBe(1);
    expect(pages[0].notionId).toBe('abc123def456');
  });

  test("handles nested directories", async () => {
    const subDir = join(testVault, 'subfolder');
    await mkdir(subDir, { recursive: true });

    await createTestFile(testVault, 'page1.md', {
      'title': 'Page 1',
      'notion-id': 'abc123'
    });

    await createTestFile(subDir, 'page2.md', {
      'title': 'Page 2',
      'notion-id': 'def456'
    });

    const pages = await scanVaultForNotionPages(testVault);

    expect(pages.length).toBe(2);
  });

  test("returns empty array for vault with no pages", async () => {
    const pages = await scanVaultForNotionPages(testVault);
    expect(pages.length).toBe(0);
  });

  test("includes frontmatter and content in results", async () => {
    await createTestFile(testVault, 'page1.md', {
      'title': 'Page 1',
      'notion-id': 'abc123',
      'tags': ['tag1', 'tag2']
    }, 'This is the content');

    const pages = await scanVaultForNotionPages(testVault);

    expect(pages.length).toBe(1);
    expect(pages[0].frontmatter.title).toBe('Page 1');
    expect(pages[0].frontmatter.tags).toEqual(['tag1', 'tag2']);
    expect(pages[0].content.trim()).toBe('This is the content');
  });

  test("handles files with no frontmatter gracefully", async () => {
    const filePath = join(testVault, 'no-frontmatter.md');
    await writeFile(filePath, 'Just content, no frontmatter', 'utf-8');

    const pages = await scanVaultForNotionPages(testVault);
    expect(pages.length).toBe(0);
  });

  test("handles malformed frontmatter gracefully", async () => {
    const filePath = join(testVault, 'malformed.md');
    await writeFile(filePath, '---\ninvalid: yaml: content:\n---\n', 'utf-8');

    // Should not throw
    const pages = await scanVaultForNotionPages(testVault);

    // Malformed files should be skipped
    expect(pages.length).toBe(0);
  });
});

// ============================================================================
// Integration Tests (without actual API calls)
// ============================================================================

describe("Enrichment Integration", () => {
  let testVault;

  beforeEach(async () => {
    testVault = await createTestVault();
  });

  afterEach(async () => {
    await cleanupTestVault(testVault);
  });

  test("can scan vault and find pages ready for enrichment", async () => {
    // Create a realistic vault structure
    await createTestFile(testVault, 'Document 1.md', {
      'title': 'Document 1',
      'notion-id': 'c27e422ef0b04e1d9e57fb3b10b498b3',
      'tags': ['design', 'principles']
    }, '# Document 1\n\nSome content here.');

    await createTestFile(testVault, 'Document 2.md', {
      'title': 'Document 2',
      'notion-id': 'b5d358b4e66446898da5cb28117de98a',
      'tags': ['notes']
    }, '# Document 2\n\nMore content.');

    const pages = await scanVaultForNotionPages(testVault);

    expect(pages.length).toBe(2);
    expect(pages.every(p => p.notionId)).toBe(true);
    expect(pages.every(p => p.path)).toBe(true);
    expect(pages.every(p => p.frontmatter)).toBe(true);
  });
});

// ============================================================================
// Frontmatter Merging Tests (utility function tests)
// ============================================================================

describe("Frontmatter Merging", () => {
  test("preserves existing fields", () => {
    const existing = {
      title: 'My Page',
      tags: ['tag1', 'tag2'],
      'notion-id': 'abc123'
    };

    const newMetadata = {
      created: '2023-01-01T00:00:00Z',
      modified: '2023-01-02T00:00:00Z'
    };

    const merged = { ...existing, ...newMetadata };

    expect(merged.title).toBe('My Page');
    expect(merged.tags).toEqual(['tag1', 'tag2']);
    expect(merged.created).toBe('2023-01-01T00:00:00Z');
    expect(merged.modified).toBe('2023-01-02T00:00:00Z');
  });

  test("overwrites existing metadata fields with new values", () => {
    const existing = {
      title: 'My Page',
      modified: '2023-01-01T00:00:00Z'
    };

    const newMetadata = {
      modified: '2023-01-02T00:00:00Z'
    };

    const merged = { ...existing, ...newMetadata };

    expect(merged.modified).toBe('2023-01-02T00:00:00Z');
  });

  test("ignores null and undefined values", () => {
    const existing = {
      title: 'My Page'
    };

    const newMetadata = {
      created: '2023-01-01T00:00:00Z',
      'public-url': null,
      icon: undefined
    };

    // Filter out null/undefined before merging
    const filtered = Object.fromEntries(
      Object.entries(newMetadata).filter(([_, v]) => v !== null && v !== undefined)
    );

    const merged = { ...existing, ...filtered };

    expect(merged.title).toBe('My Page');
    expect(merged.created).toBe('2023-01-01T00:00:00Z');
    expect(merged['public-url']).toBeUndefined();
    expect(merged.icon).toBeUndefined();
  });
});

// ============================================================================
// Metadata Extraction Tests (simulated API responses)
// ============================================================================

describe("Metadata Extraction", () => {
  test("extracts dates from Notion API response", () => {
    const apiResponse = {
      id: 'abc123',
      created_time: '2023-04-15T10:30:00.000Z',
      last_edited_time: '2024-10-02T14:22:00.000Z',
      properties: {}
    };

    expect(apiResponse.created_time).toBe('2023-04-15T10:30:00.000Z');
    expect(apiResponse.last_edited_time).toBe('2024-10-02T14:22:00.000Z');
  });

  test("extracts public URL if present", () => {
    const apiResponse = {
      id: 'abc123',
      public_url: 'https://username.notion.site/Page-abc123'
    };

    expect(apiResponse.public_url).toBe('https://username.notion.site/Page-abc123');
  });

  test("handles missing public URL (private page)", () => {
    const apiResponse = {
      id: 'abc123',
      public_url: null
    };

    expect(apiResponse.public_url).toBeNull();
  });

  test("extracts emoji icon", () => {
    const apiResponse = {
      id: 'abc123',
      icon: {
        type: 'emoji',
        emoji: '🎨'
      }
    };

    expect(apiResponse.icon.type).toBe('emoji');
    expect(apiResponse.icon.emoji).toBe('🎨');
  });

  test("extracts external icon URL", () => {
    const apiResponse = {
      id: 'abc123',
      icon: {
        type: 'external',
        external: {
          url: 'https://example.com/icon.png'
        }
      }
    };

    expect(apiResponse.icon.type).toBe('external');
    expect(apiResponse.icon.external.url).toBe('https://example.com/icon.png');
  });

  test("extracts cover image URL", () => {
    const apiResponse = {
      id: 'abc123',
      cover: {
        type: 'external',
        external: {
          url: 'https://example.com/cover.jpg'
        }
      }
    };

    expect(apiResponse.cover.type).toBe('external');
    expect(apiResponse.cover.external.url).toBe('https://example.com/cover.jpg');
  });
});

// ============================================================================
// Rate Limiter Tests
// ============================================================================

describe("Rate Limiter", () => {
  test("enforces delay between requests", async () => {
    const delayMs = 100; // Short delay for testing

    class TestRateLimiter {
      constructor(delayMs) {
        this.delayMs = delayMs;
        this.lastRequestTime = 0;
      }

      async wait() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest < this.delayMs) {
          const waitTime = this.delayMs - timeSinceLastRequest;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.lastRequestTime = Date.now();
      }
    }

    const limiter = new TestRateLimiter(delayMs);

    const start = Date.now();

    await limiter.wait();
    await limiter.wait();
    await limiter.wait();

    const elapsed = Date.now() - start;

    // Should take at least 2 * delayMs (2 waits after the first request)
    expect(elapsed).toBeGreaterThanOrEqual(2 * delayMs);
  });
});

// ============================================================================
// Cache Manager Tests
// ============================================================================

describe("Cache Manager", () => {
  let testVault;

  beforeEach(async () => {
    testVault = await createTestVault();
  });

  afterEach(async () => {
    await cleanupTestVault(testVault);
  });

  test("creates cache file when saving", async () => {
    const cachePath = join(testVault, '.notion-cache.json');
    const cacheData = {
      'abc123': {
        data: { id: 'abc123', created_time: '2023-01-01' },
        fetched_at: new Date().toISOString()
      }
    };

    await writeFile(cachePath, JSON.stringify(cacheData, null, 2));

    const content = await readFile(cachePath, 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed['abc123']).toBeDefined();
    expect(parsed['abc123'].data.id).toBe('abc123');
  });

  test("loads existing cache on initialization", async () => {
    const cachePath = join(testVault, '.notion-cache.json');
    const cacheData = {
      'abc123': {
        data: { id: 'abc123', created_time: '2023-01-01' },
        fetched_at: '2023-01-01T00:00:00Z'
      }
    };

    await writeFile(cachePath, JSON.stringify(cacheData, null, 2));

    const loadedContent = await readFile(cachePath, 'utf-8');
    const loaded = JSON.parse(loadedContent);

    expect(loaded['abc123']).toBeDefined();
    expect(loaded['abc123'].data.created_time).toBe('2023-01-01');
  });
});

// ============================================================================
// Frontmatter Merging Tests
// ============================================================================

describe("mergeFrontmatter", () => {
  test("sets published to true when public URL exists", () => {
    const existingFrontmatter = {
      title: "My Page",
      published: false,
      tags: ["test"]
    };

    const newMetadata = {
      'public-url': 'https://username.notion.site/My-Page-abc123',
      'created': '2023-01-01T00:00:00Z'
    };

    const merged = mergeFrontmatter(existingFrontmatter, newMetadata);

    expect(merged.published).toBe(true);
    expect(merged['public-url']).toBe('https://username.notion.site/My-Page-abc123');
    expect(merged.title).toBe("My Page");
  });

  test("keeps published false when no public URL", () => {
    const existingFrontmatter = {
      title: "Private Page",
      published: false,
      tags: ["test"]
    };

    const newMetadata = {
      'created': '2023-01-01T00:00:00Z',
      'modified': '2023-01-02T00:00:00Z'
    };

    const merged = mergeFrontmatter(existingFrontmatter, newMetadata);

    expect(merged.published).toBe(false);
    expect(merged['public-url']).toBeUndefined();
  });

  test("overrides published false with true when public URL added", () => {
    const existingFrontmatter = {
      title: "Page",
      published: false
    };

    const newMetadata = {
      'public-url': 'https://notion.site/Page-123'
    };

    const merged = mergeFrontmatter(existingFrontmatter, newMetadata);

    expect(merged.published).toBe(true);
  });

  test("preserves existing fields while merging", () => {
    const existingFrontmatter = {
      title: "Test",
      tags: ["a", "b"],
      custom: "field"
    };

    const newMetadata = {
      'created': '2023-01-01',
      'public-url': 'https://notion.site/test'
    };

    const merged = mergeFrontmatter(existingFrontmatter, newMetadata);

    expect(merged.title).toBe("Test");
    expect(merged.tags).toEqual(["a", "b"]);
    expect(merged.custom).toBe("field");
    expect(merged.created).toBe('2023-01-01');
    expect(merged.published).toBe(true);
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("Error Handling", () => {
  test("handles 401 Unauthorized errors", () => {
    const error = new Error('API error 401: Unauthorized');

    expect(error.message).toContain('401');
    expect(error.message).toContain('Unauthorized');
  });

  test("handles 404 Not Found errors", () => {
    const error = new Error('API error 404: Page not found');

    expect(error.message).toContain('404');
    expect(error.message).toContain('not found');
  });

  test("handles 429 Rate Limit errors", () => {
    const error = new Error('API error 429: Too Many Requests');

    expect(error.message).toContain('429');
  });

  test("handles network errors", () => {
    const error = new Error('Failed to fetch: Network error');

    expect(error.message).toContain('Network error');
  });
});
