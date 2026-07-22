export const DEFAULT_ROUTE_CHUNK_BUDGETS = Object.freeze({
  initialKb: 900,
  routeKb: 500,
  vendorKb: 800,
});

export function evaluateRouteChunkBudgets(chunks = [], budgets = DEFAULT_ROUTE_CHUNK_BUDGETS) {
  const results = chunks.map((chunk) => {
    const sizeKb = Math.round((Number(chunk.bytes || chunk.size || 0) / 1024) * 10) / 10;
    const type = chunk.type || (chunk.name?.includes("vendor") ? "vendor" : chunk.isEntry ? "initial" : "route");
    const limitKb = type === "initial" ? budgets.initialKb : type === "vendor" ? budgets.vendorKb : budgets.routeKb;
    return {
      name: chunk.name || "unknown",
      type,
      sizeKb,
      limitKb,
      status: sizeKb <= limitKb ? "pass" : "fail",
      overByKb: Math.max(0, Math.round((sizeKb - limitKb) * 10) / 10),
    };
  });
  return {
    status: results.some((result) => result.status === "fail") ? "fail" : "pass",
    failures: results.filter((result) => result.status === "fail"),
    results,
  };
}
