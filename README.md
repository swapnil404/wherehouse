# wherehouse

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, TanStack Start, Self, TRPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Start** - SSR framework with TanStack Router
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **tRPC** - End-to-end type-safe APIs
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Database Setup

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up.
2. Update your `apps/web/.env` file with your PostgreSQL connection details.

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the fullstack application.

## FastAPI Sidecar

The Python scoring API lives in `apps/fastapi` and runs separately from the web application.

With [`just`](https://github.com/casey/just) installed, set up and start the API from the repository root:

```bash
just geo-setup
just geo-dev
```

After both applications are configured, start them together with `just dev`.

`just dev` runs Turbo and Uvicorn in the same terminal, so their interactive output can overlap even when both services are healthy. For separate, easier-to-read logs, run `just web-dev` and `just geo-dev` in two terminals. Press `Ctrl+C` to stop either command.

To check a running API:

```bash
just geo-health
```

The equivalent manual setup is:

```bash
cd apps/fastapi
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8000
```

On Windows PowerShell, activate the virtual environment with:

```powershell
.venv\Scripts\Activate.ps1
```

Set `GEO_SERVICE_TOKEN` and `ALLOWED_ORIGINS` in `apps/fastapi/.env` before starting the API. The health endpoint is available at [http://localhost:8000/health](http://localhost:8000/health), and the OpenAPI interface is available at [http://localhost:8000/docs](http://localhost:8000/docs).

Set `GEO_SERVICE_URL` and `GEO_SERVICE_TOKEN` in `apps/web/.env`. Both applications must use the same token.

The TanStack server exposes these tRPC procedures:

- `geo.presets`
- `geo.heatmap`
- `geo.score`
- `geo.scoreBatch`

Run this command after a FastAPI schema change:

```bash
bun run gen:geo
```

This command exports `apps/fastapi/openapi.json`. It then updates the generated TypeScript types in `packages/api/src/geo`.

Run the FastAPI scoring and heatmap contract tests with `just geo-test`.

## Offline Data Ingestion

The repeatable ingestion pipeline lives in `pipeline/`. It downloads official source snapshots,
clips every layer to the City of Austin boundary, builds raw facts for H3 resolution 8 cells,
validates the result, and then loads it into Neon. It does not calculate final scores or hotspots.

Set up the pipeline once:

```bash
just ingest-setup
```

Add `CENSUS_API_KEY` to `pipeline/.env`. The pipeline reuses `DATABASE_URL` from `apps/web/.env` by
default; set it in `pipeline/.env` only when ingestion should target a different Neon database.
Inspect the planned sources without downloading anything:

```bash
just ingest-plan
```

Run the complete manual refresh:

```bash
just ingest
```

Downloaded files and generated outputs stay under the ignored `pipeline/data/` directory. Each run
writes a source manifest containing URLs, vintages, timestamps, sizes, and SHA-256 checksums. Use
`just ingest --refresh` when you intentionally want to replace cached source snapshots.

For safer debugging, run the stages separately:

```bash
just ingest-download
just ingest-build
just ingest-load
```

`ingest-load` refuses to change Neon if local validation fails. In Neon, a new dataset remains
inactive while its rows and provenance are inserted. The `geo_active_dataset` pointer changes in the
same transaction only after the complete dataset is present, so the application cannot observe a
partially loaded refresh.

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@wherehouse/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Deployment

### Alchemy

- Target: web on Cloudflare
- Configure provider login: `cd packages/infra && bunx alchemy login --configure`
- Dev: bun run dev
- Deploy: bun run deploy
- Destroy: bun run destroy

`alchemy login --configure` stores the selected Cloudflare, Neon, PlanetScale, and/or Prisma provider profiles under `~/.alchemy`; no provider-specific setup command is required by this scaffold.

Deploys are staged and default to a personal `dev_<username>` stage. For production, run the deploy with an explicit stage from `packages/infra`:

```bash
cd packages/infra && bunx alchemy deploy --stage production
```

### Render

Configure the FastAPI sidecar with `apps/fastapi` as its root directory.

- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Required environment variables: `GEO_SERVICE_TOKEN` and `ALLOWED_ORIGINS`

The Cloudflare deployment also creates a `geo-keep-warm` scheduled Worker. Every 10 minutes, it requests `${GEO_SERVICE_URL}/health` so the Render sidecar stays warm for demos. The schedule is configured in `packages/infra/alchemy.run.ts`.

## Project Structure

```
wherehouse/
├── apps/
│   ├── web/         # Fullstack application (React + TanStack Start)
│   └── fastapi/     # Python scoring API
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
└── pipeline/        # Manual, repeatable offline data ingestion
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run check-types`: Check TypeScript types across all apps
- `bun run gen:geo`: Export the FastAPI contract and generate TypeScript types
- `bun run db:generate`: Generate database client/types
- `bun run db:migrate`: Run database migrations
- `bun run db:studio`: Open database studio UI
