import { Component, inject, signal, effect, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';

import { ConfigContextService } from '../../core/services/config-context.service';
import { InputsTabComponent } from '../../shared/components/inputs-tab/inputs-tab.component';
import { OutputsTabComponent } from '../../shared/components/outputs-tab/outputs-tab.component';
import { VariablesTabComponent } from '../../shared/components/variables-tab/variables-tab.component';
import { DeviceAutomationsSectionComponent } from '../../shared/components/device-automations-section/device-automations-section.component';
import { DecodeTabComponent } from '../../shared/components/decode-tab/decode-tab.component';
import { SpecJsonModalComponent } from '../../shared/components/spec-json-modal/spec-json-modal.component';
import { DeviceBoardSvgComponent } from '../../shared/components/device-board-svg/device-board-svg.component';

type ConfigTab = 'inputs' | 'outputs' | 'variables' | 'automations' | 'decode';

@Component({
  selector: 'app-device-config',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    InputsTabComponent,
    OutputsTabComponent,
    VariablesTabComponent,
    DeviceAutomationsSectionComponent,
    DecodeTabComponent,
    SpecJsonModalComponent,
    DeviceBoardSvgComponent,
  ],
  templateUrl: './device-config.component.html',
})
export class DeviceConfigComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  protected ctx = inject(ConfigContextService);

  activeTab = signal<ConfigTab>('inputs');
  showSpecModal = signal(false);

  constructor() {
    effect(() => {
      const hidden = !this.ctx.isLoRaWAN() || this.ctx.isAirConfig();
      if (hidden && this.activeTab() === 'decode') this.activeTab.set('inputs');
    });
  }

  ngOnInit(): void {
    const eui = this.route.snapshot.paramMap.get('eui') ?? '';
    const tab = (this.route.snapshot.queryParamMap.get('tab') ?? 'inputs') as ConfigTab;
    this.activeTab.set(tab);
    this.ctx.load(eui);
  }

  ngOnDestroy(): void {
    this.ctx.clear();
  }
}
