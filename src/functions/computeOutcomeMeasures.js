import { base44 } from '@/api/base44Client';

// Pairs Discharge OASIS with SOC/ROC, writes PatientOutcomeMetric per episode,
// and rolls up CMS outcome measures into AgencyKPI rows. See
// base44/functions/computeOutcomeMeasures/entry.ts and the unit-tested engine
// src/components/oasis/outcomeMeasureEngine.js.
export const computeOutcomeMeasures = (payload = {}) =>
  base44.functions.invoke('computeOutcomeMeasures', payload);
