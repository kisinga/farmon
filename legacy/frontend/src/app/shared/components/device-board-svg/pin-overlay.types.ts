export type PinEdge = 'top' | 'bottom' | 'left' | 'right';

export interface PinOverlayItem {
  firmwarePin: number;
  connectorId: string;
  color: string;
  label: string | null;
  isActive: boolean;
  edge: PinEdge;
}

/** A pin with computed positions for the dot, label, and leader line. */
export interface PositionedCallout {
  firmwarePin: number;
  color: string;
  label: string;
  isActive: boolean;
  edge: PinEdge;
  /** Pin center relative to overlay SVG */
  pinX: number;
  pinY: number;
  /** Label anchor in the margin */
  labelX: number;
  labelY: number;
  textAnchor: 'start' | 'end' | 'middle';
}
