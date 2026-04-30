import { Directive, ElementRef, HostListener, Input, OnDestroy, OnInit } from '@angular/core';
import type { InputPolicy } from '@far-mon/core';

/**
 * Keystroke-time character filter driven by an InputPolicy from @far-mon/core.
 *
 * Pairs symmetrically with [zodField]: this prevents invalid chars at typing
 * time, [zodField] flags structural problems (missing dot, etc.) on blur.
 *
 * Single source of truth: the same InputPolicy that builds the Zod regex (via
 * policyString) is passed here, so the keystroke filter and the validator can
 * never disagree about what's legal.
 *
 * Capture-phase listener: we mutate input.value BEFORE Angular's
 * DefaultValueAccessor reads it on the bubble phase. That guarantees the form
 * control (and therefore the model signal, and any downstream effects like
 * codegen:validate) only ever sees the filtered value — no transient raw
 * keystroke leaks through.
 *
 * Skips filtering during IME composition so non-Latin keyboards work.
 */
@Directive({ selector: '[charFilter]', standalone: true })
export class CharFilterDirective implements OnInit, OnDestroy {
  @Input('charFilter') policy: InputPolicy | undefined;
  private composing = false;
  private readonly captureInput = (_e: Event) => { if (!this.composing) this.apply(); };

  constructor(private el: ElementRef<HTMLInputElement>) {}

  ngOnInit(): void {
    this.el.nativeElement.addEventListener('input', this.captureInput, { capture: true });
  }

  ngOnDestroy(): void {
    this.el.nativeElement.removeEventListener('input', this.captureInput, { capture: true } as EventListenerOptions);
  }

  @HostListener('compositionstart') onCompositionStart() { this.composing = true; }
  @HostListener('compositionend')   onCompositionEnd()   { this.composing = false; this.apply(); }

  private apply(): void {
    if (!this.policy) return;
    const input = this.el.nativeElement;
    const raw = input.value;
    const lowered = this.policy.lowercase ? raw.toLowerCase() : raw;
    const filtered = (lowered.match(this.policy.allow) ?? []).join('');
    if (filtered === raw) return;

    const caret = input.selectionStart ?? filtered.length;
    const dropped = raw.length - filtered.length;
    input.value = filtered;
    const pos = Math.max(0, caret - dropped);
    try { input.setSelectionRange(pos, pos); } catch { /* not all input types support selection */ }
  }
}
