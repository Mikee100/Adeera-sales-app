# SaaS POS

Desktop Point of Sale application built with Electron and React for the Adeera SaaS platform.

## Quick Start

### I want to download and install the POS

Use the latest GitHub Release:

- Releases page: https://github.com/Mikee100/Adeera-sales-app/releases

Download the installer file:

- SaaS POS Setup <version>.exe

Then:

1. Run the installer.
2. Allow Windows permissions if prompted.
3. Launch Adeera POS from Start Menu or Desktop.

## For Maintainers: Publish a Click-to-Download Link

This repo has an automated release workflow:

- .github/workflows/release-windows.yml

When a release is created, GitHub hosts downloadable assets automatically.

### Option A: Release by Git tag (recommended)

```bash
git tag v1.0.1
git push origin v1.0.1
```

### Option B: Release manually from GitHub Actions

1. Open Actions in GitHub.
2. Run workflow Release Windows Installer.
3. Enter a tag, for example v1.0.1.

### What gets uploaded to the GitHub Release

- release/SaaS POS Setup <version>.exe
- release/SaaS POS Setup <version>.exe.blockmap
- release/latest.yml

### Shareable link pattern

Use this direct link format after release:

https://github.com/Mikee100/Adeera-sales-app/releases/download/v1.0.1/SaaS%20POS%20Setup%201.0.1.exe

## Remote Updates (Stable and Beta)

The POS now supports update channels in Settings > System > App Updates:

- stable: Production clients
- beta: Pilot clients

Recommended flow:

1. Publish to beta feed first.
2. Validate with pilot clients.
3. Promote same build to stable feed.

See full operational guide:

- REMOTE_UPDATE_ROLLOUT_PLAYBOOK.md

## Local Build and Packaging

Run commands inside the sales-app folder.

### Install dependencies

```bash
npm install
```

### Run development mode

```bash
npm run dev
```

### Build production bundles

```bash
npm run build
```

### Build Windows installer

```bash
npm run package:win
```

### Build and copy update artifacts to backend

```bash
npm run release:win
```

This command runs packaging, then copies latest.yml, exe, and blockmap files to:

- ../backend/uploads/pos-updates/

## Common Commands

- npm run start: Launch built app
- npm run dev: Run Electron in dev mode
- npm run build: Build production bundles
- npm run package: Package for current platform
- npm run package:win: Build Windows installer
- npm run package:mac: Build macOS package
- npm run package:linux: Build Linux package
- npm run deploy:updates: Copy update artifacts to backend folder
- npm run release:win: Build Windows installer and copy update artifacts

## Configuration

Set these environment values as needed:

- API_BASE_URL: Base URL of backend API
- WS_BASE_URL: Base URL of websocket server
- NODE_ENV: development or production

## Architecture Summary

- src/main: Electron main process
- src/renderer: React UI
- src/shared: Shared config and utilities

## Troubleshooting

### Installer build hangs or fails

1. Delete old build output in the release folder.
2. Run npm install again.
3. Run npm run package:win and wait for completion.

### App cannot connect to backend

1. Verify API_BASE_URL and WS_BASE_URL.
2. Check backend server is reachable.
3. Confirm firewall or proxy is not blocking traffic.

### Auto-update not working

1. Ensure latest.yml and blockmap are published with the exe.
2. Confirm update URL in package.json build.win.publish.url is correct.
3. Ensure hosted files are reachable over HTTPS.

## Production Checklist

1. Bump app version before release.
2. Build and publish through GitHub Release workflow.
3. Test install on a clean Windows machine.
4. Test update from previous version to new version.
5. Code-sign installer for better Windows trust prompts.

## License

Part of the SaaS Platform project and follows the same licensing terms.
