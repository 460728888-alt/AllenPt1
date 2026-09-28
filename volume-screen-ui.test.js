import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');

test('量价筛选默认覆盖约1200只股票',()=>{
  assert.match(app,/limit:1200/);
  assert.match(app,/已经检查/);
  assert.match(app,/找到.*只候选/);
});
