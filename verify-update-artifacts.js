const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const releaseDir = path.join(__dirname, 'release');
const latestYmlPath = path.join(releaseDir, 'latest.yml');

function fail(message) {
  console.error(`\n[verify:updates] ERROR: ${message}\n`);
  process.exit(1);
}

function readRequiredFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing required file: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function parseLatestYml(content) {
  const versionMatch = content.match(/^version:\s*(.+)$/m);
  const pathMatch = content.match(/^path:\s*(.+)$/m);
  const shaMatch = content.match(/^sha512:\s*(.+)$/m);
  const sizeMatch = content.match(/^\s*size:\s*(\d+)\s*$/m);

  if (!versionMatch || !pathMatch || !shaMatch) {
    fail('latest.yml is missing one of required keys: version, path, sha512');
  }

  return {
    version: versionMatch[1].trim(),
    installerName: pathMatch[1].trim(),
    sha512: shaMatch[1].trim(),
    size: sizeMatch ? Number(sizeMatch[1]) : null,
  };
}

function isGitLfsPointer(filePath) {
  const raw = fs.readFileSync(filePath);
  const peek = raw.subarray(0, 256).toString('utf8');
  return peek.startsWith('version https://git-lfs.github.com/spec/v1');
}

function sha512Base64(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha512').update(data).digest('base64');
}

function ensureNotPointer(filePath) {
  if (isGitLfsPointer(filePath)) {
    fail(`Git LFS pointer detected instead of binary artifact: ${filePath}`);
  }
}

(function main() {
  const latestYml = readRequiredFile(latestYmlPath);
  const parsed = parseLatestYml(latestYml);

  const installerPath = path.join(releaseDir, parsed.installerName);
  const blockmapPath = `${installerPath}.blockmap`;

  if (!fs.existsSync(installerPath)) {
    fail(`Installer referenced in latest.yml does not exist: ${installerPath}`);
  }

  if (!fs.existsSync(blockmapPath)) {
    fail(`Blockmap file is missing: ${blockmapPath}`);
  }

  ensureNotPointer(installerPath);
  ensureNotPointer(blockmapPath);

  const computedSha = sha512Base64(installerPath);
  if (computedSha !== parsed.sha512) {
    fail(
      `SHA-512 mismatch for ${parsed.installerName}. latest.yml=${parsed.sha512} computed=${computedSha}`,
    );
  }

  if (parsed.size !== null) {
    const actualSize = fs.statSync(installerPath).size;
    if (actualSize !== parsed.size) {
      fail(`Size mismatch for ${parsed.installerName}. latest.yml=${parsed.size} actual=${actualSize}`);
    }
  }

  console.log('[verify:updates] OK');
  console.log(`[verify:updates] version=${parsed.version}`);
  console.log(`[verify:updates] installer=${parsed.installerName}`);
})();
