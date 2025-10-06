import { resolve } from "node:path";
import { spawn } from "node:child_process";
import chalk from "chalk";

// ============================================================================
// Directory Opening
// ============================================================================

export async function openDirectory(dirPath, migrationTime, sizeStr) {
  const fullPath = resolve(dirPath);

  console.log(chalk.cyan.bold('\n🎉 Migration Complete!'));
  if (migrationTime && sizeStr) {
    console.log(`Time: ${chalk.green(migrationTime + 's')}  •  Size: ${chalk.green(sizeStr)}`);
  }
  console.log(`Directory: ${chalk.blue(fullPath)}`);
  console.log(chalk.gray('\nYour Notion export is now ready for Obsidian!'));

  try {
    // Detect platform and use appropriate open command
    const platform = process.platform;
    let openCommand;

    if (platform === 'darwin') {
      openCommand = 'open';
    } else if (platform === 'win32') {
      openCommand = 'start';
    } else {
      openCommand = 'xdg-open';
    }

    spawn(openCommand, [fullPath], { detached: true, stdio: 'ignore' });

    console.log(chalk.green('✓ Opening directory...'));
  } catch (err) {
    console.log(chalk.yellow(`Could not open directory automatically.`));
  }

  console.log();
}

// ============================================================================
// User Confirmation
// ============================================================================

export async function promptForConfirmation(dryRun) {
  if (dryRun) {
    console.log(chalk.yellow.bold('\n🔍 DRY RUN MODE - No changes will be made\n'));
    return;
  }

  // No confirmation prompt - removed to streamline UX
  // User can use Ctrl+C to cancel during migration if needed
  console.log();
}
