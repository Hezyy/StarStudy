'use client';
import { useEffect, useState } from 'react';
import { useApp } from './provider';
export function KnowledgePicker({
  subjectId,
  value,
  onChange,
  label = '关联知识点',
}: {
  subjectId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}) {
  const { knowledgePoints } = useApp();
  return (
    <label>
      {label}
      <select
        aria-label={label}
        multiple
        size={3}
        value={value}
        onChange={(e) => onChange(Array.from(e.target.selectedOptions, (v) => v.value))}
      >
        {knowledgePoints
          .filter((k) => k.subjectId === subjectId && !k.archivedAt)
          .map((k) => (
            <option key={k.id} value={k.id}>
              {k.chapter ? `${k.chapter} / ` : ''}
              {k.name}
            </option>
          ))}
      </select>
      <small className="hint">可多选；先在知识点管理中建立概念和依赖。</small>
    </label>
  );
}
export function BlobImages({ images }: { images: Blob[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const u = images.map((b) => URL.createObjectURL(b));
    setUrls(u);
    return () => u.forEach(URL.revokeObjectURL);
  }, [images]);
  return (
    <div className="mistake-images">
      {urls.map((u, i) => (
        <a href={u} target="_blank" rel="noreferrer" key={u}>
          <img src={u} alt={`错题图片 ${i + 1}`} />
        </a>
      ))}
    </div>
  );
}
