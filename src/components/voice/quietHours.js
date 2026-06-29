/**
 * quietHours — TCPA "quiet hours" guard keyed to the RECIPIENT's local time.
 *
 * The TCPA restricts marketing/automated texts and calls to roughly 8:00am–
 * 9:00pm in the *called party's* timezone. Agency business hours (businessHours)
 * are a single global schedule; this is a separate, recipient-specific legal
 * floor: even during business hours, a patient on the far coast might be in
 * their quiet hours. We derive the recipient timezone from their North American
 * area code (best-effort) and check the window in that zone.
 *
 * Pure + unit-tested; mirrored inline into the outbound send paths.
 *
 * When the timezone can't be resolved (unknown/non-NANP area code), the guard
 * FAILS OPEN (`allowed: true`, `reason: 'unknown_timezone'`) so legitimate sends
 * aren't blocked by an incomplete table — callers can surface a soft warning.
 */

// Area code → IANA timezone (best-effort; US/Canada NANP). Not exhaustive —
// extend as needed. Codes that straddle zones are mapped to their dominant zone.
export const AREA_CODE_TIMEZONE = {
  // Eastern
  201: "America/New_York", 202: "America/New_York", 203: "America/New_York", 207: "America/New_York",
  212: "America/New_York", 215: "America/New_York", 216: "America/New_York", 220: "America/New_York",
  223: "America/New_York", 234: "America/New_York", 239: "America/New_York", 240: "America/New_York",
  267: "America/New_York", 272: "America/New_York", 276: "America/New_York", 290: "America/New_York",
  301: "America/New_York", 302: "America/New_York", 304: "America/New_York", 305: "America/New_York",
  321: "America/New_York", 324: "America/New_York", 330: "America/New_York", 339: "America/New_York",
  347: "America/New_York", 351: "America/New_York", 352: "America/New_York", 386: "America/New_York",
  401: "America/New_York", 404: "America/New_York", 407: "America/New_York", 410: "America/New_York",
  412: "America/New_York", 413: "America/New_York", 419: "America/New_York", 434: "America/New_York",
  440: "America/New_York", 443: "America/New_York", 470: "America/New_York", 475: "America/New_York",
  478: "America/New_York", 484: "America/New_York", 502: "America/New_York", 508: "America/New_York",
  513: "America/New_York", 516: "America/New_York", 517: "America/New_York", 518: "America/New_York",
  540: "America/New_York", 551: "America/New_York", 561: "America/New_York", 564: "America/New_York",
  567: "America/New_York", 570: "America/New_York", 571: "America/New_York", 585: "America/New_York",
  607: "America/New_York", 610: "America/New_York", 614: "America/New_York", 617: "America/New_York",
  631: "America/New_York", 646: "America/New_York", 667: "America/New_York", 678: "America/New_York",
  680: "America/New_York", 689: "America/New_York", 703: "America/New_York", 716: "America/New_York",
  717: "America/New_York", 718: "America/New_York", 724: "America/New_York", 727: "America/New_York",
  732: "America/New_York", 740: "America/New_York", 743: "America/New_York", 754: "America/New_York",
  757: "America/New_York", 770: "America/New_York", 772: "America/New_York", 774: "America/New_York",
  781: "America/New_York", 786: "America/New_York", 803: "America/New_York", 804: "America/New_York",
  810: "America/New_York", 813: "America/New_York", 814: "America/New_York", 828: "America/New_York",
  843: "America/New_York", 845: "America/New_York", 848: "America/New_York", 856: "America/New_York",
  857: "America/New_York", 859: "America/New_York", 862: "America/New_York", 863: "America/New_York",
  864: "America/New_York", 878: "America/New_York", 904: "America/New_York", 908: "America/New_York",
  910: "America/New_York", 912: "America/New_York", 914: "America/New_York", 919: "America/New_York",
  929: "America/New_York", 934: "America/New_York", 937: "America/New_York", 941: "America/New_York",
  947: "America/New_York", 954: "America/New_York", 959: "America/New_York", 980: "America/New_York",
  984: "America/New_York", 989: "America/New_York",
  // Central
  205: "America/Chicago", 210: "America/Chicago", 214: "America/Chicago", 217: "America/Chicago",
  218: "America/Chicago", 224: "America/Chicago", 225: "America/Chicago", 228: "America/Chicago",
  251: "America/Chicago", 254: "America/Chicago", 256: "America/Chicago", 262: "America/Chicago",
  281: "America/Chicago", 309: "America/Chicago", 312: "America/Chicago", 314: "America/Chicago",
  316: "America/Chicago", 318: "America/Chicago", 319: "America/Chicago", 320: "America/Chicago",
  331: "America/Chicago", 334: "America/Chicago", 337: "America/Chicago", 346: "America/Chicago",
  361: "America/Chicago", 402: "America/Chicago", 405: "America/Chicago", 409: "America/Chicago",
  414: "America/Chicago", 417: "America/Chicago", 430: "America/Chicago", 432: "America/Chicago",
  447: "America/Chicago", 469: "America/Chicago", 479: "America/Chicago", 501: "America/Chicago",
  504: "America/Chicago", 507: "America/Chicago", 512: "America/Chicago", 515: "America/Chicago",
  563: "America/Chicago", 573: "America/Chicago", 580: "America/Chicago", 601: "America/Chicago",
  605: "America/Chicago", 608: "America/Chicago", 612: "America/Chicago", 618: "America/Chicago",
  620: "America/Chicago", 630: "America/Chicago", 636: "America/Chicago", 641: "America/Chicago",
  651: "America/Chicago", 660: "America/Chicago", 682: "America/Chicago", 708: "America/Chicago",
  712: "America/Chicago", 713: "America/Chicago", 715: "America/Chicago", 731: "America/Chicago",
  737: "America/Chicago", 763: "America/Chicago", 769: "America/Chicago", 773: "America/Chicago",
  779: "America/Chicago", 785: "America/Chicago", 815: "America/Chicago", 816: "America/Chicago",
  817: "America/Chicago", 830: "America/Chicago", 832: "America/Chicago", 847: "America/Chicago",
  870: "America/Chicago", 872: "America/Chicago", 901: "America/Chicago", 903: "America/Chicago",
  913: "America/Chicago", 918: "America/Chicago", 920: "America/Chicago",
  936: "America/Chicago", 940: "America/Chicago", 952: "America/Chicago",
  956: "America/Chicago", 972: "America/Chicago", 979: "America/Chicago",
  // Mountain
  208: "America/Denver", 303: "America/Denver", 307: "America/Denver", 385: "America/Denver",
  915: "America/Denver", // El Paso, TX — Mountain time, not Central
  406: "America/Denver", 435: "America/Denver", 505: "America/Denver", 575: "America/Denver",
  719: "America/Denver", 720: "America/Denver", 801: "America/Denver", 970: "America/Denver",
  // Arizona (no DST)
  480: "America/Phoenix", 520: "America/Phoenix", 602: "America/Phoenix", 623: "America/Phoenix", 928: "America/Phoenix",
  // Pacific
  206: "America/Los_Angeles", 209: "America/Los_Angeles", 213: "America/Los_Angeles", 253: "America/Los_Angeles",
  279: "America/Los_Angeles", 310: "America/Los_Angeles", 323: "America/Los_Angeles", 341: "America/Los_Angeles",
  360: "America/Los_Angeles", 408: "America/Los_Angeles", 415: "America/Los_Angeles", 424: "America/Los_Angeles",
  425: "America/Los_Angeles", 442: "America/Los_Angeles", 503: "America/Los_Angeles", 509: "America/Los_Angeles",
  510: "America/Los_Angeles", 530: "America/Los_Angeles", 541: "America/Los_Angeles", 559: "America/Los_Angeles",
  562: "America/Los_Angeles", 619: "America/Los_Angeles", 626: "America/Los_Angeles", 628: "America/Los_Angeles",
  650: "America/Los_Angeles", 657: "America/Los_Angeles", 661: "America/Los_Angeles", 669: "America/Los_Angeles",
  707: "America/Los_Angeles", 714: "America/Los_Angeles", 747: "America/Los_Angeles", 760: "America/Los_Angeles",
  775: "America/Los_Angeles", 805: "America/Los_Angeles", 818: "America/Los_Angeles", 820: "America/Los_Angeles",
  831: "America/Los_Angeles", 858: "America/Los_Angeles", 909: "America/Los_Angeles", 916: "America/Los_Angeles",
  925: "America/Los_Angeles", 949: "America/Los_Angeles", 951: "America/Los_Angeles", 971: "America/Los_Angeles",
  // Alaska / Hawaii
  907: "America/Anchorage", 808: "Pacific/Honolulu",
};

/** Last 10 digits of a phone number (NANP), or "" when fewer than 10. */
function nanp10(raw) {
  const d = String(raw || "").replace(/[^\d]/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? ten : "";
}

/** Resolve the IANA timezone for a phone number's area code, or null. */
export function timezoneForNumber(raw) {
  const ten = nanp10(raw);
  if (!ten) return null;
  return AREA_CODE_TIMEZONE[Number(ten.slice(0, 3))] || null;
}

/** The recipient's wall-clock hour (0–23) in their timezone, or null. */
function hourInZone(date, timeZone) {
  try {
    const h = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, hour: "2-digit" }).format(date);
    let n = parseInt(h, 10);
    if (n === 24) n = 0;
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

/**
 * Is `now` within the recipient's allowed contact window? Default window is the
 * TCPA-safe 8:00am–9:00pm (inclusive of 8:00, exclusive of 21:00) in the
 * recipient's local time.
 *
 * Returns { allowed, reason, timeZone, localHour }:
 *   - reason 'within_hours' / 'quiet_hours' when the zone is known
 *   - reason 'unknown_timezone' (allowed: true) when it can't be resolved
 *   - reason 'disabled' (allowed: true) when enforcement is off
 */
/**
 * Map AgencySettings → the isWithinQuietHours options so the client util and the
 * inline backend send-path mirrors derive the window IDENTICALLY. Admins can
 * customize the TCPA window via tcpa_quiet_start_hour / tcpa_quiet_end_hour;
 * without this helper the source util only knew the hardcoded 8/21 defaults while
 * the backend honored the custom values (silent drift). Mirrors the backend's
 * `Number(settings?.tcpa_quiet_start_hour ?? 8)` reads exactly.
 */
export function agencyQuietHoursConfig(settings) {
  const s = settings || {};
  return {
    enabled: s.tcpa_quiet_hours_enabled === true,
    startHour: Number(s.tcpa_quiet_start_hour ?? 8),
    endHour: Number(s.tcpa_quiet_end_hour ?? 21),
  };
}

export function isWithinQuietHours(toNumber, now = new Date(), { enabled = true, startHour = 8, endHour = 21 } = {}) {
  if (!enabled) return { allowed: true, reason: "disabled" };
  const timeZone = timezoneForNumber(toNumber);
  if (!timeZone) return { allowed: true, reason: "unknown_timezone", timeZone: null, localHour: null };
  const localHour = hourInZone(now, timeZone);
  if (localHour == null) return { allowed: true, reason: "unknown_timezone", timeZone, localHour: null };
  // startHour/endHour define the ALLOWED contact window. Support a window that
  // wraps past midnight (start > end, e.g. allowed 22:00–06:00): then the allowed
  // span is [start, 24) ∪ [0, end). For the normal daytime window (start < end)
  // this is the usual half-open interval. start === end means "all day".
  const allowed = startHour === endHour
    ? true
    : startHour < endHour
      ? (localHour >= startHour && localHour < endHour)
      : (localHour >= startHour || localHour < endHour);
  return { allowed, reason: allowed ? "within_hours" : "quiet_hours", timeZone, localHour };
}
