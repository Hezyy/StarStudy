'use client';
import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';
import { db } from '@/db';
let lastActivated: HTMLElement | null = null;
export function getFocusReturnTarget() {
  return lastActivated?.isConnected ? lastActivated : null;
}
export function useFocusReturnTracking() {
  useEffect(() => {
    const record = (event: Event) => {
      const target = event.target;
      if (target instanceof Element) {
        const control = target.closest<HTMLElement>('button,a[href],summary,[role="button"]');
        if (control) lastActivated = control;
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') record(event);
    };
    document.addEventListener('pointerdown', record, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', record, true);
      document.removeEventListener('keydown', key, true);
    };
  }, []);
}
export function useNow(enabled = true, intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const sync = () => setNow(Date.now());
    sync();
    if (!enabled) return;
    const id = window.setInterval(sync, intervalMs);
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [enabled, intervalMs]);
  return now;
}
export function useViewState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const storageKey =
    db.name === 'star-study' ? 'star-study:view:' + key : `star-study:view:${db.name}:${key}`;
  const [value, setValue] = useState<T>(() => {
    const fallback = typeof initial === 'function' ? (initial as () => T)() : initial;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw !== null) {
        const saved: unknown = JSON.parse(raw);
        if (typeof saved === typeof fallback) return saved as T;
      }
    } catch {}
    return fallback;
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {}
  }, [storageKey, value]);
  return [value, setValue];
}
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const navigate = (e: Event) => {
      if (!confirm('还有未保存的内容，确认离开？')) e.preventDefault();
    };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('star-study:before-navigate', navigate);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('star-study:before-navigate', navigate);
    };
  }, [dirty]);
}
