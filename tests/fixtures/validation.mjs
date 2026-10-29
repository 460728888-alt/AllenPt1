// Fictional protocol, forecasts and prices. No real model/strategy results.
export function validationFixture(){
 const sessions=[];
 for(let day=1;sessions.length<65;day++){
  const date=new Date(Date.UTC(2026,0,day));
  if(![0,6].includes(date.getUTCDay()))sessions.push(date.toISOString().slice(0,10));
 }
 const protocol={id:'SYNTHETIC-5-SESSION-AUDIT',market:'CN_A',priceBasis:'raw_no_corporate_actions',horizonSessions:5,
  probabilityUnit:'percent',entryRule:'next_session_open',exitRule:'horizon_session_close',
  upTarget:'raw_price_return_positive',sameDayBarrierOrder:'unknown',benchmark:'SYNTHETIC-INDEX',tPlusOne:true,
  costs:{mode:'proportional_scenario_no_minimum_commission',buyBps:5,sellBps:10,buySlippageBps:5,sellSlippageBps:5},
  split:{trainEnd:sessions[14],validationEnd:sessions[39],testEnd:sessions[59],embargoSessions:1}};
 const bars=sessions.flatMap((date,i)=>['SYNTHETIC-A','SYNTHETIC-INDEX'].map(symbol=>{
  const open=symbol==='SYNTHETIC-A'?100+i*.2+Math.sin(i)*2:100+i*.1;
  return {symbol,date,open,close:open+.3,high:open+1,low:open-1,complete:true,corporateAction:false,
   suspended:false,canBuyOpen:true,canSellClose:true};
 }));
 const records=sessions.slice(0,59).map((date,i)=>{
  const forecast=(target,value)=>({target,value,probabilityUnit:'percent',horizonSessions:5,
   startRule:'next_session_open',endRule:'horizon_session_close',feeBasis:'gross_raw_price',
   modelVersion:'SYNTHETIC-NO-TRAINING',trainedThrough:sessions[0],validUntil:'2027-01-01T00:00:00Z',benchmark:'SYNTHETIC-INDEX'});
  return {id:'SYNTHETIC-'+i,symbol:'SYNTHETIC-A',dataThrough:date,featureThrough:date,
   featureAvailableAt:date+'T15:05:00+08:00',generatedAt:date+'T16:00:00+08:00',
   featureSnapshotHash:'synthetic-only-hash',strategyVersion:'synthetic-only-no-live-strategy',
   forecasts:{synthetic_A:{up:forecast('up',60),outperform:forecast('outperform',55)},
    synthetic_B:{up:forecast('up',45),outperform:forecast('outperform',50)}}};
 });
 return {dataKind:'synthetic',metadata:{source:'fictional formula, not exchange data',datasetVersion:'synthetic-1',universeBasis:'unknown'},protocol,sessions,bars,records};
}
