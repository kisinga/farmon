import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { JsonPipe } from '@angular/common';
import {
  ApiService,
  DeviceProfile,
  ProfileField,
  ProfileControl,
  ProfileCommand,
  DecodeRule,
} from '../../core/services/api.service';
import { DeviceManagerService } from '../../core/services/device-manager.service';

type Tab = 'general' | 'fields' | 'controls' | 'commands' | 'decode';

@Component({
  selector: 'app-profile-detail',
  standalone: true,
  imports: [RouterLink, FormsModule, JsonPipe],
  templateUrl: './profile-detail.component.html',
})
export class ProfileDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ApiService);
  private deviceManager = inject(DeviceManagerService);

  linkedDevices = computed(() =>
    this.deviceManager.devices().filter(d => d.profile === this.profileId())
  );

  profileId = signal<string>('');
  profile = signal<DeviceProfile | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  activeTab = signal<Tab>('general');

  // ─── General ────────────────────────────────────────────
  editName = '';
  editDescription = '';
  editType = 'airconfig';
  savingGeneral = signal(false);
  generalMsg = signal<{ text: string; error: boolean } | null>(null);

  // ─── Fields ─────────────────────────────────────────────
  fields = signal<ProfileField[]>([]);
  editingField = signal<Partial<ProfileField> & { _isNew?: boolean } | null>(null);
  savingField = signal(false);
  fieldMsg = signal<{ text: string; error: boolean } | null>(null);

  // ─── Controls ───────────────────────────────────────────
  controls = signal<ProfileControl[]>([]);
  editingControl = signal<Partial<ProfileControl> & { _isNew?: boolean; _statesStr?: string } | null>(null);
  savingControl = signal(false);
  controlMsg = signal<{ text: string; error: boolean } | null>(null);

  // ─── Commands ───────────────────────────────────────────
  commands = signal<ProfileCommand[]>([]);
  editingCommand = signal<Partial<ProfileCommand> & { _isNew?: boolean } | null>(null);
  savingCommand = signal(false);
  commandMsg = signal<{ text: string; error: boolean } | null>(null);

  // ─── Decode Rules ───────────────────────────────────────
  decodeRules = signal<DecodeRule[]>([]);
  editingRule = signal<Partial<DecodeRule> & { _isNew?: boolean; _configStr?: string } | null>(null);
  savingRule = signal(false);
  ruleMsg = signal<{ text: string; error: boolean } | null>(null);

  // ─── Computed ───────────────────────────────────────────
  isAirConfig = computed(() => this.profile()?.profile_type === 'airconfig');
  profileTitle = computed(() => this.profile()?.name ?? 'Profile');

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Missing profile ID');
      this.loading.set(false);
      return;
    }
    this.profileId.set(id);
    this.loadProfile(id);
  }

  private loadProfile(id: string): void {
    this.loading.set(true);
    this.api.getProfile(id).subscribe({
      next: (p) => {
        this.profile.set(p);
        this.editName = p.name;
        this.editDescription = p.description ?? '';
        this.editType = p.profile_type;
        this.fields.set(p.fields ?? []);
        this.controls.set(p.controls ?? []);
        this.commands.set(p.commands ?? []);
        this.decodeRules.set(p.decode_rules ?? []);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.message ?? 'Failed to load profile');
        this.loading.set(false);
      },
    });
  }

  private reloadSubData(): void {
    const id = this.profileId();
    this.api.getProfileFields(id).subscribe(f => this.fields.set(f));
    this.api.getProfileControls(id).subscribe(c => this.controls.set(c));
    this.api.getProfileCommands(id).subscribe(c => this.commands.set(c));
    this.api.getDecodeRules(id).subscribe(r => this.decodeRules.set(r));
  }

  // ═══════════════════════════════════════════════════════════
  // GENERAL TAB
  // ═══════════════════════════════════════════════════════════

  saveGeneral(): void {
    const id = this.profileId();
    if (!this.editName.trim()) return;
    this.savingGeneral.set(true);
    this.generalMsg.set(null);
    this.api.updateProfile(id, {
      name: this.editName.trim(),
      description: this.editDescription.trim(),
    }).subscribe({
      next: () => {
        this.savingGeneral.set(false);
        this.generalMsg.set({ text: 'Profile updated', error: false });
        this.profile.update(p => p ? { ...p, name: this.editName.trim(), description: this.editDescription.trim() } : p);
        setTimeout(() => this.generalMsg.set(null), 3000);
      },
      error: (err) => {
        this.savingGeneral.set(false);
        this.generalMsg.set({ text: err?.error?.error ?? err?.message ?? 'Failed to save', error: true });
      },
    });
  }

  deleteProfile(): void {
    const p = this.profile();
    if (!p || !confirm(`Delete profile "${p.name}"? This will also delete all its fields, controls, commands, and decode rules.`)) return;
    this.api.deleteProfile(p.id).subscribe({
      next: () => this.router.navigate(['/profiles']),
      error: (err) => this.generalMsg.set({ text: err?.message ?? 'Failed to delete', error: true }),
    });
  }

  // ═══════════════════════════════════════════════════════════
  // FIELDS TAB
  // ═══════════════════════════════════════════════════════════

  startAddField(): void {
    this.editingField.set({
      _isNew: true,
      key: '',
      display_name: '',
      unit: '',
      data_type: 'number',
      category: 'telemetry',
      access: 'r',
      state_class: '',
      min_value: 0,
      max_value: 0,
      sort_order: this.fields().length,
    });
  }

  startEditField(f: ProfileField): void {
    this.editingField.set({ ...f });
  }

  cancelEditField(): void {
    this.editingField.set(null);
    this.fieldMsg.set(null);
  }

  saveField(): void {
    const ef = this.editingField();
    if (!ef || !ef.key?.trim() || !ef.display_name?.trim()) {
      this.fieldMsg.set({ text: 'Key and display name are required', error: true });
      return;
    }
    this.savingField.set(true);
    this.fieldMsg.set(null);
    const data: Record<string, unknown> = {
      profile: this.profileId(),
      key: ef.key!.trim(),
      display_name: ef.display_name!.trim(),
      unit: ef.unit ?? '',
      data_type: ef.data_type ?? 'number',
      category: ef.category ?? 'telemetry',
      access: ef.access ?? 'r',
      state_class: ef.state_class ?? '',
      min_value: ef.min_value ?? 0,
      max_value: ef.max_value ?? 0,
      sort_order: ef.sort_order ?? 0,
    };

    const obs = (ef as { _isNew?: boolean })._isNew
      ? this.api.createProfileField(data)
      : this.api.updateProfileField(ef.id!, data);

    obs.subscribe({
      next: () => {
        this.savingField.set(false);
        this.editingField.set(null);
        this.api.getProfileFields(this.profileId()).subscribe(f => this.fields.set(f));
      },
      error: (err) => {
        this.savingField.set(false);
        this.fieldMsg.set({ text: err?.error?.message ?? err?.message ?? 'Failed to save field', error: true });
      },
    });
  }

  deleteField(f: ProfileField): void {
    if (!confirm(`Delete field "${f.display_name}"?`)) return;
    this.api.deleteProfileField(f.id).subscribe({
      next: () => this.api.getProfileFields(this.profileId()).subscribe(fs => this.fields.set(fs)),
      error: (err) => this.fieldMsg.set({ text: err?.message ?? 'Failed to delete', error: true }),
    });
  }

  // ═══════════════════════════════════════════════════════════
  // CONTROLS TAB
  // ═══════════════════════════════════════════════════════════

  startAddControl(): void {
    this.editingControl.set({
      _isNew: true,
      key: '',
      display_name: '',
      _statesStr: 'off, on',
      sort_order: this.controls().length,
    });
  }

  startEditControl(c: ProfileControl): void {
    this.editingControl.set({ ...c, _statesStr: (c.states ?? []).join(', ') });
  }

  cancelEditControl(): void {
    this.editingControl.set(null);
    this.controlMsg.set(null);
  }

  saveControl(): void {
    const ec = this.editingControl();
    if (!ec || !ec.key?.trim() || !ec.display_name?.trim()) {
      this.controlMsg.set({ text: 'Key and display name are required', error: true });
      return;
    }
    const states = (ec._statesStr ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (states.length < 2) {
      this.controlMsg.set({ text: 'At least 2 states required (comma-separated)', error: true });
      return;
    }
    this.savingControl.set(true);
    this.controlMsg.set(null);
    const data: Record<string, unknown> = {
      profile: this.profileId(),
      key: ec.key!.trim(),
      display_name: ec.display_name!.trim(),
      states,
      sort_order: ec.sort_order ?? 0,
    };

    const obs = (ec as { _isNew?: boolean })._isNew
      ? this.api.createProfileControl(data)
      : this.api.updateProfileControl(ec.id!, data);

    obs.subscribe({
      next: () => {
        this.savingControl.set(false);
        this.editingControl.set(null);
        this.api.getProfileControls(this.profileId()).subscribe(c => this.controls.set(c));
      },
      error: (err) => {
        this.savingControl.set(false);
        this.controlMsg.set({ text: err?.error?.message ?? err?.message ?? 'Failed to save control', error: true });
      },
    });
  }

  deleteControl(c: ProfileControl): void {
    if (!confirm(`Delete control "${c.display_name}"?`)) return;
    this.api.deleteProfileControl(c.id).subscribe({
      next: () => this.api.getProfileControls(this.profileId()).subscribe(cs => this.controls.set(cs)),
      error: (err) => this.controlMsg.set({ text: err?.message ?? 'Failed to delete', error: true }),
    });
  }

  // ═══════════════════════════════════════════════════════════
  // COMMANDS TAB
  // ═══════════════════════════════════════════════════════════

  startAddCommand(): void {
    this.editingCommand.set({
      _isNew: true,
      name: '',
      fport: 10,
      payload_type: 'empty',
    });
  }

  startEditCommand(c: ProfileCommand): void {
    this.editingCommand.set({ ...c });
  }

  cancelEditCommand(): void {
    this.editingCommand.set(null);
    this.commandMsg.set(null);
  }

  saveCommand(): void {
    const ec = this.editingCommand();
    if (!ec || !ec.name?.trim() || !ec.fport) {
      this.commandMsg.set({ text: 'Name and message type are required', error: true });
      return;
    }
    this.savingCommand.set(true);
    this.commandMsg.set(null);
    const data: Record<string, unknown> = {
      profile: this.profileId(),
      name: ec.name!.trim(),
      fport: ec.fport,
      payload_type: ec.payload_type ?? 'empty',
    };

    const obs = (ec as { _isNew?: boolean })._isNew
      ? this.api.createProfileCommand(data)
      : this.api.updateProfileCommand(ec.id!, data);

    obs.subscribe({
      next: () => {
        this.savingCommand.set(false);
        this.editingCommand.set(null);
        this.api.getProfileCommands(this.profileId()).subscribe(c => this.commands.set(c));
      },
      error: (err) => {
        this.savingCommand.set(false);
        this.commandMsg.set({ text: err?.error?.message ?? err?.message ?? 'Failed to save command', error: true });
      },
    });
  }

  deleteCommand(c: ProfileCommand): void {
    if (!confirm(`Delete command "${c.name}"?`)) return;
    this.api.deleteProfileCommand(c.id).subscribe({
      next: () => this.api.getProfileCommands(this.profileId()).subscribe(cs => this.commands.set(cs)),
      error: (err) => this.commandMsg.set({ text: err?.message ?? 'Failed to delete', error: true }),
    });
  }

  // ═══════════════════════════════════════════════════════════
  // DECODE RULES TAB
  // ═══════════════════════════════════════════════════════════

  startAddRule(): void {
    this.editingRule.set({
      _isNew: true,
      fport: 2,
      format: 'text_kv',
      _configStr: '{"separator": ",", "kv_separator": ":"}',
    });
  }

  startEditRule(r: DecodeRule): void {
    this.editingRule.set({
      ...r,
      _configStr: JSON.stringify(r.config, null, 2),
    });
  }

  cancelEditRule(): void {
    this.editingRule.set(null);
    this.ruleMsg.set(null);
  }

  saveRule(): void {
    const er = this.editingRule();
    if (!er || !er.fport || !er.format) {
      this.ruleMsg.set({ text: 'Message type and format are required', error: true });
      return;
    }
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(er._configStr ?? '{}');
    } catch {
      this.ruleMsg.set({ text: 'Config must be valid JSON', error: true });
      return;
    }
    this.savingRule.set(true);
    this.ruleMsg.set(null);
    const data: Record<string, unknown> = {
      profile: this.profileId(),
      fport: er.fport,
      format: er.format,
      config,
    };

    const obs = (er as { _isNew?: boolean })._isNew
      ? this.api.createDecodeRule(data)
      : this.api.updateDecodeRule(er.id!, data);

    obs.subscribe({
      next: () => {
        this.savingRule.set(false);
        this.editingRule.set(null);
        this.api.getDecodeRules(this.profileId()).subscribe(r => this.decodeRules.set(r));
      },
      error: (err) => {
        this.savingRule.set(false);
        this.ruleMsg.set({ text: err?.error?.message ?? err?.message ?? 'Failed to save rule', error: true });
      },
    });
  }

  deleteRule(r: DecodeRule): void {
    if (!confirm(`Delete decode rule for message type ${r.fport}?`)) return;
    this.api.deleteDecodeRule(r.id).subscribe({
      next: () => this.api.getDecodeRules(this.profileId()).subscribe(rs => this.decodeRules.set(rs)),
      error: (err) => this.ruleMsg.set({ text: err?.message ?? 'Failed to delete', error: true }),
    });
  }

  // ─── Inline edit helpers (spread not allowed in templates) ──
  updateField(key: string, value: unknown): void {
    const ef = this.editingField();
    if (ef) this.editingField.set({ ...ef, [key]: value });
  }
  updateControl(key: string, value: unknown): void {
    const ec = this.editingControl();
    if (ec) this.editingControl.set({ ...ec, [key]: value });
  }
  updateCommand(key: string, value: unknown): void {
    const ec = this.editingCommand();
    if (ec) this.editingCommand.set({ ...ec, [key]: value });
  }
  updateRule(key: string, value: unknown): void {
    const er = this.editingRule();
    if (er) this.editingRule.set({ ...er, [key]: value });
  }

  // ─── Test decode ────────────────────────────────────────
  testFPort = 2;
  testPayloadHex = '';
  testResult = signal<Record<string, unknown> | null>(null);
  testError = signal<string | null>(null);
  testing = signal(false);

  runTestDecode(): void {
    if (!this.testPayloadHex.trim()) return;
    this.testing.set(true);
    this.testResult.set(null);
    this.testError.set(null);
    this.api.testDecode(this.profileId(), this.testFPort, this.testPayloadHex.trim()).subscribe({
      next: (res) => {
        this.testing.set(false);
        this.testResult.set(res.result);
      },
      error: (err) => {
        this.testing.set(false);
        this.testError.set(err?.error?.error ?? err?.message ?? 'Decode failed');
      },
    });
  }
}
