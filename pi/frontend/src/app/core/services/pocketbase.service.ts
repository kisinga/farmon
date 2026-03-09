import { Injectable } from '@angular/core';
import PocketBase from 'pocketbase';

/**
 * Base URL for the PocketBase API. Must be same origin as the app so SDK requests
 * (e.g. /api/collections/devices/records) reach the server. Uses relative path so
 * it always resolves to the current origin (works behind proxies and with any host).
 */
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
