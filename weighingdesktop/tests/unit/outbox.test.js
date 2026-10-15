const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createOutbox } = require('../../electron/outbox');

// In-memory stand-in for the outbox file; `saved` is what is "on disk".
function memoryFile(initial) {
  const file = {
    saved: initial === undefined ? [] : JSON.parse(JSON.stringify(initial)),
    writes: 0,
    read: () => JSON.parse(JSON.stringify(file.saved)),
    write: (value) => { file.saved = JSON.parse(JSON.stringify(value)); file.writes += 1; },
  };
  return file;
}

describe('outbox — queuing', () => {
  it('persists every change immediately', () => {
    const file = memoryFile();
    const outbox = createOutbox({ file });
    outbox.enqueueCreate('r1', { crop: 'Maize' });
    assert.equal(file.saved.length, 1);
    assert.equal(file.saved[0].type, 'create');
    assert.equal(file.saved[0].state, 'pending');
  });

  it('survives a restart: a new outbox over the same file still holds the change', () => {
    const file = memoryFile();
    createOutbox({ file }).enqueueUpdate('r1', 3, { gene: 'Rf1' });
    const reopened = createOutbox({ file });
    assert.equal(reopened.size(), 1);
    assert.deepEqual(reopened.nextSendable().fields, { gene: 'Rf1' });
    assert.equal(reopened.nextSendable().baseVersion, 3);
  });

  it('an op interrupted mid-send is sendable again after a restart', () => {
    const file = memoryFile();
    const first = createOutbox({ file });
    first.enqueueCreate('r1', { crop: 'Maize' });
    first.markInFlight(first.nextSendable().opId);
    assert.equal(first.nextSendable(), null);
    const reopened = createOutbox({ file });
    assert.equal(reopened.nextSendable().recordId, 'r1');
  });
});

describe('outbox — coalescing', () => {
  it('several edits to one record become one update with the original baseVersion', () => {
    const outbox = createOutbox({ file: memoryFile() });
    outbox.enqueueUpdate('r1', 3, { gene: 'A' });
    outbox.enqueueUpdate('r1', 3, { gene: 'B', comments: 'note' });
    assert.equal(outbox.size(), 1);
    const op = outbox.nextSendable();
    assert.deepEqual(op.fields, { gene: 'B', comments: 'note' });
    assert.equal(op.baseVersion, 3);
  });

  it('an edit to a record that is still an unsent create is folded into the create', () => {
    const outbox = createOutbox({ file: memoryFile() });
    outbox.enqueueCreate('r1', { crop: 'Maize' });
    outbox.enqueueUpdate('r1', null, { gene: 'Rf1' });
    assert.equal(outbox.size(), 1);
    const op = outbox.nextSendable();
    assert.equal(op.type, 'create');
    assert.deepEqual(op.fields, { crop: 'Maize', gene: 'Rf1' });
  });

  it('an edit made while the previous change is in flight queues behind it with an open baseVersion', () => {
    const outbox = createOutbox({ file: memoryFile() });
    outbox.enqueueUpdate('r1', 3, { gene: 'A' });
    const first = outbox.nextSendable();
    outbox.markInFlight(first.opId);
    outbox.enqueueUpdate('r1', 3, { gene: 'B' });
    assert.equal(outbox.size(), 2);
    assert.equal(outbox.nextSendable(), null, 'second op must wait for the first');
    outbox.complete(first.opId);
    const second = outbox.nextSendable();
    assert.deepEqual(second.fields, { gene: 'B' });
    assert.equal(second.baseVersion, null);
  });

  it('edits to different records stay separate, oldest first', () => {
    const outbox = createOutbox({ file: memoryFile() });
    outbox.enqueueUpdate('r1', 1, { gene: 'A' });
    outbox.enqueueUpdate('r2', 1, { gene: 'B' });
    assert.equal(outbox.size(), 2);
    assert.equal(outbox.nextSendable().recordId, 'r1');
  });
});

describe('outbox — outcomes', () => {
  it('complete() removes the change; release() keeps it queued untouched', () => {
    const outbox = createOutbox({ file: memoryFile() });
    outbox.enqueueCreate('r1', { crop: 'Maize' });
    const op = outbox.nextSendable();
    outbox.markInFlight(op.opId);
    outbox.release(op.opId);
    assert.equal(outbox.size(), 1);
    assert.equal(outbox.nextSendable().attempts, 1);
    assert.equal(outbox.nextSendable().state, 'pending');
    outbox.complete(op.opId);
    assert.equal(outbox.size(), 0);
  });

  it('a conflicted record holds back its own later changes but not other records', () => {
    const outbox = createOutbox({ file: memoryFile() });
    outbox.enqueueUpdate('r1', 1, { gene: 'A' });
    outbox.enqueueUpdate('r2', 1, { gene: 'B' });
    const first = outbox.nextSendable();
    outbox.markInFlight(first.opId);
    outbox.fail(first.opId, { state: 'conflict', message: 'changed', conflictRecord: { recordId: 'r1', version: 5 } });
    assert.equal(outbox.nextSendable().recordId, 'r2');
    assert.deepEqual(outbox.counts(), { pending: 1, error: 0, conflict: 1 });
  });

  it('resolveConflict("mine") re-bases on the server version and makes it sendable', () => {
    const outbox = createOutbox({ file: memoryFile() });
    outbox.enqueueUpdate('r1', 1, { gene: 'A' });
    const op = outbox.nextSendable();
    outbox.markInFlight(op.opId);
    outbox.fail(op.opId, { state: 'conflict', message: 'changed', conflictRecord: { recordId: 'r1', version: 5 } });
    assert.equal(outbox.resolveConflict('r1', 'mine'), true);
    const again = outbox.nextSendable();
    assert.equal(again.baseVersion, 5);
    assert.equal(again.state, 'pending');
    assert.deepEqual(again.fields, { gene: 'A' });
  });

  it('resolveConflict("server") drops my change', () => {
    const outbox = createOutbox({ file: memoryFile() });
    outbox.enqueueUpdate('r1', 1, { gene: 'A' });
    const op = outbox.nextSendable();
    outbox.markInFlight(op.opId);
    outbox.fail(op.opId, { state: 'conflict', message: 'changed', conflictRecord: { recordId: 'r1', version: 5 } });
    assert.equal(outbox.resolveConflict('r1', 'server'), true);
    assert.equal(outbox.size(), 0);
  });

  it('a rejected change waits as an error until retried, corrected or discarded', () => {
    const outbox = createOutbox({ file: memoryFile() });
    outbox.enqueueUpdate('r1', 1, { yield1: 5 });
    const op = outbox.nextSendable();
    outbox.markInFlight(op.opId);
    outbox.fail(op.opId, { state: 'error', message: 'Record is empty' });
    assert.equal(outbox.nextSendable(), null);
    assert.deepEqual(outbox.counts(), { pending: 0, error: 1, conflict: 0 });

    assert.equal(outbox.retry('r1'), true);
    assert.equal(outbox.nextSendable().state, 'pending');

    outbox.fail(outbox.nextSendable().opId, { state: 'error', message: 'still bad' });
    outbox.enqueueUpdate('r1', 1, { yield1: 6 }); // user corrects it
    assert.equal(outbox.nextSendable().state, 'pending');
    assert.deepEqual(outbox.nextSendable().fields, { yield1: 6 });

    assert.equal(outbox.discard('r1'), true);
    assert.equal(outbox.size(), 0);
  });

  it('counts each record once, by its most serious state', () => {
    const outbox = createOutbox({ file: memoryFile() });
    outbox.enqueueUpdate('r1', 1, { gene: 'A' });
    const op = outbox.nextSendable();
    outbox.markInFlight(op.opId);
    outbox.enqueueUpdate('r1', 1, { gene: 'B' }); // second op for the same record
    outbox.fail(op.opId, { state: 'conflict', message: 'changed', conflictRecord: { version: 2 } });
    assert.deepEqual(outbox.counts(), { pending: 0, error: 0, conflict: 1 });
  });
});
