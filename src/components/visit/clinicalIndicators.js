import { extractPhrases, getSentencesContaining as _getSentencesContaining } from "../smartNote/compliance/factExtraction.js";

/**
 * Deterministic clinical-indicator extraction from a visit narrative — assistive
 * devices, oxygen, wounds, fall risk, pain, cognition, diabetes, cardiac, and
 * assistance level. Pure: depends only on the narrative text (plus the shared
 * phrase/sentence helpers). Extracted from OASISScrubber for reuse + testability.
 */
export function extractClinicalIndicators(narrativeText) {
  // factExtraction.getSentencesContaining() uses RegExp#test; avoid stateful `/.../g` patterns.
  const getSentencesContaining = (text, pattern) => {
    if (!pattern?.global) return _getSentencesContaining(text, pattern);
    return _getSentencesContaining(
      text,
      new RegExp(pattern.source, pattern.flags.replace("g", ""))
    );
  };

  return {
    // Assistive Devices - detailed categorization
    assistDevices: {
      detected: /walker|cane|wheelchair|rollator|crutch|grab bar|shower chair|commode|quad cane|hemi-walker|gait belt|bedside commode|raised toilet seat|reacher|hospital bed|hoyer lift|transfer board|sliding board/gi.test(narrativeText),
      walkers: extractPhrases(narrativeText, /(?:uses?|requires?|ambulates? with|utilizing)?\s*(?:front[- ]?wheel(?:ed)?|four[- ]?wheel(?:ed)?|standard|rolling)?\s*walker[^.]*\./gi),
      canes: extractPhrases(narrativeText, /(?:uses?|requires?|ambulates? with)?\s*(?:quad|single[- ]?point|straight|offset)?\s*cane[^.]*\./gi),
      wheelchairs: extractPhrases(narrativeText, /(?:uses?|requires?|dependent on)?\s*(?:manual|power|electric|transport)?\s*wheelchair[^.]*\./gi),
      bathroom: extractPhrases(narrativeText, /(?:grab bar|shower chair|tub bench|raised toilet|commode|bath seat)[^.]*\./gi),
      transfers: extractPhrases(narrativeText, /(?:hoyer|mechanical lift|transfer board|gait belt|sliding board)[^.]*\./gi),
      sentences: getSentencesContaining(narrativeText, /walker|cane|wheelchair|rollator|crutch|grab bar|shower chair|commode|gait belt|lift/gi)
    },

    // Oxygen Usage - with specifics
    oxygenUse: {
      detected: /oxygen|o2|liters|lpm|l\/min|nasal cannula|concentrator|portable oxygen|bipap|cpap|nebulizer|pulse ox|spo2|saturation/gi.test(narrativeText),
      flowRate: extractPhrases(narrativeText, /(\d+\.?\d*)\s*(l|liters?|lpm|l\/min)[^.]*\./gi),
      deliveryMethod: extractPhrases(narrativeText, /(nasal cannula|non-?rebreather|face ?mask|venturi|high[- ]?flow|concentrator|portable tank)[^.]*\./gi),
      frequency: extractPhrases(narrativeText, /(continuous|prn|as needed|with exertion|at rest|during sleep|24\/7|around the clock)\s*(?:oxygen|o2)[^.]*\./gi),
      saturation: extractPhrases(narrativeText, /(spo2|saturation|pulse ox|oxygen sat)[^.]*(\d+%?)[^.]*\./gi),
      sentences: getSentencesContaining(narrativeText, /oxygen|o2 at|liters|lpm|nasal cannula|concentrator|saturation|spo2/gi)
    },

    // Wound Presence - detailed typing
    woundPresent: {
      detected: /wound|ulcer|incision|surgical site|dressing|staging|granulation|pressure injury|skin tear|laceration|dehiscence|necrotic|slough|eschar|drainage|exudate/gi.test(narrativeText),
      pressureUlcers: extractPhrases(narrativeText, /(pressure (?:ulcer|injury|sore)|stage\s*[1-4IiVv]+|unstageable|dti|deep tissue injury)[^.]*\./gi),
      surgicalWounds: extractPhrases(narrativeText, /(surgical (?:wound|site|incision)|post[- ]?op|staples|sutures|steri[- ]?strips|incision)[^.]*\./gi),
      venousUlcers: extractPhrases(narrativeText, /(venous|stasis|arterial|vascular)\s*(?:ulcer|wound)[^.]*\./gi),
      diabeticWounds: extractPhrases(narrativeText, /(diabetic (?:ulcer|wound|foot)|neuropathic ulcer)[^.]*\./gi),
      skinTears: extractPhrases(narrativeText, /(skin tear|laceration|abrasion|bruise|hematoma)[^.]*\./gi),
      woundCharacteristics: extractPhrases(narrativeText, /(granulation|epithelialization|necrotic|slough|eschar|drainage|exudate|purulent|serous|sanguinous|undermining|tunneling)[^.]*\./gi),
      dressingTypes: extractPhrases(narrativeText, /(dressing|gauze|foam|hydrocolloid|alginate|silver|antimicrobial|wound vac|negative pressure)[^.]*\./gi),
      measurements: extractPhrases(narrativeText, /(\d+\.?\d*\s*(?:cm|mm|x)\s*\d+\.?\d*)[^.]*(?:wound|ulcer|incision)[^.]*\./gi),
      sentences: getSentencesContaining(narrativeText, /wound|ulcer|incision|dressing|stage|granulation|drainage/gi)
    },

    // Fall Risk Factors - comprehensive
    fallRisk: {
      detected: /fall|unsteady|balance|gait|weak|dizziness|vertigo|syncope|near[- ]?fall|history of falls?|high[- ]?risk|morse|tinetti/gi.test(narrativeText),
      history: extractPhrases(narrativeText, /(history of falls?|fell\s+\d+|previous fall|recent fall|multiple falls)[^.]*\./gi),
      balanceIssues: extractPhrases(narrativeText, /(unsteady|balance (?:impair|deficit|problem|issue)|poor balance|balance difficulty)[^.]*\./gi),
      gaitProblems: extractPhrases(narrativeText, /(gait (?:impair|deficit|unsteady|abnormal|ataxic|shuffling|antalgic)|abnormal gait)[^.]*\./gi),
      weakness: extractPhrases(narrativeText, /(weakness|weak(?:ened)?|(?:lower|upper) extremity weakness|generalized weakness|muscle weakness)[^.]*\./gi),
      dizziness: extractPhrases(narrativeText, /(dizz(?:y|iness)|vertigo|lightheaded|syncope|orthostatic|presyncope)[^.]*\./gi),
      medications: extractPhrases(narrativeText, /(sedativ|benzodiazepine|opioid|antihypertensive|diuretic)[^.]*(?:fall|risk)[^.]*\./gi),
      environmental: extractPhrases(narrativeText, /(throw rug|clutter|poor lighting|stairs|uneven|tripping hazard)[^.]*\./gi),
      sentences: getSentencesContaining(narrativeText, /fall|unsteady|balance|gait|weak|dizz|vertigo/gi)
    },

    // Pain Indicators - detailed
    painMentioned: {
      detected: /pain|discomfort|ache|aching|soreness|tender|hurt|burning|sharp|dull|throbbing|radiating|cramping/gi.test(narrativeText),
      location: extractPhrases(narrativeText, /((?:back|neck|shoulder|knee|hip|leg|arm|chest|abdominal|head|joint|muscle|nerve)\s*pain)[^.]*\./gi),
      intensity: extractPhrases(narrativeText, /(pain\s*(?:level|scale|score|rating)?[:\s]*\d+(?:\/10)?|(?:mild|moderate|severe|excruciating)\s*pain)[^.]*\./gi),
      quality: extractPhrases(narrativeText, /(sharp|dull|aching|burning|throbbing|stabbing|shooting|radiating|cramping|constant|intermittent)\s*(?:pain|discomfort)[^.]*\./gi),
      triggers: extractPhrases(narrativeText, /(pain (?:with|during|upon|after)|(?:worse|better) with)[^.]*\./gi),
      management: extractPhrases(narrativeText, /(pain (?:management|control|medication|relief)|(?:takes?|prescribed)\s+\w+\s+for pain)[^.]*\./gi),
      sentences: getSentencesContaining(narrativeText, /pain|discomfort|ache|soreness|tender|hurt/gi)
    },

    // Cognitive Concerns - detailed
    cognitiveIssues: {
      detected: /confused|forgetful|dementia|alzheimer|cognitive|memory|orientation|disoriented|impaired judgment|poor recall|short[- ]?term memory|long[- ]?term memory|alert and oriented|a&ox|bims/gi.test(narrativeText),
      orientation: extractPhrases(narrativeText, /(oriented (?:x|to)\s*\d|a&ox?\d|alert and oriented|disoriented|oriented to (?:person|place|time|situation))[^.]*\./gi),
      memoryIssues: extractPhrases(narrativeText, /(memory (?:loss|impair|deficit|problem)|short[- ]?term memory|long[- ]?term memory|forgetful|poor recall)[^.]*\./gi),
      diagnosis: extractPhrases(narrativeText, /(dementia|alzheimer|cognitive impairment|mild cognitive|vascular dementia|lewy body)[^.]*\./gi),
      judgment: extractPhrases(narrativeText, /(impaired judgment|poor (?:judgment|insight|decision)|safety awareness)[^.]*\./gi),
      screening: extractPhrases(narrativeText, /(bims|mmse|moca|mini[- ]?mental|cognitive screening|score(?:d)?[:\s]*\d+)[^.]*\./gi),
      behaviors: extractPhrases(narrativeText, /(wandering|agitation|sundowning|confusion|repetitive|exit[- ]?seeking)[^.]*\./gi),
      sentences: getSentencesContaining(narrativeText, /confused|memory|dementia|alzheimer|cognitive|orientation|oriented|bims/gi)
    },

    // Diabetic Management - detailed
    diabetic: {
      detected: /diabetes|diabetic|insulin|blood sugar|glucose|a1c|hba1c|hypoglycemia|hyperglycemia|fingerstick|glucometer|sliding scale|diabetic diet|carb counting/gi.test(narrativeText),
      type: extractPhrases(narrativeText, /(type\s*[12]\s*diabet|iddm|niddm|insulin[- ]?dependent|non[- ]?insulin)[^.]*\./gi),
      medications: extractPhrases(narrativeText, /(insulin|metformin|glipizide|januvia|lantus|humalog|novolog|ozempic|trulicity|jardiance)[^.]*\./gi),
      glucoseReadings: extractPhrases(narrativeText, /(blood (?:sugar|glucose)|bs|bg|fingerstick|glucometer)[:\s]*(\d+)[^.]*\./gi),
      a1c: extractPhrases(narrativeText, /(a1c|hba1c|hemoglobin a1c)[:\s]*(\d+\.?\d*)[^.]*\./gi),
      hypoglycemia: extractPhrases(narrativeText, /(hypoglycemi|low blood sugar|bs\s*(?:below|under|<)\s*\d+)[^.]*\./gi),
      complications: extractPhrases(narrativeText, /(diabetic (?:neuropathy|retinopathy|nephropathy|foot|ulcer)|peripheral neuropathy)[^.]*\./gi),
      management: extractPhrases(narrativeText, /(sliding scale|carb counting|diabetic diet|glucose monitoring|insulin administration)[^.]*\./gi),
      sentences: getSentencesContaining(narrativeText, /diabetes|insulin|blood sugar|glucose|a1c|hypoglycemia|diabetic/gi)
    },

    // Cardiac Symptoms - detailed
    cardiacIssues: {
      detected: /heart|cardiac|chf|afib|pacemaker|edema|shortness of breath|dyspnea|sob|chest pain|palpitation|arrhythmia|angina|mi|cad|heart failure/gi.test(narrativeText),
      heartFailure: extractPhrases(narrativeText, /(heart failure|chf|congestive|hfref|hfpef|ef\s*(?:of)?\s*\d+%?|ejection fraction)[^.]*\./gi),
      arrhythmias: extractPhrases(narrativeText, /(afib|atrial fibrillation|arrhythmia|palpitation|irregular (?:heart|pulse)|tachycardia|bradycardia)[^.]*\./gi),
      edema: extractPhrases(narrativeText, /(edema|swelling|(?:\d+\+?)\s*pitting|peripheral edema|bilateral (?:leg|lower extremity) (?:edema|swelling)|ankle swelling)[^.]*\./gi),
      dyspnea: extractPhrases(narrativeText, /(shortness of breath|sob|dyspnea|breathless|winded|orthopnea|pnd|paroxysmal nocturnal)[^.]*\./gi),
      chestPain: extractPhrases(narrativeText, /(chest (?:pain|discomfort|pressure|tightness)|angina|substernal)[^.]*\./gi),
      devices: extractPhrases(narrativeText, /(pacemaker|icd|defibrillator|aicd|loop recorder|cardiac monitor)[^.]*\./gi),
      vitals: extractPhrases(narrativeText, /(bp|blood pressure|hr|heart rate|pulse)[:\s]*\d+[^.]*\./gi),
      sentences: getSentencesContaining(narrativeText, /heart|cardiac|chf|afib|edema|shortness of breath|dyspnea|pacemaker|chest pain/gi)
    },

    // Assistance Level Indicators
    assistanceNeeded: {
      detected: /assist|help|require|dependent|unable|cannot|difficulty|needs help|supervision|standby|contact guard|min assist|mod assist|max assist|total assist|cga|sba/gi.test(narrativeText),
      levelOfAssist: extractPhrases(narrativeText, /((?:min(?:imal)?|mod(?:erate)?|max(?:imal)?|total|complete)\s*assist|independent|supervision|standby|contact guard|cga|sba|1[- ]?person|2[- ]?person)[^.]*\./gi),
      dependency: extractPhrases(narrativeText, /(dependent|unable to|cannot|requires assistance|needs help)[^.]*\./gi),
      sentences: getSentencesContaining(narrativeText, /assist|dependent|unable|requires|needs help|supervision|standby/gi)
    },

    // Independence Indicators
    independentMentioned: {
      detected: /independent|independently|without assist|self|able to|performs? own|no assist|unassisted/gi.test(narrativeText),
      activities: extractPhrases(narrativeText, /(independent(?:ly)?|without assist(?:ance)?|able to|performs? (?:own|independently)|self[- ]?care|unassisted)[^.]*\./gi),
      sentences: getSentencesContaining(narrativeText, /independent|without assist|able to|performs? own|self|unassisted/gi)
    }
  };
}
