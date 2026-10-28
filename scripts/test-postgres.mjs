import {execFileSync} from 'node:child_process';
const value=process.env.TEST_POSTGRES_URL;
if(!value){console.error('未运行网络PostgreSQL测试：请设置TEST_POSTGRES_URL，且仅可指向独立的star_study_test测试库。');process.exit(1);}
let url;try{url=new URL(value);}catch{console.error('TEST_POSTGRES_URL格式无效');process.exit(1);}
if(!['postgres:','postgresql:'].includes(url.protocol)||url.pathname!=='/star_study_test'){console.error('拒绝运行：只允许独立的star_study_test数据库，绝不能使用真实学习数据库。');process.exit(1);}
execFileSync(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/unit/platform.test.ts'],{stdio:'inherit',env:process.env});
