// Field Processing Utilities - Pure functions for processing field configurations

// Parse JSON string safely
export function parseJsonSafely(str, fallback = null) {
    if (typeof str !== 'string') return str;
    try {
        return JSON.parse(str);
    } catch (e) {
        return fallback;
    }
}

// Parse numeric value safely
export function parseNumeric(value) {
    if (value === null || value === undefined) return null;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
}

// Infer visualization type from field properties
export function inferVizType(field, category, gaugeStyle, minVal, maxVal) {
    if (field.viz_type) return field.viz_type;
    if (category === 'state') return 'toggle';
    if (gaugeStyle === 'tank') return 'both';
    if (field.type === 'num' && category === 'cont') {
        return (minVal !== null && maxVal !== null) ? 'both' : 'chart';
    }
    return 'badge';
}

// Get default thresholds
export function getDefaultThresholds() {
    return [
        { pct: 0.2, color: '#ef4444' },
        { pct: 0.5, color: '#f59e0b' },
        { pct: 1.0, color: '#10b981' }
    ];
}

// Process a single field config
export function processFieldConfig(field, deviceSchema, getCategoryFromSchema) {
    const thresholds = parseJsonSafely(field.thresholds, null);
    const enumValues = parseJsonSafely(field.enum_values, null);
    const minVal = parseNumeric(field.min);
    const maxVal = parseNumeric(field.max);
    const displayName = field.name || field.key;
    const gaugeStyle = field.gauge_style || 'radial';

    // Override category with device-provided category from schema
    let category = field.category;
    if (deviceSchema && getCategoryFromSchema) {
        const deviceCategory = getCategoryFromSchema(field.key, deviceSchema);
        if (deviceCategory) {
            category = deviceCategory;
        } else if (!category) {
            console.warn(`Field ${field.key} not found in device schema, using database category: ${category || 'unknown'}`);
        }
    }

    const vizType = inferVizType(field, category, gaugeStyle, minVal, maxVal);

    return {
        ...field,
        name: displayName,
        min: minVal,
        max: maxVal,
        category: category,
        viz_type: vizType,
        gauge_style: gaugeStyle,
        chart_color: field.chart_color || '#3b82f6',
        thresholds: thresholds || getDefaultThresholds(),
        enum_values: enumValues,
        is_visible: field.is_visible !== false,
        sort_order: field.sort_order ?? 100
    };
}

// Process array of field configs
export function processFieldConfigs(fields, deviceSchema, getCategoryFromSchema) {
    return fields.map(f => processFieldConfig(f, deviceSchema, getCategoryFromSchema));
}

// Create RSSI system field
export function createRSSIField() {
    return {
        key: 'rssi',
        name: 'rssi',
        type: 'num',
        unit: 'dBm',
        category: 'sys',
        min: -120,
        max: -20,
        viz_type: 'both',
        gauge_style: 'radial',
        chart_color: '#f59e0b',
        thresholds: [
            { pct: 0.3, color: '#ef4444' },
            { pct: 0.6, color: '#f59e0b' },
            { pct: 1.0, color: '#10b981' }
        ],
        is_visible: true,
        sort_order: 100
    };
}

// Create SNR system field
export function createSNRField() {
    return {
        key: 'snr',
        name: 'snr',
        type: 'num',
        unit: 'dB',
        category: 'sys',
        min: -20,
        max: 15,
        viz_type: 'both',
        gauge_style: 'radial',
        chart_color: '#8b5cf6',
        thresholds: [
            { pct: 0.3, color: '#ef4444' },
            { pct: 0.6, color: '#f59e0b' },
            { pct: 1.0, color: '#10b981' }
        ],
        is_visible: true,
        sort_order: 100
    };
}

// Create system fields from current telemetry
export function createSystemFields(current, existingFieldKeys) {
    const systemFields = [];
    if (!current) return systemFields;

    if (current.rssi !== undefined && !existingFieldKeys.has('rssi')) {
        systemFields.push(createRSSIField());
    }

    if (current.snr !== undefined && !existingFieldKeys.has('snr')) {
        systemFields.push(createSNRField());
    }

    return systemFields;
}

// Get control category from schema
export function getControlCategory(key, deviceSchema, getCategoryFromSchema) {
    if (deviceSchema && getCategoryFromSchema) {
        const deviceCategory = getCategoryFromSchema(key, deviceSchema);
        if (deviceCategory) return deviceCategory;
    }
    return 'state';
}

// Create a control field entry
export function createControlField(key, category, enumValues) {
    return {
        key,
        name: key,
        type: 'enum',
        category: category,
        viz_type: 'toggle',
        enum_values: enumValues,
        is_visible: true,
        sort_order: 100
    };
}

// Process controls from backend and telemetry
export function processControls(controls, telemetryData, deviceSchema, existingFieldKeys, isControlValue, getCategoryFromSchema) {
    const newControls = {};
    const additionalFields = [];

    // Process explicit controls
    controls.forEach(c => {
        const controlKey = c.control_key || c.key;
        newControls[controlKey] = {
            control_key: controlKey,
            current_state: c.current_state || c.state,
            mode: c.mode || 'auto',
            manual_until: c.manual_until,
            last_change_at: c.last_change_at,
            last_change_by: c.last_change_by,
            enum_values: c.enum_values || ['off', 'on']
        };

        if (!existingFieldKeys.has(controlKey)) {
            const category = getControlCategory(controlKey, deviceSchema, getCategoryFromSchema);
            additionalFields.push(createControlField(controlKey, category, c.enum_values || ['off', 'on']));
            existingFieldKeys.add(controlKey);
        }
    });

    // Detect controls from telemetry
    Object.entries(telemetryData).forEach(([key, val]) => {
        if (isControlValue && isControlValue(val) && !existingFieldKeys.has(key)) {
            const category = getControlCategory(key, deviceSchema, getCategoryFromSchema);
            additionalFields.push(createControlField(key, category, ['off', 'on']));
            existingFieldKeys.add(key);
            if (!newControls[key]) {
                newControls[key] = {
                    control_key: key,
                    current_state: val,
                    mode: 'auto',
                    enum_values: ['off', 'on']
                };
            }
        }
    });

    return { newControls, additionalFields };
}

// Parse telemetry data values
export function parseTelemetryData(data) {
    const dataValues = {};
    Object.entries(data || {}).forEach(([key, val]) => {
        dataValues[key] = typeof val === 'string' ? parseFloat(val) : val;
        if (isNaN(dataValues[key])) dataValues[key] = val;
    });
    return dataValues;
}

// Update current data from telemetry
export function updateCurrentData(current) {
    if (!current) return {};
    const dataValues = parseTelemetryData(current.data);
    return {
        ...dataValues,
        rssi: parseFloat(current.rssi) || -120,
        snr: parseFloat(current.snr) || -20
    };
}

// Compute state fields from controls and field configs
export function computeStateFields(controls, fieldConfigs) {
    const controlsFromState = [];
    
    for (const key in controls) {
        const control = controls[key];
        if (control) {
            const fieldConfig = fieldConfigs.find(f => f.key === key);
            controlsFromState.push({
                key,
                name: fieldConfig?.name || key,
                type: 'enum',
                category: 'state',
                viz_type: 'toggle',
                enum_values: control.enum_values || ['off', 'on'],
                is_visible: true,
                sort_order: fieldConfig?.sort_order ?? 100
            });
        }
    }

    const explicitStateFields = fieldConfigs
        .filter(f => (f.is_visible !== false) && f.category === 'state' && !controls[f.key]);

    const allControls = [...controlsFromState, ...explicitStateFields];
    const seen = new Set();
    return allControls
        .filter(f => {
            if (seen.has(f.key)) return false;
            seen.add(f.key);
            return true;
        })
        .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));
}
