// Pure, stateless color helpers for OASIS analysis score/severity display.
// Extracted from OASISAnalyzer.jsx so they can be reused and unit-tested.

export const getScoreColor = (score) => {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-600";
};

export const getScoreBg = (score) => {
  if (score >= 80) return "bg-green-100 border-green-300";
  if (score >= 60) return "bg-yellow-100 border-yellow-300";
  return "bg-red-100 border-red-300";
};

export const getSeverityBadge = (severity) => {
  const colors = {
    high: "bg-red-100 text-red-800 border-red-300",
    medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
    low: "bg-blue-100 text-blue-800 border-blue-300",
  };
  return colors[severity] || "bg-slate-100 text-slate-800";
};