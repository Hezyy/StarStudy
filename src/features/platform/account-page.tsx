'use client';
import { useRef, useState } from 'react';
import Link from '@/components/ui/app-link';
import { usePlatform } from './platform';
import { useApp } from '@/components/provider';
import { db, StarDatabase } from '@/db';
import { Button } from '@/components/ui/button';
import { createBackup, backupPreview, restoreBackup } from '@/services/backup';
import { download, entity } from '@/lib/utils';
import { useUnsavedChanges } from '@/lib/interaction';
import { BackupPanel } from '@/features/backup/backup-panel';

export function AccountPage() {
  const database = db;
  const platform = usePlatform(),
    app = useApp();
  const [name, setName] = useState(platform.user?.name ?? '');
  const [legacy, setLegacy] = useState<Awaited<ReturnType<typeof backupPreview>> | null>(null);
  const [custom, setCustom] = useState('');
  const [formBusy, setFormBusy] = useState<'password' | 'delete' | null>(null);
  const [formError, setFormError] = useState({ password: '', delete: '' });
  const formLock = useRef(false);
  useUnsavedChanges((platform.enabled && name !== platform.user?.name) || !!custom.trim());
  const signal = () => window.dispatchEvent(new Event('star-study:sync'));
  const addSubject = () =>
    app.run(async () => {
      const value = custom.trim();
      if (!value || value.length > 80) throw new Error('科目名称须为1—80个字符。');
      await database.transaction('rw', database.subjects, async () => {
        const all = await database.subjects.toArray();
        if (all.some((subject) => subject.name.trim().toLowerCase() === value.toLowerCase()))
          throw new Error('这个科目已经存在，可直接启用已有科目。');
        await database.subjects.add({
          ...entity(),
          name: value,
          category: 'custom',
          priority: 5,
          active: true,
        });
      });
      setCustom('');
    }, '科目已添加');

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">自己的节奏，独立的空间</p>
          <h1>账户与配置</h1>
          <p>
            {platform.enabled
              ? `${platform.user?.email} · 本地缓存与此账户独立关联`
              : '当前为本地模式，不需要账号。部署账号服务后可迁移自己的数据。'}
          </p>
        </div>
      </div>
      {platform.enabled && (
        <section className="panel settings-section">
          <h2>账户资料</h2>
          <form
            className="platform-form"
            onSubmit={async (event) => {
              event.preventDefault();
              await app.run(async () => {
                if (!name.trim()) throw new Error('昵称不能为空。');
                await platform.request('/account', 'PATCH', { name: name.trim(), onboarded: true });
                await platform.refresh();
              }, '账户资料已保存');
            }}
          >
            <label>
              昵称
              <input
                required
                maxLength={80}
                value={name}
                autoComplete="nickname"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="button-row">
              <Button type="submit">保存账户资料</Button>
              <Button variant="secondary" asChild>
                <Link href="/settings/">设置目标与时间预算</Link>
              </Button>
            </div>
          </form>
          <div className="button-row">
            <Button
              variant="secondary"
              onClick={() =>
                app.run(async () => {
                  const result = await platform.request<{ backup: unknown }>('/data');
                  download(
                    '星研-服务器账户数据导出.json',
                    JSON.stringify({ account: platform.user, ...result }),
                  );
                }, '服务器账户数据已导出；本机未同步内容请使用下方完整备份')
              }
            >
              导出服务器账户数据
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                app.run(async () => {
                  await platform.request('/logout', 'POST', {});
                  localStorage.removeItem('star-account');
                  platform.announce();
                  location.reload();
                })
              }
            >
              退出登录
            </Button>
          </div>
          <p className="hint">
            服务器导出反映最近一次同步结果。离线或尚未同步时，请下载下方完整本机备份。
          </p>
        </section>
      )}
      <section className="panel settings-section">
        <h2>备考基础与进度</h2>
        <Foundation />
        <h3>自定义科目</h3>
        <form
          className="platform-form"
          onSubmit={(event) => {
            event.preventDefault();
            void addSubject();
          }}
        >
          <label>
            科目名称
            <input
              value={custom}
              required
              maxLength={80}
              onChange={(event) => setCustom(event.target.value)}
            />
          </label>
          <Button type="submit" variant="secondary" disabled={!custom.trim()}>
            添加科目
          </Button>
        </form>
        <p>数学支持一/二/三，英语支持一/二；已有记录始终保留。更多科目可自行添加。</p>
        <div className="platform-subject-list">
          {app.subjects.map((subject) => (
            <div key={subject.id}>
              <Button
                variant="ghost"
                aria-pressed={subject.active}
                onClick={() =>
                  app.run(
                    () =>
                      database.subjects.update(subject.id, {
                        active: !subject.active,
                        updatedAt: new Date().toISOString(),
                      }),
                    '科目状态已更新；未来任务请到动态排期重新评估',
                  )
                }
              >
                {subject.name} · {subject.active ? '启用' : '停用'}
              </Button>
              <label>
                <span className="sr-only">{subject.name}优先级</span>
                <select
                  aria-label={`${subject.name}优先级`}
                  value={subject.priority}
                  onChange={(event) =>
                    void app.run(
                      () =>
                        database.subjects.update(subject.id, {
                          priority: Number(event.target.value),
                          updatedAt: new Date().toISOString(),
                        }),
                      '科目优先级已更新',
                    )
                  }
                >
                  {Array.from({ length: 10 }, (_, index) => (
                    <option key={index + 1} value={index + 1}>
                      优先级 {index + 1}
                      {index === 0 ? ' · 最高' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>
      </section>
      {platform.enabled && (
        <section className="panel settings-section">
          <h2>迁移旧版本机数据</h2>
          <p>
            只在本人账户操作。先预览，再确认；原版数据库会保留。也可通过下方JSON备份迁移其他设备。
          </p>
          <Button
            variant="secondary"
            onClick={() =>
              app.run(async () => {
                const old = new StarDatabase('star-study');
                try {
                  if (!(await old.userProfiles.count()))
                    throw new Error('这个浏览器没有旧版数据。');
                  const backup = await createBackup(old);
                  setLegacy(await backupPreview(backup, database));
                } finally {
                  old.close();
                }
              })
            }
          >
            预览旧版本机数据
          </Button>
          {legacy && (
            <div className="platform-preview">
              <p>
                旧版任务 {legacy.backup.data.tasks.length} · 本账户任务 {app.tasks.length} ·
                同ID冲突 {legacy.counts.reduce((sum, count) => sum + count.conflicts, 0)}
              </p>
              <p>
                将替换本账户的本机数据；只允许迁移到没有任务和计时记录的账户。原数据库与恢复前快照均会保留。
              </p>
              <div className="button-row">
                <Button
                  disabled={app.tasks.length > 0 || app.sessions.length > 0}
                  onClick={() =>
                    app.run(async () => {
                      await restoreBackup(legacy.backup, database, legacy.currentSignature);
                      setLegacy(null);
                      signal();
                    }, '迁移已写入账户缓存，等待同步')
                  }
                >
                  确认迁移到空账户
                </Button>
                <Button variant="ghost" onClick={() => setLegacy(null)}>
                  取消
                </Button>
              </div>
              {(app.tasks.length > 0 || app.sessions.length > 0) && (
                <p className="hint">
                  当前账户已有学习数据。请先完整备份；为防止覆盖，此迁移入口已禁用。
                </p>
              )}
            </div>
          )}
        </section>
      )}
      <BackupPanel />
      {platform.enabled && (
        <>
          <section className="panel settings-section">
            <h2>修改密码</h2>
            <form
              className="platform-form"
              aria-busy={formBusy === 'password'}
              onSubmit={async (event) => {
                event.preventDefault();
                if (formLock.current) return;
                const form = event.currentTarget,
                  fields = new FormData(form);
                setFormError((current) => ({ ...current, password: '' }));
                if (fields.get('next') !== fields.get('confirmation')) {
                  setFormError((current) => ({ ...current, password: '两次输入的新密码不一致。' }));
                  return;
                }
                formLock.current = true;
                setFormBusy('password');
                try {
                  const ok = await app.run(async () => {
                    try {
                      await platform.request('/password', 'POST', {
                        current: fields.get('current'),
                        next: fields.get('next'),
                      });
                    } catch (error) {
                      setFormError((current) => ({
                        ...current,
                        password: error instanceof Error ? error.message : '密码更新失败，请重试。',
                      }));
                      throw error;
                    }
                  }, '密码已更新，其他登录已失效');
                  if (ok) form.reset();
                } finally {
                  formLock.current = false;
                  setFormBusy(null);
                }
              }}
            >
              <label>
                当前密码
                <input
                  type="password"
                  name="current"
                  maxLength={128}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label>
                新密码
                <input
                  type="password"
                  name="next"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                />
              </label>
              <label>
                再次输入新密码
                <input
                  type="password"
                  name="confirmation"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                />
              </label>
              {formError.password && (
                <p role="alert" className="warning">
                  {formError.password}
                </p>
              )}
              <Button type="submit" loading={formBusy === 'password'} disabled={!!formBusy}>
                更新密码
              </Button>
            </form>
          </section>
          <section className="panel settings-section">
            <h2>删除账户及服务器数据</h2>
            <p>
              不可恢复。请先导出备份。服务器数据和此账户在当前浏览器的缓存都会删除；旧版个人数据库会保留。
            </p>
            <form
              className="platform-form"
              aria-busy={formBusy === 'delete'}
              onSubmit={async (event) => {
                event.preventDefault();
                if (formLock.current) return;
                const fields = new FormData(event.currentTarget);
                if (
                  !confirm('最后确认：永久删除此账户、所有服务器学习数据和当前浏览器的账户缓存？')
                )
                  return;
                formLock.current = true;
                setFormBusy('delete');
                setFormError((current) => ({ ...current, delete: '' }));
                try {
                  await app.run(async () => {
                    try {
                      await platform.request('/account', 'DELETE', {
                        password: fields.get('password'),
                        confirmation: fields.get('confirmation'),
                      });
                      localStorage.removeItem('star-account');
                      localStorage.removeItem(`star-sync:${platform.user!.id}`);
                      platform.announce();
                      await database.delete();
                      location.reload();
                    } catch (error) {
                      setFormError((current) => ({
                        ...current,
                        delete: error instanceof Error ? error.message : '删除失败，请重试。',
                      }));
                      throw error;
                    }
                  });
                } finally {
                  formLock.current = false;
                  setFormBusy(null);
                }
              }}
            >
              <label>
                输入账户密码
                <input
                  type="password"
                  name="password"
                  maxLength={128}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label>
                输入 DELETE 确认
                <input
                  name="confirmation"
                  maxLength={6}
                  pattern="DELETE"
                  autoComplete="off"
                  required
                />
              </label>
              {formError.delete && (
                <p role="alert" className="warning">
                  {formError.delete}
                </p>
              )}
              <Button
                type="submit"
                variant="danger"
                loading={formBusy === 'delete'}
                disabled={!!formBusy}
              >
                永久删除账户
              </Button>
            </form>
          </section>
        </>
      )}
    </>
  );
}

function Foundation() {
  const database = db;
  const app = useApp(),
    old = app.settings.find((setting) => setting.key === 'foundation');
  const [text, setText] = useState(String(old?.value ?? ''));
  useUnsavedChanges(text !== String(old?.value ?? ''));
  return (
    <form
      className="platform-form"
      onSubmit={(event) => {
        event.preventDefault();
        void app.run(async () => {
          await database.transaction('rw', database.settings, async () => {
            const previous = await database.settings.where('key').equals('foundation').first();
            await database.settings.put({
              ...(previous ?? entity()),
              key: 'foundation',
              value: text,
              updatedAt: new Date().toISOString(),
            });
          });
        }, '基础信息已保存');
      }}
    >
      <label>
        数学、英语、专业课基础与当前进度
        <textarea
          rows={4}
          maxLength={20000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="例如：高数需巩固，线代从基础开始；英语已过六级…"
        />
      </label>
      <Button type="submit" variant="secondary">
        保存基础信息
      </Button>
    </form>
  );
}
