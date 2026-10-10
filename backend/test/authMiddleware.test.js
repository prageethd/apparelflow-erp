const assert = require("node:assert/strict");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const authenticate = require("../src/middleware/authMiddleware");
const requireRole = require("../src/middleware/roleMiddleware");

function invokeMiddleware(middleware, request) {
  let statusCode;
  let responseBody;
  let nextCalled = false;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };

  middleware(request, response, () => {
    nextCalled = true;
  });

  return { statusCode, responseBody, nextCalled };
}

test("authentication rejects missing and invalid bearer tokens with 401", () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-only-jwt-secret";

  try {
    const missing = invokeMiddleware(authenticate, { headers: {} });
    assert.equal(missing.statusCode, 401);
    assert.equal(missing.nextCalled, false);

    const invalid = invokeMiddleware(authenticate, {
      headers: { authorization: "Bearer invalid-token" },
    });
    assert.equal(invalid.statusCode, 401);
    assert.equal(invalid.nextCalled, false);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
  }
});

test("authentication verifies a valid bearer token and sets the JWT user", () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-only-jwt-secret";

  try {
    const user = {
      id: 7,
      email: "supervisor@example.test",
      role: "cutting_supervisor",
      fullName: "Test Supervisor",
    };
    const token = jwt.sign(user, process.env.JWT_SECRET);
    const request = { headers: { authorization: `Bearer ${token}` } };
    const result = invokeMiddleware(authenticate, request);

    assert.equal(result.nextCalled, true);
    assert.equal(request.user.id, user.id);
    assert.equal(request.user.email, user.email);
    assert.equal(request.user.role, user.role);
    assert.equal(request.user.fullName, user.fullName);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
  }
});

test("role middleware returns 401 without a user and 403 for a disallowed role", () => {
  const middleware = requireRole("cutting_supervisor");
  const missingUser = invokeMiddleware(middleware, {});
  assert.equal(missingUser.statusCode, 401);
  assert.equal(missingUser.nextCalled, false);

  const disallowed = invokeMiddleware(middleware, {
    user: { id: 8, role: "cutting_verifier" },
  });
  assert.equal(disallowed.statusCode, 403);
  assert.equal(disallowed.nextCalled, false);
});

test("role middleware allows a cutting supervisor", () => {
  const result = invokeMiddleware(requireRole("cutting_supervisor"), {
    user: { id: 7, role: "cutting_supervisor" },
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.statusCode, undefined);
});
