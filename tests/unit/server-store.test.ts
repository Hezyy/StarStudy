import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { embeddedDatabase, type Database } from '../../server/database';
import { initialBackup, readData, seedData, writeData } from '../../server/store';
import { previewStudyPlan, parsePlanText } from '@/services/study-plan';
import { readFileSync } from 'node:fs';
let db: Database;
const root = path.resolve('.platform-test'),
  directory = path.resolve(root, randomUUID());
const id = randomUUID(),
  other = randomUUID();
beforeAll(async () => {
  await mkdir(root, { recursive: true });
  db = await embeddedDatabase(directory);
  await db.transaction(async (tx) => {
    for (const owner of [id, other]) {
      await tx.query(
        sql`insert into users(id,email,name,password_hash) values(${owner},${`${owner}@example.test`},'合成持久化测试','test-only')`,
      );
      await seedData(tx, owner);
    }
  });
}, 30000);
afterAll(async () => {
  await db?.close();
  if (!directory.startsWith(root + path.sep)) throw new Error('拒绝清理测试目录之外的路径');
  await rm(directory, { recursive: true, force: true });
});
describe('持久化PostgreSQL引擎与图片快照（隔离测试目录）', () => {
  it('重启嵌入式引擎、重新执行迁移后，任务、图片、版本与另一账号数据都保留', async () => {
    const before = await readData(db, id),
      plan = parsePlanText(readFileSync('public/templates/study-plan.minimal.json', 'utf8'));
    const after = previewStudyPlan(plan, before.backup, 'merge', randomUUID).after;
    const stamp = new Date().toISOString();
    after.data.mistakes.push({
      id: randomUUID(),
      createdAt: stamp,
      updatedAt: stamp,
      subjectId: after.data.tasks[0].subjectId,
      knowledgePointIds: [],
      question: '合成图片测试',
      wrongAnswer: '',
      correctAnswer: '',
      reason: '',
      reviewDate: '2027-01-02',
      mastery: 'weak',
      images: [
        {
          type: 'image/png',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
        },
      ],
    });
    await db.transaction((tx) => writeData(tx, id, after, before.version));
    await db.close();
    db = await embeddedDatabase(directory);
    const loaded = await readData(db, id);
    expect(loaded.version).toBe(before.version + 1);
    expect(loaded.backup.data.tasks).toHaveLength(1);
    expect(loaded.backup.data.mistakes[0].images[0]).toEqual(after.data.mistakes[0].images[0]);
    expect((await readData(db, other)).backup.data.tasks).toHaveLength(0);
  }, 30000);
  it('恢复快照留在本人名下，失败写入回滚版本与所有表', async () => {
    const before = await readData(db, id),
      invalid = structuredClone(before.backup);
    invalid.data.tasks[0].subjectId = randomUUID();
    await expect(
      db.transaction((tx) => writeData(tx, id, invalid, before.version)),
    ).rejects.toThrow('关联数据丢失');
    const after = await readData(db, id);
    expect(after.version).toBe(before.version);
    expect(after.backup.data).toEqual(before.backup.data);
    const copies = await db.query(
      sql`select owner_id,payload from recovery_copies where owner_id=${id}`,
    );
    expect(copies.length).toBeGreaterThan(0);
    expect(copies.every((c) => c.owner_id === id)).toBe(true);
  });
  it('全量备份结构可往返且用户新建目标无个人院校预置', () => {
    const backup = initialBackup();
    expect(backup.data.examTargets[0].university).toBe('待设置目标院校');
    expect(backup.data.userProfiles[0].university).toBe('');
  });
});
