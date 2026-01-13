import { useEffect } from "react";
import { base44 } from "@/api/base44Client";

/**
 * Background component that tracks provider usage patterns
 * Call this component on key pages to learn preferences
 */
export default function PreferenceTracker({ 
  userEmail, 
  providerType,
  action,
  metadata 
}) {
  useEffect(() => {
    if (!userEmail || !action) return;

    const trackUsage = async () => {
      try {
        // Get or create usage pattern
        const patterns = await base44.entities.ProviderUsagePattern.filter({ provider_email: userEmail });
        let pattern = patterns[0];

        if (!pattern) {
          // Create initial pattern
          pattern = await base44.entities.ProviderUsagePattern.create({
            provider_email: userEmail,
            provider_type: providerType,
            frequent_visit_types: [],
            frequent_diagnoses: [],
            template_usage: [],
            feature_usage: {
              magic_edit_count: 0,
              voice_dictation_count: 0,
              patient_chat_count: 0,
              letter_generation_count: 0,
              billing_codes_count: 0,
              compliance_check_count: 0
            },
            preferred_quick_actions: [],
            total_notes_generated: 0,
            ai_suggestion_acceptance_rate: 0,
            last_updated: new Date().toISOString()
          });
        }

        // Update pattern based on action
        const updates = {};

        switch (action) {
          case 'note_enhanced':
            updates.total_notes_generated = (pattern.total_notes_generated || 0) + 1;
            
            // Track visit type frequency
            if (metadata.visitType) {
              const visitTypes = pattern.frequent_visit_types || [];
              const existing = visitTypes.find(vt => vt.visit_type === metadata.visitType);
              if (existing) {
                existing.count++;
                existing.last_used = new Date().toISOString();
              } else {
                visitTypes.push({ visit_type: metadata.visitType, count: 1, last_used: new Date().toISOString() });
              }
              visitTypes.sort((a, b) => b.count - a.count);
              updates.frequent_visit_types = visitTypes.slice(0, 10);
            }

            // Track diagnosis frequency
            if (metadata.diagnosis) {
              const diagnoses = pattern.frequent_diagnoses || [];
              const existing = diagnoses.find(d => d.diagnosis === metadata.diagnosis);
              if (existing) {
                existing.count++;
                existing.last_used = new Date().toISOString();
              } else {
                diagnoses.push({ diagnosis: metadata.diagnosis, count: 1, last_used: new Date().toISOString() });
              }
              diagnoses.sort((a, b) => b.count - a.count);
              updates.frequent_diagnoses = diagnoses.slice(0, 15);
            }

            // Track time of day
            const hour = new Date().getHours();
            const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
            updates.preferred_time_of_day = timeOfDay;

            // Track note length
            if (metadata.noteLength) {
              const currentAvg = pattern.avg_note_length || 0;
              const totalNotes = pattern.total_notes_generated || 0;
              updates.avg_note_length = Math.round((currentAvg * totalNotes + metadata.noteLength) / (totalNotes + 1));
            }
            break;

          case 'template_used':
            const templateUsage = pattern.template_usage || [];
            const existingTemplate = templateUsage.find(t => t.template_id === metadata.templateId);
            if (existingTemplate) {
              existingTemplate.usage_count++;
              existingTemplate.last_used = new Date().toISOString();
            } else {
              templateUsage.push({
                template_id: metadata.templateId,
                template_name: metadata.templateName,
                usage_count: 1,
                last_used: new Date().toISOString()
              });
            }
            templateUsage.sort((a, b) => b.usage_count - a.usage_count);
            updates.template_usage = templateUsage.slice(0, 10);
            break;

          case 'feature_used':
            const featureUsage = pattern.feature_usage || {};
            const featureKey = `${metadata.feature}_count`;
            if (featureKey in featureUsage) {
              featureUsage[featureKey] = (featureUsage[featureKey] || 0) + 1;
              updates.feature_usage = featureUsage;
            }
            break;

          case 'quick_action':
            const quickActions = pattern.preferred_quick_actions || [];
            if (!quickActions.includes(metadata.action)) {
              quickActions.push(metadata.action);
              updates.preferred_quick_actions = quickActions.slice(-10);
            }
            break;

          case 'ai_suggestion_accepted':
            const currentRate = pattern.ai_suggestion_acceptance_rate || 0;
            const totalNotes = pattern.total_notes_generated || 1;
            updates.ai_suggestion_acceptance_rate = Math.round(
              ((currentRate * totalNotes) + (metadata.accepted ? 100 : 0)) / (totalNotes + 1)
            );
            break;
        }

        if (Object.keys(updates).length > 0) {
          updates.last_updated = new Date().toISOString();
          await base44.entities.ProviderUsagePattern.update(pattern.id, updates);
        }
      } catch (error) {
        // Silent fail - don't disrupt user workflow
        console.error('Preference tracking error:', error);
      }
    };

    trackUsage();
  }, [userEmail, action, metadata]);

  return null; // This is a background tracking component
}

// Export helper function for easy tracking
export const trackPreference = async (userEmail, providerType, action, metadata) => {
  try {
    const patterns = await base44.entities.ProviderUsagePattern.filter({ provider_email: userEmail });
    let pattern = patterns[0];

    if (!pattern) {
      pattern = await base44.entities.ProviderUsagePattern.create({
        provider_email: userEmail,
        provider_type: providerType,
        frequent_visit_types: [],
        frequent_diagnoses: [],
        template_usage: [],
        feature_usage: {
          magic_edit_count: 0,
          voice_dictation_count: 0,
          patient_chat_count: 0,
          letter_generation_count: 0,
          billing_codes_count: 0,
          compliance_check_count: 0
        },
        preferred_quick_actions: [],
        total_notes_generated: 0,
        ai_suggestion_acceptance_rate: 0,
        last_updated: new Date().toISOString()
      });
    }

    // Apply the tracking logic here (same as component)
    // This function can be called imperatively
  } catch (error) {
    console.error('Tracking error:', error);
  }
};