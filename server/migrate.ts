import { postgresDatabase } from './database';
if (!process.env.DATABASE_URL) throw new Error('请先配置DATABASE_URL');
const db = await postgresDatabase(process.env.DATABASE_URL);
await db.close();
console.log('星研数据库迁移完成');
