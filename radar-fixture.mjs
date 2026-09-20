const realFetch=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
 const url=String(input);if(url.startsWith('http://127.0.0.1:'))return realFetch(input,options);
 let data={};
 if(url.includes('getHQNodeStockCount'))data='5000';
 else if(url.includes('getHQNodeData')){const page=Number(new URL(url).searchParams.get('page'));data=Array.from({length:100},(_,i)=>({code:String(600000+(page-1)*100+i),name:'测试公司',trade:20,changepercent:1,amount:100000000,mktcap:1000000}));}
 else if(url.includes('security/ann'))data={data:{list:[{art_code:'fixture',title:'关于签订重大合同的公告',notice_date:new Date().toISOString().slice(0,10)}]}};
 else if(url.includes('CompanySurvey'))data={jbzl:{agjc:'测试公司'}};
 return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
};
