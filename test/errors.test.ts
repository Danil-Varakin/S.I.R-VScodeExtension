import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SirServiceError,
  ProtocolMismatchError,
  RequestCancelledError,
  RequestTimeoutError,
  UnsupportedDocumentError,
  errorMessage,
} from '../src/errors.ts';
import { describeRange, originKind } from '../src/service/protocol.ts';

// What the errors say to the person. These sentences are shown as they are — in the
// status bar tooltip, a notification, a problem in the patch view — so the text is the
// contract, not a detail. The class names are for the log only and are not checked.

test('a thrown Error is shown by its message, anything else as text', () => {
  assert.equal(errorMessage(new Error('the core is gone')), 'the core is gone');
  assert.equal(errorMessage('plain text'), 'plain text');
  assert.equal(errorMessage(42), '42');
});

test('the line of a synthesis error is read only when the core gave a number', () => {
  const error = (detail?: Record<string, unknown>): SirServiceError =>
    new SirServiceError({ kind: 'SynthesisError', message: 'm', exitCode: 1, ...(detail ? { detail } : {}) });
  assert.equal(error({ newLine: 7, mdLine: 3 }).newLine, 7);
  assert.equal(error({ newLine: 7, mdLine: 3 }).mdLine, 3);
  assert.equal(error({ newLine: '7' }).newLine, undefined, 'a string is not a line');
  assert.equal(error().newLine, undefined, 'no detail at all');
});

test('a timeout and a cancel name the request; a timeout, how long it waited', () => {
  assert.equal(new RequestTimeoutError('resolve', 60_000).message, "no response to 'resolve' within 60000 ms");
  assert.equal(new RequestCancelledError('generate').message, "request 'generate' cancelled");
});

test('a document that is not a file says which scheme it has', () => {
  assert.equal(
    new UnsupportedDocumentError('untitled').message,
    "sir works on files on disk, this document uses the 'untitled' scheme",
  );
});

test('a protocol mismatch names both ranges, and which side to update', () => {
  const old = new ProtocolMismatchError({ min: 4, max: 5 }, { min: 3, max: 3 }, '0.3.0');
  assert.equal(old.message, 'sir 0.3.0 speaks protocol 3, this extension needs 4–5; update sir');
  const newer = new ProtocolMismatchError({ min: 4, max: 5 }, { min: 6, max: 9 }, '9.0.0');
  assert.equal(newer.message, 'sir 9.0.0 serves protocol 6–9, this extension knows 4–5; update the extension');
});

test('a range of one protocol is written as one number, a wider one as min–max', () => {
  assert.equal(describeRange({ min: 5, max: 5 }), '5');
  assert.equal(describeRange({ min: 4, max: 5 }), '4–5');
});

test('where a setting came from is read off the first word of its origin', () => {
  assert.equal(originKind('default'), 'default');
  assert.equal(originKind('config /w/sir.config.json'), 'config');
  assert.equal(originKind('config'), 'config');
  assert.equal(originKind('flag --eol'), 'flag');
  assert.equal(originKind('workspace'), 'other');
  assert.equal(originKind(''), 'other');
});
