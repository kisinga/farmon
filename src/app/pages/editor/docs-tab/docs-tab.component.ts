import { Component, inject, computed, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router, ActivatedRoute } from '@angular/router';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { ElectronService } from '../../../core/services/electron.service';

/** Classify a file path into a display group. */
function fileGroup(path: string): string {
  if (path.endsWith('.html')) return 'Documentation';
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'Configuration';
  return 'Generated Code';
}

/** Icon SVG path for a file type. */
function fileIcon(path: string): string {
  if (path.endsWith('.html')) return 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z';
  return 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4';
}

@Component({
  selector: 'app-docs-tab',
  standalone: true,
  template: `
    @if (result(); as r) {
      <div class="h-full flex flex-col">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-base-300/30 flex items-center justify-between bg-base-100/50">
          <div>
            <h2 class="text-sm font-semibold">Generated Documentation</h2>
            <p class="text-xs text-base-content/40 mt-0.5">{{ r.files.length }} files</p>
          </div>
          <div class="flex gap-2">
            @if (docHtml()) {
              <button class="btn btn-outline btn-xs gap-1.5" (click)="openDocInBrowser()">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2z"/>
                </svg>
                Print
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
          <!-- File list (left, grouped) -->
          <div class="w-56 border-r border-base-300/30 overflow-y-auto bg-base-100/30 shrink-0">
            @for (group of fileGroups(); track group.label) {
              <div class="px-3 pt-3 pb-1">
                <span class="text-[9px] font-semibold text-base-content/40 uppercase tracking-wider">{{ group.label }}</span>
              </div>
              @for (f of group.files; track f.index) {
                <button
                  class="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-base-200/50 transition-colors rounded-md mx-1"
                  [class.bg-base-200]="selectedIndex() === f.index"
                  [class.text-primary]="selectedIndex() === f.index"
                  style="width: calc(100% - 8px)"
                  (click)="selectFile(f.index)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="f.icon" />
                  </svg>
                  <div class="min-w-0">
                    <div class="font-mono text-[11px] truncate">{{ f.name }}</div>
                    <div class="text-[9px] text-base-content/30 truncate">{{ f.description }}</div>
                  </div>
                </button>
              }
            }
          </div>

          <!-- Preview (right) -->
          <div class="flex-1 min-w-0 overflow-hidden flex flex-col">
            @if (isDocSelected()) {
              <iframe class="w-full flex-1 border-0 bg-white" [srcdoc]="trustedDocHtml()"></iframe>
            } @else if (selectedFile(); as f) {
              <div class="flex-1 flex flex-col items-center justify-center p-8">
                <div class="w-full max-w-sm space-y-4">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-primary/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div class="min-w-0">
                      <p class="font-mono text-sm font-medium truncate">{{ fileName(f.path) }}</p>
                      <p class="text-xs text-base-content/40 mt-0.5">{{ f.description }}</p>
                    </div>
                  </div>

                  <div class="bg-base-200/50 rounded-lg p-4 space-y-2 text-xs">
                    <div class="flex justify-between">
                      <span class="text-base-content/50">Path</span>
                      <span class="font-mono text-base-content/70">{{ f.path }}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-base-content/50">Lines</span>
                      <span class="font-mono text-base-content/70">{{ f.lines }}</span>
                    </div>
                  </div>

                  <button class="btn btn-ghost btn-sm w-full gap-1.5" (click)="openSelectedFile()">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Open in Editor
                  </button>
                </div>
              </div>
            } @else {
              <div class="flex-1 flex items-center justify-center text-base-content/30 text-sm">
                Select a file to preview
              </div>
            }
          </div>
        </div>
      </div>
    } @else {
      <div class="flex-1 flex items-center justify-center">
        <div class="text-center text-base-content/40">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p class="text-sm font-medium">No generated files yet</p>
          <p class="text-xs mt-1 text-base-content/30">Generate firmware from the Firmware tab first.</p>
          <button class="btn btn-primary btn-sm mt-4 gap-1.5" (click)="goToDeploy()">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Go to Firmware
          </button>
        </div>
      </div>
    }
  `,
})
export class DocsTabComponent {
  protected editor = inject(SystemEditorService);
  private electron = inject(ElectronService);
  private sanitizer = inject(DomSanitizer);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  protected result = computed(() => this.editor.generatedFiles());
  protected selectedIndex = signal(0);

  protected docHtml = computed(() =>
    this.result()?.documentationHtml ?? null
  );

  /** Group files by type for the file list. */
  protected fileGroups = computed(() => {
    const r = this.result();
    if (!r) return [];

    const groups = new Map<string, Array<{ index: number; name: string; description: string; icon: string }>>();

    r.files.forEach((f, i) => {
      const group = fileGroup(f.path);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push({
        index: i,
        name: this.fileName(f.path),
        description: f.description,
        icon: fileIcon(f.path),
      });
    });

    // Sort: Documentation first, then Configuration, then Generated Code
    const order = ['Documentation', 'Configuration', 'Generated Code'];
    return order
      .filter(label => groups.has(label))
      .map(label => ({ label, files: groups.get(label)! }));
  });

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

  protected goToDeploy() {
    this.router.navigate(['../deploy'], { relativeTo: this.route });
  }
}
