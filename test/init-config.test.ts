import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initConfigAction } from '../src/project/init-config.ts';

// README "Init Config": an existing file is opened, not rewritten; in an untrusted
// workspace the command refuses and writes nothing.

test('a trusted workspace gets its config written, or the one there opened', () => {
  assert.equal(initConfigAction(true, false), 'write');
  assert.equal(initConfigAction(true, true), 'open');
});

test('an untrusted workspace is refused, whether a config is there or not', () => {
  assert.equal(initConfigAction(false, false), 'refuse');
  assert.equal(initConfigAction(false, true), 'refuse');
});
