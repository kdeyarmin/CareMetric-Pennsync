import { base44 } from "@/api/base44Client";

// Track a recommendation for a nurse
export async function trackRecommendation({
  nurseEmail,
  type,
  text,
  source,
  severity = "medium",
  patientId = null,
  visitId = null
}) {
  if (!nurseEmail || !type || !text || !source) return null;
  
  try {
    return await base44.entities.TrainingRecommendation.create({
      nurse_email: nurseEmail,
      recommendation_type: type,
      recommendation_text: text,
      source,
      severity,
      patient_id: patientId,
      visit_id: visitId,
      addressed: false
    });
  } catch (error) {
    console.error("Error tracking recommendation:", error);
    return null;
  }
}
