import { Component, input, output, signal, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, DeviceField, DeviceRuleRecord } from '../../../core/services/api.service';
import {
  SENSOR_INTERFACES, MEASUREMENT_TYPES, SENSOR_PRESETS,
  SUGGESTED_RULES, SENSOR_TYPE,
  encodeCalibOffset, encodeCalibSpan, applyTrim,
  sensorFieldCount,
  type SensorPreset, type MeasurementType, type RuleSuggestion,
} from '../../../core/constants/sensor-config';

interface CalibForm {
  mode: 'datasheet' | 'trim';
  physMin: number;
  physMax: number;
  // trim mode
  currentReading: number;
  expectedValue: number;
}

interface SensorForm {
  presetId: string;
  interfaceId: string;
  measurement: MeasurementType | '';
  unit: string;
  displayName: string;
  fieldKey: string;
  pinIndex: number;
  busIndex: number;     // for I2C/UART bus-addressed sensors
  i2cAddr: number;      // for BME280/INA219
  pulsesPerUnit: number;
  modbusDevAddr: number;
  modbusFuncCode: number;
  modbusRegAddr: number;
  modbusRegSigned: boolean;
  calib: CalibForm;
}

function defaultForm(): SensorForm {
  return {
    presetId: '',
    interfaceId: '',
    measurement: '',
    unit: '',
    displayName: '',
    fieldKey: '',
    pinIndex: 0,
    busIndex: 0,
    i2cAddr: 0x76,
    pulsesPerUnit: 1,
    modbusDevAddr: 1,
    modbusFuncCode: 3,
    modbusRegAddr: 0,
    modbusRegSigned: false,
    calib: { mode: 'datasheet', physMin: 0, physMax: 100, currentReading: 0, expectedValue: 0 },
  };
}

@Component({
  selector: 'app-device-sensor-config',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="space-y-6">

      <!-- Status banner -->
      @if (statusMsg()) {
        <div [class]="'alert ' + (statusOk() ? 'alert-success' : 'alert-error') + ' py-2 text-sm'">
          {{ statusMsg() }}
        </div>
      }

      <!-- Preset picker -->
      <div class="card bg-base-200">
        <div class="card-body py-4">
          <h3 class="card-title text-sm">Quick Start — Choose a sensor preset</h3>
          <div class="flex flex-wrap gap-2 mt-2">
            @for (p of presets; track p.id) {
              <button class="btn btn-sm" [class.btn-primary]="form().presetId === p.id"
                (click)="applyPreset(p)">{{ p.label }}</button>
            }
            <button class="btn btn-sm btn-ghost" (click)="clearPreset()">Custom</button>
          </div>
        </div>
      </div>

      <!-- Main config form -->
      <div class="card bg-base-200">
        <div class="card-body py-4 space-y-3">
          <h3 class="card-title text-sm">Sensor Configuration</h3>

          <!-- Interface -->
          <label class="form-control w-full max-w-xs">
            <div class="label py-1"><span class="label-text text-xs">Interface / Driver</span></div>
            <select class="select select-bordered select-sm" [(ngModel)]="form().interfaceId"
              (ngModelChange)="onInterfaceChange($event)">
              <option value="">— select —</option>
              @for (iface of interfaces; track iface.id) {
                <option [value]="iface.id">{{ iface.label }}</option>
              }
            </select>
          </label>

          <!-- Measurement type -->
          <label class="form-control w-full max-w-xs">
            <div class="label py-1"><span class="label-text text-xs">Measurement</span></div>
            <select class="select select-bordered select-sm" [(ngModel)]="form().measurement"
              (ngModelChange)="onMeasurementChange($event)">
              <option value="">— select —</option>
              @for (m of measurements; track m.id) {
                <option [value]="m.id">{{ m.label }} ({{ m.unit }})</option>
              }
            </select>
          </label>

          <!-- Display name + field key -->
          <div class="flex gap-2 flex-wrap">
            <label class="form-control w-48">
              <div class="label py-1"><span class="label-text text-xs">Display Name</span></div>
              <input class="input input-bordered input-sm" [(ngModel)]="form().displayName" placeholder="e.g. Soil Moisture" />
            </label>
            <label class="form-control w-36">
              <div class="label py-1"><span class="label-text text-xs">Field Key</span></div>
              <input class="input input-bordered input-sm" [(ngModel)]="form().fieldKey" placeholder="e.g. soil_1" />
            </label>
            <label class="form-control w-24">
              <div class="label py-1"><span class="label-text text-xs">Unit</span></div>
              <input class="input input-bordered input-sm" [(ngModel)]="form().unit" placeholder="e.g. %" />
            </label>
          </div>

          <!-- GPIO pin (non-bus sensors) -->
          @if (selectedInterface() && !selectedInterface()!.busAddressed) {
            <label class="form-control w-32">
              <div class="label py-1"><span class="label-text text-xs">GPIO Pin Index</span></div>
              <input type="number" class="input input-bordered input-sm" [(ngModel)]="form().pinIndex" min="0" max="19" />
            </label>
          }

          <!-- Bus index (I2C/UART sensors) -->
          @if (selectedInterface()?.busAddressed) {
            <label class="form-control w-32">
              <div class="label py-1"><span class="label-text text-xs">Bus Index (0 or 1)</span></div>
              <input type="number" class="input input-bordered input-sm" [(ngModel)]="form().busIndex" min="0" max="1" />
            </label>
          }

          <!-- I2C address (BME280, INA219) -->
          @if (selectedInterface()?.id === 'i2c_bme280' || selectedInterface()?.id === 'i2c_ina219') {
            <label class="form-control w-40">
              <div class="label py-1"><span class="label-text text-xs">I2C Address (hex)</span></div>
              <input class="input input-bordered input-sm" [value]="'0x' + form().i2cAddr.toString(16)"
                (change)="onI2CAddrChange($event)" placeholder="0x76" />
            </label>
          }

          <!-- Pulse settings -->
          @if (selectedInterface()?.id === 'pulse') {
            <label class="form-control w-40">
              <div class="label py-1"><span class="label-text text-xs">Pulses per Unit</span></div>
              <input type="number" class="input input-bordered input-sm" [(ngModel)]="form().pulsesPerUnit" min="1" />
            </label>
          }

          <!-- Modbus settings -->
          @if (selectedInterface()?.id === 'modbus_rtu') {
            <div class="flex gap-2 flex-wrap">
              <label class="form-control w-28">
                <div class="label py-1"><span class="label-text text-xs">Device Address</span></div>
                <input type="number" class="input input-bordered input-sm" [(ngModel)]="form().modbusDevAddr" min="1" max="247" />
              </label>
              <label class="form-control w-28">
                <div class="label py-1"><span class="label-text text-xs">Function Code</span></div>
                <input type="number" class="input input-bordered input-sm" [(ngModel)]="form().modbusFuncCode" min="1" max="4" />
              </label>
              <label class="form-control w-28">
                <div class="label py-1"><span class="label-text text-xs">Register Address</span></div>
                <input type="number" class="input input-bordered input-sm" [(ngModel)]="form().modbusRegAddr" min="0" max="65535" />
              </label>
              <label class="form-control">
                <div class="label py-1"><span class="label-text text-xs">Signed (int16)</span></div>
                <input type="checkbox" class="checkbox checkbox-sm" [(ngModel)]="form().modbusRegSigned" />
              </label>
            </div>
          }

          <!-- Calibration panel (ADC-based sensors only) -->
          @if (selectedInterface()?.needsCalib) {
            <div class="divider text-xs">Calibration</div>
            <div class="tabs tabs-boxed mb-2">
              <a class="tab tab-sm" [class.tab-active]="form().calib.mode === 'datasheet'"
                (click)="setCalibMode('datasheet')">Datasheet</a>
              <a class="tab tab-sm" [class.tab-active]="form().calib.mode === 'trim'"
                (click)="setCalibMode('trim')">Single-point Trim</a>
            </div>

            @if (form().calib.mode === 'datasheet') {
              <div class="flex gap-2 flex-wrap items-end">
                <label class="form-control w-28">
                  <div class="label py-1"><span class="label-text text-xs">Min ({{ form().unit }})</span></div>
                  <input type="number" class="input input-bordered input-sm" [(ngModel)]="form().calib.physMin" />
                </label>
                <label class="form-control w-28">
                  <div class="label py-1"><span class="label-text text-xs">Max ({{ form().unit }})</span></div>
                  <input type="number" class="input input-bordered input-sm" [(ngModel)]="form().calib.physMax" />
                </label>
                <div class="text-xs text-base-content/50 self-end pb-2">
                  → offset={{ calibPreview().offset.toFixed(1) }}, span={{ calibPreview().span.toFixed(1) }}
                </div>
              </div>
            } @else {
              <div class="flex gap-2 flex-wrap items-end">
                <label class="form-control w-32">
                  <div class="label py-1"><span class="label-text text-xs">Current Reading</span></div>
                  <input type="number" class="input input-bordered input-sm" [(ngModel)]="form().calib.currentReading" />
                </label>
                <label class="form-control w-32">
                  <div class="label py-1"><span class="label-text text-xs">Expected Value</span></div>
                  <input type="number" class="input input-bordered input-sm" [(ngModel)]="form().calib.expectedValue" />
                </label>
                <div class="text-xs text-base-content/50 self-end pb-2">
                  → new offset={{ trimPreview().toFixed(1) }}
                </div>
              </div>
            }
          }

        </div>
      </div>

      <!-- Action -->
      <button class="btn btn-primary w-full" [disabled]="!canSave() || saving()"
        (click)="save()">
        {{ saving() ? 'Sending…' : 'Configure & Push to Device' }}
      </button>

      <!-- Post-save rule suggestions -->
      @if (suggestions().length > 0) {
        <div class="card bg-base-200 mt-4">
          <div class="card-body py-4">
            <h3 class="card-title text-sm">Suggested Rules</h3>
            <p class="text-xs text-base-content/60">Based on this sensor, you may want to add these rules:</p>
            <div class="space-y-2 mt-2">
              @for (s of suggestions(); track s.label) {
                <div class="flex items-center justify-between bg-base-100 rounded p-2">
                  <div>
                    <div class="text-sm font-medium">{{ s.label }}</div>
                    <div class="text-xs text-base-content/50">{{ s.note }}</div>
                  </div>
                  <button class="btn btn-xs btn-outline btn-primary"
                    (click)="addRule(s)">Add rule →</button>
                </div>
              }
            </div>
          </div>
        </div>
      }

    </div>
  `,
})
export class DeviceSensorConfigComponent {
  eui = input.required<string>();
  fieldConfigs = input<DeviceField[]>([]);
  prefillRule = output<Partial<DeviceRuleRecord>>();

  private api = inject(ApiService);

  readonly presets = SENSOR_PRESETS;
  readonly interfaces = SENSOR_INTERFACES;
  readonly measurements = MEASUREMENT_TYPES;

  form = signal<SensorForm>(defaultForm());
  saving = signal(false);
  statusMsg = signal('');
  statusOk = signal(true);
  suggestions = signal<RuleSuggestion[]>([]);

  // Track field index + slot assigned after save (for rule prefill)
  private lastFieldIndex = signal(0);

  selectedInterface = computed(() =>
    SENSOR_INTERFACES.find(i => i.id === this.form().interfaceId) ?? null
  );

  calibPreview = computed(() => {
    const c = this.form().calib;
    return { offset: c.physMin, span: c.physMax - c.physMin };
  });

  trimPreview = computed(() => {
    const c = this.form().calib;
    return applyTrim(c.physMin, c.currentReading, c.expectedValue);
  });

  canSave = computed(() => {
    const f = this.form();
    return f.interfaceId !== '' && f.fieldKey.trim() !== '' && f.displayName.trim() !== '';
  });

  applyPreset(p: SensorPreset): void {
    const iface = SENSOR_INTERFACES.find(i => i.id === p.interface);
    const meas = MEASUREMENT_TYPES.find(m => m.id === p.measurement);
    this.form.set({
      ...defaultForm(),
      presetId: p.id,
      interfaceId: p.interface,
      measurement: p.measurement,
      unit: meas?.unit ?? '',
      displayName: p.label,
      fieldKey: p.measurement + '_' + (this.fieldConfigs().length + 1),
      i2cAddr: p.i2cAddr ?? 0x76,
      pulsesPerUnit: p.pulsesPerUnit ?? 1,
      calib: {
        mode: 'datasheet',
        physMin: p.calibMin,
        physMax: p.calibMax,
        currentReading: p.calibMin,
        expectedValue: p.calibMin,
      },
    });
    void iface; // used via template
  }

  clearPreset(): void {
    this.form.set(defaultForm());
  }

  onInterfaceChange(id: string): void {
    this.form.update(f => ({ ...f, interfaceId: id }));
  }

  onMeasurementChange(id: string): void {
    const meas = MEASUREMENT_TYPES.find(m => m.id === id);
    this.form.update(f => ({ ...f, measurement: id as MeasurementType, unit: meas?.unit ?? f.unit }));
  }

  onI2CAddrChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const parsed = parseInt(val, 16);
    if (!isNaN(parsed)) {
      this.form.update(f => ({ ...f, i2cAddr: parsed }));
    }
  }

  setCalibMode(mode: 'datasheet' | 'trim'): void {
    this.form.update(f => ({ ...f, calib: { ...f.calib, mode } }));
  }

  /** Compute the next unused field index based on existing fieldConfigs. */
  private nextFieldIndex(): number {
    const used = new Set<number>();
    for (const fc of this.fieldConfigs()) {
      const idx = fc.field_idx ?? 0;
      const iface = SENSOR_INTERFACES.find(i => i.sensorType === parseInt(fc.field_key?.split('_')[0] ?? '', 10));
      const count = sensorFieldCount(iface?.sensorType ?? 0);
      for (let i = 0; i < count; i++) used.add(idx + i);
    }
    let next = 0;
    while (used.has(next)) next++;
    return next;
  }

  /** Compute the next unused sensor slot index. */
  private nextSlot(): number {
    return Math.min(this.fieldConfigs().length, 7);
  }

  save(): void {
    if (!this.canSave() || this.saving()) return;
    const f = this.form();
    const iface = SENSOR_INTERFACES.find(i => i.id === f.interfaceId)!;
    const fieldIndex = this.nextFieldIndex();
    const slot = this.nextSlot();
    this.lastFieldIndex.set(fieldIndex);

    // Build push-sensor-slot body
    let param1Raw: number | undefined;
    let param2Raw: number | undefined;
    let calibOffset: number | undefined;
    let calibSpan: number | undefined;
    let flags = 0x01; // enabled

    if (iface.needsCalib) {
      if (f.calib.mode === 'datasheet') {
        calibOffset = f.calib.physMin;
        calibSpan = f.calib.physMax - f.calib.physMin;
      } else {
        const newOffset = applyTrim(f.calib.physMin, f.calib.currentReading, f.calib.expectedValue);
        calibOffset = newOffset;
        calibSpan = f.calib.physMax - f.calib.physMin;
      }
    } else if (f.interfaceId === 'i2c_bme280' || f.interfaceId === 'i2c_ina219') {
      param1Raw = f.i2cAddr & 0xFF;
      param2Raw = 0;
    } else if (f.interfaceId === 'pulse') {
      param1Raw = f.pulsesPerUnit & 0xFFFF;
      param2Raw = 0;
    } else if (f.interfaceId === 'modbus_rtu') {
      param1Raw = (f.modbusDevAddr & 0xFF) | ((f.modbusFuncCode & 0xFF) << 8);
      param2Raw = f.modbusRegAddr & 0xFFFF;
      if (f.modbusRegSigned) flags |= 0x04;
    }

    const pinOrBus = iface.busAddressed ? f.busIndex : f.pinIndex;

    this.saving.set(true);
    this.statusMsg.set('');

    this.api.pushSensorSlot(this.eui(), {
      slot,
      type: iface.sensorType,
      pin_index: pinOrBus,
      field_index: fieldIndex,
      flags,
      calib_offset: calibOffset,
      calib_span: calibSpan,
      param1_raw: param1Raw,
      param2_raw: param2Raw,
    }).subscribe({
      next: () => {
        // Create device field metadata record
        this.api.createDeviceField({
          device_eui: this.eui(),
          field_key: f.fieldKey.trim(),
          display_name: f.displayName.trim(),
          unit: f.unit,
          data_type: 'float',
          category: f.measurement || 'custom',
          field_idx: fieldIndex,
        }).subscribe({
          next: () => {
            this.saving.set(false);
            this.statusOk.set(true);
            this.statusMsg.set('Sensor slot configured and downlink queued. Device will apply after next uplink.');
            this.loadSuggestions(f.measurement as MeasurementType);
          },
          error: (err: { message?: string }) => {
            this.saving.set(false);
            this.statusOk.set(false);
            this.statusMsg.set('Downlink sent but field metadata failed: ' + (err?.message ?? 'unknown error'));
            this.loadSuggestions(f.measurement as MeasurementType);
          },
        });
      },
      error: (err: { message?: string }) => {
        this.saving.set(false);
        this.statusOk.set(false);
        this.statusMsg.set('Push failed: ' + (err?.message ?? 'gateway not configured'));
      },
    });
  }

  private loadSuggestions(meas: MeasurementType): void {
    const s = SUGGESTED_RULES[meas];
    this.suggestions.set(s ?? []);
  }

  addRule(s: RuleSuggestion): void {
    const opMap: Record<string, string> = { '>': 'gt', '<': 'lt', '>=': 'gte', '<=': 'lte', '==': 'eq', '!=': 'neq' };
    this.prefillRule.emit({
      field_idx: this.lastFieldIndex(),
      operator: opMap[s.operator] ?? 'lt',
      threshold: s.threshold,
      enabled: true,
    });
  }
}
