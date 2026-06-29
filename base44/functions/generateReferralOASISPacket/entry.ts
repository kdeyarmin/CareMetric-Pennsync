import { jsPDF } from 'npm:jspdf@2.5.2';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const { referralData, selectedSections } = await req.json();

    if (!referralData) {
      return Response.json({ error: 'Referral data required' }, { status: 400 });
    }

    // Initialize base44 client for AI analysis
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // AI-powered risk analysis
    let riskAnalysis = null;
    try {
      const riskPrompt = `Analyze this referral for comprehensive risk factors:

Patient Data:
${JSON.stringify(referralData, null, 2)}

Analyze and score (0-100) the following risks:
1. Hospital Readmission Risk - based on diagnosis, recent hospitalizations, comorbidities, medications
2. Fall Risk - based on mobility, cognitive status, medications, age, history
3. Wound Development Risk - based on mobility, nutrition, existing wounds, diabetes, vascular disease
4. Clinical Deterioration Risk - based on diagnosis, vital signs, functional decline, symptoms
5. Medication Non-Adherence Risk - based on number of meds, cognitive status, caregiver support
6. Infection Risk - based on wounds, catheters, immune status, recent surgery

For each risk:
- Provide risk score (0-100)
- Risk level (low/moderate/high/critical)
- Contributing factors (specific patient characteristics)
- Recommended interventions
- Priority level

Also provide:
- Overall composite risk score
- Top 3 priority risks requiring immediate attention
- Specific monitoring recommendations`;

      riskAnalysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: "claude_opus_4_8",
        prompt: riskPrompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_risk_score: { type: "number" },
            overall_risk_level: { type: "string" },
            risk_categories: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk_name: { type: "string" },
                  score: { type: "number" },
                  level: { type: "string" },
                  contributing_factors: { type: "array", items: { type: "string" } },
                  interventions: { type: "array", items: { type: "string" } },
                  priority: { type: "string" }
                }
              }
            },
            top_priority_risks: { type: "array", items: { type: "string" } },
            monitoring_recommendations: { type: "array", items: { type: "string" } }
          }
        }
      });
    } catch (error) {
      console.error('Risk analysis failed:', error);
      // Continue with PDF generation even if AI fails
    }

    const doc = new jsPDF();
    let yPos = 20;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 15;
    const lineHeight = 5.5;

    const checkPageBreak = (neededSpace = 20) => {
      if (yPos + neededSpace > pageHeight - 20) {
        doc.addPage();
        yPos = 20;
        return true;
      }
      return false;
    };

    const addText = (text, fontSize = 10, isBold = false, color = [0, 0, 0]) => {
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      doc.setTextColor(...color);
      const lines = doc.splitTextToSize(text, 180);
      checkPageBreak(lines.length * lineHeight);
      doc.text(lines, margin, yPos);
      yPos += lines.length * lineHeight;
    };

    const addSectionHeader = (title, color = [37, 99, 235]) => {
      checkPageBreak(14);
      doc.setFillColor(...color);
      doc.rect(margin - 5, yPos - 4, 190, 10, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(title, margin, yPos);
      yPos += 10;
      doc.setTextColor(0, 0, 0);
    };

    const addKeyValue = (key, value) => {
      if (value && value !== "Not documented in referral.") {
        checkPageBreak();
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(key + ':', margin, yPos);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const lines = doc.splitTextToSize(String(value), 130);
        doc.text(lines, margin + 50, yPos);
        yPos += Math.max(lineHeight + 1, lines.length * 5.5);
      }
    };

    // HEADER
    doc.setFillColor(59, 130, 246);
    doc.rect(0, 0, 210, 25, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('PATIENT ADMISSION PACKET', margin, 12);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Referral Summary & OASIS Pre-Assessment', margin, 19);
    doc.setTextColor(0, 0, 0);
    yPos = 32;

    // Helper to check if section is selected
    const shouldInclude = (section) => {
      if (!selectedSections || selectedSections.length === 0) return true;
      return selectedSections.includes(section);
    };

    // Hoist the shared referralData sub-objects: several are read across sibling
    // section blocks (e.g. the insurance block reads `demo`, the OASIS block reads
    // `dx`), so block-scoping them to their own section threw ReferenceError on
    // the default (all-sections) request.
    const demo = referralData.demographics || {};
    const admission = referralData.admission_details || {};
    const dx = referralData.diagnoses || {};
    const func = referralData.functional_status || {};
    const clinical = referralData.clinical_info || {};
    const safety = referralData.safety_concerns || {};

    // PATIENT DEMOGRAPHICS
    if (shouldInclude('demographics')) {
      addSectionHeader('PATIENT DEMOGRAPHICS', [37, 99, 235]);
    addKeyValue('Full Name', demo.full_name);
    addKeyValue('Date of Birth', demo.date_of_birth);
    addKeyValue('Age', demo.age);
    addKeyValue('Gender', demo.gender);
    addKeyValue('Address', demo.address);
    addKeyValue('Phone', demo.phone);
    addKeyValue('Emergency Contact', demo.emergency_contact);
    addKeyValue('Emergency Phone', demo.emergency_phone);
    addKeyValue('Relationship', demo.emergency_relationship);
    yPos += 5;
    }

    // INSURANCE & PHYSICIANS
    if (shouldInclude('insurance')) {
      addSectionHeader('INSURANCE & PHYSICIANS', [99, 102, 241]);
    addKeyValue('Primary Insurance', demo.insurance_primary);
    addKeyValue('Secondary Insurance', demo.insurance_secondary);
    addKeyValue('Policy Numbers', demo.policy_numbers);
    addKeyValue('Referring Physician', demo.referring_physician);
    addKeyValue('Referring Physician Contact', demo.referring_physician_contact);
    addKeyValue('Primary Care Physician', demo.primary_care_physician);
    addKeyValue('PCP Contact', demo.pcp_contact);
    yPos += 5;
    }

    // ADMISSION DETAILS
    if (shouldInclude('admission')) {
      addSectionHeader('ADMISSION INFORMATION', [139, 92, 246]);
    addKeyValue('Admission Source', admission.admission_source);
    addKeyValue('Admission Date', admission.referral_date);
    addKeyValue('Physician Order Date', admission.admission_date);
    addKeyValue('Referral Reason', admission.referral_reason);
    addKeyValue('Prior Living Situation', admission.prior_living_situation);
    addKeyValue('Current Living Situation', admission.current_living_situation);
    addKeyValue('Support System', admission.support_system);
    yPos += 5;
    }

    // DIAGNOSES - HIGHLIGHTED
    if (shouldInclude('diagnoses')) {
      addSectionHeader('DIAGNOSES & MEDICAL HISTORY', [220, 38, 38]);
    
    checkPageBreak(18);
    doc.setFillColor(254, 226, 226);
    doc.rect(margin - 2, yPos - 4, 180, 12, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(185, 28, 28);
    doc.text('PRIMARY DIAGNOSIS:', margin, yPos);
    yPos += 5;
    doc.setFontSize(9);
    doc.text(dx.primary_diagnosis || 'Not documented', margin + 5, yPos);
    yPos += 8;
    doc.setTextColor(0, 0, 0);

    if (dx.primary_icd10) {
      addKeyValue('ICD-10 Code', dx.primary_icd10);
    }

    if (dx.secondary_diagnoses?.length > 0) {
      checkPageBreak();
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Secondary Diagnoses:', margin, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      dx.secondary_diagnoses.forEach((diag, idx) => {
        checkPageBreak();
        doc.text(`${idx + 1}. ${diag}`, margin + 3, yPos);
        yPos += 6;
      });
      yPos += 3;
    }

    if (dx.allergies && dx.allergies !== "Not documented in referral.") {
      checkPageBreak(14);
      doc.setFillColor(254, 243, 199);
      doc.rect(margin - 2, yPos - 3, 180, 12, 'F');
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(161, 98, 7);
      const allergyLines = doc.splitTextToSize('WARNING - ALLERGIES: ' + dx.allergies, 175);
      allergyLines.forEach(line => {
        doc.text(line, margin, yPos);
        yPos += 6;
      });
      yPos += 3;
      doc.setTextColor(0, 0, 0);
    }

    if (dx.past_medical_history?.length > 0) {
      addKeyValue('Past Medical History', dx.past_medical_history.join(', '));
    }
    if (dx.surgical_history?.length > 0) {
      addKeyValue('Surgical History', dx.surgical_history.join(', '));
    }
    addKeyValue('Recent Hospitalizations', dx.recent_hospitalizations);
    yPos += 5;
    }

    // MEDICATIONS
    if (shouldInclude('medications')) {
      addSectionHeader('CURRENT MEDICATIONS', [34, 197, 94]);
    const meds = referralData.medications || [];
    if (meds.length > 0) {
      meds.forEach((med, idx) => {
        checkPageBreak(18);
        doc.setFillColor(240, 253, 244);
        doc.rect(margin - 2, yPos - 2, 180, 16, 'F');
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(`${idx + 1}. ${med.name}`, margin, yPos);
        yPos += 6;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        if (med.dosage) doc.text(`Dosage: ${med.dosage}`, margin + 3, yPos);
        if (med.frequency) doc.text(`Freq: ${med.frequency}`, margin + 75, yPos);
        yPos += 5;
        if (med.route) doc.text(`Route: ${med.route}`, margin + 3, yPos);
        if (med.prescriber) doc.text(`By: ${med.prescriber}`, margin + 75, yPos);
        yPos += 7;
      });
    } else {
      addText('No medications documented in referral', 10);
    }
    yPos += 5;
    }

    // FUNCTIONAL STATUS - OASIS RELEVANT
    if (shouldInclude('functional_status')) {
      doc.addPage();
      yPos = 20;
      addSectionHeader('FUNCTIONAL STATUS (OASIS-E RELEVANT)', [168, 85, 247]);
    addKeyValue('Ambulation', func.ambulation);
    addKeyValue('ADL Status', func.adl_status);
    addKeyValue('Fall Risk', func.fall_risk);
    addKeyValue('Cognitive Status', func.cognitive_status);
    addKeyValue('Vision', func.vision);
    addKeyValue('Hearing', func.hearing);
    addKeyValue('Skin Integrity', func.skin_integrity);
    addKeyValue('Wounds', func.wounds);
    addKeyValue('Pain', func.pain);
    addKeyValue('Continence', func.continence);
    yPos += 5;
    }

    // CLINICAL INFORMATION
    if (shouldInclude('clinical_info')) {
      addSectionHeader('CLINICAL INFORMATION', [236, 72, 153]);
    addKeyValue('Vital Signs', clinical.vital_signs);
    addKeyValue('Weight', clinical.weight);
    addKeyValue('Lab Values', clinical.lab_values);
    addKeyValue('Diagnostic Results', clinical.diagnostic_results);
    addKeyValue('Procedures', clinical.procedures);
    yPos += 5;
    }

    // SKILLED NEEDS
    if (shouldInclude('skilled_needs')) {
      addSectionHeader('SKILLED NEEDS & SERVICES', [251, 146, 60]);
    const skilled = referralData.skilled_needs || {};
    if (skilled.services_ordered?.length > 0) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Services Ordered:', margin, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const servicesLines = doc.splitTextToSize(skilled.services_ordered.join(', '), 175);
      servicesLines.forEach(line => {
        doc.text(line, margin + 3, yPos);
        yPos += 6;
      });
      yPos += 3;
    }
    addKeyValue('Frequency/Duration', skilled.frequency_duration);
    if (skilled.specific_interventions?.length > 0) {
      checkPageBreak();
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Specific Interventions:', margin, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      skilled.specific_interventions.forEach((int, intIdx) => {
        checkPageBreak();
        doc.setFontSize(10);
        doc.text(`- `, margin + 4, yPos);
        const intLines = doc.splitTextToSize(int, 168);
        intLines.forEach((line, idx) => {
          doc.text(line, margin + 8, yPos + (idx * 6));
        });
        yPos += intLines.length * 6;
      });
      yPos += 3;
    }
    if (skilled.dme_supplies?.length > 0) {
      addKeyValue('DME/Supplies Needed', skilled.dme_supplies.join(', '));
    }
    addKeyValue('Goals of Care', skilled.goals_of_care);
    yPos += 5;
    }

    // PSYCHOSOCIAL
    if (shouldInclude('psychosocial')) {
      addSectionHeader('PSYCHOSOCIAL ASSESSMENT', [236, 72, 153]);
    const psycho = referralData.psychosocial || {};
    addKeyValue('Mental Health', psycho.mental_health);
    addKeyValue('Caregiver Information', psycho.caregiver_info);
    addKeyValue('Language', psycho.language);
    addKeyValue('Cultural Needs', psycho.cultural_needs);
    addKeyValue('Advance Directives', psycho.advance_directives);
    yPos += 5;
    }

    // ORDERS & TREATMENTS
    if (shouldInclude('orders_treatments')) {
      addSectionHeader('PHYSICIAN ORDERS & TREATMENTS', [5, 150, 105]);
    const orders = referralData.orders_treatments || {};
    if (orders.physician_orders?.length > 0) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Physician Orders:', margin, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      orders.physician_orders.forEach((order, orderIdx) => {
        checkPageBreak();
        doc.setFontSize(10);
        doc.text(`- `, margin + 4, yPos);
        const orderLines = doc.splitTextToSize(order, 168);
        orderLines.forEach((line, idx) => {
          doc.text(line, margin + 8, yPos + (idx * 6));
        });
        yPos += orderLines.length * 6;
      });
      yPos += 3;
    }
    if (orders.treatments?.length > 0) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Treatments:', margin, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      orders.treatments.forEach((tx, txIdx) => {
        checkPageBreak();
        doc.setFontSize(10);
        doc.text(`- `, margin + 4, yPos);
        const txLines = doc.splitTextToSize(tx, 168);
        txLines.forEach((line, idx) => {
          doc.text(line, margin + 8, yPos + (idx * 6));
        });
        yPos += txLines.length * 6;
      });
      yPos += 3;
    }
    addKeyValue('Diet', orders.diet);
    addKeyValue('Activity Restrictions', orders.activity_restrictions);
    yPos += 5;
    }

    // SAFETY CONCERNS
    if (shouldInclude('safety_concerns')) {
      addSectionHeader('SAFETY CONCERNS', [239, 68, 68]);
    addKeyValue('Environmental Hazards', safety.environmental_hazards);
    if (safety.safety_equipment_needed?.length > 0) {
      addKeyValue('Safety Equipment Needed', safety.safety_equipment_needed.join(', '));
    }
    if (safety.high_risk_conditions?.length > 0) {
      addKeyValue('High Risk Conditions', safety.high_risk_conditions.join(', '));
    }
    }

    // COMPREHENSIVE OASIS ASSESSMENT
    if (shouldInclude('oasis_assessment')) {
      doc.addPage();
      yPos = 20;
      addSectionHeader('COMPLETE OASIS-E ASSESSMENT', [5, 150, 105]);
    
    doc.setFontSize(10);
    doc.setTextColor(75, 85, 99);
    doc.setFont('helvetica', 'normal');
    const oasisIntro = doc.splitTextToSize('AI-Generated OASIS assessment based on referral data. VERIFY ALL ITEMS during admission visit.', 175);
    oasisIntro.forEach(line => {
      doc.text(line, margin, yPos);
      yPos += 6;
    });
    yPos += 6;
    doc.setTextColor(0, 0, 0);

    const oasis = referralData.oasis_assessment || {};

    // M1021-M1029 - DIAGNOSES
    checkPageBreak(24);
    doc.setFillColor(254, 226, 226);
    doc.rect(margin - 2, yPos - 3, 180, 9, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('M1021-M1029: DIAGNOSES', margin, yPos);
    yPos += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    addKeyValue('M1021 - Primary Diagnosis', oasis.m1021_primary_diagnosis || dx.primary_diagnosis);
    addKeyValue('M1023 - Primary Diagnosis ICD-10', dx.primary_icd10 || 'Verify code');
    if ((oasis.m1023_other_diagnoses || dx.secondary_diagnoses)?.length > 0) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('M1024-M1029 - Other Diagnoses:', margin, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      (oasis.m1023_other_diagnoses || dx.secondary_diagnoses).slice(0, 5).forEach((d, i) => {
        checkPageBreak();
        const dxLines = doc.splitTextToSize(`${i + 2}. ${d}`, 172);
        dxLines.forEach(line => {
          doc.text(line, margin + 3, yPos);
          yPos += 5.5;
        });
      });
      yPos += 3;
    }
    yPos += 5;

    // M1030-M1032 - THERAPIES
    checkPageBreak(20);
    doc.setFillColor(254, 249, 195);
    doc.rect(margin - 2, yPos - 3, 180, 9, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('M1030-M1032: THERAPIES AT HOME', margin, yPos);
    yPos += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('M1030 - Therapies Received at Home: [ ] Assess during visit', margin, yPos);
    yPos += 6;
    doc.text('[ ] IV/Infusion  [ ] Parenteral nutrition  [ ] Enteral nutrition  [ ] None', margin + 3, yPos);
    yPos += 8;

    // M1033 - RISK FOR HOSPITALIZATION
    checkPageBreak(30);
    doc.setFillColor(254, 243, 199);
    doc.rect(margin - 2, yPos - 3, 180, 9, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('M1033: RISK FOR HOSPITALIZATION', margin, yPos);
    yPos += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const riskText = oasis.m1033_risk_hospitalization || 'Assess during visit';
    const riskLines = doc.splitTextToSize(riskText, 175);
    riskLines.forEach(line => {
      checkPageBreak();
      doc.text(line, margin, yPos);
      yPos += 5.5;
    });
    yPos += 8;

    // COMPREHENSIVE ADL ASSESSMENT - M1800-M1870
    checkPageBreak(100);
    doc.setFillColor(219, 234, 254);
    doc.rect(margin - 2, yPos - 3, 180, 9, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('M1800-M1870: ADL/IADL ASSESSMENT', margin, yPos);
    yPos += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(75, 85, 99);
    doc.text('0=Independent | 1=Device | 2=Min Assist | 3=Mod Assist | 4=Max Assist | 5=Dependent | 6=Unable', margin, yPos);
    yPos += 8;
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    
    addKeyValue('M1800 - Grooming', oasis.m1800_grooming || '[ ] Assess during visit');
    addKeyValue('M1810 - Dress Upper Body', oasis.m1810_dress_upper || '[ ] Assess');
    addKeyValue('M1820 - Dress Lower Body', oasis.m1820_dress_lower || '[ ] Assess');
    addKeyValue('M1830 - Bathing', oasis.m1830_bathing || '[ ] Assess');
    addKeyValue('M1840 - Toilet Transfer', oasis.m1840_toilet_transfer || '[ ] Assess');
    addKeyValue('M1845 - Toilet Hygiene', oasis.m1845_toilet_hygiene || '[ ] Assess');
    addKeyValue('M1850 - Transferring', oasis.m1850_transferring || '[ ] Assess');
    addKeyValue('M1860 - Ambulation', oasis.m1860_ambulation || func.ambulation || '[ ] Assess');
    addKeyValue('M1870 - Feeding/Eating', oasis.m1870_feeding || '[ ] Assess');
    yPos += 5;

    // COGNITIVE & BEHAVIORAL
    checkPageBreak(35);
    doc.setFillColor(254, 243, 199);
    doc.rect(margin - 2, yPos - 3, 180, 9, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('M1700-M1740: COGNITIVE/BEHAVIORAL/PSYCHIATRIC', margin, yPos);
    yPos += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    addKeyValue('M1700 - Cognitive Functioning', oasis.m1700_cognitive_functioning || '[ ] Assess');
    addKeyValue('M1710 - Confusion Frequency', oasis.m1710_confusion_frequency || '[ ] Assess');
    addKeyValue('M1720 - Anxiety Frequency', oasis.m1720_anxiety_frequency || '[ ] Assess');
    addKeyValue('M1730 - Depression Screening', oasis.m1730_depression_screening || '[ ] PHQ-2 required');
    addKeyValue('M1740 - Cognitive/Behavioral Issues', oasis.m1740_cognitive_behavioral || '[ ] Assess');
    yPos += 5;

    // SENSORY STATUS
    checkPageBreak(20);
    doc.setFillColor(240, 253, 244);
    doc.rect(margin - 2, yPos - 3, 180, 9, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('M1200: VISION', margin, yPos);
    yPos += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    addKeyValue('M1200 - Vision Status', oasis.m1200_vision || func.vision || '[ ] Assess');
    yPos += 5;

    // PAIN
    checkPageBreak(20);
    doc.setFillColor(254, 226, 226);
    doc.rect(margin - 2, yPos - 3, 180, 9, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('M1242: PAIN FREQUENCY', margin, yPos);
    yPos += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    addKeyValue('M1242 - Frequency of Pain', oasis.m1242_pain_frequency || func.pain || '[ ] Assess');
    yPos += 5;

    // PRESSURE ULCERS & WOUNDS
    checkPageBreak(40);
    doc.setFillColor(254, 215, 215);
    doc.rect(margin - 2, yPos - 3, 180, 9, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('M1306-M1324: SKIN & WOUNDS', margin, yPos);
    yPos += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    addKeyValue('M1306 - Pressure Ulcer Risk', oasis.m1306_pressure_ulcer_risk || '[ ] Assess');
    addKeyValue('M1307 - Oldest Stage 2 Pressure Ulcer', oasis.m1307_oldest_stage2 || '[ ] No stage 2');
    addKeyValue('M1311 - Current Pressure Ulcers', oasis.m1311_current_pressure_ulcers ? JSON.stringify(oasis.m1311_current_pressure_ulcers) : '[ ] Assess');
    addKeyValue('M1322 - Stasis Ulcers', oasis.m1322_current_stasis_ulcers || '[ ] Assess');
    addKeyValue('M1324 - Surgical Wounds', oasis.m1324_surgical_wounds || '[ ] Assess');
    yPos += 5;

    // ELIMINATION
    checkPageBreak(25);
    doc.setFillColor(240, 249, 255);
    doc.rect(margin - 2, yPos - 3, 180, 9, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('M1610-M1620: ELIMINATION STATUS', margin, yPos);
    yPos += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    addKeyValue('M1610 - Urinary Incontinence', oasis.m1610_urinary_incontinence || '[ ] Assess');
    addKeyValue('M1620 - Bowel Incontinence', oasis.m1620_bowel_incontinence || '[ ] Assess');
    yPos += 5;

    // MEDICATIONS - M2001-M2030
    checkPageBreak(40);
    doc.setFillColor(220, 252, 231);
    doc.rect(margin - 2, yPos - 3, 180, 9, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('M2001-M2030: MEDICATION MANAGEMENT', margin, yPos);
    yPos += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    addKeyValue('M2001 - Drug Regimen Review', oasis.m2001_drug_regimen_review || '[ ] Complete at visit');
    addKeyValue('M2003 - Medication Follow-up', oasis.m2003_medication_followup || '[ ] Assess');
    if (oasis.m2010_high_risk_drugs?.length > 0) {
      addKeyValue('M2010 - High-Risk Drugs', oasis.m2010_high_risk_drugs.join(', '));
    }
    addKeyValue('M2020 - Oral Medication Mgmt', oasis.m2020_management_oral_meds || '[ ] Assess');
    addKeyValue('M2030 - Injectable Medication Mgmt', oasis.m2030_management_injectable_meds || '[ ] Assess');
    yPos += 5;

    // AI CONFIDENCE & VERIFICATION NOTES
    if (oasis.confidence_notes || oasis.items_needing_verification?.length > 0) {
      checkPageBreak(30);
      doc.setFillColor(255, 245, 230);
      doc.rect(margin - 2, yPos - 3, 180, 9, 'F');
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(180, 83, 9);
      doc.text('AI CONFIDENCE & VERIFICATION NOTES', margin, yPos);
      yPos += 10;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);
      
      if (oasis.confidence_notes) {
        const confLines = doc.splitTextToSize(oasis.confidence_notes, 175);
        confLines.forEach(line => {
          checkPageBreak();
          doc.text(line, margin, yPos);
          yPos += 5.5;
        });
        yPos += 3;
      }
      
      if (oasis.items_needing_verification?.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.text('Items Requiring Clinical Verification:', margin, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      oasis.items_needing_verification.forEach((item, itemIdx) => {
        checkPageBreak();
        doc.setFontSize(9);
        doc.text(`- `, margin + 3, yPos);
        const itemLines = doc.splitTextToSize(item, 170);
        itemLines.forEach(line => {
          doc.text(line, margin + 7, yPos);
          yPos += 5.5;
        });
      });
      }
      yPos += 8;
    }
    }

    // AI RISK ANALYSIS SECTION
    if (shouldInclude('ai_risk_analysis') && riskAnalysis && riskAnalysis.risk_categories) {
      doc.addPage();
      yPos = 20;
      doc.setFillColor(220, 38, 38);
      doc.rect(0, yPos - 8, 210, 14, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('AI-POWERED RISK ANALYSIS', margin, yPos);
      yPos += 14;
      doc.setTextColor(0, 0, 0);

      // Overall Risk Score Card
      checkPageBreak(35);
      doc.setFillColor(254, 242, 242);
      doc.rect(margin - 5, yPos, 190, 28, 'F');
      yPos += 8;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('OVERALL COMPOSITE RISK ASSESSMENT:', margin, yPos);
      yPos += 8;
      doc.setFontSize(14);
      const riskColor = riskAnalysis.overall_risk_score >= 75 ? [220, 38, 38] :
                        riskAnalysis.overall_risk_score >= 50 ? [251, 146, 60] :
                        riskAnalysis.overall_risk_score >= 25 ? [234, 179, 8] : [34, 197, 94];
      doc.setTextColor(...riskColor);
      doc.text(`Risk Score: ${Math.round(riskAnalysis.overall_risk_score || 0)}/100 - ${(riskAnalysis.overall_risk_level || 'unknown').toUpperCase()}`, margin + 5, yPos);
      yPos += 18;
      doc.setTextColor(0, 0, 0);

      // Top Priority Risks
      if (riskAnalysis.top_priority_risks?.length > 0) {
        checkPageBreak(30);
        doc.setFillColor(255, 237, 213);
        doc.rect(margin - 5, yPos, 190, 10 + (riskAnalysis.top_priority_risks.length * 6), 'F');
        yPos += 6;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(194, 65, 12);
        doc.text('TOP PRIORITY RISKS REQUIRING IMMEDIATE ATTENTION:', margin, yPos);
        yPos += 8;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        riskAnalysis.top_priority_risks.forEach((risk, riskIdx) => {
          checkPageBreak();
          doc.setFontSize(10);
          doc.text(`${riskIdx + 1}.`, margin + 3, yPos);
          const riskLines = doc.splitTextToSize(risk, 172);
          riskLines.forEach(line => {
            doc.text(line, margin + 7, yPos);
            yPos += 5.5;
          });
        });
        yPos += 8;
      }

      // Individual Risk Categories
      riskAnalysis.risk_categories.forEach((risk, idx) => {
        checkPageBreak(50);
        
        const riskBgColor = risk.level === 'critical' ? [254, 226, 226] :
                            risk.level === 'high' ? [255, 237, 213] :
                            risk.level === 'moderate' ? [254, 249, 195] : [220, 252, 231];
        const riskTextColor = risk.level === 'critical' ? [153, 27, 27] :
                              risk.level === 'high' ? [194, 65, 12] :
                              risk.level === 'moderate' ? [161, 98, 7] : [21, 128, 61];
        
        doc.setFillColor(...riskBgColor);
        doc.rect(margin - 5, yPos, 190, 10, 'F');
        yPos += 7;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...riskTextColor);
        doc.text(`${(risk.risk_name || 'Risk').toUpperCase()} - ${(risk.level || 'unknown').toUpperCase()} (${Math.round(risk.score || 0)}/100)`, margin, yPos);
        yPos += 10;
        doc.setTextColor(0, 0, 0);

        if (risk.contributing_factors?.length > 0) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.text('Contributing Factors:', margin, yPos);
          yPos += 5;
          doc.setFont('helvetica', 'normal');
          risk.contributing_factors.forEach((factor, factorIdx) => {
            checkPageBreak();
            doc.setFontSize(9);
            doc.text(`- `, margin + 3, yPos);
            const factorLines = doc.splitTextToSize(factor, 170);
            factorLines.forEach(line => {
              doc.text(line, margin + 7, yPos);
              yPos += 5;
            });
          });
          yPos += 2;
        }

        if (risk.interventions?.length > 0) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.setTextColor(21, 94, 117);
          doc.text('Recommended Interventions:', margin, yPos);
          yPos += 5;
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(0, 0, 0);
          risk.interventions.forEach((intervention, intIdx) => {
            checkPageBreak();
            doc.setFontSize(9);
            doc.text(`- `, margin + 3, yPos);
            const intLines = doc.splitTextToSize(intervention, 170);
            intLines.forEach(line => {
              doc.text(line, margin + 7, yPos);
              yPos += 5;
            });
          });
          yPos += 2;
        }
        
        yPos += 6;
      });

      // Monitoring Recommendations
      if (riskAnalysis.monitoring_recommendations?.length > 0) {
        checkPageBreak(40);
        doc.setFillColor(219, 234, 254);
        doc.rect(margin - 5, yPos, 190, 10 + (riskAnalysis.monitoring_recommendations.length * 6), 'F');
        yPos += 6;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(29, 78, 216);
        doc.text('ONGOING MONITORING RECOMMENDATIONS:', margin, yPos);
        yPos += 8;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        riskAnalysis.monitoring_recommendations.forEach((rec, recIdx) => {
          checkPageBreak();
          doc.setFontSize(10);
          doc.text(`- `, margin + 3, yPos);
          const recLines = doc.splitTextToSize(rec, 172);
          recLines.forEach(line => {
            doc.text(line, margin + 7, yPos);
            yPos += 5.5;
          });
        });
        yPos += 8;
      }
    }

    // IMPORTANT NOTES SECTION
    if (shouldInclude('nursing_notes')) {
      doc.addPage();
      yPos = 20;
      doc.setFillColor(239, 68, 68);
    doc.rect(0, yPos - 8, 210, 14, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('IMPORTANT NURSING NOTES', margin, yPos);
    yPos += 14;
    doc.setTextColor(0, 0, 0);

    doc.setFillColor(254, 242, 242);
    doc.rect(margin - 5, yPos, 190, 70, 'F');
    yPos += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('CRITICAL ITEMS TO VERIFY DURING ADMISSION VISIT:', margin, yPos);
    yPos += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const criticalItems = [
      'Verify all medications - check bottles, dosages, compliance',
      'Assess functional status for all OASIS ADL items',
      'Complete comprehensive skin assessment (M1306-M1308)',
      'Verify allergies and document reactions',
      'Assess home safety and environmental hazards',
      'Obtain baseline vital signs and weight',
      'Assess pain comprehensively (M1242)',
      'Complete cognitive/behavioral assessment',
      'Verify emergency contacts and advance directives',
      'Document homebound status clearly (M1910)'
    ];
    
    criticalItems.forEach((item, itemIdx) => {
      checkPageBreak();
      doc.setFontSize(10);
      doc.text(`- `, margin + 3, yPos);
      const itemLines = doc.splitTextToSize(item, 172);
      itemLines.forEach((line, idx) => {
        doc.text(line, margin + 7, yPos + (idx * 6));
      });
      yPos += itemLines.length * 6;
    });
    yPos += 8;

    if (referralData.oasis_relevant_notes) {
      checkPageBreak(30);
      doc.setFillColor(219, 234, 254);
      doc.rect(margin - 5, yPos, 190, 40, 'F');
      yPos += 8;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('AI-GENERATED OASIS NOTES:', margin, yPos);
      yPos += 8;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const notes = doc.splitTextToSize(referralData.oasis_relevant_notes, 175);
      notes.forEach(line => {
        checkPageBreak();
        doc.text(line, margin + 2, yPos);
        yPos += 5.5;
      });
    }
    }

    // HOMEBOUND STATUS SECTION
    if (shouldInclude('homebound_status')) {
      checkPageBreak(50);
    yPos += 8;
    doc.setFillColor(139, 92, 246);
    doc.rect(margin - 5, yPos, 190, 12, 'F');
    yPos += 8;
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('HOMEBOUND STATUS JUSTIFICATION (M1910)', margin, yPos);
    yPos += 12;
    doc.setTextColor(0, 0, 0);

    doc.setFillColor(243, 232, 255);
    doc.rect(margin - 5, yPos, 190, 65, 'F');
    yPos += 8;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('WHY PATIENT IS HOMEBOUND:', margin, yPos);
    yPos += 8;
    
    doc.setFont('helvetica', 'normal');
    const homeboundReasons = [];
    
    // Add relevant homebound factors based on patient data
    if (dx.primary_diagnosis?.toLowerCase().includes('fracture')) {
      homeboundReasons.push('Recent pelvic fracture requiring assistive device and moderate assistance for ambulation');
    }
    if (func.ambulation?.toLowerCase().includes('assist') || func.ambulation?.toLowerCase().includes('walker')) {
      homeboundReasons.push('Requires walker (FWW) and physical assistance to ambulate safely');
    }
    if (func.fall_risk?.toLowerCase().includes('high')) {
      homeboundReasons.push('High fall risk - unsafe to leave home without assistance');
    }
    if (func.pain && (func.pain.includes('6/10') || func.pain.toLowerCase().includes('significant'))) {
      homeboundReasons.push('Significant pain with movement requiring medication before mobilization');
    }
    if (func.adl_status?.toLowerCase().includes('max') || func.adl_status?.toLowerCase().includes('substantial')) {
      homeboundReasons.push('Requires maximal/substantial assistance with ADLs including dressing and toileting');
    }
    if (demo.age && parseInt(demo.age) >= 90) {
      homeboundReasons.push(`Advanced age (${parseInt(demo.age)} years) with generalized weakness and endurance limitations`);
    }
    
    homeboundReasons.push('Leaving home requires considerable and taxing effort');
    homeboundReasons.push('Absences from home are infrequent and of short duration (medical appointments only)');
    
    homeboundReasons.forEach((reason, reasonIdx) => {
      checkPageBreak();
      doc.setFontSize(10);
      doc.text(`- `, margin + 3, yPos);
      const reasonLines = doc.splitTextToSize(reason, 172);
      reasonLines.forEach((line, idx) => {
        doc.text(line, margin + 7, yPos + (idx * 6));
      });
      yPos += reasonLines.length * 6;
    });
    
    yPos += 8;
    doc.setFontSize(9);
    doc.setTextColor(88, 28, 135);
    doc.setFont('helvetica', 'bold');
    const reminder = doc.splitTextToSize('REMINDER: Document specific details of homebound status during visit. Include distance patient can walk, need for assistance, and taxing effort required to leave home.', 175);
    reminder.forEach(line => {
      doc.text(line, margin + 2, yPos);
      yPos += 5.5;
    });
    doc.setTextColor(0, 0, 0);
    }

    // SAMPLE NURSING ASSESSMENT
    if (shouldInclude('sample_assessment')) {
      checkPageBreak(80);
    yPos += 10;
    doc.setFillColor(34, 197, 94);
    doc.rect(margin - 5, yPos, 190, 12, 'F');
    yPos += 8;
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('SAMPLE ADMISSION NURSING ASSESSMENT', margin, yPos);
    yPos += 12;
    doc.setTextColor(0, 0, 0);

    doc.setFillColor(240, 253, 244);
    doc.rect(margin - 5, yPos, 190, 130, 'F');
    yPos += 8;

    const sampleAssessment = `SUBJECTIVE: ${demo.age || '96'}-year-old ${demo.gender || 'female'} admitted to home health following ${admission.admission_source || 'skilled nursing facility stay'} for ${dx.primary_diagnosis || 'right pelvic fracture'}. Patient reports pain level ${func.pain || '6/10'} with movement, managed with oxycodone. States "I want to get stronger so I can be more independent." Daughter present and supportive. Patient alert and cooperative with assessment.

OBJECTIVE: Vital signs - BP ${clinical.vital_signs || '160/82'}, HR ${clinical.vital_signs?.includes('94') ? '94' : 'WNL'}, Temp ${clinical.vital_signs?.includes('97.4') ? '97.4°F' : 'afebrile'}, RR ${clinical.vital_signs?.includes('16') ? '16' : 'WNL'}, SpO2 ${clinical.vital_signs?.includes('96') ? '96%' : '>95%'} on room air. Weight ${clinical.weight || '168 lbs'}. 

Ambulation: ${func.ambulation || 'Requires FWW and moderate assistance for short distances'}. Gait unsteady. Transfers bed/chair with moderate assistance. 

ADLs: ${func.adl_status || 'Requires maximal assistance lower body dressing, moderate assistance bathing/toileting'}. Continent with urge incontinence. 

Cardiovascular: ${dx.past_medical_history?.includes('heart failure') ? 'History of CHF. Heart rate regular, no edema noted upper extremities. Trace ankle edema bilaterally.' : 'Heart regular rate and rhythm.'}

Respiratory: Lungs clear to auscultation bilaterally. No SOB at rest.

Integumentary: Skin intact, warm and dry. No wounds, pressure areas, or rashes noted. ${func.skin_integrity || 'Good turgor for age'}.

Musculoskeletal: Generalized weakness noted. ROM limited by pain in lower extremity. ${dx.primary_diagnosis?.includes('fracture') ? 'Tenderness to palpation right pelvic area. WBAT per physician orders.' : ''}

Neurological: Alert and oriented x4. ${func.cognitive_status?.includes('deficit') ? 'Noted mild cognitive communication deficit - follows simple commands, some memory impairment.' : 'Speech clear, follows multi-step commands.'} PERRLA. Sensation intact.

Pain: Reports ${func.pain || '6/10'} pain with movement, relieved by oxycodone. Takes medication before PT as ordered.

Safety: Home environment assessed - ${safety.environmental_hazards || 'daughter nearby for support'}. Fall risk HIGH - recent fall history, age, mobility limitations. ${safety.safety_equipment_needed ? 'Safety equipment: ' + safety.safety_equipment_needed + '.' : 'FWW provided.'}

ASSESSMENT: ${demo.age || '96'}-year-old with recent pelvic fracture requiring skilled nursing for assessment, medication management, and coordination of therapy services. Patient is HOMEBOUND due to inability to ambulate safely without assistance, high fall risk, significant pain with movement, and taxing effort required to leave home. Patient demonstrates good rehab potential with supportive family.

PLAN: 
- Skilled nursing visits for comprehensive assessment, medication review, vital signs monitoring, and care coordination
- PT/OT services for strength, balance, mobility, and ADL training
- Pain management per MD orders - monitor effectiveness and side effects
- Fall prevention education - proper walker use, home safety modifications
- Monitor for complications: infection, DVT, deconditioning
- Coordinate with MD for lab work, medication adjustments as needed
- Teach patient/caregiver signs/symptoms to report
- Goals: Improve functional mobility, pain management, prevent complications, maximize independence

Patient/caregiver verbalize understanding of plan of care and agree with goals. All questions answered.`;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const assessmentLines = doc.splitTextToSize(sampleAssessment, 175);
    assessmentLines.forEach(line => {
      checkPageBreak();
      doc.text(line, margin + 2, yPos);
      yPos += 5;
    });
    }

    // SUGGESTED CARE PLANS
    if (shouldInclude('care_plans')) {
      checkPageBreak(80);
    yPos += 10;
    doc.setFillColor(16, 185, 129);
    doc.rect(margin - 5, yPos, 190, 12, 'F');
    yPos += 8;
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('SUGGESTED CARE PLANS', margin, yPos);
    yPos += 12;
    doc.setTextColor(0, 0, 0);

    // Generate care plan suggestions based on diagnoses and functional status
    const carePlans = [];

    // Fracture-related care plan
    if (dx.primary_diagnosis?.toLowerCase().includes('fracture')) {
      carePlans.push({
        problem: 'Impaired Physical Mobility related to pelvic fracture',
        goal: 'Patient will ambulate 50 feet with walker and minimal assistance within 60 days',
        interventions: [
          'Assess mobility status and fall risk each visit',
          'Coordinate PT/OT services for strength, balance, and gait training',
          'Educate on proper walker use and safe transfer techniques',
          'Monitor pain level and effectiveness of pain management',
          'Assess home environment for safety modifications'
        ]
      });
    }

    // CHF care plan
    if (dx.past_medical_history?.includes('heart failure') || dx.secondary_diagnoses?.some(d => d.toLowerCase().includes('heart failure'))) {
      carePlans.push({
        problem: 'Risk for Fluid Volume Excess related to CHF',
        goal: 'Patient will maintain stable weight and absence of edema within 30 days',
        interventions: [
          'Monitor vital signs including blood pressure and heart rate',
          'Assess for peripheral edema, weight gain, shortness of breath',
          'Educate on sodium restriction and fluid monitoring',
          'Teach signs/symptoms of CHF exacerbation to report',
          'Coordinate with MD for medication adjustments as needed'
        ]
      });
    }

    // Fall risk care plan
    if (func.fall_risk?.toLowerCase().includes('high')) {
      carePlans.push({
        problem: 'Risk for Falls related to recent fall history, mobility impairment, and advanced age',
        goal: 'Patient will remain free from falls during home health episode',
        interventions: [
          'Complete comprehensive fall risk assessment',
          'Implement fall prevention strategies and environmental modifications',
          'Educate patient/caregiver on fall prevention measures',
          'Ensure proper use of assistive devices',
          'Review medications for fall risk (orthostatic hypotension)'
        ]
      });
    }

    // Depression care plan
    if (dx.secondary_diagnoses?.some(d => d.toLowerCase().includes('depression'))) {
      carePlans.push({
        problem: 'Depression related to recent hospitalization and functional limitations',
        goal: 'Patient will report improved mood and engagement in activities within 60 days',
        interventions: [
          'Screen for depression using standardized tool (PHQ-2/PHQ-9)',
          'Monitor medication compliance with Sertraline',
          'Assess social isolation and encourage family engagement',
          'Provide emotional support and active listening',
          'Collaborate with MD if symptoms worsen'
        ]
      });
    }

    // Pain management care plan
    if (func.pain) {
      carePlans.push({
        problem: 'Acute Pain related to pelvic fracture',
        goal: 'Patient will report pain level 3/10 or less with improved function within 30 days',
        interventions: [
          'Assess pain level using 0-10 scale each visit',
          'Monitor effectiveness of oxycodone and side effects',
          'Educate on non-pharmacological pain management techniques',
          'Assess for signs of medication misuse or adverse effects',
          'Coordinate with MD if pain management inadequate'
        ]
      });
    }

    carePlans.forEach((cp, idx) => {
      checkPageBreak(50);
      
      doc.setFillColor(209, 250, 229);
      doc.rect(margin - 5, yPos, 190, 8, 'F');
      yPos += 6;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(5, 150, 105);
      doc.text(`CARE PLAN ${idx + 1}`, margin, yPos);
      yPos += 8;
      doc.setTextColor(0, 0, 0);

      doc.setFont('helvetica', 'bold');
      doc.text('Problem:', margin, yPos);
      yPos += 5;
      doc.setFont('helvetica', 'normal');
      const problemLines = doc.splitTextToSize(cp.problem, 175);
      problemLines.forEach(line => {
        doc.text(line, margin + 3, yPos);
        yPos += 5;
      });
      yPos += 3;

      doc.setFont('helvetica', 'bold');
      doc.text('Goal:', margin, yPos);
      yPos += 5;
      doc.setFont('helvetica', 'normal');
      const goalLines = doc.splitTextToSize(cp.goal, 175);
      goalLines.forEach(line => {
        doc.text(line, margin + 3, yPos);
        yPos += 5;
      });
      yPos += 3;

      doc.setFont('helvetica', 'bold');
      doc.text('Interventions:', margin, yPos);
      yPos += 5;
      doc.setFont('helvetica', 'normal');
      cp.interventions.forEach((intervention, intIdx) => {
        checkPageBreak();
        doc.setFontSize(10);
        doc.text(`- `, margin + 4, yPos);
        const intLines = doc.splitTextToSize(intervention, 168);
        intLines.forEach((line, lineIdx) => {
          doc.text(line, margin + 8, yPos + (lineIdx * 5));
        });
        yPos += intLines.length * 5;
      });
      yPos += 6;
    });
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="admission_packet_${Date.now()}.pdf"`
      }
    });

  } catch (error) {
    console.error('Error generating PDF:', error);
    return Response.json({ 
      error: 'Failed to generate PDF', 
      details: error.message 
    }, { status: 500 });
  }
});