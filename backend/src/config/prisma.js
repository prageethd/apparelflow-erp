require("dotenv").config();

const { PrismaClient } = require("../generated/prisma/client.ts");
const { PrismaPg } = require("@prisma/adapter-pg");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.prismaClient ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaClient = prisma;
}

module.exports = prisma;
