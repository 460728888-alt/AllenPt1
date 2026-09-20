import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const child=spawn(process.execPath,['--import','./radar-fixture.mjs','server.js'],{env:{...process.env,PORT:'18947',DATABASE_URL:'',AI_API_KEY:'',APP_USERNAME:'testadmin',APP_PASSWORD:'fixture-test-password'},stdio:['ignore','pipe','pipe']});
try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),10000);child.stdout.on('data',()=>{clearTimeout(t);resolve()});child.once('exit',()=>reject(Error('startup failed')));});
 const base='http://127.0.0.1:18947';
 assert.equal((await fetch(base+'/api/ai/radar-history')).status,401);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'testadmin',password:'fixture-test-password'})});
 assert.equal(login.status,200);
 const headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0]};
 assert.equal((await fetch(base+'/api/ai/screen',{method:'POST',headers,body:'{"days":365}'})).status,400);
 const res=await fetch(base+'/api/ai/screen',{method:'POST',headers,body:'{"days":30,"risk":"高"}'});
 assert.equal(res.status,200);const report=await res.json();assert.equal(report.window.days,30);assert.equal(report.risk,'高');assert.equal(report.candidates.length,6);assert.equal(report.durable,false);assert.equal(report.coverage.researched,20);
 const archive=await(await fetch(base+'/api/ai/radar-history',{headers})).json();assert.equal(archive.reports[0].id,report.id);
 const created=await fetch(base+'/api/admin/users',{method:'POST',headers,body:JSON.stringify({username:'seconduser',password:'second-test-password'})});assert.equal(created.status,200);
 const other=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'seconduser',password:'second-test-password'})});
 const otherHistory=await(await fetch(base+'/api/ai/radar-history',{headers:{Cookie:other.headers.get('set-cookie').split(';')[0]}})).json();assert.equal(otherHistory.reports.length,0);
 console.log('PASS: login, auth guard, invalid window, fixture-backed report, criteria retention, archive read, two-account isolation.');
}finally{child.kill();}
