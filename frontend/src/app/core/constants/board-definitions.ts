/**
 * Board definitions: map firmware pin indices to Fritzing SVG connector IDs.
 *
 * Each entry maps a firmware pinMap index (0–19) to the `id` attribute of
 * the corresponding `<path>` or `<g>` element inside the board's breadboard SVG.
 *
 * SVG files are copied during build by `make board-assets` from
 * firmware/targets/{model}/board/ → frontend/public/boards/{model}.svg
 *
 * Pin mappings derived from:
 *   rp2040: firmware/targets/rp2040/cmd/node/main.go  boardPins[] + Pico W datasheet
 *   lorae5: firmware/targets/lorae5/cmd/node/main.go   boardPins[] + Wio-E5 mini schematic
 */

export type PinEdge = 'top' | 'bottom' | 'left' | 'right';

export interface BoardPinDef {
  /** Firmware pinMap index (0–19). */
  firmwarePin: number;
  /** SVG element id inside the breadboard SVG (e.g. "connector0pin"). */
  connectorId: string;
  /** Human-readable label shown in dropdowns (e.g. "GP0", "PA2 / TX"). */
  label: string;
  /** Which visual edge this pin sits on (after any rotation). Used for label placement. */
  edge: PinEdge;
}

export interface BoardDefinition {
  model: string;
  label: string;
  /** Path relative to app root where the breadboard SVG is served. */
  svgUrl: string;
  /** Rotate the SVG by this many degrees (e.g. -90 for portrait→landscape). */
  rotateDeg?: number;
  /** Margin in px around the SVG reserved for leader-line labels. Default 80. */
  labelMargin?: number;
  pins: BoardPinDef[];
}

// ─── Raspberry Pi Pico W (RP2040) ────────────────────────────────────────────
// Firmware: GP0–GP19 map 1:1 to pinMap index 0–19.
// Fritzing: connector N = physical pin (N+1).  Physical pin layout from Pico W datasheet.
const RP2040_BOARD: BoardDefinition = {
  model: 'rp2040',
  label: 'Raspberry Pi Pico W',
  svgUrl: 'boards/rp2040.svg',
  rotateDeg: -90,
  pins: [
    // After -90° rotation: physical left row → visual top, physical right row → visual bottom
    { firmwarePin: 0,  connectorId: 'connector0pin',  label: 'GP0',  edge: 'top'    },
    { firmwarePin: 1,  connectorId: 'connector1pin',  label: 'GP1',  edge: 'top'    },
    { firmwarePin: 2,  connectorId: 'connector3pin',  label: 'GP2',  edge: 'top'    },
    { firmwarePin: 3,  connectorId: 'connector4pin',  label: 'GP3',  edge: 'top'    },
    { firmwarePin: 4,  connectorId: 'connector5pin',  label: 'GP4',  edge: 'top'    },
    { firmwarePin: 5,  connectorId: 'connector6pin',  label: 'GP5',  edge: 'top'    },
    { firmwarePin: 6,  connectorId: 'connector8pin',  label: 'GP6',  edge: 'top'    },
    { firmwarePin: 7,  connectorId: 'connector9pin',  label: 'GP7',  edge: 'top'    },
    { firmwarePin: 8,  connectorId: 'connector10pin', label: 'GP8',  edge: 'top'    },
    { firmwarePin: 9,  connectorId: 'connector11pin', label: 'GP9',  edge: 'top'    },
    { firmwarePin: 10, connectorId: 'connector13pin', label: 'GP10', edge: 'bottom' },
    { firmwarePin: 11, connectorId: 'connector14pin', label: 'GP11', edge: 'bottom' },
    { firmwarePin: 12, connectorId: 'connector15pin', label: 'GP12', edge: 'bottom' },
    { firmwarePin: 13, connectorId: 'connector16pin', label: 'GP13', edge: 'bottom' },
    { firmwarePin: 14, connectorId: 'connector18pin', label: 'GP14', edge: 'bottom' },
    { firmwarePin: 15, connectorId: 'connector19pin', label: 'GP15', edge: 'bottom' },
    { firmwarePin: 16, connectorId: 'connector20pin', label: 'GP16', edge: 'bottom' },
    { firmwarePin: 17, connectorId: 'connector21pin', label: 'GP17', edge: 'bottom' },
    { firmwarePin: 18, connectorId: 'connector23pin', label: 'GP18', edge: 'bottom' },
    { firmwarePin: 19, connectorId: 'connector24pin', label: 'GP19', edge: 'bottom' },
  ],
};

// ─── Wio-E5 mini (LoRa-E5 / STM32WL) ────────────────────────────────────────
// Firmware: PA0–PA7 → index 0–7, PB0–PB7 → index 8–15, PB8/9/10/15 → index 16–19.
// Only pins broken out on the Wio-E5 mini headers have connector IDs.
// Pins PA0, PA1, PB0, PB1, PB2, PB10, PB15 are NOT on the dev board headers.
const LORAE5_BOARD: BoardDefinition = {
  model: 'lorae5',
  label: 'Wio-E5 mini',
  svgUrl: 'boards/lorae5.svg',
  pins: [
    // Bottom header row
    { firmwarePin: 2,  connectorId: 'connector6pin',  label: 'PA2 / TX',   edge: 'bottom' },
    { firmwarePin: 3,  connectorId: 'connector5pin',  label: 'PA3 / RX',   edge: 'bottom' },
    // Top header row
    { firmwarePin: 4,  connectorId: 'connector15pin', label: 'PA4 / NSS',  edge: 'top'    },
    { firmwarePin: 5,  connectorId: 'connector14pin', label: 'PA5 / SCK',  edge: 'top'    },
    { firmwarePin: 6,  connectorId: 'connector16pin', label: 'PA6 / MISO', edge: 'top'    },
    { firmwarePin: 7,  connectorId: 'connector17pin', label: 'PA7 / MOSI', edge: 'top'    },
    // Bottom header row
    { firmwarePin: 11, connectorId: 'connector4pin',  label: 'PB3 / A3',   edge: 'bottom' },
    { firmwarePin: 12, connectorId: 'connector3pin',  label: 'PB4 / A4',   edge: 'bottom' },
    { firmwarePin: 13, connectorId: 'connector11pin', label: 'PB5 / TX2',  edge: 'bottom' },
    { firmwarePin: 14, connectorId: 'connector7pin',  label: 'PB6 / D0',   edge: 'bottom' },
    { firmwarePin: 15, connectorId: 'connector10pin', label: 'PB7 / RX2',  edge: 'bottom' },
    { firmwarePin: 16, connectorId: 'connector1pin',  label: 'PB8 / SCL',  edge: 'bottom' },
    { firmwarePin: 17, connectorId: 'connector2pin',  label: 'PB9 / SDA',  edge: 'bottom' },
  ],
};

/** All known board definitions, keyed by HardwareModelId. */
export const BOARD_DEFINITIONS: Record<string, BoardDefinition> = {
  rp2040: RP2040_BOARD,
  lorae5: LORAE5_BOARD,
};
