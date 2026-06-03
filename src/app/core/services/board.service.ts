import { Injectable, signal, inject } from '@angular/core';
import type { BoardDef } from '../models/board.model';
import type { BoardListEntry, BoardLoadResult } from '../models/backend-api';
import { BackendService } from './backend.service';

export type { BoardListEntry, BoardLoadResult };

@Injectable({ providedIn: 'root' })
export class BoardService {
  private backend = inject(BackendService);

  private _boards = signal<BoardListEntry[]>([]);
  private _activeSvg = signal<string | null>(null);
  private _activeBoard = signal<BoardDef | null>(null);

  readonly boards = this._boards.asReadonly();
  readonly activeSvg = this._activeSvg.asReadonly();
  readonly activeBoard = this._activeBoard.asReadonly();

  /** Load the board catalogue from the static `boards/` assets. */
  async refresh(): Promise<void> {
    this._boards.set(await this.backend.boardList());
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
