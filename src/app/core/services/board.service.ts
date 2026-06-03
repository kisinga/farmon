import { Injectable, signal, inject } from '@angular/core';
import type { BoardDef } from '../models/board.model';
import type { ExpansionBoardCatalog } from '@far-mon/core';
import type { BoardListEntry } from '../models/backend-api';
import { BackendService } from './backend.service';

@Injectable({ providedIn: 'root' })
export class BoardService {
  private backend = inject(BackendService);

  private _boards = signal<BoardListEntry[]>([]);
  private _expansionCatalog = signal<ExpansionBoardCatalog>({});
  private _activeSvg = signal<string | null>(null);
  private _activeBoard = signal<BoardDef | null>(null);

  readonly boards = this._boards.asReadonly();
  readonly expansionCatalog = this._expansionCatalog.asReadonly();
  readonly activeSvg = this._activeSvg.asReadonly();
  readonly activeBoard = this._activeBoard.asReadonly();

  /** Load the board catalogue + expansion defs from the DB-backed backend. */
  async refresh(): Promise<void> {
    const [boards, expansion] = await Promise.all([
      this.backend.boardList(),
      this.backend.expansionCatalog(),
    ]);
    this._boards.set(boards);
    this._expansionCatalog.set(expansion);
  }

  /** Fetch one board def + SVG from static assets. Caches both, returns the def. */
  async load(model: string): Promise<BoardDef> {
    const { board, svg } = await this.backend.boardLoad(model);
    this._activeSvg.set(svg);
    this._activeBoard.set(board);
    return board;
  }

  clear(): void {
    this._activeSvg.set(null);
    this._activeBoard.set(null);
  }
}
