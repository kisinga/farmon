import { Injectable, inject, signal, OnInit } from '@angular/core';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class GatewayStatusService {
  private api = inject(ApiService);

  /** True when at least one gateway is reported online. */
  online = signal(false);

  refresh(): void {
    this.api.getGatewayStatus().subscribe({
      next: (res) => {
        const gateways = (res?.gateways ?? []) as Array<{ online?: boolean }>;
        this.online.set(gateways.some((g) => g.online === true));
      },
      error: () => this.online.set(false),
    });
  }
}
