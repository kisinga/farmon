/**
 * Pure pin overlay computation — shared between BoardSvgComponent and
 * the documentation generator. No DOM, no framework dependencies.
 */
import type { BoardDef } from './board.types';
import { entityColor, UI_COLORS } from './colors';

export interface PinOverlayData {
  connector: string;
  gpio: string;
  color: string;
  label: string;
  tooltip: string;
}

export function computePinOverlays(
  board: BoardDef,
  usedPins: Map<string, string>,
  reserved: Map<string, string>,
  selectedGpio?: string | null,
): PinOverlayData[] {
  return board.pins.map(pin => {
    const usage = usedPins.get(pin.gpio);
    const reservedReason = reserved.get(pin.gpio);

    let color: string = UI_COLORS.available;
    let label = pin.gpio.replace('GPIO', '');

    if (selectedGpio === pin.gpio) {
      color = UI_COLORS.selected;
    } else if (reservedReason) {
      color = UI_COLORS.reserved;
    } else if (usage) {
      const [type] = usage.split(':');
      color = entityColor(type) ?? UI_COLORS.available;
      label = usage.split(':').slice(1).join(':') || label;
    }

    const caps = pin.caps.join(', ');
    const tooltip = reservedReason
      ? `${pin.gpio} — reserved: ${reservedReason}`
      : usage
        ? `${pin.gpio} — ${usage} [${caps}]`
        : `${pin.gpio} — available [${caps}]`;

    return { connector: pin.connector, gpio: pin.gpio, color, label, tooltip };
  });
}
