import { describe, test, expect } from "bun:test";
import { basename, dirname } from "node:path";

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
});

describe("marker-based wikilink rewriting", () => {
  test("md marker pattern extracts display text and notionObjectId", () => {
    const markerPattern = /\[\[([^|\]]+)\|__MD_([a-f0-9]{32})__(?:~([A-Za-z0-9_-]+))?\]\]/gi;
    const content = "See [[Untitled|__MD_11111111111111111111111111111111__]] for details.";
    const matches = [...content.matchAll(markerPattern)];

    expect(matches.length).toBe(1);
    expect(matches[0][1]).toBe("Untitled");
    expect(matches[0][2]).toBe("11111111111111111111111111111111");
  });

  test("md marker pattern extracts optional encoded anchor", () => {
    const markerPattern = /\[\[([^|\]]+)\|__MD_([a-f0-9]{32})__(?:~([A-Za-z0-9_-]+))?\]\]/gi;
    const encodedAnchor = Buffer.from("section heading", "utf8").toString("base64url");
    const content = `See [[Untitled|__MD_11111111111111111111111111111111__~${encodedAnchor}]] for details.`;
    const matches = [...content.matchAll(markerPattern)];

    expect(matches.length).toBe(1);
    expect(matches[0][2]).toBe("11111111111111111111111111111111");
    expect(matches[0][3]).toBe(encodedAnchor);
  });

  test("marker pattern extracts dbName and notionObjectId", () => {
    const markerPattern = /\[\[([^|\]]+)(?:\|__CSV_([a-f0-9]{32})__(?:~([A-Za-z0-9_-]+))?)?\]\]/gi;
    
    const content = "See [[Tasks|__CSV_cb4727700fdf467784b57df8b3d71cc7__]] for details.";
    const matches = [...content.matchAll(markerPattern)];
    
    expect(matches.length).toBe(1);
    expect(matches[0][1]).toBe("Tasks");
    expect(matches[0][2]).toBe("cb4727700fdf467784b57df8b3d71cc7");
  });

  test("marker pattern preserves plain wikilinks without markers", () => {
    const markerPattern = /\[\[([^|\]]+)(?:\|__CSV_([a-f0-9]{32})__(?:~([A-Za-z0-9_-]+))?)?\]\]/gi;
    
    const content = "See [[Tasks]] and [[Projects]] for details.";
    const matches = [...content.matchAll(markerPattern)];
    
    expect(matches.length).toBe(2);
    expect(matches[0][1]).toBe("Tasks");
    expect(matches[0][2]).toBeUndefined();
    expect(matches[1][1]).toBe("Projects");
    expect(matches[1][2]).toBeUndefined();
  });

  test("marker replacement restores correct target based on objectId", async () => {
    const csvObjectIdMap = new Map([
      ["cb4727700fdf467784b57df8b3d71cc7", { targetPath: "Tasks [cb472770].base", relativeDir: "Project1", databaseName: "Tasks", targetType: "base" }],
      ["8e36195ae5da463fa49c05c963c8433b", { targetPath: "Tasks [8e36195a].base", relativeDir: "Project1", databaseName: "Tasks", targetType: "base" }]
    ]);

    const content = "Check [[Tasks|__CSV_cb4727700fdf467784b57df8b3d71cc7__]] and [[Tasks|__CSV_8e36195ae5da463fa49c05c963c8433b__]]";
    await import("node:path");

    const markerPattern = /\[\[([^|\]]+)(?:\|__CSV_([a-f0-9]{32})__(?:~([A-Za-z0-9_-]+))?)?\]\]/gi;
    const result = content.replace(markerPattern, (match, dbName, notionObjectId) => {
      if (notionObjectId) {
        const targetInfo = csvObjectIdMap.get(notionObjectId);
        if (targetInfo) {
          const wikiTarget = targetInfo.targetPath.replace(/\.(md|base)$/, "");
          return `[[${wikiTarget}|${dbName}]]`;
        }
        return `[[${dbName}]]`;
      }
      return match;
    });

    expect(result).toBe("Check [[Tasks [cb472770]|Tasks]] and [[Tasks [8e36195a]|Tasks]]");
    expect(result).not.toContain("__CSV_");
  });

  test("parent page links to child-folder same-name databases restore to disambiguated bases", () => {
    const csvObjectIdMap = new Map([
      ["11111111111111111111111111111111", { targetPath: "Untitled [11111111].base", relativeDir: "store", databaseName: "Untitled", targetType: "base" }],
      ["22222222222222222222222222222222", { targetPath: "Untitled [22222222].base", relativeDir: "store", databaseName: "Untitled", targetType: "base" }]
    ]);

    const content = [
      "# Product",
      "[[Untitled|__CSV_11111111111111111111111111111111__]]",
      "",
      "# Listing",
      "[[Untitled|__CSV_22222222222222222222222222222222__]]"
    ].join("\n");

    const markerPattern = /\[\[([^|\]]+)(?:\|__CSV_([a-f0-9]{32})__(?:~([A-Za-z0-9_-]+))?)?\]\]/gi;
    const result = content.replace(markerPattern, (match, dbName, notionObjectId) => {
      if (!notionObjectId) return match;
      const targetInfo = csvObjectIdMap.get(notionObjectId);
      if (!targetInfo) return `[[${dbName}]]`;
      return `[[${targetInfo.targetPath.replace(/\.(md|base)$/, "")}|${dbName}]]`;
    });

    expect(result).toContain("[[Untitled [11111111]|Untitled]]");
    expect(result).toContain("[[Untitled [22222222]|Untitled]]");
    expect(result).not.toContain("__CSV_");
  });

  test("parent page links to child-folder single database restore to base target", () => {
    const csvObjectIdMap = new Map([
      ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { targetPath: "Home views.base", relativeDir: "dashboard", databaseName: "Home views", targetType: "base" }]
    ]);

    const content = "[[Home views|__CSV_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa__]]";
    const markerPattern = /\[\[([^|\]]+)(?:\|__CSV_([a-f0-9]{32})__(?:~([A-Za-z0-9_-]+))?)?\]\]/gi;
    const result = content.replace(markerPattern, (match, dbName, notionObjectId) => {
      if (!notionObjectId) return match;
      const targetInfo = csvObjectIdMap.get(notionObjectId);
      if (!targetInfo) return `[[${dbName}]]`;
      return `[[${targetInfo.targetPath.replace(/\.(md|base)$/, "")}|${dbName}]]`;
    });

    expect(result).toBe("[[Home views|Home views]]");
    expect(result).not.toContain("__CSV_");
  });

  test("marker pattern also matches strong-emphasis variant after remark normalization", () => {
    const markerPattern = /\[\[([^|\]]+)(?:\|(?:__|\*\*)CSV_([a-f0-9]{32})(?:__|\*\*)(?:~([A-Za-z0-9_-]+))?)?\]\]/gi;
    const content = "[[Untitled|**CSV_11111111111111111111111111111111**]]";
    const matches = [...content.matchAll(markerPattern)];

    expect(matches.length).toBe(1);
    expect(matches[0][1]).toBe("Untitled");
    expect(matches[0][2]).toBe("11111111111111111111111111111111");
  });

  test("strong-emphasis marker variant restores exact target", () => {
    const csvObjectIdMap = new Map([
      ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { targetPath: "Home views_Index.md", relativeDir: "dashboard", databaseName: "Home views", targetType: "index" }]
    ]);

    const markerPattern = /\[\[([^|\]]+)(?:\|(?:__|\*\*)CSV_([a-f0-9]{32})(?:__|\*\*)(?:~([A-Za-z0-9_-]+))?)?\]\]/gi;
    const content = "[[Home views|**CSV_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa**]]";
    const result = content.replace(markerPattern, (match, dbName, notionObjectId) => {
      if (!notionObjectId) return match;
      const targetInfo = csvObjectIdMap.get(notionObjectId);
      if (!targetInfo) return `[[${dbName}]]`;
      return `[[${targetInfo.targetPath.replace(/\.(md|base)$/, "")}|${dbName}]]`;
    });

    expect(result).toBe("[[Home views_Index|Home views]]");
    expect(result).not.toContain("CSV_");
  });

  test("markers are cleaned when no matching objectId found", async () => {
    const csvObjectIdMap = new Map();
    
    const content = "[[Tasks|__CSV_aaaa0000aaaa0000aaaa0000aaaa0000__]]";
    const markerPattern = /\[\[([^|\]]+)(?:\|__CSV_([a-f0-9]{32})__(?:~([A-Za-z0-9_-]+))?)?\]\]/gi;
    await import("node:path");
    const result = content.replace(markerPattern, (match, dbName, notionObjectId) => {
      if (notionObjectId) {
        const targetInfo = csvObjectIdMap.get(notionObjectId);
        if (targetInfo) {
          const wikiTarget = targetInfo.filename.replace(/\.(md|base)$/, "");
          return `[[${wikiTarget}|${dbName}]]`;
        }
        return `[[${dbName}]]`;  // Clean marker, keep wikilink
      }
      return match;
    });

    expect(result).toBe("[[Tasks]]");
    expect(result).not.toContain("__CSV_");
  });

  test("md marker replacement restores exact child note path by notion-id", () => {
    const noteObjectIdMap = new Map([
      ["11111111111111111111111111111111", { wikiTarget: "topic/Untitled", title: "Untitled" }],
      ["22222222222222222222222222222222", { wikiTarget: "topic/Untitled-2", title: "Untitled-2" }]
    ]);

    const mdMarkerPattern = /\[\[([^|\]]+)\|__MD_([a-f0-9]{32})__(?:~([A-Za-z0-9_-]+))?\]\]/gi;
    const content = "[[Untitled|__MD_11111111111111111111111111111111__]]";
    const result = content.replace(mdMarkerPattern, (match, displayText, notionObjectId) => {
      const targetInfo = noteObjectIdMap.get(notionObjectId);
      if (!targetInfo) return `[[${displayText}]]`;
      if (displayText === targetInfo.title) {
        return `[[${targetInfo.wikiTarget}]]`;
      }
      return `[[${targetInfo.wikiTarget}|${displayText}]]`;
    });

    expect(result).toBe("[[topic/Untitled]]");
  });

  test("md marker replacement restores exact child note path and anchor by notion-id", () => {
    const noteObjectIdMap = new Map([
      ["11111111111111111111111111111111", { wikiTarget: "topic/Untitled", title: "Untitled" }]
    ]);
    const encodedAnchor = Buffer.from("section heading", "utf8").toString("base64url");
    const mdMarkerPattern = /\[\[([^|\]]+)\|__MD_([a-f0-9]{32})__(?:~([A-Za-z0-9_-]+))?\]\]/gi;
    const content = `[[Untitled|__MD_11111111111111111111111111111111__~${encodedAnchor}]]`;
    const result = content.replace(mdMarkerPattern, (match, displayText, notionObjectId, encodedFragment) => {
      const targetInfo = noteObjectIdMap.get(notionObjectId);
      const anchor = encodedFragment ? Buffer.from(encodedFragment, "base64url").toString("utf8") : "";
      const targetWithAnchor = anchor ? `${targetInfo.wikiTarget}#${anchor}` : targetInfo.wikiTarget;
      if (displayText === targetInfo.title) {
        return `[[${targetWithAnchor}]]`;
      }
      return `[[${targetWithAnchor}|${displayText}]]`;
    });

    expect(result).toBe("[[topic/Untitled#section heading]]");
  });

  test("missing marker target is preserved as plain wikilink and does not enter heuristic rewrite", async () => {
    const csvTargetsByName = new Map([
      ["tasks", [{ targetPath: "Tasks.base", relativeDir: "Projects", targetType: "base" }]]
    ]);

    const markerPattern = /\[\[([^|\]]+)(?:\|__CSV_([a-f0-9]{32})__(?:~([A-Za-z0-9_-]+))?)?\]\]/gi;
    let content = "[[Tasks|__CSV_deadbeefdeadbeefdeadbeefdeadbeef__]]";
    const keepPlainTokens = new Map();

    content = content.replace(markerPattern, (match, dbName, notionObjectId) => {
      if (!notionObjectId) return match;
      const token = "__CSV_KEEP_PLAIN_0__";
      keepPlainTokens.set(token, `[[${dbName}]]`);
      return token;
    });

    const plainWikilinkPattern = /\[\[([^|\]]+)(\|[^\]]*)?\]\]/gi;
    content = content.replace(plainWikilinkPattern, (match, linkTarget) => {
      const candidates = csvTargetsByName.get(String(linkTarget).toLowerCase());
      return candidates ? "[[WRONG]]" : match;
    });

    for (const [token, plainWikilink] of keepPlainTokens) {
      content = content.replaceAll(token, plainWikilink);
    }

    expect(content).toBe("[[Tasks]]");
  });

  test("missing CSV inventory is recorded as missing-export-file with object identity", () => {
    const csvObjectIdMap = new Map();
    const csvWikilinkReview = [];

    const resolveCsvMarkerLink = (dbName, notionObjectId, notePath, originalLinkText) => {
      const targetInfo = csvObjectIdMap.get(notionObjectId);
      if (targetInfo) {
        return {
          resolvedText: `[[${targetInfo.targetPath.replace(/\.(md|base)$/, "")}|${dbName}]]`,
          exactRestored: true
        };
      }

      csvWikilinkReview.push({
        notePath,
        originalLinkText,
        linkClass: "marker",
        databaseName: dbName,
        objectId: notionObjectId,
        reason: "missing-export-file",
        chosenTarget: null,
        candidates: []
      });

      return {
        resolvedText: `[[${dbName}]]`,
        exactRestored: false
      };
    };

    const result = resolveCsvMarkerLink(
      "My tasks",
      "cccccccccccccccccccccccccccccccc",
      "Workspace/home.md",
      "[[My tasks|**CSV_cccccccccccccccccccccccccccccccc**]]"
    );

    expect(result).toEqual({
      resolvedText: "[[My tasks]]",
      exactRestored: false
    });
    expect(csvWikilinkReview).toEqual([
      {
        notePath: "Workspace/home.md",
        originalLinkText: "[[My tasks|**CSV_cccccccccccccccccccccccccccccccc**]]",
        linkClass: "marker",
        databaseName: "My tasks",
        objectId: "cccccccccccccccccccccccccccccccc",
        reason: "missing-export-file",
        chosenTarget: null,
        candidates: []
      }
    ]);
  });

  test("missing CSV inventory restores from intended relative dir when a unique generated target exists", () => {
    const csvObjectIdMap = new Map();
    const csvTargetsByName = new Map([
      ["schedule", [
        { targetPath: "Schedule_Index.md", relativeDir: "Trips/Trip A", databaseName: "Schedule", targetType: "index" },
        { targetPath: "Schedule_Index 2.md", relativeDir: "Trips/Trip B", databaseName: "Schedule", targetType: "index" }
      ]]
    ]);

    const decodeCsvMarkerRelativeDir = (encodedRelativeDir) => {
      if (!encodedRelativeDir) return null;
      return Buffer.from(encodedRelativeDir, "base64url").toString("utf8");
    };

    const resolveMissingExportCsvLink = (dbName, encodedRelativeDir) => {
      const candidates = csvTargetsByName.get(String(dbName || "").trim().toLowerCase()) || [];
      const intendedRelativeDir = decodeCsvMarkerRelativeDir(encodedRelativeDir);
      const exactDirCandidates = candidates.filter(candidate => candidate.relativeDir === intendedRelativeDir);
      if (exactDirCandidates.length === 1) {
        return { status: "matched", target: exactDirCandidates[0], candidates };
      }
      return {
        status: candidates.length === 0 ? "missing-export-file" : "missing-export-file-ambiguous",
        candidates
      };
    };

    const resolveCsvMarkerLink = (dbName, notionObjectId, encodedRelativeDir) => {
      const targetInfo = csvObjectIdMap.get(notionObjectId);
      if (targetInfo) {
        return {
          resolvedText: `[[${targetInfo.targetPath.replace(/\.(md|base)$/, "")}|${dbName}]]`,
          exactRestored: true
        };
      }

      const missingExportResolution = resolveMissingExportCsvLink(dbName, encodedRelativeDir);
      if (missingExportResolution.status === "matched") {
        return {
          resolvedText: `[[${missingExportResolution.target.targetPath.replace(/\.(md|base)$/, "")}|${dbName}]]`,
          exactRestored: true
        };
      }

      return {
        resolvedText: `[[${dbName}]]`,
        exactRestored: false
      };
    };

    const intendedDir = Buffer.from("Trips/Trip A", "utf8").toString("base64url");
    const result = resolveCsvMarkerLink(
      "Schedule",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      intendedDir
    );

    expect(result).toEqual({
      resolvedText: "[[Schedule_Index|Schedule]]",
      exactRestored: true
    });
  });

  test("missing CSV inventory restores directly to note when object id matches migrated note", () => {
    const csvObjectIdMap = new Map();
    const noteObjectIdMap = new Map([
      ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", { wikiTarget: "Workspace/home/Untitled", title: "Untitled" }]
    ]);

    const resolveCsvMarkerLink = (dbName, notionObjectId) => {
      const csvTargetInfo = csvObjectIdMap.get(notionObjectId);
      if (csvTargetInfo) {
        return {
          resolvedText: `[[${csvTargetInfo.targetPath.replace(/\.(md|base)$/, "")}|${dbName}]]`,
          exactRestored: true
        };
      }

      const noteTargetInfo = noteObjectIdMap.get(String(notionObjectId || "").toLowerCase());
      if (noteTargetInfo) {
        return {
          resolvedText: `[[${noteTargetInfo.wikiTarget}|${dbName}]]`,
          exactRestored: true
        };
      }

      return {
        resolvedText: `[[${dbName}]]`,
        exactRestored: false
      };
    };

    const result = resolveCsvMarkerLink("Untitled", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

    expect(result).toEqual({
      resolvedText: "[[Workspace/home/Untitled|Untitled]]",
      exactRestored: true
    });
  });

  test("missing CSV inventory remains reviewable when intended dir still has no unique target", () => {
    const csvTargetsByName = new Map([
      ["untitled", [
        { targetPath: "Untitled_Index.md", relativeDir: "Workspace/home", databaseName: "Untitled", targetType: "index" },
        { targetPath: "Untitled [cccccccc]_Index.md", relativeDir: "Workspace/home", databaseName: "Untitled", targetType: "index" }
      ]]
    ]);

    const intendedDir = Buffer.from("Workspace/home", "utf8").toString("base64url");
    const candidates = csvTargetsByName.get("untitled");
    const exactDirCandidates = candidates.filter(candidate => candidate.relativeDir === Buffer.from(intendedDir, "base64url").toString("utf8"));

    expect(exactDirCandidates).toHaveLength(2);
  });

  test("missing CSV inventory restores from intended subtree when there is a unique descendant target", () => {
    const csvTargetsByName = new Map([
      ["my tasks", [
        { targetPath: "My tasks_Index.md", relativeDir: "Workspace/home/My tasks", databaseName: "My tasks", targetType: "index" },
        { targetPath: "My tasks_Index 2.md", relativeDir: "Workspace/elsewhere/My tasks", databaseName: "My tasks", targetType: "index" }
      ]]
    ]);

    const decodeCsvMarkerRelativeDir = (encodedRelativeDir) => {
      if (!encodedRelativeDir) return null;
      return Buffer.from(encodedRelativeDir, "base64url").toString("utf8");
    };

    const resolveMissingExportCsvLink = (dbName, encodedRelativeDir) => {
      const candidates = csvTargetsByName.get(String(dbName || "").trim().toLowerCase()) || [];
      const intendedRelativeDir = decodeCsvMarkerRelativeDir(encodedRelativeDir);
      const exactDirCandidates = candidates.filter(candidate => candidate.relativeDir === intendedRelativeDir);
      if (exactDirCandidates.length === 1) {
        return { status: "matched", target: exactDirCandidates[0], candidates };
      }
      if (exactDirCandidates.length > 1) {
        return { status: "missing-export-file-ambiguous", candidates: exactDirCandidates };
      }
      const descendantCandidates = candidates.filter(candidate => candidate.relativeDir.startsWith(`${intendedRelativeDir}/`));
      if (descendantCandidates.length === 1) {
        return { status: "matched", target: descendantCandidates[0], candidates };
      }
      if (descendantCandidates.length > 1) {
        return { status: "missing-export-file-ambiguous", candidates: descendantCandidates };
      }
      return {
        status: candidates.length === 0 ? "missing-export-file" : "missing-export-file-ambiguous",
        candidates
      };
    };

    const intendedDir = Buffer.from("Workspace/home", "utf8").toString("base64url");
    const result = resolveMissingExportCsvLink("My tasks", intendedDir);

    expect(result).toEqual({
      status: "matched",
      target: {
        targetPath: "My tasks_Index.md",
        relativeDir: "Workspace/home/My tasks",
        databaseName: "My tasks",
        targetType: "index"
      },
      candidates: csvTargetsByName.get("my tasks")
    });
  });

  test("missing CSV inventory restores from intended subtree when there is a unique descendant note target", () => {
    const noteTargetsByName = new Map([
      ["untitled", [
        { targetPath: "Workspace/home/Untitled.md", relativeDir: "Workspace/home", databaseName: "Untitled", targetType: "note" },
        { targetPath: "Workspace/elsewhere/Untitled.md", relativeDir: "Workspace/elsewhere", databaseName: "Untitled", targetType: "note" }
      ]]
    ]);

    const decodeCsvMarkerRelativeDir = (encodedRelativeDir) => {
      if (!encodedRelativeDir) return null;
      return Buffer.from(encodedRelativeDir, "base64url").toString("utf8");
    };

    const resolveMissingExportTargetInSubtree = (intendedRelativeDir, candidates) => {
      const exactDirCandidates = candidates.filter(candidate => candidate.relativeDir === intendedRelativeDir);
      if (exactDirCandidates.length === 1) {
        return { status: "matched", target: exactDirCandidates[0], candidates };
      }
      if (exactDirCandidates.length > 1) {
        return { status: "ambiguous", candidates: exactDirCandidates };
      }
      const descendantCandidates = candidates.filter(candidate => candidate.relativeDir.startsWith(`${intendedRelativeDir}/`) || candidate.relativeDir === intendedRelativeDir);
      if (descendantCandidates.length === 1) {
        return { status: "matched", target: descendantCandidates[0], candidates };
      }
      if (descendantCandidates.length > 1) {
        return { status: "ambiguous", candidates: descendantCandidates };
      }
      return { status: "none", candidates };
    };

    const resolveMissingExportCsvLink = (dbName, encodedRelativeDir) => {
      const intendedRelativeDir = decodeCsvMarkerRelativeDir(encodedRelativeDir);
      const noteCandidates = noteTargetsByName.get(String(dbName || "").trim().toLowerCase()) || [];
      const noteResolution = resolveMissingExportTargetInSubtree(intendedRelativeDir, noteCandidates);
      if (noteResolution.status === "matched") {
        return { status: "matched", target: noteResolution.target, candidates: noteCandidates };
      }
      return {
        status: noteCandidates.length === 0 ? "missing-export-file" : "missing-export-file-ambiguous",
        candidates: noteCandidates
      };
    };

    const intendedDir = Buffer.from("Workspace/home", "utf8").toString("base64url");
    const result = resolveMissingExportCsvLink("Untitled", intendedDir);

    expect(result).toEqual({
      status: "matched",
      target: {
        targetPath: "Workspace/home/Untitled.md",
        relativeDir: "Workspace/home",
        databaseName: "Untitled",
        targetType: "note"
      },
      candidates: noteTargetsByName.get("untitled")
    });
  });

  test("missing CSV inventory remains reviewable when intended subtree has multiple descendant targets", () => {
    const csvTargetsByName = new Map([
      ["untitled", [
        { targetPath: "Untitled A_Index.md", relativeDir: "Workspace/home/child-a", databaseName: "Untitled", targetType: "index" },
        { targetPath: "Untitled B_Index.md", relativeDir: "Workspace/home/child-b", databaseName: "Untitled", targetType: "index" }
      ]]
    ]);

    const decodeCsvMarkerRelativeDir = (encodedRelativeDir) => {
      if (!encodedRelativeDir) return null;
      return Buffer.from(encodedRelativeDir, "base64url").toString("utf8");
    };

    const resolveMissingExportCsvLink = (dbName, encodedRelativeDir) => {
      const candidates = csvTargetsByName.get(String(dbName || "").trim().toLowerCase()) || [];
      const intendedRelativeDir = decodeCsvMarkerRelativeDir(encodedRelativeDir);
      const exactDirCandidates = candidates.filter(candidate => candidate.relativeDir === intendedRelativeDir);
      if (exactDirCandidates.length > 0) {
        return { status: exactDirCandidates.length === 1 ? "matched" : "missing-export-file-ambiguous", candidates: exactDirCandidates };
      }
      const descendantCandidates = candidates.filter(candidate => candidate.relativeDir.startsWith(`${intendedRelativeDir}/`));
      if (descendantCandidates.length > 1) {
        return { status: "missing-export-file-ambiguous", candidates: descendantCandidates };
      }
      return {
        status: candidates.length === 0 ? "missing-export-file" : "missing-export-file-ambiguous",
        candidates
      };
    };

    const intendedDir = Buffer.from("Workspace/home", "utf8").toString("base64url");
    const result = resolveMissingExportCsvLink("Untitled", intendedDir);

    expect(result.status).toBe("missing-export-file-ambiguous");
    expect(result.candidates).toHaveLength(2);
  });

  test("plain CSV wikilinks still rewrite through legacy name-based mapping", () => {
    const csvWikilinkMap = new Map([
      ["Tasks", "Tasks_Index.md"]
    ]);

    let content = "See [[Tasks]] for details.";
    for (const [dbName, targetFileName] of csvWikilinkMap) {
      const wikiTarget = targetFileName.endsWith(".md")
        ? targetFileName.slice(0, -3)
        : targetFileName;
      const pattern = new RegExp(`\\[\\[${dbName}(\\|[^\\]]*)?\\]\\]`, "gi");
      content = content.replace(pattern, (match, alias) => alias ? `[[${wikiTarget}${alias}]]` : `[[${wikiTarget}]]`);
    }

    expect(content).toBe("See [[Tasks_Index]] for details.");
  });

  test("root-level database target uses ../ prefix when ambiguous with same-name subfolder target", () => {
    function normalizeRelativeDirPath(relPath) {
      if (!relPath || relPath === ".") return "";
      return String(relPath).replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");
    }

    function csvQualifiedWikiTarget(relativeDir, targetPath, notePath, ambiguous) {
      const bareName = targetPath.replace(/\.(md|base)$/, "");
      if (!ambiguous) return bareName;
      if (relativeDir) return `${relativeDir}/${bareName}`;
      const noteDir = normalizeRelativeDirPath(dirname(String(notePath || "").replace(/\\/g, "/")));
      if (!noteDir) return bareName;
      const depth = noteDir.split("/").length;
      if (depth === 1) return `../${bareName}`;
      return `${Array(depth).fill("..").join("/")}/${bareName}`;
    }

    function isCsvNameAmbiguous(dbName, csvTargetsByName) {
      const candidates = csvTargetsByName.get(String(dbName || "").trim().toLowerCase());
      if (!candidates || candidates.length <= 1) return false;
      const uniqueDirs = new Set(candidates.map(c => normalizeRelativeDirPath(c.relativeDir)));
      return uniqueDirs.size > 1;
    }

    const csvTargetsByName = new Map([
      ["tasks", [
        { targetPath: "Tasks.base", relativeDir: "", databaseName: "Tasks", targetType: "base" },
        { targetPath: "Tasks.base", relativeDir: "Projects", databaseName: "Tasks", targetType: "base" }
      ]]
    ]);

    const csvObjectIdMap = new Map([
      ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { targetPath: "Tasks.base", relativeDir: "", databaseName: "Tasks", targetType: "base" }],
      ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", { targetPath: "Tasks.base", relativeDir: "Projects", databaseName: "Tasks", targetType: "base" }]
    ]);

    const resolveCsvMarkerLink = (dbName, notionObjectId, notePath) => {
      const targetInfo = csvObjectIdMap.get(notionObjectId);
      if (targetInfo) {
        const wikiTarget = csvQualifiedWikiTarget(targetInfo.relativeDir, targetInfo.targetPath, notePath, isCsvNameAmbiguous(dbName, csvTargetsByName));
        return { resolvedText: `[[${wikiTarget}|${dbName}]]`, exactRestored: true };
      }
      return { resolvedText: `[[${dbName}]]`, exactRestored: false };
    };

    const resolveFromSubfolder = resolveCsvMarkerLink("Tasks", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Projects/SomeNote.md");
    expect(resolveFromSubfolder.resolvedText).toBe("[[../Tasks|Tasks]]");
    expect(resolveFromSubfolder.exactRestored).toBe(true);

    const resolveFromDeepSubfolder = resolveCsvMarkerLink("Tasks", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Projects/Deep/Nested.md");
    expect(resolveFromDeepSubfolder.resolvedText).toBe("[[../../Tasks|Tasks]]");
    expect(resolveFromDeepSubfolder.exactRestored).toBe(true);

    const resolveFromRoot = resolveCsvMarkerLink("Tasks", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "RootNote.md");
    expect(resolveFromRoot.resolvedText).toBe("[[Tasks|Tasks]]");
    expect(resolveFromRoot.exactRestored).toBe(true);

    const resolveSubfolderTarget = resolveCsvMarkerLink("Tasks", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "Projects/SomeNote.md");
    expect(resolveSubfolderTarget.resolvedText).toBe("[[Projects/Tasks|Tasks]]");
    expect(resolveSubfolderTarget.exactRestored).toBe(true);

    expect(isCsvNameAmbiguous("Tasks", new Map([
      ["tasks", [{ targetPath: "Tasks.base", relativeDir: "", databaseName: "Tasks", targetType: "base" }]]
    ]))).toBe(false);

    expect(isCsvNameAmbiguous("Tasks", new Map([
      ["tasks", [
        { targetPath: "Tasks.base", relativeDir: "Projects", databaseName: "Tasks", targetType: "base" },
        { targetPath: "Tasks.base", relativeDir: "Projects", databaseName: "Tasks", targetType: "base" }
      ]]
    ]))).toBe(false);
  });

  test("note target stored with bare filename is not double-prefixed with relativeDir", () => {
    function normalizeRelativeDirPath(relPath) {
      if (!relPath || relPath === ".") return "";
      return String(relPath).replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");
    }

    function csvQualifiedWikiTarget(relativeDir, targetPath, notePath, ambiguous) {
      const bareName = targetPath.replace(/\.(md|base)$/, "");
      if (!ambiguous) return bareName;
      if (relativeDir) return `${relativeDir}/${bareName}`;
      const noteDir = normalizeRelativeDirPath(dirname(String(notePath || "").replace(/\\/g, "/")));
      if (!noteDir) return bareName;
      const depth = noteDir.split("/").length;
      if (depth === 1) return `../${bareName}`;
      return `${Array(depth).fill("..").join("/")}/${bareName}`;
    }

    function buildNoteTargetsByName(noteObjectIdMap) {
      const noteTargetsByName = new Map();
      for (const targetInfo of noteObjectIdMap.values()) {
        const key = String(targetInfo.title || "").toLowerCase();
        if (!noteTargetsByName.has(key)) noteTargetsByName.set(key, []);
        noteTargetsByName.get(key).push({
          targetPath: basename(targetInfo.relativePath),
          relativeDir: normalizeRelativeDirPath(dirname(targetInfo.relativePath)),
          targetType: "note",
          databaseName: targetInfo.title
        });
      }
      return noteTargetsByName;
    }

    function isCsvNameAmbiguous(dbName, csvTargetsByName, noteTargetsByName) {
      const csvCandidates = csvTargetsByName.get(String(dbName || "").trim().toLowerCase()) || [];
      const noteCandidates = noteTargetsByName.get(String(dbName || "").trim().toLowerCase()) || [];
      const allCandidates = [...csvCandidates, ...noteCandidates];
      if (allCandidates.length <= 1) return false;
      const uniqueDirs = new Set(allCandidates.map(c => normalizeRelativeDirPath(c.relativeDir)));
      return uniqueDirs.size > 1;
    }

    const noteObjectIdMap = new Map([
      ["aaaa0000aaaa0000aaaa0000aaaa0000", { relativePath: "Workspace/dashboard/Untitled.md", wikiTarget: "Workspace/dashboard/Untitled", title: "Untitled" }],
      ["bbbb0000bbbb0000bbbb0000bbbb0000", { relativePath: "Workspace/other/Untitled.md", wikiTarget: "Workspace/other/Untitled", title: "Untitled" }]
    ]);

    const noteTargetsByName = buildNoteTargetsByName(noteObjectIdMap);

    const noteEntries = noteTargetsByName.get("untitled");
    expect(noteEntries).toHaveLength(2);
    expect(noteEntries[0].targetPath).toBe("Untitled.md");
    expect(noteEntries[0].relativeDir).toBe("Workspace/dashboard");
    expect(noteEntries[1].targetPath).toBe("Untitled.md");
    expect(noteEntries[1].relativeDir).toBe("Workspace/other");

    const csvResult = csvQualifiedWikiTarget("Workspace/dashboard", "Untitled.md", "Workspace/dashboard.md", true);
    expect(csvResult).toBe("Workspace/dashboard/Untitled");

    const rootResult = csvQualifiedWikiTarget("", "Untitled.md", "Workspace/dashboard/SomeNote.md", true);
    expect(rootResult).toBe("../../Untitled");

    const bareResult = csvQualifiedWikiTarget("Workspace/dashboard", "Untitled.md", "Workspace/dashboard.md", false);
    expect(bareResult).toBe("Untitled");
  });
});

describe("bases-mode plain wikilink candidate ranking", () => {
  function normalizeRelativeDirPath(relPath) {
    if (!relPath || relPath === ".") return "";
    return String(relPath).replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");
  }

  function splitRelativeDir(relPath) {
    const normalized = normalizeRelativeDirPath(relPath);
    return normalized ? normalized.split("/") : [];
  }

  function isSegmentPrefix(prefix, value) {
    if (prefix.length > value.length) return false;
    return prefix.every((segment, index) => value[index] === segment);
  }

  function scoreCandidate(noteRelPath, candidateRelativeDir) {
    const noteDir = normalizeRelativeDirPath(dirname(noteRelPath));
    const noteSegments = splitRelativeDir(noteDir);
    const candidateSegments = splitRelativeDir(candidateRelativeDir);
    const noteBase = basename(noteRelPath, ".md").toLowerCase();
    const candidateLeaf = basename(normalizeRelativeDirPath(candidateRelativeDir)).toLowerCase();

    if (noteBase && candidateLeaf && noteBase === candidateLeaf) return { rank: -1, distance: 0 };

    if (noteDir === normalizeRelativeDirPath(candidateRelativeDir)) return { rank: 0, distance: 0 };
    if (isSegmentPrefix(noteSegments, candidateSegments)) return { rank: 1, distance: candidateSegments.length - noteSegments.length };
    if (isSegmentPrefix(candidateSegments, noteSegments)) return { rank: 2, distance: noteSegments.length - candidateSegments.length };
    return { rank: 3, distance: Number.POSITIVE_INFINITY };
  }

  function selectBest(noteRelPath, candidates) {
    const scored = candidates.map(candidate => ({ ...candidate, ...scoreCandidate(noteRelPath, candidate.relativeDir) }));
    const bestRank = Math.min(...scored.map(candidate => candidate.rank));
    const bestRankCandidates = scored.filter(candidate => candidate.rank === bestRank);
    if (bestRank === 3) {
      return bestRankCandidates.length === 1 ? { status: "matched", target: bestRankCandidates[0] } : { status: "ambiguous" };
    }
    const bestDistance = Math.min(...bestRankCandidates.map(candidate => candidate.distance));
    const bestDistanceCandidates = bestRankCandidates.filter(candidate => candidate.distance === bestDistance);
    return bestDistanceCandidates.length === 1
      ? { status: "matched", target: bestDistanceCandidates[0] }
      : { status: "ambiguous" };
  }

  test("prefers child-directory database for parent page links", () => {
    const result = selectBest("Private & Shared/Home.md", [
      { targetPath: "Untitled [1af19f66].base", relativeDir: "Private & Shared/Home", targetType: "base" },
      { targetPath: "Untitled [2bf29f77].base", relativeDir: "Elsewhere", targetType: "base" }
    ]);

    expect(result.status).toBe("matched");
    expect(result.target.targetPath).toBe("Untitled [1af19f66].base");
  });

  test("prefers candidate whose directory basename matches the note basename", () => {
    const result = selectBest("Trips/place-1.md", [
      { targetPath: "Schedule_Index.md", relativeDir: "Trips/place-1", targetType: "index" },
      { targetPath: "Schedule_Index 2.md", relativeDir: "Trips/place-2", targetType: "index" }
    ]);

    expect(result.status).toBe("matched");
    expect(result.target.targetPath).toBe("Schedule_Index.md");
  });

  test("keeps plain link when same-rank same-distance candidates tie", () => {
    const result = selectBest("Private & Shared/Personal Home/Career/store.md", [
      { targetPath: "Untitled [1af19f66].base", relativeDir: "Private & Shared/Personal Home/Career/store", targetType: "base" },
      { targetPath: "Untitled [2bf29f77].base", relativeDir: "Private & Shared/Personal Home/Career/store", targetType: "base" }
    ]);

    expect(result.status).toBe("ambiguous");
  });
});

describe("bases mode output", () => {
  test("processCsvDatabases resolves CSV properties and output names", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir } = await import("node:fs/promises");
    const { processCsvDatabases } = await import("./src/lib/csv.js");

    const dir = join(process.cwd(), "test_bases_matched");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    // Create CSV with Notion ID
    await Bun.write(join(dir, "Tasks 1234567890abcdef1234567890abcdef_all.csv"),
      "Name,Status\nPage A,Open\nPage B,Closed\n");

    const csvFiles = await processCsvDatabases(dir);
    expect(csvFiles.length).toBe(1);
    expect(csvFiles[0].databaseName).toBe("Tasks");
    expect(csvFiles[0].notionObjectId).toBe("1234567890abcdef1234567890abcdef");
    expect(csvFiles[0].resolvedBaseFileName).toBe("Tasks.base");
    expect(csvFiles[0].resolvedRootIndexFileName).toBe("Tasks_Index.md");

    await rm(dir, { recursive: true, force: true });
  });

  test("processCsvDatabases extracts correct notionObjectId for _all variant", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir } = await import("node:fs/promises");
    const { processCsvDatabases } = await import("./src/lib/csv.js");

    const dir = join(process.cwd(), "test_bases_notionid");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    await Bun.write(join(dir, "Projects 8e36195ae5da463fa49c05c963c8433b_all.csv"),
      "Name,Status\nProject 1,Open\n");

    const csvFiles = await processCsvDatabases(dir);
    expect(csvFiles.length).toBe(1);
    expect(csvFiles[0].databaseName).toBe("Projects");
    expect(csvFiles[0].notionObjectId).toBe("8e36195ae5da463fa49c05c963c8433b");
    expect(csvFiles[0].relativeDir).toBe(".");

    await rm(dir, { recursive: true, force: true });
  });

  test("should return null for filename without Notion ID", () => {
    expect(extractNotionId("Regular File.md")).toBe(null);
  });
});

describe('extractDatabaseProperties - emoji-prefixed property keys', () => {
  test('captures 🛒 Shop Listing with backlink value', () => {
    const lines = [
      '# Blue Dragon Figurine \u20143D Printed Display Stand',
      '',
      'Tags: ACG, cosplay',
      'License: Open',
      '\ud83d\uded2 Shop Listing: @Blue Dragon Figurine \u20143D Printed Display Stand  (../../../../Product%20Catalog/Blue%20Dragon%20Figurine%20%E2%80%943D%20Printed%20Display%20Stand%20face0000000000000000000000000001.md)',
      '',
      '\ud83c\udf80 Step into the world of espionage',
    ];
    const result = extractDatabaseProperties(lines);
    expect(result.properties.tags).toEqual(['ACG', 'cosplay']);
    expect(result.properties.license).toBe('Open');
    expect(result.properties['shop-listing']).toContain('.md)');
  });

  test('captures 📝 Day Log Table property', () => {
    const lines = [
      '# Task Name',
      '',
      'Status: Done',
      '\ud83d\udcdd Day Log Table: some value',
      '',
      'Body content here',
    ];
    const result = extractDatabaseProperties(lines);
    expect(result.properties.status).toBe('Done');
    expect(result.properties['day-log-table']).toBe('some value');
  });

  test('captures Chinese-starting property keys', () => {
    const lines = [
      '# Movie',
      '',
      '\u5bfc\u6f14: \u674e\u5b89',
      '',
      'Content',
    ];
    const result = extractDatabaseProperties(lines);
    expect(result.properties['\u5bfc\u6f14']).toBe('\u674e\u5b89');
  });

  test('does not match bullet lines as properties', () => {
    const lines = [
      '# Title',
      '',
      'Status: Active',
      '',
      '\u2022 Area Specifications',
      '\u2022 Bathrooms',
    ];
    const result = extractDatabaseProperties(lines);
    expect(result.properties.status).toBe('Active');
    expect(result.properties).not.toHaveProperty('area-specifications');
  });

  test('strips emoji from frontmatter key, no leading hyphen', () => {
    const lines = [
      '# Title',
      '',
      '\ud83d\udcb5 Rehoming fee: $100',
      '\u2728 Features: sparkly',
      '',
      'Content',
    ];
    const result = extractDatabaseProperties(lines);
    expect(result.properties['rehoming-fee']).toBe('$100');
    expect(result.properties['features']).toBe('sparkly');
    expect(result.properties).not.toHaveProperty('-rehoming-fee');
    expect(result.properties).not.toHaveProperty('-features');
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

describe("CSV object ID marker in link conversion", () => {
  test("convertMarkdownLinkToWiki adds object ID marker for md link with Notion ID", async () => {
    const { convertMarkdownLinkToWiki } = await import("./src/lib/links.js");

    const result = convertMarkdownLinkToWiki(
      "[Untitled](topic/Untitled%2011111111111111111111111111111111.md)",
      new Map(),
      "/some/path/topic.md",
      "/some/path"
    );
    expect(result).toBe("[[Untitled|__MD_11111111111111111111111111111111__]]");
  });

  test("convertMarkdownLinkToWiki adds object ID marker for empty-label md link with Notion ID", async () => {
    const { convertMarkdownLinkToWiki } = await import("./src/lib/links.js");

    const result = convertMarkdownLinkToWiki(
      "[](topic/Untitled%2011111111111111111111111111111111.md)",
      new Map(),
      "/some/path/topic.md",
      "/some/path"
    );
    expect(result).toBe("[[Untitled|__MD_11111111111111111111111111111111__]]");
  });

  test("convertMarkdownLinkToWiki preserves anchor in md marker for Notion ID links", async () => {
    const { convertMarkdownLinkToWiki } = await import("./src/lib/links.js");
    const encodedAnchor = Buffer.from("section heading", "utf8").toString("base64url");

    const result = convertMarkdownLinkToWiki(
      "[Untitled](topic/Untitled%2011111111111111111111111111111111.md#section%20heading)",
      new Map(),
      "/some/path/topic.md",
      "/some/path"
    );
    expect(result).toBe(`[[Untitled|__MD_11111111111111111111111111111111__~${encodedAnchor}]]`);
  });

  test("convertMarkdownLinkToWiki adds object ID marker for CSV with Notion ID", async () => {
    const { convertMarkdownLinkToWiki } = await import("./src/lib/links.js");
    
    const result = convertMarkdownLinkToWiki(
      "[Tasks](Tasks%20cb4727700fdf467784b57df8b3d71cc7_all.csv)",
      new Map(),
      "/some/path/note.md",
      "/some/path"
    );
    expect(result).toBe("[[Tasks|__CSV_cb4727700fdf467784b57df8b3d71cc7__]]");
  });

  test("convertMarkdownLinkToWiki encodes intended relative dir for CSV marker when baseDir is known", async () => {
    const { convertMarkdownLinkToWiki } = await import("./src/lib/links.js");

    const result = convertMarkdownLinkToWiki(
      "[Schedule](Trip%20A/Schedule%20aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.csv)",
      new Map(),
      "/vault/Trips/Trip A.md",
      "/vault"
    );
    const expectedDir = Buffer.from("Trips/Trip A", "utf8").toString("base64url");
    expect(result).toBe(`[[Schedule|__CSV_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa__~${expectedDir}]]`);
  });

  test("convertMarkdownLinkToWiki preserves plain wikilink for CSV without Notion ID", async () => {
    const { convertMarkdownLinkToWiki } = await import("./src/lib/links.js");
    
    const result = convertMarkdownLinkToWiki(
      "[Tasks](Tasks.csv)",
      new Map(),
      "/some/path/note.md"
    );
    expect(result).toBe("[[Tasks]]");
    expect(result).not.toContain("__CSV_");
  });
});

describe("row-directory scoring guards", () => {
  test("heading and frontmatter title should only contribute one match per file", () => {
    const rowTitleSet = new Set(["legittasktitle"]);
    const entry = {
      normalizedBase: "otherfile",
      normalizedCleaned: "otherfile",
      heading: "Legit task title",
      frontmatterTitle: "Legit task title"
    };

    let matchCount = 0;
    let entryMatched = false;

    if (rowTitleSet.has(entry.normalizedBase) || rowTitleSet.has(entry.normalizedCleaned)) {
      entryMatched = true;
    }

    if (!entryMatched && entry.heading) {
      const normalizedHeading = normalizeTitle(entry.heading);
      if (normalizedHeading && rowTitleSet.has(normalizedHeading)) {
        entryMatched = true;
      }
    }

    if (!entryMatched && entry.frontmatterTitle) {
      const normalizedFmTitle = normalizeTitle(entry.frontmatterTitle);
      if (normalizedFmTitle && rowTitleSet.has(normalizedFmTitle)) {
        entryMatched = true;
      }
    }

    if (entryMatched) {
      matchCount++;
    }

    expect(matchCount).toBe(1);
  });
});

describe("CLI argument parsing", () => {
  test("parseArgs enables inferMetadata for --infer-metadata", async () => {
    const originalArgv = process.argv;
    process.argv = ["bun", "notion2obsidian", "./Export.zip", "--infer-metadata"];

    try {
      const { parseArgs } = await import("./src/lib/cli.js");
      const config = parseArgs();
      expect(config.inferMetadata).toBe(true);
    } finally {
      process.argv = originalArgv;
    }
  });
});

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

  test("should escape backslashes in quoted YAML frontmatter values", () => {
    const metadata = {
      title: "Bracket Links",
      status: "[[\\[tv\\] Series Pilot 01|[tv] Series Pilot 01]]"
    };

    const frontmatter = generateValidFrontmatter(metadata, ".");
    expect(validateFrontmatter(frontmatter)).toBe(true);
    expect(frontmatter).not.toContain('status: "[[\\[tv\\] Series Pilot 01|[tv] Series Pilot 01]]"');
  });
});

describe("Database Index Generation", () => {
  function generateDatabaseIndex(csvInfo) {
    const { databaseName, header, rows } = csvInfo;
    const relativeCsvPath = `${databaseName}.csv`;

    let markdown = `# ${databaseName}\n\n`;
    markdown += `Database with ${rows.length} records.\n\n`;
    markdown += `**CSV File:** [[${relativeCsvPath}|Open in spreadsheet app]]\n\n`;
    markdown += `## All Records\n\n`;
    markdown += '```dataview\n';
    markdown += 'TABLE WITHOUT ID ';
    const displayColumns = header.slice(0, 5);
    markdown += displayColumns.join(', ') + '\n';
    markdown += `FROM csv("${relativeCsvPath}")\n`;
    markdown += '```\n\n';

    return markdown;
  }

  test("should generate Dataview index with CSV link", () => {
    const csvInfo = {
      databaseName: "Tasks",
      header: ["Task name", "Status", "Assignee", "Due", "Priority", "Summary"],
      rows: [
        ["Task 1", "Done", "John", "2024-01-01", "High", "Description"],
        ["Task 2", "In Progress", "Jane", "2024-01-15", "Medium", "Description"]
      ]
    };

    const index = generateDatabaseIndex(csvInfo);

    expect(index).toContain("# Tasks");
    expect(index).toContain("Database with 2 records");
    expect(index).toContain("**CSV File:** [[Tasks.csv|Open in spreadsheet app]]");
    expect(index).toContain("```dataview");
    expect(index).toContain('TABLE WITHOUT ID Task name, Status, Assignee, Due, Priority');
    expect(index).toContain('FROM csv("Tasks.csv")');
  });

  test("should handle long header lists", () => {
    const csvInfo = {
      databaseName: "Projects",
      header: ["Name", "Status", "Owner", "Due Date", "Priority", "Tags", "Notes", "Progress"],
      rows: [["Project 1", "Active", "Alice", "2024-12-31", "High", "work", "Notes", "50%"]]
    };

    const index = generateDatabaseIndex(csvInfo);

    // Should only show first 5 columns
    expect(index).toContain('TABLE WITHOUT ID Name, Status, Owner, Due Date, Priority');
    expect(index).not.toContain('Tags, Notes, Progress');
  });

  test("should handle empty databases", () => {
    const csvInfo = {
      databaseName: "Empty Database",
      header: ["Column1", "Column2"],
      rows: []
    };

    const index = generateDatabaseIndex(csvInfo);

    expect(index).toContain("Database with 0 records");
    expect(index).toContain("```dataview");
  });
});

describe("SQL Seal Index Generation", () => {
  function generateSqlSealIndex(csvInfo) {
    const { databaseName, header, rows } = csvInfo;
    const relativeCsvPath = `${databaseName}.csv`;

    // Create SQL-safe table name (lowercase, underscores, no spaces)
    const tableName = databaseName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    let markdown = `# ${databaseName}\n\n`;
    markdown += `Database with ${rows.length} records.\n\n`;
    markdown += `**CSV File:** [[${relativeCsvPath}|Open in spreadsheet app]]\n\n`;
    markdown += `## All Records\n\n`;
    markdown += '```sqlseal\n';
    markdown += `TABLE ${tableName} = file("${relativeCsvPath}")\n\n`;

    const displayColumns = header.slice(0, 5);
    markdown += `SELECT ${displayColumns.join(', ')}\n`;
    markdown += `FROM ${tableName}\n`;
    markdown += '```\n\n';

    // Add example queries section
    markdown += `## Example Queries\n\n`;
    markdown += '```sqlseal\n';
    markdown += `-- Filter records\n`;
    markdown += `SELECT * FROM ${tableName}\n`;
    markdown += `WHERE ${displayColumns[0]} LIKE '%search%'\n\n`;
    markdown += `-- Sort by column\n`;
    markdown += `SELECT * FROM ${tableName}\n`;
    markdown += `ORDER BY ${displayColumns[0]} ASC\n\n`;
    markdown += `-- Count records\n`;
    markdown += `SELECT COUNT(*) as total FROM ${tableName}\n`;
    markdown += '```\n\n';

    return markdown;
  }

  test("should generate SQL Seal index with CSV link", () => {
    const csvInfo = {
      databaseName: "Tasks",
      header: ["Task name", "Status", "Assignee", "Due", "Priority", "Summary"],
      rows: [
        ["Task 1", "Done", "John", "2024-01-01", "High", "Description"],
        ["Task 2", "In Progress", "Jane", "2024-01-15", "Medium", "Description"]
      ]
    };

    const index = generateSqlSealIndex(csvInfo);

    expect(index).toContain("# Tasks");
    expect(index).toContain("Database with 2 records");
    expect(index).toContain("**CSV File:** [[Tasks.csv|Open in spreadsheet app]]");
    expect(index).toContain("```sqlseal");
    expect(index).toContain('TABLE tasks = file("Tasks.csv")');
    expect(index).toContain('SELECT Task name, Status, Assignee, Due, Priority');
    expect(index).toContain('FROM tasks');
  });

  test("should sanitize table names for SQL", () => {
    const csvInfo = {
      databaseName: "My Tasks & Projects",
      header: ["Name", "Status"],
      rows: [["Task 1", "Done"]]
    };

    const index = generateSqlSealIndex(csvInfo);

    expect(index).toContain('TABLE my_tasks_projects = file("My Tasks & Projects.csv")');
    expect(index).toContain('FROM my_tasks_projects');
  });

  test("should handle database names with special characters", () => {
    const csvInfo = {
      databaseName: "Tasks-2024 (Draft)",
      header: ["Name"],
      rows: []
    };

    const index = generateSqlSealIndex(csvInfo);

    // Should convert to lowercase with underscores
    expect(index).toContain('TABLE tasks_2024_draft = file("Tasks-2024 (Draft).csv")');
    expect(index).toContain('FROM tasks_2024_draft');
  });

  test("should include example queries", () => {
    const csvInfo = {
      databaseName: "Projects",
      header: ["Name", "Status", "Owner"],
      rows: [["Project 1", "Active", "Alice"]]
    };

    const index = generateSqlSealIndex(csvInfo);

    expect(index).toContain("## Example Queries");
    expect(index).toContain("-- Filter records");
    expect(index).toContain("WHERE Name LIKE '%search%'");
    expect(index).toContain("-- Sort by column");
    expect(index).toContain("ORDER BY Name ASC");
    expect(index).toContain("-- Count records");
    expect(index).toContain("SELECT COUNT(*) as total");
  });

  test("should handle long header lists", () => {
    const csvInfo = {
      databaseName: "Projects",
      header: ["Name", "Status", "Owner", "Due Date", "Priority", "Tags", "Notes", "Progress"],
      rows: [["Project 1", "Active", "Alice", "2024-12-31", "High", "work", "Notes", "50%"]]
    };

    const index = generateSqlSealIndex(csvInfo);

    // Should only show first 5 columns
    expect(index).toContain('SELECT Name, Status, Owner, Due Date, Priority');
    expect(index).not.toContain('Tags');
    expect(index).not.toContain('Progress');
  });

  test("should handle empty databases", () => {
    const csvInfo = {
      databaseName: "Empty Database",
      header: ["Column1", "Column2"],
      rows: []
    };

    const index = generateSqlSealIndex(csvInfo);

    expect(index).toContain("Database with 0 records");
    expect(index).toContain("```sqlseal");
    expect(index).toContain('TABLE empty_database = file("Empty Database.csv")');
  });
});

describe("File Naming Collision Resolution", () => {
  function resolveNamingCollision(baseName, ext, isDirectoryConflict) {
    if (isDirectoryConflict) {
      return `${baseName} Overview${ext}`;
    }
    return `${baseName}-1${ext}`;
  }

  test("should add Overview suffix when directory exists with same name", () => {
    const result = resolveNamingCollision("odara com au", ".md", true);
    expect(result).toBe("odara com au Overview.md");
  });

  test("should add -1 suffix when file exists with same name", () => {
    const result = resolveNamingCollision("Document", ".md", false);
    expect(result).toBe("Document-1.md");
  });

  test("should handle different extensions", () => {
    expect(resolveNamingCollision("Home", ".md", true)).toBe("Home Overview.md");
    expect(resolveNamingCollision("Image", ".png", true)).toBe("Image Overview.png");
  });

  test("should preserve spaces in names", () => {
    const result = resolveNamingCollision("My Project Notes", ".md", true);
    expect(result).toBe("My Project Notes Overview.md");
  });
});

describe("CSV File Consolidation", () => {
  function shouldKeepCsvFile(filename) {
    // Keep only _all.csv files or files without _all suffix
    return filename.endsWith("_all.csv") || !filename.includes("_all");
  }

  function getCleanCsvName(filename) {
    // Remove Notion IDs and _all suffix
    return filename
      .replace(/\s[0-9a-fA-F]{32}(_all)?\.csv$/, '.csv')
      .replace(/_all\.csv$/, '.csv');
  }

  test("should prefer _all.csv files", () => {
    expect(shouldKeepCsvFile("Tasks abc123_all.csv")).toBe(true);
    expect(shouldKeepCsvFile("Tasks abc123.csv")).toBe(true);
  });

  test("should clean CSV filenames", () => {
    expect(getCleanCsvName("Tasks abc123def456789012345678901234ab_all.csv")).toBe("Tasks.csv");
    expect(getCleanCsvName("Tasks abc123def456789012345678901234ab.csv")).toBe("Tasks.csv");
    expect(getCleanCsvName("Odara - pages 22d801a180b548f0a1536b1a9d172dde_all.csv"))
      .toBe("Odara - pages.csv");
  });

  test("should handle names without Notion IDs", () => {
    expect(getCleanCsvName("database_all.csv")).toBe("database.csv");
    expect(getCleanCsvName("simple.csv")).toBe("simple.csv");
  });
});

describe("Database Folder Organization", () => {
  function shouldMoveToDataFolder(filename) {
    return filename.endsWith('.md');
  }

  function getDataFolderPath(dbName) {
    return `${dbName}/_data`;
  }

  test("should identify MD files for _data folder", () => {
    expect(shouldMoveToDataFolder("page.md")).toBe(true);
    expect(shouldMoveToDataFolder("About.md")).toBe(true);
    expect(shouldMoveToDataFolder("Privacy policy.md")).toBe(true);
  });

  test("should not move non-MD files", () => {
    expect(shouldMoveToDataFolder("data.csv")).toBe(false);
    expect(shouldMoveToDataFolder("image.png")).toBe(false);
    expect(shouldMoveToDataFolder("document.pdf")).toBe(false);
  });

  test("should generate correct _data folder paths", () => {
    expect(getDataFolderPath("Tasks")).toBe("Tasks/_data");
    expect(getDataFolderPath("Odara - pages")).toBe("Odara - pages/_data");
    expect(getDataFolderPath("Projects")).toBe("Projects/_data");
  });
});

// ============================================================================
// Bug Fix Tests — Inline Metadata Extraction with matchedIndices
// ============================================================================

import { extractInlineMetadataFromLines } from "./src/lib/frontmatter.js";
import { processFileContent } from "./src/lib/frontmatter.js";

describe("extractInlineMetadataFromLines returns matchedIndices", () => {
  test("should return metadata and matched line indices", () => {
    const lines = ["# Title", "Status: Done", "Priority: High", "Some body text"];
    const { metadata, matchedIndices } = extractInlineMetadataFromLines(lines);

    expect(metadata.status).toBe("Done");
    expect(metadata.priority).toBe("High");
    expect(matchedIndices.has(1)).toBe(true);
    expect(matchedIndices.has(2)).toBe(true);
    expect(matchedIndices.has(0)).toBe(false);
    expect(matchedIndices.has(3)).toBe(false);
  });

  test("should return empty matchedIndices when no properties found", () => {
    const lines = ["# Title", "Just content", "More content"];
    const { metadata, matchedIndices } = extractInlineMetadataFromLines(lines);

    expect(Object.keys(metadata).length).toBe(0);
    expect(matchedIndices.size).toBe(0);
  });

  test("should not infer generic Key: Value properties by default", () => {
    const lines = ["Turtle Type: Snapping", "Color: Green"];
    const { metadata, matchedIndices } = extractInlineMetadataFromLines(lines);

    expect(metadata["turtle-type"]).toBeUndefined();
    expect(metadata.color).toBeUndefined();
    expect(matchedIndices.size).toBe(0);
  });

  test("should infer generic Key: Value properties when enabled", () => {
    const lines = ["Turtle Type: Snapping", "Color: Green"];
    const { metadata, matchedIndices } = extractInlineMetadataFromLines(lines, { inferMetadata: true });

    expect(metadata["turtle-type"]).toBe("Snapping");
    expect(metadata.color).toBe("Green");
    expect(matchedIndices.size).toBe(2);
  });

  test("should infer property keys with parentheses when enabled", () => {
    const lines = ["Height (cm): 180", "Weight(kg): 75", "Waist (in): 30"];
    const { metadata, matchedIndices } = extractInlineMetadataFromLines(lines, { inferMetadata: true });

    expect(metadata["height-cm"]).toBe("180");
    expect(metadata["weightkg"]).toBe("75");
    expect(metadata["waist-in"]).toBe("30");
    expect(matchedIndices.size).toBe(3);
  });

  test("should split comma-separated tags into array when inference is enabled", () => {
    const lines = ["Tags: Coding, Design, Testing"];
    const { metadata, matchedIndices } = extractInlineMetadataFromLines(lines, { inferMetadata: true });

    expect(Array.isArray(metadata.tags)).toBe(true);
    expect(metadata.tags).toEqual(["Coding", "Design", "Testing"]);
    expect(matchedIndices.size).toBe(1);
  });

  test("should handle single tag value without splitting when inference is enabled", () => {
    const lines = ["Tags: Coding"];
    const { metadata } = extractInlineMetadataFromLines(lines, { inferMetadata: true });

    expect(Array.isArray(metadata.tags)).toBe(true);
    expect(metadata.tags).toEqual(["Coding"]);
  });

  test("should still extract recognized inline metadata keys by default", () => {
    const lines = ["Status: Done", "Summary: Ship it"];
    const { metadata, matchedIndices } = extractInlineMetadataFromLines(lines);

    expect(metadata.status).toBe("Done");
    expect(metadata.summary).toBe("Ship it");
    expect(matchedIndices.size).toBe(2);
  });
});

// ============================================================================
// Bug Fix Tests — Database Property Extraction with Parentheses
// ============================================================================

import { extractDatabaseProperties } from "./src/lib/frontmatter.js";

describe("extractDatabaseProperties handles parenthesized keys", () => {
  test("should extract properties with parentheses in key names", () => {
    const lines = [
      "# Test Subject",
      "Height (cm): 180",
      "Weight(kg): 75",
      "BMI: 22",
      "Waist (in): 30",
      "Hip (in): 35",
      "",
      "Some body content"
    ];
    const { properties, remainingLines } = extractDatabaseProperties(lines);

    expect(properties["height-cm"]).toBe("180");
    expect(properties["weightkg"]).toBe("75");
    expect(properties["bmi"]).toBe("22");
    expect(properties["waist-in"]).toBe("30");
    expect(properties["hip-in"]).toBe("35");
    expect(remainingLines.some(l => l.includes("Height (cm)"))).toBe(false);
    expect(remainingLines.some(l => l.includes("Some body content"))).toBe(true);
  });

  test("should split comma-separated tags in database properties", () => {
    const lines = [
      "# Page Title",
      "Tags: Coding, Design",
      "Status: Active",
    ];
    const { properties } = extractDatabaseProperties(lines);

    expect(Array.isArray(properties.tags)).toBe(true);
    expect(properties.tags).toEqual(["Coding", "Design"]);
    expect(properties.status).toBe("Active");
  });
});

// ============================================================================
// Bug Fix Tests — CSV Duplicate Page Prevention (normalizeTitle + skeletonsMatch)
// ============================================================================

import { normalizeTitle, skeletonsMatch, convertRelationToWikilink, stripImagePlaceholders, stripNotionUrlFromTitle, enrichMdWithCsvProperties, generateMissingMdFromCsv, processCsvDatabases, findBasesReconciliationIssues } from "./src/lib/csv.js";

describe("normalizeTitle skeleton dedup", () => {
  test("colon sanitization: space vs hyphen (8 00PM ↔ 8:00PM)", () => {
    expect(normalizeTitle("8 00PM Symphony")).toBe(normalizeTitle("8-00PM Symphony"));
    expect(normalizeTitle("8 00PM Symphony")).toBe(normalizeTitle("8:00PM Symphony"));
  });

  test("dot sanitization: dot vs space (2.0 ↔ 2 0)", () => {
    expect(normalizeTitle("文件版本2.0 修改")).toBe(normalizeTitle("文件版本2 0 修改"));
    expect(normalizeTitle("物流服务优惠至9.30")).toBe(normalizeTitle("物流服务优惠至9 30"));
  });

  test("@mention stripping: @Lapidary ↔ Lapidary (notion-url)", () => {
    const fromFile = normalizeTitle("open shop @Lapidary Hub");
    const fromCsv = normalizeTitle("open shop Lapidary Hub (https---www.notion.so-face0000000000000000000000000003-pvs=21)");
    expect(fromFile).toBe(fromCsv);
  });

  test("@mention with Notion link: @Spool ↔ Spool (notion-url)", () => {
    const fromFile = normalizeTitle("3d app @Spool Logger");
    const fromCsv = normalizeTitle("3d app Spool Logger (https---www.notion.so-face0000000000000000000000000004-pvs=21)");
    expect(fromFile).toBe(fromCsv);
  });

  test("mailto prefix stripping: mailto-email ↔ email", () => {
    expect(normalizeTitle("Email to mailto-redacted@example.test")).toBe(normalizeTitle("Email to redacted@example.test"));
    expect(normalizeTitle("Email to mailto:redacted@example.test")).toBe(normalizeTitle("Email to redacted@example.test"));
  });

  test("standard Notion URL stripping", () => {
    expect(normalizeTitle("Page (https://www.notion.so/workspace/page-abc123)")).toBe("page");
  });

  test("clean titles: only lowercased and stripped of non-alnum", () => {
    expect(normalizeTitle("Simple Title")).toBe("simpletitle");
  });

  test("Arabic titles produce non-empty skeletons", () => {
    expect(normalizeTitle("تقرير يومي")).not.toBe("");
    expect(normalizeTitle("تقرير يومي")).toBe("تقريريومي");
  });

  test("Hebrew titles produce non-empty skeletons", () => {
    expect(normalizeTitle("דוח יומי")).not.toBe("");
  });

  test("Greek titles produce non-empty skeletons", () => {
    expect(normalizeTitle("Ελληνικά")).not.toBe("");
  });

  test("Thai titles produce non-empty skeletons", () => {
    expect(normalizeTitle("รายงาน")).not.toBe("");
  });

  test("mixed script titles preserve all scripts", () => {
    const result = normalizeTitle("Report 报告 تقرير");
    expect(result).toContain("report");
    expect(result).toContain("报告");
    expect(result).toContain("تقرير");
  });
});

describe("skeletonsMatch with truncation", () => {
  test("exact match", () => {
    expect(skeletonsMatch("abc", "abc")).toBe(true);
  });

  test("no match for different strings", () => {
    expect(skeletonsMatch("abc", "xyz")).toBe(false);
  });

  test("prefix match with ≥40 skeleton chars", () => {
    const truncated = normalizeTitle("Email shipping update to redacteduser@example t");
    const full = normalizeTitle("Email shipping update to mailto-redacteduser@example.test");
    expect(skeletonsMatch(truncated, full)).toBe(true);
  });

  test("no prefix match with <40 skeleton chars", () => {
    expect(skeletonsMatch("shortbutstillunder40", "shortbutstillunder40xyz")).toBe(false);
  });

  test("prefix match is bidirectional", () => {
    const a = "a]bcdefghijklmnopqrstuvwxyz1234567890abcdefghij";
    const b = "abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnop";
    const skelA = normalizeTitle(a);
    const skelB = normalizeTitle(b);
    expect(skeletonsMatch(skelA, skelB)).toBe(true);
    expect(skeletonsMatch(skelB, skelA)).toBe(true);
  });
});

// ============================================================================
// Bug Fix Tests — Property Value Link Conversion
// ============================================================================

import { convertPropertyValueLinks, convertPropertyRelations, convertBacklinksProperty, convertMarkdownLinkToWiki } from "./src/lib/links.js";

describe("convertPropertyValueLinks", () => {
  test("should convert parenthesized Notion link to wikilink", () => {
    const input = "My Document (../../../Category/Sub%20Folder/My%20Document%203d59f31f785b4040906f39f3d66abade.md)";
    const result = convertPropertyValueLinks(input);
    expect(result).toBe("[[My Document]]");
  });

  test("should leave regular parenthetical text unchanged", () => {
    const input = "something (not a link)";
    const result = convertPropertyValueLinks(input);
    expect(result).toBe("something (not a link)");
  });

  test("should handle URL-encoded paths", () => {
    const input = "Page Name (Test%20Page%20abc123def456789012345678901234ab.md)";
    const result = convertPropertyValueLinks(input);
    expect(result).toBe("[[Test Page]]");
  });

  test("should escape bracketed targets with alias", () => {
    const input = "[tv] Series Pilot 01 (../../../My%20Notes/Media%20Reviews/%5Btv%5D%20Series%20Pilot%2001%20face0000000000000000000000000005.md)";
    const result = convertPropertyValueLinks(input);
    expect(result).toBe("[[\\[tv\\] Series Pilot 01|[tv] Series Pilot 01]]");
  });
});

describe("convertPropertyRelations", () => {
  test("should convert comma-separated relation values", () => {
    const input = "Item A (path/Item%20A%20abc123def456789012345678901234ab.md), Item B (path/Item%20B%20def456789012345678901234ab123456.md)";
    const result = convertPropertyRelations(input);
    expect(result).toEqual(["[[Item A]]", "[[Item B]]"]);
  });

  test("should return unchanged if no .md) pattern", () => {
    const input = "Just text, more text";
    const result = convertPropertyRelations(input);
    expect(result).toBe("Just text, more text");
  });

  test("should handle multi-line bullet list backlinks", () => {
    const input = "- Page A (path/Page%20A%20abc123def456789012345678901234ab.md)\n- Page B (path/Page%20B%20def456789012345678901234ab123456.md)";
    const result = convertPropertyRelations(input);
    expect(result).toBe("- [[Page A]]\n- [[Page B]]");
  });

  test("should separate adjacent wikilinks in single-line property values", () => {
    const input = "A (path/A%20abc123def456789012345678901234ab.md)B (path/B%20def456789012345678901234ab123456.md)";
    const result = convertPropertyRelations(input);
    expect(result).toEqual(["[[A]]", "[[B]]"]);
  });

  test("should return YAML-list-friendly array for three relation links", () => {
    const input = "A (path/A%20abc123def456789012345678901234ab.md), B (path/B%20def456789012345678901234ab123456.md), C (path/C%20fedcba98765432100123456789abcdef.md)";
    const result = convertPropertyRelations(input);
    expect(result).toEqual(["[[A]]", "[[B]]", "[[C]]"]);
  });
});

describe("convertBacklinksProperty", () => {
  test("should convert multi-line bullet list to wikilinks and body lines", () => {
    const input = "- AI Generated Design (../../My%20Notes/Design/AI%20Generated%20Design%20face0000000000000000000000000008.md)\n- Test Print Pouch Honeycomb (Test%20Print%20Pouch%20Honeycomb%20face0000000000000000000000000009.md)";
    const result = convertBacklinksProperty(input);
    expect(result.wikilinks).toEqual(["[[AI Generated Design]]", "[[Test Print Pouch Honeycomb]]"]);
    expect(result.bodyLines).toEqual(["- [[AI Generated Design]]", "- [[Test Print Pouch Honeycomb]]"]);
    expect(result.converted).toBe("- [[AI Generated Design]]\n- [[Test Print Pouch Honeycomb]]");
  });

  test("should handle single backlink value", () => {
    const input = "Complete the 90 hours (Complete%20the%2090%20hours%20face0000000000000000000000000010.md)";
    const result = convertBacklinksProperty(input);
    expect(result.wikilinks).toEqual(["[[Complete the 90 hours]]"]);
    expect(result.bodyLines).toEqual(["- [[Complete the 90 hours]]"]);
    expect(result.converted).toBe("[[Complete the 90 hours]]");
  });

  test("should handle comma-separated backlinks", () => {
    const input = "Page A (path/Page%20A%20abc123def456789012345678901234ab.md), Page B (path/Page%20B%20def456789012345678901234ab123456.md)";
    const result = convertBacklinksProperty(input);
    expect(result.wikilinks).toEqual(["[[Page A]]", "[[Page B]]"]);
    expect(result.bodyLines).toEqual(["- [[Page A]]", "- [[Page B]]"]);
  });

  test("should return empty arrays for non-backlink value", () => {
    const input = "Just some regular text";
    const result = convertBacklinksProperty(input);
    expect(result.wikilinks).toEqual([]);
    expect(result.bodyLines).toEqual([]);
    expect(result.converted).toBe("Just some regular text");
  });

  test("should handle null/undefined input", () => {
    expect(convertBacklinksProperty(null).wikilinks).toEqual([]);
    expect(convertBacklinksProperty(undefined).wikilinks).toEqual([]);
    expect(convertBacklinksProperty("").wikilinks).toEqual([]);
  });

  test("should handle mixed backlinks and plain text in bullet list", () => {
    const input = "- Page A (path/Page%20A%20abc123def456789012345678901234ab.md)\n- plain text without link\n- Page B (path/Page%20B%20def456789012345678901234ab123456.md)";
    const result = convertBacklinksProperty(input);
    expect(result.wikilinks).toEqual(["[[Page A]]", "[[Page B]]"]);
    expect(result.bodyLines).toEqual(["- [[Page A]]", "- plain text without link", "- [[Page B]]"]);
  });

  test("should handle relative paths with ../", () => {
    const input = "- Page (../../folder/Sub%20Folder/Page%20abc123def456789012345678901234ab.md)";
    const result = convertBacklinksProperty(input);
    expect(result.wikilinks).toEqual(["[[Page]]"]);
  });

  test("should normalize * bullets to - bullets", () => {
    const input = "* Page A (path/Page%20A%20abc123def456789012345678901234ab.md)\n* Page B (path/Page%20B%20def456789012345678901234ab123456.md)";
    const result = convertBacklinksProperty(input);
    expect(result.bodyLines).toEqual(["- [[Page A]]", "- [[Page B]]"]);
  });
});

// ============================================================================
// Bug Fix Tests — Body Link → Wikilink Conversion (all file types)
// ============================================================================

describe("convertMarkdownLinkToWiki — non-md file types", () => {
  const fileMap = new Map();

  test(".csv links use link text as target", () => {
    const result = convertMarkdownLinkToWiki("[Product Catalog](My Projects/Product Catalog.csv)", fileMap, "/root/page.md");
    expect(result).toBe("[[Product Catalog]]");
  });

  test(".csv with URL-encoded path", () => {
    const result = convertMarkdownLinkToWiki("[Medication & Substance](Medicine/Medication%20%26%20Substance.csv)", fileMap, "/root/page.md");
    expect(result).toBe("[[Medication & Substance]]");
  });

  test(".pdf converts to wikilink with cleaned filename", () => {
    const result = convertMarkdownLinkToWiki("[Karakurist 齿轮模型讲解.pdf](path/Karakurist_%E9%BD%BF%E8%BD%AE%E6%A8%A1%E5%9E%8B%E8%AE%B2%E8%A7%A3.pdf)", fileMap, "/root/page.md");
    expect(result).toBe("[[Karakurist_齿轮模型讲解.pdf|Karakurist 齿轮模型讲解.pdf]]");
  });

  test(".pdf with Notion ID in filename gets cleaned", () => {
    const result = convertMarkdownLinkToWiki("[Report.pdf](folder/Report abc123def456789012345678901234ab.pdf)", fileMap, "/root/page.md");
    expect(result).toBe("[[Report.pdf]]");
  });

  test(".png image converts to wikilink (becomes ![[]] with prefix)", () => {
    const result = convertMarkdownLinkToWiki("[image.png](folder/image.png)", fileMap, "/root/page.md");
    expect(result).toBe("[[image.png]]");
  });

  test(".jpeg image converts to wikilink", () => {
    const result = convertMarkdownLinkToWiki("[IMG_4551.jpeg](Husbandry/IMG_4551.jpeg)", fileMap, "/root/page.md");
    expect(result).toBe("[[IMG_4551.jpeg]]");
  });

  test(".jpg with Notion ID cleaned", () => {
    const result = convertMarkdownLinkToWiki("[photo.jpg](path/photo abc123def456789012345678901234ab.jpg)", fileMap, "/root/page.md");
    expect(result).toBe("[[photo.jpg]]");
  });

  test(".gif converts to wikilink", () => {
    const result = convertMarkdownLinkToWiki("[animation.gif](path/animation.gif)", fileMap, "/root/page.md");
    expect(result).toBe("[[animation.gif]]");
  });

  test(".webp converts to wikilink", () => {
    const result = convertMarkdownLinkToWiki("[photo.webp](path/photo.webp)", fileMap, "/root/page.md");
    expect(result).toBe("[[photo.webp]]");
  });

  test(".heic converts to wikilink", () => {
    const result = convertMarkdownLinkToWiki("[IMG_001.heic](path/IMG_001.heic)", fileMap, "/root/page.md");
    expect(result).toBe("[[IMG_001.heic]]");
  });

  test(".mp4 video converts to wikilink", () => {
    const result = convertMarkdownLinkToWiki("[video.mp4](path/video.mp4)", fileMap, "/root/page.md");
    expect(result).toBe("[[video.mp4]]");
  });

  test(".mov video converts to wikilink", () => {
    const result = convertMarkdownLinkToWiki("[clip.mov](path/clip.mov)", fileMap, "/root/page.md");
    expect(result).toBe("[[clip.mov]]");
  });

  test(".wav audio converts to wikilink", () => {
    const result = convertMarkdownLinkToWiki("[recording.wav](path/recording.wav)", fileMap, "/root/page.md");
    expect(result).toBe("[[recording.wav]]");
  });

  test(".m4a audio converts to wikilink", () => {
    const result = convertMarkdownLinkToWiki("[voice.m4a](path/voice.m4a)", fileMap, "/root/page.md");
    expect(result).toBe("[[voice.m4a]]");
  });

  test(".aac audio converts to wikilink", () => {
    const result = convertMarkdownLinkToWiki("[audio.aac](path/audio.aac)", fileMap, "/root/page.md");
    expect(result).toBe("[[audio.aac]]");
  });

  test(".amr audio converts to wikilink", () => {
    const result = convertMarkdownLinkToWiki("[memo.amr](path/memo.amr)", fileMap, "/root/page.md");
    expect(result).toBe("[[memo.amr]]");
  });

  test(".docx document converts to wikilink", () => {
    const result = convertMarkdownLinkToWiki("[Report.docx](path/Report.docx)", fileMap, "/root/page.md");
    expect(result).toBe("[[Report.docx]]");
  });

  test(".html converts to wikilink", () => {
    const result = convertMarkdownLinkToWiki("[page.html](path/page.html)", fileMap, "/root/page.md");
    expect(result).toBe("[[page.html]]");
  });

  test(".bin converts to wikilink", () => {
    const result = convertMarkdownLinkToWiki("[data.bin](path/data.bin)", fileMap, "/root/page.md");
    expect(result).toBe("[[data.bin]]");
  });

  test("aliased link when text differs from filename", () => {
    const result = convertMarkdownLinkToWiki("[My Report](path/TI1 - 2018.pdf)", fileMap, "/root/page.md");
    expect(result).toBe("[[TI1 - 2018.pdf|My Report]]");
  });

  test("external links still skipped", () => {
    const result = convertMarkdownLinkToWiki("[PDF](https://example.com/file.pdf)", fileMap, "/root/page.md");
    expect(result).toBe("[PDF](https://example.com/file.pdf)");
  });

  test("unknown extension falls through to old behavior", () => {
    const result = convertMarkdownLinkToWiki("[file.xyz](path/file.xyz)", fileMap, "/root/page.md");
    expect(result).toBe("[file.xyz](path/file.xyz)");
  });
});

// ============================================================================
// Bug Fix Tests — @ Mention Conversion
// ============================================================================

import { buildPageNameSet, convertAtMentions } from "./src/lib/links.js";

describe("buildPageNameSet", () => {
  test("should collect cleaned page names from fileMap", () => {
    const fileMap = new Map();
    fileMap.set("Page One abc123def456789012345678901234ab.md", {
      cleanedName: "Page One.md",
      relativePath: "."
    });
    fileMap.set("Another Page def456789012345678901234ab123456.md", {
      cleanedName: "Another Page.md",
      relativePath: "folder"
    });

    const names = buildPageNameSet(fileMap);
    expect(names.has("Page One")).toBe(true);
    expect(names.has("Another Page")).toBe(true);
    expect(names.size).toBe(2);
  });

  test("should exclude duplicate cleaned page names", () => {
    const fileMap = new Map();
    fileMap.set("Project one.md", {
      cleanedName: "Project.md",
      relativePath: "alpha"
    });
    fileMap.set("Project two.md", {
      cleanedName: "Project.md",
      relativePath: "beta"
    });

    const names = buildPageNameSet(fileMap);
    expect(names.has("Project")).toBe(false);
    expect(names.size).toBe(0);
  });
});

describe("convertAtMentions", () => {
  const pageNameSet = new Set(["Alpha Project X", "Beta Task Force", "Page One"]);

  test("should convert @PageName to [[PageName]]", () => {
    const input = "Task for @Alpha Project X";
    const result = convertAtMentions(input, pageNameSet);
    expect(result).toBe("Task for [[Alpha Project X]]");
  });

  test("should handle consecutive @ mentions", () => {
    const input = "@Alpha Project X@Beta Task Force";
    const result = convertAtMentions(input, pageNameSet);
    expect(result).toBe("[[Alpha Project X]][[Beta Task Force]]");
  });

  test("should not convert unknown @ mentions", () => {
    const input = "@UnknownPage stays as is";
    const result = convertAtMentions(input, pageNameSet);
    expect(result).toBe("@UnknownPage stays as is");
  });

  test("should not convert email addresses", () => {
    const input = "Contact redacted@example.test for details";
    const result = convertAtMentions(input, pageNameSet);
    expect(result).toBe("Contact redacted@example.test for details");
  });

  test("should return text unchanged if no @ symbol", () => {
    const input = "No mentions here";
    const result = convertAtMentions(input, pageNameSet);
    expect(result).toBe("No mentions here");
  });

  test("should prefer longest match first", () => {
    const names = new Set(["Project", "Task Force Alpha", "Special Task Force Alpha"]);
    const input = "@Special Task Force Alpha";
    const result = convertAtMentions(input, names);
    expect(result).toBe("[[Special Task Force Alpha]]");
  });

  test("should not convert duplicate-title @ mentions", () => {
    const names = new Set(["Alpha Project X"]);
    const input = "Task for @Project";
    const result = convertAtMentions(input, names);
    expect(result).toBe("Task for @Project");
  });
});

// ============================================================================
// Bug Fix Tests — Relation Wikilink Conversion & Image Placeholder Stripping
// ============================================================================

describe("convertRelationToWikilink", () => {
  test("converts single Notion URL relation to wikilink", () => {
    const input = "My Page (https://www.notion.so/abc123?pvs=21)";
    expect(convertRelationToWikilink(input)).toBe("[[My Page]]");
  });

  test("converts notion.so URL without https", () => {
    const input = "Page (notion.so/xyz789)";
    expect(convertRelationToWikilink(input)).toBe("[[Page]]");
  });

  test("converts www.notion.so URL", () => {
    const input = "Page (www.notion.so/abc123)";
    expect(convertRelationToWikilink(input)).toBe("[[Page]]");
  });

  test("converts zip-format Notion URL (https---)", () => {
    const input = "Page (https---www.notion.so-abc123-pvs=21)";
    expect(convertRelationToWikilink(input)).toBe("[[Page]]");
  });

  test("preserves plain text without Notion URLs", () => {
    expect(convertRelationToWikilink("Just plain text")).toBe("Just plain text");
  });

  test("handles empty and null values", () => {
    expect(convertRelationToWikilink("")).toBe("");
    expect(convertRelationToWikilink(null)).toBe(null);
    expect(convertRelationToWikilink(undefined)).toBe(undefined);
  });

  test("converts comma-separated Notion URL relations", () => {
    const input = "Page A (https://www.notion.so/aaa?pvs=21), Page B (www.notion.so/bbb)";
    expect(convertRelationToWikilink(input)).toEqual(["[[Page A]]", "[[Page B]]"]);
  });

  test("converts space-separated Notion URL relations", () => {
    const input = "Page A (https://www.notion.so/aaa?pvs=21) Page B (www.notion.so/bbb)";
    expect(convertRelationToWikilink(input)).toEqual(["[[Page A]]", "[[Page B]]"]);
  });

  test("converts mixed md-path relations in one line", () => {
    const input = "Action Series Alpha (../../../My%20Notes/Media%20Reviews/Action%20Series%20Alpha%20face000000000000000000000000000a.md) Tower Defense Game (../../../My%20Notes/Media%20Reviews/Tower%20Defense%20Game%20face000000000000000000000000000b.md)";
    expect(convertRelationToWikilink(input)).toEqual(["[[Action Series Alpha]]", "[[Tower Defense Game]]"]);
  });

  test("preserves interstitial text before next relation target", () => {
    const input = "Cozy Farm Game (../../../My%20Notes/Media%20Reviews/Cozy%20Farm%20Game%20face000000000000000000000000000c.md) Interstitial text here\nScience Documentary (../../../My%20Notes/Media%20Reviews/Science%20Documentary%20face000000000000000000000000000d.md)";
    expect(convertRelationToWikilink(input)).toEqual(["[[Cozy Farm Game]]", "[[Interstitial text here Science Documentary]]"]);
  });

  test("handles CJK characters in page names", () => {
    const input = "周末购物 (https://www.notion.so/face00000000001?pvs=21)";
    expect(convertRelationToWikilink(input)).toBe("[[周末购物]]");
  });

  test("escapes bracketed relation targets", () => {
    const input = "[tv] Series Pilot 01 (../../../My%20Notes/Media%20Reviews/%5Btv%5D%20Series%20Pilot%2001%20face0000000000000000000000000005.md)";
    expect(convertRelationToWikilink(input)).toBe("[[\\[tv\\] Series Pilot 01|[tv] Series Pilot 01]]");
  });
});

describe("stripImagePlaceholders", () => {
  test("strips [Image 1] on its own line", () => {
    const input = "Some text\n[Image 1]\nMore text";
    expect(stripImagePlaceholders(input)).toBe("Some text\n\nMore text");
  });

  test("strips multiple [Image N] placeholders", () => {
    const input = "Text\n[Image 1]\n[Image 2]\n[Image 3]";
    expect(stripImagePlaceholders(input)).toBe("Text");
  });

  test("strips [Image] without number", () => {
    const input = "Start\n[Image]\nEnd";
    expect(stripImagePlaceholders(input)).toBe("Start\n\nEnd");
  });

  test("handles empty and null values", () => {
    expect(stripImagePlaceholders("")).toBe("");
    expect(stripImagePlaceholders(null)).toBe(null);
    expect(stripImagePlaceholders(undefined)).toBe(undefined);
  });

  test("preserves text without image placeholders", () => {
    expect(stripImagePlaceholders("Normal description text")).toBe("Normal description text");
  });

  test("strips inline [Image N] mixed with text", () => {
    const input = "Description [Image 1] continued [Image 2]";
    expect(stripImagePlaceholders(input)).toBe("Description  continued");
  });
});

describe('normalizeTitle - skeleton normalization', () => {
  test('strips Notion URL suffixes', () => {
    const result = normalizeTitle('Geometric Wave Pendant (https---www.notion.so-abc123-pvs=4)');
    expect(result).toBe('geometricwavependant');
  });

  test('strips @ mentions', () => {
    const result = normalizeTitle('@brand design commercial license');
    expect(result).toBe('branddesigncommerciallicense');
  });

  test('strips mailto prefixes', () => {
    const result = normalizeTitle('mailto-redacted@example.test');
    expect(result).toBe('redactedexampletest');
  });

  test('preserves CJK characters', () => {
    const result = normalizeTitle('笔记 notes文档 content');
    expect(result).toBe('笔记notes文档content');
  });

  test('lowercases everything', () => {
    const result = normalizeTitle('Hello World TEST');
    expect(result).toBe('helloworldtest');
  });

  test('strips all punctuation and special chars', () => {
    const result = normalizeTitle('file-name_v2.0 (copy)');
    expect(result).toBe('filenamev20copy');
  });

  test('returns empty string for all-special input', () => {
    const result = normalizeTitle('---!!!---');
    expect(result).toBe('');
  });
});

describe('skeletonsMatch - prefix-aware matching', () => {
  test('exact match returns true', () => {
    expect(skeletonsMatch('hello', 'hello')).toBe(true);
  });

  test('different short strings return false', () => {
    expect(skeletonsMatch('hello', 'world')).toBe(false);
  });

  test('prefix match with both ≥40 chars returns true', () => {
    const shorter = 'a'.repeat(40);
    const longer = 'a'.repeat(40) + 'extra';
    expect(skeletonsMatch(shorter, longer)).toBe(true);
  });

  test('prefix match with shorter <40 chars returns false', () => {
    const shorter = 'a'.repeat(39);
    const longer = 'a'.repeat(39) + 'extra';
    expect(skeletonsMatch(shorter, longer)).toBe(false);
  });

  test('non-prefix long strings return false', () => {
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    expect(skeletonsMatch(a, b)).toBe(false);
  });

  test('handles reversed argument order', () => {
    const shorter = 'x'.repeat(40);
    const longer = 'x'.repeat(45);
    expect(skeletonsMatch(longer, shorter)).toBe(true);
  });
});

describe('extractDatabaseProperties - multi-line with non-bullet first line', () => {
  test('extracts bullets after plain text first line', () => {
    const lines = [
      '# Test Page',
      '',
      'Description: Main description text',
      '* bullet item 1',
      '* bullet item 2',
      '',
      'Some body content here',
    ];
    const result = extractDatabaseProperties(lines);
    expect(result.properties.description).toBe('Main description text\n* bullet item 1\n* bullet item 2');
  });

  test('extracts bullets after bullet first line (existing behavior)', () => {
    const lines = [
      '# Test Page',
      '',
      'Description: - first bullet',
      '- second bullet',
      '- third bullet',
      '',
      'Body content',
    ];
    const result = extractDatabaseProperties(lines);
    expect(result.properties.description).toBe('- first bullet\n- second bullet\n- third bullet');
  });

  test('extracts single value without continuation', () => {
    const lines = [
      '# Test Page',
      '',
      'Status: Active',
      'Priority: High',
      '',
      'Body content',
    ];
    const result = extractDatabaseProperties(lines);
    expect(result.properties.status).toBe('Active');
    expect(result.properties.priority).toBe('High');
  });
});

describe('extractDatabaseProperties - emoji-prefixed property keys', () => {
  test('captures 🛒 Shop Listing with backlink value', () => {
    const lines = [
      '# Blue Dragon Figurine \u20143D Printed Display Stand',
      '',
      'Tags: ACG, cosplay',
      'License: Open',
      '🛒 Shop Listing: @Blue Dragon Figurine \u20143D Printed Display Stand  (../../../../Product%20Catalog/Blue%20Dragon%20Figurine%20%E2%80%943D%20Printed%20Display%20Stand%20face0000000000000000000000000001.md)',
      '',
      '🎀 Step into the world of espionage',
    ];
    const result = extractDatabaseProperties(lines);
    expect(result.properties.tags).toEqual(['ACG', 'cosplay']);
    expect(result.properties.license).toBe('Open');
    expect(result.properties['shop-listing']).toContain('.md)');
  });

  test('captures 📝 Day Log Table property', () => {
    const lines = [
      '# Task Name',
      '',
      'Status: Done',
      '📝 Day Log Table: some value',
      '',
      'Body content here',
    ];
    const result = extractDatabaseProperties(lines);
    expect(result.properties.status).toBe('Done');
    expect(result.properties['day-log-table']).toBe('some value');
  });

  test('captures Chinese-starting property keys', () => {
    const lines = [
      '# Movie',
      '',
      '导演: 示范导演',
      '',
      'Content',
    ];
    const result = extractDatabaseProperties(lines);
    expect(result.properties['导演']).toBe('示范导演');
  });

  test('does not match bullet lines as properties', () => {
    const lines = [
      '# Title',
      '',
      'Status: Active',
      '',
      '• Area Specifications',
      '• Bathrooms',
    ];
    const result = extractDatabaseProperties(lines);
    expect(result.properties.status).toBe('Active');
    expect(result.properties).not.toHaveProperty('area-specifications');
  });

  test('strips emoji from frontmatter key, no leading hyphen', () => {
    const lines = [
      '# Title',
      '',
      '💵 Rehoming fee: $100',
      '✨ Features: sparkly',
      '',
      'Content',
    ];
    const result = extractDatabaseProperties(lines);
    expect(result.properties['rehoming-fee']).toBe('$100');
    expect(result.properties['features']).toBe('sparkly');
    expect(result.properties).not.toHaveProperty('-rehoming-fee');
    expect(result.properties).not.toHaveProperty('-features');
  });

  test('stops property parsing at blank line after property block', () => {
    const lines = [
      '# 拔除紫菜苔,草莓套袋子,浇水',
      '',
      'Date: May 29, 2023',
      'Content: 天国大魔境,鬼灭之刃,冰海战记',
      'Learning: Language',
      'Mood(1-10): 6',
      'Location: 8609_98026',
      '',
      'Cinematic Mindscapes: High-quality Video Reconstruction from Brain Activity',
    ];
    const result = extractDatabaseProperties(lines);
    expect(result.properties.date).toBe('May 29, 2023');
    expect(result.properties.content).toBe('天国大魔境,鬼灭之刃,冰海战记');
    expect(result.properties.learning).toBe('Language');
    expect(result.properties['mood1-10']).toBe('6');
    expect(result.properties.location).toBe('8609_98026');
    expect(result.properties).not.toHaveProperty('cinematic-mindscapes');
  });
});

// ============================================================================
// Bug Fix Tests — sanitizeKey, double-bracket prevention, CSV backlink conversion
// ============================================================================

import { sanitizeKey } from "./src/lib/utils.js";

describe("sanitizeKey", () => {
  test("converts emoji-prefixed property name to clean key", () => {
    expect(sanitizeKey("🛒 Shop Listing")).toBe("shop-listing");
  });

  test("strips multiple leading/trailing hyphens", () => {
    expect(sanitizeKey("✨ Features")).toBe("features");
    expect(sanitizeKey("💵 Rehoming fee")).toBe("rehoming-fee");
  });

  test("preserves Chinese characters", () => {
    expect(sanitizeKey("导演")).toBe("导演");
    expect(sanitizeKey("🎬 导演")).toBe("导演");
  });

  test("handles plain ASCII names", () => {
    expect(sanitizeKey("Status")).toBe("status");
    expect(sanitizeKey("Due Date")).toBe("due-date");
  });

  test("returns empty string for all-symbol input", () => {
    expect(sanitizeKey("###")).toBe("");
    expect(sanitizeKey("!!!")).toBe("");
  });
});

describe("convertAtMentions — double-bracket prevention", () => {
  const pageNameSet = new Set(["Blue Dragon Figurine —3D Printed Display Stand"]);

  test("should not double-wrap existing wikilinks containing @", () => {
    const input = "[[@Blue Dragon Figurine —3D Printed Display Stand]]";
    const result = convertAtMentions(input, pageNameSet);
    expect(result).toBe("[[@Blue Dragon Figurine —3D Printed Display Stand]]");
    expect(result).not.toContain("[[[[");
  });

  test("should still convert standalone @ mentions", () => {
    const input = "See @Blue Dragon Figurine —3D Printed Display Stand for details";
    const result = convertAtMentions(input, pageNameSet);
    expect(result).toBe("See [[Blue Dragon Figurine —3D Printed Display Stand]] for details");
  });

  test("should handle body with both wikilinks and @ mentions", () => {
    const names = new Set(["Page A", "Page B"]);
    const input = "Link [[Page A]] and @Page B here";
    const result = convertAtMentions(input, names);
    expect(result).toBe("Link [[Page A]] and [[Page B]] here");
  });

  test("should not wrap @ inside [[@PageName]] even when PageName matches", () => {
    const names = new Set(["Page A"]);
    const input = "[[@Page A]]";
    const result = convertAtMentions(input, names);
    expect(result).toBe("[[@Page A]]");
  });
});

describe("extractInlineMetadataFromLines — emoji property keys", () => {
  test("extracts emoji-prefixed properties with correct key format when inference is enabled", () => {
    const { metadata } = extractInlineMetadataFromLines([
      '🛒 Shop Listing: Available',
      '📝 Description: A cool item',
    ], { inferMetadata: true });
    expect(metadata['shop-listing']).toBe('Available');
    expect(metadata['description']).toBe('A cool item');
    expect(metadata).not.toHaveProperty('-shop-listing');
    expect(metadata).not.toHaveProperty('-description');
  });
});

describe("CSV backlink conversion in enrichment", () => {
  test("convertBacklinksProperty handles CSV-style backlinks", () => {
    const input = "Blue Dragon Figurine (Work%20%26%20Personal/Product%20Catalog%20abc123def456789012345678901234ab/Blue%20Dragon%20Figurine%20abc123def456789012345678901234ab.md)";
    const result = convertBacklinksProperty(input);
    expect(result.wikilinks.length).toBe(1);
    expect(result.wikilinks[0]).toBe("[[Blue Dragon Figurine]]");
  });

  test("convertBacklinksProperty converts multi-line CSV backlinks", () => {
    const input = "- Page A (folder/Page%20A%20abc123def456789012345678901234ab.md)\n- Page B (folder/Page%20B%20def456789012345678901234ab123456.md)";
    const result = convertBacklinksProperty(input);
    expect(result.wikilinks).toEqual(["[[Page A]]", "[[Page B]]"]);
  });
});

describe("enrichMdWithCsvProperties relation overwrite guard", () => {
  test("convertRelationToWikilink wraps relation in wikilink", () => {
    const input = "Blue Dragon Figurine (https---www.notion.so-face0000000000000000000000000002-pvs=4)";
    const result = convertRelationToWikilink(input);
    expect(result).toBe("[[Blue Dragon Figurine]]");
    expect(result).not.toContain("notion.so");
  });

  test("convertRelationToWikilink handles multi-line relation list", () => {
    const input = "- Item A (https---www.notion.so-aaa111222333444555666777888999000-pvs=4)\n- Item B (https---www.notion.so-bbb111222333444555666777888999000-pvs=4)";
    const result = convertRelationToWikilink(input);
    expect(result).toBe("[[Item A]]\n[[Item B]]");
  });
});

describe("generateMissingMdFromCsv Notion URL filename stripping", () => {
  test("Standard Notion URL suffix is stripped from title", () => {
    expect(stripNotionUrlFromTitle("Blue Dragon Figurine (https://www.notion.so/face0000000000000000000000000001?pvs=21)")).toBe("Blue Dragon Figurine");
  });

  test("Filename-safe Notion URL suffix is stripped from title", () => {
    expect(stripNotionUrlFromTitle("Blue Dragon Figurine (https---www.notion.so-face0000000000000000000000000002-pvs=4)")).toBe("Blue Dragon Figurine");
  });

  test("Notion URL with trailing size variant is stripped", () => {
    expect(stripNotionUrlFromTitle("Hinged Storage Box (https://www.notion.so/face0000000000000000000000000006?pvs=21) S")).toBe("Hinged Storage Box S");
  });

  test("Notion URL with trailing variant number is stripped", () => {
    expect(stripNotionUrlFromTitle("Small Catch Tray (https://www.notion.so/face0000000000000000000000000007?pvs=21)(2)")).toBe("Small Catch Tray(2)");
  });

  test("Title without Notion URL is unchanged", () => {
    expect(stripNotionUrlFromTitle("Normal Page Title")).toBe("Normal Page Title");
  });

  test("Title with parenthetical non-Notion content is preserved", () => {
    expect(stripNotionUrlFromTitle("My Page (Draft)")).toBe("My Page (Draft)");
  });
});

describe("bases mode reciprocal link regressions", () => {
  test("enrichMdWithCsvProperties matches truncated @ files via heading and writes 3d-print-model", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_enrich");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const mdPath = join(dbDir, "@Elden Ring Alexander Pot Boy - 3D Printed Key Hol.md");
    await Bun.write(
      mdPath,
      [
        "---",
        "title: \"@Elden Ring Alexander Pot Boy - 3D Printed Key Hol\"",
        "published: false",
        "---",
        "",
        "# @Elden Ring Alexander Pot Boy - 3D Printed Key Holder Desk Organizer Succulent Planter M",
        ""
      ].join("\n")
    );

    const csvInfo = {
      header: ["model", "3d print model", "Status"],
      rows: [[
        "Elden Ring Alexander Pot Boy - 3D Printed Key Holder Desk Organizer Succulent Planter M (https://www.notion.so/abcdabcdabcdabcdabcdabcdabcdabcd?pvs=21)",
        "Elden Ring Alexander Pot Boy - 3D Printed Key Holder Desk Organizer Succulent Planter (https://www.notion.so/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee?pvs=21)",
        "Copyright"
      ]]
    };

    const result = await enrichMdWithCsvProperties(csvInfo, dbDir);
    expect(result.enriched).toBe(1);

    const content = await Bun.file(mdPath).text();
    expect(content).toMatch(/3d-print-model:\s*(?:'\[\[Elden Ring Alexander Pot Boy - 3D Printed Key Holder Desk Organizer Succulent Planter\]\]'|>-\s*\n\s*\[\[Elden Ring Alexander Pot Boy - 3D Printed Key Holder Desk Organizer\s*\n\s*Succulent Planter\]\])/);
    expect(content).not.toContain("\nmodel:");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv skips model when 3d print model exists", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      header: ["model", "3d print model", "Status"],
      rows: [[
        "Anya’s Hair Clip —3D Printed Cosplay Prop (https://www.notion.so/11111111111111111111111111111111?pvs=21)",
        "Anya’s Hair Clip —3D Printed Cosplay Prop (https://www.notion.so/22222222222222222222222222222222?pvs=21)",
        "Active"
      ]],
      databaseName: "Product Catalog"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(1);

    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files.length).toBe(1);
    const content = await Bun.file(join(dbDir, files[0])).text();
    expect(content).toContain("3d-print-model");
    expect(content).toContain("[[Anya’s Hair Clip —3D Printed Cosplay Prop]]");
    expect(content).not.toContain("\nmodel:");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv skips creation when match exists globally", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_global");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["Day Log Entry", "Open"]],
      databaseName: "Home"
    };

    const globalExistingSkeletons = [normalizeTitle("Day Log Entry")];
    const created = await generateMissingMdFromCsv(csvInfo, dbDir, { globalExistingSkeletons });
    expect(created).toBe(0);

    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files.length).toBe(0);

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv does not create directory when allowCreateDir is false", async () => {
    const { join } = await import("node:path");
    const { rm, stat } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_no_mkdir");
    await rm(dbDir, { recursive: true, force: true });

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["Brand New Row", "Open"]],
      databaseName: "Home"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir, { allowCreateDir: false });
    expect(created).toBe(0);

    await expect(stat(dbDir)).rejects.toThrow();
  });

  test("generateMissingMdFromCsv strips external URL-only titles to Untitled filename", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_url_only");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["https://example.com/articles/rose-and-camellia", "Open"]],
      databaseName: "Content Reviews"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(1);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("Untitled.md");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv removes trailing external URL segment from title", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_text_plus_url");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["Product reference https://example.com/shop/item-123", "Open"]],
      databaseName: "Content Reviews"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(1);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("Product reference.md");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv strips filesafe https--- URL residue", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_filesafe_url");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["Order follow-up https---example.com-orders-abc", "Open"]],
      databaseName: "Tasks"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(1);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("Order follow-up.md");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv strips malformed https token residues", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_https_token");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["Otocinclus etsyhttps- -- profile", "Open"]],
      databaseName: "Day Log Table"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(1);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("Otocinclus etsy profile.md");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv removes @Not found tokens from generated filename", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_not_found_token");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["Geometric Wave Pendant @Not found", "Open"]],
      databaseName: "Tasks"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(1);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("Geometric Wave Pendant.md");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv removes contiguous @Not found tokens", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_not_found_attached");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["List Geometric Wave Pendant@Not found", "Open"]],
      databaseName: "Tasks"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(1);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("List Geometric Wave Pendant.md");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv normalizes leading @date mention titles", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_mention_date");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["@March 21, 2026 intense coding session", "Open"]],
      databaseName: "Day Log"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(1);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("March 21, 2026 intense coding session.md");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv removes parenthesized .md reference fragments from titles", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_md_fragment");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["Brainstorm ideas to Tasks (Tasks%20abc123def4567890.md); prototype next", "Open"]],
      databaseName: "Day Log Table"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(1);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("Brainstorm ideas to Tasks prototype next.md");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv skips punctuation-only placeholder rows", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_degenerate_title");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["/", "Open"]],
      databaseName: "Untitled"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(0);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files.length).toBe(0);

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv skips weak generic fragment titles", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_weak_fragment");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["Find a", "Open"], ["THC", "Open"]],
      databaseName: "Medicine"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(1);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("THC.md");
    expect(files).not.toContain("Find a.md");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv skips action-summary rows while keeping normal entities", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_action_summary");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["Browse commercial models and create follow-up task", "Open"], ["Mermaid Pendant", "Open"]],
      databaseName: "Tasks"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(1);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("Mermaid Pendant.md");
    expect(files).not.toContain("Browse commercial models and create follow-up task.md");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv skips auto-generation for Home views database", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_home_views_skip");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["March 21, 2026 slept all day", "Open"]],
      databaseName: "Home views"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(0);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files.length).toBe(0);

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv avoids creating short title when richer existing title already matches", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_fuzzy_existing");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });
    await Bun.write(join(dbDir, "water lettuce 水芙蓉浮萍.md"), "# water lettuce 水芙蓉浮萍\n");

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["water lettuce https://example.com/product/abc", "Open"]],
      databaseName: "Planting"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(0);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("water lettuce 水芙蓉浮萍.md");
    expect(files).not.toContain("water lettuce.md");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv keeps URL-derived identity tokens for matching richer existing titles", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_url_identity");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });
    await Bun.write(join(dbDir, "cancel meshy ai subscription.md"), "# cancel meshy ai subscription\n");

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["cancel http://meshy.ai subscription", "Open"]],
      databaseName: "Tasks"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(0);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("cancel meshy ai subscription.md");
    expect(files).not.toContain("cancel subscription.md");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv uses URL path slugs to avoid duplicate summary pages", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_slug_identity");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });
    await Bun.write(join(dbDir, "浏览Solomonlq 商用模型 cos 并创建新任务task.md"), "# 浏览Solomonlq 商用模型 cos 并创建新任务task\n");

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["浏览https://www.thingiverse.com/solomonlq/designs 商用模型:cos 并创建新任务task", "Open"]],
      databaseName: "Tasks"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(0);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("浏览Solomonlq 商用模型 cos 并创建新任务task.md");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv suppresses composite multi-entity row titles", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_composite");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });
    await Bun.write(join(dbDir, "Sulfamethoxazole.md"), "# Sulfamethoxazole\n");
    await Bun.write(join(dbDir, "Trimethoprim.md"), "# Trimethoprim\n");

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["Sulfamethoxazole + Trimethoprim", "Open"]],
      databaseName: "Medicine"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(0);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("Sulfamethoxazole.md");
    expect(files).toContain("Trimethoprim.md");
    expect(files).not.toContain("Sulfamethoxazole + Trimethoprim.md");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv suppresses date-prefixed rows with weak remainder", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_date_weak");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["@March 20, 2026 疼", "Open"]],
      databaseName: "Day Log Table"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(0);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files.length).toBe(0);

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv writes provenance fields for generated notes", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_provenance");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvPath = join(dbDir, "Tasks 11111111111111111111111111111111.csv");
    const csvInfo = {
      path: csvPath,
      header: ["Name", "Status"],
      rows: [["Legit task title", "Open"]],
      databaseName: "Tasks"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir);
    expect(created).toBe(1);
    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("Legit task title.md");

    const content = await Bun.file(join(dbDir, "Legit task title.md")).text();
    expect(content).toContain('database-source: Tasks 11111111111111111111111111111111.csv');
    expect(content).toContain('database-row: 1');

    await rm(dbDir, { recursive: true, force: true });
  });

  test("generateMissingMdFromCsv abstains uncertain short-vs-rich title matches and reports them", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir, readdir } = await import("node:fs/promises");

    const dbDir = join(process.cwd(), "test_qa_unit_generate_abstain_report");
    await rm(dbDir, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });
    await Bun.write(join(dbDir, "cancel meshy ai subscription.md"), "# cancel meshy ai subscription\n");

    const abstainCollector = [];
    const csvInfo = {
      header: ["Name", "Status"],
      rows: [["cancel subscription", "Open"]],
      databaseName: "Tasks"
    };

    const created = await generateMissingMdFromCsv(csvInfo, dbDir, { abstainCollector });
    expect(created).toBe(0);
    expect(abstainCollector.length).toBe(1);
    expect(abstainCollector[0].databaseName).toBe("Tasks");
    expect(abstainCollector[0].rawTitle).toBe("cancel subscription");

    const files = (await readdir(dbDir)).filter(f => f.endsWith(".md"));
    expect(files).toContain("cancel meshy ai subscription.md");
    expect(files).not.toContain("cancel subscription.md");

    await rm(dbDir, { recursive: true, force: true });
  });

  test("processFileContent keeps @ title literal in frontmatter", async () => {
    const { join } = await import("node:path");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");

    const dir = await mkdtemp(join(tmpdir(), "n2o-title-"));

    const filePath = join(dir, "@Alex face0000000000000000000000000001.md");
    await Bun.write(filePath, "# @Alex\n\nBody\n");

    const metadata = { title: "@Alex", published: false };
    const fileMap = new Map([
      ["Alex.md", { cleanedName: "Alex.md", fullPath: filePath, relativePath: "." }]
    ]);

    const result = await processFileContent(filePath, metadata, fileMap, dir, new Map(), { inferMetadata: true });
    expect(result.newContent).toContain('title: "@Alex"');
    expect(result.newContent).not.toContain('title: "[[Alex]]"');

    await rm(dir, { recursive: true, force: true });
  });

  test("processFileContent does not promote body Key:Value line after property block", async () => {
    const { join } = await import("node:path");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");

    const dir = await mkdtemp(join(tmpdir(), "n2o-boundary-"));

    const filePath = join(dir, "Day Log abc123def456789012345678901234ab.md");
    await Bun.write(filePath, "# Day Log\n\nDate: May 29, 2023\nContent: A,B,C\n\nCinematic Mindscapes: High-quality Video Reconstruction from Brain Activity\n");

    const metadata = { title: "Day Log", published: false };
    const fileMap = new Map([
      ["Day Log abc123def456789012345678901234ab.md", { cleanedName: "Day Log.md", fullPath: filePath, relativePath: "." }]
    ]);

    const result = await processFileContent(filePath, metadata, fileMap, dir, new Map(), { inferMetadata: true });
    expect(result.newContent).toContain('date: "May 29, 2023"');
    expect(result.newContent).toContain('content: "A,B,C"');
    expect(result.newContent).not.toContain('cinematic-mindscapes:');

    await rm(dir, { recursive: true, force: true });
  });

  test("processFileContent keeps opening prose Key:Value lines in the body by default", async () => {
    const { join } = await import("node:path");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");

    const dir = await mkdtemp(join(tmpdir(), "n2o-opening-prose-"));

    const filePath = join(dir, "Draft Notes abc123def456789012345678901234ab.md");
    await Bun.write(filePath, "# Draft Notes\n\nNote: draft\nWhy: because\nTL;DR: short\n");

    const metadata = { title: "Draft Notes", published: false };
    const fileMap = new Map([
      ["Draft Notes abc123def456789012345678901234ab.md", { cleanedName: "Draft Notes.md", fullPath: filePath, relativePath: "." }]
    ]);

    const result = await processFileContent(filePath, metadata, fileMap, dir, new Map());
    expect(result.newContent).toContain("Note: draft");
    expect(result.newContent).toContain("Why: because");
    expect(result.newContent).toContain("TL;DR: short");
    expect(result.newContent).not.toContain('note: "draft"');
    expect(result.newContent).not.toContain('why: "because"');
    expect(result.newContent).not.toContain('tldr: "short"');

    await rm(dir, { recursive: true, force: true });
  });

  test("processFileContent infers bounded opening Key:Value metadata with --infer-metadata behavior", async () => {
    const { join } = await import("node:path");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");

    const dir = await mkdtemp(join(tmpdir(), "n2o-infer-metadata-"));

    const filePath = join(dir, "Draft Notes abc123def456789012345678901234ab.md");
    await Bun.write(filePath, "# Draft Notes\n\nClient: Acme\nTags: Ops, Launch\n\nBody paragraph starts here.\nWhy: keep in body\n");

    const metadata = { title: "Draft Notes", published: false };
    const fileMap = new Map([
      ["Draft Notes abc123def456789012345678901234ab.md", { cleanedName: "Draft Notes.md", fullPath: filePath, relativePath: "." }]
    ]);

    const result = await processFileContent(filePath, metadata, fileMap, dir, new Map(), { inferMetadata: true });
    const parsed = matter(result.newContent);

    expect(parsed.data.client).toBe("Acme");
    expect(parsed.data.tags).toEqual(["Ops", "Launch"]);
    expect(result.newContent).not.toContain("Client: Acme");
    expect(result.newContent).not.toContain("Tags: Ops, Launch");
    expect(result.newContent).toContain("Why: keep in body");

    await rm(dir, { recursive: true, force: true });
  });

  test("processFileContent keeps frontmatter YAML parseable when property links include bracketed titles", async () => {
    const { join } = await import("node:path");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");

    const dir = await mkdtemp(join(tmpdir(), "n2o-yaml-escape-"));

    const filePath = join(dir, "Dashboard Overview face000000000000000000000000000f.md");
    await Bun.write(
      filePath,
      "# Dashboard Overview\n\nContent: [Indie Game Title](../../../My%20Notes/Games/Indie%20Game%20Title%20face0000000000000000000000000005.md), [tv] Series Pilot 01 (../../../My%20Notes/Media%20Reviews/%5Btv%5D%20Series%20Pilot%2001%20face0000000000000000000000000005.md)\n\nBody\n"
    );

    const metadata = { title: "Dashboard Overview", published: false };
    const fileMap = new Map([
      ["Dashboard Overview face000000000000000000000000000f.md", { cleanedName: "Dashboard Overview.md", fullPath: filePath, relativePath: "." }],
      ["Indie Game Title face0000000000000000000000000005.md", { cleanedName: "Indie Game Title.md", fullPath: join(dir, "Indie Game Title face0000000000000000000000000005.md"), relativePath: "." }],
      ["[tv] Series Pilot 01 face0000000000000000000000000005.md", { cleanedName: "[tv] Series Pilot 01.md", fullPath: join(dir, "[tv] Series Pilot 01 face0000000000000000000000000005.md"), relativePath: "." }]
    ]);

    const result = await processFileContent(filePath, metadata, fileMap, dir, new Map(), { inferMetadata: true });
    const parsed = matter(result.newContent);

    expect(parsed.data.title).toBe("Dashboard Overview");
    expect(parsed.data.content).toBeDefined();
    expect(result.newContent).not.toContain('content: "[[\\[tv\\]');

    await rm(dir, { recursive: true, force: true });
  });
});

describe("CSV identity and dedupe integrity", () => {
  test("processes header-only CSV files", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir } = await import("node:fs/promises");

    const root = join(process.cwd(), "test_qa_unit_csv_header_only");
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });

    await Bun.write(join(root, "My tasks face000000000000000000000000000e.csv"), "Name,Status\n");

    const csvFiles = await processCsvDatabases(root);
    expect(csvFiles.length).toBe(1);
    expect(csvFiles[0].databaseName).toBe("My tasks");
    expect(csvFiles[0].rows.length).toBe(0);

    await rm(root, { recursive: true, force: true });
  });

  test("preserves same databaseName across different folders", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir } = await import("node:fs/promises");

    const root = join(process.cwd(), "test_qa_unit_csv_identity");
    const japanDir = join(root, "Japan Trip");
    const alaskaDir = join(root, "Alaska Trip");

    await rm(root, { recursive: true, force: true });
    await mkdir(japanDir, { recursive: true });
    await mkdir(alaskaDir, { recursive: true });

    await Bun.write(
      join(japanDir, "Schedule aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.csv"),
      "Name,Status\nTokyo,Open\n"
    );
    await Bun.write(
      join(alaskaDir, "Schedule bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.csv"),
      "Name,Status\nAnchorage,Open\n"
    );

    const csvFiles = await processCsvDatabases(root);
    const schedules = csvFiles.filter(f => f.databaseName === "Schedule");

    expect(schedules.length).toBe(2);
    expect(new Set(schedules.map(f => f.dedupeKey)).size).toBe(2);
    expect(new Set(schedules.map(f => f.resolvedRootIndexFileName)).size).toBe(2);

    await rm(root, { recursive: true, force: true });
  });

  test("prefers _all variant within same logical identity", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir } = await import("node:fs/promises");

    const root = join(process.cwd(), "test_qa_unit_csv_all");
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });

    const id = "cccccccccccccccccccccccccccccccc";
    await Bun.write(join(root, `Tasks ${id}.csv`), "Name\nA\n");
    await Bun.write(join(root, `Tasks ${id}_all.csv`), "Name,Status\nA,Open\n");

    const csvFiles = await processCsvDatabases(root);
    expect(csvFiles.length).toBe(1);
    expect(csvFiles[0].isAllVersion).toBe(true);
    expect(csvFiles[0].path).toContain("_all.csv");

    await rm(root, { recursive: true, force: true });
  });

  test("disambiguates same-folder same-name different IDs", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir } = await import("node:fs/promises");

    const root = join(process.cwd(), "test_qa_unit_csv_collision");
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });

    await Bun.write(join(root, "Untitled 11111111111111111111111111111111.csv"), "Name\nA\n");
    await Bun.write(join(root, "Untitled 22222222222222222222222222222222.csv"), "Name\nB\n");

    const csvFiles = await processCsvDatabases(root);
    expect(csvFiles.length).toBe(2);
    expect(new Set(csvFiles.map(f => f.resolvedCsvFileName)).size).toBe(2);
    expect(new Set(csvFiles.map(f => f.resolvedBaseFileName)).size).toBe(2);
    expect(new Set(csvFiles.map(f => f.resolvedIndexFileName)).size).toBe(2);
    expect(new Set(csvFiles.map(f => f.resolvedDataviewCsvFileName)).size).toBe(2);

    await rm(root, { recursive: true, force: true });
  });

  test("findBasesReconciliationIssues reports leftover raw-id CSV files", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir } = await import("node:fs/promises");

    const root = join(process.cwd(), "test_qa_unit_bases_reconcile_leftover");
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });

    const rawCsvPath = join(root, "Home views face000000000000000000000000000f.csv");
    await Bun.write(rawCsvPath, "Name,Status\n");

    const issues = findBasesReconciliationIssues(root, []);
    expect(issues.hasIssues).toBe(true);
    expect(issues.leftoverRawCsvPaths).toContain(rawCsvPath);
    expect(issues.missingBaseFiles).toEqual([]);

    await rm(root, { recursive: true, force: true });
  });

  test("findBasesReconciliationIssues reports missing expected .base files", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir } = await import("node:fs/promises");

    const root = join(process.cwd(), "test_qa_unit_bases_reconcile_missing_base");
    const dbDir = join(root, "Work & Personal", "Home");
    await rm(root, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvInfo = {
      path: join(dbDir, "Home views.csv"),
      databaseName: "Home views",
      resolvedBaseFileName: "Home views.base"
    };

    const issues = findBasesReconciliationIssues(root, [csvInfo]);
    expect(issues.hasIssues).toBe(true);
    expect(issues.leftoverRawCsvPaths).toEqual([]);
    expect(issues.missingBaseFiles).toContain(join(dbDir, "Home views.base"));

    await rm(root, { recursive: true, force: true });
  });

  test("findBasesReconciliationIssues passes when no leftovers and bases exist", async () => {
    const { join } = await import("node:path");
    const { rm, mkdir } = await import("node:fs/promises");

    const root = join(process.cwd(), "test_qa_unit_bases_reconcile_clean");
    const dbDir = join(root, "Work & Personal", "Main Workspace", "Day Log");
    await rm(root, { recursive: true, force: true });
    await mkdir(dbDir, { recursive: true });

    const csvPath = join(dbDir, "Day Log Table.csv");
    const basePath = join(dbDir, "Day Log Table.base");
    await Bun.write(csvPath, "Name,Status\n");
    await Bun.write(basePath, "filters:\n");

    const csvInfo = {
      path: csvPath,
      databaseName: "Day Log Table",
      resolvedBaseFileName: "Day Log Table.base"
    };

    const issues = findBasesReconciliationIssues(root, [csvInfo]);
    expect(issues.hasIssues).toBe(false);
    expect(issues.leftoverRawCsvPaths).toEqual([]);
    expect(issues.missingBaseFiles).toEqual([]);

    await rm(root, { recursive: true, force: true });
  });
});
