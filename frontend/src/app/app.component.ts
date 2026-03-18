import { Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { DeviceManagerService } from './core/services/device-manager.service';
import { GatewayStatusService } from './core/services/gateway-status.service';
import { NavbarComponent } from './shared/components/navbar/navbar.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, NavbarComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  private gateway = inject(GatewayStatusService);
  private deviceManager = inject(DeviceManagerService);

  showGatewayWarning = computed(() => !this.gateway.online());

  ngOnInit(): void {
    this.gateway.refresh();
    this.deviceManager.loadDevices();
  }
}
