import { Component, input, output, signal, computed, inject, OnInit, OnDestroy, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, DeviceField } from '../../../core/services/api.service';
import { applyTrim } from '../../../core/constants/sensor-config';
import { SensorInterfaceInfo, SensorPresetInfo, MeasurementInfo, AirConfigValidationError } from '../../../core/services/api.types';
import { SensorService } from '../../../core/services/sensor.service';
import { MAX_SENSOR_SLOTS, pinFunctionName, type PinFunctionName } from '../../../core/utils/firmware-constraints';
import { ConfigContextService } from '../../../core/services/config-context.service';

interface CalibForm {
  mode: 'datasheet' | 'trim';
  physMin: number;
  physMax: number;
  currentReading: number;
  expectedValue: number;
}

interface SensorForm {
  presetId: string;
  interfaceId: string;
  unit: string;
  displayName: string;
  fieldKey: string;
  pinIndex: number;
  busIndex: number;
  i2cAddr: number;
  pulsesPerUnit: number;
  modbusDevAddr: number;
  modbusFuncCode: number;
  modbusRegAddr: number;
  modbusRegSigned: boolean;
  digitalPullMode: 0 | 1 | 2;
  calib: CalibForm;
  reportInTelemetry: boolean;
}

function defaultForm(): SensorForm {
  return {
    presetId: '',
    interfaceId: '',
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
    digitalPullMode: 0,
    calib: { mode: 'datasheet', physMin: 0, physMax: 100, currentReading: 0, expectedValue: 0 },
    reportInTelemetry: true,
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
          <h3 class="card-title text-sm">Quick Start — Choose an input preset</h3>
          <div class="flex flex-wrap gap-2 mt-2">
            @for (p of presets(); track p.id) {
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
          <h3 class="card-title text-sm">Input Configuration</h3>

          <!-- Interface -->
          <label class="form-control w-full max-w-xs">
            <div class="label py-1"><span class="label-text text-xs">Interface / Driver</span></div>
            <select class="select select-bordered select-sm" [(ngModel)]="form().interfaceId"
              (ngModelChange)="onInterfaceChange($event)">
              <option value="">— select —</option>
              @for (iface of interfaces(); track iface.id) {
                <option [value]="iface.id">{{ iface.label }}</option>
              }
            </select>
          </label>

          <!-- Target field (dropdown + inline create) -->
          <div class="space-y-2">
            <label class="form-control w-full max-w-xs">
              <div class="label py-1"><span class="label-text text-xs">Target Field</span></div>
              <select class="select select-bordered select-sm"
                [ngModel]="fieldSelection()"
                (ngModelChange)="onFieldSelect($event)">
                <option value="">— select a field —</option>
                @for (f of fieldConfigs(); track f.field_key) {
                  <option [value]="f.field_key">{{ f.field_key }} — {{ f.display_name }}{{ f.unit ? ' (' + f.unit + ')' : '' }}</option>
                }
                <option value="__new__">+ Create new field</option>
              </select>
            </label>

            <!-- Always show display name + unit so user can review/edit without guessing -->
            @if (creatingNewField()) {
              <div class="flex gap-2 flex-wrap pl-1 border-l-2 border-primary/30 ml-1">
                <label class="form-control w-36">
                  <div class="label py-1"><span class="label-text text-xs">Field Key</span></div>
                  <input class="input input-bordered input-sm" [(ngModel)]="form().fieldKey" placeholder="e.g. soil_1" />
                </label>
                <label class="form-control w-48">
                  <div class="label py-1"><span class="label-text text-xs">Display Name</span></div>
                  <input class="input input-bordered input-sm" [(ngModel)]="form().displayName" placeholder="e.g. Soil Moisture" />
                </label>
                <label class="form-control w-24">
                  <div class="label py-1"><span class="label-text text-xs">Unit</span></div>
                  <input class="input input-bordered input-sm" [(ngModel)]="form().unit" placeholder="e.g. %" />
                </label>
                <label class="form-control justify-end">
                  <div class="label py-1"><span class="label-text text-xs">Report in telemetry</span></div>
                  <input type="checkbox" class="checkbox checkbox-sm"
                    [checked]="form().reportInTelemetry"
                    (change)="setReportInTelemetry($any($event.target).checked)" />
                </label>
              </div>
            } @else if (fieldSelection() && fieldSelection() !== '__new__') {
              <!-- Existing field selected — show its metadata as editable in case user wants to correct it -->
              <div class="flex gap-2 flex-wrap pl-1 border-l-2 border-base-300 ml-1">
                <label class="form-control w-48">
                  <div class="label py-1"><span class="label-text text-xs">Display Name</span></div>
                  <input class="input input-bordered input-sm" [(ngModel)]="form().displayName" placeholder="Display Name" />
                </label>
                <label class="form-control w-24">
                  <div class="label py-1"><span class="label-text text-xs">Unit</span></div>
                  <input class="input input-bordered input-sm" [(ngModel)]="form().unit" placeholder="e.g. %" />
                </label>
              </div>
            }
          </div>

          <!-- GPIO pin (non-bus sensors) -->
          @if (selectedInterface() && !selectedInterface()!.bus_addressed) {
            <div class="form-control">
              <div class="label py-1"><span class="label-text text-xs">GPIO Pin</span></div>

              @if (pinMap().length > 0) {
                <!-- Board-picker mode: badge + button -->
                <div class="flex items-center gap-3 flex-wrap">
                  @if (pinExplicitlySelected()) {
                    <div class="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-lg px-3 py-1.5">
                      <span class="w-2 h-2 rounded-full bg-primary"></span>
                      <span class="text-sm font-mono font-semibold">Pin {{ form().pinIndex }}</span>
                      <span class="text-xs text-base-content/50">— {{ pinCapName(form().pinIndex) }}</span>
                      <span class="text-success text-xs">✓</span>
                    </div>
                    <button type="button" class="btn btn-xs btn-ghost"
                      (click)="openPinPicker()">Change</button>
                  } @else if (ctx.isPinPickerActive()) {
                    <div class="flex items-center gap-2 text-blue-400 text-sm animate-pulse">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                      </svg>
                      Click a highlighted pin on the board above
                    </div>
                  } @else {
                    <button type="button" class="btn btn-sm btn-outline"
                      (click)="openPinPicker()">Select Pin</button>
                  }
                </div>
              } @else {
                <!-- Fallback: plain number input for non-AirConfig devices -->
                <input type="number" class="input input-bordered input-sm w-24"
                  [(ngModel)]="form().pinIndex" min="0" max="19" />
              }
            </div>
          }

          <!-- Pull mode (digital input only) -->
          @if (selectedInterface()?.id === 'digital_in') {
            <label class="form-control w-48">
              <div class="label py-1"><span class="label-text text-xs">Pull mode</span></div>
              <select class="select select-bordered select-sm" [(ngModel)]="form().digitalPullMode"
                (ngModelChange)="setDigitalPullMode($event)">
                <option [value]="0">Pull-up (default)</option>
                <option [value]="1">Pull-down</option>
                <option [value]="2">Floating (no pull)</option>
              </select>
            </label>
          }

          <!-- Bus index (I2C/UART sensors) -->
          @if (selectedInterface()?.bus_addressed) {
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
          @if (selectedInterface()?.needs_calib) {
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

      <!-- Validation results -->
      @if (validationErrors().length > 0) {
        <div class="space-y-1">
          @for (err of validationErrors(); track err.message) {
            <div class="alert alert-error py-1 text-xs">{{ err.message }}</div>
          }
        </div>
      }
      @if (validationWarnings().length > 0) {
        <div class="space-y-1">
          @for (warn of validationWarnings(); track warn.message) {
            <div class="alert alert-warning py-1 text-xs">{{ warn.message }}</div>
          }
        </div>
      }

      <!-- Action -->
      <button class="btn btn-primary w-full" [disabled]="!canSave() || saving()"
        (click)="save()">
        {{ saving() ? 'Sending…' : 'Configure & Push to Device' }}
      </button>

    </div>
  `,
})
export class DeviceSensorConfigComponent implements OnInit, OnDestroy {
  eui = input.required<string>();
  fieldConfigs = input<DeviceField[]>([]);
  /** pin_map from ConfigContextService — drives board picker. */
  pinMap = input<number[]>([]);
  /** Pins already used by other sensors and outputs. */
  usedPins = input<Set<number>>(new Set());

  /** Emitted after a successful save so the parent can reload and hide the wizard. */
  saved = output<void>();

  private api = inject(ApiService);
  private sensorService = inject(SensorService);
  protected ctx = inject(ConfigContextService);

  /** True once the user has explicitly clicked a pin on the board. */
  pinExplicitlySelected = signal(false);

  readonly presets = signal<SensorPresetInfo[]>([]);
  readonly interfaces = signal<SensorInterfaceInfo[]>([]);
  readonly measurements = signal<MeasurementInfo[]>([]);
  private fieldCounts = signal<Record<string, number>>({});

  form = signal<SensorForm>(defaultForm());
  saving = signal(false);
  statusMsg = signal('');
  statusOk = signal(true);
  validationErrors = signal<AirConfigValidationError[]>([]);
  validationWarnings = signal<AirConfigValidationError[]>([]);

  // Field selection state
  creatingNewField = signal(false);
  fieldSelection = signal<string>('');

  selectedInterface = computed(() =>
    this.interfaces().find(i => i.id === this.form().interfaceId) ?? null
  );

  /** Maps the selected interface's pin_function code to a PinFunctionName for PinSelectorComponent. */
  requiredPinCapability = computed<PinFunctionName>(() => {
    const fn = this.selectedInterface()?.pin_function ?? 0;
    return pinFunctionName(fn);
  });

  constructor() {
    // React to board pin selections (only handle 'primary' target)
    effect(() => {
      const pick = this.ctx.lastPinPick();
      if (!pick || pick.target !== 'primary') return;
      this.form.update(f => ({ ...f, pinIndex: pick.pin }));
      this.pinExplicitlySelected.set(true);
    });
  }

  ngOnInit(): void {
    this.api.getSensorCatalog().subscribe(catalog => {
      this.interfaces.set(catalog.interfaces);
      this.measurements.set(catalog.measurements);
      this.presets.set(catalog.presets);
      this.fieldCounts.set(catalog.field_counts);
    });
  }

  ngOnDestroy(): void {
    this.ctx.closePinPicker();
  }

  openPinPicker(): void {
    const excluded = new Set(this.usedPins());
    // Allow re-selecting the current pin
    if (this.pinExplicitlySelected()) excluded.delete(this.form().pinIndex);
    this.ctx.openPinPicker(this.requiredPinCapability(), 'primary', excluded);
  }

  pinCapName(pin: number): string {
    return pinFunctionName(this.pinMap()[pin] ?? 0);
  }

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
    if (f.interfaceId === '') return false;
    if (this.creatingNewField()) {
      return f.fieldKey.trim() !== '' && f.displayName.trim() !== '';
    }
    // Existing field selected
    return this.fieldSelection() !== '' && this.fieldSelection() !== '__new__';
  });

  // ─── Field selection ─────────────────────────────────────

  onFieldSelect(value: string): void {
    this.fieldSelection.set(value);
    if (value === '__new__') {
      this.creatingNewField.set(true);
      this.form.update(f => ({
        ...f,
        fieldKey: f.interfaceId ? f.interfaceId + '_' + (this.fieldConfigs().length + 1) : '',
      }));
    } else if (value) {
      this.creatingNewField.set(false);
      // Pre-fill display name and unit from the selected field so user can review/edit
      const field = this.fieldConfigs().find(fc => fc.field_key === value);
      if (field) {
        this.form.update(f => ({
          ...f,
          fieldKey: field.field_key,
          displayName: field.display_name,
          unit: field.unit ?? f.unit,
        }));
      }
    } else {
      this.creatingNewField.set(false);
      this.form.update(f => ({ ...f, fieldKey: '', displayName: '', unit: '' }));
    }
  }

  // ─── Presets ─────────────────────────────────────────────

  applyPreset(p: SensorPresetInfo): void {
    // Look up unit from measurements catalog (internal only — not shown as a dropdown)
    const unit = this.measurements().find(m => m.id === p.measurement)?.unit ?? '';
    this.form.set({
      ...defaultForm(),
      presetId: p.id,
      interfaceId: p.interface,
      unit,
      displayName: p.label,
      fieldKey: p.id + '_' + (this.fieldConfigs().length + 1),
      i2cAddr: p.i2c_addr ?? 0x76,
      pulsesPerUnit: p.pulses_per_unit ?? 1,
      calib: {
        mode: 'datasheet',
        physMin: p.calib_min,
        physMax: p.calib_max,
        currentReading: p.calib_min,
        expectedValue: p.calib_min,
      },
    });
    this.fieldSelection.set('__new__');
    this.creatingNewField.set(true);
  }

  clearPreset(): void {
    this.form.set(defaultForm());
    this.fieldSelection.set('');
    this.creatingNewField.set(false);
  }

  // ─── Form handlers ──────────────────────────────────────

  onPinSelected(pin: number): void {
    this.form.update(f => ({ ...f, pinIndex: pin }));
  }

  onInterfaceChange(id: string): void {
    this.form.update(f => ({ ...f, interfaceId: id }));
    this.pinExplicitlySelected.set(false);
    this.ctx.closePinPicker();
    this.validationErrors.set([]);
    this.validationWarnings.set([]);
  }

  setDigitalPullMode(v: unknown): void {
    const n = +(v as number);
    const mode = (n === 1 ? 1 : n === 2 ? 2 : 0) as 0 | 1 | 2;
    this.form.update(f => ({ ...f, digitalPullMode: mode }));
  }

  onI2CAddrChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const parsed = parseInt(val, 16);
    if (!isNaN(parsed)) {
      this.form.update(f => ({ ...f, i2cAddr: parsed }));
    }
  }

  setReportInTelemetry(value: boolean): void {
    this.form.update(f => ({ ...f, reportInTelemetry: value }));
  }

  setCalibMode(mode: 'datasheet' | 'trim'): void {
    this.form.update(f => ({ ...f, calib: { ...f.calib, mode } }));
  }

  // ─── Field index helpers ────────────────────────────────

  /** Compute the next unused field index based on existing fieldConfigs. */
  private nextFieldIndex(): number {
    const used = new Set<number>();
    const fc = this.fieldCounts();
    for (const cfg of this.fieldConfigs()) {
      const idx = cfg.field_idx ?? 0;
      const iface = this.interfaces().find(i => i.sensor_type === parseInt(cfg.field_key?.split('_')[0] ?? '', 10));
      const count = fc[String(iface?.sensor_type ?? 0)] ?? 1;
      for (let i = 0; i < count; i++) used.add(idx + i);
    }
    let next = 0;
    while (used.has(next)) next++;
    return next;
  }

  /** Compute the next unused sensor slot index. MAX_SENSOR_SLOTS = 8 (slots 0–7). */
  private nextSlot(): number {
    return Math.min(this.fieldConfigs().length, MAX_SENSOR_SLOTS - 1);
  }

  /** Get field_idx for an existing field by key. */
  private getExistingFieldIndex(fieldKey: string): number {
    const field = this.fieldConfigs().find(f => f.field_key === fieldKey);
    return field?.field_idx ?? this.nextFieldIndex();
  }

  // ─── Validation ─────────────────────────────────────────

  validate(): void {
    const f = this.form();
    const iface = this.interfaces().find(i => i.id === f.interfaceId);
    if (!iface) return;

    const fieldIndex = this.creatingNewField() ? this.nextFieldIndex() : this.getExistingFieldIndex(f.fieldKey);
    const pinOrBus = iface.bus_addressed ? f.busIndex : f.pinIndex;

    const sensor = {
      type: iface.sensor_type,
      pin_index: pinOrBus,
      field_index: fieldIndex,
      flags: 0x01,
      param1: 0,
      param2: 0,
    };

    this.sensorService.validateAirConfig({
      sensors: [sensor],
      controls: [],
    }).subscribe({
      next: (result) => {
        this.validationErrors.set(result.errors);
        this.validationWarnings.set(result.warnings);
      },
      error: () => {
        this.validationErrors.set([]);
        this.validationWarnings.set([]);
      },
    });
  }

  // ─── Save ───────────────────────────────────────────────

  save(): void {
    if (!this.canSave() || this.saving()) return;
    const f = this.form();
    const iface = this.interfaces().find(i => i.id === f.interfaceId)!;
    const isNewField = this.creatingNewField();
    const fieldIndex = isNewField ? this.nextFieldIndex() : this.getExistingFieldIndex(f.fieldKey);
    const slot = this.nextSlot();

    // Build push-sensor-slot body
    let param1Raw: number | undefined;
    let param2Raw: number | undefined;
    let calibOffset: number | undefined;
    let calibSpan: number | undefined;
    let flags = 0x01; // enabled

    if (iface.needs_calib) {
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
    } else if (f.interfaceId === 'digital_in') {
      param1Raw = f.digitalPullMode;
    }

    const pinOrBus = iface.bus_addressed ? f.busIndex : f.pinIndex;

    this.saving.set(true);
    this.statusMsg.set('');

    this.api.pushSensorSlot(this.eui(), {
      slot,
      type: iface.sensor_type,
      pin_index: pinOrBus,
      field_index: fieldIndex,
      flags,
      calib_offset: calibOffset,
      calib_span: calibSpan,
      param1_raw: param1Raw,
      param2_raw: param2Raw,
    }).subscribe({
      next: () => {
        if (isNewField) {
          // Create device field metadata record for new fields
          this.api.createDeviceField({
            device_eui: this.eui(),
            field_key: f.fieldKey.trim(),
            display_name: f.displayName.trim(),
            unit: f.unit,
            data_type: 'float',
            category: f.interfaceId,
            field_idx: fieldIndex,
            linked_type: 'input',
            linked_key: f.interfaceId,
            report_mode: f.reportInTelemetry ? 'reported' : 'disabled',
          }).subscribe({
            next: () => {
              this.saving.set(false);
              this.form.set(defaultForm());
              this.fieldSelection.set('');
              this.creatingNewField.set(false);
              this.saved.emit();
            },
            error: (err: { message?: string }) => {
              this.saving.set(false);
              this.statusOk.set(false);
              this.statusMsg.set('Downlink sent but field metadata failed: ' + (err?.message ?? 'unknown error'));
            },
          });
        } else {
          // Existing field — just report success
          this.saving.set(false);
          this.form.set(defaultForm());
          this.fieldSelection.set('');
          this.creatingNewField.set(false);
          this.saved.emit();
        }
      },
      error: (err: { message?: string }) => {
        this.saving.set(false);
        this.statusOk.set(false);
        this.statusMsg.set('Push failed: ' + (err?.message ?? 'gateway not configured'));
      },
    });
  }

}
