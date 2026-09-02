export const PDGM_UNAVAILABLE_LABEL = "Unavailable";
export const PDGM_REIMBURSEMENT_ENABLED = false;
export const PDGM_REIMBURSEMENT_BLOCKER =
  "The app does not yet use a verified CMS HHGS 432-group grouper with golden-case tests.";
export const PDGM_REIMBURSEMENT_ACTION =
  "Use the official EMR/CMS-approved grouper for billing and reimbursement decisions.";

export function isFinitePdgmNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

export function getPdgmPaymentState(result) {
  const available = PDGM_REIMBURSEMENT_ENABLED
    && Boolean(result)
    && result.incomplete !== true
    && result.paymentAvailable === true
    && isFinitePdgmNumber(result.totalPayment);

  if (available) {
    return {
      available: true,
      amount: result.totalPayment,
      reason: null,
      message: null,
      actions: [],
    };
  }

  const actions = uniqueStrings([
    ...(Array.isArray(result?.actionRequired) ? result.actionRequired : []),
    ...(Array.isArray(result?.blockers) ? result.blockers.map((blocker) => blocker?.action) : []),
  ]);

  return {
    available: false,
    amount: null,
    reason: result?.reason || "pdgm_payment_unavailable",
    message: result?.message
      || `PDGM payment is unavailable — this is not a $0 result. ${PDGM_REIMBURSEMENT_BLOCKER}`,
    actions: actions.length > 0 ? actions : [PDGM_REIMBURSEMENT_ACTION],
  };
}

export function getPdgmComparisonState(revenueData) {
  const original = getPdgmPaymentState(revenueData?.original);
  const corrected = getPdgmPaymentState(revenueData?.corrected);
  const available = original.available
    && corrected.available
    && isFinitePdgmNumber(revenueData?.revenueDifference)
    && isFinitePdgmNumber(revenueData?.percentageIncrease);

  return {
    available,
    original,
    corrected,
    reason: available ? null : (original.reason || corrected.reason || "pdgm_comparison_unavailable"),
    message: available ? null : (original.message || corrected.message
      || "PDGM payment comparison is unavailable — this is not a $0 result."),
    actions: available ? [] : uniqueStrings([...original.actions, ...corrected.actions]),
  };
}

export function getAlternativeScenarioState(alternativeScenarios) {
  const scenarios = Object.values(alternativeScenarios?.scenarios || {});
  const available = alternativeScenarios?.available === true
    && scenarios.length > 0
    && scenarios.every((scenario) => getPdgmPaymentState(scenario).available)
    && isFinitePdgmNumber(alternativeScenarios?.minPayment)
    && isFinitePdgmNumber(alternativeScenarios?.maxPayment)
    && isFinitePdgmNumber(alternativeScenarios?.paymentRange);

  return {
    available,
    reason: available ? null : (alternativeScenarios?.reason || "pdgm_scenarios_unavailable"),
    message: available ? null : (alternativeScenarios?.message
      || "Alternative PDGM scenario payments are unavailable — this is not a $0 result."),
  };
}

export function formatPdgmCurrency(value) {
  if (!isFinitePdgmNumber(value)) return PDGM_UNAVAILABLE_LABEL;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPdgmNumber(value, fractionDigits = 4) {
  return isFinitePdgmNumber(value) ? value.toFixed(fractionDigits) : PDGM_UNAVAILABLE_LABEL;
}

export function buildPdgmRevenueExportRows(revenueData) {
  const comparison = getPdgmComparisonState(revenueData);
  const rows = [
    ["PDGM Payment Status", comparison.available ? "Available" : PDGM_UNAVAILABLE_LABEL],
    ["Original Payment", formatPdgmCurrency(comparison.original.amount)],
    ["Optimized Payment", formatPdgmCurrency(comparison.corrected.amount)],
    ["Revenue Difference", comparison.available ? formatPdgmCurrency(revenueData.revenueDifference) : PDGM_UNAVAILABLE_LABEL],
    ["Percentage Increase", comparison.available ? `${revenueData.percentageIncrease.toFixed(1)}%` : PDGM_UNAVAILABLE_LABEL],
  ];

  if (!comparison.available) {
    rows.push(["Unavailable Reason", comparison.message]);
    if (comparison.actions.length > 0) {
      rows.push(["Required Action", comparison.actions.join("; ")]);
    }
  }

  return rows;
}

export function redactUnavailableNavigationFinancials(navigation, paymentState) {
  if (!navigation || paymentState?.available === true) return navigation;

  return {
    ...navigation,
    paymentAvailable: false,
    paymentMessage: paymentState?.message
      || "PDGM payment is unavailable — this is not a $0 result.",
    actionRequired: paymentState?.actions || [],
    case_mix_calculation: null,
    discrepancies: Array.isArray(navigation.discrepancies)
      ? navigation.discrepancies.map(({
          revenue_impact: _revenueImpactSnake,
          revenueImpact: _revenueImpactCamel,
          ...item
        }) => item)
      : navigation.discrepancies,
    optimization_opportunities: Array.isArray(navigation.optimization_opportunities)
      ? navigation.optimization_opportunities.map(({ potential_impact: _potentialImpact, ...item }) => item)
      : navigation.optimization_opportunities,
    summary: navigation.summary
      ? { ...navigation.summary, payment_amount: null }
      : navigation.summary,
  };
}
