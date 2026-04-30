import { Injectable, signal } from '@angular/core';
import { ElectronService } from './electron.service';
import type { BoardDef } from '../models/board.model';
import type { BoardListEntry } from '../models/electron-api';

@Injectable({ providedIn: 'root' })
export class BoardService {
  private _boards = signal<BoardListEntry[]>([]);
  private _activeSvg = signal<string | null>(null);
  private _activeBoard = signal<BoardDef | null>(null);

  readonly boards = this._boards.asReadonly();
  readonly activeSvg = this._activeSvg.asReadonly();
  readonly activeBoard = this._activeBoard.asReadonly();

  constructor(private electron: ElectronService) {}

  async refresh(): Promise<void> {
    this._boards.set(await this.electron.boardList());
  }

  /** Fetch board from electron. Caches BoardDef + SVG and returns the BoardDef. */
  async load(model: string): Promise<BoardDef> {
    const result = await this.electron.boardLoad(model);
    const board = result.board as BoardDef;
    this._activeSvg.set(result.svg);
    this._activeBoard.set(board);
    return board;
  }

  clear(): void {
    this._activeSvg.set(null);
    this._activeBoard.set(null);
  }
}
