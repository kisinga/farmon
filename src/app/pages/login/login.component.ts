import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BackendService } from '../../core/services/backend.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-base-200 p-4">
      <div class="card w-full max-w-sm bg-base-100 shadow-xl">
        <form class="card-body gap-4" (ngSubmit)="submit()">
          <h1 class="text-xl font-semibold text-center">MajiFlow</h1>

          <label class="form-control">
            <span class="label-text mb-1">Email</span>
            <input
              type="email"
              class="input input-bordered w-full"
              name="email"
              [(ngModel)]="email"
              autocomplete="username"
              required
            />
          </label>

          <label class="form-control">
            <span class="label-text mb-1">Password</span>
            <input
              type="password"
              class="input input-bordered w-full"
              name="password"
              [(ngModel)]="password"
              autocomplete="current-password"
              required
            />
          </label>

          @if (error()) {
            <p class="text-error text-sm">{{ error() }}</p>
          }

          <button
            type="submit"
            class="btn btn-primary w-full"
            [disabled]="loading()"
          >
            @if (loading()) {
              <span class="loading loading-spinner loading-sm"></span>
            }
            Sign in
          </button>
        </form>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private backend = inject(BackendService);
  private router = inject(Router);

  protected email = '';
  protected password = '';
  protected loading = signal(false);
  protected error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (!this.email || !this.password) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.backend.pb
        .collection('users')
        .authWithPassword(this.email, this.password);
      await this.router.navigate(['/overview']);
    } catch {
      this.error.set('Invalid email or password.');
    } finally {
      this.loading.set(false);
    }
  }
}
