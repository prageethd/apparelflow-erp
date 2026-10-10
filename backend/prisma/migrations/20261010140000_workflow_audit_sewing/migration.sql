ALTER TABLE "CuttingOrder"
  ADD COLUMN "expectedFabricYds" DECIMAL(20,2),
  ADD COLUMN "wastagePct" DECIMAL(20,2),
  ADD COLUMN "sewingStartedById" INTEGER,
  ADD COLUMN "sewingStartedAt" TIMESTAMP(3);

UPDATE "CuttingOrder" AS order_record
SET
  "expectedFabricYds" = ROUND(recipe."stdFabricYards" * order_record."targetQty", 2),
  "wastagePct" = CASE
    WHEN recipe."stdFabricYards" * order_record."targetQty" > 0 THEN ROUND(
      (
        order_record."actualFabricYds" - ROUND(recipe."stdFabricYards" * order_record."targetQty", 2)
      ) / ROUND(recipe."stdFabricYards" * order_record."targetQty", 2) * 100,
      2
    )
    ELSE 0
  END
FROM "Recipe" AS recipe
WHERE recipe."id" = order_record."recipeId";

ALTER TABLE "CuttingOrder"
  ALTER COLUMN "expectedFabricYds" SET NOT NULL,
  ALTER COLUMN "wastagePct" SET NOT NULL,
  ADD CONSTRAINT "CuttingOrder_targetQty_positive_check" CHECK ("targetQty" > 0) NOT VALID,
  ADD CONSTRAINT "CuttingOrder_actualFabricYds_positive_check" CHECK ("actualFabricYds" > 0) NOT VALID,
  ADD CONSTRAINT "CuttingOrder_expectedFabricYds_nonnegative_check" CHECK ("expectedFabricYds" >= 0) NOT VALID,
  ADD CONSTRAINT "CuttingOrder_sewingStartedById_fkey"
    FOREIGN KEY ("sewingStartedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VerificationItem"
  ADD CONSTRAINT "VerificationItem_expectedQty_positive_check" CHECK ("expectedQty" > 0) NOT VALID,
  ADD CONSTRAINT "VerificationItem_actualQty_nonnegative_check" CHECK ("actualQty" IS NULL OR "actualQty" >= 0) NOT VALID;

ALTER TABLE "VerificationLog"
  ALTER COLUMN "wastagePct" TYPE DECIMAL(20,2),
  ADD COLUMN "snapshot" JSONB;

CREATE INDEX "CuttingOrder_sewingStartedById_idx" ON "CuttingOrder"("sewingStartedById");
CREATE INDEX "VerificationLog_orderId_timestamp_idx" ON "VerificationLog"("orderId", "timestamp");

CREATE FUNCTION prevent_verification_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Verification history is immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "VerificationLog_immutable"
BEFORE UPDATE OR DELETE ON "VerificationLog"
FOR EACH ROW EXECUTE FUNCTION prevent_verification_log_mutation();
