import { Component, ElementRef, TemplateRef, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { cycleWidth, moveItem, type LayoutItem } from './layout';

/**
 * WidgetGridComponent — the dashboard grid renderer. Dumb by design: it owns
 * ONLY placement (order, width, visibility); the parent owns what each instance
 * renders via a single `ng-template` outlet (`let-item`).
 *
 * Responsive columns (matches the old dashboard's lg/sm/mobile breakpoints):
 * - ≥1024px: 12 columns — w4 → span 4 (⅓), w6 → span 6 (½), w12 → span 12 (full).
 * - 640–1023px: 4 columns — w12 → span 4 (full), w6 → span 2 (half), w4 → span 2
 *   (half; a third-of-desktop widget keeps half a tablet row rather than a
 *   cramped quarter).
 * - <640px: 1 column — everything full width.
 *
 * Edit mode (`editing` input): each visible cell gets a chrome bar — a drag
 * handle (hand-rolled pointer events: capture on the handle, track a drop
 * target by hit-testing cell rects, emit ONE reordered array on pointerup), a
 * width cycle button (⅓ → ½ → full) and a hide button. Every mutation emits
 * the full new `LayoutItem[]` via `itemsChange`; the parent owns the state.
 * The chrome is hidden below 640px — phone is read-only (spec §4), and the
 * shell never offers edit mode there either.
 */
@Component({
  selector: 'app-widget-grid',
  standalone: true,
  imports: [NgTemplateOutlet],
  template: `
    <div class="wg-grid" [class.wg-editing]="editing()">
      @for (item of items(); track item.instanceId) {
        @if (sectionFor($index); as sec) {
          <div class="wg-section" aria-hidden="true">{{ sec }}</div>
        }
        @if (!item.hidden) {
          <div class="wg-cell" [class]="'wg-w' + item.w"
               [class.wg-drag-target]="dragTargetId() === item.instanceId"
               [attr.data-iid]="item.instanceId">
            @if (editing()) {
              <div class="wg-edit-ui">
                <button type="button" class="wg-handle" title="Drag to reorder" aria-label="Drag to reorder"
                        (pointerdown)="dragStart($event, item.instanceId)"
                        (pointermove)="dragMove($event)"
                        (pointerup)="dragEnd()"
                        (pointercancel)="dragCancel()">
                  <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
                </button>
                <button type="button" class="wg-btn" title="Change width (⅓ / ½ / full)" (click)="resizeItem(item)">{{ widthLabel(item.w) }}</button>
                <button type="button" class="wg-btn" title="Hide this widget" aria-label="Hide this widget" (click)="hideItem(item)">
                  <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="m1 1 22 22"/></svg>
                </button>
              </div>
            }
            <ng-container [ngTemplateOutlet]="itemTemplate()" [ngTemplateOutletContext]="{ $implicit: item }" />
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .wg-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 0.75rem; }
    .wg-cell { min-width: 0; }
    /* Zone header (curated default layouts only — stored layouts carry no
       sections): full-width, quiet, reads as a label not a panel. */
    .wg-section { grid-column: 1 / -1; font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.45; margin-top: 0.5rem; }
    .wg-section:first-child { margin-top: 0; }
    .wg-w4  { grid-column: span 4 / span 4; }
    .wg-w6  { grid-column: span 6 / span 6; }
    .wg-w12 { grid-column: span 12 / span 12; }
    @media (max-width: 1023.98px) {
      .wg-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .wg-w4, .wg-w6 { grid-column: span 2 / span 2; }
      .wg-w12 { grid-column: span 4 / span 4; }
    }
    @media (max-width: 639.98px) {
      .wg-grid { grid-template-columns: minmax(0, 1fr); }
      .wg-w4, .wg-w6, .wg-w12 { grid-column: 1 / -1; }
      /* Phone is read-only (spec §4): no edit affordances below 640px. */
      .wg-edit-ui { display: none; }
    }

    /* --- Edit-mode chrome ------------------------------------------------- */
    .wg-editing .wg-cell { outline: 1px dashed color-mix(in oklab, currentColor 25%, transparent); outline-offset: -1px; border-radius: 0.5rem; }
    .wg-cell.wg-drag-target { outline: 2px solid color-mix(in oklab, currentColor 55%, transparent); }
    .wg-edit-ui { display: flex; align-items: center; gap: 0.25rem; padding: 0.125rem 0.25rem; margin-bottom: 0.125rem; }
    .wg-handle { cursor: grab; touch-action: none; opacity: 0.5; padding: 0.125rem; }
    .wg-handle:active { cursor: grabbing; opacity: 0.9; }
    .wg-btn { opacity: 0.5; padding: 0.125rem 0.375rem; font-size: 0.6875rem; line-height: 1rem; border-radius: 0.25rem; }
    .wg-btn:hover, .wg-handle:hover { opacity: 1; background: color-mix(in oklab, currentColor 10%, transparent); }
  `],
})
export class WidgetGridComponent {
  /** The resolved layout; array position = render order, hidden items skipped. */
  readonly items = input.required<LayoutItem[]>();
  /** Per-instance render template, owned by the parent (`let-item`). */
  readonly itemTemplate = input.required<TemplateRef<{ $implicit: LayoutItem }>>();
  /** Edit mode: show the reorder/resize/hide chrome on every visible cell. */
  readonly editing = input(false);
  /** Every edit (reorder, resize, hide) emits the full new layout. */
  readonly itemsChange = output<LayoutItem[]>();

  private host: ElementRef<HTMLElement> = inject(ElementRef);

  /** The section header to show before item `index`, or null: the item must be
   *  visible, carry a section (curated default layouts only), and differ from
   *  the previous VISIBLE item's section (hidden items don't break a run). */
  protected sectionFor(index: number): string | null {
    const items = this.items();
    const item = items[index];
    if (!item || item.hidden || !item.section) return null;
    for (let i = index - 1; i >= 0; i--) {
      if (items[i].hidden) continue;
      return items[i].section === item.section ? null : item.section;
    }
    return item.section;
  }

  // --- Drag-to-reorder -------------------------------------------------------
  // The dragged cell's DOM is NOT re-rendered mid-drag (the parent only gets
  // the new array on pointerup), so pointer capture on the handle survives.
  private dragId: string | null = null;
  /** instanceId currently highlighted as the drop target. */
  protected dragTargetId = signal<string | null>(null);
  /** Cell rects captured at drag start (they don't move during the drag). */
  private cellRects: { id: string; cx: number; cy: number }[] = [];

  protected dragStart(event: PointerEvent, instanceId: string): void {
    if (!this.editing()) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.dragId = instanceId;
    this.dragTargetId.set(null);
    this.cellRects = [];
    for (const el of this.host.nativeElement.querySelectorAll<HTMLElement>('.wg-cell[data-iid]')) {
      const r = el.getBoundingClientRect();
      this.cellRects.push({ id: el.dataset['iid']!, cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
    }
  }

  protected dragMove(event: PointerEvent): void {
    if (!this.dragId) return;
    // Nearest cell centre wins — stable across row boundaries and grid gaps.
    let best: string | null = null;
    let bestD = Infinity;
    for (const c of this.cellRects) {
      const d = (c.cx - event.clientX) ** 2 + (c.cy - event.clientY) ** 2;
      if (d < bestD) { bestD = d; best = c.id; }
    }
    this.dragTargetId.set(best && best !== this.dragId ? best : null);
  }

  protected dragEnd(): void {
    const from = this.dragId;
    const to = this.dragTargetId();
    this.dragId = null;
    this.dragTargetId.set(null);
    this.cellRects = [];
    if (!from || !to || from === to) return;
    const items = this.items();
    const fromIdx = items.findIndex((i) => i.instanceId === from);
    const toIdx = items.findIndex((i) => i.instanceId === to);
    if (fromIdx < 0 || toIdx < 0) return;
    this.itemsChange.emit(moveItem(items, fromIdx, toIdx));
  }

  protected dragCancel(): void {
    this.dragId = null;
    this.dragTargetId.set(null);
    this.cellRects = [];
  }

  // --- Width + hide ------------------------------------------------------------
  protected widthLabel(w: 4 | 6 | 12): string {
    return w === 4 ? '⅓' : w === 6 ? '½' : 'Full';
  }

  protected resizeItem(item: LayoutItem): void {
    this.itemsChange.emit(
      this.items().map((i) => (i.instanceId === item.instanceId ? { ...i, w: cycleWidth(i.w) } : i)),
    );
  }

  protected hideItem(item: LayoutItem): void {
    this.itemsChange.emit(
      this.items().map((i) => (i.instanceId === item.instanceId ? { ...i, hidden: true } : i)),
    );
  }
}
