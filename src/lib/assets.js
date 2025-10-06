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

  console.log(chalk.yellow('\nPress ENTER to proceed with the migration, or Ctrl+C/ESC to cancel...'));

  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();

  // Check if ESC key was pressed (ASCII 27 or sequence starting with \x1b)
  if (value && value.length > 0) {
    // ESC key sends ASCII 27 (0x1B) or escape sequences starting with it
    if (value[0] === 27 || (value.length >= 3 && value[0] === 0x1B)) {
      console.log(chalk.red('\n✖ Migration cancelled'));
      process.exit(0);
    }
  }
}
