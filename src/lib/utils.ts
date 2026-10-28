import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO, isValid } from 'date-fns';
import type { Entity, Preferences, StudySession, StudyTask } from '@/types';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export const today = () => format(new Date(), 'yyyy-MM-dd');
export function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const entity = (): Entity => ({
  id: uuid(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
export const validDate = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && isValid(parseISO(v)) && format(parseISO(v), 'yyyy-MM-dd') === v;
export const statusLabels = {
  todo: '未完成',
  in_progress: '进行中',
  partial: '部分完成',
  completed: '已完成',
  skipped: '已跳过',
};
export function sessionSeconds(session: StudySession, now = Date.now()) {
  return session.segments.reduce(
    (sum, s) =>
      sum +
      Math.max(0, (s.endedAt ?? (session.state === 'running' ? now : s.startedAt)) - s.startedAt) /
        1000,
    0,
  );
}
export function taskSeconds(taskId: string, sessions: StudySession[], now = Date.now()) {
  return sessions
    .filter((s) => s.taskId === taskId)
    .reduce((n, s) => n + sessionSeconds(s, now), 0);
}
export const duration = (seconds: number) =>
  `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, '0')}:${Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
export const minutesLabel = (minutes: number) =>
  minutes >= 60
    ? `${Math.floor(minutes / 60)} 小时 ${Math.round(minutes % 60)} 分钟`
    : `${Math.round(minutes)} 分钟`;
export const defaults: Preferences = {
  weekdayMinutes: 90,
  weekendMinutes: 120,
  vacationMinutes: 240,
  specialBudgets: [],
  theme: 'system',
};
export function budgetFor(date: string, p: Preferences) {
  const special = [...p.specialBudgets].reverse().find((s) => date >= s.start && date <= s.end);
  return (
    special?.minutes ??
    ([0, 6].includes(parseISO(date).getDay()) ? p.weekendMinutes : p.weekdayMinutes)
  );
}
export function taskFingerprint(
  t: Pick<StudyTask, 'date' | 'subjectId' | 'title' | 'chapter' | 'exercises'>,
) {
  return [t.date, t.subjectId, t.title, t.chapter, t.exercises]
    .map((v) => v.trim().toLowerCase())
    .join('\u001f');
}
export function safeUrl(url: string) {
  if (!url) return true;
  try {
    return ['https:', 'http:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
export function download(name: string, content: BlobPart, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
