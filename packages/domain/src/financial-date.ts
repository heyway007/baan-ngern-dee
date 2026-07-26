export function toFinancialDate(
  utcInstant: string,
  timeZone: string
): string {
  const instant = new Date(utcInstant);

  if (Number.isNaN(instant.getTime())) {
    throw new Error("INVALID_INSTANT");
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric"
    });
  } catch {
    throw new Error("INVALID_TIMEZONE");
  }

  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type === "day" || part.type === "month" || part.type === "year")
      .map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}
