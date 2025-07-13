const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

class APIKeyGuardian {
  constructor(options = {}) {
    this.options = {
      ignoredFiles: ['.git/', 'node_modules/', '.env.example', ...(options.ignoredFiles || [])],
      ignoredExtensions: ['.jpg', '.png', '.gif', '.pdf', '.zip', '.tar.gz', ...(options.ignoredExtensions || [])],
      customPatterns: options.customPatterns || [],
      ...options
    };
    
    // Common API key patterns
    this.patterns = [
      // Generic API keys
      { name: 'Generic API Key', pattern: /['"](api[_-]?key|apikey)['"]\s*[:=]\s*['"][a-zA-Z0-9_-]{16,}['"]/, severity: 'high' },
      { name: 'Generic Secret', pattern: /['"](secret|token)['"]\s*[:=]\s*['"][a-zA-Z0-9_-]{16,}['"]/, severity: 'high' },
      
      // AWS
      { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/, severity: 'critical' },
      { name: 'AWS Secret Key', pattern: /['"](aws_secret_access_key|AWS_SECRET_ACCESS_KEY)['"]\s*[:=]\s*['"][a-zA-Z0-9/+=]{40}['"]/, severity: 'critical' },
      
      // Google
      { name: 'Google API Key', pattern: /AIza[0-9A-Za-z_-]{35}/, severity: 'high' },
      { name: 'Google OAuth', pattern: /[0-9]+-[0-9A-Za-z_]{32}\.apps\.googleusercontent\.com/, severity: 'high' },
      
      // GitHub
      { name: 'GitHub Token', pattern: /ghp_[a-zA-Z0-9]{36}/, severity: 'critical' },
      { name: 'GitHub App Token', pattern: /ghs_[a-zA-Z0-9]{36}/, severity: 'critical' },
      
      // Stripe
      { name: 'Stripe API Key', pattern: /(sk|pk)_(test|live)_[a-zA-Z0-9]{24,}/, severity: 'critical' },
      
      // Slack
      { name: 'Slack Token', pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/, severity: 'high' },
      
      // JWT
      { name: 'JWT Token', pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/, severity: 'medium' },
      
      // Database URLs
      { name: 'Database URL', pattern: /(mongodb(?:\+srv)?|mysql|postgresql):\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/, severity: 'high' },
      
      // Generic patterns
      { name: 'Private Key', pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----/, severity: 'critical' },
      { name: 'Bearer Token', pattern: /Bearer\s+[a-zA-Z0-9_-]{20,}/, severity: 'medium' },
      
      // Process custom patterns
      ...this.processCustomPatterns()
    ];
  }

  processCustomPatterns() {
    return this.options.customPatterns.map(pattern => {
      let regex;
      if (typeof pattern.pattern === 'string') {
        // Handle string patterns that might be in regex format
        const match = pattern.pattern.match(/^\/(.+)\/([gimuy]*)$/);
        if (match) {
          regex = new RegExp(match[1], match[2]);
        } else {
          regex = new RegExp(pattern.pattern);
        }
      } else {
        regex = pattern.pattern;
      }
      
      return {
        name: pattern.name,
        pattern: regex,
        severity: pattern.severity || 'medium'
      };
    });
  }

  shouldIgnoreFile(filePath) {
    const absolutePath = path.resolve(filePath);
    const normPath = absolutePath.replace(/\\/g, '/').toLowerCase();
    const relativePath = path.relative(process.cwd(), absolutePath).replace(/\\/g, '/').toLowerCase();
    
    // If relativePath is empty or starts with '..', it's outside the project
    if (!relativePath || relativePath.startsWith('..')) {
      return false;
    }
    
    // Split path into segments for directory matching
    const pathSegments = relativePath.split('/').filter(Boolean);
    
    for (const ignored of this.options.ignoredFiles) {
      const normalizedIgnored = ignored.replace(/\\/g, '/').toLowerCase();
      
      // Handle directory patterns (ending with /)
      if (normalizedIgnored.endsWith('/')) {
        const dirName = normalizedIgnored.slice(0, -1);
        
        // Check if any segment matches the directory name
        if (pathSegments.includes(dirName)) {
          return true;
        }
        
        // Check if path starts with the directory
        if (relativePath.startsWith(dirName + '/')) {
          return true;
        }
      }
      
      // Handle wildcard patterns
      if (normalizedIgnored.includes('*')) {
        const pattern = normalizedIgnored.replace(/\*/g, '.*');
        if (new RegExp(pattern).test(relativePath)) {
          return true;
        }
      }
      
      // Handle exact file matches
      if (relativePath === normalizedIgnored || 
          relativePath.endsWith('/' + normalizedIgnored) ||
          pathSegments[pathSegments.length - 1] === normalizedIgnored) {
        return true;
      }
    }
    
    // Check ignored extensions
    for (const ext of this.options.ignoredExtensions) {
      if (normPath.endsWith(ext.toLowerCase())) {
        return true;
      }
    }
    
    return false;
  }

  async scanFile(filePath) {
    try {
      const stat = await fs.promises.stat(filePath);
      
      // Skip files larger than 1MB to avoid performance issues
      if (stat.size > 1024 * 1024) {
        return [];
      }
      
      let content;
      try {
        content = await fs.promises.readFile(filePath, 'utf8');
      } catch (error) {
        // If file can't be read as UTF-8, skip it (likely binary)
        return [];
      }
      
      const findings = [];
      const lines = content.split('\n');
      
      for (const patternDef of this.patterns) {
        const matches = [...content.matchAll(new RegExp(patternDef.pattern, 'g'))];
        
        for (const match of matches) {
          const matchIndex = match.index;
          const lineNumber = content.substring(0, matchIndex).split('\n').length;
          const lineContent = lines[lineNumber - 1] || '';
          
          findings.push({
            file: path.relative(process.cwd(), filePath),
            line: lineNumber,
            pattern: patternDef.name,
            severity: patternDef.severity,
            match: match[0].substring(0, 50) + (match[0].length > 50 ? '...' : ''),
            fullMatch: match[0],
            lineContent: lineContent.trim()
          });
        }
      }
      
      return findings;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`Warning: Could not read file ${filePath}: ${error.message}`);
      }
      return [];
    }
  }

  async scanDirectory(dirPath, recursive = true) {
    let findings = [];
    
    try {
      const items = await fs.promises.readdir(dirPath);
      const tasks = [];
      
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        
        if (this.shouldIgnoreFile(itemPath)) {
          continue;
        }
        
        try {
          const stats = await fs.promises.stat(itemPath);
          if (stats.isDirectory() && recursive) {
            tasks.push(this.scanDirectory(itemPath, recursive));
          } else if (stats.isFile()) {
            tasks.push(this.scanFile(itemPath));
          }
        } catch (err) {
          // Skip files/directories that can't be accessed
        }
      }
      
      const results = await Promise.all(tasks);
      findings = results.flat();
    } catch (error) {
      console.warn(`Warning: Could not scan directory ${dirPath}: ${error.message}`);
    }
    
    return findings;
  }

  formatFindings(findings) {
    if (findings.length === 0) {
      return chalk.green('✅ No API keys or secrets detected!');
    }

    let output = chalk.red.bold(`🚨 Found ${findings.length} potential API key(s) or secret(s):\n\n`);
    
    const groupedFindings = findings.reduce((acc, finding) => {
      if (!acc[finding.file]) acc[finding.file] = [];
      acc[finding.file].push(finding);
      return acc;
    }, {});

    Object.entries(groupedFindings).forEach(([file, fileFindings]) => {
      output += chalk.yellow.bold(`📄 ${file}:\n`);
      
      fileFindings.forEach(finding => {
        const severityColor = {
          critical: chalk.red.bold,
          high: chalk.red,
          medium: chalk.yellow,
          low: chalk.blue
        }[finding.severity] || chalk.gray;
        
        output += `  ${severityColor(`[${finding.severity.toUpperCase()}]`)} `;
        output += `Line ${finding.line}: ${finding.pattern}\n`;
        output += `    ${chalk.gray(finding.match)}\n`;
        if (finding.lineContent) {
          output += `    ${chalk.dim('Context: ' + finding.lineContent)}\n`;
        }
      });
      
      output += '\n';
    });

    output += chalk.red.bold('🛑 Commit blocked to prevent secret exposure!\n');
    output += chalk.cyan('💡 To fix:\n');
    output += chalk.cyan('  1. Remove the secrets from your code\n');
    output += chalk.cyan('  2. Use environment variables instead\n');
    output += chalk.cyan('  3. Add secrets to .env file and .gitignore\n');
    output += chalk.cyan('  4. Consider using a secrets manager for production\n');
    
    return output;
  }
}

module.exports = APIKeyGuardian;