const assert = require("node:assert/strict");
const test = require("node:test");
const {
  approvalBlockReason,
  expectedComponentQty,
  fabricPreview,
  parseFabricYards,
  parseTargetQuantity,
  trafficStatus,
} = require("../app/lib/workflow");

test("validates positive integer quantities and finite positive fabric values", () => {
  assert.equal(parseTargetQuantity("2"), 2);
  for (const input of ["", "0", "-1", "1.5", "Infinity", "NaN", "2x"]) {
    assert.equal(parseTargetQuantity(input), null);
  }
  assert.equal(parseFabricYards("3.8"), 3.8);
  for (const input of ["", "0", "-2", "Infinity", "NaN", "1.234", "2x"]) {
    assert.equal(parseFabricYards(input), null);
  }
});

test("component preview uses the selected recipe multiplier", () => {
  const selectedRecipeComponents = [
    { piecesPerGarment: 1 },
    { piecesPerGarment: 2 },
  ];
  assert.deepEqual(selectedRecipeComponents.map((component) => expectedComponentQty(component.piecesPerGarment, 2)), [2, 4]);
});

test("fabric preview calculates the assessment example and warns above cap", () => {
  assert.deepEqual(fabricPreview(1.8, 2, 3.8, 5), {
    expectedFabricYds: 3.6,
    wastagePct: 5.56,
    exceedsWastageCap: true,
  });
  assert.equal(fabricPreview(0, 2, 3.8, 5), null);
});

test("traffic statuses and approval hard stop include missing and RED counts", () => {
  assert.equal(trafficStatus(2, 2), "GREEN");
  assert.equal(trafficStatus(2, 3), "YELLOW");
  assert.equal(trafficStatus(2, 1), "RED");
  assert.equal(trafficStatus(2, null), null);
  assert.match(approvalBlockReason("PENDING_VERIFICATION", [
    { componentId: 1, expectedQty: 2, actualQty: null },
  ], { 1: "" }), /Count every component/);
  assert.match(approvalBlockReason("PENDING_VERIFICATION", [
    { componentId: 1, expectedQty: 2, actualQty: 1 },
  ], { 1: "1" }), /shortage blocks approval/);
  assert.equal(approvalBlockReason("PENDING_VERIFICATION", [
    { componentId: 1, expectedQty: 2, actualQty: 3 },
  ], { 1: "3" }), "");
});
