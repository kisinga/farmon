/**
 * Unit conversions and constants for tank pressure-sensor calibration.
 *
 * Pressure is psi everywhere — schema, codegen, ESPHome `unit_of_measurement`,
 * HA entity labels, dashboards. No conversion at any seam.
 */

/** psi exerted by a 1 m water column at room temperature (ρ·g·h, ρ=1000, g=9.81). */
export const PSI_PER_M = 1.42233;

/** Common pressure-transducer max ratings, ascending. */
export const STANDARD_PSI: readonly number[] = [5, 10, 15, 30, 50, 100];

/**
 * Recommend the smallest standard sensor whose max is ≥ 1.5 × the expected
 * full-tank pressure. The 1.5× factor leaves headroom for water hammer and
 * for keeping readings off the top of the sensor's range (where accuracy
 * suffers).
 */
export function recommendSensorMaxPsi(p_full_psi: number): number {
  const target = p_full_psi * 1.5;
  for (const size of STANDARD_PSI) {
    if (size >= target) return size;
  }
  return STANDARD_PSI[STANDARD_PSI.length - 1];
}

/**
 * Calibration anchors derived purely from tank geometry. The result feeds
 * both the seeded HA Number entities and the live readout panel in the
 * editor sidebar.
 */
export interface TankCalibration {
  p_empty_psi: number;
  p_full_psi: number;
  /** P_full − P_empty: the portion of sensor range the tank fill actually uses. */
  working_span_psi: number;
}

export function deriveTankCalibration(
  tank_height_m: number,
  elevation_m: number,
): TankCalibration {
  const p_empty_psi = PSI_PER_M * elevation_m;
  const p_full_psi  = PSI_PER_M * (elevation_m + tank_height_m);
  return {
    p_empty_psi,
    p_full_psi,
    working_span_psi: p_full_psi - p_empty_psi,
  };
}
