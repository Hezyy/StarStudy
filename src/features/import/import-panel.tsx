'use client';
import { useMemo, useState } from 'react';
import { Upload, FileSpreadsheet, Download } from 'lucide-react';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import Link from '@/components/ui/app-link';
import { db } from '@/db';
import {
  autoMapping,
  commitImport,
  fieldLabels,
  importFields,
  previewSheet,
  readWorkbook,
  type ColumnMapping,
  type ExcelSheet,
} from '@/services/excel';
import { download, today } from '@/lib/utils';
import { usePlatform } from '@/features/platform/platform';
import {
  isWideSheet,
  previewWideSheet,
  defaultWideWeights,
  type WideWeights,
} from '@/services/wide-excel';
export function ImportPanel() {
  const database = db;
  const app = useApp();
  const platform = usePlatform();
  const [weights, setWeights] = useState<WideWeights>(defaultWideWeights);
  const load = async (bytes: ArrayBuffer, name: string) => {
    const data = await readWorkbook(bytes);
    setSheets(data);
    setMappings(data.map((s) => autoMapping(s.headers)));
    setSelected(data.map((s) => !['使用说明', '月度统计'].includes(s.name)));
    setName(name);
    setResult(null);
  };
  const [sheets, setSheets] = useState<ExcelSheet[]>([]),
    [mappings, setMappings] = useState<ColumnMapping[]>([]),
    [selected, setSelected] = useState<boolean[]>([]),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<{ success: number; failed: number; skipped: number } | null>(
      null,
    ),
    [name, setName] = useState('');
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return sheets.flatMap((s, i) =>
      selected[i]
        ? isWideSheet(s)
          ? previewWideSheet(
              s,
              app.subjects,
              app.tasks,
              weights,
              seen,
              app.sessions,
              app.taskResources,
            )
          : previewSheet(
              s,
              mappings[i],
              app.subjects,
              app.tasks,
              seen,
              app.sessions,
              app.taskResources,
            )
        : [],
    );
  }, [
    sheets,
    mappings,
    selected,
    app.subjects,
    app.tasks,
    weights,
    app.sessions,
    app.taskResources,
  ]);
  const valid = rows.filter((r) => r.task && !r.error && !r.duplicate).length,
    errors = rows.filter((r) => r.error).length,
    duplicates = rows.filter((r) => r.duplicate).length;
  const overlappingDates = useMemo(() => {
    const incoming = new Set(
      rows.filter((row) => row.task && !row.error && !row.duplicate).map((row) => row.task!.date),
    );
    const counts = new Map<string, number>();
    for (const task of app.tasks)
      if (!task.deletedAt && incoming.has(task.date))
        counts.set(task.date, (counts.get(task.date) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [rows, app.tasks]);
  return (
    <section className="panel settings-section">
      <div className="section-heading">
        <h2>
          <FileSpreadsheet size={20} />
          导入考研打卡 Excel
        </h2>
        <span className="tag">.xlsx</span>
      </div>
      <p className="hint">
        支持多表、列映射、预览和去重。已兼容426天宽表：一行多科目可拆成独立任务，课程与题量仍以原始内容为准并标记待核实。
      </p>
      <p className="hint">
        Excel采用追加导入：同一任务会自动跳过，同一天的不同任务会保留。导入不会覆盖或清空原计划；更换整份计划时，可先到学习计划中预览清空未开始的旧任务。
      </p>
      <label className="upload-zone">
        <Upload size={24} />
        <strong>{busy ? '正在处理…' : '选择 Excel 文件'}</strong>
        <span>最多 20 MB · 表头在第一行 · 日期、科目、任务为必需列</span>
        <input
          aria-label="选择 Excel 文件"
          type="file"
          accept=".xlsx"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setSheets([]);
            setResult(null);
            await app.run(async () => {
              if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB，请分批导入');
              await load(await file.arrayBuffer(), file.name);
            }, 'Excel 已读取，请检查映射和预览');
            setBusy(false);
            e.target.value = '';
          }}
        />
      </label>
      {!platform.enabled && (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await app.run(async () => {
              const r = await fetch('/api/local-import', { cache: 'no-store' });
              if (!r.ok) throw new Error('本机导入附件不可用，请用上方文件选择器选取原始Excel');
              await load(await r.arrayBuffer(), '已提供的426天每日打卡计划.xlsx');
            }, '已载入本机附件，请预览确认');
            setBusy(false);
          }}
        >
          载入本机已提供的426天 Excel
        </Button>
      )}
      {sheets.some(isWideSheet) && (
        <div className="warning-box">
          <strong>检测到每日多科目宽表</strong>
          <p>
            原表只有整日总分钟数，以下比例是可修改的导入分配估算，各项加总保持原日总量。说明与月度汇总表默认跳过；来源课程、题号和实际分钟字段保留，不伪造学习计时。
          </p>
          <div className="form-grid">
            {(['math', 'cs', 'english', 'politics'] as const).map((k, i) => (
              <label key={k}>
                {['数学', '408', '英语', '政治'][i]}分配权重
                <input
                  aria-label={`${k}导入权重`}
                  type="number"
                  min={0}
                  max={1000}
                  value={weights[k]}
                  onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
        </div>
      )}
      {sheets.length > 0 && (
        <>
          <h3>{name}</h3>
          {sheets.map((sheet, i) => (
            <details key={sheet.name} className="mapping-sheet" open>
              <summary>
                {sheet.name} · {sheet.rows.length} 行
              </summary>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={selected[i]}
                  onChange={(e) =>
                    setSelected((v) => v.map((s, j) => (j === i ? e.target.checked : s)))
                  }
                />
                导入此工作表
              </label>
              {isWideSheet(sheet) && (
                <p className="hint">
                  已识别数学、408、英语/政治宽表，将按上述权重拆分。原始列完整保留。
                </p>
              )}
              <div
                className="mapping-grid"
                style={isWideSheet(sheet) ? { display: 'none' } : undefined}
              >
                {importFields.map((field) => (
                  <label key={field}>
                    {fieldLabels[field]}
                    {['date', 'subject', 'title'].includes(field) && ' *'}
                    <select
                      aria-label={`${sheet.name} ${fieldLabels[field]}映射`}
                      value={mappings[i]?.[field] ?? ''}
                      onChange={(e) =>
                        setMappings((v) =>
                          v.map((m, j) =>
                            j === i
                              ? {
                                  ...m,
                                  [field]:
                                    e.target.value === '' ? undefined : Number(e.target.value),
                                }
                              : m,
                          ),
                        )
                      }
                    >
                      <option value="">不映射</option>
                      {sheet.headers.map((h, k) => (
                        <option key={k} value={k}>
                          {k + 1}. {h || '未命名列'}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </details>
          ))}
          <div className="import-summary">
            <span>
              可导入 <strong>{valid}</strong>
            </span>
            <span>
              重复跳过 <strong>{duplicates}</strong>
            </span>
            <span className={errors ? 'error-text' : ''}>
              校验失败 <strong>{errors}</strong>
            </span>
          </div>
          {overlappingDates.length > 0 && (
            <section className="warning-box" aria-label="导入日期重叠提醒">
              <h3>新任务日期与已有计划重叠</h3>
              <p>
                以下 {overlappingDates.length} 天已有{' '}
                {overlappingDates.reduce((sum, [, count]) => sum + count, 0)}{' '}
                项任务。确认导入会追加不同任务，同日旧任务不会自动消失。
              </p>
              <p>
                {overlappingDates
                  .slice(0, 10)
                  .map(([date, count]) => `${date}：旧任务 ${count} 项`)
                  .join('；')}
                {overlappingDates.length > 10 ? '；更多日期请查看日历' : ''}
              </p>
              <Button variant="secondary" size="sm" asChild>
                <Link href="/plan/?cleanup=1">先预览清空旧计划</Link>
              </Button>
            </section>
          )}
          <div className="table-scroll">
            <table>
              <caption>导入预览（显示前 200 行，共 {rows.length} 行）</caption>
              <thead>
                <tr>
                  <th>表 / 行</th>
                  <th>日期</th>
                  <th>科目 / 任务</th>
                  <th>分钟</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.sheet} / {r.row}
                    </td>
                    <td>{r.task?.date ?? '—'}</td>
                    <td>
                      {app.subjects.find((s) => s.id === r.task?.subjectId)?.name}
                      <br />
                      {r.task?.title ?? Object.values(r.raw).slice(0, 3).join(' / ')}
                    </td>
                    <td>{r.task?.estimatedMinutes ?? '—'}</td>
                    <td className={r.error ? 'error-text' : ''}>
                      {r.error ?? (r.duplicate ? '重复，将跳过' : '通过')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            未映射列会保存在导入任务的原始内容中。失败行保留在本次报告中，请下载后修正再导入。未填写时长默认为
            30 分钟。
          </p>
          <div className="heading-buttons">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                download(
                  `星研-Excel导入报告-${today()}.json`,
                  JSON.stringify({ file: name, rows, result }, null, 2),
                )
              }
            >
              <Download size={15} />
              下载原始内容与报告
            </Button>
            <Button
              disabled={busy || valid === 0}
              onClick={async () => {
                setBusy(true);
                await app.run(
                  async () => setResult(await commitImport(rows, database)),
                  `导入已处理，请查看结果`,
                );
                setBusy(false);
              }}
            >
              确认导入 {valid} 项任务
            </Button>
          </div>
        </>
      )}
      {result && (
        <p role="status" className="success-box">
          导入完成：成功 {result.success} 项，失败 {result.failed} 项，跳过 {result.skipped}{' '}
          项。已有任务未被覆盖。
        </p>
      )}
    </section>
  );
}
