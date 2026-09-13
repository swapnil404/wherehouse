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
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const labelWidth = 43;
  const siteWidth = (contentWidth - labelWidth) / input.sites.length;
  const scores = input.sites.map((site) => scoreOf(site, input.weights));

  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, pageWidth, 34, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("WHEREHOUSE", margin, 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(180, 180, 180);
  doc.text(`${PRESET_LABELS[input.preset]} site comparison`, margin, 23);
  doc.text(`Generated ${new Date().toLocaleString()}`, pageWidth - margin, 15, { align: "right" });
  doc.text(`${input.sites.length} ${input.sites.length === 1 ? "site" : "sites"}`, pageWidth - margin, 23, { align: "right" });

  let y = 43;
  doc.setDrawColor(220, 220, 220);
  doc.setTextColor(25, 25, 25);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("MEASURE", margin + 2, y + 6);
  input.sites.forEach((site, index) => {
    const x = margin + labelWidth + siteWidth * index;
    doc.setFillColor(index === 0 ? 255 : 245, index === 0 ? 25 : 245, index === 0 ? 40 : 245);
    doc.rect(x, y, siteWidth, 20, "F");
    doc.setTextColor(index === 0 ? 255 : 25, index === 0 ? 255 : 25, index === 0 ? 255 : 25);
    doc.text(`SITE ${index + 1}`, x + 3, y + 6);
    doc.setFontSize(15);
    doc.text(scores[index]?.toFixed(1) ?? "-", x + 3, y + 15);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(site.eligible ? "ELIGIBLE" : "RULE FAILED", x + siteWidth - 3, y + 15, { align: "right" });
    doc.setFont("helvetica", "bold");
  });
  y += 20;

  const rows = SUBSCORE_KEYS.map((key) => ({
    label: SUBSCORE_LABELS[key],
    values: input.sites.map((site) => site.subscores[key].toFixed(1)),
  }));
  rows.push({
    label: "Rules",
    values: input.sites.map((site) => {
      const failures = site.constraints.filter((constraint) => !constraint.pass).length;
      return failures === 0 ? "Clear" : `${failures} failed`;
    }),
  });

  doc.setFontSize(8);
  rows.forEach((row, rowIndex) => {
    const height = 9;
    if (rowIndex % 2 === 0) {
      doc.setFillColor(247, 247, 247);
      doc.rect(margin, y, contentWidth, height, "F");
    }
    doc.setTextColor(85, 85, 85);
    doc.setFont("helvetica", "normal");
    doc.text(row.label, margin + 2, y + 5.8);
    row.values.forEach((value, index) => {
      const x = margin + labelWidth + siteWidth * (index + 1) - 3;
      doc.setTextColor(20, 20, 20);
      doc.setFont("courier", "normal");
      doc.text(value, x, y + 5.8, { align: "right" });
    });
    doc.setDrawColor(226, 226, 226);
    doc.line(margin, y + height, margin + contentWidth, y + height);
    y += height;
  });

  y += 10;
  doc.setTextColor(25, 25, 25);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("SITE DETAILS", margin, y);
  y += 6;

  input.sites.forEach((site, index) => {
    if (y > doc.internal.pageSize.getHeight() - 22) {
      doc.addPage("a4", input.sites.length === 1 ? "portrait" : "landscape");
      doc.setFillColor(10, 10, 10);
      doc.rect(0, 0, pageWidth, 12, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("WHEREHOUSE / SITE DETAILS", margin, 7.5);
      y = 21;
    }
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(`Site ${index + 1}`, margin, y);
    doc.setFont("courier", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(95, 95, 95);
    doc.text(`${site.h3_index}  ·  ${site.lat.toFixed(5)}, ${site.lon.toFixed(5)}`, margin + 19, y);
    y += 5;

    const failed = site.constraints.filter((constraint) => !constraint.pass);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(45, 45, 45);
    if (failed.length === 0) {
      doc.text("All hard rules clear.", margin + 4, y);
      y += 6;
    } else {
      failed.forEach((constraint) => {
        const line = `${constraint.label || constraint.id}: ${printable(constraint.actual)} (required ${printable(constraint.required)})`;
        const wrapped = doc.splitTextToSize(line, contentWidth - 8) as string[];
        doc.text(wrapped, margin + 4, y);
        y += wrapped.length * 4;
      });
      y += 3;
    }
  });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(
      "Scores support comparison; they are not professional site-selection advice. Geometry is the H3 cell boundary.",
      margin,
      doc.internal.pageSize.getHeight() - 8,
    );
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 8, {
      align: "right",
    });
  }

  return doc;
}

export async function downloadSitesPdf(input: SiteExportInput) {
  const doc = await createSitesPdf(input);
  doc.save(`${exportStem(input.preset, input.sites.length)}.pdf`);
}
