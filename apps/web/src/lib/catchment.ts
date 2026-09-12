export interface CatchmentCell {
  h3Index: string;
  minutes: number;
}

interface CatchmentBandLike {
  minutes: number;
  destinationH3Indexes: readonly string[];
}

const CATCHMENT_COLORS = {
  10: { rgba: [255, 35, 45, 150], css: "rgb(255 35 45)" },
  20: { rgba: [190, 24, 34, 115], css: "rgb(190 24 34)" },
  30: { rgba: [105, 18, 26, 90], css: "rgb(105 18 26)" },
} as const;

const FALLBACK_COLOR = {
  rgba: [255, 70, 78, 100],
  css: "rgb(255 70 78)",
} as const;

function colorFor(minutes: number) {
  return CATCHMENT_COLORS[minutes as keyof typeof CATCHMENT_COLORS] ?? FALLBACK_COLOR;
}

export function catchmentFill(minutes: number): [number, number, number, number] {
  return [...colorFor(minutes).rgba];
}

export function catchmentCssColor(minutes: number): string {
  return colorFor(minutes).css;
}

/**
 * Convert cumulative reachability bands into non-overlapping display rings.
 * A cell is assigned to the earliest band that can reach it.
 */
export function buildCatchmentCells(
  bands: readonly CatchmentBandLike[],
  maxMinutes: number,
): CatchmentCell[] {
  const firstReach = new Map<string, number>();
  for (const band of [...bands].sort((a, b) => a.minutes - b.minutes)) {
    if (band.minutes > maxMinutes) continue;
    for (const h3Index of band.destinationH3Indexes) {
      if (!firstReach.has(h3Index)) firstReach.set(h3Index, band.minutes);
    }
  }
  return [...firstReach].map(([h3Index, minutes]) => ({ h3Index, minutes }));
}
