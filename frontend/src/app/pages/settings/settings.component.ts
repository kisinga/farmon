import { Component } from '@angular/core';
import { FirmwareCommandsComponent } from '../firmware-commands/firmware-commands.component';
import { LorawanSettingsComponent } from './lorawan-settings.component';
import { WifiSettingsComponent } from './wifi-settings.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FirmwareCommandsComponent, LorawanSettingsComponent, WifiSettingsComponent],
  template: `
    <header class="page-header">
      <div>
        <h1 class="page-title">Settings</h1>
        <p class="page-description">System-wide configuration for transports and firmware.</p>
      </div>
    </header>

    <h2 class="text-lg font-semibold mb-4">Transports</h2>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <app-lorawan-settings />
      <app-wifi-settings />
    </div>

    <h2 class="text-lg font-semibold mb-4">Firmware</h2>
    <app-firmware-commands />
  `,
})
export class SettingsComponent {}
