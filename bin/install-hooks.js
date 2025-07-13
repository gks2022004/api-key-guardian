#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

function installHook(hookName, command) {
  try {
    const { execSync } = require('child_process');
    const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
    const hooksDir = path.join(gitDir, 'hooks');
    const hookPath = path.join(hooksDir, hookName);

    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }

    const hookContent = `#!/bin/sh\n# API Key Guardian ${hookName} hook\nnpx api-key-guardian --scan-all\n`;
    fs.writeFileSync(hookPath, hookContent);
    fs.chmodSync(hookPath, '755');
    console.log(chalk.green(`✅ Git ${hookName} hook installed successfully!`));
  } catch (error) {
    console.error(chalk.red(`❌ Failed to install git ${hookName} hook:`), error.message);
    process.exit(1);
  }
}

function main() {
  installHook('pre-commit');
  installHook('pre-push');
  console.log(chalk.cyan('The hooks will now run before each commit and push to check for API keys.'));
}

if (require.main === module) {
  main();
}
