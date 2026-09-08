const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const root=require('node:path').join(__dirname,'../Extension');

function providerAt(base,bodyStall=false){
 const events=[];
 const sandbox={module:{exports:{}},setTimeout,clearTimeout,console,
  AbortSignal:{timeout(ms){events.push({timeoutMs:ms});const c=new AbortController();setTimeout(()=>c.abort(new DOMException('timed out','TimeoutError')),15);return c.signal}},
  fetch(url,options){events.push({url,signal:!!options.signal});const stall=()=>new Promise((resolve,reject)=>options.signal?.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));return bodyStall ? Promise.resolve({ok:true,status:200,text:stall}) : stall()}
 };
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(base+'/core/provider-core.js','utf8'),sandbox);
 return {core:sandbox.module.exports,events};
}
test('model request aborts a connection that never returns',async()=>{
 const {core,events}=providerAt(root);
 await assert.rejects(core.completeText('test',{provider:'custom',customModel:'fixture',customApiBaseUrl:'https://example.invalid/v1'}),e=>e.code===core.PROVIDER_ERROR_CODES.TIMEOUT);
 assert.equal(events[0].timeoutMs,120000);assert.equal(events[1].signal,true);
});
async function generateAt(base){
 const progress=[];let observedTitle;
 const sandbox={study:{resolveLevel(){return {label:'A1'}},chunkCues(x){return [x]},buildStudyPrompt(c,p,o){observedTitle=o.title;return o.title},parseStudyJson(){return {}},mergeStudyResults(){return {vocabulary:[],patterns:[]}}},
  diagnostics:{diagnosticError:(m)=>new Error(m)},api:{storage:{local:{async get(){return {studyEpisode:{title:'New tab B',pairs:[{source:'B'}]}}}}},runtime:{async sendMessage(m){progress.push(m)}}},
  async getSettings(){return {}},async completeText(){return '{}'}};
 vm.createContext(sandbox);
 const text=fs.readFileSync(base+'/background.js','utf8');vm.runInContext(text.slice(text.indexOf('async function generateStudy(')),sandbox);
 await sandbox.generateStudy({kind:'beginner'},{title:'Existing tab A',pairs:[{source:'A'}]},'request-A');
 return {observedTitle,progress};
}
test('each study page retains its own video even when another page replaces storage',async()=>{
 const result=await generateAt(root);assert.equal(result.observedTitle,'Existing tab A');assert.ok(result.progress.every(p=>p.requestId==='request-A'));
});

test('deadline also covers a body that stalls after headers arrive',async()=>{
 const {core}=providerAt(root,true);
 await assert.rejects(core.completeText('test',{provider:'custom',customModel:'fixture',customApiBaseUrl:'https://example.invalid/v1'}),e=>e.code===core.PROVIDER_ERROR_CODES.TIMEOUT);
});
