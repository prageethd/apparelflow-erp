# AI Optimization Report — ApparelFlow ERP

## 1. Tools & Prompting

AI assistance was used throughout the project with Kiro (Claude-based). The workflow was iterative: generate a structural scaffold, read the output critically, identify the gaps, then rewrite the parts that didn't meet production standards.

Tasks where AI was useful:
- Generating the initial Prisma schema and Express route structure
- Drafting boilerplate middleware (JWT extraction, role checks)
- Writing repetitive test fixture setup

Tasks that required significant human intervention:
- Enforcing correct server-side RBAC (AI defaulted to client-gated checks)
- Implementing the approval hard stop with proper transactional integrity
- Wiring the immutable audit trail correctly across re-cut cycles
- Ensuring the sewing queue was filtered at the database level, not in application code

---

## 2. Flawed / Broken AI Code

### Issue 1 — RBAC enforced on the client, not the server

The initial AI-generated order approval flow checked the user's role from the React state before allowing the form to submit. There was no corresponding server-side role check on `POST /api/orders/:id/approve`. A direct cURL request from a `cutting_supervisor` would have succeeded.

**What was wrong:** The server route accepted any authenticated user and delegated the role decision to the UI. Disabling a button is not a security boundary.

**The fix:** Added role middleware to every sensitive route. `POST /api/orders/:id/approve` now runs `requireRole('cutting_verifier')` before the handler executes. A supervisor hitting that endpoint directly gets 403. This was verified by tests that explicitly send supervisor JWTs to verifier-only endpoints.

---

### Issue 2 — Approval hard stop was a frontend-only check

The initial AI implementation checked whether any component was RED inside the React component and conditionally rendered the approve button as disabled. The API itself did not validate component statuses before approving.

**What was wrong:** Any client that bypassed the UI (Postman, cURL, browser devtools) could POST to `/approve` on an order with RED shortages and it would succeed, writing a VERIFIED status to the database. This directly violated the core business rule.

**The fix:** The approve handler now queries all `verification_items` for the order, checks that every item has an `actualQty` recorded and that none have `status = 'RED'`, and returns 422 with a clear error if the check fails. The frontend disable state is now just a UX layer on top of a server-enforced rule. Both the backend tests and manual Postman checks confirmed the API rejects RED-shortfall approvals regardless of how the request is sent.

---

### Issue 3 — Object-level authorization missing on order detail

The AI-generated `GET /api/orders/:id` handler authenticated the JWT but fetched the order by ID without checking whether the requesting supervisor owned that order. Any cutting supervisor could read another supervisor's order by guessing or iterating IDs.

**What was wrong:** Authentication (proving who you are) was confused with authorization (proving you're allowed to access this specific record). These are separate checks.

**The fix:** The detail route now checks `createdById === req.user.id` for supervisor requests before returning the order. Verifiers retain cross-order read access because their role requires it. A supervisor requesting another supervisor's order ID gets 403.

---

## 3. Human Refactoring

**Transactional audit writes:** The initial approval handler wrote the status update and the audit log in two separate database calls. If the second write failed, the order would be marked VERIFIED with no audit record. Refactored to wrap both writes in a Prisma `$transaction` so they succeed or fail together.

**Re-cut cycle audit retention:** The AI-generated recut handler deleted previous `verification_items` and `verification_logs` when resetting an order to `PENDING_VERIFICATION`. This broke the immutable audit requirement. Refactored to only reset `actualQty` and `status` on items; all historical logs are preserved and still visible in the verification history endpoint.

**Sewing queue query isolation:** The initial sewing queue endpoint fetched all orders and filtered in JavaScript. Refactored to push the `WHERE status IN ('VERIFIED', 'IN_PROGRESS')` filter into the Prisma query. This means a manipulated URL parameter or a middleware bypass cannot leak unverified orders — the database itself never returns them.

**Database-level immutability:** Added a PostgreSQL trigger on `verification_logs` that raises an exception on UPDATE or DELETE. Application-level protections can be bypassed by a developer with direct DB access; the trigger adds a second enforcement layer at the storage level.

---

## 4. Defensive Architecture

**State transitions are explicit and exhaustive.** Every status change goes through a service layer that checks the current state before applying the transition. An order can only move `PENDING_VERIFICATION → VERIFIED` if it passes the hard stop check. `VERIFIED → IN_PROGRESS` can only happen once (idempotency guard on the start endpoint). Invalid transitions return 409.

**JWT is the only source of identity for server actions.** Verifier ID, timestamps, and role attribution in audit records are always derived from `req.user` (populated by the JWT middleware), never from the request body. A client cannot claim to be a different user by sending a different `verifierId` in the payload — that field is ignored.

**Input validation rejects type coercions.** The order creation endpoint explicitly rejects string-encoded numbers (`"50"`), fractional quantities (`50.5`), negative values, and zero. These are common AI-generated test bypasses that can cause silent data corruption downstream.

**Tests use real middleware.** The integration tests mount the actual Express routers with real JWT verification and role middleware, not mocked versions. This means a test passing is evidence that the security chain actually works end-to-end, not just that the handler logic is correct in isolation.
