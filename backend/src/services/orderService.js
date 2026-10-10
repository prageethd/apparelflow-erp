const MAX_INT = 2147483647;
const MAX_FABRIC_ROLL_ID_LENGTH = 100;
const MAX_ACTUAL_FABRIC_YDS = 99999999.99;
const { OrderStatus } = require("../generated/prisma/enums.ts");

function validateOrderInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object" };
  }

  const serverManagedFields = [
    "status",
    "createdById",
    "expectedQty",
    "componentCounts",
    "verificationItems",
  ];
  if (serverManagedFields.some((field) => Object.hasOwn(body, field))) {
    return { error: "Order status, creator, and expected quantities are server-managed" };
  }

  const supportedFields = new Set([
    "recipeId",
    "targetQty",
    "fabricRollId",
    "actualFabricYds",
  ]);
  if (Object.keys(body).some((field) => !supportedFields.has(field))) {
    return { error: "Request contains unsupported fields" };
  }

  const { recipeId, targetQty, fabricRollId, actualFabricYds } = body;

  if (recipeId === undefined || targetQty === undefined || fabricRollId === undefined || actualFabricYds === undefined) {
    return { error: "recipeId, targetQty, fabricRollId, and actualFabricYds are required" };
  }
  if (!Number.isInteger(recipeId) || recipeId < 1 || recipeId > MAX_INT) {
    return { error: "recipeId must be a positive integer" };
  }
  if (!Number.isInteger(targetQty) || targetQty < 1 || targetQty > MAX_INT) {
    return { error: "targetQty must be a positive integer" };
  }
  if (typeof fabricRollId !== "string") {
    return { error: "fabricRollId must be a string" };
  }

  const normalizedFabricRollId = fabricRollId.trim();
  if (!normalizedFabricRollId || normalizedFabricRollId.length > MAX_FABRIC_ROLL_ID_LENGTH) {
    return { error: `fabricRollId must contain 1 to ${MAX_FABRIC_ROLL_ID_LENGTH} characters` };
  }
  if (
    typeof actualFabricYds !== "number" ||
    !Number.isFinite(actualFabricYds) ||
    actualFabricYds <= 0 ||
    actualFabricYds > MAX_ACTUAL_FABRIC_YDS ||
    !/^\d+(?:\.\d{1,2})?$/.test(String(actualFabricYds))
  ) {
    return {
      error: "actualFabricYds must be a positive number with at most two decimal places",
    };
  }

  return {
    value: {
      recipeId,
      targetQty,
      fabricRollId: normalizedFabricRollId,
      actualFabricYds,
    },
  };
}

function calculateExpectedComponents(recipe, targetQty) {
  if (!Array.isArray(recipe.components) || recipe.components.length === 0) {
    return { error: "Recipe has no components" };
  }

  const expectedComponents = [];
  for (const component of recipe.components) {
    if (!Number.isInteger(component.piecesPerGarment) || component.piecesPerGarment < 1) {
      return { error: "Recipe contains an invalid component quantity" };
    }

    const expectedQty = targetQty * component.piecesPerGarment;
    if (!Number.isSafeInteger(expectedQty) || expectedQty > MAX_INT) {
      return { error: "Expected component quantity exceeds the supported limit" };
    }

    expectedComponents.push({
      componentId: component.id,
      componentName: component.componentName,
      piecesPerGarment: component.piecesPerGarment,
      expectedQty,
    });
  }

  return { expectedComponents };
}

function calculateFabricMetrics(stdFabricYards, targetQty, actualFabricYds) {
  const standardYards = Number(stdFabricYards);
  if (!Number.isFinite(standardYards) || standardYards <= 0) {
    return null;
  }

  const expectedFabricYds = Number((standardYards * targetQty).toFixed(2));
  if (!Number.isFinite(expectedFabricYds) || expectedFabricYds <= 0) {
    return null;
  }

  const wastagePct = Number(
    (((actualFabricYds - expectedFabricYds) / expectedFabricYds) * 100).toFixed(2)
  );
  if (!Number.isFinite(wastagePct)) {
    return null;
  }

  return { expectedFabricYds, wastagePct };
}

function parseOrderId(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const orderId = Number(value);
  return orderId <= MAX_INT ? orderId : null;
}

function buildOrderCreateData({
  orderNo,
  recipeId,
  targetQty,
  fabricRollId,
  actualFabricYds,
  createdById,
  expectedComponents,
}) {
  return {
    orderNo,
    recipeId,
    targetQty,
    fabricRollId,
    actualFabricYds: actualFabricYds.toFixed(2),
    status: OrderStatus.PENDING_VERIFICATION,
    createdById,
    verificationItems: {
      create: expectedComponents.map((component) => ({
        componentId: component.componentId,
        expectedQty: component.expectedQty,
        actualQty: null,
        status: null,
      })),
    },
  };
}

module.exports = {
  buildOrderCreateData,
  calculateExpectedComponents,
  calculateFabricMetrics,
  parseOrderId,
  validateOrderInput,
};