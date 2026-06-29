// Pure, stateless display helpers for the PDGM Navigator.
// Extracted from AutomatedPDGMNavigator.jsx so they can be reused and unit-tested.

export const getConfidenceBadge = (confidence) => {
  const styles = {
    high: 'bg-green-100 text-green-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-red-100 text-red-800',
  };
  return styles[confidence] || styles.medium;
};

export const getSeverityBadge = (severity) => {
  const styles = {
    critical: 'bg-red-600 text-white',
    high: 'bg-orange-500 text-white',
    medium: 'bg-yellow-500 text-white',
    low: 'bg-blue-500 text-white',
  };
  return styles[severity] || styles.medium;
};

export const getPriorityColor = (priority) => {
  const colors = {
    critical: 'bg-red-600 text-white',
    high: 'bg-orange-500 text-white',
    medium: 'bg-yellow-500 text-white',
    low: 'bg-blue-500 text-white',
  };
  return colors[priority] || colors.medium;
};

export const getLevelColor = (level) => {
  if (level === 'high') return 'text-green-600 bg-green-100';
  if (level === 'medium') return 'text-yellow-600 bg-yellow-100';
  return 'text-blue-600 bg-blue-100';
};

export const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);