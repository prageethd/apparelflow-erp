const MAX_INT = 2147483647;

function componentStatus(expectedQty, actualQty) {
  if (actualQty === null || actualQty === undefined) return null;
  if (!Number.isInteger(actualQty) || actualQty < 0 || !Number.isInteger(expectedQty) || expectedQty < 0) {
    return null;
  }
  if (actualQty === expectedQty) return "GREEN";
  return actualQty > expectedQty ? "YELLOW" : "RED";
}

function validateCountPayload(body, items) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object" };
  }
  if (Object.keys(body).some((key) => key !== "items")) {
    return { error: "Only the items field is accepted" };
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return { error: "At least one component count is required" };
  }

  const knownIds = new Set(items.map((item) => item.componentId));
  const seenIds = new Set();
  const counts = [];

  for (const entry of body.items) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { error: "Each item must be an object" };
    }
    if (Object.keys(entry).some((key) => !["componentId", "actualQty"].includes(key))) {
      return { error: "Component status and other fields are server-managed" };
    }
    if (!Number.isInteger(entry.componentId) || entry.componentId < 1 || !knownIds.has(entry.componentId)) {
      return { error: "A component ID is invalid for this order" };
    }
    if (seenIds.has(entry.componentId)) {
      return { error: "A component may appear only once in a count request" };
    }
    if (
      entry.actualQty !== null &&
      (!Number.isInteger(entry.actualQty) || entry.actualQty < 0 || entry.actualQty > MAX_INT)
    ) {
      return { error: "Actual component quantities must be non-negative integers or null" };
    }

    seenIds.add(entry.componentId);
    counts.push({
      componentId: entry.componentId,
      actualQty: entry.actualQty,
      status: componentStatus(
        items.find((item) => item.componentId === entry.componentId).expectedQty,
        entry.actualQty
      ),
    });
  }

  return { value: counts };
}

function evaluateApproval(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { allowed: false, message: "Order has no required verification items" };
  }

  const missing = items.filter((item) => item.actualQty === null || item.actualQty === undefined);
  if (missing.length > 0) {
    return { allowed: false, message: "Every required component must be counted before approval" };
  }

  const statuses = items.map((item) => componentStatus(item.expectedQty, item.actualQty));
  if (statuses.some((status) => status === null)) {
    return { allowed: false, message: "One or more component counts are invalid" };
  }
  if (statuses.includes("RED")) {
    return { allowed: false, message: "Orders with shortages cannot be approved" };
  }

  return { allowed: true, statuses };
}

function buildVerificationSnapshot(order) {
  return {
    orderId: order.id,
    orderNo: order.orderNo,
    targetQty: order.targetQty,
    recipeId: order.recipeId,
    fabric: {
      standardYardsPerGarment: Number(order.recipe.stdFabricYards),
      expectedFabricYds: Number(order.expectedFabricYds),
      actualFabricYds: Number(order.actualFabricYds),
      wastageCap: Number(order.recipe.wastageCap),
      wastagePct: Number(order.wastagePct),
    },
    components: order.verificationItems.map((item) => ({
      componentId: item.componentId,
      componentName: item.component.componentName,
      expectedQty: item.expectedQty,
      actualQty: item.actualQty,
      status: componentStatus(item.expectedQty, item.actualQty),
      variance: item.actualQty === null ? null : item.actualQty - item.expectedQty,
    })),
  };
}

function validateRejectionReason(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object" };
  }
  if (Object.keys(body).some((key) => key !== "reason")) {
    return { error: "Only a rejection reason is accepted" };
  }
  if (typeof body.reason !== "string" || !body.reason.trim()) {
    return { error: "A non-empty rejection reason is required" };
  }
  if (body.reason.trim().length > 2000) {
    return { error: "Rejection reason must be 2000 characters or fewer" };
  }
  return { value: body.reason.trim() };
}

module.exports = {
  buildVerificationSnapshot,
  componentStatus,
  evaluateApproval,
  validateCountPayload,
  validateRejectionReason,
};
