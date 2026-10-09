import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceMode } from '../lib/workspace.ts';

test('loopback workspaces work without server configuration', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) assert.equal(workspaceMode(new URL(`http://${host}:5173/`)), 'local');
});
test('shared workspaces require an exact configured origin', () => {
  const configured = 'http://192.0.2.10:3356, https://skills.example.com';
  assert.equal(workspaceMode(new URL('http://192.0.2.10:3356/api/v1/skills'), configured), 'shared');
  assert.equal(workspaceMode(new URL('https://skills.example.com/'), configured), 'shared');
  for (const origin of ['http://192.0.2.10:3357', 'https://192.0.2.10:3356', 'https://skills.example.com.evil.test', 'http://other.example.com']) assert.equal(workspaceMode(new URL(origin), configured), null);
  assert.equal(workspaceMode(new URL('http://192.0.2.10:3356/')), null);
});
