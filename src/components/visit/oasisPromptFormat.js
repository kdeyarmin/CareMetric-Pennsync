// OASIS extracted-data prompt formatting.
//
// Pure helper extracted from OASISScrubber.jsx so it can be reused and unit-
// tested in isolation. Takes parsed OASIS upload data and returns a formatted
// prompt block (or "" when there is no data).

export const formatExtractedOasisForPrompt = (data) => {
  if (!data) return '';
  
  let formatted = '\n\n=== UPLOADED OASIS ASSESSMENT DATA ===\n';
  
  if (data.patient_info) {
    formatted += `\nPATIENT INFO:\n`;
    formatted += `- Assessment Type: ${data.m0100_reason_for_assessment || data.patient_info.assessment_type || 'N/A'}\n`;
    formatted += `- Assessment Date: ${data.patient_info.assessment_date || 'N/A'}\n`;
    formatted += `- SOC Date: ${data.patient_info.soc_date || 'N/A'}\n`;
  }
  
  if (data.clinical_record_items) {
    formatted += `\nCLINICAL RECORD:\n`;
    formatted += `- M1021 Primary Dx: ${data.clinical_record_items.m1021_primary_diagnosis || 'N/A'} (${data.clinical_record_items.m1021_icd10_code || ''})\n`;
    if (data.clinical_record_items.m1023_other_diagnoses?.length > 0) {
      formatted += `- M1023 Other Dx: ${data.clinical_record_items.m1023_other_diagnoses.map(d => `${d.code}: ${d.description}`).join('; ')}\n`;
    }
    formatted += `- M1030 Therapy at SOC: ${data.clinical_record_items.m1030_therapies_at_soc || 'N/A'}\n`;
    formatted += `- M1033 Risk Hospitalization: ${data.clinical_record_items.m1033_risk_hospitalization || 'N/A'}\n`;
  }
  
  if (data.sensory_status) {
    formatted += `\nSENSORY STATUS:\n`;
    formatted += `- M1200 Vision: ${data.sensory_status.m1200_vision || 'N/A'}\n`;
    formatted += `- M1242 Pain Frequency: ${data.sensory_status.m1242_pain_frequency || 'N/A'}\n`;
  }
  
  if (data.integumentary_status) {
    formatted += `\nINTEGUMENTARY:\n`;
    formatted += `- M1302 Risk Pressure Ulcer: ${data.integumentary_status.m1302_risk_pressure_ulcer || 'N/A'}\n`;
    formatted += `- M1306 Pressure Ulcer Present: ${data.integumentary_status.m1306_pressure_ulcer_present || 'N/A'}\n`;
    formatted += `- M1330 Stasis Ulcer: ${data.integumentary_status.m1330_stasis_ulcer || 'N/A'}\n`;
    formatted += `- M1340 Surgical Wound: ${data.integumentary_status.m1340_surgical_wound || 'N/A'}\n`;
  }
  
  if (data.respiratory_status) {
    formatted += `\nRESPIRATORY:\n`;
    formatted += `- M1400 Dyspnea: ${data.respiratory_status.m1400_dyspnea || 'N/A'}\n`;
  }
  
  if (data.neuro_emotional_status) {
    formatted += `\nNEURO/EMOTIONAL:\n`;
    formatted += `- M1700 Cognitive: ${data.neuro_emotional_status.m1700_cognitive_functioning || 'N/A'}\n`;
    formatted += `- M1710 Confused: ${data.neuro_emotional_status.m1710_confused || 'N/A'}\n`;
    formatted += `- M1730 PHQ-2: ${data.neuro_emotional_status.m1730_phq2_depression || 'N/A'}\n`;
  }
  
  if (data.adl_iadl_status) {
    formatted += `\nADL/IADL STATUS (M1800-M1910):\n`;
    formatted += `- M1800 Grooming: ${data.adl_iadl_status.m1800_grooming || 'N/A'}\n`;
    formatted += `- M1810 Dress Upper: ${data.adl_iadl_status.m1810_dress_upper || 'N/A'}\n`;
    formatted += `- M1820 Dress Lower: ${data.adl_iadl_status.m1820_dress_lower || 'N/A'}\n`;
    formatted += `- M1830 Bathing: ${data.adl_iadl_status.m1830_bathing || 'N/A'}\n`;
    formatted += `- M1840 Toilet Transfer: ${data.adl_iadl_status.m1840_toilet_transfer || 'N/A'}\n`;
    formatted += `- M1850 Transferring: ${data.adl_iadl_status.m1850_transferring || 'N/A'}\n`;
    formatted += `- M1860 Ambulation: ${data.adl_iadl_status.m1860_ambulation || 'N/A'}\n`;
  }
  
  if (data.medications) {
    formatted += `\nMEDICATIONS:\n`;
    formatted += `- M2001 Drug Regimen Review: ${data.medications.m2001_drug_regimen_review || 'N/A'}\n`;
    formatted += `- M2010 High Risk Drugs: ${data.medications.m2010_high_risk_drugs || 'N/A'}\n`;
    formatted += `- M2020 Oral Med Mgmt: ${data.medications.m2020_oral_med_management || 'N/A'}\n`;
  }
  
  if (data.gg_functional_abilities) {
    formatted += `\nSECTION GG - FUNCTIONAL ABILITIES:\n`;
    
    if (data.gg_functional_abilities.gg0130_self_care) {
      formatted += `\nGG0130 Self-Care (SOC/DC Goal):\n`;
      const sc = data.gg_functional_abilities.gg0130_self_care;
      formatted += `- Eating: ${sc.eating_soc || '?'} / ${sc.eating_dc_goal || '?'}\n`;
      formatted += `- Oral Hygiene: ${sc.oral_hygiene_soc || '?'} / ${sc.oral_hygiene_dc_goal || '?'}\n`;
      formatted += `- Toileting Hygiene: ${sc.toileting_hygiene_soc || '?'} / ${sc.toileting_hygiene_dc_goal || '?'}\n`;
      formatted += `- Shower/Bathe: ${sc.shower_bathe_soc || '?'} / ${sc.shower_bathe_dc_goal || '?'}\n`;
      formatted += `- Upper Body Dressing: ${sc.upper_body_dressing_soc || '?'} / ${sc.upper_body_dressing_dc_goal || '?'}\n`;
      formatted += `- Lower Body Dressing: ${sc.lower_body_dressing_soc || '?'} / ${sc.lower_body_dressing_dc_goal || '?'}\n`;
      formatted += `- Footwear: ${sc.footwear_soc || '?'} / ${sc.footwear_dc_goal || '?'}\n`;
    }
    
    if (data.gg_functional_abilities.gg0170_mobility) {
      formatted += `\nGG0170 Mobility (SOC/DC Goal):\n`;
      const mob = data.gg_functional_abilities.gg0170_mobility;
      formatted += `- Sit to Lying: ${mob.sit_to_lying_soc || '?'} / ${mob.sit_to_lying_dc_goal || '?'}\n`;
      formatted += `- Lying to Sitting: ${mob.lying_to_sitting_soc || '?'} / ${mob.lying_to_sitting_dc_goal || '?'}\n`;
      formatted += `- Sit to Stand: ${mob.sit_to_stand_soc || '?'} / ${mob.sit_to_stand_dc_goal || '?'}\n`;
      formatted += `- Chair/Bed Transfer: ${mob.chair_bed_transfer_soc || '?'} / ${mob.chair_bed_transfer_dc_goal || '?'}\n`;
      formatted += `- Toilet Transfer: ${mob.toilet_transfer_soc || '?'} / ${mob.toilet_transfer_dc_goal || '?'}\n`;
      formatted += `- Walk 10 feet: ${mob.walk_10_feet_soc || '?'} / ${mob.walk_10_feet_dc_goal || '?'}\n`;
      formatted += `- Walk 50 feet: ${mob.walk_50_feet_soc || '?'} / ${mob.walk_50_feet_dc_goal || '?'}\n`;
      formatted += `- Walk 150 feet: ${mob.walk_150_feet_soc || '?'} / ${mob.walk_150_feet_dc_goal || '?'}\n`;
      formatted += `- 4 Steps: ${mob.four_steps_soc || '?'} / ${mob.four_steps_dc_goal || '?'}\n`;
      formatted += `- 12 Steps: ${mob.twelve_steps_soc || '?'} / ${mob.twelve_steps_dc_goal || '?'}\n`;
    }
  }
  
  if (data.discharge_info) {
    formatted += `\nDISCHARGE INFO:\n`;
    formatted += `- M2301 Emergent Care: ${data.discharge_info.m2301_emergent_care || 'N/A'}\n`;
    formatted += `- M2410 Discharge Disposition: ${data.discharge_info.m2410_discharge_disposition || 'N/A'}\n`;
  }
  
  formatted += '\n=== END UPLOADED OASIS DATA ===\n';
  
  return formatted;
};
