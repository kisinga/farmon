import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ElectronService } from '../../core/services/electron.service';
import { LibraryService } from '../../core/services/library.service';
import type { GenerateResult, ValidationResult } from '../../core/models/electron-api';

@Component({
  selector: 'app-generate',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="p-8 max-w-4xl mx-auto">
      <div class="flex items-center gap-3 mb-8">
        <a [routerLink]="['/editor', configName()]" class="btn btn-ghost btn-sm gap-1">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
          </svg>
          Editor
        </a>
        <h1 class="text-3xl font-bold tracking-tight">Generate Firmware</h1>
      </div>

      @if (validation()?.ok === false) {
        <div class="alert alert-error mb-6 shadow-sm">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
          </svg>
          <div>
            <div class="font-semibold">Validation failed</div>
            <div class="text-sm">Fix errors in the editor before generating.</div>
          </div>
        </div>
      }

      <!-- Success banner -->
      @if (success()) {
        <div class="alert alert-success mb-6 shadow-sm">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
          </svg>
          <div>
            <div class="font-semibold">Files generated successfully</div>
            <div class="text-sm">{{ generatedFiles().length }} files written to disk.</div>
          </div>
        </div>
      }

      @if (generatedFiles().length > 0) {
        <div class="card bg-base-100 shadow-sm border border-base-200 mb-6">
          <div class="card-body p-0">
            <div class="px-5 pt-4 pb-2">
              <h2 class="font-semibold">Output Files</h2>
            </div>
            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr class="bg-base-200/50">
                    <th>File</th>
                    <th>Description</th>
                    <th class="text-right">Lines</th>
                  </tr>
                </thead>
                <tbody>
                  @for (file of generatedFiles(); track file.path) {
                    <tr>
                      <td class="font-mono text-xs text-primary/80">{{ file.path }}</td>
                      <td class="text-sm text-base-content/70">{{ file.description }}</td>
                      <td class="text-right text-sm tabular-nums">{{ file.lines }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }

      <div class="flex gap-3">
        <button
          class="btn btn-primary gap-2"
          (click)="generate()"
          [disabled]="generating() || validation()?.ok === false"
        >
          @if (generating()) {
            <span class="loading loading-spinner loading-sm"></span>
          } @else {
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z" clip-rule="evenodd" />
            </svg>
          }
          {{ generatedFiles().length > 0 ? 'Regenerate' : 'Generate Files' }}
        </button>
      </div>

      @if (error()) {
        <div class="alert alert-error mt-6 shadow-sm">
          <span class="font-mono text-sm">{{ error() }}</span>
        </div>
      }
    </div>
  `,
})
export class GenerateComponent implements OnInit {
  private electron = inject(ElectronService);
  private library = inject(LibraryService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected configName = signal('');
  protected validation = signal<ValidationResult | null>(null);
  protected generatedFiles = signal<GenerateResult[]>([]);
  protected generating = signal(false);
  protected success = signal(false);
  protected error = signal<string | null>(null);

  async ngOnInit() {
    const name = this.route.snapshot.paramMap.get('name');
    if (!name) { this.router.navigate(['/library']); return; }
    this.configName.set(name);

    try {
      const raw = await this.library.load(name);
      const manifest = raw as Record<string, unknown>;
      const boardId = (manifest['device'] as Record<string, string>)?.['board'];
      if (!boardId) throw new Error('No board in manifest');
      const { board } = await this.electron.boardLoad(boardId);
      const result = await this.electron.validate(manifest, board);
      this.validation.set(result);
    } catch (err) {
      this.error.set(String(err));
    }
  }

  async generate() {
    this.generating.set(true);
    this.success.set(false);
    this.error.set(null);
    try {
      const raw = await this.library.load(this.configName());
      const manifest = raw as Record<string, unknown>;
      const boardId = (manifest['device'] as Record<string, string>)?.['board'];
      const { board } = await this.electron.boardLoad(boardId!);
      const files = await this.electron.generate(manifest, board);
      this.generatedFiles.set(files);
      this.success.set(true);
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.generating.set(false);
    }
  }
}
