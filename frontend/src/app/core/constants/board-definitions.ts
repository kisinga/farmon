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

export interface BoardPinDef {
  /** Firmware pinMap index (0–19). */
  firmwarePin: number;
  /** SVG element id inside the breadboard SVG (e.g. "connector0pin"). */
  connectorId: string;
  /** Human-readable label shown in dropdowns (e.g. "GP0", "PA2 / TX"). */
  label: string;
}

export interface BoardDefinition {
  model: string;
  label: string;
  /** Path relative to app root where the breadboard SVG is served. */
  svgUrl: string;
  pins: BoardPinDef[];
}

// ─── Raspberry Pi Pico W (RP2040) ────────────────────────────────────────────
// Firmware: GP0–GP19 map 1:1 to pinMap index 0–19.
// Fritzing: connector N = physical pin (N+1).  Physical pin layout from Pico W datasheet.
const RP2040_BOARD: BoardDefinition = {
  model: 'rp2040',
  label: 'Raspberry Pi Pico W',
  svgUrl: 'boards/rp2040.svg',
  pins: [
    { firmwarePin: 0,  connectorId: 'connector0pin',  label: 'GP0'  },
    { firmwarePin: 1,  connectorId: 'connector1pin',  label: 'GP1'  },
    { firmwarePin: 2,  connectorId: 'connector3pin',  label: 'GP2'  },
    { firmwarePin: 3,  connectorId: 'connector4pin',  label: 'GP3'  },
    { firmwarePin: 4,  connectorId: 'connector5pin',  label: 'GP4'  },
    { firmwarePin: 5,  connectorId: 'connector6pin',  label: 'GP5'  },
    { firmwarePin: 6,  connectorId: 'connector8pin',  label: 'GP6'  },
    { firmwarePin: 7,  connectorId: 'connector9pin',  label: 'GP7'  },
    { firmwarePin: 8,  connectorId: 'connector10pin', label: 'GP8'  },
    { firmwarePin: 9,  connectorId: 'connector11pin', label: 'GP9'  },
    { firmwarePin: 10, connectorId: 'connector13pin', label: 'GP10' },
    { firmwarePin: 11, connectorId: 'connector14pin', label: 'GP11' },
    { firmwarePin: 12, connectorId: 'connector15pin', label: 'GP12' },
    { firmwarePin: 13, connectorId: 'connector16pin', label: 'GP13' },
    { firmwarePin: 14, connectorId: 'connector18pin', label: 'GP14' },
    { firmwarePin: 15, connectorId: 'connector19pin', label: 'GP15' },
    { firmwarePin: 16, connectorId: 'connector20pin', label: 'GP16' },
    { firmwarePin: 17, connectorId: 'connector21pin', label: 'GP17' },
    { firmwarePin: 18, connectorId: 'connector23pin', label: 'GP18' },
    { firmwarePin: 19, connectorId: 'connector24pin', label: 'GP19' },
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
    { firmwarePin: 2,  connectorId: 'connector6pin',  label: 'PA2 / TX'   },
    { firmwarePin: 3,  connectorId: 'connector5pin',  label: 'PA3 / RX'   },
    { firmwarePin: 4,  connectorId: 'connector15pin', label: 'PA4 / NSS'  },
    { firmwarePin: 5,  connectorId: 'connector14pin', label: 'PA5 / SCK'  },
    { firmwarePin: 6,  connectorId: 'connector16pin', label: 'PA6 / MISO' },
    { firmwarePin: 7,  connectorId: 'connector17pin', label: 'PA7 / MOSI' },
    { firmwarePin: 11, connectorId: 'connector4pin',  label: 'PB3 / A3'   },
    { firmwarePin: 12, connectorId: 'connector3pin',  label: 'PB4 / A4'   },
    { firmwarePin: 13, connectorId: 'connector11pin', label: 'PB5 / TX2'  },
    { firmwarePin: 14, connectorId: 'connector7pin',  label: 'PB6 / D0'   },
    { firmwarePin: 15, connectorId: 'connector10pin', label: 'PB7 / RX2'  },
    { firmwarePin: 16, connectorId: 'connector1pin',  label: 'PB8 / SCL'  },
    { firmwarePin: 17, connectorId: 'connector2pin',  label: 'PB9 / SDA'  },
  ],
};

/** All known board definitions, keyed by HardwareModelId. */
export const BOARD_DEFINITIONS: Record<string, BoardDefinition> = {
  rp2040: RP2040_BOARD,
  lorae5: LORAE5_BOARD,
};
