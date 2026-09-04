import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import process from 'node:process';

const BROWSER_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

function readBrowserSource(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return readBrowserSource(path);
      if (!BROWSER_EXTENSIONS.has(extname(entry.name))) return [];
      return [`\n// ${path}\n${readFileSync(path, 'utf8')}`];
    })
    .join('');
}

const browserSource = readBrowserSource(join(process.cwd(), 'src'));
const userManagement = readFileSync(
  join(process.cwd(), 'src/pages/UserManagement.jsx'),
  'utf8',
);

test('browser code cannot directly delete a User entity', () => {
  assert.doesNotMatch(
    browserSource,
    /entities\.User\.delete\s*\(/,
    'Permanent User deletion must not be reachable through the browser SDK.',
  );
});

test('UserManagement does not expose permanent User deletion controls', () => {
  assert.doesNotMatch(userManagement, /deleteUserMutation|handleDeleteUser|confirmDeleteUser|showDeleteDialog/);
  assert.doesNotMatch(userManagement, /Delete User Permanently|Delete user permanently/);
});

test('UserManagement retains the supported offboarding path', () => {
  assert.match(userManagement, /buildOffboardInvokeArgs/);
  assert.match(userManagement, /Disable \/ Offboard User/);
});
