export const MAX_COMPARE_SITES = 4;

export function toggleComparedSite<T extends { h3_index: string }>(
  sites: readonly T[],
  candidate: T,
): T[] {
  if (sites.some((site) => site.h3_index === candidate.h3_index)) {
    return sites.filter((site) => site.h3_index !== candidate.h3_index);
  }
  if (sites.length >= MAX_COMPARE_SITES) return [...sites];
  return [...sites, candidate];
}

export const COMPARE_COLORS = [
  { css: "#ff1f2d", rgba: [255, 31, 45, 255] },
  { css: "#f4f4f5", rgba: [244, 244, 245, 255] },
  { css: "#9ca3af", rgba: [156, 163, 175, 255] },
  { css: "#ff7a82", rgba: [255, 122, 130, 255] },
] as const;
