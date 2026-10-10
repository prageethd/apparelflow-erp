const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const test = require("node:test");
const createOrderRouter = require("../src/routes/orderRoutes");
const createVerificationRouter = require("../src/routes/verificationRoutes");
const createSewingRouter = require("../src/routes/sewingRoutes");

const TEST_SECRET = "workflow-route-test-secret";
const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = TEST_SECRET;

test.after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

function makeOrder(overrides = {}) {
  const recipe = {
    id: 4,
    recipeCode: "REC-BL01",
    name: "Casual Blouse",
    category: "Blouse",
    stdFabricYards: "1.80",
    wastageCap: "5.00",
  };
  const expected = [
    { id: 11, componentId: 11, expectedQty: 2, actualQty: null, status: null, component: { id: 11, componentName: "Front Body Panel", piecesPerGarment: 1 } },
    { id: 12, componentId: 12, expectedQty: 4, actualQty: null, status: null, component: { id: 12, componentName: "Sleeves (Left & Right)", piecesPerGarment: 2 } },
  ];
  return {
    id: 31,
    orderNo: "CO-test-order-31",
    recipeId: recipe.id,
    targetQty: 2,
    fabricRollId: "ROLL-TEST",
    actualFabricYds: "3.80",
    expectedFabricYds: "3.60",
    wastagePct: "5.56",
    status: "PENDING_VERIFICATION",
    createdById: 1,
    sewingStartedById: null,
    sewingStartedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    recipe,
    createdBy: { id: 1, email: "cut@example.test", fullName: "Cut Supervisor", role: "cutting_supervisor" },
    sewingStartedBy: null,
    verificationItems: expected,
    verificationLogs: [],
    ...overrides,
  };
}

function cloneOrder(order) {
  return structuredClone(order);
}

class MemoryPrisma {
  constructor(orders = [makeOrder()]) {
    this.orders = orders;
    this.logs = orders.flatMap((order) => order.verificationLogs);
    this.lastQueueWhere = null;
    this.recipe = {
      findUnique: async ({ where }) => {
        const order = this.orders.find((entry) => entry.recipeId === where.id);
        return order ? { ...cloneOrder(order.recipe), components: order.verificationItems.map((item) => ({ ...item.component })) } : null;
      },
    };
    this.cuttingOrder = {
      findUnique: async ({ where }) => cloneOrder(this.orders.find((order) => order.id === where.id) ?? null),
      findFirst: async ({ where }) => {
        const order = this.orders.find((candidate) => this.matches(candidate, where));
        if (!order) return null;
        return where.select ? { id: order.id } : cloneOrder(order);
      },
      findMany: async ({ where = {} }) => {
        this.lastQueueWhere = where;
        return this.orders.filter((order) => this.matches(order, where)).map(cloneOrder);
      },
      updateMany: async ({ where, data }) => {
        const order = this.orders.find((candidate) => this.matches(candidate, where));
        if (!order) return { count: 0 };
        Object.assign(order, data);
        return { count: 1 };
      },
      create: async ({ data }) => {
        const recipeOrder = this.orders.find((entry) => entry.recipeId === data.recipeId);
        const items = data.verificationItems.create.map((item) => {
          const component = recipeOrder.verificationItems.find((entry) => entry.componentId === item.componentId).component;
          return { id: 100 + item.componentId, ...item, componentId: item.componentId, component: { ...component } };
        });
        const order = makeOrder({
          id: Math.max(0, ...this.orders.map((entry) => entry.id)) + 1,
          ...data,
          expectedFabricYds: data.expectedFabricYds,
          wastagePct: data.wastagePct,
          createdBy: { id: data.createdById, email: "cut@example.test", fullName: "Cut Supervisor", role: "cutting_supervisor" },
          recipe: cloneOrder(recipeOrder.recipe),
          verificationItems: items,
        });
        this.orders.push(order);
        return cloneOrder(order);
      },
    };
    this.verificationItem = {
      update: async ({ where, data }) => {
        const orderId = where.orderId_componentId.orderId;
        const componentId = where.orderId_componentId.componentId;
        const item = this.orders.find((order) => order.id === orderId)?.verificationItems.find((entry) => entry.componentId === componentId);
        if (!item) throw new Error("Verification item missing");
        Object.assign(item, data);
        return cloneOrder(item);
      },
      updateMany: async ({ where, data }) => {
        const order = this.orders.find((entry) => entry.id === where.orderId);
        if (!order) return { count: 0 };
        order.verificationItems.forEach((item) => Object.assign(item, data));
        return { count: order.verificationItems.length };
      },
    };
    this.verificationLog = {
      create: async ({ data }) => {
        const log = {
          id: this.logs.length + 1,
          timestamp: new Date(),
          ...structuredClone(data),
          verifier: { id: data.verifierId, fullName: "Verifier", role: "cutting_verifier" },
        };
        this.logs.push(log);
        const order = this.orders.find((entry) => entry.id === data.orderId);
        order.verificationLogs.unshift(log);
        return structuredClone(log);
      },
    };
  }

  matches(order, where) {
    if (!order) return false;
    if (where.id !== undefined && order.id !== where.id) return false;
    if (where.createdById !== undefined && order.createdById !== where.createdById) return false;
    if (where.sewingStartedAt === null && order.sewingStartedAt !== null) return false;
    if (typeof where.status === "string" && order.status !== where.status) return false;
    if (where.status?.in && !where.status.in.includes(order.status)) return false;
    return true;
  }

  async $transaction(callback) {
    const orderSnapshot = cloneOrder(this.orders);
    const logSnapshot = cloneOrder(this.logs);
    try {
      return await callback(this);
    } catch (error) {
      this.orders = orderSnapshot;
      this.logs = logSnapshot;
      throw error;
    }
  }
}

function testUser(role) {
  const ids = { cutting_supervisor: 1, cutting_verifier: 2, sewing_supervisor: 3 };
  return {
    id: ids[role],
    email: `${role}@example.test`,
    fullName: role,
    role,
  };
}

function authHeader(role) {
  return `Bearer ${jwt.sign(testUser(role), TEST_SECRET, { expiresIn: "5m" })}`;
}

async function createTestServer(t, database) {
  const app = express();
  app.use(express.json());
  app.use("/api/orders", createOrderRouter(database));
  app.use("/api/orders", createVerificationRouter(database));
  app.use("/api/sewing", createSewingRouter(database));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(baseUrl, path, { role, method = "GET", body, authenticated = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (authenticated && role) headers.Authorization = authHeader(role);
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("real order routes persist a supervisor order and enforce create/read scopes", async (t) => {
  const database = new MemoryPrisma([
    makeOrder(),
    makeOrder({ id: 44, orderNo: "CO-other-owner", createdById: 9 }),
  ]);
  const baseUrl = await createTestServer(t, database);

  const missingAuth = await request(baseUrl, "/api/orders", { authenticated: false });
  assert.equal(missingAuth.status, 401);

  const created = await request(baseUrl, "/api/orders", {
    role: "cutting_supervisor",
    method: "POST",
    body: { recipeId: 4, targetQty: 2, fabricRollId: "ROLL-31", actualFabricYds: 3.8 },
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.data.status, "PENDING_VERIFICATION");
  assert.equal(createdBody.data.expectedFabricYds, 3.6);
  assert.equal(createdBody.data.wastagePct, 5.56);
  assert.equal(createdBody.data.createdById, 1);
  assert.deepEqual(createdBody.data.expectedComponents.map((item) => item.expectedQty), [2, 4]);

  const unknownRecipe = await request(baseUrl, "/api/orders", {
    role: "cutting_supervisor",
    method: "POST",
    body: { recipeId: 99, targetQty: 2, fabricRollId: "ROLL-UNKNOWN", actualFabricYds: 3.8 },
  });
  assert.equal(unknownRecipe.status, 404);

  const verifierCreate = await request(baseUrl, "/api/orders", {
    role: "cutting_verifier",
    method: "POST",
    body: { recipeId: 4, targetQty: 1, fabricRollId: "ROLL-X", actualFabricYds: 1.8 },
  });
  assert.equal(verifierCreate.status, 403);

  const anonymousDetail = await request(baseUrl, "/api/orders/31", { authenticated: false });
  assert.equal(anonymousDetail.status, 401);

  const listed = await request(baseUrl, "/api/orders", { role: "cutting_supervisor" });
  assert.equal(listed.status, 200);
  const supervisorOrders = (await listed.json()).data;
  assert.ok(supervisorOrders.some((order) => order.orderNo === createdBody.data.orderNo));
  assert.ok(supervisorOrders.every((order) => order.createdById === 1));

  const verifierOrders = await request(baseUrl, "/api/orders", { role: "cutting_verifier" });
  assert.equal((await verifierOrders.json()).data.length, 3);
});

test("verifier counts are server-classified and RED or missing counts block approval", async (t) => {
  const database = new MemoryPrisma();
  const baseUrl = await createTestServer(t, database);

  const forgedStatus = await request(baseUrl, "/api/orders/31/counts", {
    role: "cutting_verifier",
    method: "PATCH",
    body: { items: [{ componentId: 11, actualQty: 2, status: "GREEN" }] },
  });
  assert.equal(forgedStatus.status, 400);

  const missingCountsApproval = await request(baseUrl, "/api/orders/31/approve", {
    role: "cutting_verifier",
    method: "POST",
    body: {},
  });
  assert.equal(missingCountsApproval.status, 422);
  assert.equal(database.orders[0].status, "PENDING_VERIFICATION");
  assert.equal(database.logs.length, 0);

  const savedRed = await request(baseUrl, "/api/orders/31/counts", {
    role: "cutting_verifier",
    method: "PATCH",
    body: { items: [{ componentId: 11, actualQty: 1 }, { componentId: 12, actualQty: null }] },
  });
  assert.equal(savedRed.status, 200);
  const savedBody = await savedRed.json();
  assert.equal(savedBody.data.expectedComponents[0].status, "RED");
  assert.equal(savedBody.data.expectedComponents[1].status, null);

  const redApproval = await request(baseUrl, "/api/orders/31/approve", {
    role: "cutting_verifier",
    method: "POST",
    body: {},
  });
  assert.equal(redApproval.status, 422);
  assert.equal(database.orders[0].status, "PENDING_VERIFICATION");
  assert.equal(database.logs.length, 0);
});

test("valid approval records authenticated verifier and immutable count/fabric snapshot", async (t) => {
  const approvedOrder = makeOrder({
    verificationItems: makeOrder().verificationItems.map((item) => ({ ...item, actualQty: item.expectedQty, status: "GREEN" })),
  });
  const database = new MemoryPrisma([approvedOrder]);
  const baseUrl = await createTestServer(t, database);

  const result = await request(baseUrl, "/api/orders/31/approve", {
    role: "cutting_verifier",
    method: "POST",
    body: { verifierId: 999, timestamp: "client-time" },
  });
  assert.equal(result.status, 400);

  const approved = await request(baseUrl, "/api/orders/31/approve", {
    role: "cutting_verifier",
    method: "POST",
    body: {},
  });
  assert.equal(approved.status, 200);
  assert.equal(database.orders[0].status, "VERIFIED");
  assert.equal(database.logs.length, 1);
  assert.equal(database.logs[0].verifierId, 2);
  assert.equal(database.logs[0].decision, "APPROVED");
  assert.equal(database.logs[0].snapshot.components[0].status, "GREEN");
  assert.equal(database.logs[0].snapshot.fabric.wastagePct, 5.56);

  const repeatedApproval = await request(baseUrl, "/api/orders/31/approve", {
    role: "cutting_verifier",
    method: "POST",
    body: {},
  });
  assert.equal(repeatedApproval.status, 409);
});

test("approval and audit snapshot roll back together when audit persistence fails", async (t) => {
  const approvedOrder = makeOrder({
    verificationItems: makeOrder().verificationItems.map((item) => ({ ...item, actualQty: item.expectedQty, status: "GREEN" })),
  });
  const database = new MemoryPrisma([approvedOrder]);
  database.verificationLog.create = async () => {
    throw new Error("isolated audit write failure");
  };
  const baseUrl = await createTestServer(t, database);

  const response = await request(baseUrl, "/api/orders/31/approve", {
    role: "cutting_verifier",
    method: "POST",
    body: {},
  });
  assert.equal(response.status, 500);
  assert.equal(database.orders[0].status, "PENDING_VERIFICATION");
  assert.equal(database.logs.length, 0);
});

test("rejection requires a reason and re-cut preserves prior audit history", async (t) => {
  const database = new MemoryPrisma();
  const baseUrl = await createTestServer(t, database);

  const supervisorReject = await request(baseUrl, "/api/orders/31/reject", {
    role: "cutting_supervisor",
    method: "POST",
    body: { reason: "short" },
  });
  assert.equal(supervisorReject.status, 403);

  const sewingApprove = await request(baseUrl, "/api/orders/31/approve", {
    role: "sewing_supervisor",
    method: "POST",
    body: {},
  });
  assert.equal(sewingApprove.status, 403);

  const blankReject = await request(baseUrl, "/api/orders/31/reject", {
    role: "cutting_verifier",
    method: "POST",
    body: { reason: "   " },
  });
  assert.equal(blankReject.status, 422);

  const rejected = await request(baseUrl, "/api/orders/31/reject", {
    role: "cutting_verifier",
    method: "POST",
    body: { reason: "Front panels short" },
  });
  assert.equal(rejected.status, 200);
  assert.equal(database.orders[0].status, "REJECTED");
  assert.equal(database.logs[0].rejectionNote, "Front panels short");
  const previousSnapshot = structuredClone(database.logs[0].snapshot);

  const recut = await request(baseUrl, "/api/orders/31/recut", {
    role: "cutting_supervisor",
    method: "POST",
    body: {},
  });
  assert.equal(recut.status, 200);
  assert.equal(database.orders[0].status, "PENDING_VERIFICATION");
  assert.ok(database.orders[0].verificationItems.every((item) => item.actualQty === null && item.status === null));
  assert.equal(database.logs.length, 1);
  assert.deepEqual(database.logs[0].snapshot, previousSnapshot);

  const history = await request(baseUrl, "/api/orders/31/verification-history", { role: "cutting_supervisor" });
  assert.equal(history.status, 200);
  assert.equal((await history.json()).data[0].rejectionNote, "Front panels short");
});

test("sewing queue filters at query time and assembly start is role/state restricted", async (t) => {
  const database = new MemoryPrisma([
    makeOrder({ id: 31, status: "PENDING_VERIFICATION" }),
    makeOrder({ id: 32, status: "REJECTED" }),
    makeOrder({ id: 33, status: "VERIFIED" }),
    makeOrder({ id: 34, status: "IN_PROGRESS", sewingStartedById: 3, sewingStartedAt: new Date() }),
  ]);
  const baseUrl = await createTestServer(t, database);

  const forbidden = await request(baseUrl, "/api/sewing/queue", { role: "cutting_verifier" });
  assert.equal(forbidden.status, 403);

  const queue = await request(baseUrl, "/api/sewing/queue", { role: "sewing_supervisor" });
  assert.equal(queue.status, 200);
  assert.deepEqual((await queue.json()).data.map((order) => order.id), [33, 34]);
  assert.deepEqual(database.lastQueueWhere.status.in, ["VERIFIED", "IN_PROGRESS"]);

  const hiddenPending = await request(baseUrl, "/api/sewing/orders/31", { role: "sewing_supervisor" });
  assert.equal(hiddenPending.status, 404);
  const hiddenRejected = await request(baseUrl, "/api/sewing/orders/32", { role: "sewing_supervisor" });
  assert.equal(hiddenRejected.status, 404);

  const started = await request(baseUrl, "/api/sewing/orders/33/start", {
    role: "sewing_supervisor",
    method: "POST",
    body: {},
  });
  assert.equal(started.status, 200);
  assert.equal(database.orders.find((order) => order.id === 33).status, "IN_PROGRESS");
  assert.equal(database.orders.find((order) => order.id === 33).sewingStartedById, 3);

  const duplicateStart = await request(baseUrl, "/api/sewing/orders/33/start", {
    role: "sewing_supervisor",
    method: "POST",
    body: {},
  });
  assert.equal(duplicateStart.status, 409);
});

test("cutting supervisor detail access is object-scoped and order-number IDs are rejected", async (t) => {
  const database = new MemoryPrisma([
    makeOrder({ id: 31, createdById: 1 }),
    makeOrder({ id: 35, createdById: 9 }),
  ]);
  const baseUrl = await createTestServer(t, database);

  const own = await request(baseUrl, "/api/orders/31", { role: "cutting_supervisor" });
  assert.equal(own.status, 200);
  const other = await request(baseUrl, "/api/orders/35", { role: "cutting_supervisor" });
  assert.equal(other.status, 404);
  const orderNumber = await request(baseUrl, "/api/orders/CO-test-order-31", { role: "cutting_verifier" });
  assert.equal(orderNumber.status, 400);
});
