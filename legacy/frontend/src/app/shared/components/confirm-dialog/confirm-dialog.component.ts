import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * ConfirmDialogComponent — reusable confirmation modal.
 *
 * Replaces the inline confirm patterns scattered across components.
 * Uses DaisyUI dialog/modal.
 *
 * Usage:
 *   <app-confirm-dialog
 *     [open]="showConfirm()"
 *     [title]="'Delete variable?'"
 *     [message]="'This cannot be undone.'"
 *     [dangerMode]="true"
 *     (confirmed)="doDelete()"
 *     (cancelled)="showConfirm.set(false)"
 *   />
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (open()) {
      <div class="modal modal-open">
        <div class="modal-box">
          <h3 class="font-bold text-lg">{{ title() }}</h3>
          <p class="py-4 text-sm text-base-content/80 whitespace-pre-line">{{ message() }}</p>
          @if (detail()) {
            <div class="alert alert-warning text-xs mb-4">
              <span>{{ detail() }}</span>
            </div>
          }
          <div class="modal-action">
            <button class="btn btn-ghost btn-sm" (click)="cancelled.emit()">
              Cancel
            </button>
            <button
              class="btn btn-sm"
              [class]="dangerMode() ? 'btn-error' : 'btn-primary'"
              (click)="confirmed.emit()"
            >
              {{ confirmLabel() }}
            </button>
          </div>
        </div>
        <div class="modal-backdrop" (click)="cancelled.emit()"></div>
      </div>
    }
  `,
})
export class ConfirmDialogComponent {
  open         = input<boolean>(false);
  title        = input<string>('Confirm');
  message      = input<string>('Are you sure?');
  /** Extra detail shown in a warning box (e.g. list of blocking rules). */
  detail       = input<string>('');
  confirmLabel = input<string>('Confirm');
  /** When true, the confirm button uses error styling. */
  dangerMode   = input<boolean>(false);

  confirmed = output<void>();
  cancelled = output<void>();
}
