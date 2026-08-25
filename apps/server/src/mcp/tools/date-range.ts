export type McpDateRangeInput = Readonly<{
  range?:
    | Readonly<{
        from: string;
        to: string;
      }>
    | undefined;
  date?: string | undefined;
  preset?: "today" | undefined;
  timezone?: string | undefined;
}>;

export type McpDateRange = Readonly<{
  from: string;
  to: string;
  localDate?: string | undefined;
  timezone?: string | undefined;
}>;

const defaultTimezone = "Asia/Jerusalem";

export function normalizeMcpDateRange(input: McpDateRangeInput): McpDateRange {
  if (input.range !== undefined) {
    return normalizeIsoRange(input.range);
  }

  if (input.date !== undefined) {
    return localDayRange(input.date, input.timezone ?? defaultTimezone);
  }

  if (input.preset === "today") {
    return localDayRange(
      localDate(new Date(), input.timezone ?? defaultTimezone),
      input.timezone ?? defaultTimezone,
    );
  }

  throw new Error("Provide range, date, or preset='today'.");
}

export function previousDaysRange(days: number): McpDateRange {
  const to = new Date();
  const from = new Date(to);

  from.setUTCDate(from.getUTCDate() - days);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

export function localFoodDateTimeToUtc(input: {
  localFoodDate: string;
  localTime?: string | undefined;
  timezone: string;
}): string {
  const time = input.localTime ?? "12:00";
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.localFoodDate);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);

  if (dateMatch === null) {
    throw new Error("localFoodDate must use YYYY-MM-DD format.");
  }

  if (timeMatch === null) {
    throw new Error("localTime must use HH:mm format.");
  }

  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (hour > 23 || minute > 59) {
    throw new Error("localTime must use HH:mm format.");
  }

  return zonedDateTimeToUtc(
    Number(yearText),
    Number(monthText),
    Number(dayText),
    hour,
    minute,
    input.timezone,
  ).toISOString();
}

function normalizeIsoRange(range: Readonly<{ from: string; to: string }>) {
  const fromTime = Date.parse(range.from);
  const toTime = Date.parse(range.to);

  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) {
    throw new Error("Range timestamps must be valid ISO date strings.");
  }

  if (fromTime >= toTime) {
    throw new Error("Range 'from' must be before range 'to'.");
  }

  return {
    from: new Date(fromTime).toISOString(),
    to: new Date(toTime).toISOString(),
  };
}

function localDayRange(date: string, timezone: string): McpDateRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("date must use YYYY-MM-DD format.");
  }

  const [yearText, monthText, dayText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    throw new Error("date must use YYYY-MM-DD format.");
  }

  const from = zonedDateTimeToUtc(year, month, day, 0, 0, timezone);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const to = zonedDateTimeToUtc(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
    0,
    0,
    timezone,
  );

  return {
    from: from.toISOString(),
    localDate: date,
    timezone,
    to: to.toISOString(),
  };
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = timezoneOffsetMs(utcGuess, timezone);

  return new Date(utcGuess.getTime() - offset);
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone: timezone,
      year: "numeric",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asUtc - date.getTime();
}

function localDate(date: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: timezone,
      year: "numeric",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}
