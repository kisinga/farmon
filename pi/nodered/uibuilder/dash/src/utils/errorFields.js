/**
 * Mandatory error object per DATA_CONTRACT (§5).
 * Keys and display labels for device error counts.
 */
export const ERROR_OBJECT_KEYS = ['ec', 'ec_na', 'ec_jf', 'ec_sf'];

export const ERROR_FIELD_LABELS = {
    ec: 'Errors',
    ec_na: 'No ACK',
    ec_jf: 'Join fail',
    ec_sf: 'Send fail'
};

/**
 * Create field configs for the standard error object.
 * Injects into fieldConfigs when not already present so UI can display them.
 */
export function createErrorFields(existingFieldKeys) {
    const fields = [];
    const definitions = [
        { key: 'ec', name: ERROR_FIELD_LABELS.ec, sort_order: 90 },
        { key: 'ec_na', name: ERROR_FIELD_LABELS.ec_na, sort_order: 91 },
        { key: 'ec_jf', name: ERROR_FIELD_LABELS.ec_jf, sort_order: 92 },
        { key: 'ec_sf', name: ERROR_FIELD_LABELS.ec_sf, sort_order: 93 }
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
