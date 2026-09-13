import { FileJson2Icon, FileTextIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { PresetName, Weights } from "@/lib/cells";
import {
  downloadSitesGeoJson,
  downloadSitesPdf,
  type ExportSite,
  type SiteExportInput,
} from "@/lib/site-exports";

interface SiteExportActionsProps {
  sites: readonly ExportSite[];
  preset: PresetName;
  weights: Weights;
  scope?: SiteExportInput["scope"];
  variant?: "toolbar" | "panel";
}

export default function SiteExportActions({
  sites,
  preset,
  weights,
  scope,
  variant = "panel",
}: SiteExportActionsProps) {
  const [pdfPending, setPdfPending] = useState(false);
  const input = { sites, preset, weights, scope };
  const base =
    variant === "toolbar"
      ? "flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
      : "flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-white/[0.03] px-2 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50";

  return (
    <div className={variant === "toolbar" ? "flex items-center gap-0.5" : "mt-2 flex gap-2"}>
      <button
        className={base}
        onClick={() => {
          downloadSitesGeoJson(input);
          toast.success(`Exported ${sites.length === 1 ? "site" : `${sites.length} sites`} as GeoJSON`);
        }}
        type="button"
      >
        <FileJson2Icon className="size-3.5" aria-hidden="true" />
        GeoJSON
      </button>
      <button
        className={base}
        disabled={pdfPending}
        onClick={async () => {
          setPdfPending(true);
          try {
            await downloadSitesPdf(input);
            toast.success(`Exported ${sites.length === 1 ? "site report" : "comparison report"} as PDF`);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "PDF export failed");
          } finally {
            setPdfPending(false);
          }
        }}
        type="button"
      >
        {pdfPending ? (
          <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <FileTextIcon className="size-3.5" aria-hidden="true" />
        )}
        PDF
      </button>
    </div>
  );
}
