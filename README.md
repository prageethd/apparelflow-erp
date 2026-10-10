# ApparelFlow ERP

Production Batch Verification & Sewing Queue Gate

## Tech Stack

Frontend
- Next.js
- React
- TypeScript
- Tailwind CSS

Backend
- Node.js
- Express.js
- JWT

Database
- PostgreSQL
- Prisma

## Roles

- Cutting Supervisor
- Cutting Verifier
- Sewing Supervisor

## Development

Run the frontend and backend from their respective directories:

```sh
# frontend/
npm run dev

# backend/
npm run dev
```

## Day 2 API

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | Public | Exchange email and password for a JWT and user profile. |
| `GET` | `/api/recipes` | Public | List recipes and their components. |
| `POST` | `/api/orders` | `cutting_supervisor` | Create a cutting order and server-calculated expected component items. |
| `GET` | `/api/orders` | `cutting_supervisor`, `cutting_verifier` | List persisted orders, newest first. |
| `GET` | `/api/orders/:id` | `cutting_supervisor`, `cutting_verifier` | Retrieve a persisted order by integer ID. |

Order creation sets `PENDING_VERIFICATION`, derives the creator from the JWT, and calculates expected component quantities from the selected recipe. The Supervisor form previews expected counts and fabric usage; exceeding a recipe's wastage cap warns and reports the percentage but does not block order creation because no backend acceptance rule specifies rejection. The server-calculated result is authoritative. Roles are assigned to users by the backend; the UI displays the JWT role and does not provide role switching or impersonation. Verification decisions and sewing queue behavior are not implemented.

## Backend Configuration

The backend requires `DATABASE_URL` and `JWT_SECRET`. `FRONTEND_ORIGIN` controls the allowed CORS origin and defaults to `http://localhost:3000`; `PORT` defaults to `5000` and is normally provided by the hosting service. Configure these names in the local environment or hosting dashboard; do not commit environment files or values.

## Validation

Run from `backend/`:

```sh
npm test
npm run prisma:validate
npm run prisma:generate
```

Prisma client generation is required for deployment because `src/generated/` is git-ignored. Day 2 does not change the Prisma schema, so deployment does not require a migration or production seed.

## Manual Render Deployment

The repository has no Render manifest; confirm the existing service settings in the Render dashboard before changing them. For this layout, the backend service should use root directory `backend/`, build command `npm ci --include=dev && npm run prisma:generate && npm test`, and start command `npm start`. The included dev dependencies are needed because the existing start script uses `tsx`.

Ensure the existing `DATABASE_URL`, `JWT_SECRET`, and correct `FRONTEND_ORIGIN` are available to the build/runtime as required. Do not run migrations, seed scripts, or database resets as part of this deployment. Render auto-deploy behavior depends on the service's dashboard setting and is not specified in this repository.

After manually deploying, check `GET /api/health` and `GET /api/recipes` return `200`. Check unauthenticated `GET /api/orders` returns `401`; then use an authorized Supervisor token to check `GET /api/orders` returns `200`. Use an existing order ID to check `GET /api/orders/:id`; do not create a production test order solely for smoke testing. Deployment is not complete until these hosted checks succeed.