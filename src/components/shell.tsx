'use client';
import Link from '@/components/ui/app-link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui/modal';
import {
  CalendarDays,
  LayoutDashboard,
  Library,
  NotebookPen,
  ChartNoAxesCombined,
  Settings,
  ListChecks,
  ChevronRight,
  ShieldCheck,
  Sun,
  Moon,
  Star,
  BrainCircuit,
  GitBranch,
  MessagesSquare,
  Cloud,
  MoreHorizontal,
} from 'lucide-react';
import { useApp } from './provider';
import { PwaStatus } from './pwa';
import { ReminderManager } from './reminders';
import { db } from '@/db';
import { usePlatform } from '@/features/platform/platform';
import { SyncStatus } from '@/features/platform/sync';
const nav = [
  { href: '/', label: '今日学习', icon: LayoutDashboard },
  { href: '/plan/', label: '学习计划', icon: CalendarDays },
  { href: '/plan/import-ai/', label: 'AI计划导入', icon: BrainCircuit },
  { href: '/resources/', label: '学习资料', icon: Library },
  { href: '/knowledge/', label: '知识点管理', icon: BrainCircuit },
  { href: '/mistakes/', label: '错题本', icon: NotebookPen },
  { href: '/reviews/', label: '每周复盘', icon: ListChecks },
  { href: '/analytics/', label: '学习统计', icon: ChartNoAxesCombined },
  { href: '/planner/', label: '动态排期', icon: GitBranch },
  { href: '/collaboration/', label: 'ChatGPT协作', icon: MessagesSquare },
  { href: '/integrations/', label: '云同步与AI', icon: Cloud },
  { href: '/settings/', label: '个人设置', icon: Settings },
  { href: '/account/', label: '账户与配置', icon: ShieldCheck },
  { href: '/admin/', label: '服务管理', icon: Settings },
];
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const app = useApp();
  const platform = usePlatform();
  const visibleNav = nav.filter(n=>n.href!=='/admin/' || platform.user?.role==='admin');
  const [more, setMore] = useState(false);
  const lastPath = useRef(path);
  useEffect(() => {
    if (lastPath.current === path) return;
    lastPath.current = path;
    const id = requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>('main h1');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [path]);
  const current = nav.find((n) => n.href === path || n.href.slice(0, -1) === path) ?? nav[0];
  const theme = async () => {
    const s = app.settings.find((s) => s.key === 'preferences');
    if (s)
      await app.run(() =>
        db.settings.update(s.id, {
          value: {
            ...app.preferences,
            theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark',
          },
          updatedAt: new Date().toISOString(),
        }),
      );
  };
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand">
          <img src="/icons/star.svg" alt="" width="40" height="40" />
          <span>
            <strong>星研</strong>
            <small>STAR STUDY</small>
          </span>
        </Link>
        <p className="nav-caption">我的学习空间</p>
        <nav aria-label="主导航">
          {visibleNav.map((n) => (
            <Link
              href={n.href}
              key={n.href}
              className={`nav-item ${current.href === n.href ? 'active' : ''}`}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="brand-note">
            <Star size={18} />
            <p>
              以星为引，逐梦研途。<small>每一步，都算数。</small>
            </p>
          </div>
          <span className="local-status">
            <span />
            {platform.enabled?'账户独立缓存':'数据保存在此设备'}
          </span>
          <small>v0.4.0 · 为每天的一小步</small>
        </div>
      </aside>
      <div className="workspace">
        <ReminderManager />
        <header className="topbar">
          <div className="breadcrumb">
            <span>我的学习空间</span>
            <ChevronRight size={14} />
            <strong>{current.label}</strong>
          </div>
          <div className="top-actions">
            <span className="privacy-label">
              <ShieldCheck size={15} />
              {platform.enabled?'独立账户，安心学习':'本地数据，安心学习'}
            </span>
            <button className="theme-toggle" aria-label="切换浅色或深色主题" onClick={theme}>
              <Sun className="sun" size={18} />
              <Moon className="moon" size={18} />
            </button>
            <Link href="/settings/" className="avatar" aria-label="个人设置">
              研
            </Link>
          </div>
        </header>
        <PwaStatus /><SyncStatus />
        <main className="main-content" id="main-content" tabIndex={-1}>
          <div className="route-scene" key={path}>
            {children}
          </div>
        </main>
        <footer className="page-footer">
          <span>星研 · 记录努力，看见成长</span>
          <a href="/source/star-study-source.zip" download>对应源码 · AGPL-3.0</a>
          <Link href="/settings/">
            记得定期备份你的学习数据 <ChevronRight size={12} />
          </Link>
        </footer>
      </div>
      <nav className="bottom-nav" aria-label="移动导航">
        {[
          nav[0],
          nav[1],
          nav.find((n) => n.href === '/mistakes/')!,
          nav.find((n) => n.href === '/analytics/')!,
        ].map((n) => (
          <Link key={n.href} href={n.href} className={n.href === current.href ? 'active' : ''}>
            <n.icon size={21} />
            <span>{n.label}</span>
          </Link>
        ))}
        <button aria-label="更多功能" onClick={() => setMore(true)}>
          <MoreHorizontal size={21} />
          <span>更多</span>
        </button>
      </nav>
      {more && (
        <Modal title="星研全部功能" onClose={() => setMore(false)}>
          <nav className="mobile-all-nav">
            {visibleNav.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setMore(false)}>
                <n.icon size={18} />
                {n.label}
              </Link>
            ))}
          </nav>
        </Modal>
      )}
    </div>
  );
}
