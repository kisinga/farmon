import { Component, input, output, signal, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, DeviceField } from '../../../core/services/api.service';
import { applyTrim } from '../../../core/constants/sensor-config';
import {
  MeasurementInfo, AirConfigValidationError, AirConfigSensor,
  DriverDef, IOType, DriverStatus, isInputDriver,
} from '../../../core/services/api.types';
import { IOSlotService } from '../../../core/services/io-slot.service';
import { MAX_SENSOR_SLOTS, pinFunctionName, type PinFunctionName } from '../../../core/utils/firmware-constraints';
import { ConfigContextService } from '../../../core/services/config-context.service';
import { PinRequirementsComponent } from '../pin-requirements/pin-requirements.component';

interface CalibForm {
  mode: 'datasheet' | 'trim';
  physMin: number;
  physMax: number;
  currentReading: number;
  expectedValue: number;
}

interface SensorForm {
  ioType: IOType | '';
  driverId: string;
  interfaceId: string;
  unit: string;
  displayName: string;
  fieldKey: string;
  pinIndex: number;
  busIndex: number | undefined;
  i2cAddr: number;
  pulsesPerUnit: number;
  modbusDevAddr: number;
  modbusFuncCode: number;
  modbusRegAddr: number;
  modbusRegSigned: boolean;
  digitalPullMode: 0 | 1 | 2;
  calib: CalibForm;
  reportMode: 'reported' | 'on_change' | 'disabled';
}

function defaultForm(): SensorForm {
  return {
    ioType: '',
    driverId: '',
    interfaceId: '',
    unit: '',
    displayName: '',
    fieldKey: '',
    pinIndex: 0,
    busIndex: undefined,
    i2cAddr: 0x76,
    pulsesPerUnit: 1,
    modbusDevAddr: 1,
    modbusFuncCode: 3,
    modbusRegAddr: 0,
    modbusRegSigned: false,
    digitalPullMode: 0,
    calib: { mode: 'datasheet', physMin: 0, physMax: 100, currentReading: 0, expectedValue: 0 },
    reportMode: 'reported',
  };
}

const IO_TYPE_LABELS: Record<string, string> = {
  i2c: 'I2C', spi: 'SPI', gpio: 'Digital', adc: 'Analog',
  onewire: 'OneWire', uart: 'UART', pulse: 'Pulse',
};

@Component({
  selector: 'app-device-sensor-config',
  standalone: true,
  imports: [FormsModule, PinRequirementsComponent],
  template: `
    <div class="space-y-6">

      <!-- Status banner -->
      @if (statusMsg()) {
        <div [class]="'alert ' + (statusOk() ? 'alert-success' : 'alert-error') + ' py-2 text-sm'">
          {{ statusMsg() }}
        </div>
      }

      <!-- Tier 1: IO Type -->
      <div class="card bg-base-200">
        <div class="card-body py-4">
          <h3 class="card-title text-sm">IO Type</h3>
          <div class="flex flex-wrap gap-2 mt-2">
            @for (iot of ioTypes(); track iot) {
              <button class="btn btn-sm" [class.btn-primary]="form().ioType === iot"
                (click)="selectIOType(iot)">{{ ioTypeLabel(iot) }}</button>
            }
          </div>
        </div>
      </div>

      @if (form().ioType) {
        <!-- Tier 2: Driver selection -->
        <div class="card bg-base-200">
          <div class="card-body py-4 space-y-3">
            <h3 class="card-title text-sm">Driver</h3>

            <label class="form-control w-full max-w-xs">
              <div class="label py-1"><span class="label-text text-xs">Driver</span></div>
              <select class="select select-bordered select-sm" [ngModel]="form().driverId"
                (ngModelChange)="onDriverChange($event)">
                <option value="">— select —</option>
                @for (d of filteredDrivers(); track d.id) {
                  <option [value]="d.id" [disabled]="d.status === 'deferred'">
                    {{ d.label }}{{ d.status === 'deferred' ? ' (coming soon)' : '' }}
                  </option>
                }
              </select>
            </label>

            <!-- Tier 3: Pin/Bus selection -->
            @if (selectedDriver()) {
              <app-pin-requirements
                [driver]="selectedDriver()"
                [pinMap]="pinMap()"
                [pinCaps]="ctx.pinCaps()?.pins ?? []"
                [boardDef]="ctx.boardDef()"
                [usedPins]="usedPins()"
                [selectedPins]="[form().pinIndex]"
                [busIndex]="form().busIndex"
                [busAddress]="form().i2cAddr"
                (pinsChanged)="onPinSelected($any($event[0]))"
                (busIndexChanged)="onBusIndexChange($event)"
                (busAddressChanged)="onI2CAddrNum($event)"
              />

              <!-- Tier 3b: Driver parameters -->

              <!-- Pull mode (digital input only) -->
              @if (form().driverId === 'digital_in') {
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

              <!-- Pulse settings -->
              @if (form().driverId === 'pulse_generic') {
                <label class="form-control w-40">
                  <div class="label py-1"><span class="label-text text-xs">Pulses per Unit</span></div>
                  <input type="number" class="input input-bordered input-sm" [(ngModel)]="form().pulsesPerUnit" min="1" />
                </label>
              }

              <!-- Modbus settings -->
              @if (form().driverId === 'modbus_rtu') {
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

              <!-- Calibration (ADC sensors) -->
              @if (selectedDriver()!.needs_calib) {
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
                      offset={{ calibPreview().offset.toFixed(1) }}, span={{ calibPreview().span.toFixed(1) }}
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
                      new offset={{ trimPreview().toFixed(1) }}
                    </div>
                  </div>
                }
              }

              <!-- Auto-generated fields from driver definition -->
              @if (selectedDriver()!.fields?.length) {
                <div class="divider text-xs">Fields ({{ selectedDriver()!.field_count }})</div>
                @for (f of selectedDriver()!.fields; track f.label; let i = $index) {
                  <div class="flex gap-2 items-center text-sm">
                    <span class="w-24 text-base-content/60">{{ f.label }}</span>
                    <span class="badge badge-xs">{{ f.unit }}</span>
                    <span class="text-xs text-base-content/40">{{ f.default_min }}–{{ f.default_max }}</span>
                  </div>
                }
              }

              <!-- Target field -->
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

                @if (creatingNewField()) {
                  <div class="flex gap-2 flex-wrap pl-1 border-l-2 border-primary/30 ml-1">
                    <label class="form-control w-36">
                      <div class="label py-1"><span class="label-text text-xs">Field Key</span></div>
                      <input class="input input-bordered input-sm" [ngModel]="form().fieldKey"
                        (ngModelChange)="onFieldKeyChange($event)" placeholder="e.g. soil_1" />
                    </label>
                    <label class="form-control w-48">
                      <div class="label py-1"><span class="label-text text-xs">Display Name</span></div>
                      <input class="input input-bordered input-sm" [ngModel]="form().displayName"
                        (ngModelChange)="onDisplayNameChange($event)" placeholder="e.g. Soil Moisture" />
                    </label>
                    <label class="form-control w-24">
                      <div class="label py-1"><span class="label-text text-xs">Unit</span></div>
                      <input class="input input-bordered input-sm" [ngModel]="form().unit"
                        (ngModelChange)="onUnitChange($event)" placeholder="e.g. %" />
                    </label>
                    <label class="form-control w-36">
                      <div class="label py-1"><span class="label-text text-xs">Telemetry</span></div>
                      <select class="select select-bordered select-sm"
                        [value]="form().reportMode"
                        (change)="setReportMode($any($event.target).value)">
                        <option value="reported">Reported</option>
                        <option value="on_change">On Change</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </label>
                  </div>
                } @else if (fieldSelection() && fieldSelection() !== '__new__') {
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
            }
          </div>
        </div>
      }

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
      @if (selectedDriver()) {
        <button class="btn btn-primary w-full" [disabled]="!canSave() || saving()"
          (click)="save()">
          {{ saving() ? 'Sending…' : isEditMode() ? 'Update & Push' : 'Configure & Push to Device' }}
        </button>
      }

    </div>
  `,
})
export class DeviceSensorConfigComponent implements OnInit, OnDestroy {
  eui = input.required<string>();
  fieldConfigs = input<DeviceField[]>([]);
  pinMap = input<number[]>([]);
  usedPins = input<Set<number>>(new Set());

  existingSlot = input<number | null>(null);
  existingSensor = input<AirConfigSensor | null>(null);
  existingField = input<DeviceField | null>(null);

  saved = output<void>();

  private api = inject(ApiService);
  private ioSlotService = inject(IOSlotService);
  protected ctx = inject(ConfigContextService);

  // Catalog data
  readonly drivers = signal<DriverDef[]>([]);
  readonly interfaces = signal<unknown[]>([]); // legacy — unused, kept for catalog.interfaces compat
  readonly measurements = signal<MeasurementInfo[]>([]);
  private fieldCounts = signal<Record<string, number>>({});

  form = signal<SensorForm>(defaultForm());
  saving = signal(false);
  statusMsg = signal('');
  statusOk = signal(true);
  validationErrors = signal<AirConfigValidationError[]>([]);
  validationWarnings = signal<AirConfigValidationError[]>([]);

  creatingNewField = signal(false);
  fieldSelection = signal<string>('');

  isEditMode = computed(() => this.existingSlot() !== null);

  // Input drivers only (exclude output-only drivers from sensor config)
  private inputDrivers = computed(() => this.drivers().filter(isInputDriver));

  // Distinct IO types from the input driver catalog
  ioTypes = computed<IOType[]>(() => {
    const types = new Set<IOType>();
    for (const d of this.inputDrivers()) {
      types.add(d.io_type);
    }
    const order: IOType[] = ['i2c', 'adc', 'gpio', 'onewire', 'spi', 'uart', 'pulse'];
    return order.filter(t => types.has(t));
  });

  // Drivers filtered by selected IO type (input only)
  filteredDrivers = computed(() => {
    const ioType = this.form().ioType;
    if (!ioType) return [];
    return this.inputDrivers()
      .filter(d => d.io_type === ioType)
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'ready' ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
  });

  selectedDriver = computed(() => {
    const id = this.form().driverId;
    if (!id) return null;
    return this.drivers().find(d => d.id === id) ?? null;
  });

  // Map driver's pin function to PinFunctionName for the pin dropdown
  requiredPinCapability = computed<PinFunctionName>(() => {
    const driver = this.selectedDriver();
    if (!driver) return 'unused';
    const fn = driver.pin_functions?.[0] ?? 0;
    return pinFunctionName(fn);
  });

  ioTypeLabel(iot: IOType): string {
    return IO_TYPE_LABELS[iot] ?? iot.toUpperCase();
  }

  ngOnInit(): void {
    this.api.getSensorCatalog().subscribe(catalog => {
      this.measurements.set(catalog.measurements);
      this.fieldCounts.set(catalog.field_counts);
      this.drivers.set(catalog.drivers ?? []);
      if (this.existingSensor()) {
        this.populateFromExisting();
      }
    });
  }

  private populateFromExisting(): void {
    const sensor = this.existingSensor();
    const field = this.existingField();
    if (!sensor) return;

    // Find the driver by sensor_type
    const driver = this.drivers().find(d => d.sensor_type === sensor.type);
    if (!driver) return;

    const flags = sensor.flags ?? 0x01;
    let reportMode: 'reported' | 'on_change' | 'disabled' = 'reported';
    if (flags & 0x10) reportMode = 'disabled';
    else if (flags & 0x20) reportMode = 'on_change';

    this.form.update(f => ({
      ...f,
      ioType: driver.io_type,
      driverId: driver.id,
      interfaceId: driver.id,
      fieldKey: field?.field_key ?? '',
      displayName: field?.display_name ?? '',
      unit: field?.unit ?? '',
      pinIndex: driver.bus_addressed ? f.pinIndex : sensor.pin_index,
      busIndex: driver.bus_addressed ? sensor.pin_index : f.busIndex,
      i2cAddr: driver.default_i2c_addr ?? 0x76,
      reportMode,
    }));

    if (!driver.bus_addressed && sensor.pin_index !== 255) {
      this.ctx.setActivePinSelection(sensor.pin_index);
    }

    if (field) {
      this.fieldSelection.set(field.field_key);
      this.creatingNewField.set(false);
    }
  }

  ngOnDestroy(): void {
    this.ctx.setActivePinSelection(null);
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
    if (!f.driverId) return false;
    const driver = this.selectedDriver();
    if (driver?.bus_addressed && f.busIndex == null) return false;
    if (this.creatingNewField()) {
      return f.fieldKey.trim() !== '' && f.displayName.trim() !== '';
    }
    return this.fieldSelection() !== '' && this.fieldSelection() !== '__new__';
  });

  // ─── IO Type selection ─────────────────────────────────────
  selectIOType(ioType: IOType): void {
    this.form.update(f => ({ ...defaultForm(), ioType, driverId: '' }));
    this.fieldSelection.set('');
    this.creatingNewField.set(false);
    this.ctx.setActivePinSelection(null);
    this.validationErrors.set([]);
    this.validationWarnings.set([]);
  }

  // ─── Driver selection ──────────────────────────────────────
  onDriverChange(driverId: string): void {
    this.form.update(f => ({
      ...f,
      driverId,
      interfaceId: driverId,
    }));
    this.ctx.setActivePinSelection(null);
    this.validationErrors.set([]);
    this.validationWarnings.set([]);
    this.fieldSelection.set('');
    this.creatingNewField.set(false);

    if (driverId) {
      this.applyDriverDefaults(driverId);
    }
  }

  private applyDriverDefaults(driverId: string): void {
    const driver = this.drivers().find(d => d.id === driverId);
    if (!driver) return;

    // Auto-fill I2C address
    if (driver.default_i2c_addr) {
      this.form.update(f => ({ ...f, i2cAddr: driver.default_i2c_addr! }));
    }

    // Auto-fill unit from first field
    if (driver.fields?.length) {
      const firstField = driver.fields[0];
      this.form.update(f => ({
        ...f,
        unit: firstField.unit,
        displayName: driver.label,
        calib: {
          ...f.calib,
          physMin: firstField.default_min,
          physMax: firstField.default_max,
        },
      }));
    }

    // Auto-create new field
    this.fieldSelection.set('__new__');
    this.creatingNewField.set(true);
    this.form.update(f => ({
      ...f,
      fieldKey: driverId + '_' + (this.fieldConfigs().length + 1),
    }));
  }

  // ─── Field selection ─────────────────────────────────────
  onFieldSelect(value: string): void {
    this.fieldSelection.set(value);
    if (value === '__new__') {
      this.creatingNewField.set(true);
      this.form.update(f => ({
        ...f,
        fieldKey: f.driverId ? f.driverId + '_' + (this.fieldConfigs().length + 1) : '',
      }));
    } else if (value) {
      this.creatingNewField.set(false);
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

  // ─── Form handlers ──────────────────────────────────────
  onPinSelected(pin: number): void {
    this.form.update(f => ({ ...f, pinIndex: pin }));
    this.ctx.setActivePinSelection(pin);
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

  onI2CAddrNum(addr: number): void {
    this.form.update(f => ({ ...f, i2cAddr: addr }));
  }

  onBusIndexChange(idx: number): void {
    this.form.update(f => ({ ...f, busIndex: idx }));
  }

  onFieldKeyChange(v: string): void { this.form.update(f => ({ ...f, fieldKey: v })); }
  onDisplayNameChange(v: string): void { this.form.update(f => ({ ...f, displayName: v })); }
  onUnitChange(v: string): void { this.form.update(f => ({ ...f, unit: v })); }

  setReportMode(value: 'reported' | 'on_change' | 'disabled'): void {
    this.form.update(f => ({ ...f, reportMode: value }));
  }

  setCalibMode(mode: 'datasheet' | 'trim'): void {
    this.form.update(f => ({ ...f, calib: { ...f.calib, mode } }));
  }

  // ─── Field index helpers ────────────────────────────────
  private nextFieldIndex(): number {
    const used = new Set<number>();
    const fc = this.fieldCounts();
    for (const cfg of this.fieldConfigs()) {
      const idx = cfg.field_idx ?? 0;
      const count = fc[String(idx)] ?? 1;
      for (let i = 0; i < count; i++) used.add(idx + i);
    }
    let next = 0;
    while (used.has(next)) next++;
    return next;
  }

  private nextSlot(): number {
    return Math.min(this.fieldConfigs().length, MAX_SENSOR_SLOTS - 1);
  }

  private getExistingFieldIndex(fieldKey: string): number {
    const field = this.fieldConfigs().find(f => f.field_key === fieldKey);
    return field?.field_idx ?? this.nextFieldIndex();
  }

  // ─── Validation ─────────────────────────────────────────
  validate(): void {
    const f = this.form();
    const driver = this.selectedDriver();
    if (!driver) return;

    const fieldIndex = this.creatingNewField() ? this.nextFieldIndex() : this.getExistingFieldIndex(f.fieldKey);
    const pinOrBus = driver.bus_addressed ? (f.busIndex ?? 0) : f.pinIndex;

    const sensor = {
      type: driver.sensor_type ?? 0,
      pin_index: pinOrBus,
      field_index: fieldIndex,
      flags: 0x01,
      param1: 0,
      param2: 0,
    };

    this.ioSlotService.validateAirConfig({
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
    const driver = this.selectedDriver();
    if (!driver) return;

    const isNewField = this.creatingNewField();
    const fieldIndex = isNewField ? this.nextFieldIndex() : this.getExistingFieldIndex(f.fieldKey);
    const slot = this.existingSlot() ?? this.nextSlot();

    let param1Raw: number | undefined;
    let param2Raw: number | undefined;
    let calibOffset: number | undefined;
    let calibSpan: number | undefined;
    let flags = 0x01;
    if (f.reportMode === 'disabled') flags |= 0x10;
    else if (f.reportMode === 'on_change') flags |= 0x20;

    if (driver.needs_calib) {
      if (f.calib.mode === 'datasheet') {
        calibOffset = f.calib.physMin;
        calibSpan = f.calib.physMax - f.calib.physMin;
      } else {
        const newOffset = applyTrim(f.calib.physMin, f.calib.currentReading, f.calib.expectedValue);
        calibOffset = newOffset;
        calibSpan = f.calib.physMax - f.calib.physMin;
      }
    } else if (driver.default_i2c_addr) {
      param1Raw = f.i2cAddr & 0xFF;
      param2Raw = 0;
    } else if (f.driverId === 'pulse_generic') {
      param1Raw = f.pulsesPerUnit & 0xFFFF;
      param2Raw = 0;
    } else if (f.driverId === 'modbus_rtu') {
      param1Raw = (f.modbusDevAddr & 0xFF) | ((f.modbusFuncCode & 0xFF) << 8);
      param2Raw = f.modbusRegAddr & 0xFFFF;
      if (f.modbusRegSigned) flags |= 0x04;
    } else if (f.driverId === 'digital_in') {
      param1Raw = f.digitalPullMode;
    }

    const pinOrBus = driver.bus_addressed ? (f.busIndex ?? 0) : f.pinIndex;

    this.saving.set(true);
    this.statusMsg.set('');

    this.api.pushSensorSlot(this.eui(), {
      slot,
      type: driver.sensor_type ?? 0,
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
          this.api.createDeviceField({
            device_eui: this.eui(),
            field_key: f.fieldKey.trim(),
            display_name: f.displayName.trim(),
            unit: f.unit,
            data_type: 'float',
            category: f.driverId,
            field_idx: fieldIndex,
            linked_type: 'input',
            linked_key: f.driverId,
            report_mode: f.reportMode,
          }).subscribe({
            next: () => this.resetAndEmit(),
            error: (err: { message?: string }) => {
              this.saving.set(false);
              this.statusOk.set(false);
              this.statusMsg.set('Downlink sent but field metadata failed: ' + (err?.message ?? 'unknown error'));
            },
          });
        } else {
          const existingF = this.existingField();
          const nameChanged = existingF && (existingF.display_name !== f.displayName.trim() || existingF.unit !== f.unit);
          if (existingF && nameChanged) {
            this.api.updateDeviceField(existingF.id, {
              display_name: f.displayName.trim(),
              unit: f.unit,
            }).subscribe({
              next: () => this.resetAndEmit(),
              error: () => this.resetAndEmit(),
            });
          } else {
            this.resetAndEmit();
          }
        }
      },
      error: (err: { message?: string }) => {
        this.saving.set(false);
        this.statusOk.set(false);
        this.statusMsg.set('Push failed: ' + (err?.message ?? 'gateway not configured'));
      },
    });
  }

  private resetAndEmit(): void {
    this.saving.set(false);
    this.form.set(defaultForm());
    this.fieldSelection.set('');
    this.creatingNewField.set(false);
    this.saved.emit();
  }
}
