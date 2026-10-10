const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildOrderCreateData,
  calculateExpectedComponents,
  calculateFabricMetrics,
  validateOrderInput,
} = require("../src/services/orderService");

const validInput = {
  recipeId: 1,
  targetQty: 10,
  fabricRollId: "ROLL-42",
  actualFabricYds: 18.9,
};

test("validates and normalizes order input", () => {
  assert.deepEqual(validateOrderInput({ ...validInput, fabricRollId: "  ROLL-42  " }), {
    value: { ...validInput, fabricRollId: "ROLL-42" },
  });
});

test("rejects missing fields, numeric strings, fractional quantities, and server-managed fields", () => {
  assert.match(validateOrderInput({ recipeId: 1 }).error, /required/);
  assert.match(validateOrderInput({ ...validInput, targetQty: "10" }).error, /positive integer/);
  assert.match(validateOrderInput({ ...validInput, targetQty: 1.5 }).error, /positive integer/);
  assert.match(validateOrderInput({ ...validInput, actualFabricYds: "18.9" }).error, /positive number/);
  assert.match(validateOrderInput({ ...validInput, actualFabricYds: 18.999 }).error, /two decimal places/);
  assert.match(validateOrderInput({ ...validInput, status: "COMPLETED" }).error, /server-managed/);
  assert.match(validateOrderInput({ ...validInput, components: [{ expectedQty: 1 }] }).error, /unsupported fields/);
});

test("rejects invalid recipe IDs and non-positive or out-of-range quantities", () => {
  for (const recipeId of [0, -1, 1.5, "1", 2147483648]) {
    assert.match(validateOrderInput({ ...validInput, recipeId }).error, /recipeId must be a positive integer/);
  }
  for (const targetQty of [0, -1, 1.5, 2147483648]) {
    assert.match(validateOrderInput({ ...validInput, targetQty }).error, /targetQty must be a positive integer/);
  }
});

test("rejects client-supplied creator, role, expected count, and verification fields", () => {
  for (const field of ["createdById", "role", "expectedQty", "componentCounts", "verificationItems"]) {
    assert.match(validateOrderInput({ ...validInput, [field]: 1 }).error, /server-managed|unsupported fields/);
  }
});

test("rejects invalid fabric roll IDs and non-positive fabric usage", () => {
  assert.match(validateOrderInput({ ...validInput, fabricRollId: "   " }).error, /fabricRollId/);
  assert.match(validateOrderInput({ ...validInput, actualFabricYds: 0 }).error, /positive number/);
  assert.match(validateOrderInput({ ...validInput, actualFabricYds: -1 }).error, /positive number/);
  assert.match(validateOrderInput({ ...validInput, actualFabricYds: Number.NaN }).error, /positive number/);
});

test("calculates expected component counts only from recipe component multipliers", () => {
  const recipe = {
    components: [
      { id: 1, componentName: "Front Panel", piecesPerGarment: 1 },
      { id: 2, componentName: "Sleeves", piecesPerGarment: 2 },
    ],
  };

  assert.deepEqual(calculateExpectedComponents(recipe, 10), {
    expectedComponents: [
      { componentId: 1, componentName: "Front Panel", piecesPerGarment: 1, expectedQty: 10 },
      { componentId: 2, componentName: "Sleeves", piecesPerGarment: 2, expectedQty: 20 },
    ],
  });
  assert.match(calculateExpectedComponents({ components: [] }, 10).error, /no components/);
  assert.match(
    calculateExpectedComponents({ components: [{ id: 1, componentName: "Panel", piecesPerGarment: 0 }] }, 10).error,
    /invalid component quantity/
  );
  assert.match(
    calculateExpectedComponents({ components: [{ id: 1, componentName: "Panel", piecesPerGarment: 2 }] }, 2147483647).error,
    /Expected component quantity exceeds/
  );
});

test("calculates expected fabric and wastage to two decimal places", () => {
  assert.deepEqual(calculateFabricMetrics("1.80", 10, 18.9), {
    expectedFabricYds: 18,
    wastagePct: 5,
  });
  assert.equal(calculateFabricMetrics("0.00", 10, 18.9), null);
});

test("builds pending orders with authenticated creator and unverified item values", () => {
  const createData = buildOrderCreateData({
    orderNo: "CO-test",
    recipeId: 4,
    targetQty: 10,
    fabricRollId: "ROLL-42",
    actualFabricYds: 18.9,
    createdById: 7,
    expectedComponents: [
      { componentId: 12, expectedQty: 20 },
    ],
  });

  assert.equal(createData.status, "PENDING_VERIFICATION");
  assert.equal(createData.createdById, 7);
  assert.deepEqual(createData.verificationItems.create, [
    { componentId: 12, expectedQty: 20, actualQty: null, status: null },
  ]);
  assert.equal(createData.actualFabricYds, "18.90");
});