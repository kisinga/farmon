import { Injectable, signal, inject } from '@angular/core';
import type { BoardDef } from '../models/board.model';
import type { ExpansionBoardCatalog } from '@core';
import type { BoardListEntry, BoardLoadResult } from '../models/backend-api';
import { BackendService } from './backend.service';
import { Cached } from '../stores/collection-store';

/**
 * BoardService — the DB-backed board catalog as a shared signal store. The
 * catalog (board list + expansion defs) and each board's full def are immutable
 * reference data, so they are fetched once and cached: the editor, the boards
 * page and the workspace all read the same cache instead of each re-querying
 * `boards`. Importing a board invalidates the cache. `load()` additionally
 * tracks the "active" board for the editor's canvas overlay.
 */
@Injectable({ providedIn: 'root' })
export class BoardService {
  private backend = inject(BackendService);

  private _boards = new Cached<BoardListEntry[]>(() => this.backend.boardList(), []);
  private _expansion = new Cached<ExpansionBoardCatalog>(() => this.backend.expansionCatalog(), {});
  /** Per-model full board def + SVG. Boards are immutable, so the in-flight
   *  promise is cached for the session (shared by editor + workspace). */
  private boardCache = new Map<string, Promise<BoardLoadResult>>();

  private _activeSvg = signal<string | null>(null);
  private _activeBoard = signal<BoardDef | null>(null);

  readonly boards = this._boards.value;
  readonly boardsLoading = this._boards.loading;
  readonly expansionCatalog = this._expansion.value;
  readonly activeSvg = this._activeSvg.asReadonly();
  readonly activeBoard = this._activeBoard.asReadonly();

  /** Load the catalogue (board list + expansion defs) once; shared in-flight. */
  ensureLoaded(force = false): Promise<void> {
    return Promise.all([
      this._boards.ensureLoaded(force),
      this._expansion.ensureLoaded(force),
    ]).then(() => undefined);
  }

  /** Force a fresh catalogue fetch (e.g. after an import). */
  refresh(): Promise<void> {
    return this.ensureLoaded(true);
  }

  /** The expansion-board catalog as a promise, fetched once and shared. Build /
   *  generate / commit MUST get it here, not via backend.expansionCatalog() — a
   *  direct fetch races this cached one on the same `boards:expansion` request key
   *  (the editor loads it on focus) and the SDK auto-cancels one. */
  expansionDefs(): Promise<ExpansionBoardCatalog> {
    return this._expansion.ensureLoaded();
  }

  /** One board's full def + SVG, cached per model (shared in-flight). */
  loadResult(model: string): Promise<BoardLoadResult> {
    let p = this.boardCache.get(model);
    if (!p) {
      p = this.backend.boardLoad(model);
      this.boardCache.set(model, p);
    }
    return p;
  }

  /** Load a board def + its SVG (fetched as raw markup) and set it active (editor canvas). */
  async load(model: string): Promise<BoardDef> {
    const { board } = await this.loadResult(model);
    const svg = await this.backend.boardSvg(model);
    this._activeSvg.set(svg || null);
    this._activeBoard.set(board);
    return board;
  }

  /** Import a board into the catalog, then refresh the cached list/defs. */
  async importBoard(
    defText: string,
    kind: 'main' | 'expansion',
    svg?: File,
  ): Promise<{ id: string }> {
    const r = await this.backend.boardImport(defText, kind, svg);
    this.boardCache.clear();
    await this.ensureLoaded(true);
    return r;
  }

  clear(): void {
    this._activeSvg.set(null);
    this._activeBoard.set(null);
  }
}
