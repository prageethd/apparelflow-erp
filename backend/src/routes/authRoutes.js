const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const authenticate = require("../middleware/authMiddleware");
const demoAccounts = require("../config/demoAccounts");

function createAuthRouter(prismaClient) {
const database = prismaClient || require("../config/prisma");
const router = express.Router();

router.get("/demo-accounts", (req, res) => {
  if (process.env.DEMO_ACCOUNTS_ENABLED !== "true") {
    return res.status(404).json({ success: false, message: "Demo credentials are disabled" });
  }
  return res.json({
    success: true,
    data: demoAccounts.map(({ role, fullName, email, password }) => ({ role, fullName, email, password })),
  });
});

router.get("/me", authenticate, async (req, res) => {
  try {
    const user = await database.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, role: true, fullName: true },
    });
    if (!user) {
      return res.status(401).json({ success: false, message: "Authenticated account no longer exists" });
    }
    return res.json({ success: true, data: user });
  } catch (error) {
    console.error("Current user lookup failed");
    return res.status(500).json({ success: false, message: "Unable to retrieve current user" });
  }
});

router.post("/login", async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ message: "Request body must be a JSON object" });
    }
    if (Object.keys(req.body).some((key) => !["email", "password"].includes(key))) {
      return res.status(400).json({ message: "Only email and password are accepted" });
    }
    const { email, password } = req.body;

    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "Server authentication is not configured",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (
      process.env.NODE_ENV === "production" &&
      process.env.DEMO_ACCOUNTS_ENABLED !== "true" &&
      demoAccounts.some((account) => account.email === normalizedEmail)
    ) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = await database.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
      },
    });
  } catch (error) {
    console.error("Login failed");
    return res.status(500).json({
      message: "Unable to complete login",
    });
  }
});

return router;
}

module.exports = createAuthRouter;
module.exports.demoAccounts = demoAccounts;
