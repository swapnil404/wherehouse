interface Env {
  GEO_SERVICE_URL: string;
}

async function pingGeoService(env: Env): Promise<void> {
  const baseUrl = env.GEO_SERVICE_URL.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/health`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Geo health check returned HTTP ${response.status}`);
  }

  console.log(`Geo health check passed with HTTP ${response.status}`);
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
  ): Promise<void> {
    context.waitUntil(pingGeoService(env));
  },
} satisfies ExportedHandler<Env>;
