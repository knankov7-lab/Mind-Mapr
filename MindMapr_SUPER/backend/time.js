const SOFIA_TIME_ZONE = "Europe/Sofia";

function getFormatterParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SOFIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  return Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
}

function toSofiaSqlString(date = new Date()) {
  const { year, month, day, hour, minute, second } = getFormatterParts(date);
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

module.exports = {
  SOFIA_TIME_ZONE,
  toSofiaSqlString,
};