import { signal, type Signal } from '@angular/core';

/**
 * Cached<T> — a single async value with shared-in-flight dedup, a loaded flag,
 * and loading/error signals. The building block for the app's signal stores: it
 * turns "every caller fetches" into "the first caller fetches, the rest await
 * the same promise", which removes the duplicate PocketBase requests that were
 * auto-cancelling each other.
 *
 * Compose one (or several) per store; expose `.value` to components and call
 * `.ensureLoaded()` from their init. Mutations keep the cache honest via
 * `.set()` / `.update()` (optimistic patch) or `.invalidate()` (refetch next).
 */
export class Cached<T> {
  private readonly _value;
  readonly value: Signal<T>;
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  private loaded = false;
  private inflight?: Promise<T>;

  constructor(private readonly fetcher: () => Promise<T>, initial: T) {
    this._value = signal(initial);
    this.value = this._value.asReadonly();
  }

  /**
   * Already loaded → resolves to the cached value. Otherwise fetch once;
   * concurrent callers share the single in-flight promise. `force` refetches
   * even when loaded (reusing an in-flight forced load if one exists).
   */
  ensureLoaded(force = false): Promise<T> {
    if (this.loaded && !force) return Promise.resolve(this._value());
    return (this.inflight ??= this.run());
  }

  reload(): Promise<T> {
    return this.ensureLoaded(true);
  }

  /** Drop the cache so the next ensureLoaded refetches (no fetch now). */
  invalidate(): void {
    this.loaded = false;
  }

  /** Optimistic patch: set the value and mark it loaded (skips a refetch). */
  set(value: T): void {
    this._value.set(value);
    this.loaded = true;
  }

  update(fn: (current: T) => T): void {
    this.set(fn(this._value()));
  }

  get snapshot(): T {
    return this._value();
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  private async run(): Promise<T> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const value = await this.fetcher();
      this._value.set(value);
      this.loaded = true;
      return value;
    } catch (err) {
      this.error.set(String(err));
      throw err;
    } finally {
      this.loading.set(false);
      this.inflight = undefined;
    }
  }
}

/**
 * CollectionStore<T> — the shared spine for the app's signal stores. It owns a
 * Cached<T> and exposes the read surface (value, loading, error) plus the
 * standard lifecycle (ensureLoaded / reload / invalidate). Subclasses provide
 * the fetcher via `fetch()` and add only their own mutations, applied through
 * the protected `replace` / `mutate` helpers — so each store carries just its
 * domain logic, not the caching boilerplate.
 */
export abstract class CollectionStore<T> {
  /** Load the collection. Called once (then shared) by the underlying Cached. */
  protected abstract fetch(): Promise<T>;

  private readonly _cache: Cached<T>;
  readonly value: Signal<T>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<string | null>;

  constructor(initial: T) {
    this._cache = new Cached<T>(() => this.fetch(), initial);
    this.value = this._cache.value;
    this.loading = this._cache.loading;
    this.error = this._cache.error;
  }

  ensureLoaded(force = false): Promise<T> {
    return this._cache.ensureLoaded(force);
  }
  reload(): Promise<T> {
    return this._cache.reload();
  }
  /** Drop the cache so the next ensureLoaded refetches (no fetch now). */
  invalidate(): void {
    this._cache.invalidate();
  }

  /** Optimistic patch: replace the value, marking it loaded (skips a refetch). */
  protected replace(value: T): void {
    this._cache.set(value);
  }
  /** Optimistic patch via a transform over the current value. */
  protected mutate(fn: (current: T) => T): void {
    this._cache.update(fn);
  }
  protected get snapshot(): T {
    return this._cache.snapshot;
  }
}
