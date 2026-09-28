import test from 'node:test';
import assert from 'node:assert/strict';
import {buildVolumeScreenProfile,classifyVolumeCandidate} from './volume-screen.js';

function rows(){
  return Array.from({length:60},(_,index)=>({
    close:index<40?12-index*.05:10+(index-40)*.01,
    high:index<40?12.2-index*.05:10.2,
    low:index<40?11.8-index*.05:9.8+(index-40)*.005,
    volume:index<55?1000:700
  }));
}

test('识别回调、缩量和低点企稳',()=>{
  const structure={evidence:{compression:true,lowsRising:true}};
  const profile=buildVolumeScreenProfile(rows(),structure);
  assert.equal(profile.usefulPullback,true);
  assert.equal(profile.volumeDriedUp,true);
  assert.equal(profile.lowsStoppedFalling,true);
});

test('缩量横盘进入黄色等待区',()=>{
  const label=classifyVolumeCandidate({stage:'横盘蓄势',riskReward:1.8},{usefulPullback:true,volumeDriedUp:true,priceTight:true,lowsStoppedFalling:true});
  assert.equal(label.tone,'yellow');
});

test('放量突破进入绿色重点区',()=>{
  const label=classifyVolumeCandidate({stage:'向上突破待确认'},{usefulPullback:true,riskReward:1.7,volumeDriedUp:false,priceTight:false,lowsStoppedFalling:true});
  assert.equal(label.tone,'green');
});

test('已跟踪股票破位后标红',()=>{
  const label=classifyVolumeCandidate({stage:'结构失效',riskReward:.8},{usefulPullback:true},{wasTracked:true});
  assert.equal(label.tone,'red');
});
