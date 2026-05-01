import { Component, input, output } from '@angular/core';

interface FileEntry {
  path: string;
  description: string;
  lines: number;
}

/**
 * Generated firmware/HA file list. Rows are clickable — emits the relative
 * path so the host can resolve it against its output dir.
 */
@Component({
  selector: 'app-firmware-files-table',
  standalone: true,
  template: `
    <div class="border-t border-base-300/30 px-5 py-3 bg-base-200/30">
      <table class="table table-xs">
        <thead>
          <tr>
            <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold">File</th>
            <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold">Description</th>
            <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold text-right">Lines</th>
          </tr>
        </thead>
        <tbody>
          @for (f of files(); track f.path) {
            <tr class="hover cursor-pointer" (click)="fileClick.emit(f.path)">
              <td class="font-mono text-[11px] text-primary/70 underline decoration-primary/30">{{ f.path }}</td>
              <td class="text-[11px] text-base-content/50">{{ f.description }}</td>
              <td class="text-right text-[11px] tabular-nums text-base-content/60">{{ f.lines }}</td>
            </tr>
          }
        </tbody>
      </table>
      @if (outputDir()) {
        <div class="flex items-center gap-2 mt-2">
          <span class="text-xs text-base-content/50 font-mono truncate flex-1">{{ outputDir() }}</span>
          <button
            class="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-base-content"
            (click)="openFolder.emit()"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
            Open
          </button>
        </div>
      }
    </div>
  `,
})
export class FirmwareFilesTableComponent {
  readonly files = input.required<FileEntry[]>();
  readonly outputDir = input<string>('');

  readonly fileClick = output<string>();
  readonly openFolder = output<void>();
}
