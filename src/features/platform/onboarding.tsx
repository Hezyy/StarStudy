'use client';
import { appUrl } from '@/lib/app-path';
import { useRef, useState, type ReactNode } from 'react';
import { usePlatform } from './platform';
import { useApp } from '@/components/provider';
import { db } from '@/db';
import { entity, validDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function OnboardingGate({ children }: { children: ReactNode }) {
  const platform = usePlatform();
  return platform.enabled && platform.user && !platform.user.onboarded ? <Onboarding /> : children;
}

function Onboarding() {
  const database = db;
  const app = useApp(),
    platform = usePlatform();
  const [name, setName] = useState(platform.user!.name);
  const [target, setTarget] = useState(app.examTargets[0]);
  const [budget, setBudget] = useState(app.preferences);
  const [foundation, setFoundation] = useState(
    String(app.settings.find((s) => s.key === 'foundation')?.value ?? ''),
  );
  const [math, setMath] = useState(
    app.subjects.find((s) => s.category === 'math' && s.active)?.name ?? '数学一',
  );
  const [english, setEnglish] = useState(
    app.subjects.find((s) => s.category === 'english' && s.active)?.name ?? '英语一',
  );
  const [professional, setProfessional] = useState(
    app.subjects.find((s) => s.category === 'cs' && s.active)?.name ?? '408',
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);

  async function save() {
    if (lock.current) return;
    const trimmedName = name.trim(),
      university = target.university.trim(),
      major = target.major.trim();
    if (
      !trimmedName ||
      !university ||
      university === '待设置目标院校' ||
      !major ||
      !professional.trim()
    ) {
      setError('请填写昵称、目标院校、目标专业和专业课。');
      return;
    }
    if (
      !validDate(target.examDate) ||
      [budget.weekdayMinutes, budget.weekendMinutes, budget.vacationMinutes].some(
        (n) => !Number.isInteger(n) || n < 0 || n > 1440,
      )
    ) {
      setError('请检查初试日期；每天可用时间须为0—1440分钟的整数。');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await app.run(async () => {
        try {
          const stamp = new Date().toISOString();
          await database.transaction(
            'rw',
            [database.userProfiles, database.examTargets, database.subjects, database.settings],
            async () => {
              await database.userProfiles.update(app.userProfiles[0].id, {
                name: trimmedName,
                updatedAt: stamp,
              });
              await database.examTargets.put({ ...target, university, major, updatedAt: stamp });
              for (const [category, subjectName] of [
                ['math', math],
                ['english', english],
                ['cs', professional.trim()],
              ] as const) {
                const subjects = await database.subjects
                  .where('category')
                  .equals(category)
                  .toArray();
                for (const subject of subjects)
                  await database.subjects.update(subject.id, { active: false, updatedAt: stamp });
                const old = subjects.find((subject) => subject.name === subjectName);
                await database.subjects.put({
                  ...(old ?? entity()),
                  name: subjectName,
                  category,
                  priority: category === 'math' ? 1 : category === 'english' ? 2 : 3,
                  active: true,
                  updatedAt: stamp,
                });
              }
              const setting = await database.settings.where('key').equals('preferences').first();
              if (!setting) throw new Error('时间预算设置不存在，请重新打开应用。');
              await database.settings.put({ ...setting, value: budget, updatedAt: stamp });
              // Upsert makes retries safe after a successful local save and a failed account request.
              const previousFoundation = await database.settings
                .where('key')
                .equals('foundation')
                .first();
              await database.settings.put({
                ...(previousFoundation ?? entity()),
                key: 'foundation',
                value: foundation.trim(),
                updatedAt: stamp,
              });
            },
          );
          await platform.request('/account', 'PATCH', { name: trimmedName, onboarded: true });
          await platform.refresh();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
          throw cause;
        }
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="onboarding-space">
      <img src={appUrl('/icons/star.svg')} width="48" height="48" alt="星研" />
      <p className="eyebrow">你的研途，由自己定义</p>
      <h1>先找到适合自己的节奏</h1>
      <p>日期和科目是个人计划，请以目标院校官方招生信息为准。以后随时可以修改。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        aria-busy={busy}
      >
        <fieldset className="platform-fieldset" disabled={busy}>
          <legend className="sr-only">考研目标与时间预算</legend>
          <div className="form-grid">
            <label>
              昵称
              <input
                required
                maxLength={80}
                autoComplete="nickname"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              预计初试日期
              <input
                type="date"
                required
                value={target.examDate}
                onChange={(event) => setTarget({ ...target, examDate: event.target.value })}
              />
            </label>
            <label>
              目标院校
              <input
                required
                maxLength={200}
                value={target.university === '待设置目标院校' ? '' : target.university}
                onChange={(event) => setTarget({ ...target, university: event.target.value })}
              />
            </label>
            <label>
              目标专业
              <input
                required
                maxLength={200}
                value={target.major}
                onChange={(event) => setTarget({ ...target, major: event.target.value })}
              />
            </label>
            <label>
              数学
              <select
                aria-label="数学"
                value={math}
                onChange={(event) => setMath(event.target.value)}
              >
                {['数学一', '数学二', '数学三'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              英语
              <select
                aria-label="英语"
                value={english}
                onChange={(event) => setEnglish(event.target.value)}
              >
                <option>英语一</option>
                <option>英语二</option>
              </select>
            </label>
            <label>
              专业课
              <input
                value={professional}
                maxLength={80}
                onChange={(event) => setProfessional(event.target.value)}
                required
                list="professional-options"
              />
              <datalist id="professional-options">
                <option>408</option>
                <option>学校自命题专业课</option>
              </datalist>
            </label>
            {(
              [
                ['weekdayMinutes', '平日分钟'],
                ['weekendMinutes', '周末分钟'],
                ['vacationMinutes', '寒暑假分钟'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  inputMode="numeric"
                  required
                  step={1}
                  min={0}
                  max={1440}
                  value={budget[key]}
                  onChange={(event) => setBudget({ ...budget, [key]: Number(event.target.value) })}
                />
              </label>
            ))}
          </div>
          <label>
            数学、英语、专业课基础与当前进度
            <textarea
              rows={4}
              maxLength={20000}
              value={foundation}
              onChange={(event) => setFoundation(event.target.value)}
              placeholder="用几句话描述基础和已完成内容，以便生成适合你的计划。"
            />
          </label>
        </fieldset>
        <p className="hint">
          数学默认优先；科目优先级、特殊日期及假期预算可在个人设置继续调整。政治默认启用，可在账户配置修改。
        </p>
        {error && (
          <p className="warning" role="alert">
            {error} 已保存的本机内容会保留，可以重试。
          </p>
        )}
        <Button type="submit" loading={busy}>
          保存，进入学习空间
        </Button>
      </form>
    </main>
  );
}
