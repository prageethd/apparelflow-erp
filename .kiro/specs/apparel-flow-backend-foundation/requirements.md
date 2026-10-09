# Requirements Document

## Introduction

ApparelFlow Backend Foundation establishes the core Express.js API server, Prisma ORM integration, database seeding, authentication, and role-based access control (RBAC) that all future ApparelFlow features will build upon. The backend runs on port 5000 and serves a Next.js frontend on port 3000. The system manages users with three roles (cutting_supervisor, cutting_verifier, sewing_supervisor), garment recipes with components, and exposes a JWT-secured REST API.

## Glossary

- **API_Server**: The Express.js application running on port 5000
- **Prisma_Client**: The ORM instance used to communicate with the PostgreSQL database
- **Auth_Middleware**: The middleware that verifies JWT tokens on protected routes
- **Role_Middleware**: The middleware that enforces role-based access control
- **Seeder**: The script that populates the database with initial users and recipes
- **JWT**: JSON Web Token used to authenticate API requests
- **Recipe**: A garment template containing a code, name, category, standard fabric yards, wastage cap, and a set of components
- **Recipe_Component**: A named piece of a garment with a specified count per garment
- **User**: An authenticated system user with an email, hashed password, full name, and role
- **Role**: One of `cutting_supervisor`, `cutting_verifier`, or `sewing_supervisor`
- **Health_Endpoint**: The `GET /api/health` route used to verify the API is running

---

## Requirements

### Requirement 1: API Server Initialization

**User Story:** As a developer, I want the Express API server to start and expose a health check endpoint, so that I can verify the backend is running before integrating with the frontend.

#### Acceptance Criteria

1. THE API_Server SHALL listen on the port defined by the `PORT` environment variable, defaulting to `5000`.
2. WHEN a `GET /api/health` request is received, THE API_Server SHALL respond with HTTP 200 and the JSON body `{ "success": true, "message": "ApparelFlow API is running" }`.
3. THE API_Server SHALL parse incoming JSON request bodies.
4. THE API_Server SHALL include CORS headers permitting requests from the origin defined by the `FRONTEND_URL` environment variable.
5. IF an unhandled error occurs during request processing, THEN THE API_Server SHALL respond with HTTP 500 and a JSON error body without exposing internal stack traces.

---

### Requirement 2: Database Connectivity via Prisma

**User Story:** As a developer, I want a shared Prisma client instance available throughout the application, so that all modules can query the database through a single managed connection.

#### Acceptance Criteria

1. THE Prisma_Client SHALL be instantiated once and exported as a singleton module from `backend/src/config/prisma.js`.
2. WHEN a database query is executed, THE Prisma_Client SHALL use the connection string defined in the `DATABASE_URL` environment variable.
3. IF the database is unreachable at startup, THEN THE API_Server SHALL log the connection error and exit with a non-zero status code.

---

### Requirement 3: Database Seeding

**User Story:** As a developer, I want an idempotent seed script that creates initial users and recipes, so that the development environment has consistent baseline data.

#### Acceptance Criteria

1. WHEN the seed script is executed, THE Seeder SHALL create exactly three User records with the emails `supervisor@apparelflow.com`, `verifier@apparelflow.com`, and `sewing@apparelflow.com`.
2. WHEN the seed script is executed, THE Seeder SHALL store each user's password as a bcrypt hash with a cost factor of 10.
3. WHEN the seed script is executed, THE Seeder SHALL assign roles `cutting_supervisor`, `cutting_verifier`, and `sewing_supervisor` to the three users respectively.
4. WHEN the seed script is executed, THE Seeder SHALL create a Recipe with code `REC-BL01`, name `Casual Blouse`, category `Blouse`, `stdFabricYards` of `1.8`, and `wastageCap` of `5.0`, with 5 associated Recipe_Component records.
5. WHEN the seed script is executed, THE Seeder SHALL create a Recipe with code `REC-CT02`, name `Crop Top`, category `Crop Top`, `stdFabricYards` of `1.1`, and `wastageCap` of `8.0`, with 5 associated Recipe_Component records.
6. IF the seed script encounters a database error, THEN THE Seeder SHALL log the error to stderr and exit with a non-zero status code.
7. WHEN the seed script completes successfully, THE Seeder SHALL log a confirmation message to stdout.

---

### Requirement 4: JWT Authentication Middleware

**User Story:** As a developer, I want JWT authentication middleware that protects API routes, so that only authenticated users can access secured endpoints.

#### Acceptance Criteria

1. WHEN a request includes an `Authorization` header with the value `Bearer <token>`, THE Auth_Middleware SHALL verify the token using the secret defined in the `JWT_SECRET` environment variable.
2. WHEN token verification succeeds, THE Auth_Middleware SHALL set `req.user` to the decoded token payload and pass control to the next middleware.
3. IF the `Authorization` header is absent or does not follow the `Bearer <token>` format, THEN THE Auth_Middleware SHALL respond with HTTP 401 and a JSON body containing a descriptive error message.
4. IF the token signature is invalid or the token has expired, THEN THE Auth_Middleware SHALL respond with HTTP 401 and a JSON body containing a descriptive error message.

---

### Requirement 5: Role-Based Access Control Middleware

**User Story:** As a developer, I want role-based access control middleware, so that I can restrict routes to users with specific roles.

#### Acceptance Criteria

1. THE Role_Middleware SHALL export a `requireRole(...allowedRoles)` factory function that returns an Express middleware function.
2. WHEN the returned middleware is invoked and `req.user` is not set, THE Role_Middleware SHALL respond with HTTP 401 and a JSON body containing a descriptive error message.
3. WHEN the returned middleware is invoked and `req.user.role` is not included in `allowedRoles`, THE Role_Middleware SHALL respond with HTTP 403 and a JSON body containing a descriptive error message.
4. WHEN the returned middleware is invoked and `req.user.role` is included in `allowedRoles`, THE Role_Middleware SHALL pass control to the next middleware.

---

### Requirement 6: Login API Endpoint

**User Story:** As a user, I want to log in with my email and password, so that I can receive a JWT and access protected features.

#### Acceptance Criteria

1. WHEN a `POST /api/auth/login` request is received with a JSON body containing `email` and `password`, THE API_Server SHALL look up the User record by email.
2. IF no User record exists for the provided email, THEN THE API_Server SHALL respond with HTTP 401 and a generic error message that does not reveal whether the email exists.
3. WHEN a matching User record is found, THE API_Server SHALL compare the provided password against the stored `passwordHash` using bcrypt.
4. IF the bcrypt comparison fails, THEN THE API_Server SHALL respond with HTTP 401 and the same generic error message used for unknown emails.
5. WHEN authentication succeeds, THE API_Server SHALL sign a JWT containing the user's `id`, `email`, `role`, and `fullName` using the `JWT_SECRET` environment variable.
6. WHEN authentication succeeds, THE API_Server SHALL respond with HTTP 200 and a JSON body containing the signed JWT and the user's `id`, `email`, `role`, and `fullName`.
7. IF the request body is missing `email` or `password`, THEN THE API_Server SHALL respond with HTTP 400 and a JSON body describing the missing fields.

---

### Requirement 7: Frontend–Backend Integration Configuration

**User Story:** As a developer, I want the frontend configured to communicate with the backend API, so that Next.js pages can make authenticated requests to Express.

#### Acceptance Criteria

1. THE API_Server SHALL include CORS configuration that permits requests originating from `http://localhost:3000` during local development.
2. THE API_Server SHALL accept and respond with `Content-Type: application/json` on all API routes.
3. WHEN the frontend sends a request to `NEXT_PUBLIC_API_URL`, the value `http://localhost:5000` SHALL be the base URL used to reach the API_Server.
