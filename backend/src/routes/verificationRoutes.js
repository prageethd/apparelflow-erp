const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const { orderRelations, serializeOrder, snapshotForOrder } = require("../services/orderPresentation");
const { parseOrderId } = require("../services/orderService");
const {
  componentStatus,
  evaluateApproval,
  validateCountPayload,
  validateRejectionReason,
} = require("../services/workflowService");

function createVerificationRouter(prismaClient) {
  const database = prismaClient || require("../config/prisma");
  const router = express.Router();
  router.use(authenticate);

  async function getOrder(transaction, orderId, user) {
    return transaction.cuttingOrder.findFirst({
      where: {
        id: orderId,
        ...(user.role === "cutting_supervisor" ? { createdById: user.id } : {}),
      },
      include: orderRelations,
    });
  }

  function sendError(res, status, message) {
    return res.status(status).json({ success: false, message });
  }

  router.patch("/:id/counts", requireRole("cutting_verifier"), async (req, res) => {
    const orderId = parseOrderId(req.params.id);
    if (orderId === null) return sendError(res, 400, "Order ID must be a positive integer");

    try {
      const order = await database.cuttingOrder.findUnique({
        where: { id: orderId },
        include: { verificationItems: true },
      });
      if (!order) return sendError(res, 404, "Cutting order not found");
      if (order.status !== "PENDING_VERIFICATION") {
        return sendError(res, 409, "Only pending orders can be counted");
      }

      const validated = validateCountPayload(req.body, order.verificationItems);
      if (validated.error) return sendError(res, 400, validated.error);

      const updated = await database.$transaction(async (transaction) => {
        const state = await transaction.cuttingOrder.updateMany({
          where: { id: orderId, status: "PENDING_VERIFICATION" },
          data: { updatedAt: new Date() },
        });
        if (state.count !== 1) {
          const error = new Error("Order state changed; reload before saving counts");
          error.status = 409;
          throw error;
        }

        for (const count of validated.value) {
          await transaction.verificationItem.update({
            where: {
              orderId_componentId: {
                orderId,
                componentId: count.componentId,
              },
            },
            data: { actualQty: count.actualQty, status: count.status },
          });
        }

        return transaction.cuttingOrder.findUnique({
          where: { id: orderId },
          include: orderRelations,
        });
      }, { isolationLevel: "Serializable" });

      return res.json({ success: true, data: serializeOrder(updated) });
    } catch (error) {
      if (error.status === 409 || error.code === "P2034") {
        return sendError(res, 409, error.message || "Order changed; reload before saving counts");
      }
      console.error("Verification counts could not be saved");
      return sendError(res, 500, "Unable to save component counts");
    }
  });

  router.post("/:id/approve", requireRole("cutting_verifier"), async (req, res) => {
    const orderId = parseOrderId(req.params.id);
    if (orderId === null) return sendError(res, 400, "Order ID must be a positive integer");
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length > 0) {
      return sendError(res, 400, "Approval requests do not accept client-supplied fields");
    }

    try {
      const approved = await database.$transaction(async (transaction) => {
        const order = await transaction.cuttingOrder.findUnique({
          where: { id: orderId },
          include: orderRelations,
        });
        if (!order) return { error: { status: 404, message: "Cutting order not found" } };
        if (order.status !== "PENDING_VERIFICATION") {
          return { error: { status: 409, message: "Only pending orders can be approved" } };
        }

        const evaluation = evaluateApproval(order.verificationItems);
        if (!evaluation.allowed) {
          return { error: { status: 422, message: evaluation.message } };
        }

        const transition = await transaction.cuttingOrder.updateMany({
          where: { id: orderId, status: "PENDING_VERIFICATION" },
          data: { status: "VERIFIED", updatedAt: new Date() },
        });
        if (transition.count !== 1) {
          return { error: { status: 409, message: "Order state changed; reload before approving" } };
        }

        await transaction.verificationLog.create({
          data: {
            orderId,
            verifierId: req.user.id,
            decision: "APPROVED",
            rejectionNote: null,
            wastagePct: order.wastagePct,
            snapshot: snapshotForOrder(order),
          },
        });

        return {
          order: await transaction.cuttingOrder.findUnique({
            where: { id: orderId },
            include: orderRelations,
          }),
        };
      }, { isolationLevel: "Serializable" });

      if (approved.error) return sendError(res, approved.error.status, approved.error.message);
      return res.json({ success: true, data: serializeOrder(approved.order) });
    } catch (error) {
      if (error.code === "P2034") return sendError(res, 409, "Concurrent order update; reload and try again");
      console.error("Order approval failed");
      return sendError(res, 500, "Unable to approve order");
    }
  });

  router.post("/:id/reject", requireRole("cutting_verifier"), async (req, res) => {
    const orderId = parseOrderId(req.params.id);
    if (orderId === null) return sendError(res, 400, "Order ID must be a positive integer");
    const reason = validateRejectionReason(req.body);
    if (reason.error) return sendError(res, 422, reason.error);

    try {
      const rejected = await database.$transaction(async (transaction) => {
        const order = await transaction.cuttingOrder.findUnique({
          where: { id: orderId },
          include: orderRelations,
        });
        if (!order) return { error: { status: 404, message: "Cutting order not found" } };
        if (order.status !== "PENDING_VERIFICATION") {
          return { error: { status: 409, message: "Only pending orders can be rejected" } };
        }

        const transition = await transaction.cuttingOrder.updateMany({
          where: { id: orderId, status: "PENDING_VERIFICATION" },
          data: { status: "REJECTED", updatedAt: new Date() },
        });
        if (transition.count !== 1) {
          return { error: { status: 409, message: "Order state changed; reload before rejecting" } };
        }

        await transaction.verificationLog.create({
          data: {
            orderId,
            verifierId: req.user.id,
            decision: "REJECTED",
            rejectionNote: reason.value,
            wastagePct: order.wastagePct,
            snapshot: snapshotForOrder(order),
          },
        });

        return {
          order: await transaction.cuttingOrder.findUnique({
            where: { id: orderId },
            include: orderRelations,
          }),
        };
      }, { isolationLevel: "Serializable" });

      if (rejected.error) return sendError(res, rejected.error.status, rejected.error.message);
      return res.json({ success: true, data: serializeOrder(rejected.order) });
    } catch (error) {
      if (error.code === "P2034") return sendError(res, 409, "Concurrent order update; reload and try again");
      console.error("Order rejection failed");
      return sendError(res, 500, "Unable to reject order");
    }
  });

  router.post("/:id/recut", requireRole("cutting_supervisor"), async (req, res) => {
    const orderId = parseOrderId(req.params.id);
    if (orderId === null) return sendError(res, 400, "Order ID must be a positive integer");
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length > 0) {
      return sendError(res, 400, "Re-cut requests do not accept client-supplied fields");
    }

    try {
      const order = await database.$transaction(async (transaction) => {
        const transition = await transaction.cuttingOrder.updateMany({
          where: {
            id: orderId,
            createdById: req.user.id,
            status: "REJECTED",
          },
          data: { status: "PENDING_VERIFICATION", updatedAt: new Date() },
        });
        if (transition.count !== 1) {
          const exists = await transaction.cuttingOrder.findFirst({
            where: { id: orderId, createdById: req.user.id },
            select: { id: true },
          });
          return exists
            ? { error: { status: 409, message: "Only your rejected orders can be returned for re-cutting" } }
            : { error: { status: 404, message: "Cutting order not found" } };
        }

        await transaction.verificationItem.updateMany({
          where: { orderId },
          data: { actualQty: null, status: null },
        });
        return transaction.cuttingOrder.findUnique({
          where: { id: orderId },
          include: orderRelations,
        });
      }, { isolationLevel: "Serializable" });

      if (order.error) return sendError(res, order.error.status, order.error.message);
      return res.json({ success: true, data: serializeOrder(order) });
    } catch (error) {
      if (error.code === "P2034") return sendError(res, 409, "Concurrent order update; reload and try again");
      console.error("Order re-cut transition failed");
      return sendError(res, 500, "Unable to return order for re-cutting");
    }
  });

  router.get("/:id/verification-history", requireRole("cutting_supervisor", "cutting_verifier"), async (req, res) => {
    const orderId = parseOrderId(req.params.id);
    if (orderId === null) return sendError(res, 400, "Order ID must be a positive integer");
    try {
      const order = await getOrder(database, orderId, req.user);
      if (!order) return sendError(res, 404, "Cutting order not found");
      return res.json({ success: true, data: serializeOrder(order).verificationHistory });
    } catch (error) {
      console.error("Verification history lookup failed");
      return sendError(res, 500, "Unable to retrieve verification history");
    }
  });

  return router;
}

module.exports = createVerificationRouter;
