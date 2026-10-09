// Where a signer's signature (and optional date) is drawn on the sealed PDF.
// Geometry is a percentage of the page measured from its top-left corner,
// which is what the signing brokers store and render.

export const PLACEMENT_POSITIONS = Object.freeze([
  { value: 'bottom-left', label: 'Bottom left', x: 6, y: 80 },
  { value: 'bottom-right', label: 'Bottom right', x: 52, y: 80 },
  { value: 'middle-left', label: 'Middle left', x: 6, y: 46 },
  { value: 'middle-right', label: 'Middle right', x: 52, y: 46 },
  { value: 'top-left', label: 'Top left', x: 6, y: 10 },
  { value: 'top-right', label: 'Top right', x: 52, y: 10 },
]);

const SIGNATURE_BOX = Object.freeze({ width: 40, height: 8 });
const DATE_BOX = Object.freeze({ width: 22, height: 3.5, gap: 1 });

export function defaultPlacement(signerKey, index = 0) {
  const position = PLACEMENT_POSITIONS[index % PLACEMENT_POSITIONS.length].value;
  return { signerKey, page: 1, position, withDate: true };
}

/** The boxes one placement draws: a signature, and a date line under it. */
export function placementBoxes(placement) {
  const preset = PLACEMENT_POSITIONS.find((entry) => entry.value === placement?.position) || PLACEMENT_POSITIONS[0];
  const page = Number.isSafeInteger(Number(placement?.page)) && Number(placement.page) >= 1
    ? Math.min(Number(placement.page), 500) : 1;
  const boxes = [{ type: 'signature', page, x: preset.x, y: preset.y, width: SIGNATURE_BOX.width, height: SIGNATURE_BOX.height }];
  if (placement?.withDate) {
    boxes.push({
      type: 'date', page, x: preset.x, y: preset.y + SIGNATURE_BOX.height + DATE_BOX.gap,
      width: DATE_BOX.width, height: DATE_BOX.height,
    });
  }
  return boxes;
}

/** Fields for a new request: signers are referenced by their position in the roster. */
export function creationFields(placements, signerKeys) {
  const fields = [];
  for (const placement of placements || []) {
    const signerIndex = signerKeys.indexOf(placement.signerKey);
    if (signerIndex < 0) continue;
    for (const box of placementBoxes(placement)) fields.push({ signer_index: signerIndex, ...box });
  }
  return fields;
}

/** Fields for an existing document: signers are referenced by their stored id. */
export function updateFields(placements) {
  const fields = [];
  for (const placement of placements || []) {
    if (!placement?.signerKey) continue;
    for (const box of placementBoxes(placement)) fields.push({ signer_id: placement.signerKey, ...box });
  }
  return fields;
}
