'use client';
import { useEffect, useState } from 'react';
import { useApp } from './provider';
import { Button } from './ui/button';
import { db } from '@/db';
import { entity, today } from '@/lib/utils';
interface ReminderConfig {
  enabled: boolean;
  hour: number;
  minute: number;
  lastNotified?: string;
}
const initial: ReminderConfig = { enabled: false, hour: 20, minute: 0 };
export function ReminderManager() {
  const app = useApp();
  const database = db;
  const setting = app.settings.find((s) => s.key === 'reminders');
  const config = (setting?.value as ReminderConfig | undefined) ?? initial;
  useEffect(() => {
    if (!config.enabled || !setting) return;
    let working = false,
      cancelled = false;
    const check = async () => {
      if (working || !('Notification' in window) || Notification.permission !== 'granted') return;
      const date = today(),
        now = new Date();
      if (
        config.lastNotified === date ||
        now.getHours() * 60 + now.getMinutes() < config.hour * 60 + config.minute
      )
        return;
      const count = app.tasks.filter(
          (t) => !t.deletedAt && !['completed', 'skipped'].includes(t.status) && t.date <= date,
        ).length,
        due = app.mistakes.filter((m) => !m.archivedAt && m.reviewDate <= date).length;
      if (!count && !due) return;
      working = true;
      try {
        const title = '星研学习提醒',
          body = `待继续任务 ${count} 项，待复习错题 ${due} 道。给今天留一小段专注时间。`;
        const r =
          'serviceWorker' in navigator
            ? await navigator.serviceWorker.getRegistration()
            : undefined;
        if (cancelled) return;
        if (r) await r.showNotification(title, { body, icon: '/icons/icon-192.png' });
        else new Notification(title, { body });
        await database.settings.update(setting.id, {
          value: { ...config, lastNotified: date },
          updatedAt: new Date().toISOString(),
        });
      } catch {
        app.notify('本机通知未能显示，可在应用内查看待办', true);
      } finally {
        working = false;
      }
    };
    check();
    const id = setInterval(check, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [app, config, setting, database]);
  return null;
}
export function ReminderSettings() {
  const app = useApp();
  const setting = app.settings.find((s) => s.key === 'reminders'),
    saved = (setting?.value as ReminderConfig | undefined) ?? initial;
  const [time, setTime] = useState(
      `${String(saved.hour).padStart(2, '0')}:${String(saved.minute).padStart(2, '0')}`,
    ),
    [busy, setBusy] = useState(false);
  const save = async (enabled: boolean) => {
    setBusy(true);
    await app.run(
      async () => {
        if (enabled) {
          if (!('Notification' in window))
            throw new Error('当前浏览器不支持本机通知；iPhone可能需要先添加到主屏幕');
          if ((await Notification.requestPermission()) !== 'granted')
            throw new Error('通知权限未获允许，应用内待办仍可正常查看');
        }
        const [hour, minute] = time.split(':').map(Number);
        if (!Number.isInteger(hour) || hour < 0 || hour > 23 || minute < 0 || minute > 59)
          throw new Error('提醒时间无效');
        await db.settings.put({
          ...(setting ?? entity()),
          key: 'reminders',
          value: { enabled, hour, minute, lastNotified: saved.lastNotified },
          updatedAt: new Date().toISOString(),
        });
      },
      enabled ? '本机提醒已启用' : '本机提醒已关闭',
    );
    setBusy(false);
  };
  return (
    <section className="panel settings-section">
      <h2>本机学习提醒</h2>
      <p className="hint">
        当前状态：{saved.enabled ? '已启用' : '未启用'}
        。应用打开时按所选时间检查未完成任务与到期错题，每天最多提醒一次；关闭应用后的后台推送尚未接入。
      </p>
      <label>
        每日提醒时间
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      <div className="record-actions">
        <Button disabled={busy} onClick={() => save(true)}>
          启用 / 保存本机提醒
        </Button>
        <Button disabled={busy || !saved.enabled} variant="secondary" onClick={() => save(false)}>
          关闭本机提醒
        </Button>
      </div>
    </section>
  );
}
