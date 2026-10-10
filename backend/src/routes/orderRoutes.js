const { randomUUID } = require("node:crypto");
const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const {
  buildOrderCreateData,
  calculateExpectedComponents,
  calculateFabricMetrics,
  parseOrderId,
  validateOrderInput,
} = require("../services/orderService");
const { orderRelations, serializeOrder } = require("../services/orderPresentation");

function createOrderRouter(prismaClient) {
  const database = prismaClient || require("../config/prisma");
  const router = express.Router();
  const canReadOrders = requireRole("cutting_supervisor", "cutting_verifier");

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
    const result = await database.$transaction(async (transaction) => {
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
          expectedFabricYds: metrics.expectedFabricYds,
          wastagePct: metrics.wastagePct,
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
    const where = req.user.role === "cutting_supervisor"
      ? { createdById: req.user.id }
      : {};
    const orders = await database.cuttingOrder.findMany({
      where,
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
    const order = await database.cuttingOrder.findFirst({
      where: {
        id: orderId,
        ...(req.user.role === "cutting_supervisor" ? { createdById: req.user.id } : {}),
      },
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

  return router;
}

module.exports = createOrderRouter;