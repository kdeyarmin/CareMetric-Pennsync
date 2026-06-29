/** Utility helpers for OASIS workflow rule parsing and trigger evaluation. */
export const deriveActionTypes = (rule = {}) => {
  const configuredActions = rule?.action_config?.actions;
  if (Array.isArray(configuredActions) && configuredActions.length > 0) {
    return configuredActions;
  }

  if (rule?.action_type) {
    return [rule.action_type];
  }

  return [];
};

export const evaluateRuleTrigger = (rule = {}, analysis = {}, pdgm = {}) => {
  const conditions = rule.trigger_conditions || {};
  let triggered = false;
  let reason = "";
  let context = {};

  switch (rule.trigger_type) {
    case "compliance_issue":
      if (analysis.compliance_score < (conditions.score_value || 80)) {
        triggered = true;
        reason = `Compliance score ${analysis.compliance_score}% below threshold`;
        context = {
          compliance_score: analysis.compliance_score,
          concerns: analysis.compliance_concerns?.slice(0, 3) || []
        };
      }
      break;

    case "revenue_opportunity": {
      const matchingOpportunities = analysis.revenue_tips?.filter((tip) =>
        conditions.severity_levels?.includes(tip.potential_impact)
      ) || [];

      if (matchingOpportunities.length > 0) {
        triggered = true;
        reason = "High-impact revenue opportunities identified";
        context = { opportunities: matchingOpportunities };
      }
      break;
    }

    case "accuracy_concern":
      if (analysis.accuracy_score < (conditions.score_value || 80)) {
        triggered = true;
        reason = `Accuracy score ${analysis.accuracy_score}% below threshold`;
        context = {
          accuracy_score: analysis.accuracy_score,
          issues: analysis.accuracy_issues?.slice(0, 3) || []
        };
      }
      break;

    case "score_threshold": {
      const scoreType = conditions.score_type || "overall";
      const scoreMap = {
        overall: analysis.overall_score,
        compliance: analysis.compliance_score,
        accuracy: analysis.accuracy_score
      };
      const scoreToCheck = scoreMap[scoreType];
      if (scoreToCheck == null) break;

      const meetsCondition =
        conditions.score_operator === "less_than"
          ? scoreToCheck < conditions.score_value
          : conditions.score_operator === "greater_than"
            ? scoreToCheck > conditions.score_value
            : scoreToCheck === conditions.score_value;

      if (meetsCondition) {
        triggered = true;
        reason = `${scoreType} score ${scoreToCheck}% ${conditions.score_operator?.replace("_", " ")} ${conditions.score_value}%`;
        context = { score: scoreToCheck };
      }
      break;
    }

    case "specific_m_item": {
      const flaggedItems = analysis.accuracy_issues?.filter((issue) =>
        conditions.m_item_codes?.includes(issue.item)
      ) || [];

      if (flaggedItems.length > 0) {
        triggered = true;
        reason = "Targeted M-items flagged for review";
        context = { flagged_items: flaggedItems };
      }
      break;
    }

    case "missing_documentation":
      if ((analysis.missing_high_value_documentation?.length || 0) > 0) {
        triggered = true;
        reason = "Missing high-value documentation detected";
        context = {
          missing_docs: analysis.missing_high_value_documentation?.slice(0, 3) || []
        };
      }
      break;

    case "pdgm_discrepancy":
      if (pdgm?.clinical_group && (analysis.revenue_tips?.length || 0) > 0) {
        triggered = true;
        reason = "PDGM grouping opportunities identified";
        context = {
          clinical_group: pdgm.clinical_group,
          revenue_tips: analysis.revenue_tips?.slice(0, 2) || []
        };
      }
      break;

    default:
      break;
  }

  return { triggered, reason, context };
};
