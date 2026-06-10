import type { CommandPhase } from '@core';

/**
 * Phase → presentation tokens. One mapping so every control (route cards, actuator
 * cards, schedule/system buttons, setpoint fields) renders the command lifecycle
 * identically: a spinner while in flight, an attention treatment when refused or
 * expired, nothing once confirmed (the control's own state view takes over).
 */
export interface PhaseUi {
  /** Show an activity spinner — command in flight, device hasn't reflected it yet. */
  spin: boolean;
  /** Refused or expired — surface the reason with an error/warning treatment. */
  alert: boolean;
  /** daisyUI text tone for the phase ('' when neutral). */
  tone: string;
}

const MAP: Record<CommandPhase, PhaseUi> = {
  pending:   { spin: true,  alert: false, tone: 'text-warning' },
  confirmed: { spin: false, alert: false, tone: '' },
  refused:   { spin: false, alert: true,  tone: 'text-error' },
  expired:   { spin: false, alert: true,  tone: 'text-warning' },
};

export const phaseUi = (phase: CommandPhase): PhaseUi => MAP[phase];
