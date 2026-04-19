export const BG_LOCALE = "bg-BG";
export const SOFIA_TIME_ZONE = "Europe/Sofia";

const sofiaTimeFormatter = new Intl.DateTimeFormat(BG_LOCALE, {
  timeZone: SOFIA_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const sofiaDateTimeFormatter = new Intl.DateTimeFormat(BG_LOCALE, {
  timeZone: SOFIA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function getOffsetMinutesForSofia(date) {
  const offsetPart = new Intl.DateTimeFormat("en-US", {
    timeZone: SOFIA_TIME_ZONE,
    timeZoneName: "longOffset",
    hour: "2-digit",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName");

  const offsetText = offsetPart?.value || "GMT+00:00";
  const match = offsetText.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;

  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

function parseSofiaSqlDate(value) {
  const match = String(value || "").trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
  );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  const approxUtc = new Date(Date.UTC(year, month, day, hour, minute, second));
  const offsetMinutes = getOffsetMinutesForSofia(approxUtc);
  return new Date(approxUtc.getTime() - offsetMinutes * 60_000);
}

export function parseProjectDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(text)) {
    return parseSofiaSqlDate(text);
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatSofiaTime(value) {
  const date = parseProjectDate(value);
  return date ? sofiaTimeFormatter.format(date) : "";
}

export function formatSofiaDateTime(value) {
  const date = parseProjectDate(value);
  return date ? sofiaDateTimeFormatter.format(date) : "";
}

export function getSofiaNowTime() {
  return sofiaTimeFormatter.format(new Date());
}