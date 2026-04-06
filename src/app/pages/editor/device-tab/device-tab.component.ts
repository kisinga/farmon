import { Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { BoardService } from '../../../core/services/board.service';
import { peripheralIconPath, peripheralLabel, peripheralDescription } from '../../../core/models/peripheral-icons';

@Component({
  selector: 'app-device-tab',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (editor.topology(); as t) {
      <div class="max-w-2xl space-y-6">
        <!-- Device identity -->
        <div class="card bg-base-100 shadow-sm border border-base-200">
          <div class="card-body gap-4">
            <h2 class="card-title text-base">Device Identity</h2>
            <div class="grid grid-cols-2 gap-4">
              <label class="form-control">
                <div class="label"><span class="label-text font-medium">Friendly Name</span></div>
                <input
                  type="text"
                  class="input input-bordered input-sm"
                  [ngModel]="t.device.friendly_name"
                  (ngModelChange)="update('friendly_name', $event)"
                />
              </label>
              <label class="form-control">
                <div class="label"><span class="label-text font-medium">Device ID</span></div>
                <input
                  type="text"
                  class="input input-bordered input-sm font-mono"
                  [ngModel]="t.device.name"
                  (ngModelChange)="update('name', $event)"
                />
                <div class="label"><span class="label-text-alt text-base-content/60">Lowercase, no spaces. Used in ESPHome config.</span></div>
              </label>
            </div>
          </div>
        </div>

        <!-- Board selection -->
        <div class="card bg-base-100 shadow-sm border border-base-200">
          <div class="card-body gap-4">
            <h2 class="card-title text-base">Target Board</h2>
            <label class="form-control">
              <div class="label"><span class="label-text font-medium">Board</span></div>
              <select
                class="select select-bordered select-sm"
                [ngModel]="t.device.board"
                (ngModelChange)="changeBoard($event)"
              >
                @for (b of boards.boards(); track b.id) {
                  <option [value]="b.id">{{ b.label }}</option>
                }
              </select>
            </label>

            @if (editor.board(); as board) {
              <div class="grid grid-cols-2 gap-3 mt-2">
                @for (p of peripherals(); track p.key) {
                  <div class="flex items-center gap-3 p-3 rounded-lg bg-base-200/50">
                    <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-success/20">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="p.iconPath" />
                      </svg>
                    </div>
                    <div>
                      <div class="text-sm font-medium">{{ p.label }}</div>
                      <div class="text-xs text-base-content/60">{{ p.description }}</div>
                    </div>
                  </div>
                }
              </div>

              <div class="stats stats-horizontal bg-base-200/50 w-full mt-2">
                <div class="stat py-3 px-4">
                  <div class="stat-title text-xs">Exposed Pins</div>
                  <div class="stat-value text-lg">{{ board.pins.length }}</div>
                </div>
                <div class="stat py-3 px-4">
                  <div class="stat-title text-xs">Reserved</div>
                  <div class="stat-value text-lg">{{ editor.reservedPins().size }}</div>
                </div>
                <div class="stat py-3 px-4">
                  <div class="stat-title text-xs">Available</div>
                  <div class="stat-value text-lg">{{ board.pins.length - editor.reservedPins().size }}</div>
                </div>
              </div>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class DeviceTabComponent {
  protected editor = inject(SystemEditorService);
  protected boards = inject(BoardService);

  protected peripherals = computed(() => {
    const board = this.editor.board();
    if (!board) return [];
    return Object.entries(board.peripherals)
      .filter(([_, val]) => !!val)
      .map(([key, val]) => ({
        key,
        label: peripheralLabel(key),
        description: peripheralDescription(key, val as Record<string, unknown>),
        iconPath: peripheralIconPath(key, (val as Record<string, unknown>)?.['icon'] as string | undefined),
      }));
  });

  update(field: 'name' | 'friendly_name', value: string) {
    this.editor.updateTopology((t) => { t.device[field] = value; });
  }

  async changeBoard(boardId: string) {
    await this.boards.load(boardId);
    this.editor.updateTopology((t) => { t.device.board = boardId; });
  }
}
