/**
 * The MajiFlow "how it works" simulation: stage timeline + per-stage framing.
 *
 * Each stage is one beat in a single command's journey through the whole stack:
 * web dashboard → MajiFlow platform → KC868 controller (checks on-device) →
 * relay/GPIO → 2-wire motorized valve → pump + water + flow sensor → telemetry
 * back up → live dashboard / clean stop. Pure data: the page component reads it
 * to drive the camera, captions, rail and state. Camera coords are in the SVG
 * user space (viewBox 0 0 2600 1000); the camera framing math lives in camera.ts.
 */

/** Scene world dimensions: the SVG viewBox both the camera and MBOX work in. */
export const WORLD = { w: 2600, h: 1000 } as const;

/** A desktop camera target: focus point (fx,fy) centred at scale s. */
export interface Cam {
  fx: number;
  fy: number;
  s: number;
}

/** A world-space region (user units) the mobile camera fits into the view band. */
export interface MBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The one-shot motion a stage kicks off when it becomes active. */
export type StageFx = 'tap' | 'cmd' | 'check' | 'actuate' | 'flow' | 'tele';

/** A waypoint in a stage's tracking shot: pan to `cam`/`m` at `at` ms, burst on `burst`. */
export interface Waypoint {
  at: number;
  burst?: string;
  cam: Cam;
  m: MBox;
}

export interface Stage {
  /** Caption eyebrow + the layer this beat depicts. */
  key: string;
  /** Short rail-chip label. */
  short: string;
  /** Desktop camera framing. */
  cam: Cam;
  /** data-zone names kept lit; the rest dim. */
  focus: string[];
  title: string;
  body: string;
  /** The differentiator that lands a beat after the headline. */
  why: string;
  /** Stage duration (ms) used by the playback loop. */
  dur: number;
  /** One-shot motion fired on entry (when restarting). */
  fx?: StageFx;
  /** Optional tracking shot: the camera pans node-by-node across these waypoints. */
  path?: Waypoint[];
}

const cam = (fx: number, fy: number, s: number): Cam => ({ fx, fy, s });

export const STAGES: Stage[] = [
  {
    key: 'Overview',
    short: 'Site',
    cam: cam(1320, 520, 0.9),
    focus: ['phone', 'auto', 'server', 'controller', 'site'],
    title: 'A MajiFlow site, end to end',
    body: 'An irrigation farm: one tank, a pump, a motorized valve, a flow sensor, and a field. Follow a single command through every layer, from the dashboard in your hand to water reaching the crop.',
    why: 'What you subscribe to is the hosted platform: your dashboard, history and alerts, on your phone from anywhere. It is never a lock-in, the controller keeps running your schedules and safety on its own, online or not.',
    dur: 5200,
  },
  {
    key: 'Web interface',
    short: 'Dashboard',
    cam: cam(380, 430, 1.5),
    focus: ['phone', 'auto'],
    title: 'You press Start, or an automation does',
    body: 'On the dashboard you start a route, Tank → Field A. Or it starts on its own: a schedule, or when the tank crosses a level. Two ways in, one system, and either way you watch it live.',
    why: 'A manual hold is leased (a dead-man lease): if your phone drops off the network, the valve releases on its own. By hand or automated, nothing is ever left running by accident.',
    dur: 5400,
    fx: 'tap',
  },
  {
    key: 'MajiFlow platform',
    short: 'Platform',
    cam: cam(700, 396, 1.32),
    focus: ['phone', 'auto', 'server', 'controller'],
    title: 'The platform, not just a pipe',
    body: 'Your trigger reaches the MajiFlow platform: the same backend that hosts your dashboard, keeps your history and stats, raises alerts, and bridges commands down to the controller and telemetry back up. It runs managed in the cloud, or on a hub at your own site.',
    why: 'The platform carries your messages and keeps your data, but it never makes a safety call. Those live on the controller, so a slow or lost connection can never put your equipment at risk.',
    dur: 6000,
    fx: 'cmd',
  },
  {
    key: 'Controller',
    short: 'Controller',
    cam: cam(1192, 520, 1.55),
    focus: ['controller'],
    title: 'Pre-flight checks, on the device',
    body: 'The controller receives the command and runs the safety checks itself: does the source have water, does the destination have room?',
    why: 'Every start, manual or automated, passes the same checks, and they run on the controller, not the platform. A lost connection can never disable a safety check.',
    dur: 5400,
    fx: 'check',
  },
  {
    key: 'Actuation',
    short: 'Valve',
    cam: cam(1640, 660, 1.45),
    focus: ['controller', 'site'],
    title: 'Energize the valve',
    body: 'Checks pass. A GPIO pin goes high → a MOSFET/relay closes → the 2-wire valve’s OPEN motor energizes. It drives for up to the travel time, then the valve mechanically latches and draws no current.',
    why: 'OPEN and CLOSE are hardware-interlocked: they can never energize at once. The valve holds its position with zero standby power.',
    dur: 5600,
    fx: 'actuate',
  },
  {
    key: 'Water',
    short: 'Water',
    cam: cam(2000, 700, 1.05),
    focus: ['site'],
    title: 'Flow, confirmed',
    body: 'The pump runs and water moves: tank → pump → valve → field. The flow sensor’s impeller spins and the controller confirms real flow within the flow-confirm window.',
    why: 'A flow watchdog guards the run: if water never arrives, the controller faults, shuts down safely, and the platform raises an alert, so you hear about it instead of a dry pump running on.',
    dur: 5800,
    fx: 'flow',
  },
  {
    key: 'Telemetry',
    short: 'Report',
    cam: cam(2236, 712, 1.35),
    focus: ['phone', 'auto', 'server', 'controller', 'site'],
    title: 'The reading makes its way back',
    body: 'The flow sensor counts every litre and hands the number up: sensor to controller, controller to platform, platform to the dashboard in your hand. Follow one reading all the way home.',
    why: 'Telemetry travels the same route as the command, only in reverse. The controller measures at the source and reports up, so the number you read is the one the hardware actually saw.',
    dur: 7800,
    fx: 'tele',
    // A tracking shot: the camera pans node by node along the return path, and a
    // burst lands on each node as the reading arrives there.
    path: [
      { at: 0, burst: 'burstFlow', cam: cam(2236, 712, 1.35), m: { x: 2120, y: 668, w: 280, h: 232 } },
      { at: 1700, burst: 'burstCtrl', cam: cam(1192, 540, 1.5), m: { x: 980, y: 360, w: 430, h: 360 } },
      { at: 3400, burst: 'burstServer', cam: cam(700, 420, 1.32), m: { x: 470, y: 280, w: 430, h: 330 } },
      { at: 5100, burst: 'burstPhone', cam: cam(380, 470, 1.5), m: { x: 140, y: 185, w: 460, h: 600 } },
    ],
  },
  {
    key: 'Closed loop',
    short: 'Live',
    cam: cam(1320, 520, 0.9),
    focus: ['phone', 'auto', 'server', 'controller', 'site'],
    title: 'You see it live: stats up, alerts out',
    body: 'Flow rate and litres stream up to your dashboard in real time, building the history and stats you can trust. The route stops itself cleanly when it hits its litre or time target.',
    why: 'Metrics flow up in parallel the whole time, and alerts reach you the moment something is off: a no-flow fault, a tank running low. The controller keeps its routine even with the internet down; you only need the network to check in.',
    dur: 7200,
  },
];

/** Per-stage mobile framing: the world region (user space) to keep in view. */
export const MBOX: MBox[] = [
  { x: 120, y: 170, w: 2460, h: 680 }, // 1 overview, whole site
  { x: 140, y: 185, w: 460, h: 600 }, // 2 web interface (phone + automations)
  { x: 470, y: 280, w: 430, h: 330 }, // 3 platform
  { x: 980, y: 360, w: 430, h: 360 }, // 4 controller (incl. checks badge)
  { x: 1900, y: 580, w: 280, h: 300 }, // 5 actuation (valve)
  { x: 1670, y: 600, w: 910, h: 320 }, // 6 water (valve -> pump -> flow -> field)
  { x: 2120, y: 668, w: 280, h: 232 }, // 7 telemetry (starts on the flow sensor)
  { x: 120, y: 170, w: 2460, h: 680 }, // 8 closed loop, whole site
];
