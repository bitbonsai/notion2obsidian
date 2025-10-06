import { join } from "node:path";
import { readdir, lstat, realpath } from "node:fs/promises";
import { stat } from "node:fs/promises";

// ============================================================================
// Glob Pattern Resolution
// ============================================================================

export async function resolveGlobPatterns(patterns) {
  const { Glob } = await import('bun');
  const resolvedPaths = [];
  const errors = [];

  for (const pattern of patterns) {
    try {
      // Check if it's a literal path first (not a glob pattern)
      if (!pattern.includes('*') && !pattern.includes('?') && !pattern.includes('[')) {
        // Check if the literal path exists
        try {
          await stat(pattern);
          resolvedPaths.push(pattern);
        } catch (err) {
          errors.push(`Path not found: ${pattern}`);
        }
        continue;
      }

      // It's a glob pattern, resolve it
      const glob = new Glob(pattern);
      const matches = [];

      for await (const file of glob.scan({
        cwd: process.cwd(),
        absolute: true,
        dot: false,
        onlyFiles: true
      })) {
        matches.push(file);
      }

      if (matches.length === 0) {
        errors.push(`No files found matching pattern: ${pattern}`);
      } else {
        resolvedPaths.push(...matches);
      }
    } catch (err) {
      errors.push(`Error resolving pattern '${pattern}': ${err.message}`);
    }
  }

  return { resolvedPaths, errors };
}

// ============================================================================
// Directory Operations
// ============================================================================

export async function getAllDirectories(dir) {
  const dirs = [];
  const visited = new Set();

  async function scan(currentDir) {
    // Resolve symlinks to detect circular references
    let realPath;
    try {
      realPath = await realpath(currentDir);
    } catch {
      return; // Skip if can't resolve path
    }

    if (visited.has(realPath)) {
      return; // Already visited (circular symlink)
    }
    visited.add(realPath);

    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      // Check if it's a symlink
      const stats = await lstat(fullPath).catch(() => null);
      if (!stats || stats.isSymbolicLink()) {
        continue; // Skip symlinks
      }

      if (entry.isDirectory()) {
        dirs.push(fullPath);
        await scan(fullPath);
      }
    }
  }

  await scan(dir);
  return dirs;
}
