#!/usr/bin/env node
// Unit tests for fPort 3 state change decode (single and batch).
// Run: node test-codec-statechange.js

const { decodeStateChange } = require('./codec.js');

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

// Build 11-byte record: control_idx, new_state, old_state, source, rule_id, device_ms(4 LE), seq(2 LE)
function buildRecord(controlIdx, newState, oldState, sourceId, ruleId, deviceMs, seq) {
    const b = [];
    b[0] = controlIdx;
    b[1] = newState;
    b[2] = oldState;
    b[3] = sourceId;
    b[4] = ruleId;
    b[5] = deviceMs & 0xff;
    b[6] = (deviceMs >> 8) & 0xff;
    b[7] = (deviceMs >> 16) & 0xff;
    b[8] = (deviceMs >> 24) & 0xff;
    b[9] = seq & 0xff;
    b[10] = (seq >> 8) & 0xff;
    return b;
}

// --- Single record (11 bytes) → stateChanges array of length 1 ---
const single = buildRecord(1, 1, 0, 2, 5, 0x12345678, 100);
const singleResult = decodeStateChange(single);
assert(!singleResult.error, 'single: no error');
assert(Array.isArray(singleResult.stateChanges), 'single: stateChanges array');
assert(singleResult.stateChanges.length === 1, 'single: length 1');
const s = singleResult.stateChanges[0];
assert(s.control_idx === 1, 'single: control_idx');
assert(s.new_state === 1, 'single: new_state');
assert(s.old_state === 0, 'single: old_state');
assert(s.source === 'MANUAL', 'single: source');
assert(s.rule_id === 5, 'single: rule_id');
assert(s.device_ms === 0x12345678, 'single: device_ms');
assert(s.seq === 100, 'single: seq');
console.log('Single (11 bytes): OK');

// --- Batch (22 bytes = 2 records) ---
const batch2 = [
    ...buildRecord(0, 1, 0, 1, 10, 1000, 1),
    ...buildRecord(1, 0, 1, 0, 0, 2000, 2)
];
const batch2Result = decodeStateChange(batch2);
assert(!batch2Result.error, 'batch2: no error');
assert(Array.isArray(batch2Result.stateChanges), 'batch2: stateChanges array');
assert(batch2Result.stateChanges.length === 2, 'batch2: length 2');
assert(batch2Result.stateChanges[0].control_idx === 0 && batch2Result.stateChanges[0].seq === 1, 'batch2: first');
assert(batch2Result.stateChanges[1].control_idx === 1 && batch2Result.stateChanges[1].source === 'BOOT', 'batch2: second');
assert(batch2Result.control_idx === undefined, 'batch2: no single control_idx');
console.log('Batch (22 bytes): OK');

// --- Batch (33 bytes = 3 records) ---
const batch3 = [
    ...buildRecord(0, 1, 0, 1, 0, 100, 1),
    ...buildRecord(1, 0, 1, 2, 0, 200, 2),
    ...buildRecord(0, 0, 1, 3, 0, 300, 3)
];
const batch3Result = decodeStateChange(batch3);
assert(!batch3Result.error, 'batch3: no error');
assert(batch3Result.stateChanges.length === 3, 'batch3: length 3');
assert(batch3Result.stateChanges[2].source === 'DOWNLINK', 'batch3: third source');
console.log('Batch (33 bytes): OK');

// --- Invalid length ---
const bad = decodeStateChange([1, 2, 3]);
assert(bad.error, 'invalid: error set');
console.log('Invalid length: OK');

// --- Invalid batch length (not multiple of 11) ---
const badBatch = new Array(20).fill(0);
const badBatchResult = decodeStateChange(badBatch);
assert(badBatchResult.error, 'bad batch: error set');
console.log('Invalid batch length: OK');

console.log('All state change codec tests passed.');