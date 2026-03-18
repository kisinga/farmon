import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, GatewaySettings } from '../../core/services/api.service';
import { GatewaySettingsComponent } from '../gateway-settings/gateway-settings.component';
import { FirmwareCommandsComponent } from '../firmware-commands/firmware-commands.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [RouterLink, GatewaySettingsComponent, FirmwareCommandsComponent],
  template: `
    <header class="page-header">
      <div>
        <h1 class="page-title">Settings</h1>
        <p class="page-description">System-wide configuration for transport, gateway, and firmware compatibility.</p>
      </div>
    </header>

    <!-- Tabs -->
    <div class="tabs tabs-boxed bg-base-200/50 p-1 rounded-xl mb-6">
      <button class="tab rounded-lg" [class.tab-active]="activeTab() === 'transport'" (click)="activeTab.set('transport')">
        Transport
        @if (!gatewaySettings()?.saved) { <span class="badge badge-warning badge-xs ml-1">!</span> }
      </button>
      <button class="tab rounded-lg" [class.tab-active]="activeTab() === 'firmware'" (click)="activeTab.set('firmware')">
        Firmware
      </button>
    </div>

    @switch (activeTab()) {
      @case ('transport') {
        <div class="space-y-4">
          @if (gatewaySettings()) {
            <app-gateway-settings
              [embedded]="true"
              [initialSettings]="gatewaySettings()!"
              (gatewaySaved)="onGatewaySaved($event)"
            />
          } @else if (loadingSettings()) {
            <div class="flex justify-center py-12">
              <span class="loading loading-spinner loading-lg text-primary"></span>
            </div>
          } @else {
            <app-gateway-settings [embedded]="true" />
          }

          <!-- Link to frames monitor -->
          <div class="card-elevated">
            <div class="card-body-spaced">
              <div class="flex items-center justify-between">
                <div>
                  <h2 class="section-title">Network frames</h2>
                  <p class="text-xs text-base-content/50 mt-0.5">View raw LoRaWAN frames to debug uplinks and downlinks.</p>
                </div>
                <a routerLink="/network" class="btn btn-ghost btn-sm gap-1">
                  View frames →
                </a>
              </div>
            </div>
          </div>
        </div>
      }

      @case ('firmware') {
        <app-firmware-commands />
      }
    }
  `,
})
export class SettingsComponent implements OnInit {
  private api = inject(ApiService);

  activeTab = signal<'transport' | 'firmware'>('transport');
  gatewaySettings = signal<GatewaySettings | null>(null);
  loadingSettings = signal(true);

  ngOnInit(): void {
    this.api.getGatewaySettings().subscribe({
      next: (res) => {
        this.gatewaySettings.set(res);
        this.loadingSettings.set(false);
      },
      error: () => this.loadingSettings.set(false),
    });
  }

  onGatewaySaved(settings: GatewaySettings): void {
    this.gatewaySettings.set(settings);
  }
}
