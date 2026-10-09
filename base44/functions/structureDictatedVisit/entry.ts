import { smartNoteRequest, exactKeys, noteText, noteFailure } from '../../shared/smartNoteIntegration.ts';

const TEMPLATES = {
  skilled_nursing: { label: 'Skilled Nursing Visit', prompt: `Structure into a SOAP-format home health skilled nursing visit note:
SUBJECTIVE: Patient/caregiver-reported symptoms, complaints, pain (0-10), medication adherence
OBJECTIVE: Vital signs, physical assessment findings, wound status, clinical observations
ASSESSMENT: Clinical interpretation, response to treatment, homebound status justification, skilled need
PLAN: Interventions performed, patient/caregiver education, physician notification if applicable, follow-up frequency
Include Medicare-compliant homebound justification and skilled nursing need statement.` },
  admission: { label: 'Admission Assessment', prompt: `Structure into a home health ADMISSION ASSESSMENT note with these sections:
REASON FOR ADMISSION: Diagnosis, referral source, admission source
CURRENT STATUS: Chief complaint, functional status, ADL independence level
VITAL SIGNS & CLINICAL ASSESSMENT: All obtained vital signs, systems review
MEDICATIONS: Current medication list as mentioned, allergies
SAFETY & ENVIRONMENT: Home safety, fall risk, caregiver support
PSYCHOSOCIAL/SOCIAL HISTORY: Living situation, support system, mental status
HOMEBOUND STATUS: Specific homebound justification per Medicare criteria
PLAN OF CARE: Goals, visit frequency, disciplines ordered, physician orders obtained` },
  recertification: { label: 'Recertification Visit', prompt: `Structure into a RECERTIFICATION visit note:
PERIOD OF CARE: Certification period dates, episode number
CLINICAL STATUS: Current condition vs. admission, progress toward goals
VITAL SIGNS: All recorded vitals
ASSESSMENT BY SYSTEM: Relevant body systems reviewed
GOAL REVIEW: Goals met, goals revised, ongoing skilled need justification
HOMEBOUND STATUS: Continued homebound justification
PLAN: Continued or revised care plan, frequency for next certification period` },
  discharge: { label: 'Discharge Summary', prompt: `Structure into a DISCHARGE SUMMARY note:
DISCHARGE DATE & REASON: Reason for discharge (goals met, patient request, etc.)
CLINICAL SUMMARY: Overall response to treatment, progress from admission to discharge
DISCHARGE STATUS: Functional status at discharge, vital signs, wound status if applicable
PATIENT/CAREGIVER EDUCATION COMPLETED: Topics covered, teach-back demonstrated
DISCHARGE DISPOSITION: Where patient is going, community resources, referrals made
OUTSTANDING ISSUES: Any unresolved items, follow-up recommendations
PHYSICIAN NOTIFICATION: Physician informed of discharge` },
  hospice_comfort: { label: 'Hospice Comfort Care', prompt: `Structure into a HOSPICE COMFORT CARE visit note:
COMFORT STATUS: Current symptom burden (pain, dyspnea, nausea, anxiety), comfort assessment
VITAL SIGNS: Obtained vitals, trajectory noted
CLINICAL ASSESSMENT: Systems review focused on comfort, prognosis indicators
SYMPTOM MANAGEMENT: Current medications for symptom control, effectiveness
PSYCHOSOCIAL/SPIRITUAL: Emotional and spiritual needs of patient and family
CAREGIVER ASSESSMENT: Caregiver burden, coping, education provided
GOALS OF CARE: Alignment with patient/family wishes, advance directives reviewed
INTERDISCIPLINARY TEAM COMMUNICATION: Items to report to team` },
  prn: { label: 'PRN Visit', prompt: `Structure into a PRN (as needed) visit note:
REASON FOR PRN VISIT: Precipitating event or symptom change
ASSESSMENT: Clinical findings that necessitated the visit, vital signs
INTERVENTIONS: Actions taken, treatments provided
OUTCOME: Patient response to interventions
PHYSICIAN NOTIFICATION: Was physician contacted, orders obtained
PLAN: Follow-up actions, frequency adjustment if needed` },
  medication_review: { label: 'Medication Review', prompt: `Structure into a MEDICATION REVIEW visit note:
MEDICATIONS REVIEWED: Complete list of current medications reviewed
ADHERENCE: Patient/caregiver medication adherence assessment
SIDE EFFECTS: Any reported or observed adverse effects
EDUCATION PROVIDED: Medication teaching topics covered
RECONCILIATION: Discrepancies identified and resolved
RECOMMENDATIONS: Changes recommended or made, physician notification` },
};

export default async function(req) {
  try {
    const { base44, input, user } = await smartNoteRequest(req);
    exactKeys(input, ['transcript', 'visitType']);
    const transcript = noteText(input.transcript, 60000);
    if (typeof input.visitType !== 'string' || !Object.hasOwn(TEMPLATES, input.visitType)) throw Object.assign(new Error('Invalid visit type'), { status: 400 });
    const template = TEMPLATES[input.visitType];
    const prompt = `You are a clinical documentation specialist for home health and hospice care.
A nurse has dictated the following raw observations during a patient visit:

"${transcript}"

${template.prompt}

IMPORTANT RULES:
- Use only information provided in the dictation. Do not fabricate clinical data.
- If a section has no dictated content, write "[Not documented - clinician to complete]"
- Use professional clinical language and standard medical abbreviations
- Ensure all documentation meets Medicare home health conditions of participation
- Format cleanly with section headers in ALL CAPS followed by content
- Visit Type: ${template.label}
- Clinician: ${user.full_name || 'Clinician'}

Return only the structured clinical note, no preamble.`;
    const note = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt, model: 'automatic' });
    return Response.json({ note }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return noteFailure(error); }
}