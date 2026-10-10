const express = require("express");
const cors = require("cors");
require("dotenv").config();

const createAuthRouter = require("./routes/authRoutes");
const recipeRoutes = require("./routes/recipeRoutes");
const createOrderRouter = require("./routes/orderRoutes");
const createVerificationRouter = require("./routes/verificationRoutes");
const createSewingRouter = require("./routes/sewingRoutes");
const prisma = require("./config/prisma");

const app = express();

const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
const frontendOrigins = frontendOrigin.split(",").map((origin) => origin.trim()).filter(Boolean);

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || frontendOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin is not allowed by CORS"));
    },
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "ApparelFlow API is running",
  });
});

app.get("/api/ready", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ success: true, database: "ready" });
  } catch (error) {
    console.error("Readiness check failed");
    return res.status(503).json({ success: false, message: "Database is unavailable" });
  }
});

app.use("/api/auth", createAuthRouter());
app.use("/api/recipes", recipeRoutes);
app.use("/api/orders", createOrderRouter());
app.use("/api/orders", createVerificationRouter());
app.use("/api/sewing", createSewingRouter());

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status === 413 ? 413 : error.status >= 400 && error.status < 500 ? error.status : 500;
  if (status === 500) console.error("Unhandled API request error");
  return res.status(status).json({
    success: false,
    message: status === 413 ? "Request body is too large" : status === 500 ? "Unable to complete request" : "Invalid request",
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});