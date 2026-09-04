import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeById,
  sanitizeSources,
} from '@/lib/server/global-sources';

test('dedupeById drops duplicate ids keeping the first occurrence', () => {
  const clientSource = { id: 's1', name: 'Client S1', baseUrl: 'https://client', searchPath: '/provide/vod', detailPath: '/provide/vod' };
  const globalSource = { id: 's1', name: 'Global S1', baseUrl: 'https://global', searchPath: '/provide/vod', detailPath: '/provide/vod' };
  const uniqueGlobal = { id: 's2', name: 'Global S2', baseUrl: 'https://global2', searchPath: '/provide/vod', detailPath: '/provide/vod' };

  const merged = dedupeById([clientSource, globalSource, uniqueGlobal]);

  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], clientSource);
  assert.deepEqual(merged[1], uniqueGlobal);
});

test('dedupeById handles empty and undefined inputs gracefully', () => {
  assert.deepEqual(dedupeById([]), []);
});

test('dedupeById drops entries without an id', () => {
  const withId = { id: 's1', name: 'S1', baseUrl: 'https://s1', searchPath: '/provide/vod', detailPath: '/provide/vod' };
  const withoutId = { name: 'NoId', baseUrl: 'https://noid' };

  const merged = dedupeById([withId, withoutId as never]);

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], withId);
});

test('sanitizeSources drops entries missing baseUrl', () => {
  const valid = { id: 's1', name: 'S1', baseUrl: 'https://s1' };
  const noBaseUrl = { id: 's2', name: 'S2' };

  const sanitized = sanitizeSources([valid, noBaseUrl, null, 'string']);

  assert.equal(sanitized.length, 1);
  assert.deepEqual(sanitized[0], valid);
});

test('sanitizeSources returns [] for non-array input', () => {
  assert.deepEqual(sanitizeSources(null), []);
  assert.deepEqual(sanitizeSources(undefined), []);
  assert.deepEqual(sanitizeSources({}), []);
});
