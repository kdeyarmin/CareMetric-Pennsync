import { describe, expect, it } from 'vitest';
import {
  PLACEMENT_POSITIONS, creationFields, defaultPlacement, placementBoxes, updateFields,
} from '@/components/signature/signatureFieldPlacement';

describe('signature field placement', () => {
  it('keeps every preset box inside the page the brokers validate against', () => {
    for (const position of PLACEMENT_POSITIONS) {
      for (const box of placementBoxes({ position: position.value, page: 1, withDate: true })) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(100);
        expect(box.y + box.height).toBeLessThanOrEqual(100);
      }
    }
  });

  it('references signers by roster position for a new request and by id for an existing one', () => {
    const placements = [defaultPlacement('b', 0), { ...defaultPlacement('a', 1), withDate: false, page: 3 }];
    expect(creationFields(placements, ['a', 'b'])).toEqual([
      expect.objectContaining({ signer_index: 1, type: 'signature', page: 1 }),
      expect.objectContaining({ signer_index: 1, type: 'date', page: 1 }),
      expect.objectContaining({ signer_index: 0, type: 'signature', page: 3 }),
    ]);
    expect(updateFields(placements).map((field) => [field.signer_id, field.type])).toEqual([
      ['b', 'signature'], ['b', 'date'], ['a', 'signature'],
    ]);
  });

  it('drops a placement whose signer was removed and clamps a nonsense page', () => {
    expect(creationFields([defaultPlacement('gone')], ['a'])).toEqual([]);
    expect(placementBoxes({ position: 'bottom-left', page: 'x' })[0].page).toBe(1);
    expect(placementBoxes({ position: 'bottom-left', page: 9000 })[0].page).toBe(500);
  });
});
