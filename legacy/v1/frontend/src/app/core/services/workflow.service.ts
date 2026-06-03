import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, map } from 'rxjs';
import { PocketBaseService } from './pocketbase.service';
import { WorkflowRecord, WorkflowLogRecord } from './api.types';

const API = '/api/farmon';

@Injectable({ providedIn: 'root' })
export class WorkflowService {
  private http = inject(HttpClient);
  private pb = inject(PocketBaseService).pb;

  getWorkflows(deviceEui?: string): Observable<WorkflowRecord[]> {
    const options: Record<string, unknown> = { requestKey: `workflows-${deviceEui || 'all'}` };
    if (deviceEui) {
      options['filter'] = this.pb.filter('triggers ~ {:eui} || actions ~ {:eui}', { eui: deviceEui });
    }
    return from(
      this.pb.collection<WorkflowRecord>('workflows').getList(1, 100, options)
    ).pipe(map((res) => res.items));
  }

  createWorkflow(record: Partial<WorkflowRecord>): Observable<WorkflowRecord> {
    return from(
      this.pb.collection<WorkflowRecord>('workflows').create(record as Record<string, unknown>)
    );
  }

  updateWorkflow(id: string, record: Partial<WorkflowRecord>): Observable<WorkflowRecord> {
    return from(
      this.pb.collection<WorkflowRecord>('workflows').update(id, record as Record<string, unknown>)
    );
  }

  deleteWorkflow(id: string): Observable<boolean> {
    return from(this.pb.collection('workflows').delete(id)).pipe(map(() => true));
  }

  testWorkflow(id: string, mockData: Record<string, unknown>): Observable<{ condition_result: boolean; would_fire: boolean; trigger_index: number; env: Record<string, unknown> }> {
    return this.http.post<{ condition_result: boolean; would_fire: boolean; trigger_index: number; env: Record<string, unknown> }>(`${API}/workflows/${id}/test`, mockData);
  }

  getWorkflowLog(workflowId?: string, limit = 50): Observable<WorkflowLogRecord[]> {
    const options: Record<string, unknown> = { sort: '-ts', requestKey: `wf-log-${workflowId || 'all'}` };
    if (workflowId) {
      options['filter'] = this.pb.filter('workflow_id = {:id}', { id: workflowId });
    }
    return from(
      this.pb.collection<WorkflowLogRecord>('workflow_log').getList(1, limit, options)
    ).pipe(map((res) => res.items));
  }
}
