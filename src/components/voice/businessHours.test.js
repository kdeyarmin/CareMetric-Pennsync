import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAY_KEYS,
  parseHHMM,
  wallClockInTimeZone,
  defaultBusinessHours,
  agencyHoursConfig,
  isWithinBusinessHours,
  isAgencyOpen,
  summarizeSchedule,
} from "./businessHours.js";

// All fixtures use America/New_York in June (EDT = UTC-4), so DST never shifts
// the assertions. 2026-06-04 is a Thursday.
const TZ = "America/New_York";
const weekday = (open, close) => ({ enabled: true, open, close });
const NINE_TO_FIVE = {
  mon: weekday("08:00", "17:00"),
  tue: weekday("08:00", "17:00"),
  wed: weekday("08:00", "17:00"),
  thu: weekday("08:00", "17:00"),
  fri: weekday("08:00", "17:00"),
  sat: { enabled: false },
  sun: { enabled: false },
};

test("parseHHMM parses valid times and rejects junk", () => {
  assert.equal(parseHHMM("08:00"), 480);
  assert.equal(parseHHMM("8:30"), 510);
  assert.equal(parseHHMM("23:59"), 1439);
  assert.equal(parseHHMM("00:00"), 0);
  assert.equal(parseHHMM("24:00"), null);
  assert.equal(parseHHMM("12:60"), null);
  assert.equal(parseHHMM("noon"), null);
  assert.equal(parseHHMM(""), null);
  assert.equal(parseHHMM(null), null);
});

test("a day with equal open/close (00:00-00:00) is open all day, not closed", () => {
  const config = {
    enabled: true,
    timeZone: TZ,
    days: { ...NINE_TO_FIVE, thu: weekday("00:00", "00:00") },
  };
  // Thursday 09:00 EDT and Thursday 21:00 EDT — both must report open.
  assert.equal(isWithinBusinessHours(new Date("2026-06-04T13:00:00Z"), config).open, true);
  assert.equal(isWithinBusinessHours(new Date("2026-06-05T01:00:00Z"), config).open, true);
});

test("wallClockInTimeZone resolves weekday + minutes in the target zone", () => {
  // 2026-06-04T13:00:00Z = 09:00 EDT on Thursday.
  const wc = wallClockInTimeZone(new Date("2026-06-04T13:00:00Z"), TZ);
  assert.equal(wc.weekday, 4); // Thu
  assert.equal(wc.minutes, 9 * 60);
  assert.equal(DAY_KEYS[wc.weekday], "thu");
});

test("isWithinBusinessHours is not enforced when disabled", () => {
  const r = isWithinBusinessHours(new Date(), { enabled: false, days: NINE_TO_FIVE, timeZone: TZ });
  assert.equal(r.open, true);
  assert.equal(r.reason, "not_enforced");
});

test("open during a weekday window", () => {
  // 09:00 EDT Thursday.
  const r = isWithinBusinessHours(new Date("2026-06-04T13:00:00Z"), {
    enabled: true,
    timeZone: TZ,
    days: NINE_TO_FIVE,
  });
  assert.equal(r.open, true);
  assert.equal(r.reason, "open");
  assert.equal(r.day, "thu");
});

test("after hours in the evening of an open day", () => {
  // 19:00 EDT Thursday.
  const r = isWithinBusinessHours(new Date("2026-06-04T23:00:00Z"), {
    enabled: true,
    timeZone: TZ,
    days: NINE_TO_FIVE,
  });
  assert.equal(r.open, false);
  assert.equal(r.reason, "after_hours");
});

test("before opening counts as after hours", () => {
  // 07:59 EDT Thursday.
  const r = isWithinBusinessHours(new Date("2026-06-04T11:59:00Z"), {
    enabled: true,
    timeZone: TZ,
    days: NINE_TO_FIVE,
  });
  assert.equal(r.open, false);
  assert.equal(r.reason, "after_hours");
});

test("the closing minute is already closed (half-open interval)", () => {
  // 17:00 EDT exactly → closed (window is [open, close)).
  const r = isWithinBusinessHours(new Date("2026-06-04T21:00:00Z"), {
    enabled: true,
    timeZone: TZ,
    days: NINE_TO_FIVE,
  });
  assert.equal(r.open, false);
});

test("a disabled day is closed all day", () => {
  // 12:00 EDT Saturday.
  const r = isWithinBusinessHours(new Date("2026-06-06T16:00:00Z"), {
    enabled: true,
    timeZone: TZ,
    days: NINE_TO_FIVE,
  });
  assert.equal(r.open, false);
  assert.equal(r.reason, "closed_day");
  assert.equal(r.day, "sat");
});

test("a day with no parseable hours is closed, not crashing", () => {
  const r = isWithinBusinessHours(new Date("2026-06-04T13:00:00Z"), {
    enabled: true,
    timeZone: TZ,
    days: { thu: { enabled: true, open: "", close: "" } },
  });
  assert.equal(r.open, false);
  assert.equal(r.reason, "no_hours_set");
});

test("overnight windows wrap past midnight", () => {
  const overnight = { wed: weekday("22:00", "06:00"), thu: weekday("22:00", "06:00") };
  // 23:00 EDT Wednesday → inside the wrap.
  const late = isWithinBusinessHours(new Date("2026-06-04T03:00:00Z"), {
    enabled: true,
    timeZone: TZ,
    days: overnight,
  });
  assert.equal(late.open, true);
  // 13:00 EDT Thursday → outside the wrap.
  const noon = isWithinBusinessHours(new Date("2026-06-04T17:00:00Z"), {
    enabled: true,
    timeZone: TZ,
    days: overnight,
  });
  assert.equal(noon.open, false);
});

test("an invalid timezone falls back to local time without throwing", () => {
  const r = isWithinBusinessHours(new Date("2026-06-04T13:00:00Z"), {
    enabled: true,
    timeZone: "Not/AZone",
    days: NINE_TO_FIVE,
  });
  assert.equal(typeof r.open, "boolean");
  assert.ok(["open", "after_hours", "closed_day", "no_hours_set"].includes(r.reason));
});

test("a holiday closes the practice even on an open weekday", () => {
  // 2026-06-04 is a Thursday inside the 9–5 window, but listed as a holiday.
  const r = isWithinBusinessHours(new Date("2026-06-04T13:00:00Z"), {
    enabled: true,
    timeZone: TZ,
    days: NINE_TO_FIVE,
    holidays: ["2026-06-04"],
  });
  assert.equal(r.open, false);
  assert.equal(r.reason, "holiday");
  assert.equal(r.date, "2026-06-04");
});

test("holiday matching uses the date in the configured timezone", () => {
  // 2026-06-05T02:00:00Z is still 2026-06-04 (22:00) in New York.
  const r = isWithinBusinessHours(new Date("2026-06-05T02:00:00Z"), {
    enabled: true,
    timeZone: TZ,
    days: NINE_TO_FIVE,
    holidays: ["2026-06-04"],
  });
  // It's after hours anyway, but the reason should reflect the holiday date.
  assert.equal(r.reason, "holiday");
  assert.equal(r.date, "2026-06-04");
});

test("a non-holiday day is unaffected by the holiday list", () => {
  const r = isWithinBusinessHours(new Date("2026-06-04T13:00:00Z"), {
    enabled: true,
    timeZone: TZ,
    days: NINE_TO_FIVE,
    holidays: ["2026-12-25"],
  });
  assert.equal(r.open, true);
});

test("agencyHoursConfig maps the flat AgencySettings fields", () => {
  const cfg = agencyHoursConfig({
    business_hours_enabled: true,
    business_hours_timezone: TZ,
    business_hours: NINE_TO_FIVE,
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.timeZone, TZ);
  assert.equal(cfg.days, NINE_TO_FIVE);
  assert.deepEqual(
    agencyHoursConfig({ business_hours_holidays: ["2026-12-25"] }).holidays,
    ["2026-12-25"],
  );
  // Defensive defaults for an empty settings object.
  const empty = agencyHoursConfig(undefined);
  assert.equal(empty.enabled, false);
  assert.deepEqual(empty.days, {});
  assert.deepEqual(empty.holidays, []);
});

test("isAgencyOpen reads straight from AgencySettings", () => {
  const open = isAgencyOpen(
    { business_hours_enabled: true, business_hours_timezone: TZ, business_hours: NINE_TO_FIVE },
    new Date("2026-06-04T13:00:00Z"),
  );
  assert.equal(open, true);
  // Disabled → always "open" (not enforced).
  assert.equal(isAgencyOpen({ business_hours_enabled: false }, new Date()), true);
});

test("defaultBusinessHours opens the weekdays only", () => {
  const week = defaultBusinessHours();
  assert.equal(week.mon.enabled, true);
  assert.equal(week.fri.enabled, true);
  assert.equal(week.sat.enabled, false);
  assert.equal(week.sun.enabled, false);
  assert.equal(week.mon.open, "08:00");
  assert.equal(week.mon.close, "17:00");
});

test("summarizeSchedule describes uniform and custom weeks", () => {
  assert.match(summarizeSchedule(NINE_TO_FIVE), /Mon, Tue, Wed, Thu, Fri: 08:00–17:00/);
  assert.equal(summarizeSchedule({ sat: { enabled: false }, sun: { enabled: false } }), "No open days set");
  const custom = { mon: weekday("08:00", "17:00"), tue: weekday("09:00", "15:00") };
  assert.match(summarizeSchedule(custom), /custom hours/);
});

test("summarizeSchedule ignores days missing a parseable close (matches evaluation)", () => {
  // open parses but close doesn't → not "open"; must not render "08:00–undefined".
  assert.equal(summarizeSchedule({ mon: { enabled: true, open: "08:00", close: "" } }), "No open days set");
  assert.equal(summarizeSchedule({ mon: { enabled: true, open: "08:00" } }), "No open days set");
  // A valid day alongside an invalid one only counts the valid one.
  const mixed = { mon: weekday("08:00", "17:00"), tue: { enabled: true, open: "09:00", close: "bad" } };
  assert.match(summarizeSchedule(mixed), /^Mon: 08:00–17:00$/);
});
