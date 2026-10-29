'use client';
import { appUrl } from '@/lib/app-path';
import { useViewState } from '@/lib/interaction';
import { useUnsavedChanges } from '@/lib/interaction';
import { useEffect, useState } from 'react';
import { Save, Plus, X, Settings, Database, Smartphone } from 'lucide-react';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import { ImportPanel } from '@/features/import/import-panel';
import { BackupPanel } from '@/features/backup/backup-panel';
import { today } from '@/lib/utils';
import { saveSettings } from '@/services/settings';
export function SettingsPage() {
  const app = useApp();
  const [tab, setTab] = useViewState('settings.tab', 'general');
  const changeTab = (next: string) => {
    if (
      next === tab ||
      window.dispatchEvent(new Event('star-study:before-navigate', { cancelable: true }))
    )
      setTab(next);
  };
  useEffect(() => {
    if (new URLSearchParams(location.search).get('tab') === 'data') setTab('data');
  }, [setTab]);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">让星研更适合你的节奏</p>
          <h1>个人设置</h1>
          <p>目标可以调整，已经走过的每一步都会留下。</p>
        </div>
      </div>
      <div className="settings-tabs segmented">
        <button
          className={tab === 'general' ? 'selected' : ''}
          onClick={() => changeTab('general')}
        >
          <Settings size={16} />
          备考与偏好
        </button>
        <button className={tab === 'data' ? 'selected' : ''} onClick={() => changeTab('data')}>
          <Database size={16} />
          导入与备份
        </button>
        <button className={tab === 'app' ? 'selected' : ''} onClick={() => changeTab('app')}>
          <Smartphone size={16} />
          关于与安装
        </button>
      </div>
      {tab === 'general' && (
        <GeneralSettings
          key={
            app.examTargets[0].updatedAt +
            app.settings.find((s) => s.key === 'preferences')?.updatedAt
          }
        />
      )}
      {tab === 'data' && (
        <>
          <ImportPanel />
          <BackupPanel />
        </>
      )}
      {tab === 'app' && (
        <section className="panel settings-section prose">
          <img src={appUrl('/icons/star.svg')} alt="星研应用图标" width={64} height={64} />
          <h2>星研</h2>
          <p>以星为引，逐梦研途。</p>
          <p>版本 0.4.0 · 离线学习与可选独立账户 · 无需付费AI接口也可使用</p>
          <h3>在电脑使用</h3>
          <p>使用 Chrome 打开应用，点击地址栏的安装图标，或浏览器菜单中的「安装星研」。</p>
          <h3>添加到 iPhone 主屏幕</h3>
          <p>
            使用 Safari 打开已通过 HTTPS 托管的星研，轻点分享按钮 →
            添加到主屏幕。手机无法直接访问电脑的 localhost；本地联调可访问电脑局域网地址，但 PWA
            离线功能要求 HTTPS。
          </p>
          <h3>本地数据持久化</h3>
          <p>可向浏览器申请持久存储，仍需定期下载备份。</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              app.run(async () => {
                if (!navigator.storage?.persist) throw new Error('当前浏览器不提供持久存储申请');
                const ok = await navigator.storage.persist();
                app.notify(ok ? '浏览器已授予持久存储' : '浏览器未授予持久存储，请保持定期备份');
              })
            }
          >
            申请浏览器持久存储
          </Button>
          <p>
            <a href={appUrl('/integrations/')}>配置云同步、服务端AI与本机提醒 →</a>
          </p>
          <h3>离线使用与更新</h3>
          <p>
            首次联网打开应用，等待 Service Worker
            缓存完成后即可离线查看和修改本地任务。发现新版本时会显示更新提示，保存编辑内容后由你确认刷新。
          </p>
          <h3>本地学习与可选连接</h3>
          <p>
            已支持错题图片、知识点评估、周复盘、统计、规则排期、版本比较与安全撤销、ChatGPT文件协作及标准AI计划导入。账户同步需要配置本部署PostgreSQL服务，AI还需要提供密钥。
          </p>
          <p className="warning-box">
            当前考试科目是个人备考方案，不代表目标院校招生科目已确定。初试日期
            {app.examTargets[0].examDate} 仅用于估算，可随时修改。
          </p>
        </section>
      )}
    </>
  );
}
function GeneralSettings() {
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const app = useApp();
  const [target, setTarget] = useState(app.examTargets[0]),
    [profile, setProfile] = useState(app.userProfiles[0]),
    [p, setP] = useState(app.preferences),
    [names, setNames] = useState<Record<string, string>>(
      Object.fromEntries(app.subjects.filter((s) => s.active).map((s) => [s.category, s.name])),
    ),
    [priorities, setPriorities] = useState<Record<string, number>>(
      Object.fromEntries(app.subjects.filter((s) => s.active).map((s) => [s.category, s.priority])),
    ),
    [busy, setBusy] = useState(false);
  const activeIds = new Set(app.subjects.filter((s) => s.active).map((s) => s.id));
  const outdated = app.tasks.filter(
    (t) =>
      !t.deletedAt && !activeIds.has(t.subjectId) && !['completed', 'skipped'].includes(t.status),
  );
  return (
    <form
      onChange={() => setDirty(true)}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        const saved = await app.run(
          () => saveSettings({ target, profile, preferences: p, names, priorities }),
          '设置已保存。切换科目后历史记录保留，请检查需要重规划的任务。',
        );
        if (saved) setDirty(false);
        setBusy(false);
      }}
    >
      <section className="panel settings-section">
        <h2>备考目标</h2>
        <div className="form-grid">
          <label>
            目标院校
            <input
              required
              value={target.university}
              onChange={(e) => setTarget({ ...target, university: e.target.value })}
            />
          </label>
          <label>
            目标专业
            <input
              value={target.major}
              onChange={(e) => setTarget({ ...target, major: e.target.value })}
            />
          </label>
          <label>
            备选院校
            <input
              value={target.backupUniversity}
              onChange={(e) => setTarget({ ...target, backupUniversity: e.target.value })}
            />
          </label>
          <label>
            预计初试日期
            <input
              type="date"
              required
              value={target.examDate}
              onChange={(e) => setTarget({ ...target, examDate: e.target.value })}
            />
          </label>
          <label>
            本科院校
            <input
              value={profile.university}
              onChange={(e) => setProfile({ ...profile, university: e.target.value })}
            />
          </label>
          <label>
            本科专业
            <input
              value={profile.major}
              onChange={(e) => setProfile({ ...profile, major: e.target.value })}
            />
          </label>
          <label>
            预计毕业日期
            <input
              type="date"
              required
              value={profile.graduationDate}
              onChange={(e) => setProfile({ ...profile, graduationDate: e.target.value })}
            />
          </label>
          <label>
            称呼
            <input
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </label>
        </div>
        <p className="hint">
          当前方案：
          {app.subjects
            .filter((s) => s.active)
            .map((s) => s.name)
            .join('、')}
          。招生科目及初试日期请以官方公告为准。
        </p>
      </section>
      <section className="panel settings-section">
        <h2>考试科目与优先级</h2>
        <p className="hint">
          数字越小越优先，数学默认为 1。切换科目会新增或启用科目，旧科目和所有历史记录都会保留。
        </p>
        <div className="subject-settings">
          {(['math', 'english', 'cs', 'politics'] as const).map((c, i) => (
            <div key={c}>
              <label>
                {['数学', '英语', '计算机专业课', '政治'][i]}
                <input
                  list={`subjects-${c}`}
                  required
                  maxLength={80}
                  value={names[c]}
                  onChange={(e) => setNames({ ...names, [c]: e.target.value })}
                />
                <datalist id={`subjects-${c}`}>
                  {(c === 'math'
                    ? ['数学一', '数学二', '数学三']
                    : c === 'english'
                      ? ['英语一', '英语二']
                      : c === 'cs'
                        ? ['408', '学校自命题专业课']
                        : ['思想政治理论']
                  ).map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </label>
              <label>
                优先级
                <input
                  type="number"
                  min={1}
                  max={10}
                  required
                  value={priorities[c]}
                  onChange={(e) => setPriorities({ ...priorities, [c]: Number(e.target.value) })}
                />
              </label>
            </div>
          ))}
        </div>
        {outdated.length > 0 && (
          <p className="warning-box">
            有 {outdated.length}{' '}
            项未完成任务关联历史科目，需要在学习计划中手动重新规划。任务不会被自动删除。
          </p>
        )}
      </section>
      <section className="panel settings-section">
        <h2>学习时间预算</h2>
        <div className="form-grid">
          <label>
            工作日（分钟 / 天）
            <input
              type="number"
              required
              min="0"
              max="1440"
              value={p.weekdayMinutes}
              onChange={(e) => setP({ ...p, weekdayMinutes: Number(e.target.value) })}
            />
          </label>
          <label>
            周末（分钟 / 天）
            <input
              type="number"
              required
              min="0"
              max="1440"
              value={p.weekendMinutes}
              onChange={(e) => setP({ ...p, weekendMinutes: Number(e.target.value) })}
            />
          </label>
          <label>
            寒暑假参考时长（分钟 / 天）
            <input
              type="number"
              required
              min="0"
              max="1440"
              value={p.vacationMinutes}
              onChange={(e) => setP({ ...p, vacationMinutes: Number(e.target.value) })}
            />
          </label>
          <label>
            应用主题
            <select
              aria-label="应用主题"
              value={p.theme}
              onChange={(e) => setP({ ...p, theme: e.target.value as typeof p.theme })}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
        </div>
        <p className="hint">
          寒暑假日期因个人校历而异，请在特殊日期中设置范围后生效。多个范围重叠时，较后添加的安排优先。
        </p>
        <div className="section-heading">
          <h3>特殊日期安排</h3>
          <Button
            size="sm"
            type="button"
            variant="secondary"
            onClick={() =>
              setP({
                ...p,
                specialBudgets: [
                  ...p.specialBudgets,
                  {
                    start: today(),
                    end: today(),
                    minutes: p.vacationMinutes,
                    label: '寒暑假',
                  },
                ],
              })
            }
          >
            <Plus size={14} />
            添加日期范围
          </Button>
        </div>
        {p.specialBudgets.map((s, i) => (
          <div className="special-budget" key={i}>
            {(['label', 'start', 'end', 'minutes'] as const).map((k, j) => (
              <label key={k}>
                {['安排名称', '开始日期', '结束日期', '每日分钟'][j]}
                <input
                  required
                  type={k === 'minutes' ? 'number' : k === 'label' ? 'text' : 'date'}
                  min={k === 'minutes' ? 0 : undefined}
                  max={k === 'minutes' ? 1440 : undefined}
                  value={s[k]}
                  onChange={(e) =>
                    setP({
                      ...p,
                      specialBudgets: p.specialBudgets.map((v, n) =>
                        n === i
                          ? { ...v, [k]: k === 'minutes' ? Number(e.target.value) : e.target.value }
                          : v,
                      ),
                    })
                  }
                />
              </label>
            ))}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`删除特殊日期 ${i + 1}`}
              onClick={() =>
                setP({ ...p, specialBudgets: p.specialBudgets.filter((_, n) => n !== i) })
              }
            >
              <X size={16} />
            </Button>
          </div>
        ))}
      </section>
      <div className="settings-save">
        <Button loading={busy} disabled={busy} type="submit">
          <Save size={16} />
          {busy ? '保存中…' : '保存设置'}
        </Button>
      </div>
    </form>
  );
}
