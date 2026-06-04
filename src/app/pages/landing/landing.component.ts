import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** A pricing/feature tier shown on the public landing page. */
interface Tier {
  name: string;
  tagline: string;
  features: string[];
  highlighted?: boolean;
}

const GITHUB_URL = 'https://github.com/kisinga/majiflow';

/**
 * Public landing page (route `''`). Replaces the old standalone static homepage
 * and its hardware cost-estimator with a simple hero + tiers section. Everything
 * past this point (overview/editor/dashboard) is auth-guarded.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="min-h-screen bg-base-200 text-base-content">
      <!-- Nav -->
      <nav class="navbar bg-base-100 shadow-sm px-4 sm:px-8">
        <div class="flex-1">
          <span class="text-lg font-semibold">MajiFlow</span>
        </div>
        <div class="flex-none gap-2">
          <a [href]="github" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">GitHub</a>
          <a routerLink="/login" class="btn btn-primary btn-sm">Sign in</a>
        </div>
      </nav>

      <!-- Hero -->
      <header class="px-4 sm:px-8 py-16 sm:py-24 text-center">
        <div class="max-w-3xl mx-auto">
          <h1 class="text-3xl sm:text-5xl font-bold leading-tight">
            Metrics and automation for water-critical installations.
          </h1>
          <p class="mt-6 text-base sm:text-lg text-base-content/70">
            Farms, hotels, greenhouses, boreholes — anywhere water is critical and
            reliable monitoring and control matter. Draw your tanks, pumps, valves
            and sensors; we generate the firmware and the dashboard.
          </p>
          <div class="mt-8 flex flex-wrap gap-3 justify-center">
            <a routerLink="/login" class="btn btn-primary">Get started</a>
            <a [href]="github" target="_blank" rel="noopener" class="btn btn-ghost">View on GitHub</a>
          </div>
        </div>
      </header>

      <!-- Tiers -->
      <main class="px-4 sm:px-8 pb-24">
        <div class="max-w-5xl mx-auto">
          <h2 class="text-2xl font-semibold text-center mb-10">Plans</h2>
          <div class="grid gap-6 md:grid-cols-3">
            @for (tier of tiers; track tier.name) {
              <div
                class="card bg-base-100 shadow-xl border"
                [class.border-primary]="tier.highlighted"
                [class.border-base-300]="!tier.highlighted"
              >
                <div class="card-body">
                  @if (tier.highlighted) {
                    <span class="badge badge-primary self-start">Most popular</span>
                  }
                  <h3 class="card-title">{{ tier.name }}</h3>
                  <p class="text-sm text-base-content/60">{{ tier.tagline }}</p>
                  <ul class="mt-4 space-y-2 text-sm">
                    @for (feature of tier.features; track feature) {
                      <li class="flex gap-2">
                        <span class="text-primary">✓</span>
                        <span>{{ feature }}</span>
                      </li>
                    }
                  </ul>
                  <div class="card-actions mt-6">
                    <a
                      routerLink="/login"
                      class="btn btn-block"
                      [class.btn-primary]="tier.highlighted"
                      [class.btn-outline]="!tier.highlighted"
                    >Get started</a>
                  </div>
                </div>
              </div>
            }
          </div>
          <p class="text-center text-sm text-base-content/50 mt-8">
            Pricing depends on site size and mode — contact us for a quote.
          </p>
        </div>
      </main>
    </div>
  `,
})
export class LandingComponent {
  protected readonly github = GITHUB_URL;

  protected readonly tiers: Tier[] = [
    {
      name: 'Lite',
      tagline: 'For a single site getting started.',
      features: [
        'Managed cloud — nothing to host',
        'One controller',
        'Live dashboards & history',
        'Alerts on faults',
      ],
    },
    {
      name: 'Pro',
      tagline: 'For multi-controller and on-site installs.',
      highlighted: true,
      features: [
        'Everything in Lite',
        'Multiple controllers',
        'Local mode — on-site box, works offline',
        'Controller-to-controller coordination',
      ],
    },
    {
      name: 'Custom',
      tagline: 'For large or bespoke deployments.',
      features: [
        'Everything in Pro',
        'Custom integrations',
        'Priority support & SLAs',
        'Onboarding & training',
      ],
    },
  ];
}
