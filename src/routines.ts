// Pure recurrence math for routines — no React, no network. A routine has
// no fixed due date; its deadline is whichever matching date ("occurrence")
// is soonest from today, and that deadline rolls forward automatically once
// the date passes, regardless of whether the previous occurrence was ever
// completed (confirmed behavior: a missed occurrence doesn't linger as
// "overdue" — it just quietly moves on, like a recurring alarm).

export type Routine = {
  id: number;
  task: string;
  categoryId: number;
  recurrenceType: "weekly" | "monthly";
  daysOfWeek: number[] | null; // 0=Sunday..6=Saturday (matches Date#getDay())
  daysOfMonth: number[] | null; // 1-31
  favourited: boolean;
  reminders: RoutineReminder[];
  completedDates: string[]; // "YYYY-MM-DD"
  updatedAt?: string;
};

export type RoutineReminder = {
  id: number;
  daysBefore: number | null;
  remindAt: string | null;
  timeOfDay: string | null; // "HH:MM[:SS]", only meaningful with daysBefore
  message: string | null;
  enabled: boolean;
};

const MAX_MONTHS_AHEAD = 24;

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// Number of days actually in `month` (0-indexed) of `year` — deferring to
// JS's own Date arithmetic here is what makes this leap-year-safe: asking
// for "day 0 of the following month" always lands on the real last day of
// the target month, Feb 29 included in leap years, without any hand-rolled
// leap-year formula to get wrong.
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Next date >= `from` (inclusive) whose day-of-week is in `daysOfWeek`. */
function nextWeeklyOccurrence(daysOfWeek: number[], from: Date): Date {
  const start = startOfDay(from);
  for (let i = 0; i <= 7; i++) {
    const candidate = new Date(start);
    candidate.setDate(start.getDate() + i);
    if (daysOfWeek.includes(candidate.getDay())) return candidate;
  }
  // Unreachable when daysOfWeek is non-empty (every week has a match within 7 days).
  return start;
}

/** Next date >= `from` (inclusive) whose day-of-month is in `daysOfMonth`. */
function nextMonthlyOccurrence(daysOfMonth: number[], from: Date): Date {
  const start = startOfDay(from);
  const sorted = [...daysOfMonth].sort((a, b) => a - b);

  for (let m = 0; m <= MAX_MONTHS_AHEAD; m++) {
    const targetMonthIndex = start.getMonth() + m;
    const year = start.getFullYear() + Math.floor(targetMonthIndex / 12);
    const month = ((targetMonthIndex % 12) + 12) % 12;
    const lastDay = daysInMonth(year, month);

    for (const day of sorted) {
      // "Every 31st" simply doesn't happen in a 30-day month; "every 29th"
      // skips non-leap Februaries — both fall out naturally here since
      // `lastDay` already reflects the real length of this exact month.
      if (day > lastDay) continue;
      const candidate = new Date(year, month, day);
      if (candidate >= start) return candidate;
    }
  }

  // Only reachable if daysOfMonth was empty (shouldn't happen — validated server-side).
  return start;
}

export function nextOccurrence(routine: Routine, today: Date = new Date()): Date {
  if (routine.recurrenceType === "weekly") {
    return nextWeeklyOccurrence(routine.daysOfWeek ?? [], today);
  }
  return nextMonthlyOccurrence(routine.daysOfMonth ?? [], today);
}

export function occurrenceDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isOccurrenceDone(routine: Routine, occurrence: Date): boolean {
  return routine.completedDates.includes(occurrenceDateKey(occurrence));
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function describeRecurrence(routine: Routine): string {
  if (routine.recurrenceType === "weekly") {
    const days = [...(routine.daysOfWeek ?? [])].sort((a, b) => a - b);
    return `Every ${days.map((d) => DAY_NAMES[d]).join(", ")}`;
  }
  const days = [...(routine.daysOfMonth ?? [])].sort((a, b) => a - b);
  return `Every ${days.map(ordinal).join(", ")}`;
}
