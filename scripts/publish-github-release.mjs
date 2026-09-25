import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';

function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try {
    const creds = execSync('git credential fill', {
      input: 'protocol=https\nhost=github.com\n\n',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).toString();
    const line = creds.split('\n').find((l) => l.startsWith('password='));
    if (line) return line.substring('password='.length).trim();
  } catch (err) {
    // ignore
  }
  return null;
}

function requestGithub(pathname, method = 'GET', data = null, headers = {}) {
  const token = getGitHubToken();
  if (!token) throw new Error('No GitHub credential or GITHUB_TOKEN found.');

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: pathname,
      method,
      headers: {
        'User-Agent': 'Gridiron-Release-Automation',
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        ...headers,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body || '{}'));
          } catch {
            resolve(body);
          }
        } else {
          reject(new Error(`GitHub API error ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uploadAsset(uploadUrlTemplate, filePath, fileName) {
  const token = getGitHubToken();
  const fileBuffer = fs.readFileSync(filePath);
  const uploadUrl = uploadUrlTemplate.replace(/\{[^\}]+\}/g, '') + `?name=${encodeURIComponent(fileName)}`;
  const urlObj = new URL(uploadUrl);

  console.log(`Uploading ${fileName} (${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB)...`);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'User-Agent': 'Gridiron-Release-Automation',
        'Authorization': `token ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileBuffer.length,
      },
    }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body || '{}'));
          } catch {
            resolve(body);
          }
        } else {
          reject(new Error(`Asset upload error ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const version = pkg.version;
  const tagName = `v${version}`;
  const repoOwner = 'GenNowGamer';
  const repoName = 'Gridiron-OC-PC';

  console.log(`Targeting release ${tagName} for ${repoOwner}/${repoName}...`);

  // Ensure Git tag exists locally and is pushed
  try {
    execSync(`git tag -a ${tagName} -m "Release ${tagName}"`, { stdio: 'ignore' });
  } catch {
    console.log(`Tag ${tagName} already exists locally.`);
  }

  console.log(`Pushing tag ${tagName} to origin...`);
  execSync(`git push origin ${tagName}`, { stdio: 'inherit' });

  // Locate the installer exe
  const exeName = `Gridiron Play Advisor Setup ${version}.exe`;
  const exePath = path.join('dist', exeName);
  if (!fs.existsSync(exePath)) {
    throw new Error(`Installer executable not found at ${exePath}`);
  }

  // Create GitHub release via API
  console.log(`Creating GitHub release ${tagName}...`);
  const releasePayload = JSON.stringify({
    tag_name: tagName,
    name: `v${version}`,
    body: `Gridiron Play Advisor PC Release ${version}\n\nAutomated release build with verified OCR corrections, defensive learning gates, and selection engine enhancements.`,
    draft: false,
    prerelease: false,
  });

  let release;
  try {
    release = await requestGithub(`/repos/${repoOwner}/${repoName}/releases`, 'POST', releasePayload, {
      'Content-Type': 'application/json',
    });
  } catch (err) {
    if (err.message.includes('already_exists')) {
      console.log(`Release ${tagName} already exists. Fetching existing release...`);
      release = await requestGithub(`/repos/${repoOwner}/${repoName}/releases/tags/${tagName}`);
    } else {
      throw err;
    }
  }

  console.log(`Release URL: ${release.html_url}`);

  // Upload installer asset
  await uploadAsset(release.upload_url, exePath, exeName);
  console.log(`Successfully uploaded ${exeName} to GitHub Release ${tagName}!`);
}

main().catch((err) => {
  console.error('Release failed:', err.message);
  process.exit(1);
});
