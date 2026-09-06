import './style.css';

/* ---------- storage shim (localStorage-backed, replaces Claude's window.storage) ---------- */
const storage = {
  async get(key){
    const v = localStorage.getItem(key);
    if(v === null) return null;
    return { key, value: v };
  },
  async set(key, value){
    localStorage.setItem(key, value);
    return { key, value };
  },
  async delete(key){
    localStorage.removeItem(key);
    return { key, deleted: true };
  }
};

/* ---------- constants ---------- */
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const TAG_PALETTE = ['#c99a3e','#5ea8a0','#a97bc9','#c05a4e','#6a9bd8','#8ec07c'];
const HOUR_H = 48;

/* ---------- state ---------- */
let state = {
  view: 'month',
  anchor: new Date(),
  events: [],
  tags: [],
  theme: 'dark',
  editingId: null,
  editingOccDate: null
};

/* ---------- date helpers ---------- */
function pad2(n){ return n<10 ? '0'+n : ''+n; }
function fmtDate(d){ return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
function parseDate(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); }
function addDays(d,n){ const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function addMonths(d,n){ const r=new Date(d); r.setMonth(r.getMonth()+n); return r; }
function addYears(d,n){ const r=new Date(d); r.setFullYear(r.getFullYear()+n); return r; }
function startOfWeek(d){ const r=new Date(d); r.setDate(r.getDate()-r.getDay()); r.setHours(0,0,0,0); return r; }
function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function sameDate(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function isToday(d){ return sameDate(d, new Date()); }
function timeToMin(t){ if(!t) return 0; const [h,m]=t.split(':').map(Number); return h*60+m; }
function minToTime(m){ m=((m%1440)+1440)%1440; return pad2(Math.floor(m/60))+':'+pad2(m%60); }
function genId(){ return 'e'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }

/* ---------- storage ---------- */
async function loadAll(){
  try{ const r = await storage.get('cal:events'); state.events = r ? JSON.parse(r.value) : []; }
  catch(e){ state.events = []; }
  try{ const r = await storage.get('cal:tags'); state.tags = r ? JSON.parse(r.value) : null; }
  catch(e){ state.tags = null; }
  if(!state.tags || !state.tags.length){
    state.tags = [
      {id:'t1', name:'Work', color:TAG_PALETTE[0]},
      {id:'t2', name:'Personal', color:TAG_PALETTE[1]},
      {id:'t3', name:'Important', color:TAG_PALETTE[3]}
    ];
    saveTags();
  }
  try{ const r = await storage.get('cal:settings'); const s = r ? JSON.parse(r.value) : {}; state.theme = s.theme || 'dark'; }
  catch(e){ state.theme='dark'; }
  applyTheme();
}
async function saveEvents(){ try{ await storage.set('cal:events', JSON.stringify(state.events)); }catch(e){} }
async function saveTags(){ try{ await storage.set('cal:tags', JSON.stringify(state.tags)); }catch(e){} }
async function saveSettings(){ try{ await storage.set('cal:settings', JSON.stringify({theme:state.theme})); }catch(e){} }

function applyTheme(){ document.documentElement.setAttribute('data-theme', state.theme); }
function tagById(id){ return state.tags.find(t=>t.id===id); }
function tagColor(id){ const t=tagById(id); return t ? t.color : '#5a6472'; }

/* ---------- occurrence generation ---------- */
function getOccurrences(ev, rangeStart, rangeEnd){
  const base = parseDate(ev.date);
  const rec = ev.recurrence || {freq:'none'};
  const exceptions = new Set(ev.exceptions||[]);
  const results = [];
  if(rec.freq==='none'){
    if(base>=rangeStart && base<=rangeEnd && !exceptions.has(fmtDate(base))) results.push(base);
    return results;
  }
  const interval = Math.max(1, parseInt(rec.interval)||1);
  const until = rec.until ? parseDate(rec.until) : null;
  let cur = new Date(base);
  let count = 0;
  while(cur<=rangeEnd && count<3000){
    if(until && cur>until) break;
    if(cur>=rangeStart && !exceptions.has(fmtDate(cur))) results.push(new Date(cur));
    if(rec.freq==='daily') cur = addDays(cur, interval);
    else if(rec.freq==='weekly') cur = addDays(cur, 7*interval);
    else if(rec.freq==='monthly') cur = addMonths(cur, interval);
    else if(rec.freq==='yearly') cur = addYears(cur, interval);
    else break;
    count++;
  }
  return results;
}
function occurrencesInRange(rangeStart, rangeEnd){
  const out = [];
  for(const ev of state.events){
    const occs = getOccurrences(ev, rangeStart, rangeEnd);
    for(const d of occs) out.push({ev, date:d});
  }
  return out;
}

/* ---------- move / reschedule ---------- */
function moveOccurrence(eventId, occDateStr, newDateStr, newStartTime){
  const ev = state.events.find(e=>e.id===eventId);
  if(!ev) return;
  const isRecurring = ev.recurrence && ev.recurrence.freq!=='none';
  if(!isRecurring){
    ev.date = newDateStr;
    if(newStartTime!==undefined && !ev.allDay){
      const dur = timeToMin(ev.endTime) - timeToMin(ev.startTime);
      ev.startTime = newStartTime;
      ev.endTime = minToTime(timeToMin(newStartTime) + Math.max(15,dur));
    }
    saveEvents();
  } else {
    ev.exceptions = ev.exceptions || [];
    ev.exceptions.push(occDateStr);
    const clone = JSON.parse(JSON.stringify(ev));
    clone.id = genId();
    clone.date = newDateStr;
    clone.recurrence = {freq:'none'};
    clone.exceptions = [];
    if(newStartTime!==undefined && !ev.allDay){
      const dur = timeToMin(ev.endTime) - timeToMin(ev.startTime);
      clone.startTime = newStartTime;
      clone.endTime = minToTime(timeToMin(newStartTime) + Math.max(15,dur));
    }
    state.events.push(clone);
    saveEvents();
  }
  renderAll();
}

/* ---------- rendering dispatch ---------- */
const mainEl = document.getElementById('main');
function renderAll(){
  document.querySelectorAll('.views button').forEach(b=>b.classList.toggle('active', b.dataset.view===state.view));
  updatePeriodLabel();
  if(state.view==='month') renderMonth();
  else renderWeekOrDay(state.view);
}

function updatePeriodLabel(){
  const el = document.getElementById('periodLabel');
  if(state.view==='month'){
    el.textContent = MONTHS[state.anchor.getMonth()] + ' ' + state.anchor.getFullYear();
  } else if(state.view==='week'){
    const s = startOfWeek(state.anchor), e = addDays(s,6);
    el.textContent = MONTHS[s.getMonth()].slice(0,3)+' '+s.getDate()+' \u2013 '+MONTHS[e.getMonth()].slice(0,3)+' '+e.getDate()+', '+e.getFullYear();
  } else {
    el.textContent = MONTHS[state.anchor.getMonth()]+' '+state.anchor.getDate()+', '+state.anchor.getFullYear();
  }
}

/* ---------- month view ---------- */
function renderMonth(){
  mainEl.innerHTML = '<div class="month-dow" id="monthDow"></div><div class="month-grid" id="monthGrid"></div>';
  const dowEl = document.getElementById('monthDow');
  DOW.forEach(d=>{ const c=document.createElement('div'); c.textContent=d; dowEl.appendChild(c); });

  const grid = document.getElementById('monthGrid');
  const first = startOfMonth(state.anchor);
  const gridStart = startOfWeek(first);
  const cells = [];
  for(let i=0;i<42;i++) cells.push(addDays(gridStart,i));
  const rangeStart = cells[0], rangeEnd = addDays(cells[41],1);
  const occs = occurrencesInRange(rangeStart, rangeEnd);
  const byDate = {};
  occs.forEach(o=>{ const k=fmtDate(o.date); (byDate[k]=byDate[k]||[]).push(o); });

  cells.forEach(d=>{
    const key = fmtDate(d);
    const cell = document.createElement('div');
    cell.className = 'mcell';
    cell.dataset.date = key;
    if(d.getMonth()!==state.anchor.getMonth()) cell.classList.add('dim');
    if(isToday(d)) cell.classList.add('today');

    const num = document.createElement('div');
    num.className = 'dnum';
    num.textContent = d.getDate();
    cell.appendChild(num);

    const list = (byDate[key]||[]).sort((a,b)=> (a.ev.allDay?-1:0) - (b.ev.allDay?-1:0) || timeToMin(a.ev.startTime)-timeToMin(b.ev.startTime));
    const shown = list.slice(0,3);
    shown.forEach(o=>{
      const chip = document.createElement('div');
      chip.className='chip';
      chip.style.borderLeftColor = tagColor(o.ev.tagId);
      chip.draggable = true;
      chip.innerHTML = (o.ev.allDay?'':'<span class="tm">'+o.ev.startTime+'</span>') + escapeHtml(o.ev.title||'Untitled');
      chip.addEventListener('click',(e)=>{ e.stopPropagation(); openEventModal(o.ev.id, fmtDate(o.date)); });
      chip.addEventListener('dragstart',(e)=>{
        e.dataTransfer.setData('text/plain', JSON.stringify({eventId:o.ev.id, occDate:fmtDate(o.date)}));
      });
      cell.appendChild(chip);
    });
    if(list.length>3){
      const more = document.createElement('div');
      more.className='more-link';
      more.textContent = '+'+(list.length-3)+' more';
      more.addEventListener('click',(e)=>{ e.stopPropagation(); state.anchor=d; state.view='day'; renderAll(); });
      cell.appendChild(more);
    }

    cell.addEventListener('click', ()=> openEventModal(null, key));
    cell.addEventListener('dragover', (e)=>{ e.preventDefault(); cell.classList.add('dragover'); });
    cell.addEventListener('dragleave', ()=> cell.classList.remove('dragover'));
    cell.addEventListener('drop',(e)=>{
      e.preventDefault(); cell.classList.remove('dragover');
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      moveOccurrence(data.eventId, data.occDate, key, undefined);
    });
    grid.appendChild(cell);
  });
}

/* ---------- week / day view ---------- */
function renderWeekOrDay(mode){
  const days = mode==='week'
    ? Array.from({length:7}, (_,i)=> addDays(startOfWeek(state.anchor), i))
    : [new Date(state.anchor)];

  let html = '<div class="tv-header"><div class="tv-gutter-header"></div>';
  days.forEach(d=>{
    html += '<div class="tv-day-header'+(isToday(d)?' today':'')+'"><div class="dn">'+DOW[d.getDay()]+'</div><div class="dd">'+d.getDate()+'</div></div>';
  });
  html += '</div>';

  html += '<div class="allday-row"><div class="allday-gutter">all-day</div>';
  days.forEach(d=>{ html += '<div class="allday-cell" data-date="'+fmtDate(d)+'" data-allday="1"></div>'; });
  html += '</div>';

  html += '<div class="tv-body">';
  html += '<div class="tv-gutter">' + Array.from({length:24},(_,h)=>'<div class="hr">'+pad2(h)+':00</div>').join('') + '</div>';
  days.forEach(d=>{
    html += '<div class="tv-col" data-date="'+fmtDate(d)+'">';
    for(let h=0;h<24;h++) html += '<div class="hourline"></div>';
    html += '</div>';
  });
  html += '</div>';

  mainEl.innerHTML = html;

  const rangeStart = days[0], rangeEnd = addDays(days[days.length-1],1);
  const occs = occurrencesInRange(rangeStart, rangeEnd);

  occs.forEach(o=>{
    const key = fmtDate(o.date);
    if(o.ev.allDay){
      const cell = mainEl.querySelector('.allday-cell[data-date="'+key+'"]');
      if(!cell) return;
      const chip = document.createElement('div');
      chip.className='chip';
      chip.style.borderLeftColor = tagColor(o.ev.tagId);
      chip.draggable = true;
      chip.textContent = o.ev.title || 'Untitled';
      chip.addEventListener('click',(e)=>{ e.stopPropagation(); openEventModal(o.ev.id, key); });
      chip.addEventListener('dragstart',(e)=>{ e.dataTransfer.setData('text/plain', JSON.stringify({eventId:o.ev.id, occDate:key, allDay:true})); });
      cell.appendChild(chip);
    } else {
      const col = mainEl.querySelector('.tv-col[data-date="'+key+'"]');
      if(!col) return;
      const startMin = timeToMin(o.ev.startTime), endMin = Math.max(startMin+15, timeToMin(o.ev.endTime));
      const block = document.createElement('div');
      block.className='tblock';
      block.style.top = (startMin/60*HOUR_H)+'px';
      block.style.height = ((endMin-startMin)/60*HOUR_H - 2)+'px';
      block.style.borderLeftColor = tagColor(o.ev.tagId);
      block.draggable = true;
      block.innerHTML = '<span class="tt">'+o.ev.startTime+'\u2013'+o.ev.endTime+'</span>'+escapeHtml(o.ev.title||'Untitled');
      block.addEventListener('click',(e)=>{ e.stopPropagation(); openEventModal(o.ev.id, key); });
      block.addEventListener('dragstart',(e)=>{ e.dataTransfer.setData('text/plain', JSON.stringify({eventId:o.ev.id, occDate:key})); });
      col.appendChild(block);
    }
  });

  // now-line on today's column
  const now = new Date();
  days.forEach(d=>{
    if(isToday(d)){
      const col = mainEl.querySelector('.tv-col[data-date="'+fmtDate(d)+'"]');
      if(col){
        const line = document.createElement('div');
        line.className='now-line';
        line.style.top = ((now.getHours()*60+now.getMinutes())/60*HOUR_H)+'px';
        col.appendChild(line);
      }
    }
  });

  // click empty column to create event at that time
  mainEl.querySelectorAll('.tv-col').forEach(col=>{
    col.addEventListener('click',(e)=>{
      if(e.target!==col) return;
      const rect = col.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const mins = Math.round((y/HOUR_H*60)/15)*15;
      const start = minToTime(mins);
      openEventModal(null, col.dataset.date, start);
    });
    col.addEventListener('dragover',(e)=>{ e.preventDefault(); col.classList.add('dragover'); });
    col.addEventListener('dragleave', ()=> col.classList.remove('dragover'));
    col.addEventListener('drop',(e)=>{
      e.preventDefault(); col.classList.remove('dragover');
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      const rect = col.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const mins = Math.round((y/HOUR_H*60)/15)*15;
      moveOccurrence(data.eventId, data.occDate, col.dataset.date, data.allDay?undefined:minToTime(mins));
    });
  });
  mainEl.querySelectorAll('.allday-cell').forEach(cell=>{
    cell.addEventListener('click',(e)=>{ if(e.target===cell) openEventModal(null, cell.dataset.date, null, true); });
    cell.addEventListener('dragover',(e)=>e.preventDefault());
    cell.addEventListener('drop',(e)=>{
      e.preventDefault();
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      moveOccurrence(data.eventId, data.occDate, cell.dataset.date, undefined);
    });
  });

  if(mode==='day' || mode==='week'){
    mainEl.scrollTop = 0;
    setTimeout(()=>{ mainEl.scrollTop = Math.max(0, 7*HOUR_H); },0);
  }
}

function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

/* ---------- event modal ---------- */
const overlay = document.getElementById('overlay');
function openEventModal(eventId, dateStr, startTime, allDayDefault){
  state.editingId = eventId;
  document.getElementById('modalTitle').textContent = eventId ? 'Edit event' : 'New event';
  document.getElementById('deleteBtn').style.display = eventId ? 'inline-block' : 'none';

  let ev = eventId ? state.events.find(e=>e.id===eventId) : null;
  document.getElementById('f-title').value = ev ? ev.title||'' : '';
  document.getElementById('f-date').value = dateStr || fmtDate(new Date());
  const allDay = ev ? !!ev.allDay : !!allDayDefault;
  document.getElementById('f-allday').checked = allDay;
  document.getElementById('f-start').value = ev ? ev.startTime||'09:00' : (startTime || '09:00');
  document.getElementById('f-end').value = ev ? ev.endTime||'10:00' : minToTime(timeToMin(startTime||'09:00')+60);
  document.getElementById('timeRow').style.display = allDay ? 'none' : 'flex';
  document.getElementById('f-notes').value = ev ? ev.notes||'' : '';

  const freq = ev && ev.recurrence ? ev.recurrence.freq : 'none';
  document.getElementById('f-freq').value = freq;
  document.getElementById('f-interval').value = ev && ev.recurrence ? ev.recurrence.interval||1 : 1;
  document.getElementById('f-until').value = ev && ev.recurrence ? ev.recurrence.until||'' : '';
  document.getElementById('intervalField').style.display = freq==='none' ? 'none' : 'block';
  document.getElementById('untilField').style.display = freq==='none' ? 'none' : 'block';

  renderTagPicker(ev ? ev.tagId : null);
  overlay.classList.add('open');
  document.getElementById('f-title').focus();
}
function closeModal(){ overlay.classList.remove('open'); state.editingId=null; }

function renderTagPicker(selectedId){
  const wrap = document.getElementById('tagPick');
  wrap.innerHTML = '';
  wrap.dataset.selected = selectedId || '';
  const noneSw = document.createElement('div');
  noneSw.className='sw'+(!selectedId?' selected':'');
  noneSw.style.background = '#5a6472';
  noneSw.title = 'None';
  noneSw.addEventListener('click',()=>{ wrap.dataset.selected=''; renderTagPicker(null); });
  wrap.appendChild(noneSw);
  state.tags.forEach(t=>{
    const sw = document.createElement('div');
    sw.className='sw'+(selectedId===t.id?' selected':'');
    sw.style.background = t.color;
    sw.title = t.name;
    sw.addEventListener('click',()=>{ wrap.dataset.selected=t.id; renderTagPicker(t.id); });
    wrap.appendChild(sw);
  });
}

document.getElementById('f-allday').addEventListener('change', (e)=>{
  document.getElementById('timeRow').style.display = e.target.checked ? 'none' : 'flex';
});
document.getElementById('f-freq').addEventListener('change', (e)=>{
  const on = e.target.value!=='none';
  document.getElementById('intervalField').style.display = on?'block':'none';
  document.getElementById('untilField').style.display = on?'block':'none';
});
document.getElementById('cancelBtn').addEventListener('click', closeModal);
overlay.addEventListener('click',(e)=>{ if(e.target===overlay) closeModal(); });

document.getElementById('saveEventBtn').addEventListener('click', ()=>{
  const title = document.getElementById('f-title').value.trim() || 'Untitled event';
  const date = document.getElementById('f-date').value;
  const allDay = document.getElementById('f-allday').checked;
  const startTime = allDay ? null : document.getElementById('f-start').value;
  const endTime = allDay ? null : document.getElementById('f-end').value;
  const notes = document.getElementById('f-notes').value;
  const tagId = document.getElementById('tagPick').dataset.selected || null;
  const freq = document.getElementById('f-freq').value;
  const interval = parseInt(document.getElementById('f-interval').value)||1;
  const until = document.getElementById('f-until').value || null;
  const recurrence = freq==='none' ? {freq:'none'} : {freq, interval, until};

  if(!date){ alert('Pick a date.'); return; }

  if(state.editingId){
    const ev = state.events.find(e=>e.id===state.editingId);
    Object.assign(ev, {title,date,allDay,startTime,endTime,notes,tagId,recurrence});
  } else {
    state.events.push({ id:genId(), title,date,allDay,startTime,endTime,notes,tagId,recurrence, exceptions:[] });
  }
  saveEvents();
  closeModal();
  renderAll();
});
document.getElementById('deleteBtn').addEventListener('click', ()=>{
  state.events = state.events.filter(e=>e.id!==state.editingId);
  saveEvents();
  closeModal();
  renderAll();
});

/* ---------- tag manager ---------- */
const tagMgr = document.getElementById('tagMgr');
document.getElementById('tagsBtn').addEventListener('click', ()=>{
  tagMgr.classList.toggle('open');
  document.getElementById('helpPanel').classList.remove('open');
  renderTagList();
});
function renderTagList(){
  const list = document.getElementById('tagList');
  list.innerHTML = '';
  state.tags.forEach(t=>{
    const row = document.createElement('div');
    row.className='tagrow';
    row.innerHTML = '<div class="sw" style="background:'+t.color+'"></div><span>'+escapeHtml(t.name)+'</span>';
    const x = document.createElement('span');
    x.className='x'; x.textContent='\u00d7';
    x.addEventListener('click', ()=>{ state.tags = state.tags.filter(x=>x.id!==t.id); saveTags(); renderTagList(); renderAll(); });
    row.appendChild(x);
    list.appendChild(row);
  });
}
document.getElementById('addTagBtn').addEventListener('click', ()=>{
  const input = document.getElementById('newTagName');
  const name = input.value.trim();
  if(!name) return;
  const color = TAG_PALETTE[state.tags.length % TAG_PALETTE.length];
  state.tags.push({id:genId(), name, color});
  saveTags();
  input.value='';
  renderTagList();
});

/* ---------- help panel ---------- */
const helpPanel = document.getElementById('helpPanel');
document.getElementById('helpBtn').addEventListener('click', ()=>{
  helpPanel.classList.toggle('open');
  tagMgr.classList.remove('open');
});

/* ---------- search ---------- */
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
searchInput.addEventListener('input', ()=>{
  const q = searchInput.value.trim().toLowerCase();
  if(!q){ searchResults.classList.remove('open'); return; }
  const far = addYears(new Date(),2);
  const near = addYears(new Date(),-2);
  const occs = occurrencesInRange(near, far);
  const matches = occs.filter(o=>{
    const t = tagById(o.ev.tagId);
    return (o.ev.title||'').toLowerCase().includes(q)
      || (o.ev.notes||'').toLowerCase().includes(q)
      || (t && t.name.toLowerCase().includes(q));
  }).sort((a,b)=>a.date-b.date).slice(0,8);

  searchResults.innerHTML = '';
  if(!matches.length){
    searchResults.innerHTML = '<div class="empty">No matches</div>';
  } else {
    matches.forEach(m=>{
      const item = document.createElement('div');
      item.className='item';
      item.innerHTML = '<div class="t">'+escapeHtml(m.ev.title||'Untitled')+'</div><div class="d">'+fmtDate(m.date)+(m.ev.allDay?'':' '+m.ev.startTime)+'</div>';
      item.addEventListener('click', ()=>{
        state.anchor = new Date(m.date);
        state.view = 'day';
        searchResults.classList.remove('open');
        searchInput.value='';
        renderAll();
      });
      searchResults.appendChild(item);
    });
  }
  searchResults.classList.add('open');
});
document.addEventListener('click',(e)=>{
  if(!e.target.closest('.search-wrap')) searchResults.classList.remove('open');
  if(!e.target.closest('.tagmgr') && e.target.id!=='tagsBtn') tagMgr.classList.remove('open');
  if(!e.target.closest('.help') && e.target.id!=='helpBtn') helpPanel.classList.remove('open');
});

/* ---------- toolbar nav ---------- */
document.querySelectorAll('.views button').forEach(b=>{
  b.addEventListener('click', ()=>{ state.view=b.dataset.view; renderAll(); });
});
document.getElementById('prevBtn').addEventListener('click', ()=> step(-1));
document.getElementById('nextBtn').addEventListener('click', ()=> step(1));
document.getElementById('todayBtn').addEventListener('click', ()=>{ state.anchor=new Date(); renderAll(); });
document.getElementById('newBtn').addEventListener('click', ()=> openEventModal(null, fmtDate(state.anchor)));
document.getElementById('themeBtn').addEventListener('click', ()=>{
  state.theme = state.theme==='dark' ? 'light' : 'dark';
  applyTheme(); saveSettings();
});
function step(dir){
  if(state.view==='month') state.anchor = addMonths(state.anchor, dir);
  else if(state.view==='week') state.anchor = addDays(state.anchor, dir*7);
  else state.anchor = addDays(state.anchor, dir);
  renderAll();
}

/* ---------- keyboard shortcuts ---------- */
document.addEventListener('keydown',(e)=>{
  const tag = (e.target.tagName||'').toLowerCase();
  const typing = tag==='input' || tag==='textarea' || tag==='select';
  if(e.key==='Escape'){
    closeModal(); searchResults.classList.remove('open'); tagMgr.classList.remove('open'); helpPanel.classList.remove('open');
    searchInput.blur();
    return;
  }
  if(typing) return;
  if(overlay.classList.contains('open')) return;
  switch(e.key){
    case 'm': state.view='month'; renderAll(); break;
    case 'w': state.view='week'; renderAll(); break;
    case 'd': state.view='day'; renderAll(); break;
    case 'h': step(-1); break;
    case 'l': step(1); break;
    case 't': state.anchor=new Date(); renderAll(); break;
    case 'n': openEventModal(null, fmtDate(state.anchor)); break;
    case '/': e.preventDefault(); searchInput.focus(); break;
    case 'j': mainEl.scrollTop += 100; break;
    case 'k': mainEl.scrollTop -= 100; break;
    case '?': helpPanel.classList.toggle('open'); break;
  }
});

/* ---------- export / import JSON ---------- */
document.getElementById('exportBtn').addEventListener('click', ()=>{
  const payload = {
    exportedAt: new Date().toISOString(),
    events: state.events,
    tags: state.tags
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'calendar-export-'+fmtDate(new Date())+'.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

document.getElementById('importBtn').addEventListener('click', ()=>{
  document.getElementById('importFile').click();
});
document.getElementById('importFile').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try{ data = JSON.parse(reader.result); }
    catch(err){ alert('That file is not valid JSON.'); return; }
    if(!data || !Array.isArray(data.events)){
      alert('This JSON does not look like a calendar export (missing "events" array).');
      return;
    }
    const mode = confirm(
      'OK = merge with existing events.\nCancel = replace all existing events and tags.'
    );
    if(mode){
      const existingIds = new Set(state.events.map(ev=>ev.id));
      data.events.forEach(ev=>{
        if(!ev.id || existingIds.has(ev.id)) ev.id = genId();
        state.events.push(ev);
      });
      if(Array.isArray(data.tags)){
        const existingTagIds = new Set(state.tags.map(t=>t.id));
        data.tags.forEach(t=>{
          if(!t.id || existingTagIds.has(t.id)) t.id = genId();
          state.tags.push(t);
        });
      }
    } else {
      state.events = data.events;
      state.tags = Array.isArray(data.tags) && data.tags.length ? data.tags : state.tags;
    }
    saveEvents();
    saveTags();
    renderAll();
    alert('Import complete: '+data.events.length+' event(s) loaded.');
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ---------- init ---------- */
(async function init(){
  await loadAll();
  renderAll();
})();
