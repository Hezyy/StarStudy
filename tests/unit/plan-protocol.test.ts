import { describe,it,expect } from 'vitest';
import { csvRows,markdownRows,tablePlan } from '@/services/plan-tables';
import { videoLink } from '@/lib/video-link';
import { parsePlanText,previewStudyPlan } from '@/services/study-plan';
import { initialBackup } from '../../server/store';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dataHash } from '@/lib/data-hash';
const example=()=>parsePlanText(readFileSync('public/templates/study-plan.minimal.json','utf8'));
describe('新计划协议与视频入口',()=>{
 it('CSV转义与Markdown表格按同一协议校验，未知文本失败',()=>{expect(csvRows('a,b\n"x,y","z""q"')).toEqual([['a','b'],['x,y','z"q']]);expect(()=>csvRows('"unclosed')).toThrow();const base=example();expect(tablePlan(csvRows('日期,科目,任务,时长,自定义\n2027/1/1,数学一,复习,30,原样保留'),base).tasks[0].notes).toContain('原样保留');expect(tablePlan(markdownRows('|日期|科目|任务|时长|\n|---|---|---|---|\n|2027-01-01|数学一|复习|30|'),base).tasks).toHaveLength(1);expect(()=>markdownRows('请帮我制定计划')).toThrow();});
 it('精确视频、选集、搜索和普通页面区分，不安全协议和错误选集被拒绝',()=>{expect(videoLink('https://www.bilibili.com/video/BV1xx411c7mD?p=3').kind).toBe('video');expect(videoLink('https://www.bilibili.com/video/BV1xx411c7mD?p=3').label).toContain('第3集');expect(videoLink('https://search.bilibili.com/all?keyword=math').label).toBe('搜索对应视频');for(const value of ['javascript:alert(1)','data:text/html,x','https://www.bilibili.com/video/nope','https://www.bilibili.com/video/BV1xx411c7mD?p=0','https://user:secret@example.com'])expect(videoLink(value).kind).toBe('invalid');});
 it('替换保护完成与真实记录、无审批只纯预览、不改变掌握状态',()=>{const current=initialBackup(),first=previewStudyPlan(example(),current,'merge',randomUUID);const task=first.after.data.tasks[0];task.status='completed';const next=example();next.tasks[0].externalId='new-task';next.tasks[0].title='新任务';const preview=previewStudyPlan(next,first.after,'replace',randomUUID);expect(preview.after.data.tasks.find(t=>t.id===task.id)?.status).toBe('completed');expect(current.data.tasks).toHaveLength(0);expect(previewStudyPlan(example(),first.after,'new',randomUUID).errors).toContain('此计划代号已经存在，请选择合并计划以继续导入后续月份');});
 it('JSONB对象键顺序、数据库行顺序不影响同步哈希',async()=>{const b=initialBackup(),other=structuredClone(b);other.data.subjects.reverse();other.data.settings[0].value=Object.fromEntries(Object.entries(other.data.settings[0].value as object).reverse());expect(await dataHash(b)).toBe(await dataHash(other));});
});
