'use client';
import { appUrl } from '@/lib/app-path';
import { useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import {
  learningReport,
  reportMarkdown,
  planTemplate,
  previewExternalPlan,
} from '@/services/collaboration';
import { download, today } from '@/lib/utils';
import { ProposalPreview } from '@/features/planner/proposal-preview';
import type { PlanProposal } from '@/scheduler/types';
export function CollaborationPage() {
  const app = useApp();
  const [days, setDays] = useState<7 | 30>(7),
    [from, setFrom] = useState(format(subDays(parseISO(today()), 6), 'yyyy-MM-dd')),
    [to, setTo] = useState(today()),
    [future, setFuture] = useState(false),
    [notes, setNotes] = useState(false),
    [mistakes, setMistakes] = useState(false),
    [request, setRequest] = useState(''),
    [json, setJson] = useState(''),
    [proposal, setProposal] = useState<PlanProposal | null>(null),
    [busy, setBusy] = useState(false);
  const report = () =>
    learningReport(app, {
      days,
      from,
      to,
      includeFuture: future,
      includeNotes: notes,
      includeMistakeText: mistakes,
      request,
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">用明确的文件，接续学习上下文</p>
          <h1>ChatGPT 协作中心</h1>
          <p>无需付费 API。报告导出后自行交给 ChatGPT，返回方案仍需校验与确认。</p>
        </div>
      </div>
      <section className="panel settings-section">
        <h2>导出学习报告</h2>
        <div className="form-grid">
          <label>
            快捷范围
            <select
              aria-label="报告快捷范围"
              value={days}
              onChange={(e) => {
                const n = Number(e.target.value) as 7 | 30;
                setDays(n);
                setFrom(format(subDays(parseISO(to), n - 1), 'yyyy-MM-dd'));
              }}
            >
              <option value={7}>最近7天</option>
              <option value={30}>最近30天</option>
            </select>
          </label>
          <label>
            调整要求
            <textarea
              rows={2}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="例如：下周考试，数学优先，每天只有30分钟"
            />
          </label>
          <label>
            导出开始日期
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            导出截止日期
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="privacy-options">
          <label className="inline-check">
            <input type="checkbox" checked={future} onChange={(e) => setFuture(e.target.checked)} />
            包含未来计划
          </label>
          <label className="inline-check">
            <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} />
            包含私人学习笔记
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={mistakes}
              onChange={(e) => setMistakes(e.target.checked)}
            />
            包含错题题目与原因
          </label>
        </div>
        <p className="hint">
          默认不导出笔记、图片和错题文本；保留稳定任务ID、预算、掌握度与依赖信息。近7/30天均有按日汇总。
        </p>
        <div className="record-actions">
          <Button
            onClick={() =>
              app.run(
                async () =>
                  download(
                    `星研-ChatGPT学习报告-${to}.md`,
                    reportMarkdown(report()),
                    'text/markdown',
                  ),
                '报告已导出',
              )
            }
          >
            导出 Markdown 报告
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              app.run(
                async () =>
                  download(`星研-ChatGPT学习报告-${to}.json`, JSON.stringify(report(), null, 2)),
                '报告已导出',
              )
            }
          >
            导出 JSON 报告
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              download('星研-调整方案模板.json', JSON.stringify(planTemplate(app), null, 2))
            }
          >
            下载当前任务方案模板
          </Button>
        </div>
      </section>
      <section className="panel settings-section">
        <h2>导入 ChatGPT 调整方案</h2>
        <p className="hint">
          只接受指定版本的
          JSON。校验任务ID、重复记录、日期、时长、知识点依赖、完成保护和每日预算，不执行文件里的代码或指令。
        </p>
        <label>
          选择调整方案 JSON
          <input
            type="file"
            accept=".json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 5 * 1024 * 1024) {
                app.notify('调整方案不超过5MB', true);
                return;
              }
              setJson(await f.text());
              e.target.value = '';
            }}
          />
        </label>
        <label>
          调整方案内容
          <textarea
            aria-label="调整方案内容"
            className="code-input"
            rows={12}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            placeholder='{"app":"星研","kind":"plan-adjustment","schemaVersion":1,…}'
          />
        </label>
        <div className="record-actions">
          <Button
            disabled={busy || !json.trim()}
            onClick={async () => {
              setBusy(true);
              await app.run(
                async () => setProposal(await previewExternalPlan(JSON.parse(json))),
                '方案校验通过，请检查差异',
              );
              setBusy(false);
            }}
          >
            校验并预览方案
          </Button>
          <Button
            variant="secondary"
            onClick={() => setJson(JSON.stringify(planTemplate(app), null, 2))}
          >
            载入当前任务模板
          </Button>
          <Button variant="ghost" asChild>
            <a href={appUrl('/templates/plan-adjustment.example.json')} download>
              下载格式示例（需替换ID）
            </a>
          </Button>
          <Button variant="ghost" asChild>
            <a href={appUrl('/templates/plan-adjustment.schema.json')} download>
              下载 JSON Schema
            </a>
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              download(
                '星研-开发状态报告.json',
                JSON.stringify(
                  {
                    app: '星研',
                    version: '0.4.0',
                    generatedAt: new Date().toISOString(),
                    implemented: [
                      '本地任务与计时',
                      '错题与知识点',
                      '学习资料',
                      '周复盘与统计',
                      '规则排期与计划版本',
                      'ChatGPT文件协作',
                      'Excel与完整备份',
                      '离线PWA',
                      '独立账户、管理员与邀请注册',
                      '标准AI计划向导与服务端确认导入',
                      '账户缓存、版本同步与冲突恢复',
                      'DeepSeek Provider与会话BYOK接口',
                      'AGPL对应源码下载与Linux部署工具',
                    ],
                    configurationRequired: [
                      '平台PostgreSQL、会话密钥、服务器与HTTPS域名',
                      '可选DeepSeek或OpenAI密钥及模型配置',
                      '真实Docker、网络PostgreSQL与iPhone/Android验收',
                    ],
                    recentUpdates: [
                      'v0.4.0：多用户平台、AI计划导入、账户同步与部署工具',
                      'v0.3.0：统一交互、局部计时与流畅任务管理',
                      '数据库无损升级v3；完整备份兼容旧格式并保留图片',
                      '适配426天原始多科宽表；保留原文、重复保护与真实时间缺口',
                    ],
                    knownIssues: [
                      '真实iPhone、长期大图片库和真实云服务尚未验收',
                      '旧任务缺少实际完成日期时无法完整重建历史积压',
                      '计时依赖设备时间，关闭页面不会自动停止',
                    ],
                    pending: [
                      '真实设备与可选服务联调',
                      '逐条增量同步、自动冲突合并和多实例共享限流',
                      '关闭应用后的后台推送、持续同步与手工计时校正',
                    ],
                    userRequest: request,
                  },
                  null,
                  2,
                ),
              )
            }
          >
            导出开发状态报告
          </Button>
        </div>
      </section>
      {proposal && (
        <ProposalPreview
          proposal={proposal}
          onCancel={() => setProposal(null)}
          onModify={() => setProposal(null)}
        />
      )}
    </>
  );
}
