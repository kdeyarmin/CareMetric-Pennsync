// Pure aggregation helpers for the OASIS analytics dashboard.
//
// Extracted from the OASISAnalyzer page (which was a ~3k-line mega-component)
// so the data-shaping logic is reusable and unit-testable in isolation, with
// the page left to do only rendering. Behaviour is intentionally identical to
// the previous inline useMemo blocks.

/**
 * Completed-years age from a date-of-birth string, accounting for whether the
 * birthday has occurred this year. Plain year-subtraction counts a pre-birthday
 * patient one year too old, which can shift them into the wrong Medicare age band
 * at the 65 boundary. Returns NaN for missing/unparseable input.
 * @param {string} dob
 * @returns {number}
 */
export function computeAge(dob, now = new Date()) {
  if (!dob || dob === "Not found") return NaN;
  // Parse a bare ISO date (YYYY-MM-DD) as PLAIN calendar components — `new
  // Date("YYYY-MM-DD")` parses as UTC midnight, so in a timezone behind UTC the
  // local Y/M/D shifts to the previous day (e.g. 1961-12-01 → 1961-11-30 local),
  // corrupting the birthday comparison this helper exists to get right. Only
  // fall back to Date parsing for non-ISO formats.
  let year, month, day;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(dob).trim());
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
    // Validate the components so a malformed-but-ISO-shaped value (e.g.
    // "2020-99-99" from a bad OCR extract) is treated as Unknown rather than
    // silently producing a real-looking age band. Round-trip through a UTC date.
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() !== month - 1 ||
      probe.getUTCDate() !== day
    ) {
      return NaN;
    }
  } else {
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return NaN;
    year = d.getFullYear(); month = d.getMonth() + 1; day = d.getDate();
  }
  let age = now.getFullYear() - year;
  const monthDelta = (now.getMonth() + 1) - month;
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < day)) age -= 1;
  return age;
}

/** @param {any[]} uploads */
export function aggregateDemographics(uploads = []) {
  const genderCount = { Male: 0, Female: 0, Unknown: 0 };
  const ageRanges = { "0-64": 0, "65-74": 0, "75-84": 0, "85+": 0, Unknown: 0 };

  uploads.forEach((upload) => {
    const gender = (upload.pdgm_data?.patient_info?.gender || "Unknown").toLowerCase();
    // Check female FIRST: "female" contains an "m", so testing includes("m")
    // before "f" miscounts every female as male — a latent bug in the original
    // inline version this was extracted from, surfaced by the unit tests.
    if (gender.includes("f")) genderCount.Female++;
    else if (gender.includes("m")) genderCount.Male++;
    else genderCount.Unknown++;

    const dob = upload.pdgm_data?.patient_info?.dob;
    const age = computeAge(dob);
    // An unparseable dob yields NaN; every `age < N` test is false, so without
    // this guard it would silently fall through to "85+" instead of "Unknown".
    if (!Number.isFinite(age)) ageRanges.Unknown++;
    else if (age < 65) ageRanges["0-64"]++;
    else if (age < 75) ageRanges["65-74"]++;
    else if (age < 85) ageRanges["75-84"]++;
    else ageRanges["85+"]++;
  });

  return {
    gender: Object.entries(genderCount).map(([name, value]) => ({ name, value })),
    age: Object.entries(ageRanges).map(([name, value]) => ({ name, value })),
  };
}

/** Top primary diagnoses by frequency. @param {any[]} uploads */
export function aggregateTopDiagnoses(uploads = [], limit = 10) {
  const diagnosisCount = {};
  uploads.forEach((upload) => {
    const primaryDx = upload.pdgm_data?.primary_diagnosis || upload.pdgm_data?.primary_diagnosis_description;
    if (primaryDx && primaryDx !== "Unknown" && primaryDx !== "Not found") {
      const dxKey = primaryDx.substring(0, 50); // Truncate for display
      diagnosisCount[dxKey] = (diagnosisCount[dxKey] || 0) + 1;
    }
  });
  return Object.entries(diagnosisCount)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Functional scores over time (most recent `limit`). @param {any[]} uploads */
export function aggregateFunctionalScores(uploads = [], limit = 20) {
  return uploads
    .filter((u) => u.assessment_date && u.pdgm_data?.functional_scores)
    .sort((a, b) => new Date(a.assessment_date) - new Date(b.assessment_date))
    .slice(-limit)
    .map((upload) => ({
      date: new Date(upload.assessment_date).toLocaleDateString(),
      ambulation: upload.pdgm_data?.functional_scores?.m1860_ambulation || 0,
      transferring: upload.pdgm_data?.functional_scores?.m1850_transferring || 0,
      bathing: upload.pdgm_data?.functional_scores?.m1830_bathing || 0,
      patient: upload.patient_name?.substring(0, 15) || "Unknown",
    }));
}

/** PDGM payment trends (most recent `limit` with a payment). @param {any[]} uploads */
export function aggregatePaymentTrends(uploads = [], limit = 15) {
  return uploads
    .filter((u) => u.assessment_date && u.estimated_payment)
    .sort((a, b) => new Date(a.assessment_date) - new Date(b.assessment_date))
    .slice(-limit)
    .map((upload) => ({
      date: new Date(upload.assessment_date).toLocaleDateString(),
      payment: upload.estimated_payment,
      patient: upload.patient_name?.substring(0, 15) || "Unknown",
    }));
}

/** Headline summary statistics. @param {any[]} uploads */
export function computeSummaryStats(uploads = []) {
  const totalAssessments = uploads.length;
  const avgScore = uploads.reduce((sum, u) => sum + (u.scores?.overall || 0), 0) / totalAssessments || 0;
  const paid = uploads.filter((u) => u.estimated_payment);
  const avgPayment = paid.reduce((sum, u) => sum + u.estimated_payment, 0) / paid.length || 0;
  const totalRevenue = uploads.reduce((sum, u) => sum + (u.estimated_payment || 0), 0);
  return { totalAssessments, avgScore, avgPayment, totalRevenue };
}
