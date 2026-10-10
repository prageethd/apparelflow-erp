const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const express = require("express");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const test = require("node:test");
const createAuthRouter = require("../src/routes/authRoutes");

const TEST_SECRET = "isolated-auth-route-secret";
const previousSecret = process.env.JWT_SECRET;
const previousDemoFlag = process.env.DEMO_ACCOUNTS_ENABLED;
const previousNodeEnv = process.env.NODE_ENV;
process.env.JWT_SECRET = TEST_SECRET;
process.env.DEMO_ACCOUNTS_ENABLED = "false";
process.env.NODE_ENV = "test";

test.after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
  if (previousDemoFlag === undefined) delete process.env.DEMO_ACCOUNTS_ENABLED;
  else process.env.DEMO_ACCOUNTS_ENABLED = previousDemoFlag;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

async function authServer(t, user) {
  const database = {
    user: {
      findUnique: async ({ where }) => where.email === user.email ? { ...user } : null,
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter(database));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${server.address().port}`;
}

test("login rejects role selection and issues the account's database role in the JWT", async (t) => {
  const user = {
    id: 27,
    email: "verifier@example.test",
    fullName: "Database Verifier",
    role: "cutting_verifier",
    passwordHash: await bcrypt.hash("TestPassword!", 4),
  };
  const baseUrl = await authServer(t, user);

  const roleOverride = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: "TestPassword!", role: "sewing_supervisor" }),
  });
  assert.equal(roleOverride.status, 400);

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: "TestPassword!" }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.user.role, "cutting_verifier");
  assert.equal(payload.user.passwordHash, undefined);
  const tokenUser = jwt.verify(payload.token, TEST_SECRET);
  assert.equal(tokenUser.role, "cutting_verifier");
});

test("demo credentials are exposed only when explicitly enabled", async (t) => {
  const user = {
    id: 1,
    email: "demo@example.test",
    fullName: "Demo",
    role: "cutting_supervisor",
    passwordHash: "unused",
  };
  const baseUrl = await authServer(t, user);

  process.env.DEMO_ACCOUNTS_ENABLED = "false";
  const disabled = await fetch(`${baseUrl}/api/auth/demo-accounts`);
  assert.equal(disabled.status, 404);

  process.env.DEMO_ACCOUNTS_ENABLED = "true";
  const enabled = await fetch(`${baseUrl}/api/auth/demo-accounts`);
  assert.equal(enabled.status, 200);
  const response = await enabled.json();
  assert.deepEqual(response.data.map((account) => account.role), [
    "cutting_supervisor",
    "cutting_verifier",
    "sewing_supervisor",
  ]);
});
