import { Component, inject, input, signal, effect, OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ApiService, CommandRecord } from '../../../core/services/api.service';
import { PocketBaseService } from '../../../core/services/pocketbase.service';
import type { Subscription } from 'rxjs';

@Component({
  selector: 'app-command-history',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="space-y-3">
      <h3 class="text-sm font-medium text-base-content/70">Command History</h3>
      @if (commands().length === 0) {
        <p class="text-base-content/50 text-sm">No commands sent yet.</p>
      } @else {
        <div class="overflow-x-auto">
          <table class="table table-xs w-full">
            <thead>
              <tr>
                <th>Time</th>
                <th>Command</th>
                <th>Source</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (cmd of commands(); track cmd.id) {
                <tr>
                  <td class="text-xs text-base-content/60 whitespace-nowrap">{{ cmd.created | date:'short' }}</td>
                  <td class="font-mono text-xs">{{ cmd.command_key }}</td>
                  <td class="text-xs">{{ cmd.initiated_by }}</td>
                  <td>
                    <span class="badge badge-xs"
                      [class.badge-success]="cmd.status === 'sent' || cmd.status === 'ok' || cmd.status === 'acked' || cmd.status === 'received'"
                      [class.badge-error]="cmd.status === 'error' || cmd.status === 'ack_error'"
                      [class.badge-ghost]="cmd.status !== 'sent' && cmd.status !== 'ok' && cmd.status !== 'acked' && cmd.status !== 'received' && cmd.status !== 'error' && cmd.status !== 'ack_error'"
                    >{{ cmd.status }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class CommandHistoryComponent implements OnDestroy {
  private api = inject(ApiService);
  private pbService = inject(PocketBaseService);

  eui = input.required<string>();
  commands = signal<CommandRecord[]>([]);

  private unsub: (() => Promise<void>) | null = null;

  constructor() {
    effect(() => {
      const eui = this.eui();
      if (!eui) return;

      // Initial load
      this.api.getCommandHistory(eui).subscribe({
        next: (cmds) => this.commands.set(cmds),
      });

      // Realtime subscription
      const filter = this.pbService.pb.filter('device_eui = {:eui}', { eui });
      this.pbService.pb.collection('commands').subscribe('*', (event) => {
        if (event.action === 'create') {
          const rec = event.record as unknown as CommandRecord;
          this.commands.update(list => [rec, ...list].slice(0, 50));
        }
      }, { filter }).then(unsub => {
        this.unsub = unsub;
      });
    });
  }

  ngOnDestroy(): void {
    this.unsub?.();
  }
}
