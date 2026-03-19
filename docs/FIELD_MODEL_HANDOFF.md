# Handoff: Frontend/UI — Unified Field Model

Picks up after firmware + core backend are complete. The firmware has a unified `values[64]` array, compute VM, new actuator types, pin capabilities, and field probing. The backend has field linkage tracking, auto-creation, transport-aware limits, and validation.

**This document covers the frontend/UI work.**

---

## Prerequisites (done in previous session)

- Firmware: unified values array, PWM/DAC/Servo/I2CPWM actuators, pin caps, compute VM, field probe, independent compute cycle
- Backend: field linkage (`linked_type`, `linked_key`, `report_mode`), auto-created fields, `device_controls` expanded with pin/actuator metadata, `current_state` removed, `setControl` accepts `value`, validation on push, pin-capabilities API, transport-aware active field limit

---

## 1. API Types

`DeviceControl` gains: `control_type`, `field_key`, `pin_index`, `actuator_type`, `flags`, `pin2_index`, `pulse_x100ms`, `min_value`, `max_value`, `bus_index`, `bus_address`, `bus_channel`

`DeviceField` gains: `linked_type`, `linked_key`, `report_mode`

Remove `current_state` from `DeviceControl`.

---

## 2. Device Config Page

### Fields tab
- Show linkage badge per field: `← pump (output)`, `← soil_1 (input)`, `← vpd (compute)`
- Show `report_mode` badge: `active`, `event`, `internal`
- Toggle `report_mode` via dropdown (backend enforces transport limit for "active")
- Linked fields: read-only (no Edit/Delete). Unlinked fields (codec): editable.

### Inputs tab (renamed from "Sensors")
- All user-facing text: "Sensor" → "Input"
- Field key dropdown selects from existing fields or auto-creates (already implemented)

### Controls tab — full hardware config
- Actuator type selector: Relay, Motorized Valve, Solenoid, PWM, Servo, DAC, I2C PWM
- Pin selector (filtered by `GET /api/farmon/pin-capabilities` for the device's MCU)
- For dual-pin (motorized): secondary pin selector
- For bus-addressed (I2C PWM): bus index, I2C address, channel selector
- For analog (PWM/DAC/Servo): min/max value range inputs
- States list editor for binary/multistate
- Linked field shown as read-only badge (auto-created)

### Compute tab (NEW, airconfig devices only)
- Expression builder for computed fields
- Preview of compiled bytecode (byte count)
- Field dependency visualization (which fields are referenced)
- Report mode selector for each compute field

---

## 3. Device Detail Page

### Overview tab
- Current values read from `latestTelemetry()` (includes output fields now)
- Show `report_mode` indicator per field value

### Control tab
- Binary controls: state toggle buttons (existing pattern)
- Multistate controls: button group for N states
- Analog controls: slider + numeric input (0 to max_value)
- All controls show current value from linked field (not `current_state`)

### History tab
- Charts for active + event fields
- Output fields chartable from state change history

---

## 4. Rename "Sensors" → "Inputs"

All user-facing text across Config and Detail pages. Internal code names (`SensorService`, `DeviceSensorConfigComponent`) can be renamed or kept with aliases.

---

## 5. Transport-Aware UI

- Active field count shown in info strip: "12/44 active fields"
- Warning when approaching limit
- Reject toggle to "active" if limit reached (backend enforces, frontend shows error)
- Different limits displayed based on device transport + configured DR

---

## 6. Field Probe UI

- "Probe" button on any non-active field in the Config or Detail page
- Sends downlink, waits for response, shows one-shot value
- Useful for debugging compute pipelines and internal fields

---

## 7. Templates Update

All `templates/*.json`:
- Controls array: add `control_type`, `pin_index`, `actuator_type`, etc.
- Fields array: add `linked_type`, `linked_key`, `report_mode`
- Add control-feedback fields to fields array
- Add compute field definitions (if any)
