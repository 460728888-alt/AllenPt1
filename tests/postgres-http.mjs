import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {createResearchStore,snapshotHash} from '../research-store.js';
import {SCREEN_STRATEGY} from '../price-levels.js';

if(process.env.DATABASE_URL)throw Error('DATABASE_URL must be empty in acceptance tests');
const raw=process.env.TEST_DATABASE_URL;
if(!raw)throw Error('TEST_DATABASE_URL is required');
const db=new URL(raw);
if(!['postgres:','postgresql:'].includes(db.protocol)||
  !['127.0.0.1','localhost','[::1]'].includes(db.hostname)||
  !/^\/allen_test_[a-z0-9_]+$/.test(db.pathname)||db.search)
  throw Error('Only a local allen_test_* database is allowed');

const root=fileURLToPath(new URL('..',import.meta.url));
// 全部为合成测试数据，不连接生产数据库。
// 行情状态通过浏览器接口拦截演示，不代表真实扫描结果。
const schema='allen_test_'+crypto.randomBytes(10).toString('hex');
const user='allen_test_admin',password=crypto.randomBytes(20).toString('hex');
const artifacts=root+'test-results/'+(process.env.TEST_BROWSER==='true'?'browser-':'http-')+(process.env.TZ||'UTC').replace(/[^a-zA-Z0-9_-]/g,'_')+'/';
fs.mkdirSync(artifacts,{recursive:true});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function freePort(){
  const server=net.createServer();
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  const port=server.address().port;
  await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  return port;
}

await test('real site restart, failure notices and backup export',{
  timeout:300000
},async t=>{
  const admin=new pg.Pool({connectionString:raw,connectionTimeoutMillis:3000,max:1});
  let created=false,pool,site,browser,base,cookie='',uid,recordId,seedCard;
  let blocked=false,spawnError=null;
  const sockets=new Set();

  const proxy=net.createServer(client=>{
    if(blocked){client.destroy();return}
    const upstream=net.connect({
      host:db.hostname.replace(/^$begin:math:display$\|$end:math:display$$/g,''),
      port:Number(db.port||5432)
    });
    sockets.add(client);sockets.add(upstream);
    const close=()=>{
      client.destroy();upstream.destroy();
      sockets.delete(client);sockets.delete(upstream);
    };
    client.on('error',close);upstream.on('error',close);
    client.on('close',close);upstream.on('close',close);
    client.pipe(upstream);upstream.pipe(client);
  });

  const block=()=>{
    blocked=true;
    for(const socket of [...sockets])socket.destroy();
  };
  const request=(path,options={})=>fetch(base+path,{
    ...options,
    headers:{
      'Content-Type':'application/json',
      ...(cookie?{Cookie:cookie}:{}),
      ...options.headers
    },
    signal:AbortSignal.timeout(12000)
  });
  const json=async(path,options={})=>{
    const response=await request(path,options),body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body));
    return body;
  };

  async function stop(){
    const child=site;site=null;
    if(!child||child.exitCode!==null)return;
    await new Promise(resolve=>{
      const timer=setTimeout(()=>child.kill('SIGKILL'),3000);
      child.once('exit',()=>{clearTimeout(timer);resolve()});
      child.kill('SIGTERM');
    });
  }

  async function start(port,proxyPort){
    const target=new URL(raw);
    target.hostname='127.0.0.1';target.port=String(proxyPort);
    target.searchParams.set('options','-c search_path='+schema+',pg_catalog');
    spawnError=null;
    site=spawn(process.execPath,['server.js'],{
      cwd:root,stdio:['ignore','pipe','pipe'],
      env:{
        PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'test',
        TZ:process.env.TZ||'UTC',HOST:'127.0.0.1',PORT:String(port),
        APP_USERNAME:user,APP_PASSWORD:password,DATABASE_URL:target.href,
        AI_API_KEY:'',FORECAST_API_URL:'',RESEARCH_HISTORY_ENABLED:'true'
      }
    });
    site.on('error',error=>{spawnError=error});
    for(const stream of [site.stdout,site.stderr])
      stream.on('data',chunk=>fs.appendFileSync(artifacts+'site-process.log',chunk));
    for(let i=0;i<100;i++){
      if(spawnError)throw spawnError;
      if(site.exitCode!==null)throw Error('Site exited; inspect site-process.log');
      try{if((await request('/api/health')).ok)return}catch{}
      await pause(100);
    }
    throw Error('Site startup timed out; inspect site-process.log');
  }

  const original={
    symbol:'600006.SS',code:'600006',name:'合成测试股票（非行情）',
    generatedAt:'2026-10-12T08:00:00Z',dataThrough:'2026-10-12',price:11.5,
    data:{state:'ok',dataThrough:'2026-10-12',historyStart:'2026-01-01'},
    levels:{entry:12,stop:10,target1:13,target2:14},
    evidence:{source:'synthetic-test-only'}
  };

  try{
    await admin.query('CREATE SCHEMA '+schema);created=true;
    pool=new pg.Pool({
      connectionString:raw,
      options:'-c search_path='+schema+',pg_catalog',
      connectionTimeoutMillis:3000,max:3
    });
    await new Promise((resolve,reject)=>{
      proxy.once('error',reject);
      proxy.listen(0,'127.0.0.1',resolve);
    });
    const proxyPort=proxy.address().port,port=await freePort();
    base='http://127.0.0.1:'+port;
    await start(port,proxyPort);

    await t.test('real login, immutable fixture and old data coexist',async()=>{
      const response=await request('/api/login',{
        method:'POST',body:JSON.stringify({username:user,password})
      });
      const body=await response.json();
      assert.equal(response.status,200,JSON.stringify(body));
      cookie=response.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie);uid=body.user.id;

      const client=await pool.connect();
      try{
        await client.query(fs.readFileSync(root+'migrations/001_research_history.sql','utf8'));
      }catch(error){
        await client.query('ROLLBACK');throw error;
      }finally{client.release()}

      await json('/api/user-state',{
        method:'PUT',
        body:JSON.stringify({
          watch:[],portfolio:[],
          theses:[{
            symbol:'600006.SS',name:'合成旧逻辑',
            reason:'synthetic legacy fixture'
          }]
        })
      });
      await pool.query(
        'INSERT INTO announcement_reads(announcement_id,user_id) SELECT id,$1 FROM announcements ON CONFLICT DO NOTHING',
        [uid]
      );
      const store=createResearchStore(pool,{enabled:true});
      const saved=await store.saveVolumeScan(uid,{
        id:crypto.randomUUID(),createdAt:new Date().toISOString(),
        strategy:SCREEN_STRATEGY,
        observations:[original],
        items:[{
          ...original,tone:'yellow',status:'结构观察，资格未判定',
          reason:'合成数据，仅验证页面',
          confirmPrice:12,giveUpPrice:10,targetPrice:13,target2:14
        }],
        counts:{qualified:null,observations:1},
        coverage:{
          requested:2,returned:2,failed:0,usable:2,
          coveragePct:100,partial:false,
          dateRange:['2026-10-12','2026-10-12']
        }
      });
      seedCard=saved.items[0];
      recordId=seedCard.researchId;
      assert.ok(recordId);

      await pool.query(
        'INSERT INTO radar_journal(id,user_id,report_id,symbol,data_json) VALUES($1,$2,$3,$4,$5)',
        [
          crypto.randomUUID(),uid,'synthetic-old-report',original.symbol,
          JSON.stringify({
            reportId:'synthetic-old-report',
            idea:{name:'合成旧卡',symbol:original.symbol},
            window:{end:'2026-10-30'},status:'跟踪中',
            notes:[],checks:[],legacy:true
          })
        ]
      );
      const record=await json('/api/research-history/'+recordId);
      assert.equal(record.snapshotHash,snapshotHash(record.original));
    });

    let beforeRestart;
    await t.test('frozen retrospective study is authenticated and remains separate from forecasts',async()=>{
      const denied=await request('/api/validation/five-session',{headers:{Cookie:''}});
      assert.equal(denied.status,401);
      const {report}=await json('/api/validation/five-session');
      assert.equal(report.provenance,'reconstructed');assert.equal(report.approved,false);
      assert.equal(report.probabilitiesEnabled,false);assert.equal(report.historicalQuoteScaleVerified,false);
      assert.equal(report.coverage.validPriceLabels,7108);
      assert.equal(report.actualTradingReturn,null);assert.equal(report.portfolioMaxDrawdown,null);
      assert.equal(report.dataOrigin.noNewDataRequests,true);
      for(const group of report.groups)
        assert.ok(Math.abs(group.hypotheticalCostScenarios[0].dailyEqualWeightMeanAssumedReturn-group.dailyEqualWeightMeanPriceReturn)<1e-14);
    });

    await t.test('HTTP notes append once and leave the original unchanged',async()=>{
      const data={
        requestKey:'synthetic-http-note',
        note:'合成测试笔记：不是投资判断'
      };
      for(let i=0;i<2;i++)
        await json('/api/research-history/'+recordId+'/notes',{
          method:'POST',body:JSON.stringify(data)
        });
      beforeRestart=await json('/api/research-history/'+recordId);
      assert.deepEqual(beforeRestart.original,original);
      assert.equal(beforeRestart.events.filter(e=>e.kind==='note').length,1);
    });

    await t.test('entire website restart preserves session and history',async()=>{
      const oldPid=site.pid;
      await stop();await start(port,proxyPort);
      assert.notEqual(site.pid,oldPid);
      assert.equal((await json('/api/session')).authenticated,true);
      assert.deepEqual(await json('/api/research-history/'+recordId),beforeRestart);
      assert.equal((await json('/api/radar/journal')).items.length,1);
      assert.equal(
        (await json('/api/user-state')).state.theses[0].reason,
        'synthetic legacy fixture'
      );
    });

    await t.test('backup contains old and new rows without login secrets',async()=>{
      const response=await request('/api/admin/backup');
      assert.equal(response.status,200);
      assert.match(response.headers.get('content-disposition'),/attachment/);
      const text=await response.text(),backup=JSON.parse(text);
      fs.writeFileSync(artifacts+'synthetic-backup.json',text);
      assert.deepEqual(backup.unavailable,[]);
      const required=[
        'user_states','radar_journal','volume_screen_runs',
        'research_opportunities','research_events','research_episode_heads'
      ];
      for(const table of required)assert.ok(backup.tables[table].length,table);
      const snapshot=backup.tables.research_opportunities.find(r=>r.id===recordId);
      assert.equal(snapshot.snapshot_hash,snapshotHash(snapshot.snapshot));
      assert.deepEqual(snapshot.snapshot,beforeRestart.original);
      assert.equal(
        backup.tables.research_events.filter(e=>e.research_id===recordId).length,
        beforeRestart.events.length
      );
      assert.equal(backup.tables.user_sessions,undefined);
      assert.ok(!text.includes('password_hash'));
      assert.ok(!text.includes('token_hash'));
      assert.ok(!text.includes(password));
      assert.ok(!text.includes(cookie.split('=')[1]));
      assert.deepEqual(
        JSON.parse(fs.readFileSync(artifacts+'synthetic-backup.json','utf8')),
        backup
      );
    });

    const browserChecks=[];
    async function openPage(width,height,mode='observe'){
      const context=await browser.newContext({
        viewport:{width,height},timezoneId:'Asia/Shanghai'
      });
      await context.addCookies([{
        name:'allen_session',value:cookie.split('=')[1],
        url:base,httpOnly:true,secure:false,sameSite:'Lax'
      }]);
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',async route=>{
        const address=new URL(route.request().url());
        if(address.origin!==base)return route.abort();
        if(address.pathname==='/api/volume-screen/latest'&&mode!=='real'){
          const result={
            createdAt:'2026-10-12T08:00:00Z',strategy:SCREEN_STRATEGY,
            storage:{state:'saved',durable:true},items:[],
            counts:{qualified:null,observations:0},
            coverage:{
              requested:2,returned:2,failed:0,usable:2,
              coveragePct:100,partial:false,
              dateRange:['2026-10-12','2026-10-12']
            }
          };
          if(mode==='all-failed')Object.assign(result.coverage,{
            returned:0,failed:2,usable:0,coveragePct:0,partial:true,
            failures:[{symbol:'TEST',code:'timeout',message:'合成请求超时'}]
          });
          if(mode==='partial')Object.assign(result.coverage,{
            returned:1,failed:1,usable:1,coveragePct:50,partial:true,
            failures:[{symbol:'TEST',code:'timeout',message:'合成请求超时'}]
          });
          if(['observe','invalidated'].includes(mode)){
            result.items=[{
              ...seedCard,
              ...(mode==='invalidated'?{
                tone:'red',status:'原始结构已失效（合成状态）',
                reason:'合成界面状态，不是历史收益'
              }:{})
            }];
            result.counts.observations=1;
          }
          return route.fulfill({json:{result}});
        }
        return route.continue();
      });
      await page.goto(base,{waitUntil:'networkidle'});
      await page.evaluate(()=>{
        const label=document.createElement('div');
        label.id='synthetic-test-label';
        label.textContent='合成验收数据 · 非真实行情或模型成绩';
        label.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#ffe0a0;color:#18233a;text-align:center;font-size:12px;padding:4px';
        document.body.append(label);
      });
      return {context,page,errors};
    }

    async function navigate(page,id,group){
      if(await page.locator('#menuBtn').isVisible())
        await page.locator('#menuBtn').click();
      const button=page.locator('[data-page="'+id+'"]');
      if(!await button.isVisible())
        await page.locator('.nav-group > summary').filter({hasText:group}).click();
      await button.click();
    }

    if(process.env.TEST_BROWSER==='true'){
      await t.test('Chromium renders states at three viewport sizes',async()=>{
        const {chromium}=await import('playwright');
        browser=await chromium.launch({headless:true});
        for(const [width,height] of [[1194,834],[390,844],[1440,900]]){
          for(const mode of ['all-failed','partial','empty','observe','invalidated']){
            const {context,page,errors}=await openPage(width,height,mode);
            try{
              await page.locator('#shell').waitFor({state:'visible'});
              await navigate(page,'volumeScreen','AI 研究');
              const box=page.locator('#volumeScreenResult');
              if(mode==='all-failed'){
                await box.getByRole('heading',{
                  name:'无法完成判断',exact:true
                }).waitFor();
                assert.ok(!(await box.innerText()).includes('本次核验范围内未发现'));
                await box.locator('summary').filter({
                  hasText:'查看数据失败原因'
                }).click();
                await box.getByText(/合成请求超时/).waitFor();
              }
              if(mode==='partial'){
                await box.getByText(/其余范围未知/).waitFor();
                assert.match(await box.innerText(),/50\.0%/);
              }
              if(mode==='empty')
                await box.getByRole('heading',{
                  name:'本次核验范围内未发现符合结构观察条件的候选'
                }).waitFor();
              if(mode==='observe')
                await box.locator('.volume-screen-card.yellow').waitFor();
              if(mode==='invalidated')
                await box.locator('.volume-screen-card.red').waitFor();

              const dimensions=await page.evaluate(()=>({
                actual:document.documentElement.scrollWidth,
                viewport:innerWidth
              }));
              assert.ok(
                dimensions.actual<=dimensions.viewport+1,
                JSON.stringify({width,mode,...dimensions})
              );
              await page.screenshot({
                path:artifacts+width+'-'+mode+'.png',fullPage:true
              });
              assert.deepEqual(errors,[]);
              browserChecks.push({width,height,mode,passed:true});
            }finally{await context.close()}
          }
        }
      });

      await t.test('browser appends notes and displays save failure',async()=>{
        const {context,page,errors}=await openPage(1194,834);
        try{
          await navigate(page,'volumeScreen','AI 研究');
          await page.locator('.original-research > summary').click();
          await page.locator('[data-research-history]').click();
          await page.locator('.research-note textarea').fill('合成浏览器追加笔记');
          await page.locator('.research-note button').click();
          await page.locator('#modal').waitFor({state:'detached'});

          const after=await json('/api/research-history/'+recordId);
          assert.deepEqual(after.original,original);
          assert.ok(after.events.some(e=>e.payload.note==='合成浏览器追加笔记'));

          await page.locator('[data-research-history]').click();
          await page.locator('.research-note textarea').fill('这条合成笔记故意保存失败');
          await page.route('**/api/research-history/*/notes',route=>route.fulfill({
            status:503,json:{error:'合成存储故障，笔记未保存'}
          }));
          await page.locator('.research-note button').click();
          await page.getByText(
            '保存失败：合成存储故障，笔记未保存',{exact:true}
          ).waitFor();
          assert.equal(await page.locator('.research-note button').isEnabled(),true);
          const latest=await json('/api/research-history/'+recordId);
          assert.ok(!latest.events.some(
            e=>e.payload.note==='这条合成笔记故意保存失败'
          ));
          await page.screenshot({
            path:artifacts+'ipad-save-failed.png',fullPage:true
          });
          assert.deepEqual(errors,[]);
        }finally{await context.close()}
      });

      await t.test('new workbench uses real history, replay and append-only note endpoints',async()=>{
        const {context,page,errors}=await openPage(1194,834,'observe');
        try{
          await page.route('**/api/workbench/context',route=>route.fulfill({json:{
            verified:true,expectedThrough:'2026-10-12',calendarSource:'synthetic-test-only',riskBudget:null
          }}));
          await page.reload({waitUntil:'networkidle'});
          await page.locator('.wb-hero').waitFor();
          assert.match(await page.locator('#content').innerText(),/风险预算/);
          await page.locator('.wb-hero [data-wb-open]').click();
          await page.locator('.wb-archive-grid').waitFor();
          assert.ok(!(await page.locator('#content').innerText()).includes('合成测试笔记：不是投资判断'));
          await page.locator('[data-wb-marker="original"]').click();
          await page.locator('#wbEvidence').waitFor({state:'visible'});
          assert.match(await page.locator('#wbEvidence').innerText(),/缺少|不足|未留存/);
          await page.keyboard.press('Escape');
          await page.locator('#wbEvidence').waitFor({state:'detached'});
          await page.locator('[data-wb-time="later"]').click();
          await page.getByText('合成测试笔记：不是投资判断',{exact:true}).waitFor();
          await page.locator('#wbNote').fill('新研究档案的合成追加笔记');
          await page.locator('.wb-note button').click();
          await page.locator('.wb-note-status').filter({hasText:'笔记已追加'}).waitFor();
          const saved=await json('/api/research-history/'+recordId);
          assert.deepEqual(saved.original,original);
          assert.equal(saved.snapshotHash,snapshotHash(original));
          assert.equal(saved.snapshotVerified,true);
          assert.ok(saved.generatedAt);assert.ok(saved.strategyVersion);
          assert.ok(saved.events.some(event=>event.payload.note==='新研究档案的合成追加笔记'));
          await page.route('**/api/research-history/*/notes',route=>route.fulfill({
            status:503,json:{error:'合成故障，保存未成功'}
          }));
          await page.locator('#wbNote').fill('新界面中故意保存失败的合成笔记');
          await page.locator('.wb-note button').click();
          await page.locator('.wb-note-status').filter({hasText:'保存未确认'}).waitFor();
          assert.equal(await page.locator('.wb-note button').isEnabled(),true);
          const after=await json('/api/research-history/'+recordId);
          assert.ok(!after.events.some(event=>event.payload.note==='新界面中故意保存失败的合成笔记'));
          assert.deepEqual(errors,[]);
        }finally{await context.close()}
      });

      await t.test('home updates in one click, reuses its task across navigation and exposes failed coverage',async()=>{
        const {context,page,errors}=await openPage(1194,834,'observe');
        let posts=0,ready=false,partial=false,taskFail=false;
        const makeResult=()=>({
          id:'synthetic-home-update-'+posts,createdAt:new Date().toISOString(),
          strategy:SCREEN_STRATEGY,items:[],counts:{qualified:null,observations:0},
          storage:{durable:false,state:'unavailable'},
          coverage:{requested:2,returned:partial?1:0,failed:partial?1:2,usable:partial?1:0,
            coveragePct:partial?50:0,partial:true,dateRange:['2026-10-12','2026-10-12'],
            failures:[{symbol:'SYNTHETIC',code:'timeout',message:'合成：行情请求失败'}]}
        });
        try{
          await page.route('**/api/workbench/context',route=>route.fulfill({json:{
            verified:true,expectedThrough:'2026-10-12',calendarSource:'synthetic-only',riskBudget:null
          }}));
          await page.route('**/api/volume-screen',route=>{
            if(route.request().method()!=='POST')return route.continue();
            posts++;return route.fulfill({status:202,json:{jobId:'synthetic-home-job'}});
          });
          await page.route('**/api/volume-screen/jobs/synthetic-home-job',route=>route.fulfill({json:ready?
            (taskFail?{status:'failed',error:'合成扫描任务失败'}:{status:'done',result:makeResult()}):{status:'running',progress:{checked:1,total:2,failed:0}}}));
          await page.reload({waitUntil:'networkidle'});
          await page.locator('[data-wb-update]').waitFor();
          await page.evaluate(()=>{const button=document.querySelector('[data-wb-update]');button.click();button.click()});
          await page.locator('#wbUpdateStatus').filter({hasText:'已核验 1 / 2'}).waitFor();
          assert.equal(posts,1);
          await page.locator('.wb-hero [data-wb-open]').click();
          await page.locator('.wb-archive-grid').waitFor();
          await navigate(page,'dashboard','常用');
          await page.locator('#wbUpdateStatus').filter({hasText:'正在更新机会'}).waitFor();
          assert.equal(posts,1);
          ready=true;
          await page.locator('#wbUpdateStatus').filter({hasText:'无法完成判断'}).waitFor();
          await page.locator('.wb-data-strip .wb-state').filter({hasText:'无法完成判断'}).waitFor();
          assert.match(await page.locator('#content').innerText(),/本次结果未留档/);
          assert.ok(!(await page.locator('#content').innerText()).includes('已核验范围暂无结构观察'));
          const before=await json('/api/research-history/'+recordId);
          partial=true;
          await page.locator('[data-wb-update]').click();
          await page.locator('#wbUpdateStatus').filter({hasText:'本次扫描结束'}).waitFor();
          assert.equal(posts,2);
          assert.match(await page.locator('.wb-data-strip').innerText(),/50\.0%/);
          await page.locator('.wb-data-strip summary').click();
          assert.match(await page.locator('.wb-data-strip').innerText(),/合成：行情请求失败/);
          assert.deepEqual(await json('/api/research-history/'+recordId),before);
          taskFail=true;
          await navigate(page,'volumeScreen','AI 研究');
          await page.locator('#volumeScreenForm button').click();
          await page.locator('#volumeScreenResult').getByText(/更新未完成：合成扫描任务失败/).waitFor();
          assert.match(await page.locator('#volumeScreenResult').innerText(),/50\.0%/);
          assert.equal(posts,3);
          taskFail=false;
          await page.locator('#volumeScreenForm button').click();
          await page.locator('#volumeScreenResult').getByText(/本次扫描结束/).waitFor();
          assert.match(await page.locator('#volumeScreenResult').innerText(),/50\.0%/);
          assert.ok(!(await page.locator('#volumeScreenResult').innerText()).includes('正在整理本次记录'));
          assert.equal(posts,4);
          assert.deepEqual(errors,[]);
        }finally{await context.close()}
      });
      await t.test('historical comparison discloses reconstruction and scrolls within tablet phone desktop viewports',async()=>{
        for(const [width,height]of [[1194,834],[390,844],[1440,900]]){
          const {context,page,errors}=await openPage(width,height,'observe');
          try{
            await page.locator('#shell').waitFor({state:'visible'});
            await navigate(page,'validation','研究工具');
            const panel=page.locator('.wb-study');
            await panel.getByRole('heading',{name:'五交易日历史研究 · 收益优势未证明',exact:true}).waitFor();
            const text=await panel.innerText();
            assert.match(text,/2025年事后重建/);assert.match(text,/7108 \/ 7616/);
            assert.match(text,/严格当时价格口径未核验/);assert.match(text,/短期概率不启用/);
            assert.equal(await panel.locator('tbody tr').count(),5);
            assert.ok(await panel.locator('tbody').innerText().then(s=>s.includes('0.56%')));
            await panel.locator('summary').click();
            assert.match(await panel.innerText(),/量比至少1.5/);
            const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
            assert.ok(size.scroll<=size.width+2,JSON.stringify(size));
            await page.screenshot({path:artifacts+'historical-study-'+width+'x'+height+'.png',fullPage:true});
            assert.deepEqual(errors,[]);
          }finally{await context.close()}
        }
      });

      await t.test('standalone synthetic preview demonstrates all three pages and five data states',async()=>{
        const {buildWorkbenchPreview}=await import('../scripts/build-workbench-preview.mjs');
        const previewPath=root+'test-results/Allen-opportunity-preview.html';
        fs.mkdirSync(root+'test-results',{recursive:true});
        fs.writeFileSync(previewPath,buildWorkbenchPreview());
        for(const [width,height] of [[1194,834],[390,844],[1440,900]]){
          const context=await browser.newContext({viewport:{width,height},timezoneId:'Asia/Shanghai'});
          const page=await context.newPage(),errors=[],remote=[];
          page.on('pageerror',error=>errors.push(error.message));
          page.on('request',request=>{if(/^https?:/.test(request.url()))remote.push(request.url())});
          const capture=async name=>{
            const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
            assert.ok(dimensions.scroll<=dimensions.width+1,JSON.stringify({name,...dimensions}));
            await page.screenshot({path:artifacts+width+'-workbench-'+name+'.png',fullPage:true});
            if(width===1194){
              const buffer=await page.screenshot({type:'jpeg',quality:60,fullPage:false});
              console.log('WB_PREVIEW_IMAGE '+name+' '+buffer.toString('base64'));
            }
          };
          try{
            await page.goto('file://'+previewPath,{waitUntil:'networkidle'});
            await page.locator('.wb-hero').waitFor();
            await page.getByText('独立预览 · 全部为虚构演示数据',{exact:true}).waitFor();
            assert.match(await page.locator('.wb-data-strip').innerText(),/83\.3%/);
            await capture('home');
            await page.locator('[data-wb-open="DEMO-RESEARCH-A"]').first().click();
            await page.locator('.wb-archive-grid').waitFor();
            assert.ok(!(await page.locator('#content').innerText()).includes('演示：后来追加的复核笔记'));
            await page.locator('[data-wb-time="later"]').click();
            await page.getByText('演示：后来追加的复核笔记，不能出现在当时判断中。',{exact:true}).waitFor();
            await page.locator('[data-wb-marker="1"]').click();
            await page.locator('#wbEvidence').waitFor({state:'visible'});
            await page.locator('#wbEvidence').getByText('数据截止 2026-10-13',{exact:true}).waitFor();
            await page.keyboard.press('Escape');
            await page.locator('#wbEvidence').waitFor({state:'detached'});
            await capture('archive');
            await page.locator('.wb-page-heading [data-go="evolution"]').click();
            await page.locator('.wb-board').waitFor();
            await page.locator('.wb-opportunity.invalid').waitFor();
            await capture('evolution');
            for(const [scene,label] of [['empty','已核验范围暂无结构观察'],['insufficient','无法完成判断'],['failed','无法完成判断'],['invalid','发现结构观察']]){
              await page.locator('[data-preview-scene="'+scene+'"]').click();
              if(scene==='invalid'){
                await page.locator('.wb-risk-row').filter({hasText:'演示·失效样本B'}).waitFor();
                assert.ok(!(await page.locator('.wb-candidate-area').innerText()).includes('演示·观察样本A'));
              }else{
                await page.locator('.wb-data-strip .wb-state').filter({hasText:label}).waitFor();
                if(scene==='failed')assert.ok(!(await page.locator('#content').innerText()).includes('已核验范围暂无结构观察'));
              }
              await page.screenshot({path:artifacts+width+'-scene-'+scene+'.png',fullPage:true});
            }
            await page.locator('[data-preview-scene="observe"]').click();
            await page.locator('[data-wb-update]').click();
            await page.locator('#wbUpdateStatus').filter({hasText:'本次结果未留档'}).waitFor();
            assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
            browserChecks.push({width,height,mode:'new-workbench-replay-and-five-states',passed:true});
          }finally{await context.close()}
        }
      });
    }

    await t.test('database outage is explicit and recovery needs no site restart',async()=>{
      const expected=await json('/api/research-history/'+recordId);
      const oldPid=site.pid;
      block();
      try{
        for(const [path,options] of [
          ['/api/research-history',{}],
          ['/api/research-history/'+recordId+'/notes',{
            method:'POST',
            body:JSON.stringify({requestKey:'outage',note:'must not save'})
          }],
          ['/api/admin/backup',{}],
          ['/api/session',{}]
        ]){
          const response=await request(path,options),body=await response.json();
          assert.equal(response.status,503,JSON.stringify({path,body}));
          assert.ok(body.error);
          assert.equal(body.items,undefined);
          assert.equal(response.headers.get('content-disposition'),null);
        }
        if(browser){
          const {context,page}=await openPage(1194,834,'real');
          try{
            await page.locator('#loginError').filter({
              hasText:/暂不可核验|暂不可用/
            }).waitFor({state:'visible'});
            await page.screenshot({
              path:artifacts+'ipad-database-unavailable.png',fullPage:true
            });
          }finally{await context.close()}
        }
      }finally{blocked=false}

      for(let i=0;i<20;i++){
        try{
          assert.deepEqual(await json('/api/research-history/'+recordId),expected);
          assert.equal(site.pid,oldPid);
          return;
        }catch(error){
          if(i===19)throw error;
          await pause(200);
        }
      }
    });

    await t.test('missing tables and partial backups are clearly labelled',async()=>{
      await pool.query('ALTER TABLE research_events RENAME TO research_events_hidden');
      try{
        const response=await request('/api/research-history');
        const body=await response.json();
        assert.equal(response.status,503);
        assert.equal(body.storage.state,'unavailable');

        const partial=await json('/api/admin/backup');
        assert.ok(partial.unavailable.includes('research_events'));

        if(browser){
          const {context,page}=await openPage(1194,834,'real');
          try{
            await navigate(page,'volumeScreen','AI 研究');
            await page.locator('.original-research > summary').click();
            await page.locator('[data-research-history]').click();
            await page.getByText(/原始研究存储结构尚未准备/).waitFor();

            await navigate(page,'admin','管理与设置');
            const download=page.waitForEvent('download');
            await page.locator('[data-backup]').click();
            await (await download).saveAs(
              artifacts+'synthetic-partial-backup.json'
            );
            await page.getByText(/已下载部分备份/).waitFor();
            await page.screenshot({
              path:artifacts+'ipad-partial-backup.png',fullPage:true
            });
          }finally{await context.close()}
        }
      }finally{
        await pool.query('ALTER TABLE research_events_hidden RENAME TO research_events');
      }
      assert.deepEqual((await json('/api/admin/backup')).unavailable,[]);
      assert.deepEqual((await json('/api/research-history/'+recordId)).original,original);
    });

    fs.writeFileSync(artifacts+'acceptance-summary.json',JSON.stringify({
      syntheticData:true,
      timezone:process.env.TZ||'UTC',
      browserRequested:process.env.TEST_BROWSER==='true',
      browserChecks,
      sourceCommit:process.env.GITHUB_SHA,
      limits:[
        'No live-market reliability or strategy returns tested',
        'Backup JSON export checked; full disaster recovery not tested',
        'Chromium viewports are not real iPad Safari testing'
      ]
    },null,2));
  }finally{
    if(browser)await browser.close();
    await stop();block();
    if(proxy.listening)
      await new Promise(resolve=>proxy.close(resolve));
    if(pool)await pool.end();
    try{
      if(created)await admin.query('DROP SCHEMA '+schema+' CASCADE');
    }finally{await admin.end()}
  }
});
