import { Component, inject, computed, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { ElectronService } from '../../../core/services/electron.service';

@Component({
  selector: 'app-docs-tab',
  standalone: true,
  template: `
    @if (result(); as r) {
      <div class="h-full flex flex-col">
        <!-- Header -->
        <div class="px-5 py-3 border-b border-base-300/30 flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold">Generated Files</h2>
            <p class="text-xs text-base-content/50">{{ r.files.length }} files in {{ r.outputDir }}</p>
          </div>
          <div class="flex gap-2">
            @if (docHtml()) {
              <button class="btn btn-outline btn-xs gap-1.5" (click)="openDocInBrowser()">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2z"/>
                </svg>
                Print Documentation
              </button>
            }
            <button class="btn btn-outline btn-xs gap-1.5" (click)="openOutputDir()">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"/>
              </svg>
              Open Folder
            </button>
          </div>
        </div>

        <div class="flex-1 flex min-h-0">
          <!-- File list (left) -->
          <div class="w-72 border-r border-base-300/30 overflow-y-auto">
            @for (f of r.files; track f.path; let i = $index) {
              <button
                class="w-full text-left px-4 py-2 hover:bg-base-200/50 border-b border-base-300/20 transition-colors"
                [class.bg-base-200]="selectedIndex() === i"
                (click)="selectFile(i)"
              >
                <div class="font-mono text-[11px] text-primary/80 truncate">{{ fileName(f.path) }}</div>
                <div class="text-[10px] text-base-content/40 truncate">{{ f.description }}</div>
              </button>
            }
          </div>

          <!-- Preview (right) -->
          <div class="flex-1 min-w-0 overflow-hidden">
            @if (isDocSelected()) {
              <iframe class="w-full h-full border-0 bg-white" [srcdoc]="trustedDocHtml()"></iframe>
            } @else {
              <div class="p-4 text-xs text-base-content/50">
                <p class="font-mono">{{ selectedFile()?.path }}</p>
                <p class="mt-1">{{ selectedFile()?.description }}</p>
                <p class="mt-1">{{ selectedFile()?.lines }} lines</p>
                <button class="btn btn-ghost btn-xs mt-3" (click)="openSelectedFile()">Open in editor</button>
              </div>
            }
          </div>
        </div>
      </div>
    } @else {
      <div class="flex items-center justify-center h-full text-base-content/40 text-sm">
        Files are generated when you deploy. Go to the Deploy tab first.
      </div>
    }
  `,
})
export class DocsTabComponent {
  protected editor = inject(SystemEditorService);
  private electron = inject(ElectronService);
  private sanitizer = inject(DomSanitizer);

  protected result = computed(() => this.editor.generatedFiles());
  protected selectedIndex = signal(0);

  protected docHtml = computed(() => this.result()?.documentationHtml ?? null);

  protected selectedFile = computed(() => {
    const r = this.result();
    return r?.files[this.selectedIndex()] ?? null;
  });

  protected isDocSelected = computed(() => {
    const f = this.selectedFile();
    return f && f.path.endsWith('documentation.html') && this.docHtml();
  });

  protected trustedDocHtml = computed(() => {
    const html = this.docHtml();
    return html ? this.sanitizer.bypassSecurityTrustHtml(html) : '';
  });

  protected selectFile(index: number) {
    this.selectedIndex.set(index);
  }

  protected fileName(path: string): string {
    return path.split('/').pop() ?? path;
  }

  protected openDocInBrowser() {
    const html = this.docHtml();
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  protected openOutputDir() {
    const r = this.result();
    if (r) this.electron.shellOpenPath(r.outputDir);
  }

  protected openSelectedFile() {
    const f = this.selectedFile();
    const r = this.result();
    if (f && r) this.electron.shellShowInFolder(`${r.outputDir}/${f.path}`);
  }
}
