/** @param {string} value @returns {number | null} */
function parseTargetQuantity(value) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity <= 2147483647 ? quantity : null;
}

/** @param {string} value @returns {number | null} */
function parseFabricYards(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const yards = Number(value);
  return Number.isFinite(yards) && yards > 0 && yards <= 99999999.99 ? yards : null;
}

/** @param {number} expectedQty @param {number | null} actualQty @returns {"GREEN" | "YELLOW" | "RED" | null} */
function trafficStatus(expectedQty, actualQty) {
  if (actualQty === null) return null;
  if (actualQty === expectedQty) return "GREEN";
  return actualQty > expectedQty ? "YELLOW" : "RED";
}

/** @param {number} piecesPerGarment @param {number} targetQty @returns {number} */
function expectedComponentQty(piecesPerGarment, targetQty) {
  return piecesPerGarment * targetQty;
}

/** @param {number} standardYards @param {number} targetQty @param {number | null} actualYards @param {number} wastageCap */
function fabricPreview(standardYards, targetQty, actualYards, wastageCap) {
  const expectedFabricYds = Number((standardYards * targetQty).toFixed(2));
  if (!Number.isFinite(expectedFabricYds) || expectedFabricYds <= 0) return null;
  const wastagePct = actualYards === null
    ? null
    : Number((((actualYards - expectedFabricYds) / expectedFabricYds) * 100).toFixed(2));
  return {
    expectedFabricYds,
    wastagePct,
    exceedsWastageCap: wastagePct !== null && wastagePct > wastageCap,
  };
}

/** @param {string} status @param {Array<{componentId:number,expectedQty:number,actualQty:number|null}>} components @param {Record<number,string>} drafts */
function approvalBlockReason(status, components, drafts) {
  if (status !== "PENDING_VERIFICATION") return "Only pending orders can be approved.";
  if (components.length === 0) return "This order has no required component rows and cannot be approved.";

  for (const component of components) {
    const raw = drafts[component.componentId] ?? "";
    if (!/^(0|[1-9]\d*)$/.test(raw)) {
      return "Count every component. Missing counts and shortages block approval; excess counts are allowed.";
    }
    const count = Number(raw);
    if (!Number.isSafeInteger(count) || count > 2147483647) {
      return "Component counts must be supported non-negative integers.";
    }
    if (component.actualQty !== count) return "Save every component count before approval.";
    if (trafficStatus(component.expectedQty, count) === "RED") {
      return "A shortage blocks approval. Correct the cut or reject for re-cutting.";
    }
  }

  return "";
}

module.exports = {
  approvalBlockReason,
  expectedComponentQty,
  fabricPreview,
  parseFabricYards,
  parseTargetQuantity,
  trafficStatus,
};
