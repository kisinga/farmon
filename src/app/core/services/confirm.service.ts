import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Action-button intent. Defaults to 'primary' (a safe, non-destructive button) so a
   *  caller that forgets to set it never renders a red "Delete" by accident. Use 'error'
   *  for destructive actions, 'warning' for significant-but-reversible ones. */
  variant?: 'primary' | 'warning' | 'error';
  /** Info/acknowledge dialog: a single button, no Cancel. Still awaitable, but there is
   *  nothing to cancel — for "you can't do X" messages, not yes/no decisions. */
  acknowledge?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly state = signal<ConfirmState | null>(null);

  confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      this.state.set({ ...options, resolve });
    });
  }

  /** Called by the dialog component */
  respond(confirmed: boolean): void {
    const s = this.state();
    if (s) {
      s.resolve(confirmed);
      this.state.set(null);
    }
  }
}
