import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Shared billing UI primitives — dumb presentational components (no services)
 * extracted from the billing pages' copy-pasted idioms:
 *
 * - `app-billing-stat-card`  — the headline figure card (dashboard widget card idiom).
 * - `app-billing-empty-state` — the dashed-box empty state used across the section.
 * - `app-billing-banner`     — the dismissible transient success/error banner.
 * - `app-billing-page-error` — full-section load-failure state with a Retry action.
 */

export type BillingTone = 'default' | 'success' | 'warning' | 'error';

/** Headline figure card (label + value + optional hint), tabular-nums for the figure. */
@Component({
  selector: 'app-billing-stat-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="rounded-xl border border-base-300/40 bg-base-100 p-4">
      <p class="text-[11px] font-medium uppercase tracking-wide text-base-content/40">{{ label() }}</p>
      <p class="text-lg font-semibold tabular-nums mt-0.5" [class]="valueClass()">{{ value() }}</p>
      @if (hint(); as h) {
        <p class="text-[11px] text-base-content/50 mt-0.5">{{ h }}</p>
      }
    </div>
  `,
})
export class BillingStatCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly hint = input<string>();
  readonly tone = input<BillingTone>('default');

  protected valueClass(): string {
    switch (this.tone()) {
      case 'success': return 'text-success';
      case 'warning': return 'text-warning';
      case 'error': return 'text-error';
      default: return '';
    }
  }
}

/** The section's standard empty state: dashed box + muted text. */
@Component({
  selector: 'app-billing-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="rounded-2xl border border-dashed border-base-300/50 py-10 text-center">
      <p class="text-sm font-medium">{{ title() }}</p>
      @if (hint(); as h) {
        <p class="text-sm text-base-content/50 mt-1">{{ h }}</p>
      }
    </div>
  `,
})
export class BillingEmptyStateComponent {
  readonly title = input.required<string>();
  readonly hint = input<string>();
}

/** Dismissible transient status banner (operation feedback, not load errors). */
@Component({
  selector: 'app-billing-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div role="alert" class="alert text-sm py-2 mb-4" [class]="kind() === 'success' ? 'alert-success' : 'alert-error'">
      <span>{{ text() }}</span>
      <button class="btn btn-ghost btn-xs" (click)="dismissed.emit()">Dismiss</button>
    </div>
  `,
})
export class BillingBannerComponent {
  readonly kind = input.required<'success' | 'error'>();
  readonly text = input.required<string>();

  readonly dismissed = output<void>();
}

/**
 * Full-section load-failure state: the error text plus a Retry action, so a
 * failed load never renders as an empty site.
 */
@Component({
  selector: 'app-billing-page-error',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="rounded-2xl border border-dashed border-base-300/50 py-10 text-center">
      <p class="text-sm font-medium text-error">{{ text() }}</p>
      <p class="text-sm text-base-content/50 mt-1">The section failed to load.</p>
      <button class="btn btn-sm btn-ghost mt-3" (click)="retry.emit()">Retry</button>
    </div>
  `,
})
export class BillingPageErrorComponent {
  readonly text = input.required<string>();

  readonly retry = output<void>();
}
