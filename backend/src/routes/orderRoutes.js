const { randomUUID } = require("node:crypto");
const express = require("express");
const prisma = require("../config/prisma");
const authenticate = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const {
  buildOrderCreateData,
  calculateExpectedComponents,
  calculateFabricMetrics,
  parseOrderId,
  validateOrderInput,
} = require("../services/orderService");

const router = express.Router();
const canReadOrders = requireRole("cutting_supervisor", "cutting_verifier");

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
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
    },
  },
  verificationItems: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      expectedQty: true,
      component: {
        select: {
          id: true,
          componentName: true,
          piecesPerGarment: true,
        },
      },
    },
  },
};

function serializeOrder(order) {
  const metrics = calculateFabricMetrics(
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
    expectedFabricYds: metrics?.expectedFabricYds ?? null,
    wastagePct: metrics?.wastagePct ?? null,
    status: order.status,
    createdById: order.createdById,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    recipe: {
      ...order.recipe,
      stdFabricYards: Number(order.recipe.stdFabricYards),
      wastageCap: Number(order.recipe.wastageCap),
    },
    createdBy: order.createdBy,
    expectedComponents: order.verificationItems.map((item) => ({
      componentId: item.component.id,
      componentName: item.component.componentName,
      piecesPerGarment: item.component.piecesPerGarment,
      expectedQty: item.expectedQty,
    })),
  };
}

router.use(authenticate);

router.post("/", requireRole("cutting_supervisor"), async (req, res) => {
  const validation = validateOrderInput(req.body);
  if (validation.error) {
    return res.status(400).json({ success: false, message: validation.error });
  }

  if (!Number.isInteger(req.user.id) || req.user.id < 1) {
    return res.status(401).json({ success: false, message: "Invalid authentication token" });
  }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const recipe = await transaction.recipe.findUnique({
        where: { id: validation.value.recipeId },
        include: {
          components: {
            orderBy: { id: "asc" },
            select: { id: true, componentName: true, piecesPerGarment: true },
          },
        },
      });

      if (!recipe) {
        return { error: { status: 404, message: "Recipe not found" } };
      }

      const expectations = calculateExpectedComponents(recipe, validation.value.targetQty);
      if (expectations.error) {
        return { error: { status: 422, message: expectations.error } };
      }

      const metrics = calculateFabricMetrics(
        recipe.stdFabricYards,
        validation.value.targetQty,
        validation.value.actualFabricYds
      );
      if (!metrics) {
        return { error: { status: 422, message: "Recipe has invalid standard fabric usage" } };
      }

      const order = await transaction.cuttingOrder.create({
        data: buildOrderCreateData({
          orderNo: `CO-${randomUUID()}`,
          recipeId: recipe.id,
          targetQty: validation.value.targetQty,
          fabricRollId: validation.value.fabricRollId,
          actualFabricYds: validation.value.actualFabricYds,
          createdById: req.user.id,
          expectedComponents: expectations.expectedComponents,
        }),
        include: orderRelations,
      });

      return { order };
    });

    if (result.error) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    return res.status(201).json({ success: true, data: serializeOrder(result.order) });
  } catch (error) {
    console.error("Cutting order creation failed");
    return res.status(500).json({
      success: false,
      message: "Unable to create cutting order",
    });
  }
});

router.get("/", canReadOrders, async (req, res) => {
  try {
    const orders = await prisma.cuttingOrder.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: orderRelations,
    });

    return res.json({ success: true, data: orders.map(serializeOrder) });
  } catch (error) {
    console.error("Cutting order listing failed");
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve cutting orders",
    });
  }
});

router.get("/:id", canReadOrders, async (req, res) => {
  const orderId = parseOrderId(req.params.id);
  if (orderId === null) {
    return res.status(400).json({ success: false, message: "Order ID must be a positive integer" });
  }

  try {
    const order = await prisma.cuttingOrder.findUnique({
      where: { id: orderId },
      include: orderRelations,
    });

    if (!order) {
      return res.status(404).json({ success: false, message: "Cutting order not found" });
    }

    return res.json({ success: true, data: serializeOrder(order) });
  } catch (error) {
    console.error("Cutting order retrieval failed");
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve cutting order",
    });
  }
});

module.exports = router;