import { Component, inject } from '@angular/core';
import { ConfirmService } from '../../core/services/confirm.service';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  template: `
    @if (confirm.state(); as s) {
      <dialog class="modal modal-open" style="position: fixed;">
        <div class="modal-box max-w-sm">
          <h3 class="font-bold text-lg">{{ s.title }}</h3>
          <p class="py-4 text-sm text-base-content/70">{{ s.message }}</p>
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="confirm.respond(false)">Cancel</button>
            <button
              class="btn"
              [class.btn-error]="(s.variant ?? 'error') === 'error'"
              [class.btn-warning]="s.variant === 'warning'"
              (click)="confirm.respond(true)"
            >{{ s.confirmLabel ?? 'Delete' }}</button>
          </div>
        </div>
        <div class="modal-backdrop" (click)="confirm.respond(false)"></div>
      </dialog>
    }
  `,
})
export class ConfirmDialogComponent {
  protected confirm = inject(ConfirmService);
}
