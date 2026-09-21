import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CSV_BYTES, cleanPhone, cleanValue, formatProviderName, importProviders,
  normalizeHeader, parseCSV, shapeProviderRows, titleCase,
} from './provider-import.mjs';

/**
 * The text half of the provider directory import.
 *
 * Everything here is a transformation, so nothing is asserted against a retyped
 * expectation — but the comparison against the ORIGINAL's six named functions
 * lives in `base44/functionTests/pennsyncApiOriginalParity.test.js`, because
 * reading a file outside this directory breaks the Docker build exactly as an
 * import would. What stays here is what needs only this module.
 */
const CSV = [
  'Physician Name,Title,Fax Number,Work Number,NPI,Specialty,Primary Organization Name',
  '"Smith, John, MD",MD,(215) 555-0100,215-555-0101,1234567890,Cardiology,Penn Cardiology',
  'jane doe,DO,215.555.0200,,0987654321,Geriatrics,',
  'No Fax Provider,MD,,215-555-0300,1111111111,,',
  ',MD,215-555-0400,,,,',
].join('\n');
const harness = (overrides = {}) => {
  const contracts = [];
  return {
    contracts,
    params: overrides.params ?? { csv_text: CSV },
    contract: async (name, args) => {
      contracts.push({ name, args });
      return { success: true, created_providers: args.rows.length, updated_providers: 0 };
    },
  };
};

test('the shaped rows are the columns the original reads', async () => {
  const { rows, skipped } = shapeProviderRows(CSV);
  assert.equal(skipped, 2, 'no fax, and no name');
  assert.equal(rows.length, 2);
  // `John Md Smith`, not `John MD Smith`: `titleCase` lowercases the whole
  // string before capitalising each word, so a credential carried inside the
  // name field is mangled. That is the original's, proved by the parity test
  // above, and correcting it here would be a divergence nobody asked for.
  assert.deepEqual(rows[0], {
    full_name: 'John Md Smith', credentials: 'MD', specialty: 'Cardiology',
    practice_name: 'Penn Cardiology', company: '', top_unit: '', parent_unit: '',
    sub_unit: '', phone_number: '2155550101', fax_number: '2155550100',
    npi_number: '1234567890', state_license: '',
  });
  assert.equal(rows[1].full_name, 'Jane Doe');
  assert.equal(rows[1].fax_number, '2155550200');
  assert.equal(rows[1].phone_number, '', 'no work number is no phone, not the fax');
  // A header the CSV does not carry is an empty string, never undefined.
  assert.equal(rows[1].company, '');
});

test('the answer merges the store s counts with the rows it never sent', async () => {
  const h = harness();
  const result = await importProviders(h);
  assert.deepEqual(h.contracts.map(c => c.name), ['importProvidersCsv']);
  assert.equal(h.contracts[0].args.rows.length, 2);
  assert.deepEqual(result, {
    success: true, created_providers: 2, updated_providers: 0, skipped_rows: 2,
  });
  // The service decides nothing about identity: no provider key, no match, no
  // agency reaches the payload.
  const sent = JSON.stringify(h.contracts[0].args);
  for (const leak of ['agency', 'provider_key', 'existing', 'id"']) {
    assert.equal(sent.includes(leak), false, `the payload must not carry ${leak}`);
  }
});
