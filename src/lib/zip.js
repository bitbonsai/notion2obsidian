import { dirname, basename, join } from "node:path";
import { mkdir, writeFile, rm, readdir, stat, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { Glob } from "bun";
import { unzipSync } from "fflate";
import chalk from "chalk";
import { shortenFilename } from "./utils.js";

// ============================================================================
// Zip Extraction
// ============================================================================

export async function extractZipToSameDirectory(zipPath, options = {}) {
  const { sample = false, samplePercentage = 0.10, maxSampleBytes = 10_000_000, mergeToDir = null, suppressMessages = false } = options;

  const zipDir = dirname(zipPath);
  const zipBaseName = basename(zipPath, '.zip');

  let extractDir;
  if (mergeToDir) {
    // Use the provided merge directory
    extractDir = mergeToDir;
  } else {
    // Shorten the directory name by truncating long hashes/UUIDs
    // Pattern: Export-2d6fa1e5-8571-4845-8e81-f7d5ca30194a-Part-1 → Export-2d6f
    let shortName = zipBaseName;
    // Match UUID format (with hyphens) or plain hex (without hyphens)
    const uuidPattern = /^(Export-[0-9a-fA-F]{4})[0-9a-fA-F-]{24,}/;
    const match = zipBaseName.match(uuidPattern);
    if (match) {
      shortName = match[1];  // e.g., "Export-2d6f"
    }

    extractDir = join(zipDir, `${shortName}-extracted`);
  }

  // Track timing
  const startTime = Date.now();

  if (!suppressMessages) {
    const sampleText = sample ? ` (sample: ${samplePercentage * 100}% or ${Math.round(maxSampleBytes / 1_000_000)}MB)` : '';
    console.log(chalk.cyan(`Extracting ${basename(zipPath)}${sampleText}...`));
  }

  try {
    // Read zip file
    const zipData = await Bun.file(zipPath).arrayBuffer();
    const zipBuffer = new Uint8Array(zipData);

    // Extract using fflate
    const unzipped = unzipSync(zipBuffer, {
      filter(file) {
        // Skip macOS metadata files and directories
        return !file.name.includes('__MACOSX') &&
               !file.name.split('/').some(p => p.startsWith('.'));
      }
    });

    // Convert to array and filter out directories (entries ending with /)
    const filesToExtract = Object.entries(unzipped).filter(([path]) => !path.endsWith('/'));

    let isSampled = false;
    let totalFiles = filesToExtract.length;
    let selectedFiles = filesToExtract;

    if (sample) {
      // Calculate sample size
      const targetCount = Math.ceil(totalFiles * samplePercentage);

      // Sample evenly distributed files
      const step = Math.max(1, Math.floor(totalFiles / targetCount));
      const sampledFiles = [];
      let totalBytes = 0;

      for (let i = 0; i < totalFiles && sampledFiles.length < targetCount; i += step) {
        const [path, data] = filesToExtract[i];
        if (totalBytes + data.length > maxSampleBytes && sampledFiles.length > 0) {
          break; // Stop if we exceed size limit
        }
        sampledFiles.push([path, data]);
        totalBytes += data.length;
      }

      selectedFiles = sampledFiles;
      isSampled = true;
    }

    // Create extraction directory
    await mkdir(extractDir, { recursive: true });

    // Write files and track nested zip files
    let fileCount = 0;
    const nestedZips = [];

    for (const [filePath, content] of selectedFiles) {
      const fullPath = join(extractDir, filePath);

      // Create directory structure
      await mkdir(dirname(fullPath), { recursive: true });

      // Write file
      await writeFile(fullPath, content);

      // Check if this is a nested zip file
      if (filePath.toLowerCase().endsWith('.zip')) {
        nestedZips.push(fullPath);
      }

      fileCount++;
    }

    // If we found nested zip files, extract them too
    if (nestedZips.length > 0) {
      if (!suppressMessages) {
        console.log(chalk.yellow(`  Found ${nestedZips.length} nested zip file(s), extracting...`));
      }

      for (const nestedZipPath of nestedZips) {
        try {
          const nestedResult = await extractZipToSameDirectory(nestedZipPath, {
            sample,
            samplePercentage,
            maxSampleBytes,
            mergeToDir: extractDir,
            suppressMessages: true
          });

          // Update counts with nested content
          fileCount += nestedResult.sampleCount;
          totalFiles += nestedResult.totalCount;
          if (nestedResult.isSampled) isSampled = true;

          // Remove the nested zip file after extraction
          await rm(nestedZipPath);
        } catch (err) {
          if (!suppressMessages) {
            console.log(chalk.yellow(`    Warning: Could not extract nested zip ${basename(nestedZipPath)}: ${err.message}`));
          }
        }
      }
    }

    // Calculate elapsed time
    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!suppressMessages) {
      if (isSampled) {
        console.log(chalk.green(`✓ Extracted ${fileCount} of ${totalFiles} files (${Math.round(fileCount / totalFiles * 100)}% sample) in ${elapsedSeconds}s\n`));
      } else {
        console.log(chalk.green(`✓ Extraction complete (${fileCount} files) in ${elapsedSeconds}s\n`));
      }
    }

    // Check if zip extracted to subdirectories that might contain the actual content
    const entries = await readdir(extractDir);

    // If there's exactly one subdirectory, use it
    if (entries.length === 1) {
      const potentialSubdir = join(extractDir, entries[0]);
      const subdirStat = await stat(potentialSubdir).catch(() => null);
      if (subdirStat?.isDirectory()) {
        if (!suppressMessages) {
          console.log(chalk.gray(`  Found subdirectory: ${entries[0]}`));
          console.log(chalk.gray(`  Working directory: ${extractDir}\n`));
        }
        return {
          path: potentialSubdir,
          extractDir, // Return parent for cleanup
          isSampled,
          sampleCount: fileCount,
          totalCount: totalFiles
        };
      }
    }

    // If there are multiple entries, check if any contain markdown files
    if (!suppressMessages && entries.length > 1) {
      let bestSubdir = null;
      let maxMdFiles = 0;

      for (const entry of entries) {
        const entryPath = join(extractDir, entry);
        const entryStat = await stat(entryPath).catch(() => null);
        if (entryStat?.isDirectory()) {
          // Count markdown files in this subdirectory
          const mdGlob = new Glob("**/*.md");
          const mdFiles = [];
          for await (const file of mdGlob.scan({ cwd: entryPath, absolute: false })) {
            mdFiles.push(file);
          }

          if (mdFiles.length > maxMdFiles) {
            maxMdFiles = mdFiles.length;
            bestSubdir = entryPath;
          }
        }
      }

      if (bestSubdir && maxMdFiles > 0) {
        console.log(chalk.gray(`  Found ${maxMdFiles} markdown files in subdirectory: ${basename(bestSubdir)}`));
        console.log(chalk.gray(`  Working directory: ${extractDir}\n`));
        return {
          path: bestSubdir,
          extractDir, // Return parent for cleanup
          isSampled,
          sampleCount: fileCount,
          totalCount: totalFiles
        };
      }
    }

    return { path: extractDir, extractDir, isSampled, sampleCount: fileCount, totalCount: totalFiles };
  } catch (err) {
    if (!suppressMessages) {
      console.log(chalk.red(`✗ Extraction failed: ${err.message}`));
    }

    // Clean up on error
    await rm(extractDir, { recursive: true, force: true });
    throw err;
  }
}

export async function extractMultipleZips(zipPaths, options = {}) {
  const { sample = false, outputDir = null } = options;

  // Always use a temporary processing directory when outputDir is specified
  let processingDir;
  let isUsingCustomOutput = false;

  if (outputDir) {
    // Use system temp directory for processing to avoid nesting in user's output
    const timestamp = Date.now().toString(36);
    processingDir = join(homedir(), '.cache', `notion2obsidian-${timestamp}`);
    isUsingCustomOutput = true;
  } else {
    // No custom output - use original behavior (extract next to zip files)
    const firstZipDir = dirname(zipPaths[0]);
    const timestamp = Date.now().toString(36);
    processingDir = join(firstZipDir, `notion-export-merged-${timestamp}`);
  }

  const mergeDir = processingDir;

  console.log(chalk.cyan.bold(`📦 Extracting ${zipPaths.length} zip files to unified directory...`));
  console.log(chalk.gray(`Merge directory: ${mergeDir}`));
  console.log(chalk.gray(`Note: Will automatically extract any nested zip files found\n`));

  // Create the merge directory
  await mkdir(mergeDir, { recursive: true });

  let totalExtractedFiles = 0;
  let totalOriginalFiles = 0;
  let anySampled = false;
  const duplicateFiles = new Set();

  try {
    for (let i = 0; i < zipPaths.length; i++) {
      const zipPath = zipPaths[i];
      const zipName = basename(zipPath);
      const shortName = shortenFilename(zipName, 50); // More generous for zip files

      console.log(chalk.blue(`[${i + 1}/${zipPaths.length}] ${shortName}`));

      const result = await extractZipToSameDirectory(zipPath, {
        ...options,
        mergeToDir: mergeDir,
        suppressMessages: true  // Suppress individual zip messages
      });

      totalExtractedFiles += result.sampleCount;
      totalOriginalFiles += result.totalCount;
      if (result.isSampled) anySampled = true;
    }

    console.log(chalk.green.bold(`✓ Extracted ${zipPaths.length} zip files successfully!`));
    if (anySampled) {
      console.log(chalk.yellow(`  Sample mode: ${totalExtractedFiles} of ${totalOriginalFiles} total files (${Math.round(totalExtractedFiles / totalOriginalFiles * 100)}% preview)`));
    } else {
      console.log(chalk.green(`  Total files: ${totalExtractedFiles}`));
    }
    console.log();
    console.log();

    // Check if merge directory has subdirectories that might contain the actual content
    const entries = await readdir(mergeDir);
    let contentPath = mergeDir;

    // If there's exactly one subdirectory, use it
    if (entries.length === 1) {
      const potentialSubdir = join(mergeDir, entries[0]);
      const subdirStat = await stat(potentialSubdir).catch(() => null);
      if (subdirStat?.isDirectory()) {
        console.log(chalk.gray(`Found content in subdirectory: ${entries[0]}`));
        contentPath = potentialSubdir;
      }
    } else {
      // If there are multiple entries, check if any contain markdown files
      let bestSubdir = null;
      let maxMdFiles = 0;

      for (const entry of entries) {
        const entryPath = join(mergeDir, entry);
        const entryStat = await stat(entryPath).catch(() => null);
        if (entryStat?.isDirectory()) {
          // Count markdown files in this subdirectory
          const mdGlob = new Glob("**/*.md");
          const mdFiles = [];
          for await (const file of mdGlob.scan({ cwd: entryPath, absolute: false })) {
            mdFiles.push(file);
          }

          if (mdFiles.length > maxMdFiles) {
            maxMdFiles = mdFiles.length;
            bestSubdir = entryPath;
          }
        }
      }

      if (bestSubdir && maxMdFiles > 0) {
        console.log(chalk.gray(`Found ${maxMdFiles} markdown files in subdirectory: ${basename(bestSubdir)}`));
        contentPath = bestSubdir;
      }
    }

    // If using custom output directory, move content there
    if (isUsingCustomOutput && outputDir) {
      console.log(chalk.cyan('📋 Moving content to output directory...'));

      // Ensure output directory exists
      await mkdir(outputDir, { recursive: true });

      // Move all content from processing directory to output directory
      const contentEntries = await readdir(contentPath);
      for (const entry of contentEntries) {
        const sourcePath = join(contentPath, entry);
        const targetPath = join(outputDir, entry);

        // If target exists, we need to handle it gracefully
        try {
          await stat(targetPath);
          // Target exists, remove it first
          await rm(targetPath, { recursive: true, force: true });
        } catch {
          // Target doesn't exist, which is fine
        }

        await rename(sourcePath, targetPath);
      }

      console.log(chalk.green('✓ Content moved to output directory'));

      return {
        path: outputDir,
        extractDir: mergeDir,
        isSampled: anySampled,
        sampleCount: totalExtractedFiles,
        totalCount: totalOriginalFiles
      };
    }

    // No custom output - return the content path as-is
    return {
      path: contentPath,
      extractDir: mergeDir,
      isSampled: anySampled,
      sampleCount: totalExtractedFiles,
      totalCount: totalOriginalFiles
    };

  } catch (err) {
    // Clean up on error
    await rm(mergeDir, { recursive: true, force: true });
    throw err;
  }
}
