import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type SyncState = 'synced' | 'saved' | 'unsaved';

/**
 * SyncStatusBadgeComponent — three-state config sync indicator.
 *
 * synced  → green  (firmware has received this config)
 * saved   → amber  (saved to backend, not yet pushed to device)
 * unsaved → red    (no config record yet)
 *
 * Used in Inputs tab, Outputs tab, and Automations tab headers.
 */
@Component({
  selector: 'app-sync-status-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="inline-flex items-center gap-1 text-xs font-medium"
          [class]="wrapperClass()">
      <span class="w-2 h-2 rounded-full" [class]="dotClass()"></span>
      {{ label() }}
      @if (syncedAt() && state() === 'synced') {
        <span class="opacity-60">({{ syncedAt() | date:'shortTime' }})</span>
      }
    </span>
  `,
})
export class SyncStatusBadgeComponent {
  state    = input<SyncState>('unsaved');
  syncedAt = input<string | undefined>(undefined);

  label(): string {
    switch (this.state()) {
      case 'synced':  return 'Synced';
      case 'saved':   return 'Not pushed';
      case 'unsaved': return 'Not saved';
    }
  }

  dotClass(): string {
    switch (this.state()) {
      case 'synced':  return 'bg-success';
      case 'saved':   return 'bg-warning';
      case 'unsaved': return 'bg-error';
    }
  }

  wrapperClass(): string {
    switch (this.state()) {
      case 'synced':  return 'text-success';
      case 'saved':   return 'text-warning';
      case 'unsaved': return 'text-error';
    }
  }
}
