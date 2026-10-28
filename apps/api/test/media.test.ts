import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '../src/media.js';

test('local private media rejects absolute/traversal keys and never overwrites an existing object', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'splint-media-test-')); const store = new LocalMediaStore(directory);
  try {
    for (const key of ['/etc/passwd', '../outside.json', 'canonical/../outside.json', 'canonical/./test.json']) {
      await assert.rejects(store.get(key), /Invalid media key/);
      await assert.rejects(store.put(key, Buffer.from('blocked')), /Invalid media key/);
    }
    await store.put('canonical/test.json', Buffer.from('original'));
    await store.put('canonical/test.json', Buffer.from('original'));
    await assert.rejects(store.put('canonical/test.json', Buffer.from('changed')), /Immutable media conflict/);
    assert.equal((await store.get('canonical/test.json')).toString(), 'original');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
