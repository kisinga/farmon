import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SiteLibraryService } from '../../core/services/site-library.service';
import { ElectronService } from '../../core/services/electron.service';
import type { SiteListEntry } from '../../core/models/electron-api';
import type { Site } from '@far-mon/core';

@Component({
  selector: 'app-overview',
  standalone: true,
  template: `
    <div class="flex-1 flex flex-col h-full p-6">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold">Sites</h1>
          <p class="text-sm text-base-content/50 mt-1">Select a site to view its water network</p>
        </div>
        <button class="btn btn-primary btn-sm" (click)="showCreate.set(true)">
          + New Site
        </button>
      </div>

      @if (siteLibrary.loading()) {
        <div class="flex-1 flex items-center justify-center">
          <span class="loading loading-spinner loading-lg"></span>
        </div>
      } @else if (siteLibrary.entries().length === 0) {
        <div class="flex-1 flex items-center justify-center text-base-content/30">
          <div class="text-center">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <p class="text-lg font-medium">No sites yet</p>
            <p class="text-sm mt-1">Create a site to start designing your water network.</p>
            <button class="btn btn-primary btn-sm mt-4" (click)="showCreate.set(true)">Create Site</button>
          </div>
        </div>
      } @else {
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          @for (site of siteLibrary.entries(); track site.name) {
            <div
              class="card bg-base-100 shadow-sm border border-base-300/50 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer"
              (click)="openSite(site.name)"
            >
              <div class="card-body p-5">
                <h2 class="card-title text-base">{{ site.friendlyName }}</h2>
                <p class="text-xs text-base-content/50 font-mono">{{ site.name }}</p>
                <div class="flex gap-3 mt-2 text-xs text-base-content/60">
                  <span>{{ site.systemCount }} system{{ site.systemCount !== 1 ? 's' : '' }}</span>
                  <span>{{ site.linkCount }} link{{ site.linkCount !== 1 ? 's' : '' }}</span>
                </div>
                <div class="card-actions justify-end mt-2">
                  <button class="btn btn-ghost btn-xs" (click)="deleteSite(site.name, $event)">Delete</button>
                </div>
              </div>
            </div>
          }
        </div>
      }

      <!-- Create site dialog -->
      @if (showCreate()) {
        <dialog class="modal modal-open">
          <div class="modal-box max-w-sm">
            <h3 class="font-bold text-lg mb-4">New Site</h3>
            <div class="form-control">
              <label class="label"><span class="label-text">Site name</span></label>
              <input
                type="text"
                class="input input-bordered w-full"
                placeholder="My Farm"
                #newName
                (keydown.enter)="createSite(newName.value)"
              />
            </div>
            <div class="modal-action">
              <button class="btn btn-ghost" (click)="showCreate.set(false)">Cancel</button>
              <button class="btn btn-primary" (click)="createSite(newName.value)">Create</button>
            </div>
          </div>
          <div class="modal-backdrop" (click)="showCreate.set(false)"></div>
        </dialog>
      }
    </div>
  `,
})
export class OverviewComponent implements OnInit {
  protected siteLibrary = inject(SiteLibraryService);
  private electron = inject(ElectronService);
  private router = inject(Router);
  protected showCreate = signal(false);

  async ngOnInit() {
    await this.siteLibrary.refresh();
  }

  protected openSite(name: string): void {
    this.router.navigate(['/site', name]);
  }

  protected async createSite(friendlyName: string): Promise<void> {
    if (!friendlyName.trim()) return;
    const slug = friendlyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const site: Site = {
      schema: 1,
      name: slug,
      friendly_name: friendlyName.trim(),
      systems: [],
      links: [],
    };
    await this.electron.siteSave(slug, site);
    await this.siteLibrary.refresh();
    this.showCreate.set(false);
    this.router.navigate(['/site', slug]);
  }

  protected async deleteSite(name: string, event: Event): Promise<void> {
    event.stopPropagation();
    await this.electron.siteDelete(name);
    await this.siteLibrary.refresh();
  }
}
