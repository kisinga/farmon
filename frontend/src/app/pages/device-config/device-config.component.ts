import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { from } from 'rxjs';
import { PocketBaseService } from '../../core/services/pocketbase.service';
import { ApiService } from '../../core/services/api.service';
import { DeviceSensorConfigComponent } from '../../shared/components/device-sensor-config/device-sensor-config.component';
import type { DeviceField, DeviceControl, DeviceCommand, DeviceSpec } from '../../core/services/api.types';

interface DecodeRule {
  id: string;
  device_eui: string;
  fport: number;
  format: string;
  config: string; // JSON string
}

@Component({
  selector: 'app-device-config',
  standalone: true,
  imports: [FormsModule, RouterLink, JsonPipe, DeviceSensorConfigComponent],
  templateUrl: './device-config.component.html',
})
export class DeviceConfigComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private http = inject(HttpClient);
  private pb = inject(PocketBaseService).pb;
  private api = inject(ApiService);

  eui = signal<string>('');
  deviceType = signal<string>('');
  loading = signal(true);
  error = signal<string | null>(null);
  activeTab = signal<'sensors' | 'fields' | 'controls' | 'commands' | 'decode'>('fields');

  // Collection data
  fields = signal<DeviceField[]>([]);
  controls = signal<DeviceControl[]>([]);
  commands = signal<DeviceCommand[]>([]);
  decodeRules = signal<DecodeRule[]>([]);

  // Inline editing state
  editingFieldId = signal<string | null>(null);
  editingControlId = signal<string | null>(null);
  editingCommandId = signal<string | null>(null);
  editingDecodeId = signal<string | null>(null);

  // Draft objects for add/edit
  fieldDraft = signal<Partial<DeviceField>>({});
  controlDraft = signal<Partial<DeviceControl>>({});
  commandDraft = signal<Partial<DeviceCommand>>({});
  decodeDraft = signal<Partial<DecodeRule>>({});

  // Add-row toggles
  addingField = signal(false);
  addingControl = signal(false);
  addingCommand = signal(false);
  addingDecode = signal(false);

  saving = signal(false);
  message = signal<string | null>(null);
  isError = signal(false);

  // Advanced modal
  showAdvanced = signal(false);
  specJson = signal('');
  specLoading = signal(false);
  specApplying = signal(false);
  specMessage = signal<string | null>(null);
  specIsError = signal(false);

  // Test decode
  testFport = signal(1);
  testPayloadHex = signal('');
  testResult = signal<Record<string, unknown> | null>(null);
  testFormat = signal('');
  testRunning = signal(false);
  testError = signal<string | null>(null);

  isAirConfig = computed(() => this.deviceType() === 'airconfig');

  ngOnInit(): void {
    const eui = this.route.snapshot.paramMap.get('eui');
    if (!eui) {
      this.error.set('Missing device EUI');
      this.loading.set(false);
      return;
    }
    this.eui.set(eui);
    this.loadDevice(eui);
    this.loadAll(eui);
  }

  private loadDevice(eui: string): void {
    from(this.pb.collection('devices').getFirstListItem(`device_eui = "${eui}"`)).subscribe({
      next: (d: any) => this.deviceType.set(d.device_type ?? ''),
      error: () => {},
    });
  }

  private loadAll(eui: string): void {
    this.loading.set(true);
    let pending = 4;
    const done = () => { pending--; if (pending <= 0) this.loading.set(false); };

    from(this.pb.collection('device_fields').getList(1, 200, { filter: `device_eui = "${eui}"`, sort: 'field_idx' }))
      .subscribe({ next: (r) => this.fields.set(r.items as unknown as DeviceField[]), error: () => {}, complete: done });

    from(this.pb.collection('device_controls').getList(1, 200, { filter: `device_eui = "${eui}"`, sort: 'control_idx' }))
      .subscribe({ next: (r) => this.controls.set(r.items as unknown as DeviceControl[]), error: () => {}, complete: done });

    from(this.pb.collection('device_commands').getList(1, 200, { filter: `device_eui = "${eui}"` }))
      .subscribe({ next: (r) => this.commands.set(r.items as unknown as DeviceCommand[]), error: () => {}, complete: done });

    from(this.pb.collection('device_decode_rules').getList(1, 200, { filter: `device_eui = "${eui}"`, sort: 'fport' }))
      .subscribe({ next: (r) => this.decodeRules.set(r.items as unknown as DecodeRule[]), error: () => {}, complete: done });
  }

  // ─── Flash message ──────────────────────────────────────────────────────────

  private flash(msg: string, err = false): void {
    this.message.set(msg);
    this.isError.set(err);
    setTimeout(() => this.message.set(null), 4000);
  }

  // ─── Fields CRUD ────────────────────────────────────────────────────────────

  startAddField(): void {
    this.addingField.set(true);
    this.fieldDraft.set({ device_eui: this.eui(), field_key: '', display_name: '', data_type: 'float', unit: '', category: 'telemetry', field_idx: this.fields().length });
  }

  cancelAddField(): void { this.addingField.set(false); }

  saveNewField(): void {
    const d = this.fieldDraft();
    if (!d.field_key) return;
    this.saving.set(true);
    from(this.pb.collection('device_fields').create(d)).subscribe({
      next: () => { this.addingField.set(false); this.saving.set(false); this.flash('Field created'); this.loadAll(this.eui()); },
      error: (e) => { this.saving.set(false); this.flash(e?.message ?? 'Failed', true); },
    });
  }

  editField(f: DeviceField): void {
    this.editingFieldId.set(f.id);
    this.fieldDraft.set({ ...f });
  }

  cancelEditField(): void { this.editingFieldId.set(null); }

  saveEditField(): void {
    const d = this.fieldDraft();
    if (!d.id) return;
    this.saving.set(true);
    from(this.pb.collection('device_fields').update(d.id, d)).subscribe({
      next: () => { this.editingFieldId.set(null); this.saving.set(false); this.flash('Field updated'); this.loadAll(this.eui()); },
      error: (e) => { this.saving.set(false); this.flash(e?.message ?? 'Failed', true); },
    });
  }

  deleteField(f: DeviceField): void {
    if (!confirm(`Delete field "${f.field_key}"?`)) return;
    from(this.pb.collection('device_fields').delete(f.id)).subscribe({
      next: () => { this.flash('Field deleted'); this.loadAll(this.eui()); },
      error: (e) => this.flash(e?.message ?? 'Failed', true),
    });
  }

  // ─── Controls CRUD ──────────────────────────────────────────────────────────

  startAddControl(): void {
    this.addingControl.set(true);
    this.controlDraft.set({ device_eui: this.eui(), control_key: '', display_name: '', current_state: 'off', control_idx: this.controls().length });
  }

  cancelAddControl(): void { this.addingControl.set(false); }

  saveNewControl(): void {
    const d = this.controlDraft();
    if (!d.control_key) return;
    this.saving.set(true);
    // Convert states_json string to array if given as comma-separated
    const payload: any = { ...d };
    if (typeof payload.states_json === 'string') {
      payload.states_json = (payload.states_json as string).split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    from(this.pb.collection('device_controls').create(payload)).subscribe({
      next: () => { this.addingControl.set(false); this.saving.set(false); this.flash('Control created'); this.loadAll(this.eui()); },
      error: (e) => { this.saving.set(false); this.flash(e?.message ?? 'Failed', true); },
    });
  }

  editControl(c: DeviceControl): void {
    this.editingControlId.set(c.id);
    this.controlDraft.set({ ...c, states_json: c.states_json as any });
  }

  cancelEditControl(): void { this.editingControlId.set(null); }

  saveEditControl(): void {
    const d = this.controlDraft();
    if (!d.id) return;
    this.saving.set(true);
    const payload: any = { ...d };
    if (typeof payload.states_json === 'string') {
      payload.states_json = (payload.states_json as string).split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    from(this.pb.collection('device_controls').update(d.id!, payload)).subscribe({
      next: () => { this.editingControlId.set(null); this.saving.set(false); this.flash('Control updated'); this.loadAll(this.eui()); },
      error: (e) => { this.saving.set(false); this.flash(e?.message ?? 'Failed', true); },
    });
  }

  deleteControl(c: DeviceControl): void {
    if (!confirm(`Delete control "${c.control_key}"?`)) return;
    from(this.pb.collection('device_controls').delete(c.id)).subscribe({
      next: () => { this.flash('Control deleted'); this.loadAll(this.eui()); },
      error: (e) => this.flash(e?.message ?? 'Failed', true),
    });
  }

  // ─── Commands CRUD ──────────────────────────────────────────────────────────

  startAddCommand(): void {
    this.addingCommand.set(true);
    this.commandDraft.set({ device_eui: this.eui(), name: '', fport: 1, payload_type: 'empty', delivery: 'push' });
  }

  cancelAddCommand(): void { this.addingCommand.set(false); }

  saveNewCommand(): void {
    const d = this.commandDraft();
    if (!d.name) return;
    this.saving.set(true);
    from(this.pb.collection('device_commands').create(d)).subscribe({
      next: () => { this.addingCommand.set(false); this.saving.set(false); this.flash('Command created'); this.loadAll(this.eui()); },
      error: (e) => { this.saving.set(false); this.flash(e?.message ?? 'Failed', true); },
    });
  }

  editCommand(c: DeviceCommand): void {
    this.editingCommandId.set(c.id);
    this.commandDraft.set({ ...c });
  }

  cancelEditCommand(): void { this.editingCommandId.set(null); }

  saveEditCommand(): void {
    const d = this.commandDraft();
    if (!d.id) return;
    this.saving.set(true);
    from(this.pb.collection('device_commands').update(d.id, d)).subscribe({
      next: () => { this.editingCommandId.set(null); this.saving.set(false); this.flash('Command updated'); this.loadAll(this.eui()); },
      error: (e) => { this.saving.set(false); this.flash(e?.message ?? 'Failed', true); },
    });
  }

  deleteCommand(c: DeviceCommand): void {
    if (!confirm(`Delete command "${c.name}"?`)) return;
    from(this.pb.collection('device_commands').delete(c.id)).subscribe({
      next: () => { this.flash('Command deleted'); this.loadAll(this.eui()); },
      error: (e) => this.flash(e?.message ?? 'Failed', true),
    });
  }

  // ─── Decode Rules CRUD ──────────────────────────────────────────────────────

  startAddDecode(): void {
    this.addingDecode.set(true);
    this.decodeDraft.set({ device_eui: this.eui(), fport: 1, format: 'cayenne', config: '{}' });
  }

  cancelAddDecode(): void { this.addingDecode.set(false); }

  saveNewDecode(): void {
    const d = this.decodeDraft();
    if (!d.format) return;
    this.saving.set(true);
    const payload: any = { ...d };
    try { payload.config = JSON.parse(payload.config); } catch { /* keep as string */ }
    from(this.pb.collection('device_decode_rules').create(payload)).subscribe({
      next: () => { this.addingDecode.set(false); this.saving.set(false); this.flash('Decode rule created'); this.loadAll(this.eui()); },
      error: (e) => { this.saving.set(false); this.flash(e?.message ?? 'Failed', true); },
    });
  }

  editDecode(r: DecodeRule): void {
    this.editingDecodeId.set(r.id);
    this.decodeDraft.set({ ...r, config: typeof r.config === 'object' ? JSON.stringify(r.config, null, 2) : r.config });
  }

  cancelEditDecode(): void { this.editingDecodeId.set(null); }

  saveEditDecode(): void {
    const d = this.decodeDraft();
    if (!d.id) return;
    this.saving.set(true);
    const payload: any = { ...d };
    try { payload.config = JSON.parse(payload.config); } catch { /* keep as string */ }
    from(this.pb.collection('device_decode_rules').update(d.id, payload)).subscribe({
      next: () => { this.editingDecodeId.set(null); this.saving.set(false); this.flash('Decode rule updated'); this.loadAll(this.eui()); },
      error: (e) => { this.saving.set(false); this.flash(e?.message ?? 'Failed', true); },
    });
  }

  deleteDecode(r: DecodeRule): void {
    if (!confirm(`Delete decode rule for fport ${r.fport}?`)) return;
    from(this.pb.collection('device_decode_rules').delete(r.id)).subscribe({
      next: () => { this.flash('Decode rule deleted'); this.loadAll(this.eui()); },
      error: (e) => this.flash(e?.message ?? 'Failed', true),
    });
  }

  // ─── Advanced JSON modal ────────────────────────────────────────────────────

  openAdvanced(): void {
    this.showAdvanced.set(true);
    this.specLoading.set(true);
    this.specMessage.set(null);
    this.api.getDeviceSpec(this.eui()).subscribe({
      next: (spec) => { this.specJson.set(JSON.stringify(spec, null, 2)); this.specLoading.set(false); },
      error: (e) => { this.specJson.set(''); this.specLoading.set(false); this.specMessage.set(e?.error?.error ?? 'Failed to load spec'); this.specIsError.set(true); },
    });
  }

  closeAdvanced(): void { this.showAdvanced.set(false); }

  copySpec(): void {
    navigator.clipboard.writeText(this.specJson()).then(
      () => { this.specMessage.set('Copied to clipboard'); this.specIsError.set(false); },
      () => { this.specMessage.set('Copy failed'); this.specIsError.set(true); },
    );
  }

  applySpec(): void {
    let spec: DeviceSpec;
    try {
      spec = JSON.parse(this.specJson());
    } catch {
      this.specMessage.set('Invalid JSON');
      this.specIsError.set(true);
      return;
    }
    if (!confirm('This will replace ALL device configuration (fields, controls, commands, decode rules). Continue?')) return;
    this.specApplying.set(true);
    this.specMessage.set(null);
    this.api.applyDeviceSpec(this.eui(), spec).subscribe({
      next: () => {
        this.specApplying.set(false);
        this.specIsError.set(false);
        this.specMessage.set('Spec applied successfully');
        this.loadAll(this.eui());
      },
      error: (e) => {
        this.specApplying.set(false);
        this.specIsError.set(true);
        this.specMessage.set(e?.error?.error ?? 'Failed to apply spec');
      },
    });
  }

  // ─── Test Decode ────────────────────────────────────────────────────────────

  runTestDecode(): void {
    const hex = this.testPayloadHex().trim();
    if (!hex) return;
    this.testRunning.set(true);
    this.testError.set(null);
    this.testResult.set(null);

    // Build a minimal spec from current state for test-decode
    this.api.getDeviceSpec(this.eui()).subscribe({
      next: (spec) => {
        this.api.testDecode(spec, this.testFport(), hex).subscribe({
          next: (res) => {
            this.testRunning.set(false);
            this.testFormat.set(res.format);
            this.testResult.set(res.result);
          },
          error: (e) => {
            this.testRunning.set(false);
            this.testError.set(e?.error?.error ?? e?.message ?? 'Decode failed');
          },
        });
      },
      error: (e) => {
        this.testRunning.set(false);
        this.testError.set(e?.error?.error ?? 'Failed to load spec for test');
      },
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  updateFieldDraft(key: string, value: any): void {
    this.fieldDraft.update(d => ({ ...d, [key]: value }));
  }

  updateControlDraft(key: string, value: any): void {
    this.controlDraft.update(d => ({ ...d, [key]: value }));
  }

  updateCommandDraft(key: string, value: any): void {
    this.commandDraft.update(d => ({ ...d, [key]: value }));
  }

  updateDecodeDraft(key: string, value: any): void {
    this.decodeDraft.update(d => ({ ...d, [key]: value }));
  }

  formatConfig(config: any): string {
    if (typeof config === 'string') return config;
    try { return JSON.stringify(config); } catch { return String(config); }
  }

  statesDisplay(states: string[] | undefined): string {
    if (!states || !Array.isArray(states)) return '';
    return states.join(', ');
  }
}
