import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, BackendInfo, FirmwareCommand } from '../../core/services/api.service';

@Component({
  selector: 'app-firmware-commands',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './firmware-commands.component.html',
})
export class FirmwareCommandsComponent implements OnInit {
  private api = inject(ApiService);

  commands = signal<FirmwareCommand[]>([]);
  backendInfo = signal<BackendInfo | null>(null);
  editingVersionsStr = signal('');
  savingInfo = signal(false);
  msg = signal<{ text: string; error: boolean } | null>(null);

  ngOnInit(): void {
    this.api.getFirmwareCommands().subscribe({
      next: (list) => this.commands.set(list),
      error: () => this.setMsg('Failed to load commands', true),
    });
    this.api.getBackendInfo().subscribe({
      next: (info) => {
        this.backendInfo.set(info);
        this.editingVersionsStr.set(info.supported_firmware_versions.join(', '));
      },
    });
  }

  saveBackendInfo(): void {
    const versions = this.editingVersionsStr()
      .split(',').map(v => v.trim()).filter(Boolean);
    this.savingInfo.set(true);
    this.api.patchBackendInfo({ supported_firmware_versions: versions }).subscribe({
      next: (info) => { this.savingInfo.set(false); this.backendInfo.set(info); },
      error: () => { this.savingInfo.set(false); this.setMsg('Failed to save compatibility info', true); },
    });
  }

  private setMsg(text: string, error: boolean): void {
    this.msg.set({ text, error });
  }
}
