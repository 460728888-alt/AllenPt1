import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');

test('volume structure leads with plain-language decisions',()=>{
  for(const label of ['现在先别买','什么时候可以买','什么时候放弃','查看详细分析'])assert.match(app,new RegExp(label));
});

test('technical evidence remains available behind details',()=>{
  for(const label of ['结构下沿','结构上沿','当前量比','风险收益比','突破确认门槛'])assert.match(app,new RegExp(label));
  assert.match(app,/<details class="card section structure-details">/);
});
