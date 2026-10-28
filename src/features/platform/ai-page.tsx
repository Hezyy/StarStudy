'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from '@/components/ui/app-link';
import { usePlatform } from './platform';
import { useApp } from '@/components/provider';
import { db } from '@/db';
import { Button } from '@/components/ui/button';
import { download, entity } from '@/lib/utils';

interface Status {
  enabled: boolean;
  adminKeyConfigured: boolean;
  byok: { configured: boolean; expiresAt: number | null };
  usage: {
    kind: string;
    status: string;
    input_tokens: number;
    output_tokens: number;
    created_at: string;
    estimated_micro_cost: number;
  }[];
}
interface Result {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  costEstimateConfigured: boolean;
}
const kindLabels: Record<string, string> = {
  plan: '生成标准计划',
  adjust: '调整计划建议',
  review: '分析周复盘',
  convert: '转换为标准计划',
  explain: '解释任务安排',
  weakness: '分析薄弱知识点',
  test: '连接测试',
};
const statusLabels: Record<string, string> = { pending: '处理中', success: '成功', failed: '失败' };

export function PlatformAiPage() {
  const database = db;
  const platform = usePlatform(),
    app = useApp();
  const { request } = platform;
  const { run } = app;
  const [status, setStatus] = useState<Status | null>(null),
    [key, setKey] = useState('');
  const [kind, setKind] = useState('explain'),
    [provider, setProvider] = useState('deepseek');
  const [prompt, setPrompt] = useState(''),
    [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState<string | null>(null);
  const preference = app.settings.find((setting) => setting.key === 'ai-enabled');
  const storedAllowAi = preference?.value !== false;
  const preferenceSignature = JSON.stringify(preference ?? null);
  const [optimisticPreference, setOptimisticPreference] = useState<{
    enabled: boolean;
    signature: string;
  } | null>(null);
  const allowAi =
    optimisticPreference?.signature === preferenceSignature
      ? optimisticPreference.enabled
      : storedAllowAi;
  const lock = useRef(false);
  const load = useCallback(async () => {
    try {
      setStatus(await request<Status>('/ai/status'));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取失败，请重试。');
    }
  }, [request]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (optimisticPreference && optimisticPreference.signature !== preferenceSignature)
      setOptimisticPreference(null);
  }, [optimisticPreference, preferenceSignature]);
  const action = useCallback(
    async (id: string, operation: () => Promise<unknown>, success?: string) => {
      if (lock.current) return false;
      lock.current = true;
      setBusy(id);
      setError('');
      try {
        return await run(async () => {
          try {
            await operation();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '请求失败，请重试。');
            throw cause;
          }
        }, success);
      } finally {
        lock.current = false;
        setBusy(null);
      }
    },
    [run],
  );
  const call = (test = false) =>
    action(
      test ? 'test' : 'request',
      async () => {
        if (!allowAi) throw new Error('本账户已关闭AI，请先开启后再发送。');
        if ((await database.settings.where('key').equals('ai-enabled').first())?.value === false)
          throw new Error('本账户已关闭AI，请先开启后再发送。');
        if (!test && !prompt.trim()) throw new Error('请先填写需要发送给AI的内容。');
        const response = await platform.request<Result>('/ai/call', 'POST', {
          provider: test ? 'deepseek' : provider,
          kind: test ? 'test' : kind,
          prompt: test ? '连接测试' : prompt,
        });
        setResult(response);
        await load();
      },
      test ? '连接测试完成' : 'AI建议已返回，请检查内容后再操作',
    );
  const setPreference = async (enabled: boolean) => {
    if (lock.current) return;
    setOptimisticPreference({ enabled, signature: preferenceSignature });
    const saved = await action(
      'preference',
      async () => {
        await database.transaction('rw', database.settings, async () => {
          const old = await database.settings.where('key').equals('ai-enabled').first();
          await database.settings.put({
            ...(old ?? entity()),
            key: 'ai-enabled',
            value: enabled,
            updatedAt: new Date().toISOString(),
          });
        });
      },
      enabled ? '本账户已允许AI请求' : '本账户AI请求已关闭',
    );
    if (!saved) setOptimisticPreference(null);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">按需使用，始终由你决定</p>
          <h1>AI与账户同步</h1>
          <p>账户数据通过本部署同步。AI调用只发送你在下方明确填写的内容。</p>
        </div>
      </div>
      <section className="panel settings-section">
        <h2>AI服务状态</h2>
        <p role="status">
          {status
            ? `${status.enabled ? '管理员已开启AI' : 'AI尚未启用'} · ${status.adminKeyConfigured ? '服务器已配置DeepSeek密钥' : '服务器未配置DeepSeek密钥'}`
            : error
              ? '暂时无法读取服务状态'
              : '正在检查服务配置…'}
        </p>
        <p>没有密钥也可以生成标准提示词，再从外部AI导入计划。</p>
        <div className="button-row">
          <Button asChild>
            <Link href="/plan/import-ai/">生成提示词 / 导入计划</Link>
          </Button>
          <Button
            variant="ghost"
            loading={busy === 'load'}
            disabled={!!busy}
            onClick={() => action('load', load)}
          >
            重新检查
          </Button>
        </div>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={allowAi}
            disabled={!!busy}
            onChange={(event) => void setPreference(event.target.checked)}
          />
          允许本账户在此页面发送AI请求
        </label>
        {!allowAi && (
          <p className="hint">已关闭。外部AI提示词与计划导入仍可使用，原学习数据不受影响。</p>
        )}
        {error && (
          <p role="alert" className="warning">
            {error}
          </p>
        )}
      </section>
      <section className="panel settings-section">
        <h2>使用自己的DeepSeek密钥</h2>
        <p>
          密钥仅保存在服务端内存，与当前登录会话绑定，15分钟后失效；服务重启或退出登录后清除。不会写入数据库、浏览器存储或日志。
        </p>
        <form
          className="platform-form"
          onSubmit={(event) => {
            event.preventDefault();
            void action(
              'key',
              async () => {
                await platform.request('/ai/key', 'POST', { key });
                setKey('');
                await load();
              },
              '会话密钥已启用，15分钟有效',
            );
          }}
        >
          <label>
            会话密钥
            <input
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              minLength={10}
              maxLength={500}
              autoComplete="off"
              required
              spellCheck={false}
            />
          </label>
          <div className="button-row">
            <Button
              type="submit"
              loading={busy === 'key'}
              disabled={!key.trim() || !!busy || !allowAi}
            >
              启用15分钟
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={busy === 'test'}
              disabled={!!busy || !status?.enabled || !allowAi}
              onClick={() => call(true)}
            >
              测试连接（消耗一次额度）
            </Button>
            <Button
              type="button"
              variant="ghost"
              loading={busy === 'delete'}
              disabled={!!busy || !status?.byok.configured}
              onClick={() =>
                action(
                  'delete',
                  async () => {
                    await platform.request('/ai/key', 'DELETE', {});
                    await load();
                  },
                  '会话密钥已删除',
                )
              }
            >
              删除会话密钥
            </Button>
          </div>
        </form>
        {status?.byok.configured && (
          <p role="status">
            当前会话已配置，至 {new Date(status.byok.expiresAt!).toLocaleTimeString()}
            。到期后请重新启用。
          </p>
        )}
      </section>
      <section className="panel settings-section">
        <h2>向AI请求建议</h2>
        <form
          className="platform-form"
          onSubmit={(event) => {
            event.preventDefault();
            void call();
          }}
        >
          <div className="form-grid">
            <label>
              服务
              <select
                aria-label="服务"
                value={provider}
                disabled={!!busy}
                onChange={(event) => setProvider(event.target.value)}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI（需服务器另行配置）</option>
              </select>
            </label>
            <label>
              用途
              <select
                aria-label="用途"
                value={kind}
                disabled={!!busy}
                onChange={(event) => setKind(event.target.value)}
              >
                {Object.entries(kindLabels)
                  .filter(([value]) => value !== 'test')
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label>
            将发送给AI的内容
            <textarea
              rows={8}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="计划生成/转换请先从AI计划导入页复制包含格式示例的标准提示词。其他请求请写明实际记录和问题。"
              maxLength={60000}
              required
            />
          </label>
          <p>
            点击发送后，此内容会传给选择的AI服务商。不会自动包含笔记或图片，结果不会直接修改学习记录。
          </p>
          <Button
            type="submit"
            loading={busy === 'request'}
            disabled={!prompt.trim() || !status?.enabled || !!busy || !allowAi}
          >
            发送并获取建议
          </Button>
        </form>
        {result && (
          <div className="platform-ai-result">
            <p className="hint">
              {result.model} · 输入 {result.inputTokens} / 输出 {result.outputTokens} tokens ·{' '}
              {result.costEstimateConfigured
                ? `估算费用 ${result.estimatedCost.toFixed(6)}（部署配置币种）`
                : '未配置价格，暂无费用估值'}
            </p>
            <label>
              AI返回内容
              <textarea readOnly rows={12} value={result.text} />
            </label>
            <div className="button-row">
              <Button
                variant="secondary"
                onClick={() =>
                  app.run(() => navigator.clipboard.writeText(result.text), '结果已复制')
                }
              >
                复制结果
              </Button>
              <Button
                variant="ghost"
                onClick={() => download('星研-AI返回内容.txt', result.text, 'text/plain')}
              >
                下载结果
              </Button>
              <Button variant="ghost" asChild>
                <Link href="/plan/import-ai/">前往校验与导入</Link>
              </Button>
            </div>
          </div>
        )}
      </section>
      <section className="panel settings-section">
        <h2>近期调用与估算</h2>
        <p>
          费用仅按部署者配置的单价估算，不代表服务商账单；未配置单价时不提供费用估值。失败调用也占用预留额度，防止反复请求绕过限制。
        </p>
        {status?.usage.length ? (
          <ul className="platform-usage-list">
            {status.usage.map((usage, index) => (
              <li key={index}>
                <time dateTime={usage.created_at}>
                  {new Date(usage.created_at).toLocaleString()}
                </time>
                <span>
                  {kindLabels[usage.kind] ?? usage.kind} ·{' '}
                  {statusLabels[usage.status] ?? usage.status} ·{' '}
                  {usage.input_tokens + usage.output_tokens} tokens
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>{status ? '暂无调用记录。' : '等待读取调用记录…'}</p>
        )}
      </section>
    </>
  );
}
