# API Key Guardian

![API Key Guardian](https://img.shields.io/badge/security-api--key--guardian-green)

Prevents accidental exposure of API keys and secrets in your codebase by scanning files and blocking commits/pushes if secrets are found.

## Features
- Detects API keys, secrets, tokens, and database URIs in your project
- Blocks git commits and pushes if secrets are found
- Supports custom patterns and ignore rules
- Fast scanning, even for large projects

## Installation

Install globally (recommended):
```sh
npm install -g api-key-guardian
```
Or use with npx (no install needed):
```sh
npx api-key-guardian --scan-all
```

## Usage

### Scan the entire project
```sh
npx api-key-guardian --scan-all
```

### Scan specific files or folders
```sh
npx api-key-guardian src/config.js
npx api-key-guardian src/
```

### Install git hooks (pre-commit & pre-push)
```sh
npx api-key-guardian --install-hooks
# or
npm run install-hooks
```
This will block commits and pushes if secrets are detected.

### Show current configuration
```sh
npx api-key-guardian --config
```

### Show help
```sh
npx api-key-guardian --help
```

## Configuration

Create a `.apiguardian.json` file in your project root to customize ignored files, extensions, and patterns:
```json
{
  "ignoredFiles": [
    ".git/",
    "node_modules/",
    "dist/",
    "build/",
    ".next/",
    ".env.example",
    "*.log"
  ],
  "ignoredExtensions": [
    ".jpg", ".png", ".gif", ".pdf", ".zip", ".tar.gz"
  ],
  "customPatterns": [
    {
      "name": "Custom API Key",
      "pattern": "/custom_api_key_[a-zA-Z0-9]{32}/",
      "severity": "high"
    }
  ]
}
```

## Example Output
```
```
## License
MIT
