const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const { orderRelations, serializeOrder } = require("../services/orderPresentation");
const { parseOrderId } = require("../services/orderService");

const ELIGIBLE_SEWING_STATUSES = ["VERIFIED", "IN_PROGRESS"];

function createSewingRouter(prismaClient) {
  const database = prismaClient || require("../config/prisma");
  const router = express.Router();
  router.use(authenticate, requireRole("sewing_supervisor"));

  router.get("/queue", async (req, res) => {
    try {
      const orders = await database.cuttingOrder.findMany({
        where: { status: { in: ELIGIBLE_SEWING_STATUSES } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        include: orderRelations,
      });
      return res.json({ success: true, data: orders.map(serializeOrder) });
    } catch (error) {
      console.error("Sewing queue lookup failed");
      return res.status(500).json({ success: false, message: "Unable to retrieve sewing queue" });
    }
  });

  router.get("/orders/:id", async (req, res) => {
    const orderId = parseOrderId(req.params.id);
    if (orderId === null) {
      return res.status(400).json({ success: false, message: "Order ID must be a positive integer" });
    }

    try {
      const order = await database.cuttingOrder.findFirst({
        where: { id: orderId, status: { in: ELIGIBLE_SEWING_STATUSES } },
        include: orderRelations,
      });
      if (!order) {
        return res.status(404).json({ success: false, message: "Eligible sewing order not found" });
      }
      return res.json({ success: true, data: serializeOrder(order) });
    } catch (error) {
      console.error("Sewing order lookup failed");
      return res.status(500).json({ success: false, message: "Unable to retrieve sewing order" });
    }
  });

  router.post("/orders/:id/start", async (req, res) => {
    const orderId = parseOrderId(req.params.id);
    if (orderId === null) {
      return res.status(400).json({ success: false, message: "Order ID must be a positive integer" });
    }
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length > 0) {
      return res.status(400).json({ success: false, message: "Assembly start requests do not accept client-supplied fields" });
    }

    try {
      const order = await database.$transaction(async (transaction) => {
        const transition = await transaction.cuttingOrder.updateMany({
          where: { id: orderId, status: "VERIFIED", sewingStartedAt: null },
          data: {
            status: "IN_PROGRESS",
            sewingStartedById: req.user.id,
            sewingStartedAt: new Date(),
            updatedAt: new Date(),
          },
        });
        if (transition.count !== 1) {
          const eligible = await transaction.cuttingOrder.findFirst({
            where: { id: orderId, status: { in: ELIGIBLE_SEWING_STATUSES } },
            select: { id: true },
          });
          return eligible
            ? { error: { status: 409, message: "Assembly has already started or the order state changed" } }
            : { error: { status: 404, message: "Eligible sewing order not found" } };
        }
        return transaction.cuttingOrder.findUnique({
          where: { id: orderId },
          include: orderRelations,
        });
      }, { isolationLevel: "Serializable" });

      if (order.error) {
        return res.status(order.error.status).json({ success: false, message: order.error.message });
      }
      return res.json({ success: true, data: serializeOrder(order) });
    } catch (error) {
      if (error.code === "P2034") {
        return res.status(409).json({ success: false, message: "Concurrent assembly update; reload and try again" });
      }
      console.error("Sewing assembly start failed");
      return res.status(500).json({ success: false, message: "Unable to start sewing assembly" });
    }
  });

  return router;
}

module.exports = createSewingRouter;
module.exports.ELIGIBLE_SEWING_STATUSES = ELIGIBLE_SEWING_STATUSES;
