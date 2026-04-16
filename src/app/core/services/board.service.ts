import { Injectable, signal } from '@angular/core';
import { ElectronService } from './electron.service';
import type { BoardDef } from '../models/board.model';
import type { BoardListEntry } from '../models/electron-api';

@Injectable({ providedIn: 'root' })
export class BoardService {
  private _boards = signal<BoardListEntry[]>([]);
  private _activeSvg = signal<string | null>(null);

  readonly boards = this._boards.asReadonly();
  readonly activeSvg = this._activeSvg.asReadonly();

  constructor(private electron: ElectronService) {}

  async refresh(): Promise<void> {
    this._boards.set(await this.electron.boardList());
  }

  /** Fetch board from electron. Stores SVG for display, returns BoardDef for the caller. */
  async load(model: string): Promise<BoardDef> {
    const result = await this.electron.boardLoad(model);
    this._activeSvg.set(result.svg);
    return result.board as BoardDef;
  }

  clear(): void {
    this._activeSvg.set(null);
  }
}
