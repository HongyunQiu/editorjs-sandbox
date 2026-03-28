const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePath } = require('@zenfs/core');

function resolveSandboxPath(path, basePath = '') {
  const rawPath = String(path || '');
  const normalizedBasePath = normalizePath(basePath || '/');

  if (!rawPath) {
    return normalizedBasePath;
  }

  if (rawPath.startsWith('/')) {
    return normalizePath(rawPath);
  }

  const normalizedPath = rawPath.replace(/\\/g, '/').replace(/^\.?\//, '');
  return normalizePath(`${normalizedBasePath}/${normalizedPath}`);
}

test('relative file keeps sandbox cwd', () => {
  assert.equal(resolveSandboxPath('hello.js', '/workspace'), '/workspace/hello.js');
  assert.equal(resolveSandboxPath('./hello.js', '/workspace'), '/workspace/hello.js');
});

test('nested relative paths stay under cwd', () => {
  assert.equal(resolveSandboxPath('dir/test.js', '/workspace'), '/workspace/dir/test.js');
  assert.equal(resolveSandboxPath('../shared.js', '/workspace/demo'), '/workspace/shared.js');
});

test('absolute paths remain absolute', () => {
  assert.equal(resolveSandboxPath('/workspace/hello.js', '/workspace'), '/workspace/hello.js');
});

test('documents zenfs normalizePath behavior that caused the regression', () => {
  assert.equal(normalizePath('hello.js'), '/hello.js');
});
