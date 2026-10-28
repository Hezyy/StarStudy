'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="panel empty-state">
      <h1>页面暂时未能打开</h1>
      <p>请重试；若问题持续，可重新打开应用。重要学习数据请定期备份。</p>
      <button className="button button-primary" onClick={reset}>
        重试
      </button>
    </section>
  );
}
