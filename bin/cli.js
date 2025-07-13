#!/usr/bin/env node

const APIKeyGuardian = require('../index');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

function loadConfig() {
  const configPath = path.join(process.cwd(), '.apiguardian.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      console.warn(chalk.yellow('Warning: Could not parse .apiguardian.json config file'));
    }
  }
  return {};
}

function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${chalk.blue.bold('API Key Guardian')}

Usage: api-key-guardian [options] [files...]

Options:
  --install-hooks    Install git pre-commit hooks
  --scan-all        Scan entire project
  --config          Show current configuration
  --help, -h        Show this help message

Examples:
  api-key-guardian --install-hooks
  api-key-guardian --scan-all
  api-key-guardian src/config.js
    `);
    return;
  }

  if (args.includes('--install-hooks')) {
    installGitHooks();
    return;
  }

  if (args.includes('--config')) {
    console.log(chalk.blue('Current configuration:'));
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  const guardian = new APIKeyGuardian(config);
  
  (async () => {
    let findings = [];
    
    // Improved file collection function
    async function collectFiles(dir, shouldIgnoreFile) {
      let files = [];
      const absoluteDir = path.resolve(dir);
      
      if (shouldIgnoreFile(absoluteDir)) {
        return files;
      }
      
      try {
        const items = await fs.promises.readdir(absoluteDir);
        
        for (const item of items) {
          const itemPath = path.join(absoluteDir, item);
          
          if (shouldIgnoreFile(itemPath)) {
            continue;
          }
          
          try {
            const stats = await fs.promises.stat(itemPath);
            if (stats.isDirectory()) {
              // Recursively collect files from subdirectories
              const subFiles = await collectFiles(itemPath, shouldIgnoreFile);
              files = files.concat(subFiles);
            } else if (stats.isFile()) {
              files.push(itemPath);
            }
          } catch (error) {
            // Skip files/directories that can't be accessed
            if (error.code !== 'ENOENT' && error.code !== 'EACCES') {
              console.warn(chalk.yellow(`Warning: Could not access ${itemPath}: ${error.message}`));
            }
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'EACCES') {
          console.warn(chalk.yellow(`Warning: Could not read directory ${absoluteDir}: ${error.message}`));
        }
      }
      
      return files;
    }

    if (args.includes('--scan-all')) {
      console.log(chalk.blue('🔍 Scanning entire project...'));
      console.log(chalk.cyan(`Starting from: ${process.cwd()}`));
      
      const allFiles = await collectFiles(process.cwd(), guardian.shouldIgnoreFile.bind(guardian));
      const total = allFiles.length;
      
      console.log(chalk.cyan(`Found ${total} files to scan`));
      
      // Show some sample directories being scanned
      const sampleDirs = [...new Set(allFiles.slice(0, 10).map(f => path.dirname(path.relative(process.cwd(), f))))];
      console.log(chalk.dim(`Sample directories: ${sampleDirs.slice(0, 5).join(', ')}${sampleDirs.length > 5 ? '...' : ''}`));
      
      findings = [];
      
      for (let i = 0; i < total; i++) {
        const relativePath = path.relative(process.cwd(), allFiles[i]);
        const displayPath = relativePath.length > 80 ? '...' + relativePath.slice(-77) : relativePath;
        process.stdout.write(`\rScanning ${i + 1}/${total}: ${displayPath}${' '.repeat(Math.max(0, 100 - displayPath.length))}`);
        findings.push(...(await guardian.scanFile(allFiles[i])));
      }
      process.stdout.write('\n');
      
    } else if (args.length > 0) {
      const targets = args.filter(arg => !arg.startsWith('--'));
      let allFiles = [];
      
      for (const target of targets) {
        const targetPath = path.resolve(target);
        if (fs.existsSync(targetPath)) {
          const stats = fs.statSync(targetPath);
          if (stats.isDirectory()) {
            allFiles = allFiles.concat(await collectFiles(targetPath, guardian.shouldIgnoreFile.bind(guardian)));
          } else if (stats.isFile()) {
            allFiles.push(targetPath);
          }
        } else {
          console.warn(chalk.yellow(`Warning: Path does not exist: ${target}`));
        }
      }
      
      const total = allFiles.length;
      findings = [];
      
      for (let i = 0; i < total; i++) {
        const relativePath = path.relative(process.cwd(), allFiles[i]);
        process.stdout.write(`\rScanning ${i + 1}/${total}: ${relativePath}${' '.repeat(20)}`);
        findings.push(...(await guardian.scanFile(allFiles[i])));
      }
      process.stdout.write('\n');
      
    } else {
      findings = await scanStagedFiles(guardian);
    }
    
    console.log(guardian.formatFindings(findings));
    
    if (findings.length > 0) {
      process.exit(1);
    }
  })();
}

async function scanStagedFiles(guardian) {
  try {
    const { execSync } = require('child_process');
    const stagedFiles = execSync('git diff --cached --name-only', { encoding: 'utf8' })
      .split('\n')
      .filter(file => file.trim())
      .map(file => path.resolve(file))
      .filter(file => fs.existsSync(file));
    
    let findings = [];
    for (const file of stagedFiles) {
      if (!guardian.shouldIgnoreFile(file)) {
        findings.push(...(await guardian.scanFile(file)));
      }
    }
    return findings;
  } catch (error) {
    console.warn(chalk.yellow('Warning: Could not get staged files, scanning current directory'));
    return await guardian.scanDirectory(process.cwd(), true);
  }
}

function installGitHooks() {
  try {
    const { execSync } = require('child_process');
    const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
    const hooksDir = path.join(gitDir, 'hooks');
    const preCommitPath = path.join(hooksDir, 'pre-commit');
    
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }
    
    const hookContent = `#!/bin/sh
# API Key Guardian pre-commit hook
npx api-key-guardian
`;
    
    fs.writeFileSync(preCommitPath, hookContent);
    fs.chmodSync(preCommitPath, '755');
    
    console.log(chalk.green('👌 Git pre-commit hook installed successfully!'));
    console.log(chalk.cyan('The hook will now run before each commit to check for API keys.'));
  } catch (error) {
    console.error(chalk.red('❌ Failed to install git hooks:'), error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}