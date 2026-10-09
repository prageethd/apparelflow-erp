-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('cutting_supervisor', 'cutting_verifier', 'sewing_supervisor');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "VerificationItemStatus" AS ENUM ('GREEN', 'YELLOW', 'RED');

-- CreateEnum
CREATE TYPE "VerificationDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "fullName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" SERIAL NOT NULL,
    "recipeCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "stdFabricYards" DECIMAL(10,2) NOT NULL,
    "wastageCap" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeComponent" (
    "id" SERIAL NOT NULL,
    "recipeId" INTEGER NOT NULL,
    "componentName" TEXT NOT NULL,
    "piecesPerGarment" INTEGER NOT NULL,
    "imageUrl" TEXT,

    CONSTRAINT "RecipeComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuttingOrder" (
    "id" SERIAL NOT NULL,
    "orderNo" TEXT NOT NULL,
    "recipeId" INTEGER NOT NULL,
    "targetQty" INTEGER NOT NULL,
    "fabricRollId" TEXT NOT NULL,
    "actualFabricYds" DECIMAL(10,2) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CuttingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationItem" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "componentId" INTEGER NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "actualQty" INTEGER,
    "status" "VerificationItemStatus",

    CONSTRAINT "VerificationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationLog" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "verifierId" INTEGER NOT NULL,
    "decision" "VerificationDecision" NOT NULL,
    "rejectionNote" TEXT,
    "wastagePct" DECIMAL(10,2),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_recipeCode_key" ON "Recipe"("recipeCode");

-- CreateIndex
CREATE INDEX "RecipeComponent_recipeId_idx" ON "RecipeComponent"("recipeId");

-- CreateIndex
CREATE UNIQUE INDEX "CuttingOrder_orderNo_key" ON "CuttingOrder"("orderNo");

-- CreateIndex
CREATE INDEX "CuttingOrder_recipeId_idx" ON "CuttingOrder"("recipeId");

-- CreateIndex
CREATE INDEX "CuttingOrder_createdById_idx" ON "CuttingOrder"("createdById");

-- CreateIndex
CREATE INDEX "CuttingOrder_status_idx" ON "CuttingOrder"("status");

-- CreateIndex
CREATE INDEX "VerificationItem_componentId_idx" ON "VerificationItem"("componentId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationItem_orderId_componentId_key" ON "VerificationItem"("orderId", "componentId");

-- CreateIndex
CREATE INDEX "VerificationLog_orderId_idx" ON "VerificationLog"("orderId");

-- CreateIndex
CREATE INDEX "VerificationLog_verifierId_idx" ON "VerificationLog"("verifierId");

-- AddForeignKey
ALTER TABLE "RecipeComponent" ADD CONSTRAINT "RecipeComponent_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuttingOrder" ADD CONSTRAINT "CuttingOrder_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuttingOrder" ADD CONSTRAINT "CuttingOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationItem" ADD CONSTRAINT "VerificationItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CuttingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationItem" ADD CONSTRAINT "VerificationItem_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "RecipeComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationLog" ADD CONSTRAINT "VerificationLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CuttingOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationLog" ADD CONSTRAINT "VerificationLog_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
