import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';

export interface GatewaySummary {
  id: string;
  name?: string;
  online?: boolean;
  lastSeen?: string;
}

@Component({
  selector: 'app-gateway-status-banner',
  standalone: true,
  template: `
    @if (showBanner()) {
      <div class="alert alert-warning shadow-lg rounded-none flex flex-row items-center justify-center gap-2">
        <span>No gateway online. Device uplinks may not be received.</span>
      </div>
    }
  `,
})
export class GatewayStatusBannerComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private intervalId: ReturnType<typeof setInterval> | null = null;

  showBanner = signal(false);

  ngOnInit(): void {
    this.refresh();
    this.intervalId = setInterval(() => this.refresh(), 30_000);
  }

  ngOnDestroy(): void {
    if (this.intervalId != null) {
      clearInterval(this.intervalId);
    }
  }

  refresh(): void {
    this.api.getGatewayStatus().subscribe({
      next: (res) => {
        const gateways = (res?.gateways ?? []) as GatewaySummary[];
        const anyOnline = gateways.some((g) => g.online === true);
        this.showBanner.set(gateways.length === 0 || !anyOnline);
      },
      error: () => this.showBanner.set(true),
    });
  }
}
