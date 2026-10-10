# ApparelFlow ERP — Cutting Operations & Gatekeeper Verification Terminal

A production-deployed full-stack ERP module for ApparelFlow, implementing the Cutting Operations & Gatekeeper Verification Terminal. The system enforces component-level verification, role-based access control, and an immutable audit trail before any cutting batch can enter the sewing queue.

**Live Application:** https://apparelflow-erp-bay.vercel.app
**Backend API:** https://apparelflow-api.onrender.com

---

## Demo Credentials

| Role | Email | Password |
|---|---|---|
| Cutting Supervisor | `supervisor@apparelflow.com` | `Supervisor123!` |
| Cutting Verifier | `verifier@apparelflow.com` | `Verifier123!` |
| Sewing Supervisor | `sewing@apparelflow.com` | `Sewing123!` |

A credential panel is visible on the login screen when `DEMO_ACCOUNTS_ENABLED=true` is set on the backend. Clicking a role fills the form and logs in instantly.

---

## Architecture

```
frontend/    Next.js 14 App Router · TypeScript · Tailwind CSS
backend/     Express · JWT · Prisma ORM · PostgreSQL (Neon)
```

- Root `/` redirects to `/login`. After authentication, `/dashboard` routes to the role-specific workspace based on the JWT-confirmed role.
- Every protected API route enforces JWT authentication and role authorization independently of the frontend. Disabled buttons and hidden tabs are UI convenience only — the server is the authority.
- The database schema uses additive migrations. No destructive operations are run in any workflow.

## Roles & Access

| Role | Capabilities | Restrictions |
|---|---|---|
| `cutting_supervisor` | Create orders, view own orders, recut rejected orders | Cannot verify, cannot see sewing queue |
| `cutting_verifier` | Record counts, approve/reject batches, view audit history | Cannot create orders, cannot see sewing queue |
| `sewing_supervisor` | View verified/in-progress batches, start assembly | Cannot see pending or rejected orders |

Role assignment lives in the database. The login response carries the DB role; `/api/auth/me` re-confirms it before the UI renders role actions.

## State Machine

```
PENDING_VERIFICATION  →  VERIFIED      all counts recorded, no RED shortages
PENDING_VERIFICATION  →  REJECTED      verifier supplies a non-empty reason
REJECTED              →  PENDING_VERIFICATION   supervisor recuts; audit history retained
VERIFIED              →  IN_PROGRESS   sewing supervisor starts assembly (once)
```

**Hard stop:** Approval is rejected server-side (422) if any component count is missing or RED. YELLOW (excess) is permitted. The approval button is also disabled on the UI, but the API enforces this independently.

## Verification Logic

| Status | Condition | Effect |
|---|---|---|
| GREEN | actual == expected | Satisfies verification |
| YELLOW | actual > expected | Recorded; batch may proceed |
| RED | actual < expected | Blocks approval |

Expected component count = `targetQty × piecesPerGarment`
Expected fabric = `targetQty × stdFabricYards` (2 d.p.)
Wastage % = `((actual − expected) / expected) × 100` (2 d.p.)

Every approval and rejection writes a server-attributed snapshot (verifier ID, timestamp, counts, wastage) to `verification_logs`. A database trigger prevents update/delete on that table.

## API Reference

All protected routes require `Authorization: Bearer <JWT>`.

| Method | Route | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Authenticate; role sourced from DB |
| `GET` | `/api/auth/me` | Authenticated | Confirm current user |
| `GET` | `/api/auth/demo-accounts` | Public (flag) | Evaluator credentials |
| `GET` | `/api/recipes` | Public | Recipes with components |
| `POST` | `/api/orders` | cutting_supervisor | Create order + expected items |
| `GET` | `/api/orders` | supervisor, verifier | Scoped list |
| `GET` | `/api/orders/:id` | supervisor, verifier | Detail (supervisor object-scoped) |
| `PATCH` | `/api/orders/:id/counts` | cutting_verifier | Record actual counts |
| `POST` | `/api/orders/:id/approve` | cutting_verifier | Approve (hard stop enforced) |
| `POST` | `/api/orders/:id/reject` | cutting_verifier | Reject with reason |
| `POST` | `/api/orders/:id/recut` | cutting_supervisor | Return to pending |
| `GET` | `/api/orders/:id/verification-history` | supervisor, verifier | Immutable audit log |
| `GET` | `/api/sewing/queue` | sewing_supervisor | VERIFIED/IN_PROGRESS only |
| `GET` | `/api/sewing/orders/:id` | sewing_supervisor | Verified order detail |
| `POST` | `/api/sewing/orders/:id/start` | sewing_supervisor | Start assembly |
| `GET` | `/api/health`, `/api/ready` | Public | Liveness + DB readiness |

## Local Setup

Requires Node.js 20+ and npm.

```sh
# Backend
cp backend/.env.example backend/.env   # fill DATABASE_URL and JWT_SECRET
cd backend
npm ci
npm run prisma:generate
npm run prisma:validate
npm run dev
```

```sh
# Frontend (separate terminal)
cp frontend/.env.example frontend/.env.local   # set NEXT_PUBLIC_API_URL=http://localhost:5000
cd frontend
npm ci
npm run dev
```

To seed demo accounts locally (non-production DB only):

```sh
cd backend
ALLOW_DEMO_SEED=true node_modules\.bin\tsx prisma/seed.js
```

## Running Tests

```sh
cd backend && npm test
cd frontend && npm test && npm run lint && npm run build
```

Backend tests run actual Express routers and JWT/role middleware against isolated in-memory fixtures. 23 tests, 0 failures. Frontend tests cover calculation, validation, and hard-stop helpers.

## Database Schema

Core entities: `users`, `recipes`, `recipe_components`, `cutting_orders`, `verification_items`, `verification_logs`.

Migrations are additive. The latest migration adds expected fabric/wastage columns, sewing start attribution, nullable JSON verification snapshots, numeric constraints, and a trigger that prevents mutation of `verification_logs`. A backfill covers existing rows.

For production: apply migrations with `prisma migrate deploy`. Never use `migrate dev` or `migrate reset` against the production database.

## Deployment Notes

- **Vercel** builds from `frontend/` with `NEXT_PUBLIC_API_URL` set to the Render API URL.
- **Render** runs the Express backend. Required env vars: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_ORIGIN` (Vercel URL), `DEMO_ACCOUNTS_ENABLED=true`.
- Build command: `npm ci --include=dev && npm run prisma:generate`
- Start command: `npm start`
