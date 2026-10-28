import Link from '@/components/ui/app-link';
export default function NotFound() {
  return (
    <div className="empty-state">
      <h1>没有找到这个页面</h1>
      <Link href="/">返回今日学习</Link>
    </div>
  );
}
