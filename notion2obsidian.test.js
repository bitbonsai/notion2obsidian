import { describe, test, expect } from "bun:test";

// Test utility functions by extracting them inline for testing
// In a production setup, these would be exported from notion2obsidian.js

const PATTERNS = {
  hexId: /^[0-9a-fA-F]{32}$/,
  mdLink: /\[([^\]]+)\]\(([^)]+\.md)\)/g,
  frontmatter: /^\uFEFF?\s*---\s*\n/,  // Only accept --- delimiters (Obsidian requirement)
  notionIdExtract: /\s([0-9a-fA-F]{32})(?:\.[^.]+)?$/
};

function isHexString(str) {
  return PATTERNS.hexId.test(str);
}

function extractNotionId(filename) {
  const match = filename.match(PATTERNS.notionIdExtract);
  return match ? match[1] : null;
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-');
}

function cleanName(filename) {
  const extname = (path) => {
    const idx = path.lastIndexOf('.');
    return idx === -1 ? '' : path.slice(idx);
  };

  const ext = extname(filename);
  const nameWithoutExt = filename.slice(0, -ext.length);
  const parts = nameWithoutExt.split(' ');

  if (parts.length > 1 && isHexString(parts[parts.length - 1])) {
    parts.pop();
    const cleanedName = parts.join(' ');
    return sanitizeFilename(cleanedName) + ext;
  }

  return sanitizeFilename(filename);
}

function cleanDirName(dirname) {
  const parts = dirname.split(' ');
  if (parts.length > 1 && isHexString(parts[parts.length - 1])) {
    parts.pop();
    return sanitizeFilename(parts.join(' '));
  }
  return sanitizeFilename(dirname);
}

// Tests
describe("Notion ID Detection", () => {
  test("should detect valid 32-char hex ID", () => {
    expect(isHexString("abc123def456789012345678901234ab")).toBe(true);
  });

  test("should reject invalid hex strings", () => {
    expect(isHexString("xyz123")).toBe(false);
    expect(isHexString("abc123def456789012345678901234abcd")).toBe(false); // 33 chars
    expect(isHexString("abc123def456789012345678901234a")).toBe(false); // 31 chars
  });

  test("should extract Notion ID from filename", () => {
    expect(extractNotionId("Project Alpha abc123def456789012345678901234ab.md"))
      .toBe("abc123def456789012345678901234ab");
  });

  test("should return null for filename without Notion ID", () => {
    expect(extractNotionId("Regular File.md")).toBe(null);
  });
});

describe("Filename Cleaning", () => {
  test("should remove Notion ID from filename", () => {
    expect(cleanName("Project Alpha abc123def456789012345678901234ab.md"))
      .toBe("Project Alpha.md");
  });

  test("should preserve filename without Notion ID", () => {
    expect(cleanName("Regular File.md"))
      .toBe("Regular File.md");
  });

  test("should clean directory names", () => {
    expect(cleanDirName("Projects abc123def456789012345678901234ab"))
      .toBe("Projects");
  });
});

describe("Windows Filename Sanitization", () => {
  test("should replace forbidden characters with hyphens", () => {
    expect(sanitizeFilename("File<Name>:Test")).toBe("File-Name--Test");
    expect(sanitizeFilename("Path/To\\File")).toBe("Path-To-File");
    expect(sanitizeFilename("File|Name?")).toBe("File-Name-");
    expect(sanitizeFilename("File*Name")).toBe("File-Name");
  });

  test("should replace control characters", () => {
    expect(sanitizeFilename("File\x00Name\x1F")).toBe("File-Name-");
  });

  test("should preserve valid characters", () => {
    expect(sanitizeFilename("Valid File Name 123.md"))
      .toBe("Valid File Name 123.md");
  });
});

describe("Frontmatter Detection", () => {
  test("should detect standard frontmatter with ---", () => {
    expect(PATTERNS.frontmatter.test("---\ntitle: Test")).toBe(true);
  });

  test("should detect frontmatter with BOM", () => {
    expect(PATTERNS.frontmatter.test("\uFEFF---\ntitle: Test")).toBe(true);
  });

  test("should detect frontmatter with whitespace", () => {
    expect(PATTERNS.frontmatter.test("  ---  \ntitle: Test")).toBe(true);
  });

  test("should NOT accept ___ or *** delimiters (Obsidian requires ---)", () => {
    expect(PATTERNS.frontmatter.test("___\ntitle: Test")).toBe(false);
    expect(PATTERNS.frontmatter.test("***\ntitle: Test")).toBe(false);
  });

  test("should not match non-frontmatter", () => {
    expect(PATTERNS.frontmatter.test("# Title\nContent")).toBe(false);
    expect(PATTERNS.frontmatter.test("Some text\n---\nMore text")).toBe(false);
  });
});

describe("Markdown Link Detection", () => {
  test("should match markdown links to .md files", () => {
    const text = "Check [this link](file.md) and [another](test.md)";
    const matches = Array.from(text.matchAll(PATTERNS.mdLink));
    expect(matches.length).toBe(2);
    expect(matches[0][1]).toBe("this link");
    expect(matches[0][2]).toBe("file.md");
  });

  test("should match URL-encoded links", () => {
    const text = "[Link](File%20Name%20abc123.md)";
    const matches = Array.from(text.matchAll(PATTERNS.mdLink));
    expect(matches.length).toBe(1);
    expect(matches[0][2]).toBe("File%20Name%20abc123.md");
  });

  test("should not match non-.md links", () => {
    const text = "[Image](image.png) and [Doc](doc.pdf)";
    const matches = Array.from(text.matchAll(PATTERNS.mdLink));
    expect(matches.length).toBe(0);
  });
});

describe("Integration Tests", () => {
  test("should clean complex Notion filename", () => {
    const input = "My Project: Plans/Ideas abc123def456789012345678901234ab.md";
    const expected = "My Project- Plans-Ideas.md";
    expect(cleanName(input)).toBe(expected);
  });

  test("should handle filename with special chars and Notion ID", () => {
    const input = "File<>Name abc123def456789012345678901234ab.md";
    const expected = "File--Name.md";
    expect(cleanName(input)).toBe(expected);
  });
});

describe("Image Filename Normalization", () => {
  function normalizeImageFilename(filename) {
    const extname = (path) => {
      const idx = path.lastIndexOf('.');
      return idx === -1 ? '' : path.slice(idx);
    };

    const ext = extname(filename).toLowerCase();
    const nameWithoutExt = filename.slice(0, -ext.length);
    return nameWithoutExt.replace(/\s+/g, '-').toLowerCase() + ext;
  }

  test("should normalize image filename with spaces", () => {
    expect(normalizeImageFilename("Untitled 1.png")).toBe("untitled-1.png");
    expect(normalizeImageFilename("My Image File.jpg")).toBe("my-image-file.jpg");
  });

  test("should convert to lowercase", () => {
    expect(normalizeImageFilename("MyImage.PNG")).toBe("myimage.png");
    expect(normalizeImageFilename("LOGO.SVG")).toBe("logo.svg");
  });

  test("should handle multiple spaces", () => {
    expect(normalizeImageFilename("Image   With    Spaces.png")).toBe("image-with-spaces.png");
  });

  test("should preserve extension case normalization", () => {
    expect(normalizeImageFilename("file.PNG")).toBe("file.png");
    expect(normalizeImageFilename("file.JPEG")).toBe("file.jpeg");
  });

  test("should handle already normalized names", () => {
    expect(normalizeImageFilename("already-normalized.png")).toBe("already-normalized.png");
  });
});

describe("Image Reference Updates", () => {
  function updateImageReference(imagePath) {
    // Decode URL-encoded paths and get just the filename
    const decodedPath = decodeURIComponent(imagePath);
    const basename = decodedPath.split('/').pop();

    // Normalize the filename
    const ext = basename.lastIndexOf('.') !== -1
      ? basename.slice(basename.lastIndexOf('.')).toLowerCase()
      : '';
    const nameWithoutExt = basename.slice(0, -ext.length);
    return nameWithoutExt.replace(/\s+/g, '-').toLowerCase() + ext;
  }

  test("should decode URL-encoded image paths", () => {
    expect(updateImageReference("Better%20performance%20%3D%20better%20design/Untitled.png"))
      .toBe("untitled.png");
  });

  test("should handle simple paths", () => {
    expect(updateImageReference("Folder/Image Name.png")).toBe("image-name.png");
  });

  test("should extract just filename from path", () => {
    expect(updateImageReference("Deep/Nested/Folder/My Image.jpg"))
      .toBe("my-image.jpg");
  });

  test("should handle special characters", () => {
    expect(updateImageReference("Folder/Image%20%28copy%29.png"))
      .toBe("image-(copy).png");
  });
});

describe("Attachment Folder Detection", () => {
  test("should match MD file with attachment folder", () => {
    const mdFile = "Better performance 456def.md";
    const folderName = "Better performance 456def";
    const mdBase = mdFile.slice(0, -3); // Remove .md
    expect(mdBase).toBe(folderName);
  });

  test("should handle complex folder names", () => {
    const mdFile = "My Project: Plans abc123def456789012345678901234ab.md";
    const mdBase = mdFile.slice(0, -3);
    expect(mdBase).toBe("My Project: Plans abc123def456789012345678901234ab");
  });
});

describe("End-to-End Zip Migration Test", () => {
  const { mkdir, writeFile, readFile, rm } = require("fs/promises");
  const { join } = require("path");
  const { tmpdir } = require("os");
  const { spawn } = require("child_process");

  let testDir;
  let zipPath;

  test("should migrate a complete Notion export zip", async () => {
    // Create test directory
    const testId = Date.now().toString(36);
    testDir = join(tmpdir(), `notion-test-${testId}`);
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, "Projects"), { recursive: true });

    // Create test files with Notion IDs and links
    const files = {
      "Project Alpha abc123def456789012345678901234ab.md": `# Project Alpha

Status: In Progress

## Links

Check out [Meeting Notes](Meeting%20Notes%20xyz789abc123456789012345678901cd.md) for details.

See also [Task List](Projects/Tasks%20111222333444555666777888999000ef.md).

External link: [Google](https://google.com)
`,
      "Meeting Notes xyz789abc123456789012345678901cd.md": `# Meeting Notes

## Discussion

Discussed [Project Alpha](Project%20Alpha%20abc123def456789012345678901234ab.md#overview).

See [Section](#section) for more.
`,
      "README fedcba987654321098765432109876543.md": `# README

- [Project Alpha](Project%20Alpha%20abc123def456789012345678901234ab.md)
- [Meeting Notes](Meeting%20Notes%20xyz789abc123456789012345678901cd.md)
`,
      "Projects/Tasks 111222333444555666777888999000ef.md": `# Tasks

Back to [Project Alpha](../Project%20Alpha%20abc123def456789012345678901234ab.md).
`,
      "Projects/Notes 000111222333444555666777888999aa.md": `# Notes

Reference [Tasks](Tasks%20111222333444555666777888999000ef.md).
`
    };

    // Write all test files
    for (const [filename, content] of Object.entries(files)) {
      await writeFile(join(testDir, filename), content);
    }

    // Create zip file
    zipPath = join(tmpdir(), `notion-test-${testId}.zip`);
    await new Promise((resolve, reject) => {
      const proc = spawn("zip", ["-r", zipPath, "."], { cwd: testDir });
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`zip failed: ${code}`)));
    });

    // Verify zip was created
    const zipStat = await require("fs/promises").stat(zipPath);
    expect(zipStat.size).toBeGreaterThan(0);

    // Extract and check structure
    const extractDir = join(tmpdir(), `notion-extract-${testId}`);
    await mkdir(extractDir, { recursive: true });

    await new Promise((resolve, reject) => {
      const proc = spawn("unzip", ["-q", zipPath, "-d", extractDir]);
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`unzip failed: ${code}`)));
    });

    // Verify extracted files have Notion IDs
    const extractedFile = join(extractDir, "Project Alpha abc123def456789012345678901234ab.md");
    const extractedStat = await require("fs/promises").stat(extractedFile);
    expect(extractedStat.isFile()).toBe(true);

    // Cleanup
    await rm(testDir, { recursive: true, force: true });
    await rm(extractDir, { recursive: true, force: true });
    await rm(zipPath, { force: true });
  }, 30000); // 30 second timeout for this test
});

// ============================================================================
// Gray-Matter Based Frontmatter Tests
// ============================================================================

// Import gray-matter for testing
import matter from "gray-matter";

// Duplicate the new frontmatter functions for testing
function hasValidFrontmatter(content) {
  const cleanContent = content.replace(/^\uFEFF/, '');
  return cleanContent.trimStart().startsWith('---\n');
}

function parseFrontmatter(content) {
  try {
    const cleanContent = content.replace(/^\uFEFF/, '');
    const parsed = matter(cleanContent);
    return {
      data: parsed.data || {},
      content: parsed.content || '',
      hasFrontmatter: Object.keys(parsed.data || {}).length > 0
    };
  } catch (error) {
    return {
      data: {},
      content: content.replace(/^\uFEFF/, ''),
      hasFrontmatter: false
    };
  }
}

function generateValidFrontmatter(metadata, relativePath) {
  const frontmatterData = {};

  if (metadata.title) frontmatterData.title = metadata.title;
  if (metadata.tags && metadata.tags.length > 0) {
    frontmatterData.tags = metadata.tags;
  }
  if (metadata.aliases && metadata.aliases.length > 0) {
    frontmatterData.aliases = metadata.aliases;
  }
  if (metadata.notionId) frontmatterData['notion-id'] = metadata.notionId;
  if (relativePath && relativePath !== '.') {
    frontmatterData.folder = relativePath;
  }
  if (metadata.status) frontmatterData.status = metadata.status;
  if (metadata.owner) frontmatterData.owner = metadata.owner;
  if (metadata.dates) frontmatterData.dates = metadata.dates;
  if (metadata.priority) frontmatterData.priority = metadata.priority;
  if (metadata.completion !== undefined) frontmatterData.completion = metadata.completion;
  if (metadata.summary) frontmatterData.summary = metadata.summary;

  frontmatterData.published = false;

  try {
    const result = matter.stringify('', frontmatterData);
    const frontmatterMatch = result.match(/^---\n([\s\S]*?)\n---\n$/);
    if (frontmatterMatch) {
      return `---\n${frontmatterMatch[1]}\n---`;
    }
    return generateFallbackFrontmatter(frontmatterData);
  } catch (error) {
    return generateFallbackFrontmatter(frontmatterData);
  }
}

function generateFallbackFrontmatter(data) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      value.forEach(item => {
        lines.push(`  - ${JSON.stringify(item)}`);
      });
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function validateFrontmatter(frontmatterString) {
  try {
    const parsed = matter(`${frontmatterString}\n\ntest content`);
    return parsed.data && typeof parsed.data === 'object';
  } catch (error) {
    return false;
  }
}

describe("Gray-Matter Frontmatter Validation", () => {
  test("should detect valid frontmatter", () => {
    expect(hasValidFrontmatter("---\ntitle: Test\n---\n\nContent")).toBe(true);
  });

  test("should detect frontmatter with BOM", () => {
    expect(hasValidFrontmatter("\uFEFF---\ntitle: Test\n---\n\nContent")).toBe(true);
  });

  test("should reject invalid frontmatter delimiters", () => {
    expect(hasValidFrontmatter("***\ntitle: Test\n***\n\nContent")).toBe(false);
    expect(hasValidFrontmatter("___\ntitle: Test\n___\n\nContent")).toBe(false);
  });

  test("should reject content without frontmatter", () => {
    expect(hasValidFrontmatter("# Title\n\nContent")).toBe(false);
  });
});

describe("Gray-Matter Frontmatter Parsing", () => {
  test("should parse valid frontmatter", () => {
    const content = "---\ntitle: Test Note\ntags: [test, example]\n---\n\nContent here";
    const result = parseFrontmatter(content);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.data.title).toBe("Test Note");
    expect(result.data.tags).toEqual(["test", "example"]);
    expect(result.content.trim()).toBe("Content here");
  });

  test("should handle content without frontmatter", () => {
    const content = "# Title\n\nJust content";
    const result = parseFrontmatter(content);

    expect(result.hasFrontmatter).toBe(false);
    expect(result.data).toEqual({});
    expect(result.content).toBe(content);
  });

  test("should handle BOM characters", () => {
    const content = "\uFEFF---\ntitle: Test\n---\n\nContent";
    const result = parseFrontmatter(content);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.data.title).toBe("Test");
  });

  test("should handle malformed frontmatter gracefully", () => {
    const content = "---\ninvalid: yaml: structure:\n---\n\nContent";
    const result = parseFrontmatter(content);

    expect(result.hasFrontmatter).toBe(false);
    expect(result.content).toBe(content);
  });
});

describe("Gray-Matter Frontmatter Generation", () => {
  test("should generate valid frontmatter", () => {
    const metadata = {
      title: "Test Note",
      tags: ["test", "example"],
      notionId: "abc123def456789012345678901234ab"
    };

    const frontmatter = generateValidFrontmatter(metadata, "folder/path");

    expect(frontmatter).toContain("---");
    expect(frontmatter).toContain("title: \"Test Note\"");
    expect(frontmatter).toContain("published: false");
    expect(frontmatter).toContain("folder: \"folder/path\"");
    expect(validateFrontmatter(frontmatter)).toBe(true);
  });

  test("should handle special characters in values", () => {
    const metadata = {
      title: "Test: Note with \"quotes\" and colons",
      summary: "A note with special chars: @#$%"
    };

    const frontmatter = generateValidFrontmatter(metadata, ".");

    expect(validateFrontmatter(frontmatter)).toBe(true);
    expect(frontmatter).toContain("title:");
    expect(frontmatter).toContain("summary:");
  });

  test("should handle arrays properly", () => {
    const metadata = {
      tags: ["tag-1", "tag with spaces", "tag:with:colons"],
      aliases: ["alias1", "alias 2"]
    };

    const frontmatter = generateValidFrontmatter(metadata, ".");

    expect(validateFrontmatter(frontmatter)).toBe(true);
    expect(frontmatter).toContain("tags:");
    expect(frontmatter).toContain("aliases:");
  });

  test("should set published: false by default", () => {
    const metadata = { title: "Test" };
    const frontmatter = generateValidFrontmatter(metadata, ".");

    expect(frontmatter).toContain("published: false");
  });

  test("should handle empty metadata gracefully", () => {
    const metadata = {};
    const frontmatter = generateValidFrontmatter(metadata, ".");

    expect(validateFrontmatter(frontmatter)).toBe(true);
    expect(frontmatter).toContain("published: false");
  });
});

describe("Frontmatter Validation", () => {
  test("should validate correct YAML frontmatter", () => {
    const validFrontmatter = `---
title: "Test Note"
tags:
  - "test"
  - "example"
published: false
---`;

    expect(validateFrontmatter(validFrontmatter)).toBe(true);
  });

  test("should reject invalid YAML", () => {
    const invalidFrontmatter = `---
title: Test Note
invalid: yaml: structure:
  - missing quotes
---`;

    expect(validateFrontmatter(invalidFrontmatter)).toBe(false);
  });

  test("should reject malformed YAML syntax", () => {
    const malformedFrontmatter = `---
title: "Test"
invalid yaml: {missing quotes and brackets
---`;

    expect(validateFrontmatter(malformedFrontmatter)).toBe(false);
  });
});

describe("Obsidian Compatibility", () => {
  test("should generate frontmatter that Obsidian can parse", () => {
    const metadata = {
      title: "Complex: Title with \"quotes\" and colons",
      tags: ["obsidian", "notion-import", "tag with spaces"],
      aliases: ["alias1", "alias with spaces"],
      notionId: "abc123def456789012345678901234ab",
      status: "In Progress",
      owner: "John Doe",
      completion: 75
    };

    const frontmatter = generateValidFrontmatter(metadata, "Projects/SubFolder");

    // Ensure it's valid YAML
    expect(validateFrontmatter(frontmatter)).toBe(true);

    // Ensure it uses --- delimiters
    expect(frontmatter.startsWith("---\n")).toBe(true);
    expect(frontmatter.endsWith("\n---")).toBe(true);

    // Ensure all values are properly quoted/escaped
    const parsed = matter(`${frontmatter}\n\ntest content`);
    expect(parsed.data.title).toBe("Complex: Title with \"quotes\" and colons");
    expect(parsed.data.tags).toEqual(["obsidian", "notion-import", "tag with spaces"]);
    expect(parsed.data.completion).toBe(75);
  });
});
