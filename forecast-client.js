import {finiteNumber as finite,assertWindow} from './data-contract.js';
import {guardForecast,probabilityEligibility,sameProbabilityTarget} from './probability-contract.js';
const FORECAST_API_URL = String(process.env.FORECAST_API_URL || '').replace(/\/$/, '');
const FORECAST_API_TOKEN = String(process.env.FORECAST_API_TOKEN || '');
const TIMEOUT_MS = Math.max(5000, Number(process.env.FORECAST_TIMEOUT_MS || 45000));

export function forecastStatus() {
  return {
    configured:Boolean(FORECAST_API_URL),
    provider:FORECAST_API_URL ? 'Allen Chronos 服务' : null,
    message:FORECAST_API_URL ? '预训练时序模型接口已配置' : '尚未配置预训练时序模型接口，继续使用历史统计模型'
  };
}

export async function foundationForecast(rows = [], horizons = [5,20,60]) {
  if (!FORECAST_API_URL) return {available:false,reason:'not_configured',models:[],horizons:[]};
  try{assertWindow(rows,Math.min(512,Math.max(100,rows.length)))}catch(error){return {available:false,reason:'insufficient_history',error:error.message,models:[],horizons:[]}}
  const prices=rows.slice(-512).map(row=>finite(row?.close));
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
    if(!Array.isArray(body.horizons))throw new Error('模型响应格式异常：缺少周期结果');
    return {...body,available:true,horizons:(Array.isArray(body.horizons)?body.horizons:[]).map(guardForecast)};
  }catch(error){
    return {available:false,reason:error.name==='AbortError'?'timeout':'service_error',error:error.message,models:[],horizons:[]};
  }finally{clearTimeout(timer)}
}

export function committeeDecision(rule, foundation) {
  const a=probabilityEligibility(rule?.outperformProbability,rule?.probabilityContracts?.outperformProbability);
  const b=probabilityEligibility(foundation?.upProbability,foundation?.probabilityContracts?.upProbability);
  const same=sameProbabilityTarget(rule?.probabilityContracts?.outperformProbability,foundation?.probabilityContracts?.upProbability);
  return {status:!foundation?'预训练模型未连接':!a.eligible||!b.eligible?'概率未经验证':!same?'预测目标不同，不判共振':'同目标证据待独立性核验',tone:'yellow',agreement:false,
    ruleView:'unknown',modelView:'unknown',ruleProbability:a.value,modelProbability:b.value,
    action:'概率行动判断未启用，继续核验独立证据'};
}
