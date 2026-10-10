# ApparelFlow ERP

ApparelFlow manages apparel cutting orders, component verification, immutable verification history, and the handoff of verified batches to sewing.

## Architecture

- `frontend/`: Next.js App Router, React, TypeScript, Tailwind CSS. The root route redirects to `/login`; `/dashboard` selects the workspace from the server-confirmed user role.
- `backend/src/`: Express API, JWT authentication, role middleware, route handlers, and workflow services.
- `backend/prisma/`: PostgreSQL schema, additive migrations, and an idempotent seed script.
- `backend/test/`: Node built-in unit and HTTP route integration tests using isolated in-memory persistence; no production database is used.
- `frontend/test/`: Node built-in tests for shared frontend calculations and validation.

## Roles

| Role | Allowed workflow |
| --- | --- |
| `cutting_supervisor` | Create and view own orders, see rejection history, and return rejected orders for re-cutting. Cannot verify or access sewing. |
| `cutting_verifier` | View orders, record actual component counts, approve eligible batches, reject with a required reason, and view audit history. Cannot create orders or access sewing. |
| `sewing_supervisor` | Query only verified/in-progress sewing batches, review counts/fabric/audit history, and start assembly once. Cannot access pending/rejected orders. |

There is no client role switch or impersonation. The login response role comes from the database; `/api/auth/me` confirms the current account before the UI exposes role actions. Every protected API also enforces JWT and role checks.

## Local Setup

Use Node.js 20 or newer and npm. Copy `backend/.env.example` to the ignored `backend/.env` for local development and fill values locally; create ignored `frontend/.env.local` for frontend settings. Never commit either file. The backend requires `DATABASE_URL` and `JWT_SECRET`. `PORT` defaults to `5000`. `FRONTEND_ORIGIN` is a comma-separated exact-origin allowlist and defaults to `http://localhost:3000`. The frontend uses `NEXT_PUBLIC_API_URL` and defaults to `http://localhost:5000`. `DEMO_ACCOUNTS_ENABLED=true` explicitly enables the visible credential panel/API; keep it false unless using a non-sensitive evaluator environment. `ALLOW_DEMO_SEED=true` is required to run the seed script under `NODE_ENV=production`; do not enable it for routine production deployment.

Install dependencies and generate the Prisma client:

```sh
cd backend
npm ci
npm run prisma:generate
npm run prisma:validate
```

Then run the applications in separate terminals:

```sh
cd backend
npm run dev
```

```sh
cd frontend
npm ci
npm run dev
```

Set `NEXT_PUBLIC_API_URL` for the frontend build to the API origin. For production, set backend `FRONTEND_ORIGIN` to the deployed Vercel origin (and any required preview/local origins). Environment values belong in local ignored files or the hosting secret/settings interface, never source control.

## Demo Accounts

The idempotent seed creates missing accounts only and hashes passwords with bcrypt. Existing users are not modified. For a **local/non-production assessment database only**, `npm run prisma:seed` provides:

| Role | Email | Password |
| --- | --- | --- |
| Cutting Supervisor | `supervisor@apparelflow.com` | `Supervisor123!` |
| Cutting Verifier | `verifier@apparelflow.com` | `Verifier123!` |
| Sewing Supervisor | `sewing@apparelflow.com` | `Sewing123!` |

The visible login demo panel is served by `GET /api/auth/demo-accounts` only when backend `DEMO_ACCOUNTS_ENABLED=true`. It fills the normal login form; the normal bcrypt login still issues the JWT. This intentionally reveals demo credentials to anyone who can reach the API while enabled. Do not enable it for a database containing real users or sensitive data. In production, demo seed execution is blocked unless `ALLOW_DEMO_SEED=true`; do not set that flag for routine deployments. For local initialization only, first confirm `DATABASE_URL` points to an isolated development database, then run `cd backend && npm run prisma:seed`. The seed preserves existing accounts and recipes and must never be used as a substitute for a reviewed production data operation.

## Order and Verification Rules

Expected component quantity is `targetQty × piecesPerGarment`. Expected fabric is `targetQty × stdFabricYards`, rounded to 2 decimal places; wastage is `((actual - expected) / expected) × 100`, also rounded to 2 decimals. Exceeding a recipe cap warns and records the percentage but does not block order creation because the checked-in assessment requirements do not define an over-cap rejection rule.

Workflow transitions:

```text
PENDING_VERIFICATION -> VERIFIED       all counts recorded, no RED shortages
PENDING_VERIFICATION -> REJECTED       verifier supplies a non-empty reason
REJECTED -> PENDING_VERIFICATION       order creator returns it for re-cut; old audit remains
VERIFIED -> IN_PROGRESS                sewing supervisor starts assembly once
```

GREEN means exact, YELLOW means excess, RED means shortage, and uncounted remains unset. Approval is hard-blocked server-side for missing or RED counts; YELLOW is allowed. Every approval/rejection stores a server-attributed snapshot and timestamp. The database migration installs a trigger preventing update/delete of verification logs. A database owner can still disable triggers or alter data; application-level and trigger protections are not a substitute for restricted database privileges and backups.

## API Overview

All protected routes require `Authorization: Bearer <JWT>`.

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | Public | Authenticate email/password; role is loaded from the user record. |
| `GET` | `/api/auth/me` | Authenticated | Return the current database user without sensitive fields. |
| `GET` | `/api/auth/demo-accounts` | Public, demo flag only | Return evaluator credentials only when explicitly enabled. |
| `GET` | `/api/recipes` | Public | Recipes and recipe components. |
| `POST` | `/api/orders` | Cutting supervisor | Create order and expected items transactionally. |
| `GET` | `/api/orders` | Cutting supervisor, verifier | Supervisor sees own orders; verifier sees verification work/history. |
| `GET` | `/api/orders/:id` | Cutting supervisor, verifier | Integer database ID; supervisor is object-scoped to own order. |
| `PATCH` | `/api/orders/:id/counts` | Cutting verifier | Save actual counts; status is recomputed server-side. |
| `POST` | `/api/orders/:id/approve` | Cutting verifier | Approve only when all counts exist and none are RED. |
| `POST` | `/api/orders/:id/reject` | Cutting verifier | Reject with a required reason and audit snapshot. |
| `POST` | `/api/orders/:id/recut` | Cutting supervisor | Return own rejected order to pending while retaining history. |
| `GET` | `/api/orders/:id/verification-history` | Cutting supervisor, verifier | Read immutable history. |
| `GET` | `/api/sewing/queue` | Sewing supervisor | Database query returns only VERIFIED/IN_PROGRESS rows. |
| `GET` | `/api/sewing/orders/:id` | Sewing supervisor | Details only for verified/in-progress orders. |
| `POST` | `/api/sewing/orders/:id/start` | Sewing supervisor | Start eligible assembly with authenticated attribution. |
| `GET` | `/api/health`, `/api/ready` | Public | Liveness and read-only database readiness. |

## Tests and Validation

Run from the respective package directories:

```sh
cd backend
npm test
npm run prisma:validate
```

```sh
cd frontend
npm test
npm run lint
npm run build
```

Backend route tests run the actual Express routers and JWT/role middleware against isolated in-memory transactional fixtures. They do not verify PostgreSQL-specific locking, trigger behavior, migrations, or production connectivity. Frontend tests cover shared validation/calculation/hard-stop helpers; dialog and browser interactions have not been automated.

## Database Changes

The new migration is additive: it persists expected fabric/wastage, sewing start attribution, and nullable JSON verification snapshots; backfills existing orders; adds numeric constraints and a trigger that prevents verification-log mutation. It does not delete or reseed rows. Review and back up before applying through the approved deployment process. Do not run `migrate reset`, production seed, or destructive SQL. For production, use the existing Neon database and apply reviewed migrations with `prisma migrate deploy`; never use `migrate dev` against production.

## Deployment

The repository does not define a Render or Vercel manifest. Preserve the existing services. Backend build must install development tools and generate the ignored Prisma client, for example `npm ci --include=dev && npm run prisma:generate && npm test`; start with `npm start`. Vercel must build from `frontend/` with `NEXT_PUBLIC_API_URL` configured before build. Verify Render dashboard root/build/start and auto-deploy settings rather than assuming them.

After manually deploying the additive migration and backend, smoke-check `/api/health`, `/api/ready`, `/api/recipes`, unauthenticated `GET /api/orders` (401), and authenticated role-specific order/verification/sewing endpoints. Do not create production test orders or claim deployment until hosted checks actually pass. Existing production URLs: Vercel `https://apparelflow-erp-bay.vercel.app` and Render `https://apparelflow-api.onrender.com`.

## Limitations

No authenticated production/database integration or browser end-to-end test has been run here. A role’s visibility is UI convenience only; backend policies remain authoritative. The sewing workflow currently starts assembly but does not implement completion. Demo accounts are intentionally weak and must remain confined to a non-sensitive demo environment.