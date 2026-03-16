import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GatewayStatusService } from '../../../core/services/gateway-status.service';

@Component({
  selector: 'app-gateway-status-indicator',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="flex items-center gap-2">
      @if (gateway.online()) {
        <a
          routerLink="/lorawan"
          class="btn btn-ghost btn-sm gap-1.5 text-success hover:bg-success/10"
          title="Gateway connected"
        >
          <span class="size-2 rounded-full bg-success shrink-0" aria-hidden="true"></span>
          <span class="hidden sm:inline">Gateway</span>
        </a>
      } @else {
        <a
          routerLink="/lorawan"
          class="btn btn-ghost btn-sm gap-1.5 text-warning hover:bg-warning/10"
          title="No gateway — uplinks may not be received"
        >
          <span class="size-2 rounded-full bg-warning shrink-0" aria-hidden="true"></span>
          <span class="hidden sm:inline">Gateway offline</span>
        </a>
      }
    </div>
  `,
})
export class GatewayStatusIndicatorComponent implements OnInit, OnDestroy {
  gateway = inject(GatewayStatusService);
  private intervalId: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.gateway.refresh();
    this.intervalId = setInterval(() => this.gateway.refresh(), 30_000);
  }

  ngOnDestroy(): void {
    if (this.intervalId != null) clearInterval(this.intervalId);
  }
}
