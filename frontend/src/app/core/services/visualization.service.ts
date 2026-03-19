import { Injectable, inject } from '@angular/core';
import { Observable, from, map } from 'rxjs';
import { PocketBaseService } from './pocketbase.service';
import { DeviceVisualization } from './api.types';

@Injectable({ providedIn: 'root' })
export class VisualizationService {
  private pb = inject(PocketBaseService).pb;

  getVisualizations(eui: string): Observable<DeviceVisualization[]> {
    const filter = this.pb.filter('device_eui = {:eui}', { eui });
    return from(
      this.pb.collection<DeviceVisualization>('device_visualizations').getList(1, 100, {
        filter,
        sort: 'sort_order',
        requestKey: `viz-${eui}`,
      })
    ).pipe(map(res => res.items));
  }

  createVisualization(data: Partial<DeviceVisualization>): Observable<DeviceVisualization> {
    return from(this.pb.collection<DeviceVisualization>('device_visualizations').create(data));
  }

  updateVisualization(id: string, data: Partial<DeviceVisualization>): Observable<DeviceVisualization> {
    return from(this.pb.collection<DeviceVisualization>('device_visualizations').update(id, data));
  }

  deleteVisualization(id: string): Observable<boolean> {
    return from(this.pb.collection('device_visualizations').delete(id));
  }
}
