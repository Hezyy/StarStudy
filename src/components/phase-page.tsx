import Link from '@/components/ui/app-link';
import { ArrowRight, Compass } from 'lucide-react';
import { Button } from './ui/button';
export function PhasePage({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: string[];
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">星研 · 开发路线图</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <span className="tag">第二阶段</span>
      </div>
      <section className="panel phase-page">
        <Compass size={38} />
        <h2>为下一段研途准备</h2>
        <p>
          当前交付聚焦每日任务、可靠计时、日历和数据安全。此模块尚未实现，不会显示模拟学习记录。
        </p>
        <ul>
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
        <div className="heading-buttons">
          <Button asChild>
            <Link href="/plan/">
              前往学习计划 <ArrowRight size={15} />
            </Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/settings/?tab=data">导入已有学习任务</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
