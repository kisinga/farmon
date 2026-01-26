// =============================================================================
// ChirpStack Codec for Farm Monitor Devices
// =============================================================================
// Handles encoding/decoding for all fPorts in the Phase 4 protocol.
// This codec is configured in ChirpStack device profile.

// =============================================================================
// UPLINK DECODER
// =============================================================================
function decodeUplink(input) {
    const fPort = input.fPort;
    const bytes = input.bytes;

    // Convert bytes to string for text-based messages
    const text = String.fromCharCode.apply(null, bytes);

    let data = {};
    let warnings = [];
    let errors = [];

    try {
        switch (fPort) {
            case 1: // Registration
                data = decodeRegistration(text);
                break;

            case 2: // Telemetry
                data = decodeTelemetry(text);
                break;

            case 3: // State Change (binary)
                data = decodeStateChange(bytes);
                break;

            case 4: // Command ACK
                data = decodeCommandAck(text);
                break;

            case 6: // Diagnostics
                data = decodeDiagnostics(text);
                break;

            default:
                warnings.push("Unknown fPort: " + fPort);
                data = { raw: text };
        }
    } catch (e) {
        errors.push("Decode error: " + e.message);
        data = { raw: text, error: e.message };
    }

    return {
        data: data,
        warnings: warnings,
        errors: errors
    };
}

// =============================================================================
// DOWNLINK ENCODER
// =============================================================================
function encodeDownlink(input) {
    const fPort = input.fPort || input.data.fPort;
    const data = input.data;

    let bytes = [];

    switch (fPort) {
        case 5: // Registration ACK
            bytes = [0x01]; // Simple ACK byte
            break;

        case 11: // Set interval (4 bytes, big-endian)
            if (data.interval) {
                const interval = data.interval;
                bytes = [
                    (interval >> 24) & 0xFF,
                    (interval >> 16) & 0xFF,
                    (interval >> 8) & 0xFF,
                    interval & 0xFF
                ];
            }
            break;

        case 20: // Direct control (7 bytes)
            bytes = encodeDirectControl(data);
            break;

        case 30: // Rule update (12 bytes) or special commands
            bytes = encodeRuleUpdate(data);
            break;

        default:
            // Pass through raw bytes if provided
            if (data.bytes) {
                bytes = data.bytes;
            }
    }

    return {
        bytes: bytes,
        fPort: fPort
    };
}

// =============================================================================
// REGISTRATION DECODER (fPort 1)
// =============================================================================
// Format: v=1|sv=1|type=water_monitor|fw=2.0.0|fields=...|sys=...|states=...|cmds=...
function decodeRegistration(text) {
    const result = {
        v: 1,
        sv: 1,
        type: 'unknown',
        fw: '0.0.0',
        fields: [],
        sys: [],
        states: [],
        cmds: []
    };

    // Parse pipe-delimited segments
    const segments = text.split('|');
    for (const segment of segments) {
        const eqIdx = segment.indexOf('=');
        if (eqIdx < 0) continue;

        const key = segment.substring(0, eqIdx);
        const value = segment.substring(eqIdx + 1);

        switch (key) {
            case 'v':
                result.v = parseInt(value) || 1;
                break;
            case 'sv':
                result.sv = parseInt(value) || 1;
                break;
            case 'type':
                result.type = value;
                break;
            case 'fw':
                result.fw = value;
                break;
            case 'fields':
                result.fields = parseFields(value, 'cont');
                break;
            case 'sys':
                result.sys = parseSystemFields(value);
                break;
            case 'states':
                result.states = parseStates(value);
                break;
            case 'cmds':
                result.cmds = parseCmds(value);
                break;
        }
    }

    return result;
}

// Parse fields: bp:Battery:%:0:100,pd:PulseDelta,...
function parseFields(text, defaultCategory) {
    if (!text) return [];

    return text.split(',').map((f, idx) => {
        const parts = f.split(':');
        return {
            idx: idx,
            k: parts[0] || '',
            n: parts[1] || parts[0] || '',
            u: parts[2] || '',
            min: parts[3] ? parseFloat(parts[3]) : undefined,
            max: parts[4] ? parseFloat(parts[4]) : undefined,
            c: defaultCategory,
            t: 'num'
        };
    }).filter(f => f.k);
}

// Parse system fields: tx:TxInterval:s:10:3600:rw,ul:UplinkCount:::r,...
function parseSystemFields(text) {
    if (!text) return [];

    return text.split(',').map((f, idx) => {
        const parts = f.split(':');
        return {
            idx: idx,
            k: parts[0] || '',
            n: parts[1] || parts[0] || '',
            u: parts[2] || '',
            min: parts[3] ? parseFloat(parts[3]) : undefined,
            max: parts[4] ? parseFloat(parts[4]) : undefined,
            c: 'sys',
            t: 'num',
            rw: parts[5] === 'rw'  // Read-write flag
        };
    }).filter(f => f.k);
}

// Parse states: pump:WaterPump:off;on,valve:Valve:closed;open
function parseStates(text) {
    if (!text) return [];

    return text.split(',').map((s, idx) => {
        const parts = s.split(':');
        const values = (parts[2] || 'off;on').split(';');
        return {
            idx: idx,
            k: parts[0] || '',
            n: parts[1] || parts[0] || '',
            c: 'state',
            t: 'enum',
            v: values
        };
    }).filter(s => s.k);
}

// Parse cmds: reset:10,interval:11,...
function parseCmds(text) {
    if (!text) return [];

    return text.split(',').map(c => {
        const parts = c.split(':');
        return {
            k: parts[0] || '',
            port: parseInt(parts[1]) || 0
        };
    }).filter(c => c.k);
}

// =============================================================================
// TELEMETRY DECODER (fPort 2)
// =============================================================================
// Format: bp:85,pd:42,tv:1234.56,ec:0,tsr:3600
function decodeTelemetry(text) {
    const result = {};

    const pairs = text.split(',');
    for (const pair of pairs) {
        const colonIdx = pair.indexOf(':');
        if (colonIdx < 0) continue;

        const key = pair.substring(0, colonIdx);
        const value = pair.substring(colonIdx + 1);

        // Try to parse as number
        const num = parseFloat(value);
        result[key] = isNaN(num) ? value : num;
    }

    return result;
}

// =============================================================================
// STATE CHANGE DECODER (fPort 3) - BINARY
// =============================================================================
// Format: 11 bytes
// [0]    control_idx
// [1]    new_state
// [2]    old_state
// [3]    trigger_source (0=BOOT, 1=RULE, 2=MANUAL, 3=DOWNLINK)
// [4]    rule_id (if source=RULE, else 0)
// [5-8]  device_ms (uint32_t LE)
// [9-10] sequence_id (uint16_t LE)
function decodeStateChange(bytes) {
    if (bytes.length < 11) {
        return { error: "Invalid state change length: " + bytes.length };
    }

    const sources = ['BOOT', 'RULE', 'MANUAL', 'DOWNLINK'];

    return {
        control_idx: bytes[0],
        new_state: bytes[1],
        old_state: bytes[2],
        source: sources[bytes[3]] || 'UNKNOWN',
        source_id: bytes[3],
        rule_id: bytes[4],
        device_ms: bytes[5] | (bytes[6] << 8) | (bytes[7] << 16) | (bytes[8] << 24),
        seq: bytes[9] | (bytes[10] << 8)
    };
}

// =============================================================================
// COMMAND ACK DECODER (fPort 4)
// =============================================================================
// Format: "10:ok" or "11:err"
function decodeCommandAck(text) {
    const parts = text.split(':');
    return {
        port: parseInt(parts[0]) || 0,
        status: parts[1] || 'unknown',
        success: parts[1] === 'ok'
    };
}

// =============================================================================
// DIAGNOSTICS DECODER (fPort 6)
// =============================================================================
// Format: reg:1,err:5,up:3600,bat:85,rssi:-80,snr:7.5,ul:10,dl:2,fw:2.0.0
function decodeDiagnostics(text) {
    const result = {};

    const pairs = text.split(',');
    for (const pair of pairs) {
        const colonIdx = pair.indexOf(':');
        if (colonIdx < 0) continue;

        const key = pair.substring(0, colonIdx);
        const value = pair.substring(colonIdx + 1);

        // Parse appropriately
        if (key === 'fw') {
            result[key] = value;
        } else {
            const num = parseFloat(value);
            result[key] = isNaN(num) ? value : num;
        }
    }

    return result;
}

// =============================================================================
// DIRECT CONTROL ENCODER (fPort 20)
// =============================================================================
// Format: 7 bytes
// [0]    control_idx
// [1]    state_idx
// [2]    flags [is_manual:1][reserved:7]
// [3-6]  manual_timeout_sec (uint32_t LE)
function encodeDirectControl(data) {
    const ctrl = data.control_idx || 0;
    const state = data.state_idx || 0;
    const isManual = data.is_manual ? 1 : 0;
    const timeout = data.timeout_sec || 0;

    return [
        ctrl,
        state,
        isManual,
        timeout & 0xFF,
        (timeout >> 8) & 0xFF,
        (timeout >> 16) & 0xFF,
        (timeout >> 24) & 0xFF
    ];
}

// =============================================================================
// RULE UPDATE ENCODER (fPort 30)
// =============================================================================
// Format: 12 bytes per rule, or special commands
// [0]    rule_id (0xFF for special commands)
// [1]    flags [enabled:1][operator:3][delete:1][reserved:3]
// [2]    field_idx
// [3-6]  threshold (float LE)
// [7]    control_idx
// [8]    action_state
// [9-10] cooldown_sec (uint16_t LE)
// [11]   priority
//
// Special commands:
// [0xFF, 0x00] = Clear all rules
// [rule_id, 0x80] = Delete specific rule
function encodeRuleUpdate(data) {
    // Clear all rules
    if (data.clear_all) {
        return [0xFF, 0x00];
    }

    // Delete specific rule
    if (data.delete_rule !== undefined) {
        return [data.delete_rule, 0x80];
    }

    // Add/update rule
    const ruleId = data.rule_id || 0;
    const enabled = data.enabled !== false ? 1 : 0;
    const op = encodeOperator(data.operator || '<');
    const fieldIdx = data.field_idx || 0;
    const threshold = data.threshold || 0;
    const controlIdx = data.control_idx || 0;
    const actionState = data.action_state || 0;
    const cooldown = data.cooldown_sec || 300;
    const priority = data.priority || 128;

    // Encode threshold as float (little-endian)
    const thresholdBytes = floatToBytes(threshold);

    return [
        ruleId,
        (enabled << 7) | ((op & 0x07) << 4),
        fieldIdx,
        thresholdBytes[0],
        thresholdBytes[1],
        thresholdBytes[2],
        thresholdBytes[3],
        controlIdx,
        actionState,
        cooldown & 0xFF,
        (cooldown >> 8) & 0xFF,
        priority
    ];
}

function encodeOperator(op) {
    const ops = { '<': 0, '>': 1, '<=': 2, '>=': 3, '==': 4, '!=': 5 };
    return ops[op] !== undefined ? ops[op] : 0;
}

function floatToBytes(value) {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setFloat32(0, value, true); // Little-endian
    return [
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3)
    ];
}
