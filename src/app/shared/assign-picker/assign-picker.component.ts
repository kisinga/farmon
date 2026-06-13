import { Component, computed, input, output, signal } from '@angular/core';

/** One toggleable row in the picker — a customer or a site, depending on direction. */
export interface AssignItem {
  id: string;
  /** Primary line (a customer's name, or a site's friendly name). */
  label: string;
  /** Secondary line (a customer's email, or a site's id) — optional. */
  sub?: string;
}

/**
 * A reusable "assign these to that" dialog: a searchable list of {@link AssignItem}
 * rows, each toggling membership in a selected set. It is deliberately direction-
 * agnostic so the same UI drives both sides of the site↔user many-to-many — a
 * site's user picker on Overview and a customer's site picker on the Customers
 * page. Selected rows float to the top so the current assignment reads at a glance.
 *
 * Stateless beyond its search box: the parent owns `selectedIds` and applies each
 * `toggle` (optimistically patching its store), so the checkmarks follow the
 * live set with no local copy to keep in sync.
 */
@Component({
  selector: 'app-assign-picker',
  standalone: true,
  template: `
    <dialog class="modal modal-open" style="position: fixed;">
      <div class="modal-box max-w-md">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="font-bold text-lg truncate">{{ title() }}</h3>
            @if (subtitle()) { <p class="text-xs text-base-content/50 mt-0.5">{{ subtitle() }}</p> }
          </div>
          <span class="badge badge-sm shrink-0 mt-1"
                [class]="selectedIds().size ? 'badge-info' : 'badge-ghost'">
            {{ selectedIds().size }} assigned
          </span>
        </div>

        <input type="text" class="input input-sm input-bordered w-full my-3"
               [placeholder]="searchPlaceholder()"
               [value]="query()"
               (input)="query.set($any($event.target).value)" />

        <div class="max-h-80 overflow-auto rounded-lg border border-base-300/40 divide-y divide-base-300/20">
          @for (it of visible(); track it.id) {
            <button class="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-base-200/60"
                    [class]="isSelected(it.id) ? 'bg-info/10' : ''"
                    (click)="toggle.emit({ id: it.id, selected: !isSelected(it.id) })">
              <span class="flex items-center justify-center w-8 h-8 rounded-full text-[11px] font-semibold shrink-0"
                    [class]="isSelected(it.id) ? 'bg-info text-info-content' : 'bg-base-300'">
                {{ initials(it.label || it.sub || '?') }}
              </span>
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-medium truncate">{{ it.label || '(no name)' }}</span>
                @if (it.sub) { <span class="block text-[11px] text-base-content/50 truncate">{{ it.sub }}</span> }
              </span>
              <span class="shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors"
                    [class]="isSelected(it.id) ? 'bg-info border-info text-info-content' : 'border-base-300'">
                @if (isSelected(it.id)) {
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                }
              </span>
            </button>
          } @empty {
            <p class="px-3 py-6 text-center text-sm text-base-content/40">
              @if (items().length === 0) { {{ emptyText() }} } @else { No match. }
            </p>
          }
        </div>

        <div class="modal-action items-center">
          @if (selectedIds().size) {
            <button class="btn btn-ghost btn-sm text-error" (click)="clear.emit()">Clear all</button>
          }
          <span class="flex-1"></span>
          <button class="btn btn-sm" (click)="close.emit()">Done</button>
        </div>
      </div>
      <div class="modal-backdrop" (click)="close.emit()"></div>
    </dialog>
  `,
})
export class AssignPickerComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly searchPlaceholder = input<string>('Search…');
  readonly emptyText = input<string>('Nothing to assign yet.');
  readonly items = input.required<AssignItem[]>();
  /** The currently-assigned ids (owned by the parent). Must be a *new* Set on each
   *  change (e.g. a `computed` deriving it) — mutating the same Set in place won't
   *  retrigger the `visible` computed or the checkmark bindings. */
  readonly selectedIds = input.required<Set<string>>();

  /** A row was toggled on/off. The parent persists and updates `selectedIds`. */
  readonly toggle = output<{ id: string; selected: boolean }>();
  /** "Clear all" pressed — the parent should unassign every selected id. */
  readonly clear = output<void>();
  /** Dialog dismissed. */
  readonly close = output<void>();

  protected query = signal('');

  /** Filtered by the search box, with assigned rows floated to the top. */
  protected visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const sel = this.selectedIds();
    const matched = q
      ? this.items().filter(
          (it) => it.label.toLowerCase().includes(q) || (it.sub ?? '').toLowerCase().includes(q),
        )
      : this.items();
    return [...matched].sort(
      (a, b) => Number(sel.has(b.id)) - Number(sel.has(a.id)),
    );
  });

  protected isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  protected initials(s: string): string {
    return s
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
  }
}
