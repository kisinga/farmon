# State change batch (fPort 3) validation

## Backend codec

- **Single (11 bytes)**: Decoder returns one object `{ control_idx, new_state, old_state, source, rule_id, device_ms, seq }` (backward compatible).
- **Batch (N×11 bytes)**: Decoder returns `{ stateChanges: [ {...}, ... ] }`. Node-RED State Change Handler emits one message per element so each event is inserted into `state_changes` and `device_controls` is updated per event.

## Run codec unit tests

```bash
cd pi/chirpstack
node test-codec-statechange.js
```

Covers: single 11-byte decode, batch 22- and 33-byte decode, invalid length, invalid batch length (not multiple of 11).

## Firmware

- Device queues state changes in a ring buffer (cap 20). On send, batches up to `floor(maxPayload/11)` events per uplink; clears only the batch that was ACKed and persists the queue to NVS. After reboot, queue is loaded from NVS and unsent changes are sent in subsequent batches.
- Integration: trigger 2–3 rapid state changes (or reboot with unsent queue), confirm one uplink with 2–3 events and 2–3 rows in `state_changes`.
