import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const port = Number(process.env.PORT ?? 3210);
const immichUrl = process.env.IMMICH_URL?.replace(/\/$/, '');
const apiKey = process.env.IMMICH_API_KEY;
const appUsername = process.env.APP_USERNAME;
const appPassword = process.env.APP_PASSWORD;
const hashConcurrency = Math.max(1, Math.min(8, Number(process.env.HASH_CONCURRENCY ?? 2)));
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
let scanJob = null;
const execFileAsync = promisify(execFile);

if (!immichUrl || !apiKey || !appUsername || !appPassword) {
  throw new Error('IMMICH_URL, IMMICH_API_KEY, APP_USERNAME, and APP_PASSWORD are required');
}

const secureEqual = (left, right) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

const authorized = (request) => {
  const value = request.headers.authorization;
  if (!value?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(value.slice(6), 'base64').toString();
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  return secureEqual(username, appUsername) && secureEqual(password, appPassword);
};

const immichSearch = async (type, onProgress) => {
  const assets = [];
  let page = 1;

  while (true) {
    const response = await fetch(`${immichUrl}/api/search/metadata`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ type, page, size: 1000, withExif: true, withStacked: true }),
    });
    if (!response.ok) throw new Error(`Immich search failed (${response.status}): ${await response.text()}`);
    const result = await response.json();
    assets.push(
      ...result.assets.items.map((asset) => ({
        id: asset.id,
        originalFileName: asset.originalFileName,
        originalPath: asset.originalPath,
        libraryId: asset.libraryId,
        fileSizeInByte: asset.exifInfo?.fileSizeInByte ?? null,
        fileCreatedAt: asset.fileCreatedAt,
        // The public AssetResponseDto does not expose isExternal or
        // checksumAlgorithm. Uploaded assets have no libraryId; external
        // library assets always reference their library.
        isExternal: asset.libraryId != null,
        checksum: asset.checksum,
      })),
    );
    // On current Immich builds, the deprecated `total` field can contain the
    // page size rather than the full match count. Keep progress indeterminate
    // until the last page instead of displaying misleading values.
    onProgress(assets.length, result.assets.nextPage ? null : assets.length);
    if (!result.assets.nextPage) break;
    page = Number(result.assets.nextPage);
  }

  return assets;
};

const assetSummary = (asset) => ({
  id: asset.id,
  name: asset.originalFileName,
  path: asset.originalPath,
  libraryId: asset.libraryId,
  size: asset.fileSizeInByte,
  createdAt: asset.fileCreatedAt,
  isExternal: asset.isExternal,
});

const addGroup = (groups, key, algorithm, checksum, asset) => {
  const group = groups.get(key) ?? { algorithm, checksum, assets: [] };
  group.assets.push(assetSummary(asset));
  groups.set(key, group);
};

const b3sum = async (path) => {
  const { stdout } = await execFileAsync('b3sum', [path], { maxBuffer: 1024 * 1024 });
  return stdout.trim().split(/\s+/, 1)[0];
};

const mapConcurrent = async (items, concurrency, handler) => {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await handler(items[index], index);
    }
  });
  await Promise.all(workers);
};

const exactGroups = async (assets, job) => {
  const groups = new Map();
  const externalBySize = new Map();
  let unreadableExternal = 0;

  for (const [index, asset] of assets.entries()) {
    if (asset.isExternal) {
      let bytes = asset.fileSizeInByte;
      if (bytes == null) {
        try {
          bytes = (await stat(asset.originalPath)).size;
        } catch {
          unreadableExternal++;
          continue;
        }
      }
      const candidates = externalBySize.get(bytes) ?? [];
      candidates.push(asset);
      externalBySize.set(bytes, candidates);
      continue;
    }
    addGroup(groups, `sha1:${asset.checksum}`, 'SHA-1', asset.checksum, asset);
    if (index % 1000 === 0) Object.assign(job, { processed: index + 1, total: assets.length });
  }

  job.stage = 'Filtering external candidates by size';
  job.processed = assets.length;
  job.total = assets.length;
  const externalCandidates = [...externalBySize.values()].filter((matches) => matches.length > 1).flat();

  job.stage = 'Hashing external candidates with BLAKE3';
  job.processed = 0;
  job.total = externalCandidates.length;
  let hashed = 0;
  await mapConcurrent(externalCandidates, hashConcurrency, async (asset) => {
    try {
      const checksum = await b3sum(asset.originalPath);
      addGroup(groups, `b3:${checksum}`, 'BLAKE3', checksum, asset);
    } catch {
      unreadableExternal++;
    } finally {
      job.processed = ++hashed;
    }
  });

  return {
    externalAssets: assets.filter((asset) => asset.isExternal).length,
    externalCandidates: externalCandidates.length,
    unreadableExternal,
    groups: [...groups.values()]
      .filter(({ assets: matches }) => matches.length > 1)
      .sort((a, b) => b.assets.length - a.assets.length),
  };
};

const runScan = async (job) => {
  try {
    job.stage = 'Loading asset metadata';
    const assets = await immichSearch(job.type, (processed, total) => Object.assign(job, { processed, total }));
    job.stage = 'Grouping exact checksums';
    job.processed = 0;
    job.total = assets.length;
    const result = await exactGroups(assets, job);
    job.result = { type: job.type, scanned: assets.length, ...result };
    job.status = 'complete';
    job.stage = 'Complete';
  } catch (error) {
    job.status = 'failed';
    job.stage = 'Failed';
    job.error = error instanceof Error ? error.message : String(error);
  } finally {
    job.finishedAt = new Date().toISOString();
  }
};

const server = createServer(async (request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return response.end('ok');
  }

  if (!authorized(request)) {
    response.writeHead(401, { 'www-authenticate': 'Basic realm="Immich exact duplicates"' });
    return response.end('Authentication required');
  }

  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/api/scans/current' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return response.end(JSON.stringify(scanJob));
    }

    if (url.pathname === '/api/scans' && request.method === 'POST') {
      if (scanJob?.status === 'running') {
        response.writeHead(409, { 'content-type': 'application/json; charset=utf-8' });
        return response.end(JSON.stringify({ error: 'A scan is already running', job: scanJob }));
      }

      const body = await new Promise((resolve, reject) => {
        let value = '';
        request.on('data', (chunk) => (value += chunk));
        request.on('end', () => {
          try {
            resolve(value ? JSON.parse(value) : {});
          } catch (error) {
            reject(error);
          }
        });
        request.on('error', reject);
      });
      scanJob = {
        id: crypto.randomUUID(),
        status: 'running',
        type: body.type === 'IMAGE' ? 'IMAGE' : 'VIDEO',
        stage: 'Starting',
        processed: 0,
        total: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        result: null,
        error: null,
      };
      setImmediate(() => void runScan(scanJob));
      response.writeHead(202, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return response.end(JSON.stringify(scanJob));
    }

    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!['index.html', 'app.css', 'app.js'].includes(file)) {
      response.writeHead(404);
      return response.end('Not found');
    }
    const contentTypes = { 'index.html': 'text/html', 'app.css': 'text/css', 'app.js': 'text/javascript' };
    response.writeHead(200, { 'content-type': `${contentTypes[file]}; charset=utf-8` });
    response.end(await readFile(`${publicDir}/${file}`));
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, () => console.log(`Immich exact duplicates listening on http://0.0.0.0:${port}`));
