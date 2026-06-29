// Pure, stateless helpers extracted from OASISScrubber.jsx to keep that
// component maintainable. None of these touch React state — they are simple
// functions of their inputs, so they are safe to unit test and reuse.

import { extractPhrases, getSentencesContaining } from "@/components/smartNote/compliance/factExtraction";

// Badge color for a reimbursement-risk level.
export function getRiskColor(risk) {
  switch (risk) {
    case 'low': return 'bg-green-100 text-green-800 border-green-300';
    case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'critical': return 'bg-red-100 text-red-800 border-red-300';
    default: return 'bg-slate-100 text-slate-800 border-slate-300';
  }
}

// Badge color for a reimbursement-impact level.
export function getImpactBadge(impact) {
  const colors = {
    high: 'bg-red-500',
    medium: 'bg-yellow-500',
    low: 'bg-blue-500'
  };
  return colors[impact] || 'bg-slate-500';
}

// Build the comprehensive ADL/IADL functional-phrase map from the narrative.
// Pure regex extraction — identical output to the previous inline version.
export function buildFunctionalPhrases(narrativeText) {
  return {
    bathing: {
      allPhrases: getSentencesContaining(narrativeText, /bath|shower|wash|tub|sponge bath|bed bath|hygiene/gi),
      assistLevel: extractPhrases(narrativeText, /((?:min|mod|max|total|complete)\s*assist(?:ance)?|independent(?:ly)?|supervision|standby)\s*(?:with|for|during)?\s*(?:bath|shower|wash)[^.]*\./gi),
      equipment: extractPhrases(narrativeText, /(shower chair|tub bench|grab bar|hand[- ]?held shower|bath seat|transfer bench)[^.]*\./gi),
      limitations: extractPhrases(narrativeText, /(unable to|difficulty|cannot|requires help)\s*(?:with)?\s*(?:bath|shower|wash)[^.]*\./gi)
    },
    dressing: {
      allPhrases: getSentencesContaining(narrativeText, /dress|cloth|button|zipper|put(?:ting)? on|don(?:ning)?|doff/gi),
      upperBody: extractPhrases(narrativeText, /(upper (?:body|extremity)|shirt|blouse|bra|jacket)\s*(?:dress)[^.]*\./gi),
      lowerBody: extractPhrases(narrativeText, /(lower (?:body|extremity)|pants|shorts|underwear|socks|shoes|footwear)[^.]*\./gi),
      assistLevel: extractPhrases(narrativeText, /((?:min|mod|max|total)\s*assist|independent|supervision|setup)\s*(?:with|for)?\s*(?:dress)[^.]*\./gi),
      limitations: extractPhrases(narrativeText, /(unable to|difficulty|cannot|requires help)\s*(?:with)?\s*(?:dress|button|zipper|reach)[^.]*\./gi)
    },
    ambulation: {
      allPhrases: getSentencesContaining(narrativeText, /walk|ambul|mobil|gait|step|stair|feet|distance|weight[- ]?bear/gi),
      distance: extractPhrases(narrativeText, /(walk(?:s|ed|ing)?|ambulate(?:s|d)?)\s*(?:up to|approximately|about)?\s*\d+\s*(?:feet|ft|meters|yards)[^.]*\./gi),
      assistDevice: extractPhrases(narrativeText, /(ambulate(?:s|d)?|walk(?:s|ed)?)\s*(?:with|using)\s*(?:walker|cane|wheelchair|rollator)[^.]*\./gi),
      assistLevel: extractPhrases(narrativeText, /((?:min|mod|max|total)\s*assist|independent|supervision|standby|cga|sba)\s*(?:with|for)?\s*(?:ambul|walk|mobil)[^.]*\./gi),
      weightBearing: extractPhrases(narrativeText, /((?:non|partial|toe[- ]?touch|full|weight[- ]?bearing)[- ]?(?:weight[- ]?bearing)?|nwb|pwb|ttwb|fwb|wbat)[^.]*\./gi),
      stairs: extractPhrases(narrativeText, /(stair|step|flight|ascend|descend|rail)[^.]*\./gi),
      surfaces: extractPhrases(narrativeText, /(uneven|carpet|tile|outdoor|indoor|curb|ramp)[^.]*(?:surface|floor|ground)?[^.]*\./gi)
    },
    transfer: {
      allPhrases: getSentencesContaining(narrativeText, /transfer|bed|chair|toilet|car|stand|sit|position/gi),
      types: extractPhrases(narrativeText, /(bed[- ]?to[- ]?chair|chair[- ]?to[- ]?bed|toilet transfer|car transfer|stand[- ]?pivot|sit[- ]?to[- ]?stand|supine[- ]?to[- ]?sit)[^.]*\./gi),
      assistLevel: extractPhrases(narrativeText, /((?:min|mod|max|total)\s*assist|independent|supervision|standby|1[- ]?person|2[- ]?person)\s*(?:with|for)?\s*(?:transfer)[^.]*\./gi),
      equipment: extractPhrases(narrativeText, /(hoyer|mechanical lift|transfer board|gait belt|slide board|trapeze)[^.]*(?:transfer)?[^.]*\./gi),
      weightBearing: extractPhrases(narrativeText, /(weight[- ]?bear|nwb|pwb|fwb|wbat)[^.]*(?:transfer)?[^.]*\./gi)
    },
    toileting: {
      allPhrases: getSentencesContaining(narrativeText, /toilet|bathroom|urinal|bedpan|commode|continence|incontinence|void|bowel|bladder|catheter/gi),
      transfers: extractPhrases(narrativeText, /(toilet transfer|on(?:to)?\/off toilet|commode transfer)[^.]*\./gi),
      hygiene: extractPhrases(narrativeText, /(toileting hygiene|perineal care|self[- ]?wipe|clean(?:ing)? self)[^.]*\./gi),
      continence: extractPhrases(narrativeText, /((?:in)?continent|urinary|bowel|bladder|accident|leakage|urgency|frequency)[^.]*\./gi),
      equipment: extractPhrases(narrativeText, /(commode|bedpan|urinal|raised toilet|grab bar|catheter|brief|diaper)[^.]*\./gi),
      assistLevel: extractPhrases(narrativeText, /((?:min|mod|max|total)\s*assist|independent|supervision)\s*(?:with|for)?\s*(?:toilet|bathroom|continence)[^.]*\./gi)
    },
    grooming: {
      allPhrases: getSentencesContaining(narrativeText, /groom|hygiene|oral|teeth|dental|brush|comb|hair|shav|nail|make[- ]?up/gi),
      oralCare: extractPhrases(narrativeText, /(oral (?:care|hygiene)|brush(?:ing)? teeth|denture(?:s)?|dental)[^.]*\./gi),
      hairCare: extractPhrases(narrativeText, /(comb(?:ing)?|brush(?:ing)? hair|hair care|wash(?:ing)? hair)[^.]*\./gi),
      shaving: extractPhrases(narrativeText, /(shav(?:e|ing)|razor|electric shaver|facial hair)[^.]*\./gi),
      nailCare: extractPhrases(narrativeText, /(nail (?:care|trim)|fingernail|toenail|podiatr)[^.]*\./gi),
      assistLevel: extractPhrases(narrativeText, /((?:min|mod|max|total)\s*assist|independent|supervision|setup)\s*(?:with|for)?\s*(?:groom|hygiene|oral care)[^.]*\./gi)
    },
    eating: {
      allPhrases: getSentencesContaining(narrativeText, /eat|feed|meal|diet|swallow|chew|nutrition|appetite|intake/gi),
      selfFeeding: extractPhrases(narrativeText, /(self[- ]?feed|feed(?:s|ing)? self|independent(?:ly)? eat)[^.]*\./gi),
      assistLevel: extractPhrases(narrativeText, /((?:min|mod|max|total)\s*assist|independent|supervision|setup)\s*(?:with|for)?\s*(?:eat|feed|meal)[^.]*\./gi),
      swallowing: extractPhrases(narrativeText, /(swallow|dysphagia|aspiration|chok(?:e|ing)|thickened liquid|mechanical soft|pureed)[^.]*\./gi),
      diet: extractPhrases(narrativeText, /(diet|nutrition|appetite|intake|npo|tube feed|peg|g[- ]?tube)[^.]*\./gi)
    },
    medications: {
      allPhrases: getSentencesContaining(narrativeText, /medic|pill|tablet|dose|prescri|pharma|inject|insulin/gi),
      oralMeds: extractPhrases(narrativeText, /(oral med(?:ication)?s?|pill(?:s)?|tablet(?:s)?|capsule(?:s)?)[^.]*\./gi),
      injectables: extractPhrases(narrativeText, /(inject(?:able|ion)?s?|insulin|subcutaneous|im|iv)[^.]*\./gi),
      management: extractPhrases(narrativeText, /(med(?:ication)? management|pill box|med planner|self[- ]?administer|caregiver (?:gives|administers))[^.]*\./gi),
      compliance: extractPhrases(narrativeText, /(complian(?:t|ce)|adherence|miss(?:ed|ing) doses?|non[- ]?complian)[^.]*\./gi)
    }
  };
}

// Build clinical decision-support alerts from extracted clinical indicators.
// Pure function — identical output to the previous inline version.
export function buildClinicalAlerts(clinicalIndicators) {
  const alerts = [];

  if (clinicalIndicators.woundPresent.detected) {
    alerts.push({
      type: 'wound',
      severity: 'high',
      title: 'Wound Care Best Practices',
      guideline: 'Document weekly measurements (length × width × depth in cm), staging, wound bed characteristics (granulation/slough/necrotic %), drainage type/amount, periwound condition, and treatment effectiveness. Consider specialist referral if no healing progress in 2 weeks.',
      cmsReference: 'M1306-M1342 Integumentary Status',
      actions: ['Measure wound weekly', 'Document staging per NPUAP', 'Assess infection signs', 'Review pressure redistribution'],
      revenueNote: 'Proper wound documentation supports MMTA-03 clinical group and may qualify for higher case-mix weight.'
    });
  }

  if (clinicalIndicators.cardiacIssues.detected) {
    const hasHF = clinicalIndicators.cardiacIssues.heartFailure.length > 0;
    alerts.push({
      type: 'cardiac',
      severity: hasHF ? 'high' : 'medium',
      title: hasHF ? 'Heart Failure Management' : 'Cardiac Monitoring',
      guideline: hasHF
        ? 'Document daily weights, I&O if applicable, edema assessment (location, pitting scale, circumference), dyspnea at rest vs. exertion, medication compliance, and dietary sodium restriction adherence. Report weight gain >2 lbs in 24hrs or >5 lbs in week to MD.'
        : 'Monitor vital signs, document cardiac rhythm if irregular, assess for chest pain/palpitations, review medication compliance, and educate on symptom recognition.',
      cmsReference: 'M1033 Risk for Hospitalization, M1400 Dyspnea',
      actions: hasHF
        ? ['Daily weights', 'Assess edema (scale 1-4+)', 'Document dyspnea level', 'Review diuretic compliance', 'Dietary counseling']
        : ['Monitor BP/HR', 'Assess peripheral pulses', 'Review cardiac meds', 'Educate on warning signs'],
      revenueNote: 'CHF is a high-impact comorbidity for PDGM adjustment. Ensure ICD-10 specifies HFrEF (I50.2x) or HFpEF (I50.3x) with EF% if known.'
    });
  }

  if (clinicalIndicators.diabetic.detected) {
    const hasComplications = clinicalIndicators.diabetic.complications.length > 0;
    alerts.push({
      type: 'diabetes',
      severity: hasComplications ? 'high' : 'medium',
      title: hasComplications ? 'Diabetic Complications Management' : 'Diabetes Monitoring',
      guideline: 'Document glucose readings with time/context (fasting, pre/post-meal), insulin administration technique, hypoglycemia episodes, foot inspection findings, neuropathy symptoms, dietary compliance, and A1C if available. Assess for complications: neuropathy, nephropathy, retinopathy.',
      cmsReference: 'M2020/M2030 Medication Management, M1860 Ambulation',
      actions: ['Check blood glucose', 'Inspect feet for ulcers', 'Assess sensation (monofilament)', 'Review insulin technique', 'Educate on hypoglycemia'],
      revenueNote: 'Diabetic complications (neuropathy E11.4x, nephropathy E11.2x) qualify as high-impact comorbidities. Document separately from uncomplicated diabetes (E11.9).'
    });
  }

  if (clinicalIndicators.fallRisk.detected) {
    alerts.push({
      type: 'fall_risk',
      severity: 'high',
      title: 'Fall Risk Mitigation',
      guideline: 'Complete fall risk assessment using validated tool (Morse, Tinetti). Document specific risk factors: gait/balance impairment, assistive device use, environmental hazards, high-risk medications (sedatives, antihypertensives), orthostatic vitals, footwear safety, vision issues. Implement interventions: PT referral, medication review, home safety modifications.',
      cmsReference: 'M1033 Risk for Hospitalization, M1850/M1860 Functional Status',
      actions: ['Assess gait and balance', 'Environmental safety check', 'Review fall-risk meds', 'Educate on fall prevention', 'Consider PT evaluation'],
      revenueNote: 'Fall risk with functional limitations supports higher M1850/M1860 scores. Document specific assistance needed to prevent falls.'
    });
  }

  if (clinicalIndicators.cognitiveIssues.detected) {
    alerts.push({
      type: 'cognitive',
      severity: 'medium',
      title: 'Cognitive Assessment Requirements',
      guideline: 'Administer BIMS (Brief Interview for Mental Status) or CAM (Confusion Assessment Method) at SOC/ROC. Document orientation (person/place/time/situation), short-term memory (3-item recall), judgment/decision-making ability, safety awareness, behavioral symptoms (wandering, agitation), and caregiver support needs.',
      cmsReference: 'M1700-M1740 Cognitive/Behavioral Status, BIMS',
      actions: ['Perform BIMS screening', 'Assess orientation (A&Ox?)', 'Test 3-item recall', 'Evaluate judgment', 'Safety awareness check'],
      revenueNote: 'Cognitive impairment often affects functional scores (M1800-M1820) due to need for cueing/supervision. Document clearly.'
    });
  }

  if (clinicalIndicators.oxygenUse.detected) {
    alerts.push({
      type: 'respiratory',
      severity: 'medium',
      title: 'Oxygen Therapy Monitoring',
      guideline: 'Document oxygen flow rate (L/min), delivery method (NC, mask, concentrator), frequency (continuous, PRN, with exertion), SpO2 on room air vs. on O2, dyspnea level at rest and with activity (M1400), and patient/caregiver education on equipment safety and maintenance.',
      cmsReference: 'M1400 Dyspnea, M2020 Medication Management',
      actions: ['Check SpO2 on RA and on O2', 'Document flow rate/delivery', 'Assess dyspnea scale', 'Inspect equipment', 'Fire safety education'],
      revenueNote: 'Oxygen use must correlate with M1400 dyspnea score (cannot be 0 if on O2). COPD/respiratory conditions may support higher clinical group.'
    });
  }

  if (clinicalIndicators.painMentioned.detected && clinicalIndicators.painMentioned.intensity.length === 0) {
    alerts.push({
      type: 'pain',
      severity: 'medium',
      title: 'Comprehensive Pain Assessment',
      guideline: 'Use 0-10 numeric scale or FACES for intensity. Document location, quality (sharp/dull/aching), frequency (constant/intermittent), triggers/relieving factors, impact on function/sleep, current pain management (meds, non-pharm), and effectiveness. Reassess after interventions.',
      cmsReference: 'M1242 Pain Frequency, Quality Measures',
      actions: ['Rate pain 0-10', 'Describe quality/location', 'Assess medication effectiveness', 'Document functional impact', 'Non-pharm interventions'],
      revenueNote: 'Pain affecting ADLs should be reflected in functional scores (M1830-M1860). Uncontrolled pain impacts quality measures.'
    });
  }

  return alerts;
}