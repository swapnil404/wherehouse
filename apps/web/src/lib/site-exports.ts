import { cellToBoundary } from "h3-js";

import {
  PRESET_LABELS,
  SUBSCORE_KEYS,
  SUBSCORE_LABELS,
  compositeScore,
  type PresetName,
  type Subscores,
  type Weights,
} from "./cells";

export interface ExportConstraint {
  id: string;
  label: string;
  actual?: unknown;
  required?: unknown;
  pass: boolean;
}

export interface ExportSite {
  h3_index: string;
  lat: number;
  lon: number;
  eligible: boolean;
  subscores: Subscores;
  constraints: readonly ExportConstraint[];
}

export interface SiteExportInput {
  sites: readonly ExportSite[];
  preset: PresetName;
  weights: Weights;
}

function scoreOf(site: ExportSite, weights: Weights): number | null {
  return compositeScore(site.subscores, weights);
}

function closedBoundary(h3Index: string): [number, number][] {
  const ring = cellToBoundary(h3Index, true) as [number, number][];
  const first = ring[0];
  const last = ring.at(-1);
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    return [...ring, first];
  }
  return ring;
}

/** A portable GIS artifact: one polygon feature per selected H3 cell. */
export function buildSitesGeoJson({ sites, preset, weights }: SiteExportInput) {
  return {
    type: "FeatureCollection" as const,
    name: `Wherehouse ${PRESET_LABELS[preset]} site comparison`,
    generated_at: new Date().toISOString(),
    features: sites.map((site, index) => ({
      type: "Feature" as const,
      id: site.h3_index,
      geometry: {
        type: "Polygon" as const,
        coordinates: [closedBoundary(site.h3_index)],
      },
      properties: {
        site: `Site ${index + 1}`,
        h3_index: site.h3_index,
        h3_resolution: 8,
        preset,
        score: scoreOf(site, weights),
        eligible: site.eligible,
        latitude: site.lat,
        longitude: site.lon,
        ...Object.fromEntries(
          SUBSCORE_KEYS.map((key) => [`subscore_${key}`, site.subscores[key]]),
        ),
        ...Object.fromEntries(
          SUBSCORE_KEYS.map((key) => [`weight_${key}`, weights[key] ?? 0]),
        ),
        failed_rules: site.constraints
          .filter((constraint) => !constraint.pass)
          .map((constraint) => constraint.label || constraint.id),
      },
    })),
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportStem(preset: PresetName, count: number) {
  const kind = count === 1 ? "site" : `comparison-${count}-sites`;
  return `wherehouse-${preset}-${kind}`;
}

export function downloadSitesGeoJson(input: SiteExportInput) {
  const contents = JSON.stringify(buildSitesGeoJson(input), null, 2);
  downloadBlob(
    new Blob([contents], { type: "application/geo+json;charset=utf-8" }),
    `${exportStem(input.preset, input.sites.length)}.geojson`,
  );
}

function printable(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Build lazily so jsPDF never joins the initial map bundle. */
export async function createSitesPdf(input: SiteExportInput) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({
    orientation: input.sites.length === 1 ? "portrait" : "landscape",
    unit: "mm",
    format: "a4",
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  const scores = input.sites.map((site) => scoreOf(site, input.weights));
  const ranked = input.sites
    .map((site, index) => ({ site, index, score: scores[index] ?? -1 }))
    .sort((a, b) => Number(b.site.eligible) - Number(a.site.eligible) || b.score - a.score);
  const lead = ranked[0];
  const anyEligible = input.sites.some((site) => site.eligible);
  const siteColors = [
    [255, 18, 38],
    [26, 26, 26],
    [105, 105, 105],
    [185, 185, 185],
  ] as const;

  const sectionLabel = (label: string, y: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(115, 115, 115);
    doc.text(label.toUpperCase(), margin, y);
  };

  const reportHeader = (subtitle: string) => {
    doc.setFillColor(8, 8, 8);
    doc.rect(0, 0, pageWidth, 27, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("WHEREHOUSE", margin, 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(178, 178, 178);
    doc.text(subtitle, margin, 19);
    doc.text(new Date().toLocaleString(), pageWidth - margin, 12, { align: "right" });
    doc.text(`${PRESET_LABELS[input.preset]} / H3 resolution 8`, pageWidth - margin, 19, {
      align: "right",
    });
  };

  const drawScoreBar = (x: number, y: number, width: number, score: number | null, colorIndex: number) => {
    doc.setFillColor(228, 228, 228);
    doc.roundedRect(x, y, width, 2.2, 1.1, 1.1, "F");
    if (score !== null) {
      const color = siteColors[colorIndex] ?? siteColors[0];
      doc.setFillColor(color[0], color[1], color[2]);
      doc.roundedRect(x, y, width * Math.max(0, Math.min(100, score)) / 100, 2.2, 1.1, 1.1, "F");
    }
  };

  reportHeader(input.sites.length === 1 ? "SITE ASSESSMENT" : "SITE COMPARISON");

  let y = 35;
  doc.setFillColor(anyEligible ? 244 : 255, anyEligible ? 244 : 238, anyEligible ? 244 : 240);
  doc.roundedRect(margin, y, contentWidth, 24, 3, 3, "F");
  doc.setTextColor(anyEligible ? 30 : 190, anyEligible ? 30 : 20, anyEligible ? 30 : 35);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(anyEligible ? "LEADING WORKABLE OPTION" : "HIGHEST SCORE - RULE REVIEW REQUIRED", margin + 5, y + 7);
  doc.setFontSize(15);
  doc.text(lead ? `Site ${lead.index + 1}` : "No site", margin + 5, y + 16);
  doc.setFontSize(15);
  doc.text(lead?.score >= 0 ? lead.score.toFixed(1) : "-", pageWidth - margin - 5, y + 12, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text(
    anyEligible
      ? "Highest scoring site that clears every hard rule."
      : input.sites.length === 1
        ? "This site does not clear every hard rule. Resolve failed rules before selecting it."
        : "No compared site clears every hard rule. Resolve failed rules before selecting a site.",
    margin + 38,
    y + 16,
  );

  y = 67;
  sectionLabel("Site overview", y);
  y += 4;
  const cardGap = 3;
  const cardWidth = (contentWidth - cardGap * (input.sites.length - 1)) / input.sites.length;
  input.sites.forEach((site, index) => {
    const x = margin + (cardWidth + cardGap) * index;
    doc.setFillColor(250, 250, 250);
    doc.setDrawColor(222, 222, 222);
    doc.roundedRect(x, y, cardWidth, 27, 2.5, 2.5, "FD");
    const color = siteColors[index] ?? siteColors[0];
    doc.setFillColor(color[0], color[1], color[2]);
    doc.rect(x, y, 2, 27, "F");
    doc.setTextColor(35, 35, 35);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(`SITE ${index + 1}`, x + 5, y + 7);
    doc.setFontSize(14);
    doc.text(scores[index]?.toFixed(1) ?? "-", x + 5, y + 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(site.eligible ? 35 : 225, site.eligible ? 110 : 25, site.eligible ? 65 : 40);
    const failureCount = site.constraints.filter((item) => !item.pass).length;
    doc.text(
      site.eligible ? "RULES CLEAR" : `${failureCount} ${failureCount === 1 ? "RULE" : "RULES"} FAILED`,
      x + cardWidth - 4,
      y + 8,
      { align: "right" },
    );
    drawScoreBar(x + 5, y + 20, cardWidth - 10, scores[index], index);
    doc.setFont("courier", "normal");
    doc.setFontSize(5.8);
    doc.setTextColor(110, 110, 110);
    doc.text(site.h3_index, x + 5, y + 25.5);
  });

  y += 35;
  sectionLabel("Score breakdown", y);
  y += 5;
  const labelWidth = 42;
  const metricSiteWidth = (contentWidth - labelWidth) / input.sites.length;
  SUBSCORE_KEYS.forEach((key, rowIndex) => {
    const rowHeight = 10;
    if (rowIndex % 2 === 0) {
      doc.setFillColor(248, 248, 248);
      doc.rect(margin, y, contentWidth, rowHeight, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(65, 65, 65);
    doc.text(SUBSCORE_LABELS[key], margin + 2, y + 6.2);
    doc.setTextColor(125, 125, 125);
    doc.text(`${Math.round((input.weights[key] ?? 0) * 100)}%`, margin + labelWidth - 3, y + 6.2, { align: "right" });
    input.sites.forEach((site, index) => {
      const value = site.subscores[key];
      const x = margin + labelWidth + metricSiteWidth * index;
      drawScoreBar(x + 4, y + 4, Math.max(8, metricSiteWidth - 20), value, index);
      doc.setFont("courier", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(28, 28, 28);
      doc.text(value.toFixed(1), x + metricSiteWidth - 3, y + 6.4, { align: "right" });
    });
    y += rowHeight;
  });

  const drawSiteDetails = (startY: number) => {
    sectionLabel("Hard rules and location", startY);
    const detailY = startY + 5;
    input.sites.forEach((site, index) => {
      const detailColumns = input.sites.length === 1 ? 1 : 2;
      const detailRows = Math.ceil(input.sites.length / detailColumns);
      const detailWidth = (contentWidth - cardGap * (detailColumns - 1)) / detailColumns;
      const detailHeight = Math.min(
        70,
        (pageHeight - detailY - 15 - cardGap * (detailRows - 1)) / detailRows,
      );
      const column = index % detailColumns;
      const row = Math.floor(index / detailColumns);
      const x = margin + (detailWidth + cardGap) * column;
      const cardY = detailY + (detailHeight + cardGap) * row;
      doc.setFillColor(250, 250, 250);
      doc.setDrawColor(225, 225, 225);
      doc.roundedRect(x, cardY, detailWidth, detailHeight, 2.5, 2.5, "FD");
      const color = siteColors[index] ?? siteColors[0];
      doc.setFillColor(color[0], color[1], color[2]);
      doc.rect(x, cardY, 2, detailHeight, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(25, 25, 25);
      doc.text(`SITE ${index + 1}`, x + 6, cardY + 7);
      doc.setFontSize(12);
      doc.text(scores[index]?.toFixed(1) ?? "-", x + 6, cardY + 14);
      doc.setFont("courier", "normal");
      doc.setFontSize(6.3);
      doc.setTextColor(105, 105, 105);
      doc.text(`${site.h3_index} / ${site.lat.toFixed(5)}, ${site.lon.toFixed(5)}`, x + detailWidth - 5, cardY + 8, { align: "right" });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(site.eligible ? 35 : 225, site.eligible ? 110 : 25, site.eligible ? 65 : 40);
      doc.text(site.eligible ? "ALL HARD RULES CLEAR" : "RULE REVIEW REQUIRED", x + detailWidth - 5, cardY + 14, { align: "right" });
      doc.setDrawColor(225, 225, 225);
      doc.line(x + 6, cardY + 18, x + detailWidth - 5, cardY + 18);
      let ruleY = cardY + 25;
      site.constraints.forEach((constraint) => {
        const color = constraint.pass ? [35, 120, 65] : [225, 20, 40];
        doc.setFillColor(color[0], color[1], color[2]);
        doc.circle(x + 7, ruleY - 1.2, 1, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.5);
        doc.setTextColor(45, 45, 45);
        const status = constraint.pass ? "PASS" : "REVIEW";
        doc.text(status, x + 10, ruleY);
        doc.setFont("helvetica", "normal");
        const text = `${constraint.label || constraint.id}: ${printable(constraint.actual)} / required ${printable(constraint.required)}`;
        const wrapped = doc.splitTextToSize(text, detailWidth - 32) as string[];
        doc.text(wrapped.slice(0, 2), x + 27, ruleY);
        ruleY += Math.max(7, wrapped.slice(0, 2).length * 3.3 + 2);
      });
    });
  };

  if (input.sites.length === 1) {
    drawSiteDetails(y + 8);
  } else {
    doc.addPage("a4", "landscape");
    doc.setPage(doc.getNumberOfPages());
    reportHeader("HARD RULE REVIEW");
    drawSiteDetails(37);
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(
      "Scores support comparison; they are not professional site-selection advice. Geometry is the H3 cell boundary.",
      margin,
      pageHeight - 7,
    );
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 7, {
      align: "right",
    });
  }

  return doc;
}

export async function downloadSitesPdf(input: SiteExportInput) {
  const doc = await createSitesPdf(input);
  doc.save(`${exportStem(input.preset, input.sites.length)}.pdf`);
}
