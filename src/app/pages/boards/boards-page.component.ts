import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackendService } from '../../core/services/backend.service';

@Component({
  selector: 'app-boards-page',
  standalone: true,
  imports: [FormsModule],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="max-w-5xl mx-auto w-full px-8 py-8">
      <div class="mb-8">
        <h1 class="text-2xl font-bold tracking-tight">Boards</h1>
        <p class="text-sm text-base-content/50 mt-1">Supported controller boards</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        @for (b of boards(); track b.model) {
          <div class="card bg-base-100 border border-base-300/50">
            <div class="card-body">
              <h2 class="card-title text-sm">{{ b.label }}</h2>
              <p class="text-xs text-base-content/50 font-mono">{{ b.model }}</p>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class BoardsPageComponent implements OnInit {
  private backend = inject(BackendService);
  boards = signal<Array<{ model: string; label: string }>>([]);

  async ngOnInit() {
    const list = await this.backend.boardList();
    this.boards.set(list.map(b => ({ model: b.model, label: b.label })));
  }
}
