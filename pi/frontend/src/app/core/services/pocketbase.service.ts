import { Injectable } from '@angular/core';
import PocketBase from 'pocketbase';

/**
 * Base URL for the PocketBase SDK: origin only. The SDK appends /api/collections/...
 * itself, so the base must NOT include /api (otherwise you get /api/api/collections/...).
 */
function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

@Injectable({ providedIn: 'root' })
export class PocketBaseService {
  readonly pb = new PocketBase(getApiBaseUrl());
}
