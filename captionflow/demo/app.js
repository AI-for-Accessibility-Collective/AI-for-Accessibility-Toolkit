const byId = (id) => document.getElementById(id);
const els = Object.fromEntries(['video','video-file','caption-file','caption','caption-wrap','language','mode','pace','size','undo','contrast','replay','next','transcript','message','time-status'].map(id=>[id,byId(id)]));
let cues = [];
let currentCueId = null;
let lastManualPausedId = null;
let objectUrl = null;
let usingExternalFile = false;
const timeLabel = t => `${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const message = text => { els.message.textContent = text; };
const activeCue = time => cues.find(c => time >= c.start && time < c.end) ?? null;

function validateCues(payload) {
  if (!payload || !Array.isArray(payload.captions) || !payload.captions.length) throw new Error('Expected an object with a nonempty captions array');
  let lastStart = -1;
  const ids = new Set();
  return payload.captions.map((c,i)=>{
    if (!c || typeof c.id!=='string' || ids.has(c.id) ||
        !Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start||c.start<lastStart||
        typeof c.originalText!=='string'||!c.originalText.trim()||typeof c.displayText!=='string'||!c.displayText.trim()) {
      throw new Error(`Invalid caption at index ${i}`);
    }
    ids.add(c.id);lastStart=c.start;
    return { ...c };
  });
}
function renderTranscript() {
  els.transcript.replaceChildren();
  for (const cue of cues) {
    const li=document.createElement('li');li.dataset.id=cue.id;
    const button=document.createElement('button');button.type='button';
    const timestamp=document.createElement('span');timestamp.className='time';timestamp.textContent=timeLabel(cue.start);
    const text=document.createElement('span');text.textContent=cue.displayText;
    button.append(timestamp,' ',text);
    if (cue.status && cue.status !== 'ready') {
      const flag=document.createElement('span');flag.className='flag';flag.textContent=cue.status==='needs-review'?' Unreviewed wording':' Original fallback';button.append(' ',flag);
    }
    button.addEventListener('click',()=>{els.video.currentTime=cue.start;sync();els.video.focus();});
    li.append(button);els.transcript.append(li);
  }
}
function sync() {
  const cue=activeCue(els.video.currentTime||0);
  els.caption.textContent=cue?.displayText ?? ' ';
  if (cue?.id!==currentCueId) {
    currentCueId=cue?.id??null;
    for(const li of els.transcript.children) li.classList.toggle('active',li.dataset.id===currentCueId);
  }
  els['time-status'].textContent=`Playback position: ${timeLabel(els.video.currentTime||0)}${cue?' · Caption '+cue.id:''}`;
  if (cue && els.pace.value==='manual' && !els.video.paused && cue.id!==lastManualPausedId && els.video.currentTime>=cue.start+.06) {
    lastManualPausedId=cue.id;
    els.video.pause();message('Paused at the new caption. Read it, then press Play to continue.');
  }
}
async function loadDemoCues() {
  if (usingExternalFile) return;
  const params=new URLSearchParams({lang:els.language.value,mode:els.mode.value});
  const res=await fetch(`/api/captions?${params}`);const data=await res.json();
  if(!res.ok)throw new Error(data.error??'Caption load failed');
  cues=validateCues(data);renderTranscript();sync();
  message(`${cues.length} illustrative caption segments loaded. ${data.warnings.length} require review. No ASR was run.`);
}
function applyScale(value) {els['caption-wrap'].style.setProperty('--caption-scale',String(value));els.size.value=String(value);}
function applyPace() {els.video.playbackRate=els.pace.value==='slow'?.75:1;lastManualPausedId=null;sync();}

els['video-file'].addEventListener('change',()=>{
  if(objectUrl)URL.revokeObjectURL(objectUrl);
  const file=els['video-file'].files?.[0];
  if(!file){els.video.removeAttribute('src');els.video.load();return;}
  objectUrl=URL.createObjectURL(file);els.video.src=objectUrl;els.video.load();
  message('Local video loaded. Check that your caption data corresponds to this video before evaluating synchronization.');
});
els['caption-file'].addEventListener('change',async()=>{
  const file=els['caption-file'].files?.[0];
  if(!file)return;
  try {const payload=JSON.parse(await file.text());const parsed=validateCues(payload);cues=parsed;usingExternalFile=true;renderTranscript();sync();message(`Loaded ${parsed.length} captions from local JSON. Language/mode controls now affect only the bundled demo; to return to it, reload this page.`);}
  catch(err){message(`Couldn't load JSON: ${err.message}`);}
});
for(const name of ['language','mode']) els[name].addEventListener('change',()=>{
  if(usingExternalFile){message('Using uploaded captions. Reload the page to use the demo language/mode settings.');return;}
  loadDemoCues().catch(err=>message(err.message));
});
els.pace.addEventListener('change',applyPace);
els.size.addEventListener('change',async()=>{
  try {const res=await fetch('/api/font-scale',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:Number(els.size.value)})});const data=await res.json();if(!res.ok)throw new Error(data.error);applyScale(data.fontScale);message('Caption text size saved to the local toolkit profile.');}
  catch(err){message(`Couldn't save text size: ${err.message}`);}
});
els.undo.addEventListener('click',async()=>{
  try {const res=await fetch('/api/undo-font-scale',{method:'POST'});const data=await res.json();if(!res.ok)throw new Error(data.error);applyScale(data.preferences.fontScale);message(data.undone?'Previous text size restored.':'There is no earlier text-size change to undo.');}
  catch(err){message(`Undo failed: ${err.message}`);}
});
els.contrast.addEventListener('change',()=>els['caption-wrap'].classList.toggle('low',!els.contrast.checked));
els.replay.addEventListener('click',()=>{const cue=activeCue(els.video.currentTime)||cues.find(c=>c.start<=els.video.currentTime&&c.end>els.video.currentTime-1);if(!cue)return;els.video.currentTime=cue.start;sync();});
els.next.addEventListener('click',()=>{const cue=cues.find(c=>c.start>els.video.currentTime+.05);if(!cue)return;els.video.currentTime=cue.start;sync();});
els.video.addEventListener('timeupdate',sync);els.video.addEventListener('seeked',()=>{lastManualPausedId=null;sync();});els.video.addEventListener('loadedmetadata',sync);
window.addEventListener('beforeunload',()=>{if(objectUrl)URL.revokeObjectURL(objectUrl)});
try {const res=await fetch('/api/preferences');const prefs=await res.json();if(!res.ok)throw new Error(prefs.error);applyScale(prefs.fontScale);await loadDemoCues();applyPace();}
catch(err){message(`Setup error: ${err.message}`);}
