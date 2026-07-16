import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * First-touch marketing attribution for the public funnel.
 *
 * On the first browser hit, the UTM tags (when the inbound link carries them),
 * the landing page, and the document referrer are stashed in localStorage so
 * attribution survives across sessions — an ad click on Monday still credits
 * the campaign when the lead form is submitted on Wednesday. A later hit that
 * carries a utm_source overwrites the stash (last campaign touch wins). The
 * lead form attaches the stash at submit time so every lead answers "where did
 * this one come from?" — the report that decides where the next marketing
 * shilling goes. SSR-safe: a no-op off-browser.
 */
export interface Attribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  landing_page?: string;
  referrer?: string;
}

const KEY = 'mf_attrib';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

@Injectable({ providedIn: 'root' })
export class TrackingService {
  constructor() {
    const platformId = inject(PLATFORM_ID);
    if (isPlatformBrowser(platformId)) this.capture();
  }

  private capture(): void {
    try {
      const params = new URLSearchParams(window.location.search);
      const hasUtm = UTM_KEYS.some((k) => params.get(k));
      const existing = localStorage.getItem(KEY);
      if (hasUtm || !existing) {
        const a: Attribution = {};
        for (const k of UTM_KEYS) {
          const v = params.get(k);
          if (v) a[k] = v.slice(0, 120);
        }
        a.landing_page = (window.location.pathname + window.location.search).slice(0, 300);
        if (document.referrer) a.referrer = document.referrer.slice(0, 300);
        localStorage.setItem(KEY, JSON.stringify(a));
      }
    } catch {
      // localStorage can throw (private mode, disabled storage) — attribution
      // is best-effort and must never break the page.
    }
  }

  /** The stashed attribution; {} when nothing was captured. */
  attribution(): Attribution {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Attribution) : {};
    } catch {
      return {};
    }
  }
}
