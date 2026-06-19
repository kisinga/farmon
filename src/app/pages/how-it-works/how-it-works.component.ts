import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  PLATFORM_ID,
  Renderer2,
  ViewEncapsulation,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { applyPageSeo } from '../../shared/seo';
import { MBOX, STAGES, type Cam, type MBox } from './stages';
import { defaultBox, frameDesktop, frameMobileBox } from './camera';
import { ScenePhoneComponent } from './scene/scene-phone.component';
import { ScenePlatformComponent } from './scene/scene-platform.component';
import { SceneControllerComponent } from './scene/scene-controller.component';
import { SceneSiteComponent } from './scene/scene-site.component';
import { ScenePacketsComponent } from './scene/scene-packets.component';
import { SimCaptionComponent } from './chrome/sim-caption.component';
import { SimStageRailComponent } from './chrome/sim-stage-rail.component';
import { SimTransportComponent } from './chrome/sim-transport.component';

/** One-shot beat classes set on the host to (re)start a stage's packet motion. */
const BEATS = ['s-tap', 's-cmd', 's-control', 's-tele'] as const;
/** Arrival-burst ids reset on every stage change. */
const BURSTS = ['burstServer', 'burstCtrl', 'burstValve', 'burstFlow', 'burstPhone'];

/**
 * Public, full-screen "how it works" route: a cinematic simulation of a single
 * command travelling the whole MajiFlow stack, from a tap on the dashboard to
 * water in the field and the reading back. This component owns the `<svg>` scene
 * and the playback engine (state via signals, camera, timing); the scene zones
 * and the overlay chrome are composed in as child components, all rendering into
 * the one shared SVG user space so the camera and offset-path motion stay intact.
 *
 * Prerender-safe: the playback loop and camera only start in `afterNextRender`,
 * so SSR ships a sensible static first frame and motion begins in the browser.
 * Styles are global (ViewEncapsulation.None) but namespaced under `.mf-sim`.
 *
 * Single-instance assumption: the scene zones emit hardcoded element ids
 * (#tankWater, #valveFlap, #burst*, ...) that the engine and the global
 * stylesheet target. That is safe because this is a one-off full-screen route;
 * rendering two at once would collide on those ids.
 */
@Component({
  selector: 'app-how-it-works',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [
    RouterLink,
    ScenePhoneComponent,
    ScenePlatformComponent,
    SceneControllerComponent,
    SceneSiteComponent,
    ScenePacketsComponent,
    SimCaptionComponent,
    SimStageRailComponent,
    SimTransportComponent,
  ],
  host: {
    // The scene is driven by imperative DOM mutation (transforms, beat classes,
    // animation styles) right after render, which can't be hydrated, so render it
    // fresh on the client. The prerendered HTML still ships for SEO / first paint.
    ngSkipHydration: 'true',
    class: 'mf-sim',
    '[class.flowing]': 'flowing()',
    '[class.actuated]': 'actuated()',
    '[class.showtoast]': 'showtoast()',
  },
  templateUrl: './how-it-works.component.html',
  styleUrl: './how-it-works.component.css',
})
export class HowItWorksComponent {
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly r = inject(Renderer2);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly stages = STAGES;

  // ── engine state ──────────────────────────────────────────────────────────
  protected readonly idx = signal(0);
  protected readonly playing = signal(false);
  protected readonly progress = signal(0); // track fill 0..100
  /** Valve energized: drives the cumulative `actuated` state at stage 4+. */
  private readonly energized = signal(false);
  protected readonly outroShown = signal(false);

  // live camera + scene transforms
  protected readonly worldTransform = signal('');
  protected readonly scenePAR = signal('xMidYMid meet');

  // live dashboard readouts
  protected readonly flowText = signal('0.0 L/min');
  protected readonly litresText = signal('0');
  protected readonly tankText = signal('86%');
  protected readonly tankTop = signal(556);
  protected readonly flowRateText = signal('0 L/min');
  protected readonly outLitresText = signal('0');

  // ── derived ────────────────────────────────────────────────────────────────
  protected readonly stage = computed(() => STAGES[this.idx()]);
  protected readonly flowing = computed(() => this.idx() >= 5);
  protected readonly actuated = computed(() => this.idx() >= 5 || (this.idx() === 4 && this.energized()));
  protected readonly showtoast = computed(() => this.idx() >= 6);
  protected readonly running = computed(() => this.idx() >= 1);
  protected readonly checkVisible = computed(() => this.idx() === 3);
  protected readonly valveText = computed(() => (this.actuated() ? 'OPEN' : 'CLOSED'));
  protected readonly label = computed(() => `${this.idx() + 1} / ${STAGES.length}`);

  /** Lit zones at the current stage, as a Set, so the per-zone dim bindings are O(1). */
  private readonly focusSet = computed(() => new Set(this.stage().focus));
  /** Is a zone dimmed at the current stage? Used for the per-zone dim inputs. */
  protected isDim(zone: string): boolean {
    return !this.focusSet().has(zone);
  }

  // ── plain (non-reactive) engine fields ──────────────────────────────────────
  private stageStart = 0;
  private raf = 0;
  private litres = 0;
  private rate = 0;
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private stageTimers: ReturnType<typeof setTimeout>[] = [];
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private camTarget: { cam: Cam; mBox?: MBox } | null = null;
  private mqMobile: MediaQueryList | null = null;
  private rzTimer: ReturnType<typeof setTimeout> | null = null;
  private orientTimer: ReturnType<typeof setTimeout> | null = null;
  // touch swipe
  private tx0 = 0;
  private ty0 = 0;
  private tt0 = 0;

  constructor() {
    applyPageSeo({
      title: 'How MajiFlow works: from a tap on your phone to water in the field',
      description:
        'Watch a single command travel the whole MajiFlow stack: dashboard to platform to controller, safety checks on the device, the valve and pump, real flow, and the reading back to your phone.',
      path: 'how-it-works',
    });

    // Deep link: ?s=<1..8> jumps to a stage; &paused=1 holds there. Safe on the
    // server (no DOM); the camera/playback only start in afterNextRender.
    const qp = this.route.snapshot.queryParamMap;
    const startStage = Math.max(1, Math.min(STAGES.length, parseInt(qp.get('s') ?? '1', 10) || 1)) - 1;
    const startPaused = qp.get('paused') === '1';

    afterNextRender(() => {
      this.mqMobile = window.matchMedia('(max-width: 760px) and (orientation: portrait)');
      const onMq = () => this.reframe();
      this.mqMobile.addEventListener('change', onMq);
      this.destroyRef.onDestroy(() => this.mqMobile?.removeEventListener('change', onMq));

      // Replay cumulative state up to the target so actuated/flowing settle right.
      if (startStage > 0) this.goTo(startStage);
      else this.goTo(0, false);

      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (startPaused || reduce) {
        this.pause();
        this.progress.set(0);
      } else {
        this.bootTimer = setTimeout(() => this.play(), startStage > 0 ? 200 : 900);
      }
    });

    this.destroyRef.onDestroy(() => {
      if (!this.isBrowser) return; // nothing scheduled during SSR/prerender
      cancelAnimationFrame(this.raf);
      this.stopLiveNumbers();
      this.clearStageTimers();
      if (this.bootTimer) clearTimeout(this.bootTimer);
      if (this.rzTimer) clearTimeout(this.rzTimer);
      if (this.orientTimer) clearTimeout(this.orientTimer);
    });
  }

  // ── camera ──────────────────────────────────────────────────────────────────
  private isMobile(): boolean {
    return this.mqMobile?.matches ?? false;
  }

  private applyCamTarget(camObj: Cam, mBox?: MBox): void {
    this.camTarget = { cam: camObj, mBox };
    if (this.isMobile()) {
      this.scenePAR.set('xMidYMid slice');
      this.worldTransform.set(frameMobileBox(mBox ?? defaultBox(camObj), window.innerWidth, window.innerHeight));
    } else {
      this.scenePAR.set('xMidYMid meet');
      this.worldTransform.set(frameDesktop(camObj));
    }
  }

  private applyCam(i: number): void {
    this.applyCamTarget(STAGES[i].cam, MBOX[i]);
  }

  private reframe(): void {
    if (this.camTarget) this.applyCamTarget(this.camTarget.cam, this.camTarget.mBox);
    else this.applyCam(this.idx());
  }

  // ── stage timers + one-shot beats/bursts ────────────────────────────────────
  private clearStageTimers(): void {
    this.stageTimers.forEach(clearTimeout);
    this.stageTimers = [];
  }

  private later(fn: () => void, ms: number): void {
    this.stageTimers.push(setTimeout(fn, ms));
  }

  /** Restart a one-shot beat class on the host (remove → reflow → add). */
  private setBeat(cls: (typeof BEATS)[number] | null): void {
    const n = this.el.nativeElement;
    for (const c of BEATS) this.r.removeClass(n, c);
    if (cls) {
      void n.offsetWidth; // reflow so the keyframes restart
      this.r.addClass(n, cls);
    }
  }

  private resetBursts(): void {
    for (const id of BURSTS) {
      const node = this.el.nativeElement.querySelector('#' + id) as SVGElement | null;
      if (node) node.style.animation = '';
    }
  }

  /** Re-fire a single arrival burst (telemetry tracking shot, synced to camera). */
  private fireBurst(id: string): void {
    const node = this.el.nativeElement.querySelector('#' + id) as SVGElement | null;
    if (!node) return;
    node.style.animation = 'none';
    void node.getBoundingClientRect();
    node.style.animation = 'mf-burst 1s ease-out';
  }

  // ── stage transition ────────────────────────────────────────────────────────
  private goTo(i: number, restart = true): void {
    this.idx.set(((i % STAGES.length) + STAGES.length) % STAGES.length);
    const s = STAGES[this.idx()];
    this.clearStageTimers();
    this.hideOutro();
    this.resetBursts();

    // camera: a single framing, or a scheduled pan across waypoints
    if (s.path) {
      this.applyCamTarget(s.path[0].cam, s.path[0].m);
      if (restart) {
        if (s.path[0].burst) this.later(() => this.fireBurst(s.path![0].burst!), 400);
        for (let k = 1; k < s.path.length; k++) {
          const wp = s.path[k];
          this.later(() => {
            this.applyCamTarget(wp.cam, wp.m);
            if (wp.burst) this.later(() => this.fireBurst(wp.burst!), 1150);
          }, wp.at);
        }
      }
    } else {
      this.applyCam(this.idx());
    }

    // cumulative physical state (energized drives the actuated computed):
    //   stage 5+ : valve already open; stage 4 : opens ~1.5s in (when the pulse lands)
    if (this.idx() >= 5) {
      this.energized.set(true);
    } else if (this.idx() === 4) {
      this.energized.set(false);
      if (restart) this.later(() => this.energized.set(true), 1500);
      else this.energized.set(true);
    } else {
      this.energized.set(false);
    }

    // one-shot motion for this stage (check badge is handled by checkVisible)
    this.setBeat(null);
    if (restart) {
      if (s.fx === 'tap') this.setBeat('s-tap');
      else if (s.fx === 'cmd') this.setBeat('s-cmd');
      else if (s.fx === 'actuate') this.setBeat('s-control');
      else if (s.fx === 'tele') this.setBeat('s-tele');
    }

    // dashboard numbers
    if (this.idx() >= 5) this.runLiveNumbers();
    else {
      this.stopLiveNumbers();
      this.resetNumbers(this.idx());
    }

    this.stageStart = this.isBrowser ? performance.now() : 0;
  }

  // ── live dashboard numbers while flowing ─────────────────────────────────────
  private runLiveNumbers(): void {
    this.stopLiveNumbers();
    this.flowRateText.set('32 L/min');
    this.flowText.set('0.0 L/min');
    this.rate = 0;
    this.liveTimer = setInterval(() => {
      this.rate = Math.min(32, this.rate + 3.0 + Math.random() * 1.5);
      this.litres += (this.rate / 60) * 0.5; // ~0.5s tick
      this.flowText.set(this.rate.toFixed(1) + ' L/min');
      this.litresText.set(Math.round(this.litres).toLocaleString());
      const lvl = Math.max(60, 86 - this.litres / 40); // tank slowly drains
      this.tankText.set(Math.round(lvl) + '%');
      this.tankTop.set(556 + (86 - lvl) * 1.6);
    }, 500);
  }

  private stopLiveNumbers(): void {
    if (this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
  }

  private resetNumbers(i: number): void {
    if (i < 5) {
      this.flowText.set('0.0 L/min');
      this.flowRateText.set('0 L/min');
    }
    if (i === 0) {
      this.litres = 0;
      this.litresText.set('0');
      this.tankText.set('86%');
      this.tankTop.set(556);
    }
  }

  // ── outro ────────────────────────────────────────────────────────────────────
  private showOutro(): void {
    this.outLitresText.set(Math.max(80, Math.round(this.litres)).toLocaleString());
    this.outroShown.set(true);
  }

  private hideOutro(): void {
    this.outroShown.set(false);
  }

  protected replay(): void {
    this.hideOutro();
    this.goTo(0);
    this.play();
  }

  // ── playback loop ────────────────────────────────────────────────────────────
  private readonly tick = (now: number): void => {
    if (!this.playing()) return;
    const s = STAGES[this.idx()];
    const t = now - this.stageStart;
    this.progress.set(Math.min(100, (t / s.dur) * 100));
    if (t >= s.dur) {
      if (this.idx() === STAGES.length - 1) {
        this.pause();
        this.progress.set(100);
        this.showOutro();
        return;
      }
      this.goTo(this.idx() + 1);
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  protected play(): void {
    if (this.playing()) return;
    this.hideOutro();
    if (this.idx() === STAGES.length - 1) this.goTo(0);
    this.playing.set(true);
    this.stageStart = performance.now() - (this.progress() / 100) * STAGES[this.idx()].dur;
    this.raf = requestAnimationFrame(this.tick);
  }

  protected pause(): void {
    this.playing.set(false);
    cancelAnimationFrame(this.raf);
  }

  // ── chrome intents ───────────────────────────────────────────────────────────
  protected onToggle(): void {
    this.playing() ? this.pause() : this.play();
  }

  protected next(): void {
    this.goTo(this.idx() + 1);
    this.pause();
    this.progress.set(0);
  }

  protected prev(): void {
    this.goTo(this.idx() - 1);
    this.pause();
    this.progress.set(0);
  }

  protected onSelect(i: number): void {
    this.goTo(i);
    this.pause();
    this.progress.set(0);
  }

  // ── input: keyboard ──────────────────────────────────────────────────────────
  @HostListener('document:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      e.preventDefault();
      this.onToggle();
    } else if (e.code === 'ArrowRight') {
      this.next();
    } else if (e.code === 'ArrowLeft') {
      this.prev();
    }
  }

  // ── input: touch swipe (rail is hidden on mobile) ────────────────────────────
  @HostListener('touchstart', ['$event'])
  protected onTouchStart(e: TouchEvent): void {
    const t = e.changedTouches[0];
    this.tx0 = t.clientX;
    this.ty0 = t.clientY;
    this.tt0 = Date.now();
  }

  @HostListener('touchend', ['$event'])
  protected onTouchEnd(e: TouchEvent): void {
    const t = e.changedTouches[0];
    const dx = t.clientX - this.tx0;
    const dy = t.clientY - this.ty0;
    const dt = Date.now() - this.tt0;
    if (dt < 600 && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      dx < 0 ? this.next() : this.prev();
    }
  }

  // ── input: re-frame on resize / orientation change ───────────────────────────
  @HostListener('window:resize')
  protected onResize(): void {
    if (this.rzTimer) clearTimeout(this.rzTimer);
    this.rzTimer = setTimeout(() => this.reframe(), 120);
  }

  @HostListener('window:orientationchange')
  protected onOrientation(): void {
    if (this.orientTimer) clearTimeout(this.orientTimer);
    this.orientTimer = setTimeout(() => this.reframe(), 250);
  }
}
