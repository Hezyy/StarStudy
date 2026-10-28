import { eachDayOfInterval, format, startOfWeek, subDays, parseISO } from 'date-fns';
import { sessionSeconds } from '@/lib/utils';
import type { StudySession, StudyTask } from '@/types';
export const plannedMinutes = (t: StudyTask) =>
  t.unscheduled ? 0 : (t.plannedMinutes ?? t.estimatedMinutes);
// Attribute every segment to the actual local calendar day, including segments crossing midnight.
export function secondsOnDate(sessions: StudySession[], date: string, now = Date.now()) {
  const start = parseISO(date).getTime(),
    end = new Date(parseISO(date).setDate(parseISO(date).getDate() + 1)).getTime();
  return [...new Map(sessions.map((s) => [s.id, s])).values()].reduce(
    (sum, s) =>
      sum +
      s.segments.reduce(
        (n, v) =>
          n +
          Math.max(
            0,
            Math.min(v.endedAt ?? (s.state === 'running' ? now : v.startedAt), end) -
              Math.max(v.startedAt, start),
          ) /
            1000,
        0,
      ),
    0,
  );
}
export function streak(sessions: StudySession[], date: string) {
  let n = 0;
  let cursor = parseISO(date);
  if (secondsOnDate(sessions, date) < 1) cursor = subDays(cursor, 1);
  while (secondsOnDate(sessions, format(cursor, 'yyyy-MM-dd')) >= 1) {
    n++;
    cursor = subDays(cursor, 1);
  }
  return n;
}
export function weekData(tasks: StudyTask[], sessions: StudySession[], date: string) {
  return eachDayOfInterval({
    start: startOfWeek(parseISO(date), { weekStartsOn: 1 }),
    end: new Date(startOfWeek(parseISO(date), { weekStartsOn: 1 }).getTime() + 6 * 86400000),
  }).map((d) => {
    const key = format(d, 'yyyy-MM-dd');
    return {
      date: key,
      planned: tasks
        .filter((t) => t.date === key && !t.deletedAt)
        .reduce((n, t) => n + plannedMinutes(t), 0),
      actual: secondsOnDate(sessions, key) / 60,
    };
  });
}
export const totalMinutes = (sessions: StudySession[]) =>
  sessions.reduce((n, s) => n + sessionSeconds(s) / 60, 0);
