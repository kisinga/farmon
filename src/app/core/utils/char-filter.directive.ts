import { Directive, ElementRef, HostListener, Input, Optional } from '@angular/core';
import { NgModel } from '@angular/forms';
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
 * Handles paste/drop/cut/autofill/IME-commit (all dispatch the `input` event).
 * Skips filtering during IME composition so non-Latin keyboards work.
 */
@Directive({ selector: '[charFilter]', standalone: true })
export class CharFilterDirective {
  @Input('charFilter') policy: InputPolicy | undefined;
  private composing = false;

  constructor(
    private el: ElementRef<HTMLInputElement>,
    @Optional() private ngModel: NgModel,
  ) {}

  @HostListener('compositionstart') onCompositionStart() { this.composing = true; }
  @HostListener('compositionend')   onCompositionEnd()   { this.composing = false; this.apply(); }
  @HostListener('input')             onInput()           { if (!this.composing) this.apply(); }

  private apply(): void {
    if (!this.policy) return;
    const input = this.el.nativeElement;
    const raw = input.value;
    const lowered = this.policy.lowercase ? raw.toLowerCase() : raw;
    const filtered = (lowered.match(this.policy.allow) ?? []).join('');
    if (filtered === raw) return;

    const caret = input.selectionStart ?? filtered.length;
    const dropped = raw.length - filtered.length;

    if (this.ngModel) {
      this.ngModel.control.setValue(filtered);
    } else {
      input.value = filtered;
    }

    queueMicrotask(() => {
      const pos = Math.max(0, caret - dropped);
      try { input.setSelectionRange(pos, pos); } catch { /* not all input types support selection */ }
    });
  }
}
