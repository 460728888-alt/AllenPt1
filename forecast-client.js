const FORECAST_API_URL = String(process.env.FORECAST_API_URL || '').replace(/\/$/, '');
const FORECAST_API_TOKEN = String(process.env.FORECAST_API_TOKEN || '');
const TIMEOUT_MS = Math.max(5000, Number(process.env.FORECAST_TIMEOUT_MS || 45000));

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function forecastStatus() {
  return {
    configured:Boolean(FORECAST_API_URL),
    provider:FORECAST_API_URL ? 'Allen Chronos 服务' : null,
    message:FORECAST_API_URL ? '预训练时序模型接口已配置' : '尚未配置预训练时序模型接口，继续使用历史统计模型'
  };
}

export async function foundationForecast(rows = [], horizons = [5,20,60]) {
  if (!FORECAST_API_URL) return {available:false,reason:'not_configured',models:[],horizons:[]};
  const prices=rows.map(row=>finite(row?.close)).filter(value=>value>0).slice(-512);
  if(prices.length<100)return {available:false,reason:'insufficient_history',models:[],horizons:[]};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  try{
    const response=await fetch(`${FORECAST_API_URL}/forecast`,{
      method:'POST',signal:controller.signal,
      headers:{'Content-Type':'application/json',...(FORECAST_API_TOKEN?{'Authorization':`Bearer ${FORECAST_API_TOKEN}`}:{})},
      body:JSON.stringify({prices,horizons})
    });
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.detail||body.error||`模型服务返回 ${response.status}`);
    return {...body,available:true};
  }catch(error){
    return {available:false,reason:error.name==='AbortError'?'timeout':'service_error',error:error.message,models:[],horizons:[]};
  }finally{clearTimeout(timer)}
}

export function committeeDecision(rule, foundation) {
  const ruleProbability=finite(rule?.outperformProbability);
  const modelProbability=finite(foundation?.upProbability);
  const ruleView=ruleProbability===null?'unknown':ruleProbability>=54?'up':ruleProbability<=46?'down':'neutral';
  const modelView=modelProbability===null?'unknown':modelProbability>=55?'up':modelProbability<=45?'down':'neutral';
  let status='证据不足',tone='yellow',agreement=false;
  if(modelView==='unknown')status='预训练模型未连接';
  else if(ruleView==='up'&&modelView==='up'){status='双模型偏强共振';tone='green';agreement=true}
  else if(ruleView==='down'&&modelView==='down'){status='双模型风险共振';tone='red';agreement=true}
  else if(ruleView==='neutral'||modelView==='neutral')status='方向尚未确认';
  else {status='模型观点分歧';tone='orange'}
  return {status,tone,agreement,ruleView,modelView,ruleProbability,modelProbability,
    action:status==='双模型偏强共振'?'进入事件与价格确认阶段':status==='双模型风险共振'?'暂停新增关注并复核风险':'继续等待，不因单一模型行动'};
}
