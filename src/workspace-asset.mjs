import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const WORKSPACE_ROOT = '/workspace/';

export function ensureWorkspacePrefix(path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  if (raw.startsWith(WORKSPACE_ROOT)) return raw;
  if (raw.startsWith('/')) return `/workspace${raw}`;
  return `${WORKSPACE_ROOT}${raw.replace(/^\.?\//, '')}`;
}

export function normalizeWorkspaceFiles(input) {
  const source = input && typeof input === 'object' ? input : {};
  const next = {};
  Object.keys(source).forEach((path) => {
    const normalizedPath = ensureWorkspacePrefix(path);
    if (!normalizedPath) return;
    next[normalizedPath] = String(source[path] == null ? '' : source[path]);
  });
  return next;
}

export function buildWorkspaceManifest(input) {
  const files = normalizeWorkspaceFiles(input);
  return Object.keys(files)
    .sort()
    .map((path) => ({
      path,
      size: files[path].length,
    }));
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function buildWorkspaceSignaturePayload(input) {
  const files = normalizeWorkspaceFiles(input);
  const entries = Object.keys(files)
    .sort()
    .map((path) => ({
      path,
      content: files[path],
    }));
  return stableStringify(entries);
}

export async function sha256Hex(text) {
  const value = typeof text === 'string' ? text : String(text || '');
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== 'function') {
    throw new Error('Web Crypto API is unavailable');
  }
  const buffer = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function packWorkspaceFiles(input) {
  const files = normalizeWorkspaceFiles(input);
  const zipEntries = {};
  Object.keys(files)
    .sort()
    .forEach((path) => {
      const zipPath = path.replace(/^\/+/, '');
      zipEntries[zipPath] = strToU8(files[path]);
    });
  return zipSync(zipEntries, { level: 9 });
}

export function unpackWorkspaceArchive(bufferLike) {
  const archiveBytes = bufferLike instanceof Uint8Array
    ? bufferLike
    : new Uint8Array(bufferLike || []);
  const unzipped = unzipSync(archiveBytes);
  const files = {};
  Object.keys(unzipped).forEach((zipPath) => {
    if (!zipPath || zipPath.endsWith('/')) return;
    const normalizedPath = ensureWorkspacePrefix(zipPath.replace(/^workspace\//, ''));
    if (!normalizedPath) return;
    files[normalizedPath] = strFromU8(unzipped[zipPath]);
  });
  return normalizeWorkspaceFiles(files);
}
