import { Component, inject, computed, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { GatewayStatusIndicatorComponent } from './shared/components/gateway-status-indicator/gateway-status-indicator.component';
import { GatewayStatusService } from './core/services/gateway-status.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, GatewayStatusIndicatorComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  private gateway = inject(GatewayStatusService);

  showGatewayWarning = computed(() => !this.gateway.online());

  ngOnInit(): void {
    this.gateway.refresh();
  }

  closeDropdown(_e: Event): void {
    (document.activeElement as HTMLElement)?.blur();
  }
}
