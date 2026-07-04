const crypto = require('crypto');
const http = require('http');
const https = require('https');

function fail(message) {
  console.error(`\n[verify:updates:remote] ERROR: ${message}\n`);
  process.exit(1);
}

function normalizeBaseUrl(input) {
  if (!input || typeof input !== 'string') {
    fail('A feed URL is required. Example: node verify-remote-update-feed.js https://saas-business.duckdns.org/updates/pos');
  }

  return input.trim().replace(/\/+$/, '');
}

function fetchBuffer(url) {
  const client = url.startsWith('https://') ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.get(url, (res) => {
      const status = res.statusCode || 0;
      if (status < 200 || status >= 300) {
        reject(new Error(`Request failed (${status}) for ${url}`));
        res.resume();
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    request.on('error', reject);
    request.setTimeout(60000, () => {
      request.destroy(new Error(`Request timed out for ${url}`));
    });
  });
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

function isGitLfsPointer(buffer) {
  const peek = buffer.subarray(0, 256).toString('utf8');
  return peek.startsWith('version https://git-lfs.github.com/spec/v1');
}

function sha512Base64(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('base64');
}

async function main() {
  const baseUrl = normalizeBaseUrl(process.argv[2] || 'https://saas-business.duckdns.org/updates/pos');
  const latestUrl = `${baseUrl}/latest.yml`;

  const latestRaw = await fetchBuffer(latestUrl);
  const latestText = latestRaw.toString('utf8');
  const latest = parseLatestYml(latestText);

  const installerUrl = `${baseUrl}/${encodeURIComponent(latest.installerName)}`;
  const installerRaw = await fetchBuffer(installerUrl);

  if (isGitLfsPointer(installerRaw)) {
    fail(`Installer URL is serving a Git LFS pointer instead of a binary: ${installerUrl}`);
  }

  const computedSha = sha512Base64(installerRaw);
  if (computedSha !== latest.sha512) {
    fail(
      `SHA-512 mismatch for remote installer. latest.yml=${latest.sha512} downloaded=${computedSha} url=${installerUrl}`,
    );
  }

  if (latest.size !== null && installerRaw.length !== latest.size) {
    fail(
      `Size mismatch for remote installer. latest.yml=${latest.size} downloaded=${installerRaw.length} url=${installerUrl}`,
    );
  }

  console.log('[verify:updates:remote] OK');
  console.log(`[verify:updates:remote] feed=${baseUrl}`);
  console.log(`[verify:updates:remote] version=${latest.version}`);
  console.log(`[verify:updates:remote] installer=${latest.installerName}`);
}

main().catch((error) => {
  fail(error.message || String(error));
});
