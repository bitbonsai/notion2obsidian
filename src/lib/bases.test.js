import { describe, test, expect } from "bun:test";
import { generateBaseFile, toPropertyKey, rewriteDatabaseLinks } from "./bases.js";

// ============================================================================
// toPropertyKey
// ============================================================================

describe("toPropertyKey", () => {
  test("lowercases and trims simple columns", () => {
    expect(toPropertyKey('Status')).toBe('status');
    expect(toPropertyKey('  Priority  ')).toBe('priority');
  });

  test("replaces whitespace with hyphens", () => {
    expect(toPropertyKey('Due Date')).toBe('due-date');
    expect(toPropertyKey('Assignee  Name')).toBe('assignee-name');
  });

  test("strips characters that are not letters, numbers or hyphens", () => {
    expect(toPropertyKey('Cost ($)')).toBe('cost-');
    expect(toPropertyKey("Owner's Email")).toBe('owners-email');
    expect(toPropertyKey('Done?')).toBe('done');
  });

  test("keeps non-ASCII letters", () => {
    expect(toPropertyKey('Échéance')).toBe('échéance');
    expect(toPropertyKey('Über Name')).toBe('über-name');
    expect(toPropertyKey('任务 名称')).toBe('任务-名称');
  });
});

// ============================================================================
// generateBaseFile
// ============================================================================

describe("generateBaseFile", () => {
  const header = ['Name', 'Status', 'Priority', 'Due'];
  const rows = [
    ['Write docs', 'Done', 'High', 'March 1, 2026'],
    ['Ship release', 'In progress', 'Medium', 'March 5, 2026']
  ];

  test("generates filters, properties and the All view", () => {
    const content = generateBaseFile({
      databaseName: 'Tasks',
      header,
      rows,
      folder: 'Workspace/Tasks'
    });

    expect(content).toContain(`filters:\n  and:\n    - 'file.inFolder("Workspace/Tasks")'\n    - file.ext == "md"`);
    expect(content).toContain('properties:\n  status:\n    displayName: "Status"');
    expect(content).toContain('  priority:\n    displayName: "Priority"');
    expect(content).toContain('  due:\n    displayName: "Due"');
    expect(content).toContain('views:\n  - type: table\n    name: "All Tasks"');
    expect(content).toContain('    order:\n      - file.name\n      - status\n      - priority\n      - due');
    // The first column (title) is skipped
    expect(content).not.toContain('displayName: "Name"');
    expect(content).not.toContain('      - name');
  });

  test("Active view uses the exact case from the data", () => {
    const content = generateBaseFile({
      databaseName: 'Tasks',
      header,
      rows: [['Write docs', 'Done', 'High', '']],
      folder: 'Workspace/Tasks'
    });

    expect(content).toContain(`- 'status != "Done"'`);
    expect(content).not.toContain(`- 'status != "done"'`);
  });

  test("Active view lists each distinct done-like value once", () => {
    const content = generateBaseFile({
      databaseName: 'Tasks',
      header,
      rows: [
        ['A', 'Done', '', ''],
        ['B', 'Done', '', ''],
        ['C', 'archived', '', '']
      ],
      folder: 'Workspace/Tasks'
    });

    expect(content).toContain(`- 'status != "Done"'`);
    expect(content).toContain(`- 'status != "archived"'`);
    expect(content.match(/status != /g).length).toBe(2);
  });

  test("Active view is omitted when no done-like value appears", () => {
    const content = generateBaseFile({
      databaseName: 'Tasks',
      header,
      rows: [
        ['Write docs', 'In progress', 'High', ''],
        ['Ship release', 'Not started', 'Low', '']
      ],
      folder: 'Workspace/Tasks'
    });

    expect(content).not.toContain('Active');
    expect(content).not.toContain('status !=');
  });

  test("Active view is omitted when there is no status column", () => {
    const content = generateBaseFile({
      databaseName: 'Books',
      header: ['Name', 'Author'],
      rows: [['Basis', 'Kernighan']],
      folder: 'Books'
    });

    expect(content).not.toContain('Active');
  });
});

// ============================================================================
// rewriteDatabaseLinks
// ============================================================================

describe("rewriteDatabaseLinks", () => {
  const databases = [
    {
      databaseName: 'Tasks',
      fileNames: ['Tasks 1111aaaa2222bbbb3333cccc4444dddd.csv', 'Tasks 1111aaaa2222bbbb3333cccc4444dddd_all.csv']
    }
  ];

  test("rewrites markdown links to the csv (URL-encoded) into .base wikilinks", () => {
    const content = 'See the database: [Tasks](Tasks%201111aaaa2222bbbb3333cccc4444dddd.csv)';
    expect(rewriteDatabaseLinks(content, databases)).toBe('See the database: [[Tasks.base|Tasks]]');
  });

  test("rewrites markdown links to the renamed csv", () => {
    const content = 'See the database: [Tasks](Tasks.csv)';
    expect(rewriteDatabaseLinks(content, databases)).toBe('See the database: [[Tasks.base|Tasks]]');
  });

  test("rewrites wikilinks with alias", () => {
    expect(rewriteDatabaseLinks('Open [[Tasks|the tasks]] now', databases))
      .toBe('Open [[Tasks.base|the tasks]] now');
  });

  test("rewrites plain wikilinks", () => {
    expect(rewriteDatabaseLinks('Open [[Tasks]] now', databases))
      .toBe('Open [[Tasks.base]] now');
  });

  test("rewrites index wikilinks", () => {
    expect(rewriteDatabaseLinks('See [[Tasks_Index]] here', databases))
      .toBe('See [[Tasks.base]] here');
    expect(rewriteDatabaseLinks('See [[Tasks_Index|index]] here', databases))
      .toBe('See [[Tasks.base|index]] here');
  });

  test("leaves fenced code blocks untouched", () => {
    const content = '```\n[Tasks](Tasks.csv)\n[[Tasks]]\n```';
    expect(rewriteDatabaseLinks(content, databases)).toBe(content);
  });

  test("leaves inline code untouched", () => {
    const content = 'Run `[Tasks](Tasks.csv)` now';
    expect(rewriteDatabaseLinks(content, databases)).toBe(content);
  });

  test("leaves unrelated links untouched", () => {
    const content = '[Home](Home.md) and [site](https://example.com/data.csv)';
    expect(rewriteDatabaseLinks(content, databases)).toBe(content);
  });

  test("returns content unchanged for empty database list", () => {
    const content = '[Tasks](Tasks.csv)';
    expect(rewriteDatabaseLinks(content, [])).toBe(content);
  });
});
