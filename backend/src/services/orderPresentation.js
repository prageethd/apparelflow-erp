const { calculateFabricMetrics } = require("./orderService");
const { buildVerificationSnapshot } = require("./workflowService");

const orderRelations = {
  recipe: {
    select: {
      id: true,
      recipeCode: true,
      name: true,
      category: true,
      stdFabricYards: true,
      wastageCap: true,
    },
  },
  createdBy: {
    select: { id: true, email: true, fullName: true, role: true },
  },
  sewingStartedBy: {
    select: { id: true, email: true, fullName: true, role: true },
  },
  verificationItems: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      componentId: true,
      expectedQty: true,
      actualQty: true,
      status: true,
      component: {
        select: { id: true, componentName: true, piecesPerGarment: true },
      },
    },
  },
  verificationLogs: {
    orderBy: { timestamp: "desc" },
    select: {
      id: true,
      decision: true,
      rejectionNote: true,
      wastagePct: true,
      snapshot: true,
      timestamp: true,
      verifier: {
        select: { id: true, fullName: true, role: true },
      },
    },
  },
};

function serializeOrder(order) {
  const calculated = calculateFabricMetrics(
    order.recipe.stdFabricYards,
    order.targetQty,
    Number(order.actualFabricYds)
  );

  return {
    id: order.id,
    orderNo: order.orderNo,
    recipeId: order.recipeId,
    targetQty: order.targetQty,
    fabricRollId: order.fabricRollId,
    actualFabricYds: Number(order.actualFabricYds),
    expectedFabricYds: Number(order.expectedFabricYds ?? calculated?.expectedFabricYds),
    wastagePct: Number(order.wastagePct ?? calculated?.wastagePct),
    status: order.status,
    createdById: order.createdById,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    sewingStartedAt: order.sewingStartedAt,
    recipe: {
      ...order.recipe,
      stdFabricYards: Number(order.recipe.stdFabricYards),
      wastageCap: Number(order.recipe.wastageCap),
    },
    createdBy: order.createdBy,
    sewingStartedBy: order.sewingStartedBy ?? null,
    expectedComponents: order.verificationItems.map((item) => ({
      componentId: item.component.id,
      componentName: item.component.componentName,
      piecesPerGarment: item.component.piecesPerGarment,
      expectedQty: item.expectedQty,
      actualQty: item.actualQty,
      status: item.status,
    })),
    verificationHistory: order.verificationLogs.map((log) => ({
      id: log.id,
      decision: log.decision,
      rejectionNote: log.rejectionNote,
      wastagePct: log.wastagePct === null ? null : Number(log.wastagePct),
      snapshot: log.snapshot,
      timestamp: log.timestamp,
      verifier: log.verifier,
    })),
  };
}

function snapshotForOrder(order) {
  return buildVerificationSnapshot(order);
}

module.exports = { orderRelations, serializeOrder, snapshotForOrder };
