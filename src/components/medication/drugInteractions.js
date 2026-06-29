/**
 * drugInteractions — a SMALL, deterministic safety net of well-established,
 * high-severity drug–drug interactions. It augments (never replaces) the LLM
 * check in checkDrugInteractions so that a handful of dangerous, unambiguous
 * combinations are surfaced even if the model misses them.
 *
 * This is intentionally NON-EXHAUSTIVE and is not a substitute for a full
 * interaction database or clinical judgment. Mirrored inline in
 * functions/checkDrugInteractions.ts (single-file deploy model); this
 * unit-tested copy is the source of truth.
 */

// Drug / class -> lowercase name fragments that identify a member.
const GROUPS = {
  warfarin: ["warfarin", "coumadin", "jantoven"],
  // NSAIDs proper. Aspirin is intentionally NOT here: it acts primarily as an
  // antiplatelet, so lumping it with NSAIDs mislabeled warfarin + aspirin as an
  // "NSAID GI bleeding" interaction. Aspirin lives in `antiplatelet` below so the
  // genuine (and dangerous) anticoagulant + antiplatelet bleeding interaction is
  // still surfaced — with the correct label, not dropped.
  nsaid: ["ibuprofen", "naproxen", "ketorolac", "diclofenac", "meloxicam", "indomethacin", "celecoxib", "nsaid"],
  antiplatelet: ["aspirin", "asa", "acetylsalicylic", "clopidogrel", "plavix", "prasugrel", "effient", "ticagrelor", "brilinta", "dipyridamole", "aggrenox"],
  // Aspirin is ALSO a salicylate: like the NSAIDs it reduces renal clearance of
  // methotrexate and lithium. Kept separate from `nsaid` (so warfarin+aspirin is
  // labeled antiplatelet, not "NSAID") and from `antiplatelet` (so clopidogrel et
  // al. don't false-flag the MTX/lithium renal interactions, which are aspirin-specific).
  salicylate: ["aspirin", "asa", "acetylsalicylic"],
  maoi: ["phenelzine", "tranylcypromine", "isocarboxazid", "selegiline", "rasagiline", "linezolid"],
  ssri_snri: ["fluoxetine", "sertraline", "paroxetine", "citalopram", "escitalopram", "fluvoxamine", "venlafaxine", "desvenlafaxine", "duloxetine"],
  nitrate: ["nitroglycerin", "isosorbide", "nitrate"],
  pde5: ["sildenafil", "tadalafil", "vardenafil", "avanafil"],
  ace_arb: ["lisinopril", "enalapril", "ramipril", "benazepril", "captopril", "quinapril", "losartan", "valsartan", "olmesartan", "candesartan", "irbesartan", "telmisartan"],
  potassium_sparing: ["spironolactone", "eplerenone", "triamterene", "amiloride", "potassium chloride", "potassium", "klor con"],
  statin_cyp3a4: ["simvastatin", "lovastatin", "atorvastatin"],
  strong_cyp3a4_inhibitor: ["clarithromycin", "erythromycin", "itraconazole", "ketoconazole", "ritonavir", "cobicistat"],
  digoxin: ["digoxin", "lanoxin"],
  digoxin_potentiator: ["amiodarone", "verapamil", "quinidine", "dronedarone"],
  methotrexate: ["methotrexate"],
  mtx_potentiator: ["trimethoprim", "sulfamethoxazole", "bactrim", "septra"],
  lithium: ["lithium"],
  opioid: ["morphine", "oxycodone", "hydrocodone", "fentanyl", "hydromorphone", "codeine", "tramadol", "methadone", "oxymorphone"],
  benzodiazepine: ["alprazolam", "lorazepam", "diazepam", "clonazepam", "temazepam", "midazolam"],
  allopurinol: ["allopurinol"],
  thiopurine: ["azathioprine", "mercaptopurine"],
  triptan: ["sumatriptan", "rizatriptan", "eletriptan", "zolmitriptan", "naratriptan", "almotriptan", "frovatriptan"],
  warfarin_potentiator: ["amiodarone", "fluconazole", "metronidazole", "ciprofloxacin", "sulfamethoxazole", "bactrim", "septra"],
  statin_any: ["simvastatin", "lovastatin", "atorvastatin", "rosuvastatin", "pravastatin", "pitavastatin", "fluvastatin"],
  fibrate: ["gemfibrozil", "fenofibrate"],
  clopidogrel: ["clopidogrel", "plavix"],
  cyp2c19_inhibitor: ["omeprazole", "esomeprazole", "fluconazole"],
};

// Pairwise rules. Each links two groups with a fixed severity + guidance.
const RULES = [
  { a: "warfarin", b: "nsaid", severity: "major", type: "pharmacodynamic", description: "Greatly increased risk of serious GI/other bleeding.", recommendation: "Avoid; if unavoidable use gastroprotection and monitor INR/bleeding closely." },
  { a: "warfarin", b: "antiplatelet", severity: "major", type: "pharmacodynamic", description: "Additive bleeding risk (anticoagulant + antiplatelet).", recommendation: "Avoid unless a specific indication exists; if combined, use gastroprotection and monitor INR and for bleeding." },
  { a: "ssri_snri", b: "antiplatelet", severity: "moderate", type: "pharmacodynamic", description: "Increased bleeding risk (impaired platelet function plus antiplatelet).", recommendation: "Monitor for bleeding; consider gastroprotection." },
  { a: "maoi", b: "ssri_snri", severity: "critical", type: "contraindication", description: "Risk of serotonin syndrome (potentially fatal).", recommendation: "Contraindicated; observe washout (≥2 weeks; 5 weeks after fluoxetine)." },
  { a: "nitrate", b: "pde5", severity: "critical", type: "contraindication", description: "Profound, potentially fatal hypotension.", recommendation: "Contraindicated combination." },
  { a: "ace_arb", b: "potassium_sparing", severity: "major", type: "pharmacodynamic", description: "Risk of life-threatening hyperkalemia.", recommendation: "Monitor potassium and renal function; avoid in renal impairment." },
  { a: "statin_cyp3a4", b: "strong_cyp3a4_inhibitor", severity: "major", type: "pharmacokinetic", description: "Elevated statin levels → myopathy/rhabdomyolysis.", recommendation: "Avoid; hold the statin or use a non-CYP3A4 statin during therapy." },
  { a: "digoxin", b: "digoxin_potentiator", severity: "major", type: "pharmacokinetic", description: "Increased digoxin levels → toxicity.", recommendation: "Reduce digoxin dose and monitor levels." },
  { a: "methotrexate", b: "nsaid", severity: "major", type: "pharmacokinetic", description: "Reduced methotrexate clearance → toxicity.", recommendation: "Avoid NSAIDs (esp. with higher-dose MTX); monitor." },
  { a: "methotrexate", b: "salicylate", severity: "major", type: "pharmacokinetic", description: "Reduced methotrexate clearance → toxicity.", recommendation: "Avoid salicylates (incl. aspirin), esp. with higher-dose MTX; monitor." },
  { a: "methotrexate", b: "mtx_potentiator", severity: "major", type: "pharmacokinetic", description: "Increased methotrexate toxicity / myelosuppression.", recommendation: "Avoid trimethoprim-sulfamethoxazole with methotrexate." },
  { a: "opioid", b: "benzodiazepine", severity: "major", type: "pharmacodynamic", description: "Additive CNS/respiratory depression (FDA boxed warning).", recommendation: "Avoid co-prescribing; if necessary use lowest doses and monitor." },
  { a: "allopurinol", b: "thiopurine", severity: "major", type: "pharmacokinetic", description: "Severe myelosuppression.", recommendation: "Avoid, or reduce thiopurine dose by ~75% with close monitoring." },
  { a: "lithium", b: "nsaid", severity: "major", type: "pharmacokinetic", description: "Reduced lithium clearance → toxicity.", recommendation: "Avoid NSAIDs; monitor lithium levels." },
  { a: "lithium", b: "salicylate", severity: "major", type: "pharmacokinetic", description: "Reduced lithium clearance → toxicity.", recommendation: "Avoid salicylates (incl. aspirin); monitor lithium levels." },
  { a: "lithium", b: "ace_arb", severity: "major", type: "pharmacokinetic", description: "Reduced lithium clearance → toxicity.", recommendation: "Monitor lithium levels closely." },
  { a: "warfarin", b: "warfarin_potentiator", severity: "major", type: "pharmacokinetic", description: "Raises INR / bleeding risk (CYP / protein-binding interaction).", recommendation: "Monitor INR closely and adjust the warfarin dose." },
  { a: "warfarin", b: "ssri_snri", severity: "major", type: "pharmacodynamic", description: "Additive bleeding risk (impaired platelet function).", recommendation: "Monitor for bleeding; consider gastroprotection." },
  { a: "ssri_snri", b: "nsaid", severity: "moderate", type: "pharmacodynamic", description: "Increased GI bleeding risk.", recommendation: "Use gastroprotection; monitor for bleeding." },
  { a: "statin_any", b: "fibrate", severity: "major", type: "pharmacodynamic", description: "Increased myopathy/rhabdomyolysis risk (esp. gemfibrozil).", recommendation: "Avoid gemfibrozil with statins; if a fibrate is needed prefer fenofibrate with monitoring." },
  { a: "ssri_snri", b: "triptan", severity: "moderate", type: "pharmacodynamic", description: "Serotonin syndrome risk.", recommendation: "Monitor for serotonin toxicity and counsel the patient." },
  { a: "maoi", b: "triptan", severity: "major", type: "pharmacodynamic", description: "Serotonin syndrome risk.", recommendation: "Avoid the combination." },
  { a: "clopidogrel", b: "cyp2c19_inhibitor", severity: "moderate", type: "pharmacokinetic", description: "Reduced activation of clopidogrel → decreased antiplatelet effect.", recommendation: "Avoid CYP2C19 inhibitors with clopidogrel where possible (e.g., use pantoprazole instead of omeprazole/esomeprazole; reassess concurrent fluconazole)." },
];

/** Groups a single medication name belongs to. */
function groupsFor(name) {
  const n = String(name || "").toLowerCase();
  // Split into lowercased word tokens so a fragment only matches when it appears
  // as a whole word (or whole multi-word phrase), not as an arbitrary substring.
  // This avoids false positives like "nitrate" matching inside "mononitrate" or
  // a bare antiplatelet (aspirin) being mischaracterized via substring overlap,
  // while keeping every legitimate whole-token/phrase match intact.
  const tokens = n.split(/[^a-z0-9]+/).filter(Boolean);
  const tokenSet = new Set(tokens);
  const matchesFragment = (f) => {
    if (f.includes(" ")) {
      // Multi-word phrase: require all its words to appear as consecutive tokens.
      const words = f.split(/\s+/).filter(Boolean);
      for (let i = 0; i + words.length <= tokens.length; i++) {
        if (words.every((w, k) => tokens[i + k] === w)) return true;
      }
      return false;
    }
    return tokenSet.has(f);
  };
  const out = [];
  for (const [group, fragments] of Object.entries(GROUPS)) {
    if (fragments.some(matchesFragment)) out.push(group);
  }
  return out;
}

/**
 * Find deterministic interactions among a list of medications.
 * @param {Array<{name?:string, medication_name?:string}>} medications
 * @returns interaction objects shaped like the LLM output, tagged
 *          source:"deterministic", verified:true.
 */
export function findDeterministicInteractions(medications) {
  const meds = (medications || [])
    .map((m) => ({ name: m?.medication_name || m?.name || "" }))
    .filter((m) => m.name);
  const memberGroups = meds.map((m) => new Set(groupsFor(m.name)));
  const results = [];
  const seen = new Set();

  for (let i = 0; i < meds.length; i++) {
    for (let j = i + 1; j < meds.length; j++) {
      for (const rule of RULES) {
        const iA = memberGroups[i].has(rule.a) && memberGroups[j].has(rule.b);
        const iB = memberGroups[i].has(rule.b) && memberGroups[j].has(rule.a);
        if (!iA && !iB) continue;
        const key = `${rule.a}|${rule.b}|${[i, j].join("-")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          drug_a: meds[i].name,
          drug_b: meds[j].name,
          severity: rule.severity,
          interaction_type: rule.type,
          description: rule.description,
          clinical_significance: rule.description,
          recommendation: rule.recommendation,
          monitoring_required: true,
          requires_intervention: rule.severity === "critical" || rule.severity === "major",
          source: "deterministic",
          verified: true,
        });
      }
    }
  }
  return results;
}

/**
 * Merge deterministic interactions into an LLM interaction list. Deterministic
 * findings win on the same drug pair; LLM-only findings are tagged honestly as
 * unverified suggestions.
 */
export function mergeInteractions(aiInteractions, deterministic) {
  const norm = (s) => String(s || "").toLowerCase().trim();
  const pairKey = (x) => [norm(x.drug_a), norm(x.drug_b)].sort().join("|");
  const detKeys = new Set(deterministic.map(pairKey));
  const aiTagged = (aiInteractions || [])
    .filter((x) => !detKeys.has(pairKey(x))) // deterministic wins on overlap
    .map((x) => ({ ...x, source: x.source || "ai_suggested", verified: false }));
  return [...deterministic, ...aiTagged];
}
