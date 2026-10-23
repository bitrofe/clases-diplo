# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Energy readings are validated on the server in `artifacts/api-server/src/lib/energy-validation.ts` (tests: `pnpm --filter @workspace/api-server run test`). An import is all-or-nothing: any issue returns 400 with `issues: [{ index, message }]` and nothing is saved.
- Rules: the date must exist (`2026-02-30` is rejected; Zod alone would turn it into 1 March) and not be later than tomorrow (UTC); kWh ≤ `ENERGY_MAX_KWH_PER_READING` (default 50000); if there is a cost, cost ÷ kWh must fall between `ENERGY_MIN_TARIFF_EUR_KWH` and `ENERGY_MAX_TARIFF_EUR_KWH` (defaults 0.05–0.60 €/kWh); no repeated equipment + date, in the file or against the database. The defaults are placeholders: set them to the facility's real equipment and tariff.
- `changePercent` is `null` (not 0) when there is no previous period to compare with; `recordsWithoutCost` tells the UI that `totalCostEur` leaves some readings out.
- CSV files separated by `;` use the European number format: `1.234,5` is 1234.5 kWh.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
