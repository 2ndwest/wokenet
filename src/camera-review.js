/* Shared Pi/wokenet viewer. Memory caches only; no credentials in URLs or storage. */
export function mountReview(root, apiFetch) {
  root.classList.add('kc');
  root.innerHTML = '<header><h1>Kitchen cameras</h1></header>\
    <div class="devices" role="group" aria-label="Cameras"></div><select class="camera" hidden aria-label="Camera"></select>\
    <p class="notice" role="status" hidden></p>\
    <section class="viewer" aria-label="Camera viewer"><div class="screen" role="button" tabindex="0" aria-label="Toggle video playback"><img alt="Selected kitchen camera frame" hidden><p class="empty">Connecting…</p><div class="overlay"><span class="mode">LIVE</span><span class="frame-age" hidden></span></div><span class="pause-mark" aria-hidden="true" hidden>▶</span></div>\
    <div class="timeline-wrap"><canvas class="timeline" height="24" aria-hidden="true"></canvas><input class="scrub" type="range" min="0" max="1" value="0" step="1" aria-label="Recording timeline" title="Drag to review recordings" disabled></div><div class="timeline-labels"><span class="range-start"></span><span class="range-end"></span></div>\
    <div class="transport"><div class="transport-buttons"><button class="back" aria-label="Back 10 seconds" title="Back 10 seconds (J)">−10s</button><button class="play" aria-label="Pause live view" title="Play or pause (space)">Ⅱ</button><button class="forward" aria-label="Forward 10 seconds" title="Forward 10 seconds (K)">+10s</button></div><p class="time"></p><button class="live" title="Return to live (L)">Live</button><select class="speed" aria-label="Playback speed" title="Playback speed" hidden><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option><option value="timelapse">Time-lapse</option></select><button class="fullscreen" aria-label="Full screen" title="Full screen">⛶</button></div></section>\
    <div class="history-bar"><label>History <select class="period" aria-label="History range"><option value="15">Last 15 minutes</option><option value="60">Last hour</option><option value="360">Last 6 hours</option><option value="1440">Last 24 hours</option><option value="latest">Latest recording</option><option value="custom">Choose time…</option></select></label></div>\
    <section class="custom-range controls" aria-label="Choose recording interval" hidden><label>From<input class="from" type="datetime-local"></label><label>To<input class="to" type="datetime-local"></label><button class="load">Show recordings</button></section>\
    <details class="health"><summary>Camera info</summary><div class="detail-content"><div class="extra-controls"><span>Frame</span><button class="previous" aria-label="Previous frame" title="Previous frame (left arrow)">❮</button><button class="next" aria-label="Next frame" title="Next frame (right arrow)">❯</button><label class="skip-label"><input class="skip" type="checkbox" checked>Skip long gaps</label><button class="timelapse" title="Play captured frames at 6 frames per second">Time-lapse</button></div><p class="details"></p><p class="metrics"></p></div></details>';
  const $ = s => root.querySelector(s), now = () => performance.now();
  const dateInput = t => {const d=new Date(t);return new Date(t-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
  const dateLabel = t => new Date(t).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const rangeLabel=t=>new Date(t).toLocaleString([],{...(rangeEnd-rangeStart>21600000?{month:'short',day:'numeric'}:{}),hour:'numeric',minute:'2-digit'});
  let disposed=false, live=true, pausedLive=false, playing=false, rows=[], position=0, selected='', lastLive='', lastStamp=0;
  let indexGeneration=0, displayGeneration=0, cacheEpoch=0, loading=false, playbackBusy=false, playDeadline=0;
  let liveURL=null, liveBusy=false, liveRetry=0, statusBusy=false, indexBusy=false, lastIndex=0, rangeStart=0, rangeEnd=0, scrubTimer;
  let displayedKey='', cacheBytes=0, serverOffset=0, recorderPaused=false, liveFallback=false, fallbackRetry=0;
  const pending=new Map(), cache=new Map(), inFlight=new Map();
  const cameraName=id=>/^kitchen-(\d+)$/.test(id)?'Camera '+id.split('-')[1]:id;
  const message=(s='')=>{if(!disposed){const notice=$('.notice');notice.textContent=s;notice.hidden=!s;}};
  function abortGroup(group) {for(const [controller,tag] of pending)if(tag===group)controller.abort();}
  async function fetchBounded(path, group='metadata') {
    const controller=new AbortController();pending.set(controller,group);let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Recorder connection timed out. Retrying automatically.'));},group==='live'?25000:20000);});
    try {
      const response=await Promise.race([apiFetch(path,{signal:controller.signal}),timeout]);
      const body=await Promise.race([response.arrayBuffer(),timeout]);
      return new Response(body.byteLength?body:null,{status:response.status,statusText:response.statusText,headers:response.headers});
    } finally {clearTimeout(timer);pending.delete(controller);}
  }
  function denied(r) {return r.status===401||r.status===403;}
  function revokeView() {
    playing=false;live=false;pausedLive=false;displayGeneration++;abortGroup('live');clearCache();
    if(liveURL)URL.revokeObjectURL(liveURL);liveURL=null;
    $('.screen img').hidden=true;$('.screen img').removeAttribute('src');$('.empty').hidden=false;
    $('.empty').textContent='Access denied. Sign in again or contact the steward.';$('.screen').setAttribute('aria-busy','false');updateMode();
  }
  async function json(path) {const r=await fetchBounded(path);if(!r.ok){if(denied(r))revokeView();throw Error(denied(r)?'Access denied. Sign in again or contact the steward.':'Recorder unavailable ('+r.status+'). Retrying.');}return r.json();}
  function clearCache() {
    cacheEpoch++;abortGroup('replay');inFlight.clear();
    for(const v of cache.values())URL.revokeObjectURL(v.url);
    cache.clear();cacheBytes=0;displayedKey='';
  }
  function trimCache() {
    for(const [key,v] of cache) {
      if(cache.size<=24&&cacheBytes<=4*1024*1024)break;
      if(key===displayedKey)continue;
      URL.revokeObjectURL(v.url);cacheBytes-=v.size;cache.delete(key);
    }
  }
  async function decodedURL(blob) {
    const url=URL.createObjectURL(blob), image=new Image();image.src=url;
    try {await image.decode();} catch(e){URL.revokeObjectURL(url);throw Error('Frame could not be decoded. Try another time.');}
    return url;
  }
  function cachedFrame(row) {
    if(cache.has(row.id)){const value=cache.get(row.id);cache.delete(row.id);cache.set(row.id,value);return Promise.resolve(value);}
    if(inFlight.has(row.id))return inFlight.get(row.id);
    const epoch=cacheEpoch;
    const task=(async()=>{
      const r=await fetchBounded('/api/frame/'+encodeURIComponent(row.id),'replay');
      if(!r.ok){if(denied(r))revokeView();throw Error(r.status===404?'Frame expired from circular storage. Reload this interval.':denied(r)?'Access revoked.':'Frame unavailable. Retrying is safe.');}
      const blob=await r.blob(), url=await decodedURL(blob);
      if(disposed||epoch!==cacheEpoch){URL.revokeObjectURL(url);throw Error('View changed');}
      const item={url,size:blob.size};cache.set(row.id,item);cacheBytes+=blob.size;trimCache();return item;
    })().finally(()=>{if(inFlight.get(row.id)===task)inFlight.delete(row.id);});
    inFlight.set(row.id,task);return task;
  }
  function prefetch() {
    if(disposed||live||document.hidden)return;
    // Two archive requests at most; never transcode a whole recording.
    for(let i=position+1;i<Math.min(rows.length,position+7)&&inFlight.size<2;i++) {
      if(!cache.has(rows[i].id)&&!inFlight.has(rows[i].id))cachedFrame(rows[i]).then(prefetch).catch(()=>{});
    }
  }
  function updateMode() {
    $('.mode').textContent=live?(liveFallback?'LAST RECORDING':'LIVE'):playing?'PLAYBACK':'PAUSED';$('.mode').classList.toggle('is-live',live&&!liveFallback);
    $('.play').textContent=live||playing?'Ⅱ':'▶';$('.play').setAttribute('aria-label',live?'Pause live view':pausedLive?'Resume live view':playing?'Pause playback':'Play recordings');
    $('.live').classList.toggle('active',live);$('.live').setAttribute('aria-pressed',String(live));$('.live').textContent=live?'Live':'Go live';
    $('.speed').hidden=live||pausedLive;$('.speed').disabled=live||pausedLive;
    $('.pause-mark').hidden=live||playing||$('.screen img').hidden;
    $('.play').disabled=$('.screen img').hidden;
    for(const control of ['.back','.forward','.previous','.next','.timelapse'])$(control).disabled=!rows.length;
    root.dataset.view=live?'live':pausedLive?'paused-live':'recorded';
    $('.range-end').textContent=rangeEnd?(live?'Now':rangeLabel(rangeEnd)):'';
  }
  function nearest(ts) {
    let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].ts<ts)lo=mid+1;else hi=mid;}
    if(lo===rows.length)return Math.max(0,lo-1);
    return lo&&ts-rows[lo-1].ts<rows[lo].ts-ts?lo-1:lo;
  }
  function timeline() {
    const canvas=$('.timeline'), width=Math.max(1,Math.round(canvas.getBoundingClientRect().width));canvas.width=width*2;canvas.height=48;
    const styles=getComputedStyle(root),context=canvas.getContext('2d');
    context.fillStyle=styles.getPropertyValue('--kc-surface').trim()||'#212225';context.fillRect(0,0,canvas.width,48);
    context.fillStyle=styles.getPropertyValue('--kc-accent').trim()||'#ff6600';const span=Math.max(1,rangeEnd-rangeStart);
    for(const row of rows){const x=(row.ts-rangeStart)/span*canvas.width;context.fillRect(x,14,Math.max(2,2000/span*canvas.width),20);}
    $('.scrub').min=String(rangeStart);$('.scrub').max=String(Math.max(rangeStart+1,rangeEnd));$('.scrub').disabled=!rows.length;
    $('.range-start').textContent=rangeStart?rangeLabel(rangeStart):'';$('.range-end').textContent=rangeEnd?(live?'Now':rangeLabel(rangeEnd)):'';
    $('.timeline-wrap').hidden=$('.timeline-labels').hidden=!rows.length;
  }
  function leaveLive() {if(live){live=false;abortGroup('live');lastLive='';displayGeneration++;}pausedLive=false;updateMode();}
  async function show(index) {
    if(disposed||!rows.length)return false;
    position=Math.max(0,Math.min(index,rows.length-1));const row=rows[position], g=++displayGeneration;
    $('.scrub').value=String(row.ts);$('.scrub').setAttribute('aria-valuetext',dateLabel(row.ts));
    $('.time').textContent=dateLabel(row.ts);$('.time').title=position&&row.ts-rows[position-1].ts>10000?'Gap before this frame':'';
    $('.screen').setAttribute('aria-busy','true');
    try {
      const frame=await cachedFrame(row);
      if(disposed||g!==displayGeneration||live)return false;
      displayedKey=row.id;$('.screen img').src=frame.url;$('.screen img').dataset.frameId=row.id;$('.screen img').hidden=false;$('.empty').hidden=true;
      if(liveURL)URL.revokeObjectURL(liveURL);liveURL=null;
      lastStamp=row.ts;$('.frame-age').hidden=true;
      trimCache();prefetch();updateMode();return true;
    } catch(e) {if(!disposed&&g===displayGeneration&&e.name!=='AbortError'){playing=false;if(lastStamp){position=nearest(lastStamp);$('.time').textContent=dateLabel(lastStamp);$('.scrub').value=String(lastStamp);}message(e.message);updateMode();}return false;}
    finally{if(!disposed&&g===displayGeneration)$('.screen').setAttribute('aria-busy','false');}
  }
  function seek(index) {
    leaveLive();playing=false;
    const row=rows[Math.max(0,Math.min(index,rows.length-1))];
    if(row&&!cache.has(row.id)&&!inFlight.has(row.id)){cacheEpoch++;abortGroup('replay');inFlight.clear();}
    updateMode();return show(index);
  }
  async function loadFrames({rolling=false,display=false,incremental=false,at}={}) {
    const id=selected;if(!id)return;
    const start=rolling?Date.now()+serverOffset-900000:new Date($('.from').value).getTime();
    const end=rolling?Date.now()+serverOffset:new Date($('.to').value).getTime()+59999;
    if(!Number.isFinite(start+end)||end<start||end-start>86400000+59999){message('Choose an interval of up to 24 hours.');return;}
    const boundedEnd=Math.min(end,start+86400000), g=++indexGeneration;let next=incremental&&rows.length?rows[rows.length-1].id:'', found=[];
    loading=true;indexBusy=true;lastIndex=now();
    try {
      do {
        const d=await json('/api/frames?'+new URLSearchParams({camera:id,start:String(Math.floor(start)),end:String(Math.floor(boundedEnd)),limit:'2000',after:next}));
        if(disposed||g!==indexGeneration)return;
        found.push(...d.frames);next=d.next||'';
      }while(next&&found.length<20000);
      const old=rows[position]?.id;
      rows=(incremental?[...rows,...found]:found).filter(r=>r.ts>=start&&r.ts<=boundedEnd).sort((a,b)=>a.ts-b.ts||a.id.localeCompare(b.id));
      rows=rows.filter((r,i)=>!i||r.id!==rows[i-1].id);
      rangeStart=start;rangeEnd=boundedEnd;position=Math.max(0,rows.findIndex(r=>r.id===old));timeline();lastIndex=now();updateMode();
      if(display&&!live) {if(rows.length)await show(Number.isFinite(at)?nearest(at):0);else{$('.screen img').hidden=true;$('.empty').hidden=false;$('.empty').textContent='No recordings for this time.';updateMode();}}
      if(live)$('.scrub').value=String(lastStamp||boundedEnd);
      if(next)message('This interval contains many frames. Select a shorter interval to review the rest.');
      else message();
    }catch(e){if(!disposed&&g===indexGeneration&&e.name!=='AbortError')message(e.message);}
    finally{if(g===indexGeneration){loading=false;indexBusy=false;}}
  }
  async function showLastRecording(camera,generation) {
    if(lastStamp||now()<fallbackRetry)return;
    fallbackRetry=now()+30000;
    const data=await json('/api/frames?'+new URLSearchParams({camera,start:'0',end:'0',latest:'true',limit:'1'}));
    if(disposed||!live||selected!==camera||generation!==displayGeneration)return;
    const row=data.frames?.[0];if(!row)return;
    const frame=await cachedFrame(row);
    if(disposed||!live||selected!==camera||generation!==displayGeneration)return;
    displayedKey=row.id;$('.screen img').src=frame.url;$('.screen img').dataset.frameId=row.id;
    $('.screen img').hidden=false;$('.empty').hidden=true;lastStamp=row.ts;lastLive=row.id;liveFallback=true;
    $('.time').textContent=dateLabel(row.ts);message('Showing the last recording while waiting for live frames.');updateAge();updateMode();
  }
  async function liveTick() {
    if(disposed||!live||!selected||liveBusy||document.hidden||now()<liveRetry)return;
    liveBusy=true;const camera=selected, generation=displayGeneration;
    try {
      const r=await fetchBounded('/api/live?'+new URLSearchParams({camera,after:lastLive,wait:'8'}),'live');
      if(disposed||!live||selected!==camera||generation!==displayGeneration)return;
      if(r.status===204){
        const state=r.headers.get('X-Live-State');
        if(!lastStamp)$('.empty').textContent=state==='paused'?'Recording is paused.':state==='disabled'?'This camera is paused.':'Waiting for live frames…';
        liveRetry=now()+1500;
        if(state==='waiting'||state==='disabled')await showLastRecording(camera,generation);
        return;
      }
      if(!r.ok){if(denied(r))revokeView();throw Error(denied(r)?'Access revoked.':'Live connection interrupted ('+r.status+'). Reconnecting…');}
      const key=r.headers.get('X-Frame-Id'), ts=Number(r.headers.get('X-Frame-Timestamp'));
      if(!key||!Number.isFinite(ts)||ts<=0)throw Error('Invalid live frame metadata.');
      const url=await decodedURL(await r.blob());
      if(disposed||!live||selected!==camera||generation!==displayGeneration){URL.revokeObjectURL(url);return;}
      const previous=liveURL;liveURL=url;$('.screen img').src=url;$('.screen img').dataset.frameId=key;$('.screen img').hidden=false;$('.empty').hidden=true;if(previous)URL.revokeObjectURL(previous);
      lastLive=key;lastStamp=ts;liveFallback=false;$('.scrub').value=String(ts);$('.time').textContent=dateLabel(ts);$('.time').title='';
      message();updateMode();
      updateAge();
    }catch(e){if(!disposed&&live&&e.name!=='AbortError'){message(e.message);liveRetry=now()+1500;}}
    finally{liveBusy=false;}
  }
  function updateAge() {
    if(!live||!lastStamp)return;
    const age=Math.max(0,(Date.now()+serverOffset-lastStamp)/1000);
    if(age>30&&!liveFallback){liveFallback=true;updateMode();}
    $('.frame-age').hidden=!recorderPaused&&age<10;
    $('.frame-age').textContent=recorderPaused?'Recording paused':Math.floor(age)+'s since last frame'+(age>30?' · reconnecting':'');
  }
  function goLive() {
    playing=false;live=true;pausedLive=false;displayGeneration++;abortGroup('live');abortGroup('replay');lastLive='';liveRetry=0;$('.screen').setAttribute('aria-busy','false');updateMode();message();
    $('.period').value='15';$('.custom-range').hidden=true;$('.from').value=dateInput(Date.now()-900000);$('.to').value=dateInput(Date.now());
    if(selected){loadFrames({rolling:true});liveTick();}
  }
  function delay(a,b) {
    if($('.speed').value==='timelapse')return 1000/6;
    let gap=Math.max(1,b.ts-a.ts);if($('.skip').checked&&gap>10000)gap=2000;
    return gap/Number($('.speed').value);
  }
  async function togglePlay() {
    if(live){leaveLive();pausedLive=true;playing=false;if(rows.length)position=nearest(lastStamp);updateMode();$('.frame-age').hidden=true;return;}
    if(pausedLive){goLive();return;}
    if(playing){playing=false;updateMode();return;}
    if(loading||!rows.length){message('Load an interval with recordings first.');return;}
    if(position>=rows.length-1)await show(0);
    playing=true;playDeadline=now()+(rows[position+1]?delay(rows[position],rows[position+1]):0);updateMode();prefetch();
  }
  async function playbackTick() {
    if(disposed||!playing||playbackBusy||document.hidden||now()<playDeadline)return;
    if(position>=rows.length-1){playing=false;updateMode();return;}
    playbackBusy=true;
    try{await show(position+1);if(playing&&rows[position+1])playDeadline=Math.max(playDeadline,now()-500)+delay(rows[position],rows[position+1]);}
    finally{playbackBusy=false;}
  }
  async function status() {
    if(disposed||statusBusy||document.hidden)return;statusBusy=true;
    try {
      const d=await json('/api/status');if(disposed)return;
      serverOffset=d.server_time-Date.now();recorderPaused=!d.recording;
      const ids=d.configured_cameras, disabled=new Set(d.disabled_cameras||[]);
      if(JSON.stringify(ids)!==JSON.stringify([...$('.camera').options].map(o=>o.value))) {
        $('.camera').replaceChildren(...ids.map(id=>{const o=document.createElement('option');o.value=id;o.textContent=cameraName(id);return o;}));
        if(ids.includes(selected))$('.camera').value=selected;
        else if(selected)selectCamera();
      }
      if(!selected){const available=d.cameras.find(s=>s.last_frame&&d.server_time-s.last_frame<30000&&!s.error);if(available&&ids.includes(available.id))$('.camera').value=available.id;}
      const existing=new Map([...$('.devices').children].map(item=>[item.dataset.camera,item]));
      const buttons=ids.map(id=>{
        const s=d.cameras.find(c=>c.id===id);let item=existing.get(id);
        if(!item){item=document.createElement('button');item.className='device';item.dataset.camera=id;const dot=document.createElement('span');dot.className='device-dot';dot.setAttribute('aria-hidden','true');const label=document.createElement('strong'),detail=document.createElement('span');detail.className='device-state';item.append(dot,label,detail);item.onclick=()=>{$('.camera').value=id;selectCamera();};}
        item.setAttribute('aria-pressed',String(id===selected));item.querySelector('strong').textContent=cameraName(id);
        const seen=s?.last_seen||s?.last_frame, age=seen?Date.now()+serverOffset-seen:Infinity;
        const state=disabled.has(id)?'Paused':age>30000?'No recent frames':s?.error?'Reconnecting':'Online',detail=item.querySelector('.device-state');
        detail.textContent=state==='Paused'?'Paused':age>30000?'No frames':'';detail.hidden=!detail.textContent;
        item.classList.toggle('offline',age>30000);item.classList.toggle('retrying',!disabled.has(id)&&Boolean(s?.error));item.title=id+' · '+state+(Number.isFinite(age)?' · last frame '+Math.floor(age/1000)+'s ago':'')+' · '+Number(s?.observed_fps||0).toFixed(2)+' frames/s';item.setAttribute('aria-label',cameraName(id)+', '+state);return item;
      });
      if(JSON.stringify(ids)!==JSON.stringify([...existing.keys()]))$('.devices').replaceChildren(...buttons);
      $('.details').textContent='Recording '+(d.recording?'on':'paused')+' · '+(d.storage.bytes/1e9).toFixed(2)+' / '+(d.storage.quota_bytes/1e9).toFixed(1)+' GB used';
      $('.metrics').textContent=d.cameras.map(s=>cameraName(s.id)+': '+Number(s.observed_fps||0).toFixed(2)+' fps').join(' · ');
      $('.metrics').title='Delivered frames per second over the last '+Math.round(d.fps_window_seconds||60)+' seconds.';
      if(recorderPaused&&live){displayGeneration++;if(liveURL)URL.revokeObjectURL(liveURL);liveURL=null;$('.screen img').hidden=true;$('.empty').hidden=false;$('.empty').textContent='Recording is paused. Choose a time below to review.';message();updateMode();}
      if(!ids.length){$('.empty').textContent='No cameras set up.';message();}
      updateAge();
    }catch(e){if(!disposed&&e.name!=='AbortError'){
      for(const item of $('.devices').children){item.querySelector('.device-state').textContent='Unknown';item.querySelector('.device-state').hidden=false;item.setAttribute('aria-label',cameraName(item.dataset.camera)+', recorder unreachable');item.title='Recorder unreachable; camera state is unknown.';}
      $('.metrics').textContent='Camera status unavailable';message(e.message);
    }}
    finally{statusBusy=false;}
  }
  function selectCamera() {
    const at=!live&&!pausedLive?lastStamp:undefined;
    if(pausedLive){live=true;pausedLive=false;}
    selected=$('.camera').value;indexGeneration++;displayGeneration++;rows=[];position=0;lastLive='';lastStamp=0;liveFallback=false;fallbackRetry=0;
    abortGroup('live');clearCache();if(liveURL)URL.revokeObjectURL(liveURL);liveURL=null;
    $('.screen img').hidden=true;$('.empty').hidden=false;$('.empty').textContent=selected?'Connecting…':'No cameras set up.';
    $('.screen').setAttribute('aria-busy','false');$('.time').textContent='';$('.frame-age').hidden=true;message();timeline();
    for(const item of root.querySelectorAll('.device'))item.setAttribute('aria-pressed',String(item.dataset.camera===selected));
    playing=false;updateMode();if(live){loadFrames({rolling:true});liveTick();}else loadFrames({display:true,at});
  }
  $('.from').value=dateInput(Date.now()-900000);$('.to').value=dateInput(Date.now());
  $('.camera').onchange=selectCamera;$('.live').onclick=goLive;$('.play').onclick=togglePlay;
  $('.timelapse').onclick=async()=>{
    if(!rows.length||loading)return;
    const generation=indexGeneration;$('.speed').value='timelapse';
    if(live||pausedLive)await seek(0);
    if(disposed||generation!==indexGeneration||live||!rows.length)return;
    if(!playing)await togglePlay();else playDeadline=now();
  };
  $('.screen').onclick=()=>$('.play').click();$('.screen').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('.play').click();}};
  $('.previous').onclick=()=>{if(live)position=nearest(lastStamp);seek(position-1);};
  $('.next').onclick=()=>{if(live)position=nearest(lastStamp);seek(position+1);};
  $('.back').onclick=()=>seek(nearest((live||pausedLive?lastStamp:rows[position]?.ts||0)-10000));
  $('.forward').onclick=()=>seek(nearest((live||pausedLive?lastStamp:rows[position]?.ts||0)+10000));
  $('.speed').onchange=()=>{if(playing)playDeadline=now();};$('.skip').onchange=()=>{if(playing)playDeadline=now();};
  $('.scrub').oninput=e=>{leaveLive();playing=false;updateMode();const ts=Number(e.target.value);$('.time').textContent=dateLabel(ts)+' · seeking…';clearTimeout(scrubTimer);scrubTimer=setTimeout(()=>seek(nearest(ts)),60);};
  $('.scrub').onchange=e=>{clearTimeout(scrubTimer);seek(nearest(Number(e.target.value)));};
  $('.scrub').onkeydown=e=>{const button={ArrowLeft:'.previous',ArrowRight:'.next',' ':'.play'}[e.key];if(button){e.preventDefault();$(button).click();}else if(e.key==='Home'||e.key==='End'){e.preventDefault();seek(e.key==='Home'?0:rows.length-1);}};
  $('.load').onclick=()=>{leaveLive();playing=false;clearCache();updateMode();loadFrames({display:true});};
  $('.period').onchange=async()=>{if($('.period').value==='latest'){const id=selected;try{const data=await json('/api/frames?'+new URLSearchParams({camera:id,start:'0',end:'0',latest:'true',limit:'1'}));if(disposed||selected!==id||$('.period').value!=='latest')return;const ts=data.frames?.[0]?.ts;if(!ts){message('No saved recordings for this camera.');return;}$('.from').value=dateInput(ts-900000);$('.to').value=dateInput(ts);$('.custom-range').hidden=true;$('.load').click();}catch(error){if(!disposed)message(error.message);}return;}const minutes=Number($('.period').value);$('.custom-range').hidden=Boolean(minutes);if(!minutes){$('.from').focus();return;}$('.from').value=dateInput(Date.now()-minutes*60000);$('.to').value=dateInput(Date.now());$('.load').click();};
  $('.from').onchange=$('.to').onchange=()=>{$('.period').value='custom';$('.custom-range').hidden=false;};
  for(const field of ['.from','.to'])$(field).onkeydown=e=>{if(e.key==='Enter')$('.load').click();};
  $('.fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('.viewer').requestFullscreen();}catch{message('Full screen is unavailable in this browser.');}};
  const keydown=e=>{if(!root.contains(document.activeElement)&&document.activeElement!==document.body)return;if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName))return;const button={ArrowLeft:'.previous',ArrowRight:'.next',j:'.back',k:'.forward',l:'.live',' ':'.play'}[e.key];if(button){e.preventDefault();$(button).click();}};
  const visibility=()=>{if(document.hidden){abortGroup('live');playing=false;updateMode();}else{liveRetry=0;status();if(live)liveTick();}};
  document.addEventListener('keydown',keydown);document.addEventListener('visibilitychange',visibility);
  const resize=()=>timeline();window.addEventListener('resize',resize);
  // Radix and Wokenet display settings can change without remounting the page.
  const themeObserver=new MutationObserver(resize);
  themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-appearance','data-accent','class']});
  const theme=root.closest('.radix-themes');
  if(theme)themeObserver.observe(theme,{attributes:true,attributeFilter:['class','style','data-accent-color']});
  const timer=setInterval(()=>{updateAge();liveTick();playbackTick();if(live&&!indexBusy&&selected&&now()-lastIndex>20000)loadFrames({rolling:true,incremental:true});},80);
  const statusTimer=setInterval(status,3000);
  updateMode();status().then(()=>{if(!disposed){selected=$('.camera').value;selectCamera();}});
  return ()=>{disposed=true;indexGeneration++;displayGeneration++;for(const c of pending.keys())c.abort();pending.clear();clearCache();clearInterval(timer);clearInterval(statusTimer);clearTimeout(scrubTimer);document.removeEventListener('keydown',keydown);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('resize',resize);themeObserver.disconnect();if(liveURL)URL.revokeObjectURL(liveURL);root.replaceChildren();};
}
