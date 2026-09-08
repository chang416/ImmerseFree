const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const root=require('node:path').join(__dirname,'../Extension');
function core(file,base=root){const context=vm.createContext({console,URL});vm.runInContext(fs.readFileSync(base+'/'+file,'utf8'),context);return context;}
test('YouTube auto selection retains original default audio track',()=>{
 const c=core('core/youtube-subtitle-core.js').ImmerseFreeYouTubeSubtitles;
 const response={captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'ar'},{languageCode:'en'}],audioTracks:[{defaultCaptionTrackIndex:1}],defaultAudioTrackIndex:0}}};
 assert.equal(c.pickCaptionTrack(c.extractCaptionTracks(response)).languageCode,'en');
 assert.equal(c.pickCaptionTrack(c.extractCaptionTracks(response),'zh-Hant',{fallback:false}),undefined);
});
test('JSON3 overlapping cue ends stop at the next caption',()=>{
 const input={events:[{tStartMs:3000,dDurationMs:3000,segs:[{utf8:'second'}]},{tStartMs:1000,dDurationMs:5000,segs:[{utf8:'first'}]}]};
 const c=core('core/youtube-subtitle-core.js').ImmerseFreeYouTubeSubtitles;
 const cues=c.parseJson3Transcript(input);assert.equal(cues[0].text,'first');assert.equal(cues[0].endMs,3000);
});
test('study pairing preserves both translated segments and rejects boundary-only matches',()=>{
 const c=core('core/subtitle-format-core.js').ImmerseFreeSubtitleFormat;
 const pairs=c.pairByOverlap([{start:0,end:5,text:'A whole sentence'}],[{start:0,end:2,text:'前半句'},{start:2,end:5,text:'後半句'},{start:5,end:7,text:'下一句'}]);
 assert.equal(pairs[0].translation,'前半句 後半句');
 assert.equal(c.pairByOverlap([{start:0,end:1,text:'source'}],[])[0].source,'source');
});
test('page bridge selects current player after YouTube navigation',()=>{
 const payload=(id)=>({videoDetails:{videoId:id},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v='+id,languageCode:'en'}]}}});
 let listener,result;const context={location:{origin:'https://www.youtube.com'},document:{querySelector(){return {getPlayerResponse:()=>payload('current')}}},ytInitialPlayerResponse:payload('old'),addEventListener(type,fn){listener=fn},postMessage(msg){result=msg}};
 context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(root+'/content/youtube-page-bridge.js','utf8'),context);
 vm.runInContext('window.fire = () => {}',context);
 // event.source must have the same realm identity as window.
 context.invoke=(source)=>listener({source,data:{type:'IMMERSEFREE_REQUEST_YOUTUBE_CAPTION_TRACKS',videoId:'current',requestId:'x'}});
 vm.runInContext('invoke(window)',context);
 assert.ok(result.tracks[0].baseUrl.endsWith('current'));
});
test('repeated short captions cannot shift the streaming timeline',()=>{
 const text=fs.readFileSync(root+'/content/dual-subtitle.js','utf8');
 const segment=text.slice(text.indexOf('  function normalizeForMatch'),text.indexOf('  function render()'));
 const context=vm.createContext({});vm.runInContext(segment,context);
 assert.equal(context.offsetForCaption([{start:10,text:'Yeah'},{start:100,text:'Yeah'}],'Yeah',95,0),0);
 assert.equal(context.offsetForCaption([{start:100,text:'A sufficiently long sentence'}],'A sufficiently long sentence',99,0),1);
 assert.equal(context.offsetForCaption([{start:1000,text:'A sufficiently long sentence'}],'A sufficiently long sentence',99,0),0);
});
test('DASH omitted segment start stays implicit instead of restarting at zero',()=>{
 const text=fs.readFileSync(root+'/core/manifest-core.js','utf8');const start=text.indexOf('  function readDashSegmentTimeline');const end=text.indexOf('\n  // Netflix',start);
 const context=vm.createContext({});vm.runInContext(text.slice(start,end),context);
 const entry=(attrs)=>({localName:'S',hasAttribute:k=>k in attrs,getAttribute:k=>attrs[k]??null});
 const result=context.readDashSegmentTimeline({getElementsByTagName:()=>[{localName:'SegmentTimeline',getElementsByTagName:()=>[entry({t:'12000',d:'3000'}),entry({d:'3000'})]}]});
 assert.equal(result[0].t,12000);assert.equal(result[1].t,undefined);
});

test('YouTube study works without a translated caption track',async()=>{
 const code=fs.readFileSync(root+'/content/subtitle-translator.js','utf8');
 const first=code.indexOf('  async function collectYouTubeStudyPairs');const last=code.indexOf('  function ensureYouTubePageBridge',first);
 const c=core('core/youtube-subtitle-core.js');vm.runInContext(fs.readFileSync(root+'/core/subtitle-format-core.js','utf8'),c);
 Object.assign(c,{isYouTube:()=>true,document:{querySelector:()=>({duration:100})},currentYouTubeVideoKey:()=> 'video',youtube:c.ImmerseFreeYouTubeSubtitles,format:c.ImmerseFreeSubtitleFormat,YOUTUBE_ACQUISITION_DEADLINE_MS:30000,withDeadline:fn=>fn(),resolveYouTubeCaptionTracks:async()=>({tracks:[{languageCode:'en',baseUrl:'https://www.youtube.com/api/timedtext?v=video'}],pageSource:''}),fetchYouTubeCues:async()=>[{startMs:0,endMs:2000,text:'A source-only lesson'}],youtubeAcquisitionFailure:''});
 vm.runInContext(code.slice(first,last),c);
 const result=await c.collectYouTubeStudyPairs({studySourceLanguage:'en',dualSubtitleLanguage:'zh-Hant'});
 assert.equal(result.pairs[0].source,'A source-only lesson');assert.equal(result.pairs[0].translation,'');assert.equal(result.helpLanguage,'');
});
