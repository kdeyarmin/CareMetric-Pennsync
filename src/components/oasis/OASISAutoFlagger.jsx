import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

// Threshold configuration
const THRESHOLDS = {
  accuracy: 75,
  compliance: 80,
  overall: 70
};

async function autoFlagOASIS(oasisUpload, analysisResults) {
  if (!oasisUpload || !analysisResults) return null;

  const shouldFlag = 
    (analysisResults.accuracy_score < THRESHOLDS.accuracy) ||
    (analysisResults.compliance_score < THRESHOLDS.compliance) ||
    (analysisResults.overall_score < THRESHOLDS.overall) ||
    (analysisResults.specific_rescore_opportunities?.length > 2);

  if (!shouldFlag) return null;

  // Determine flag reason
  let flagReason = 'low_accuracy';
  let priority = 'medium';

  // Each arm must line up with a shouldFlag trigger, otherwise a record flagged
  // for one reason falls through to the generic default and is mislabeled.
  if (analysisResults.accuracy_score < 60) {
    flagReason = 'low_accuracy';
    priority = 'critical';
  } else if (analysisResults.compliance_score < THRESHOLDS.compliance) {
    // Was < 70 while the trigger uses < 80, so a compliance shortfall in [70, 80)
    // fell through to the default low_accuracy/medium labels.
    flagReason = 'low_compliance';
    priority = 'high';
  } else if (analysisResults.specific_rescore_opportunities?.length > 2) {
    // Must match the shouldFlag trigger above (> 2). Previously > 3, so a record
    // flagged solely for having exactly 3 rescore opportunities fell through to
    // the default low_accuracy/medium labels instead of revenue_opportunity/high.
    flagReason = 'revenue_opportunity';
    priority = 'high';
  } else if (analysisResults.audit_risk_areas?.some(r => r.risk_level === 'high')) {
    flagReason = 'high_audit_risk';
    priority = 'high';
  } else if (analysisResults.accuracy_score < THRESHOLDS.accuracy) {
    // Accuracy in [60, 75) — a genuine accuracy flag, not the generic default.
    flagReason = 'low_accuracy';
    priority = 'high';
  }

  // Compile key issues
  const keyIssues = [];
  
  // Add accuracy issues
  (analysisResults.accuracy_issues || []).slice(0, 5).forEach(issue => {
    keyIssues.push({
      category: 'accuracy',
      item: issue.item,
      issue: issue.issue,
      severity: issue.severity,
      recommendation: issue.recommendation
    });
  });

  // Add compliance concerns
  (analysisResults.compliance_concerns || []).slice(0, 3).forEach(concern => {
    keyIssues.push({
      category: 'compliance',
      item: concern.area,
      issue: concern.issue,
      severity: concern.severity,
      recommendation: concern.recommendation
    });
  });

  // Add audit risks
  (analysisResults.audit_risk_areas || []).slice(0, 3).forEach(risk => {
    keyIssues.push({
      category: 'audit_risk',
      item: risk.area,
      issue: risk.explanation,
      severity: risk.risk_level,
      recommendation: risk.mitigation
    });
  });

  // Compile rescore opportunities
  const rescoreOpps = (analysisResults.specific_rescore_opportunities || []).map(opp => ({
    m_item: opp.m_item,
    current_score: opp.current_score,
    recommended_score: opp.recommended_score,
    revenue_impact: opp.revenue_impact
  }));

  // Estimate total revenue impact
  let estimatedRevenue = 0;
  rescoreOpps.forEach(opp => {
    const match = (opp.revenue_impact || '').match(/\$?([\d,]+)/);
    if (match) {
      estimatedRevenue += parseInt(match[1].replace(/,/g, '')) || 0;
    }
  });

  const auditRecord = {
    oasis_upload_id: oasisUpload.id,
    patient_id: oasisUpload.patient_id,
    patient_name: oasisUpload.patient_name,
    flag_reason: flagReason,
    accuracy_score: analysisResults.accuracy_score,
    compliance_score: analysisResults.compliance_score,
    revenue_score: analysisResults.revenue_optimization_score,
    overall_score: analysisResults.overall_score,
    key_issues: keyIssues,
    rescore_opportunities: rescoreOpps,
    estimated_revenue_impact: estimatedRevenue,
    status: 'pending_review',
    priority: priority
  };

  return auditRecord;
}

function useAutoFlagOASIS() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ oasisUpload, analysisResults }) => {
      const auditRecord = await autoFlagOASIS(oasisUpload, analysisResults);
      if (auditRecord) {
        // Check if already flagged
        const existing = await base44.entities.OASISAudit.filter({ 
          oasis_upload_id: oasisUpload.id 
        });
        
        if (existing.length === 0) {
          return await base44.entities.OASISAudit.create(auditRecord);
        }
        return existing[0];
      }
      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasisAudits'] });
    }
  });
}

export { autoFlagOASIS, useAutoFlagOASIS, THRESHOLDS };