import { addMinutes, localToUtc } from "./time";

export interface Offsets {
  roundOpen: number; // minutes after shift start
  reminder: number; // minutes after the round opens
  l3: number; // minutes after the round opens
  rmOps: number; // minutes after the round opens
  cutoff: number; // minutes after the round opens
}

export interface RoundTimes {
  shiftStart: Date;
  opensAt: Date;
  reminderAt: Date;
  l3At: Date;
  rmOpsAt: Date;
  cutoffAt: Date;
}

/** All times of one round, from the shift start on a local date. */
export function computeRoundTimes(dateStr: string, startTime: string, o: Offsets, tzOff: number): RoundTimes {
  const shiftStart = localToUtc(dateStr, startTime, tzOff);
  const opensAt = addMinutes(shiftStart, o.roundOpen);
  return {
    shiftStart,
    opensAt,
    reminderAt: addMinutes(opensAt, o.reminder),
    l3At: addMinutes(opensAt, o.l3),
    rmOpsAt: addMinutes(opensAt, o.rmOps),
    cutoffAt: addMinutes(opensAt, o.cutoff),
  };
}

/** Rebuild the ladder for a stored round (its opens/cut-off times are already fixed). */
export function timesFromRound(shiftStart: Date, opensAt: Date, cutoffAt: Date, o: Offsets): RoundTimes {
  return {
    shiftStart,
    opensAt,
    reminderAt: addMinutes(opensAt, o.reminder),
    l3At: addMinutes(opensAt, o.l3),
    rmOpsAt: addMinutes(opensAt, o.rmOps),
    cutoffAt,
  };
}

export type RoundStatus = "NOT_DUE" | "OPEN" | "OVERDUE" | "MISSED" | "SUBMITTED" | "LATE";

export interface StatusInput {
  now: Date;
  opensAt: Date;
  reminderAt: Date;
  cutoffAt: Date;
  /** time of the FIRST entry for the round, if any */
  firstEntryAt?: Date | null;
}

/**
 * NOT_DUE   : the round has not opened
 * OPEN      : opened, no entry yet, still inside the reminder window
 * OVERDUE   : no entry after the reminder time, before cut-off
 * MISSED    : no entry at cut-off (an entry later is still accepted and shows LATE)
 * SUBMITTED : first entry before cut-off
 * LATE      : first entry after cut-off
 */
export function roundStatus(s: StatusInput): RoundStatus {
  if (s.firstEntryAt) return s.firstEntryAt.getTime() <= s.cutoffAt.getTime() ? "SUBMITTED" : "LATE";
  const n = s.now.getTime();
  if (n < s.opensAt.getTime()) return "NOT_DUE";
  if (n >= s.cutoffAt.getTime()) return "MISSED";
  if (n >= s.reminderAt.getTime()) return "OVERDUE";
  return "OPEN";
}

export type Step = "open" | "reminder" | "l3" | "rm_ops";

/** Notification steps that are due now for a round with no entry yet. */
export function dueSteps(now: Date, t: RoundTimes, hasEntry: boolean): Step[] {
  if (now.getTime() < t.opensAt.getTime()) return [];
  const out: Step[] = ["open"];
  if (hasEntry) return out;
  // nothing is escalated once the round is past cut-off
  if (now.getTime() >= t.cutoffAt.getTime()) return out;
  const n = now.getTime();
  if (n >= t.reminderAt.getTime()) out.push("reminder");
  if (n >= t.l3At.getTime()) out.push("l3");
  if (n >= t.rmOpsAt.getTime()) out.push("rm_ops");
  return out;
}
