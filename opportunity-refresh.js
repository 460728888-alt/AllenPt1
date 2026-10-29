/* Shared browser/Node state machine. Starts only after an explicit user action. */
(function(root){
 'use strict';
 class OpportunityRefresh {
  constructor({start,read,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onChange=()=>{},onDone=()=>{},maxPolls=800}){
   Object.assign(this,{start,read,sleep,onChange,onDone,maxPolls});this.epoch=0;this.pending=null;
   this.state={phase:'idle',jobId:null,progress:null,result:null,error:null};
  }
  busy(){return ['starting','running'].includes(this.state.phase)}
  emit(patch){this.state={...this.state,...patch};this.onChange(this.state)}
  cancel(){this.epoch++;this.pending=null;this.state={phase:'idle',jobId:null,progress:null,result:null,error:null}}
  run(){
   if(this.pending)return this.pending;
   const token=++this.epoch,priorId=this.state.phase==='error'?this.state.jobId:null;
   this.emit({phase:priorId?'running':'starting',jobId:priorId,error:null,result:null,progress:null});
   this.pending=this.execute(token,priorId).finally(()=>{if(this.epoch===token)this.pending=null});
   return this.pending;
  }
  async execute(token,priorId){
   let id=priorId,failures=0;
   try{
    if(!id){
     const started=await this.start();if(token!==this.epoch)return {cancelled:true};
     if(typeof started?.jobId!=='string'||!started.jobId.trim())throw Error('服务未返回任务编号，更新未完成');
     id=started.jobId;this.emit({phase:'running',jobId:id});
    }
    for(let i=0;i<this.maxPolls;i++){
     await this.sleep(1500);if(token!==this.epoch)return {cancelled:true};
     let job;
     try{job=await this.read(id)}
     catch(error){
      if(token!==this.epoch)return {cancelled:true};
      if(error.status===404){id=null;throw Error('任务已不存在，可能因服务重启中断；再次点击可重新更新')}
      if(++failures<3){this.emit({error:'进度暂时无法读取，正在重试同一任务：'+error.message});continue}
      throw Error('进度读取失败；任务可能仍在运行，点击继续读取：'+error.message);
     }
     if(token!==this.epoch)return {cancelled:true};failures=0;
     if(job?.status==='running'){this.emit({phase:'running',error:null,progress:job.progress||null});continue}
     if(job?.status==='failed'){id=null;throw Error(job.error||'更新未完成，不能判断有没有机会')}
     if(job?.status!=='done')throw Error('任务状态未核验，更新未完成');
     const result=job.result;
     if(!result||!result.coverage||!Number.isFinite(result.coverage.usable)||!Array.isArray(result.items))
       throw Error('结果或覆盖范围缺失，无法完成判断');
     this.emit({phase:'done',jobId:null,result,error:null,progress:job.progress||null});
     try{await this.onDone(result)}catch(error){if(token===this.epoch)this.emit({error:'扫描已结束，但页面更新失败，请刷新记录：'+error.message})}
     return result;
    }
    throw Error('等待进度超时；任务可能仍在运行，点击继续读取');
   }catch(error){
    if(token!==this.epoch)return {cancelled:true};
    this.emit({phase:'error',jobId:id,error:error.message||'更新未完成'});
    return {error:this.state.error};
   }
  }
 }
 root.AllenOpportunityRefresh=OpportunityRefresh;
})(globalThis);
