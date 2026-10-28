export default function Loading() {
  return (
    <section className="page-skeleton" role="status" aria-label="正在打开页面" aria-busy="true">
      <span className="skeleton-line skeleton-title" />
      <span className="skeleton-line" />
      <div className="skeleton-content">
        <span className="skeleton-line" />
        <span className="skeleton-line" />
        <span className="skeleton-line" />
      </div>
      <span className="sr-only">正在打开页面，学习记录会保留。</span>
    </section>
  );
}
