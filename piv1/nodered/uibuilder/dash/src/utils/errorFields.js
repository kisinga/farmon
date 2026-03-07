/**
 * Mandatory error object per DATA_CONTRACT (§5). Keys ≤2 chars.
 * Categories: Communication, Hardware, OTA, System, Logic. All reset daily.
 */
export const ERROR_OBJECT_KEYS = [
    'ec',
    'na', 'jf', 'sf',
    'sr', 'dr', 'dp',
    'cs', 'wf', 'tm',
    'mm', 'qf', 'ts',
    'rf', 'cv', 'pf'
];

export const ERROR_FIELD_LABELS = {
    ec: 'Errors',
    na: 'No ACK',
    jf: 'Join fail',
    sf: 'Send fail',
    sr: 'Sensor read',
    dr: 'Driver',
    dp: 'Display',
    cs: 'OTA CRC',
    wf: 'OTA write',
    tm: 'OTA timeout',
    mm: 'Memory',
    qf: 'Queue full',
    ts: 'Task',
    rf: 'Rule',
    cv: 'Config',
    pf: 'Persistence'
};

/** Keys grouped by category for UI (e.g. DeviceInfoBar or diagnostics). */
export const ERROR_CATEGORIES = {
    Communication: ['na', 'jf', 'sf'],
    Hardware: ['sr', 'dr', 'dp'],
    OTA: ['cs', 'wf', 'tm'],
    System: ['mm', 'qf', 'ts'],
    Logic: ['rf', 'cv', 'pf']
};

/**
 * Create field configs for the standard error object.
 * Injects into fieldConfigs when not already present so UI can display them.
 */
export function createErrorFields(existingFieldKeys) {
    const fields = [];
    const definitions = [
        { key: 'ec', name: ERROR_FIELD_LABELS.ec, sort_order: 90 },
        { key: 'na', name: ERROR_FIELD_LABELS.na, sort_order: 91 },
        { key: 'jf', name: ERROR_FIELD_LABELS.jf, sort_order: 92 },
        { key: 'sf', name: ERROR_FIELD_LABELS.sf, sort_order: 93 },
        { key: 'sr', name: ERROR_FIELD_LABELS.sr, sort_order: 94 },
        { key: 'dr', name: ERROR_FIELD_LABELS.dr, sort_order: 95 },
        { key: 'dp', name: ERROR_FIELD_LABELS.dp, sort_order: 96 },
        { key: 'cs', name: ERROR_FIELD_LABELS.cs, sort_order: 97 },
        { key: 'wf', name: ERROR_FIELD_LABELS.wf, sort_order: 98 },
        { key: 'tm', name: ERROR_FIELD_LABELS.tm, sort_order: 99 },
        { key: 'mm', name: ERROR_FIELD_LABELS.mm, sort_order: 100 },
        { key: 'qf', name: ERROR_FIELD_LABELS.qf, sort_order: 101 },
        { key: 'ts', name: ERROR_FIELD_LABELS.ts, sort_order: 102 },
        { key: 'rf', name: ERROR_FIELD_LABELS.rf, sort_order: 103 },
        { key: 'cv', name: ERROR_FIELD_LABELS.cv, sort_order: 104 },
        { key: 'pf', name: ERROR_FIELD_LABELS.pf, sort_order: 105 }
    ];
    for (const def of definitions) {
        if (existingFieldKeys.has(def.key)) continue;
        fields.push({
            key: def.key,
            name: def.name,
            type: 'num',
            category: 'sys',
            viz_type: 'badge',
            gauge_style: 'bar',
            chartable: false,
            value_format: 'integer',
            show_in_top_bar: true,
            is_visible: false,
            sort_order: def.sort_order
        });
    }
    return fields;
}
