import { Injectable } from '@angular/core';
import PocketBase from 'pocketbase';

/** Base URL for the PocketBase API (same origin). */
function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/api`;
  }
  return '/api';
}

@Injectable({ providedIn: 'root' })
export class PocketBaseService {
  readonly pb = new PocketBase(getApiBaseUrl());
}
