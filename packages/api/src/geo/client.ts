import { env } from "@wherehouse/env/server";

import type { components, operations } from "./openapi.generated";

type PresetsOperation = operations["get_presets_v1_presets_get"];
type HeatmapOperation = operations["get_heatmap_v1_heatmap_get"];

/**
 * Derived from the generated schema rather than hand-listed, so adding a
 * preset on the Python side widens this automatically instead of silently
 * leaving the new preset unreachable from the client.
 */
export type PresetName = components["schemas"]["HeatmapResponse"]["preset"];

export type GeoPresets =
  PresetsOperation["responses"][200]["content"]["application/json"];
export type HeatmapResponse =
  HeatmapOperation["responses"][200]["content"]["application/json"];
export type ScoreRequest = components["schemas"]["ScoreRequest"];
export type ScoreResponse = components["schemas"]["ScoreResponse"];
export type BatchScoreRequest = components["schemas"]["BatchScoreRequest"];
export type BatchScoreResponse = components["schemas"]["BatchScoreResponse"];

interface GeoErrorEnvelope {
  code?: string;
  message?: string;
  detail?: unknown;
}

interface GeoErrorBody {
  error?: GeoErrorEnvelope;
  // Legacy FastAPI shape, kept as a fallback only.
  detail?: string | (GeoErrorEnvelope & { [key: string]: unknown });
}

export class GeoServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail: unknown,
  ) {
    super(message);
    this.name = "GeoServiceError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = env.GEO_SERVICE_URL.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${env.GEO_SERVICE_TOKEN}`,
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let body: GeoErrorBody | undefined;
    try {
      body = await response.json() as GeoErrorBody;
    } catch {
      body = undefined;
    }

    const envelope: GeoErrorEnvelope | undefined =
      body?.error
      ?? (body?.detail && typeof body.detail === "object" ? body.detail : undefined);
    const code = envelope?.code ?? `GEO_HTTP_${response.status}`;
    const message = envelope?.message
      ?? (typeof body?.detail === "string" ? body.detail : undefined)
      ?? (typeof body?.error === "string" ? body.error : undefined)
      ?? `Geo service returned HTTP ${response.status}`;

    throw new GeoServiceError(response.status, code, message, envelope?.detail);
  }

  return response.json() as Promise<T>;
}

export function getPresets(): Promise<GeoPresets> {
  return request<GeoPresets>("/v1/presets");
}

export function getHeatmap(preset: PresetName): Promise<HeatmapResponse> {
  const query = new URLSearchParams({ preset });
  return request<HeatmapResponse>(`/v1/heatmap?${query}`);
}

export function scorePoint(input: ScoreRequest): Promise<ScoreResponse> {
  return request<ScoreResponse>("/v1/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function scoreBatch(input: BatchScoreRequest): Promise<BatchScoreResponse> {
  return request<BatchScoreResponse>("/v1/score/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
