export function buildLegacyReferenceInventory(references = []) {
  return references.map((reference) => ({
    file: reference.file,
    kind: reference.kind || "comment",
    reason: reference.reason || "unknown",
    replacement: reference.replacement || null,
    owner: reference.owner || "product-review",
    removable: Boolean(reference.removable && reference.replacement),
  }));
}

export function summarizeLegacyReferenceInventory(references = []) {
  const inventory = buildLegacyReferenceInventory(references);
  return {
    total: inventory.length,
    removable: inventory.filter((item) => item.removable).length,
    retainedForParity: inventory.filter((item) => !item.removable).length,
    missingReplacement: inventory.filter((item) => !item.replacement).map((item) => item.file),
  };
}
