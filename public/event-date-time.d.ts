export interface EventTiming {
  startsAt: string;
  endsAt: string;
  duration: string;
}

export function combineLocalDateTime(dateValue: string, timeValue: string): string;
export function splitLocalDateTime(value: string | Date): { date: string; time: string };
export function shiftLocalDateTime(dateValue: string, timeValue: string, minutes: number): { date: string; time: string } | null;
export function durationMinutes(startValue: string, endValue: string): number | null;
export function formatDurationMinutes(totalMinutes: number | null): string;
export function parseDurationClock(value: string): number | null;
export function formatDurationClock(totalMinutes: number | null): string;
export function updateEventTiming(timing: EventTiming, source: "start" | "end" | "duration", value: string): EventTiming;
