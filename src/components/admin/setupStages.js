/**
 * setupStages — groups the super-admin telephony panels into a short guided
 * flow, and derives each stage's status from the SAME integration steps the
 * progress card already computes (telnyxSetup.buildIntegrationSteps).
 *
 * The config page used to stack every panel at full height — roughly 2,400 lines
 * of UI — with no indication of what still needed doing. Collapsing finished
 * stages leaves the one thing that actually needs attention open.
 *
 * Status is DERIVED, never stored: a stage can only be "done" when every step
 * mapped to it is done, so the page can't claim a stage is complete while the
 * checklist inside it disagrees. A stage with no steps (compliance, which has no
 * automated check) is always "todo" — we don't assert completion we can't verify.
 *
 * Pure and dependency-free so it can be unit-tested like telnyxSetup.js.
 */

/**
 * The stages, in order. `anchors` are the DOM ids the progress card's "Go"
 * buttons scroll to — used to work out which stage to expand before scrolling,
 * since a collapsed stage's anchor isn't in the document.
 */
export const SETUP_STAGES = [
  {
    id: "connect",
    title: "Connect Telnyx",
    description: "Your API key, webhook key, and the messaging / voice / fax connections.",
    stepIds: ["api_secret"],
    // The only step mapped here is the API key, but this stage also OWNS the
    // webhook key and the three connection ids — and those are not cosmetic:
    // startMaskedCall refuses to dial without voice_connection_id, sendFax
    // refuses to send without fax_connection_id, and inbound webhooks fail
    // closed without the public key. Reporting "Done" on the API key alone would
    // collapse the section and tell the admin telephony was set up while calls
    // and faxes still could not go out.
    // These MUST match the field names getTelnyxSecretStatus returns — that is
    // the query TelnyxSetupProgress feeds into stageStatus(). The `*_set` names
    // belong to saveTelnyxSecret's save response, a different endpoint, so every
    // flag resolved to undefined and this stage could never leave "attention"
    // no matter how completely Telnyx was configured.
    secretFlags: [
      "public_key_configured",
      "messaging_profile_configured",
      "voice_connection_configured",
      "fax_connection_configured",
    ],
    anchors: ["telnyx-secret"],
  },
  {
    id: "numbers",
    title: "Numbers & routing",
    description: "Office numbers, the outbound fax line, nurse work numbers, webhooks, and health.",
    stepIds: ["agency_config", "provisioning", "webhooks", "live_test"],
    anchors: ["telnyx-settings", "telnyx-nurses", "telnyx-webhooks", "telnyx-health", "telnyx-pool", "telnyx-hours"],
  },
  {
    id: "compliance",
    title: "Messaging compliance",
    description: "A2P 10DLC registration and the SMS consent ledger.",
    stepIds: [],
    anchors: ["a2p-compliance", "consent-ledger"],
  },
];

/**
 * Roll the integration steps belonging to a stage into one status.
 *
 * @param {{stepIds: string[]}} stage
 * @param {Array<{id: string, status: string}>} steps from buildIntegrationSteps
 * @returns {'done'|'attention'|'todo'}
 */
export function stageStatus(stage, steps, secretStatus) {
  const ids = new Set(stage?.stepIds || []);
  const mine = (Array.isArray(steps) ? steps : []).filter((s) => s && ids.has(s.id));
  // No mapped steps means nothing is measurable — never claim "done".
  if (mine.length === 0) return "todo";
  if (mine.some((s) => s.status === "attention")) return "attention";
  if (!mine.every((s) => s.status === "done")) return "todo";

  // Steps all done — but a stage may additionally own credential fields the
  // checklist doesn't model as steps. Missing any of them is "attention": the
  // prerequisite (the API key) is in place, yet the stage is not actually
  // finished, so it must not collapse as though it were.
  const flags = stage?.secretFlags || [];
  if (flags.length && !flags.every((f) => Boolean(secretStatus?.[f]))) return "attention";
  return "done";
}

/**
 * Which stage owns a given anchor, so it can be expanded before scrolling.
 * @param {string} anchor
 * @returns {string|null} stage id
 */
export function stageIdForAnchor(anchor) {
  if (!anchor) return null;
  const found = SETUP_STAGES.find((s) => s.anchors.includes(anchor));
  return found ? found.id : null;
}

/**
 * Which stages should start expanded: everything not yet done, so a fresh setup
 * opens fully and a finished one collapses to a short page. Falls back to the
 * first stage when everything is done, so the page is never entirely collapsed.
 *
 * @param {Array} steps
 * @returns {string[]} stage ids
 */
export function defaultExpandedStageIds(steps, secretStatus) {
  const open = SETUP_STAGES.filter((s) => stageStatus(s, steps, secretStatus) !== "done").map((s) => s.id);
  return open.length ? open : [SETUP_STAGES[0].id];
}
