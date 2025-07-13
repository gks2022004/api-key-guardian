const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

class APIKeyGuardian {
  constructor(options = {}) {
    this.options = {
      ignoredFiles: ['.git/', 'node_modules/', '.env.example', ...(options.ignoredFiles || [])],
      ignoredExtensions: ['.jpg', '.png', '.gif', '.pdf', '.zip', ...(options.ignoredExtensions || [])],
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
      
      // Add custom patterns
      ...this.options.customPatterns
    ];
  }

  shouldIgnoreFile(filePath) {
    const normPath = filePath.replace(/\\/g, '/').toLowerCase();
    const pathSegments = normPath.split('/').filter(Boolean);
    const ignoredSegments = this.options.ignoredFiles.map(ignored => {
      let seg = ignored.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
      if (seg.startsWith('*')) return seg;
      if (seg.startsWith('.env') || seg.includes('.')) return seg;
      return seg;
    });
    if (pathSegments.some(seg => ignoredSegments.includes(seg))) {
      return true;
    }
    if (this.options.ignoredFiles.some(ignored => {
      const lowerIgnored = ignored.replace(/\\/g, '/').toLowerCase();
      return normPath.endsWith(lowerIgnored);
    })) {
      return true;
    }
    if (this.options.ignoredExtensions.some(ext => normPath.endsWith(ext.toLowerCase()))) {
      return true;
    }
    if (ignoredSegments.some(seg => seg.startsWith('*') && normPath.endsWith(seg.slice(1)))) {
      return true;
    }
    return false;
  }

  async scanFile(filePath) {
    try {
      const stat = await fs.promises.stat(filePath);
      // Skip files larger than 1MB
      if (stat.size > 1024 * 1024) {
        return [];
      }
      const content = await fs.promises.readFile(filePath, 'utf8');
      const findings = [];
      for (const pattern of this.patterns) {
        const matches = content.match(new RegExp(pattern.pattern, 'g'));
        if (matches) {
          for (const match of matches) {
            const lines = content.substring(0, content.indexOf(match)).split('\n');
            const lineNumber = lines.length;
            findings.push({
              file: filePath,
              line: lineNumber,
              pattern: pattern.name,
              severity: pattern.severity,
              match: match.substring(0, 50) + (match.length > 50 ? '...' : ''),
              fullMatch: match
            });
          }
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
      });
      
      output += '\n';
    });

    output += chalk.red.bold('🛑 Commit blocked to prevent secret exposure!\n');
    output += chalk.cyan('💡 To fix:\n');
    output += chalk.cyan('  1. Remove the secrets from your code\n');
    output += chalk.cyan('  2. Use environment variables instead\n');
    output += chalk.cyan('  3. Add secrets to .env file and .gitignore\n');
    
    return output;
  }
}

module.exports = APIKeyGuardian;