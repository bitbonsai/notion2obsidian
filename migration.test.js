import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, cpSync, readdirSync, statSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import matter from "gray-matter";

// ============================================================================
// End-to-End Migration Tests
// ============================================================================

const repoRoot = dirname(import.meta.path);
const fixtureDir = join(repoRoot, 'test', 'fixtures', 'input');
const expectedDefaultDir = join(repoRoot, 'test', 'fixtures', 'expected-default');

const tempDirs = [];

function makeTempCopy() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'notion2obsidian-e2e-'));
  tempDirs.push(tmpDir);
  cpSync(fixtureDir, tmpDir, { recursive: true });
  return tmpDir;
}

function runCli(tmpDir, flags = []) {
  const result = Bun.spawnSync(
    ['bun', join(repoRoot, 'notion2obsidian.js'), tmpDir, ...flags],
    {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: repoRoot,
      env: { ...process.env, PATH: process.env.PATH }
    }
  );
  return result;
}

function listFilesRecursive(dir, baseDir = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath, baseDir));
    } else if (entry.isFile()) {
      files.push(relative(baseDir, fullPath).split('\\').join('/'));
    }
  }
  return files.sort();
}

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) { /* ignore */ }
  }
});

describe("migration end-to-end", () => {
  test("without --bases output matches main", () => {
    const tmpDir = makeTempCopy();
    const result = runCli(tmpDir);
    expect(result.exitCode).toBe(0);

    const actualFiles = listFilesRecursive(tmpDir);
    const expectedFiles = listFilesRecursive(expectedDefaultDir);
    expect(actualFiles).toEqual(expectedFiles);

    for (const relPath of expectedFiles) {
      const actual = readFileSync(join(tmpDir, relPath), 'utf-8');
      const expected = readFileSync(join(expectedDefaultDir, relPath), 'utf-8');
      expect(actual).toBe(expected);
    }
  });

  test("with --bases creates Bases views, notes and rewrites links", () => {
    const tmpDir = makeTempCopy();
    const result = runCli(tmpDir, ['--bases']);
    expect(result.exitCode).toBe(0);

    // .base file with filters and Active view
    const basePath = join(tmpDir, 'Workspace', 'Tasks.base');
    expect(statSync(basePath).isFile()).toBe(true);
    const baseContent = readFileSync(basePath, 'utf-8');
    expect(baseContent).toContain('file.inFolder("Workspace/Tasks")');
    expect(baseContent).toContain('status != "Done"');

    // CSV kept, renamed, _all variant removed, no index file
    expect(statSync(join(tmpDir, 'Workspace', 'Tasks.csv')).isFile()).toBe(true);
    const allFiles = listFilesRecursive(tmpDir);
    expect(allFiles.some(f => f.endsWith('_all.csv'))).toBe(false);
    expect(allFiles).not.toContain('Workspace/Tasks_Index.md');

    // Row note for a row without a page was created
    const planPath = join(tmpDir, 'Workspace', 'Tasks', 'Plan roadmap.md');
    expect(statSync(planPath).isFile()).toBe(true);
    const plan = matter(readFileSync(planPath, 'utf-8'));
    expect(plan.data.title).toBe('Plan roadmap');
    expect(plan.data.status).toBe('Not started');

    // Existing row note keeps its body and status, gains missing properties
    const writeDocsPath = join(tmpDir, 'Workspace', 'Tasks', 'Write docs.md');
    const writeDocs = matter(readFileSync(writeDocsPath, 'utf-8'));
    expect(writeDocs.data.status).toBe('Done');
    expect(writeDocs.data.due).toBe('March 1, 2026');
    expect(writeDocs.content).toContain('Write the user guide.');
    // No duplicated keys
    const frontmatterBlock = readFileSync(writeDocsPath, 'utf-8').match(/^---\n([\s\S]*?)\n---/)[1];
    expect(frontmatterBlock.match(/^status:/gm).length).toBe(1);
    expect(frontmatterBlock.match(/^due:/gm).length).toBe(1);

    // Links to the database point to the .base file
    const homeContent = readFileSync(join(tmpDir, 'Workspace', 'Home.md'), 'utf-8');
    expect(homeContent).toContain('[[Tasks.base|Tasks]]');
    expect(homeContent).not.toContain('(Tasks.csv)');

    // Inline code is untouched
    expect(homeContent).toContain('`/a\\_b/`');
  });
});
