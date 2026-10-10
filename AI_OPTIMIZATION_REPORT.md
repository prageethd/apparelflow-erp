# AI Optimization Report

## 1. Tools & Prompting

This repository has been developed with AI-assisted coding and human review. Git commits record source changes, not whether a particular line was written by AI or a person, so authorship of individual historical defects cannot be independently attributed. This report therefore describes verifiable implementation defects and corrections, not unsupported claims about who generated them.

The work used source-first inspection of the existing Next.js App Router, Express middleware/routes, Prisma schema/migrations, tests, and Git history. Changes extend the existing APIs and models instead of replacing the stack. Validation uses the installed package scripts, Prisma schema validation/client generation, Node's built-in test runner, JavaScript syntax checks, and frontend lint/build. Production database writes and deployment are intentionally excluded from local verification.

## 2. Flawed / Broken AI Code

1. Historical `frontend/app/page.tsx` rendered a backend health-check screen as the application root. Git history shows that implementation before commit `34aee8d`; it made the deployed root look like a diagnostic page instead of the intended login flow. The current page redirects to `/login`.
2. The earlier order API in commit `82fc1a3` listed all orders for either read role and loaded detail with an unscoped `findUnique({ id })`. Authentication alone did not enforce order ownership for cutting supervisors. The current route filters supervisor lists by `createdById` and scopes detail to the authenticated creator; verifiers retain their authorized cross-order review role.
3. Seeded demo identities use fixed assessment credentials. Static demo credentials are unsafe for an unrestricted production identity system. The current login rejects those identities in production unless `DEMO_ACCOUNTS_ENABLED=true`; the credential-panel endpoint is also disabled unless that explicit flag is enabled. Production seeding separately requires `ALLOW_DEMO_SEED=true` and never overwrites an existing user.

## 3. Human Refactoring

The order workflow now persists expected fabric and wastage, derives traffic-light status from actual counts, blocks approval if a count is missing or RED, and snapshots counts/fabric/verifier attribution in a transaction. Re-cutting resets only current verification-item values and retains earlier audit snapshots. A database trigger blocks verification-log update/delete operations.

Role handling was refactored away from a client-side role switch. The login panel selects a real seeded account and the regular bcrypt login issues its JWT. The dashboard fetches `/api/auth/me` before rendering role-specific actions; protected endpoints independently enforce roles. Sewing queue list/detail SQL queries filter to verified or in-progress states.

## 4. Defensive Architecture

- Prisma changes are additive and include a backfill; no reset, drop, truncate, production seed, or migration execution is part of the code verification workflow.
- Approval, rejection, recut, count changes, and sewing start use conditional state transitions in serializable Prisma transactions. Audit identity and timestamps come from server context.
- Rejection/approval snapshots remain separate immutable history across re-cut cycles. Database-owner privileges can still disable triggers or alter data, so application controls are not presented as absolute protection from a database administrator.
- The verifier/sewing integration tests mount real Express routers with real JWT and role middleware and an isolated in-memory Prisma adapter. They validate route decisions but do not prove PostgreSQL transaction isolation, migration application, trigger behavior, cloud connectivity, or live deployment.
- Frontend helper tests cover calculations, validation, and approval-stop logic. Browser-level keyboard/dialog behavior has not been run in an end-to-end test.
