// Missing observations must never become zero or disappear from an observation window.
export const DATA_VERSION = 'daily-contract-1';
export function finiteNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function dataError(message, state = 'insufficient', code = 'missing_data') {
  return Object.assign(new Error(message), {state, code});
}
export function failureOf(error) {
  const timeout = ['AbortError','TimeoutError'].includes(error?.name) || /timeout|timed out/i.test(error?.message || '');
  return {state:error?.state || 'request_failed', code:timeout ? 'timeout' : error?.code || (error instanceof SyntaxError ? 'format_error' : 'service_error'),
    message:timeout ? '请求超时' : String(error?.message || '数据请求失败').slice(0,240)};
}
export function assertWindow(rows, count, {volume = true} = {}) {
  if (!Array.isArray(rows) || rows.length < count) throw dataError(`至少需要${count}根连续完整日线`, 'insufficient', 'history_short');
  const window = rows.slice(-count);
  for (const row of window) {
    if (row.complete === false || row.missingSession) throw dataError('观察窗口含未完成或缺失交易日');
    if (!['open','high','low','close'].every(key => finiteNumber(row[key]) > 0)) throw dataError('观察窗口存在缺失价格');
    if (row.high < Math.max(row.open,row.close,row.low) || row.low > Math.min(row.open,row.close,row.high)) throw dataError('日线价格关系异常', 'insufficient', 'invalid_ohlc');
    if (volume && !(finiteNumber(row.volume) > 0)) throw dataError(row.volume === 0 ? '成交量为零，停牌或交易状态待核验，暂停量能判断' : '成交量缺失，暂停量能判断', 'insufficient', row.volume === 0 ? 'zero_volume' : 'missing_volume');
  }
  return window;
}
export function chinaDate(now = new Date()) { return new Date(now.getTime()+8*3600000).toISOString().slice(0,10); }
export function calendarExpectation(calendar, now = new Date()) {
  const today = chinaDate(now);
  const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d;
  if (!calendar?.source || !Array.isArray(calendar.sessions) || !validDate(calendar.validFrom) || !validDate(calendar.validThrough) || calendar.validFrom > today || calendar.validThrough < today)
    return {verified:false, expected:null, reason:'缺少覆盖当前日期的已核验交易日历，不能确认数据新鲜度或完整性'};
  const sessions = calendar.sessions;
  if (sessions.some((d,i) => !validDate(d) || d < calendar.validFrom || d > calendar.validThrough || (i > 0 && d <= sessions[i-1])))
    return {verified:false,expected:null,reason:'交易日历格式异常'};
  const completed = sessions.filter(d => Date.parse(`${d}T15:05:00+08:00`) <= now.getTime());
  const sessionState = sessions.includes(today) ? (completed.includes(today) ? 'completed' : 'not_completed') : ([0,6].includes(new Date(today).getUTCDay()) ? 'weekend' : 'holiday');
  return {verified:!!completed.length,expected:completed.at(-1)||null,sessions:completed,source:calendar.source,version:calendar.version||null,validFrom:calendar.validFrom,validThrough:calendar.validThrough,sessionState,reason:completed.length?'':'交易日历没有已完成交易日'};
}
export function normalizeDailyChart(result, {symbol='', calendar=null, now=new Date(), minimum=60} = {}) {
  if (!result || !Array.isArray(result.timestamp) || !result.indicators?.quote?.[0]) throw dataError('行情响应格式异常','request_failed','format_error');
  const q=result.indicators.quote[0], adjusted=result.indicators.adjclose?.[0]?.adjclose;
  const cn=/\.(SS|SZ)$/.test(symbol), expectation=cn?calendarExpectation(calendar,now):{verified:false,reason:'当前市场的收盘时间与交易日历尚未核验'};
  const issues=[];
  let unfinished=0;
  const raw=[];
  for (let i=0;i<result.timestamp.length;i++) {
    const time=finiteNumber(result.timestamp[i]);
    if (!(time>0)) { issues.push('日线时间戳缺失'); continue; }
    const date=cn?chinaDate(new Date(time*1000)):new Date(time*1000).toISOString().slice(0,10);
    if (cn && Date.parse(`${date}T15:05:00+08:00`)>now.getTime()) {unfinished++;continue;}
    const close=finiteNumber(q.close?.[i]), adj=finiteNumber(adjusted?.[i]);
    raw.push({time,date,complete:true,open:finiteNumber(q.open?.[i]),high:finiteNumber(q.high?.[i]),low:finiteNumber(q.low?.[i]),close,volume:finiteNumber(q.volume?.[i]),adjustmentFactor:close>0&&adj>0?adj/close:null});
  }
  if (raw.some((r,i)=>i&&r.date<=raw[i-1].date)) issues.push('交易日重复或未按时间排列');
  const anchor=raw.at(-1),anchorFactor=anchor?.adjustmentFactor;
  let rows=raw.map(row=>{
    const factor=row.adjustmentFactor>0&&anchorFactor>0?row.adjustmentFactor/anchorFactor:null;
    return {...row,...Object.fromEntries(['open','high','low','close'].map(k=>[k,factor&&row[k]>0?row[k]*factor:null])),scaleFactor:factor};
  });
  if (!anchorFactor || raw.slice(-minimum).some(r=>!r.adjustmentFactor)) issues.push('复权因子缺失，不能统一到判断日原始价格尺度');
  const corporateActions=Object.entries(result.events||{}).flatMap(([type,events])=>Object.values(events||{}).map(event=>({type,date:Number.isFinite(Number(event.date))?chinaDate(new Date(Number(event.date)*1000)):null})));
  const splitDates=Object.values(result.events?.splits||{}).map(s=>chinaDate(new Date(Number(s.date)*1000)));
  if (splitDates.some(d=>d>=raw.at(-minimum)?.date&&d<=anchor?.date)) issues.push('观察窗口含拆合股，成交量口径尚未核验');
  if (expectation.verified && rows.length) {
    if(rows.some(r=>!expectation.sessions.includes(r.date)))issues.push('行情包含日历外的交易日期');
    const byDate=new Map(rows.map(r=>[r.date,r]));
    rows=expectation.sessions.filter(d=>d>=rows[0].date&&d<=anchor.date).map(date=>byDate.get(date)||{date,complete:true,missingSession:true,open:null,high:null,low:null,close:null,volume:null});
    if (expectation.validFrom>raw.at(-minimum)?.date) issues.push('交易日历未覆盖完整观察窗口');
  } else issues.push(expectation.reason);
  try { assertWindow(rows,minimum); } catch(error) { issues.push(error.message); }
  const stale=expectation.verified&&(!anchor||anchor.date<expectation.expected);
  if (stale) issues.unshift(`数据落后于应有已完成交易日 ${expectation.expected}；停牌或数据源延迟待核验`);
  const data={version:DATA_VERSION,state:stale?'stale':issues.length?'insufficient':'ok',reasons:[...new Set(issues)],dataThrough:anchor?.date||null,fetchedAt:now.toISOString(),expectedThrough:expectation.expected||null,
    corporateActions,historyStart:raw[0]?.date||null,unfinishedBars:unfinished,calendarSource:expectation.source||null,calendarVersion:expectation.version||null,calendarValidThrough:expectation.validThrough||null,sessionState:expectation.sessionState||'unknown',priceBasis:'judgment_day_raw',anchorFactor:anchorFactor||null,volumeBasis:splitDates.length?'source_volume_split_check':'source_volume'};
  return {rows,data};
}
export function scanCoverage(results, requested=results.length) {
  const returned=results.filter(r=>r.ok || r.error?.state!=='request_failed').length;
  const usable=results.filter(r=>r.ok && r.value?.data?.state==='ok').length;
  const failures=results.filter(r=>!r.ok).map(r=>({symbol:r.item?.symbol||null,...r.error}));
  const failed=results.filter(r=>!r.ok&&r.error?.state==='request_failed').length;
  const reasons={};for (const f of failures) reasons[f.code]=(reasons[f.code]||0)+1;
  const dates=results.filter(r=>r.ok).map(r=>r.value?.data?.dataThrough).filter(Boolean).sort();
  return {requested,checked:results.length,returned,failed,usable,insufficient:returned-usable,coveragePct:requested?usable/requested*100:0,
    partial:usable<requested,state:usable===0?'unable_to_judge':usable<requested?'partial':'ok',reasons,failures,dateRange:dates.length?[dates[0],dates.at(-1)]:null};
}

export function originalScaleComparable(original,current) {
  if(!original?.dataThrough||!current?.dataThrough)return false;
  if(current.data?.historyStart&&original.dataThrough<current.data.historyStart)return false;
  return !(current.data?.corporateActions||[]).some(e=>e.date>original.dataThrough&&e.date<=current.dataThrough);
}
