// All values are fictional UI fixtures. Never import this file in the server.
export function demoData(){
  const levels={state:'ok',version:'range20-1',entry:12.04,breakout:12.04,stop:9.97,target1:14,target2:16,rr1:1.96/2.07,rr2:3.96/2.07};
  const original={
    symbol:'DEMO-A.SS',code:'DEMO-A',name:'演示·观察样本A',price:11.5,
    dataThrough:'2026-10-12',generatedAt:'2026-10-12T08:00:00Z',
    data:{state:'ok',dataThrough:'2026-10-12',historyStart:'2026-01-01'},
    levels,strategy:{version:'range20-t1-review-1',qualified:null,t2Enabled:false},
    profile:{usefulPullback:true,pullbackPct:-12.4,volumeDriedUp:true,volumeDryRatio:.68,
      priceTight:true,lowsStoppedFalling:true},
    structure:{levels,evidence:{compression:true,lowsRising:true},range:{widthPct:8.1},
      volume:{ratio:.76,recentRatio:.68}},evidence:{source:'synthetic-demo-only'}
  };
  const current={...original,price:11.9,dataThrough:'2026-10-14',data:{...original.data,dataThrough:'2026-10-14'}};
  const second={...original,symbol:'DEMO-B.SS',code:'DEMO-B',name:'演示·失效样本B'};
  const failed={...second,price:9.8,dataThrough:'2026-10-14',data:{...original.data,dataThrough:'2026-10-14'}};
  const paused={...original,symbol:'DEMO-C.SS',code:'DEMO-C',name:'演示·缺量样本C'};
  const gap={...paused,price:null,dataThrough:'2026-10-14',data:{state:'insufficient',dataThrough:'2026-10-14',reasons:['演示：成交量缺失']}};
  const fourth={...original,symbol:'DEMO-D.SS',code:'DEMO-D',name:'演示·触发样本D'};
  const trigger={...fourth,price:12.1,dataThrough:'2026-10-14',data:{...original.data,dataThrough:'2026-10-14'},structure:{...original.structure,volume:{ratio:1.6}}};
  const event=(id,kind,date,snapshot,status,note)=>({id,kind,data_through:date,occurred_at:date+'T08:00:00Z',payload:{snapshot,status,...(note?{note}:{})}});
  const records=[
    {researchId:'DEMO-RESEARCH-A',original,events:[
      event('A1','created','2026-10-12',original,'tracking'),
      event('A2','refreshed','2026-10-13',{...current,price:11.7,dataThrough:'2026-10-13'},'tracking'),
      event('A3','refreshed','2026-10-14',current,'tracking'),
      event('A4','note','2026-10-14',current,'review','演示：后来追加的复核笔记，不能出现在当时判断中。')
    ]},
    {researchId:'DEMO-RESEARCH-B',original:second,events:[
      event('B1','created','2026-10-12',second,'tracking'),
      event('B2','invalidated','2026-10-14',failed,'invalidated','演示：收盘触及原始失效价。')
    ]},
    {researchId:'DEMO-RESEARCH-C',original:paused,events:[
      event('C1','created','2026-10-12',paused,'tracking'),
      event('C2','data_gap','2026-10-14',gap,'tracking')
    ]}
  ];
  records.push({researchId:'DEMO-RESEARCH-D',original:fourth,events:[event('D1','created','2026-10-12',fourth,'tracking'),event('D2','refreshed','2026-10-14',trigger,'tracking')]});
  const history=records.map(record=>{
    const last=record.events.at(-1);
    return {researchId:record.researchId,original:record.original,symbol:record.original.symbol,
      name:record.original.name,latest:last.payload,latestKind:last.kind,status:last.payload.status,
      channel:'volume',strategyVersion:'range20-t1-review-1',firstSeenAt:'2026-10-12T08:00:00Z'};
  });
  const scan={
    id:'DEMO-SCAN',createdAt:'2026-10-14T08:00:00Z',storage:{durable:true,state:'saved'},
    strategy:{version:'range20-t1-review-1',qualified:null,t2Enabled:false},
    items:[{...current,researchId:'DEMO-RESEARCH-A',researchStatus:'tracking',original,tone:'yellow'},{...trigger,researchId:'DEMO-RESEARCH-D',researchStatus:'tracking',original:fourth,tone:'yellow'}],
    counts:{qualified:null,observations:2},coverage:{
      requested:12,returned:11,failed:1,usable:10,coveragePct:10/12*100,partial:true,
      dateRange:['2026-10-14','2026-10-14'],
      failures:[{symbol:'DEMO-X',code:'timeout',message:'演示：数据请求超时'}]
    }
  };
  return {records,history,scan,context:{verified:true,expectedThrough:'2026-10-14',calendarSource:'演示日历，不是真实当前行情',riskBudget:null},
    model:{active:false,version:'DEMO-NO-MODEL',message:'演示预览不加载预测模型，不展示真实模型成绩。'},
    reports:[{createdAt:'2026-10-14T08:00:00Z',window:{start:'2026-10-14',end:'2026-10-21'},
      candidates:[{symbol:'DEMO-E.SS',name:'演示·事件线索E',rationale:'虚构公告计划，仅用于展示事件渠道；尚无价格确认。'}]}]};
}
