
/* ============================================================
   ДВИЖОК. Контент, тесты и карточки — в TOPICS (один объект на тему).
   ============================================================ */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const LS="inf3:", OLD="inf2:";
const BLOCK_SEL='p,li,td,th,h2,h3,summary';
let SECTIONS=[], TOPICS=[];
const T=i=>TOPICS.find(t=>t.id===i);
function rebuildTopics(){
  const rows=S.getTopics()||[];
  TOPICS=rows.map(r=>({ id:r.slug, title:r.title, sec:r.section||"Без раздела", lesson:r.lesson||"",
    color:r.color||"#2fb3ad", agent:r.agent||"", lead:r.lead||"", facts:r.facts||[], cheat:r.cheat||[],
    test:r.test||[], cards:r.cards||[], content_html:r.content_html||"",
    updated_at:r.updated_at, updated_by:r.updated_by }));
  SECTIONS=[]; TOPICS.forEach(t=>{ if(!SECTIONS.includes(t.sec)) SECTIONS.push(t.sec); });
}

/* ---------- доступ к данным ----------
   Личные данные (выделения, заметки, прогресс) живут в Supabase через Store.
   В localStorage остаются только настройки вида: тема, свёрнутые блоки. ---------- */
const S=window.Store;
const UIKEYS=["theme","helpSeen","cheatOpen","testPref"];
function uiGet(k){ try{ return JSON.parse(localStorage.getItem("inf-ui:"+k)); }catch(e){ return null; } }
function uiSet(k,v){ try{ localStorage.setItem("inf-ui:"+k,JSON.stringify(v)); }catch(e){} }
function lsGet(k){ return UIKEYS.includes(k)? uiGet(k) : S.get(k); }
function lsSet(k,v){ if(UIKEYS.includes(k)) uiSet(k,v); else S.set(k,v); return true; }
function lsDel(k){ if(UIKEYS.includes(k)) { try{ localStorage.removeItem("inf-ui:"+k); }catch(e){} } else S.del(k); }
function lsKeys(){ return Object.keys(S.allState()); }
function save(k,v){ lsSet(k,v); }
function setStatus(m){
  const el=document.getElementById("status"); if(!el) return;
  const st=(typeof m==="object"&&m)?m:{status:m,msg:""};
  const map={saving:["сохраняю…","saving"],saved:["сохранено",""],loading:["загружаю…","saving"],
             offline:["офлайн","saving"],error:["не сохранилось","err"],idle:["",""]};
  const v=map[st.status]||map.saved;
  el.className="status "+(v[1]||"");
  el.innerHTML='<span class="dot"></span><span>'+v[0]+'</span>';
  el.title=st.msg||"";
  if(st.status==="error") el.onclick=()=>S.retry(); else el.onclick=null;
  const ob=document.getElementById("offlineBar");
  if(ob) ob.classList.toggle("show", st.status==="offline"||st.status==="error");
  if(ob) ob.textContent = st.status==="error"
    ? ("Не удалось сохранить: "+(st.msg||"ошибка")+". Нажми, чтобы повторить.")
    : "Нет связи. Правки сохранены на устройстве и уйдут в облако, когда сеть вернётся.";
  if(ob) ob.onclick=()=>S.retry();
}

/* ---------- тема оформления ---------- */
let theme=lsGet("theme")||"dark";
function applyTheme(t){ theme=t; document.documentElement.classList.toggle("light",t==="light"); lsSet("theme",t);
  $$("#themeBtn,#themeBtn2").forEach(b=>{ const u=b.querySelector("use"); if(u) u.setAttribute("href", t==="light"?"#i-moon":"#i-sun"); }); }

/* ---------- утилиты ---------- */
function hash(s){ let h=5381; for(let i=0;i<s.length;i++) h=((h<<5)+h+s.charCodeAt(i))|0; return (h>>>0).toString(36); }
function esc(s){ return s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function srcHTML(id){ const t=T(id); return (t&&t.content_html)?t.content_html:"<p class='empty'>Тема ещё не заполнена.</p>"; }
function srcText(id){ const d=document.createElement("div"); d.innerHTML=srcHTML(id); return d.textContent; }
function leafBlocks(root){ return [...root.querySelectorAll(BLOCK_SEL)].filter(el=>!el.querySelector(BLOCK_SEL)); }
function indexBlocks(root){ const b=leafBlocks(root); b.forEach((el,i)=>el.dataset.b=i); return b; }
function offsetIn(root,node,off){ let acc=0; const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT); let n;
  while(n=w.nextNode()){ if(n===node) return acc+off; acc+=n.nodeValue.length; }
  return Math.min(acc,off); }
function wrapRange(el,s,e,make){
  const pieces=[]; let acc=0; const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT); let n;
  while(n=w.nextNode()){ const len=n.nodeValue.length;
    if(acc+len>s && acc<e) pieces.push([n,Math.max(0,s-acc),Math.min(len,e-acc)]);
    acc+=len; }
  let done=false;
  pieces.forEach(([node,a,b])=>{ if(a>=b) return; let t=node;
    if(b<t.nodeValue.length) t.splitText(b);
    if(a>0) t=t.splitText(a);
    const w2=make(); t.parentNode.insertBefore(w2,t); w2.appendChild(t); done=true; });
  return done;
}
function unwrapEl(el){ const p=el.parentNode; while(el.firstChild) p.insertBefore(el.firstChild,el); p.removeChild(el); p.normalize(); }
function stripAnn(root){ [...root.querySelectorAll("mark.hl,span.big,span.cmt")].forEach(unwrapEl); }

/* ---------- состояние ---------- */
let current=null, mode="notes", editing=false, notesOpen=false, weakMode=false;
let blocks=[], anns=[], lostAnns=[], curCmt=null;
const article=$("#article"), pop=$("#pop"), bub=$("#bub");

/* ---------- аннотации ---------- */
function getAnn(id){ const a=lsGet("ann:"+id); return (a&&Array.isArray(a.items))?a.items:[]; }
function saveAnn(){ if(!current) return; save("ann:"+current,{v:hash(srcText(current)),items:anns}); }
function mkEl(a){
  if(a.t==="big"){ const s=document.createElement("span"); s.className="big"; return s; }
  if(a.t==="cmt"){ const s=document.createElement("span"); s.className="cmt"; s.dataset.note=a.n||""; s.title=a.n||""; s.dataset.ai=a._i; return s; }
  const m=document.createElement("mark"); m.className="hl hl-"+(a.c||"y"); return m;
}
function applyAnns(){
  lostAnns=[];
  anns.forEach((a,i)=>{
    a._i=i;
    let blk=blocks[a.b], s=a.s, e=a.e, ok=false;
    if(blk && blk.textContent.slice(s,e)===a.q) ok=true;
    if(!ok){
      let best=-1,bs=-1;
      for(let k=0;k<blocks.length;k++){ const p=blocks[k].textContent.indexOf(a.q);
        if(p>=0){ if(best<0||Math.abs(k-a.b)<Math.abs(best-a.b)){ best=k; bs=p; } } }
      if(best>=0){ blk=blocks[best]; s=bs; e=bs+a.q.length; a.b=best; a.s=s; a.e=e; ok=true; }
    }
    if(ok) ok=wrapRange(blk,s,e,()=>mkEl(a));
    if(!ok) lostAnns.push(a);
  });
  renderLost();
}
function renderLost(){
  const box=$("#lost"); const items=lostAnns.filter(a=>a.q&&a.q.trim());
  if(!items.length){ box.style.display="none"; return; }
  box.style.display="";
  box.innerHTML="<h4>Потерянные выделения ("+items.length+")</h4><p style='margin:0 0 6px'>Текст темы изменился, и эти фрагменты не нашлись:</p><ul>"+
    items.map(a=>"<li>"+esc(a.q.slice(0,90))+(a.n?" — <i>"+esc(a.n)+"</i>":"")+"</li>").join("")+
    "</ul><button class='btn sm' id='lostDrop' style='margin-top:8px'>Убрать из списка</button>";
  $("#lostDrop").onclick=()=>{ anns=anns.filter(a=>!items.includes(a)); saveAnn(); renderTopic(); };
}
function addAnn(type,color){
  const sel=getSelection(); if(!sel.rangeCount) return;
  const r=sel.getRangeAt(0); if(r.collapsed||!article.contains(r.commonAncestorContainer)) return;
  const touched=blocks.filter(b=>r.intersectsNode(b));
  let made=null;
  touched.forEach(b=>{
    const txt=b.textContent;
    let s=0,e=txt.length;
    if(b.contains(r.startContainer)||b===r.startContainer) s=offsetIn(b,r.startContainer,r.startOffset);
    if(b.contains(r.endContainer)||b===r.endContainer) e=offsetIn(b,r.endContainer,r.endOffset);
    s=Math.max(0,s); e=Math.min(txt.length,e);
    const q=txt.slice(s,e); if(!q.trim()) return;
    const a={b:+b.dataset.b,s:s,e:e,q:q,t:type,c:color||"y",n:""};
    anns.push(a); made=a;
  });
  if(!made) return;
  sel.removeAllRanges(); hidePop(); saveAnn(); renderTopic();
  if(type==="cmt"){ const el=[...article.querySelectorAll(".cmt")].find(x=>x.textContent===made.q); if(el) openBubble(el); }
}
function eraseSel(){
  const sel=getSelection(); if(!sel.rangeCount) return;
  const r=sel.getRangeAt(0); if(!article.contains(r.commonAncestorContainer)) return;
  const hit=[...article.querySelectorAll("mark.hl,span.big")].filter(m=>r.intersectsNode(m));
  const texts=hit.map(h=>h.textContent);
  anns=anns.filter(a=>!(a.t!=="cmt"&&texts.includes(a.q)));
  sel.removeAllRanges(); hidePop(); saveAnn(); renderTopic();
}
/* меню выделения */
function hidePop(){ pop.classList.remove("show"); }
function showPop(){
  if(mode!=="notes"||editing){ hidePop(); return; }
  const sel=getSelection();
  if(!sel.rangeCount||sel.isCollapsed){ hidePop(); return; }
  const r=sel.getRangeAt(0); if(!article.contains(r.commonAncestorContainer)){ hidePop(); return; }
  const rect=r.getBoundingClientRect(); if(!rect.width&&!rect.height){ hidePop(); return; }
  pop.classList.add("show");
  const pw=pop.offsetWidth, ph=pop.offsetHeight, vw=document.documentElement.clientWidth;
  let x=rect.left+rect.width/2-pw/2+scrollX, y=rect.top+scrollY-ph-10;
  if(rect.top<ph+80) y=rect.bottom+scrollY+10;
  if(innerWidth<=900 && rect.bottom>innerHeight-150) y=rect.top+scrollY-ph-10;
  x=Math.max(8+scrollX,Math.min(x,scrollX+vw-pw-8));
  pop.style.left=x+"px"; pop.style.top=y+"px";
}
let selT=null;
document.addEventListener("selectionchange",()=>{ clearTimeout(selT); selT=setTimeout(showPop,160); });
addEventListener("scroll",()=>{ if(pop.classList.contains("show")) showPop(); },{passive:true});
pop.addEventListener("mousedown",e=>e.preventDefault());
pop.addEventListener("pointerdown",e=>e.preventDefault());
pop.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
  const a=b.dataset.a;
  if(a==="erase") eraseSel();
  else if(a==="big") addAnn("big");
  else if(a==="cmt") addAnn("cmt");
  else addAnn("hl",a);
}));

/* ---------- комментарии ---------- */
function openBubble(span){
  curCmt=span; $("#bubTa").value=span.dataset.note||"";
  bub.classList.add("show");
  const r=span.getBoundingClientRect(), bw=bub.offsetWidth;
  let x=Math.max(8+scrollX,Math.min(r.left+scrollX,scrollX+document.documentElement.clientWidth-bw-8));
  let y=r.bottom+scrollY+8;
  if(r.bottom+bub.offsetHeight+20>innerHeight && r.top>bub.offsetHeight+20) y=r.top+scrollY-bub.offsetHeight-8;
  bub.style.left=x+"px"; bub.style.top=y+"px";
  setTimeout(()=>$("#bubTa").focus(),30);
}
function hideBub(){ bub.classList.remove("show"); curCmt=null; }
$("#bubSave").onclick=()=>{
  if(!curCmt) return; const v=$("#bubTa").value.trim(); const i=+curCmt.dataset.ai;
  if(!v) anns.splice(i,1); else anns[i].n=v;
  hideBub(); saveAnn(); renderTopic();
};
$("#bubDel").onclick=()=>{ if(!curCmt) return; anns.splice(+curCmt.dataset.ai,1); hideBub(); saveAnn(); renderTopic(); };
article.addEventListener("click",e=>{ const c=e.target.closest&&e.target.closest(".cmt"); if(c&&!editing){ e.preventDefault(); openBubble(c); } });
document.addEventListener("mousedown",e=>{ if(bub.classList.contains("show")&&!bub.contains(e.target)&&!(e.target.closest&&e.target.closest(".cmt"))) hideBub(); });

/* ---------- заметки ---------- */
$("#notesBtn").onclick=()=>toggleNotes();
function toggleNotes(){
  notesOpen=!notesOpen;
  $("#notes").classList.toggle("show",notesOpen);
  $("#notesBtn").classList.toggle("on",notesOpen);
  if(notesOpen){ refreshCmtList(); $("#noteEd").focus(); }
}
let nT=null;
$("#noteEd").addEventListener("input",()=>{ clearTimeout(nT); setStatus("saving"); nT=setTimeout(()=>{ if(current) save("note:"+current,$("#noteEd").innerHTML); },700); });
function refreshCmtList(){
  const box=$("#cmtList"); const items=[...article.querySelectorAll(".cmt")].filter(c=>(c.dataset.note||"").trim());
  box.innerHTML=""; box.classList.toggle("show",items.length>0);
  if(!items.length) return;
  const h=document.createElement("div"); h.className="nh"; h.style.marginBottom="6px";
  h.textContent="Комментарии в тексте ("+items.length+")"; box.appendChild(h);
  items.forEach(c=>{ const d=document.createElement("div"); d.className="ci";
    const b=document.createElement("b"); b.textContent=c.textContent.slice(0,46)+(c.textContent.length>46?"…":"");
    d.append(b,document.createTextNode(" — "+c.dataset.note));
    d.onclick=()=>{ c.scrollIntoView({behavior:"smooth",block:"center"}); setTimeout(()=>openBubble(c),420); };
    box.appendChild(d); });
}

/* ---------- правка текста ---------- */
let edT=null;
$("#editBtn").onclick=()=>{
  if(!current) return;
  if(!S.canEdit()){ toast("У тебя доступ только на чтение. Попроси владельца дать роль «редактор»."); return; }
  if(!Editor.isActive()){
    editing=true; hidePop(); hideBub();
    [...article.querySelectorAll("mark.hl,span.big,span.cmt")].forEach(el=>{
      const p=el.parentNode; while(el.firstChild) p.insertBefore(el.firstChild,el); p.removeChild(el); });
    $("#editBtn").classList.add("on");
    Editor.start(article,html=>{ clearTimeout(edT); edT=setTimeout(()=>{ S.saveTopic(current,{content_html:html}); },1000); });
  } else {
    const html=Editor.stop();
    editing=false; $("#editBtn").classList.remove("on");
    clearTimeout(edT); S.saveTopic(current,{content_html:html});
    renderTopic();
  }
};
addEventListener("editor:done",()=>{ if(Editor.isActive()) $("#editBtn").click(); });
$("#ansBtn").onclick=()=>{
  const ds=$$("#article details.ans"), closed=ds.some(d=>!d.open);
  ds.forEach(d=>d.open=closed); $("#ansBtn").classList.toggle("on",closed);
};

/* ---------- рендер темы ---------- */
function renderHero(t){
  const h=$("#hero"); h.innerHTML="";
  const m=document.createElement("div"); m.className="main-col";
  const k=document.createElement("div"); k.className="kicker"; k.textContent=t.sec+(t.lesson?" · "+t.lesson:"");
  const h1=document.createElement("h1"); h1.textContent=t.title;
  const ag=document.createElement("p"); ag.className="agent"; ag.textContent=t.agent;
  const ld=document.createElement("p"); ld.className="lead"; ld.textContent=t.lead;
  m.append(k,h1,ag,ld);
  const f=document.createElement("div"); f.className="facts";
  (t.facts||[]).forEach(([l,v])=>{ const d=document.createElement("div"); d.className="fact";
    const a=document.createElement("div"); a.className="fl"; a.textContent=l;
    const b=document.createElement("div"); b.className="fv"; b.textContent=v;
    d.append(a,b); f.appendChild(d); });
  h.append(m,f);
}
function renderCheat(t){
  const c=$("#cheat"); c.innerHTML="";
  if(!t.cheat||!t.cheat.length){ c.style.display="none"; return; }
  c.style.display="";
  const s=document.createElement("summary");
  s.innerHTML='<svg class="ic sm"><use href="#i-bolt"/></svg>Шпаргалка за 1 минуту';
  const ul=document.createElement("ul");
  t.cheat.forEach(x=>{ const li=document.createElement("li"); li.innerHTML=x; ul.appendChild(li); });
  c.append(s,ul);
  c.open = lsGet("cheatOpen")!==0;
  c.addEventListener("toggle",()=>lsSet("cheatOpen",c.open?1:0));
}
function renderTopic(){
  if(!current) return;
  if(Editor.isActive()) return;
  article.innerHTML = srcHTML(current);
  blocks=indexBlocks(article);
  anns=getAnn(current);
  applyAnns();
  renderTOC(); refreshCmtList(); renderMeta();
}
function renderTOC(){
  const toc=$("#toc"), hs=$$("#article h2[id]");
  toc.innerHTML="";
  if(!hs.length) return;
  const ti=document.createElement("div"); ti.className="toc-title"; ti.textContent="Разделы"; toc.appendChild(ti);
  hs.forEach(h=>{ const a=document.createElement("a"); a.href="#"; a.dataset.h=h.id; a.textContent=h.textContent;
    a.onclick=e=>{ e.preventDefault(); h.scrollIntoView({behavior:"smooth"}); $("#side").classList.remove("open"); };
    toc.appendChild(a); });
}
async function openTopic(id){
  current=id; weakMode=false;
  const t=T(id);
  document.documentElement.style.setProperty("--accent",t.color);
  renderHero(t); renderCheat(t); renderTopic();
  $("#noteEd").innerHTML = lsGet("note:"+id)||"";
  renderTopicList();
  setStatus("saved"); hideBub();
}
function renderTopicList(){
  const ul=$("#topicList"); ul.innerHTML="";
  SECTIONS.forEach(sec=>{
    const list=TOPICS.filter(t=>t.sec===sec); if(!list.length) return;
    const g=document.createElement("li"); g.className="gl"; g.textContent=sec; ul.appendChild(g);
    list.forEach(t=>{ const li=document.createElement("li"); const b=document.createElement("button");
      b.className="topic-btn"+(t.id===current?" active":""); b.style.setProperty("--c",t.color);
      b.innerHTML='<span class="dot"></span><span></span>'; b.lastChild.textContent=t.title;
      b.onclick=()=>{ location.hash=t.id+"/"+mode; $("#side").classList.remove("open"); };
      li.appendChild(b); ul.appendChild(li); });
  });
}


/* ============================ РЕЖИМЫ ============================ */
function setMode(m){
  mode=m;
  $$(".mode").forEach(b=>b.classList.toggle("on",b.dataset.m===m));
  article.style.display = m==="notes"?"":"none";
  $("#cheat").style.display = (m==="notes"&&T(current)&&T(current).cheat&&T(current).cheat.length)?"":"none";
  $("#lost").style.display = (m==="notes"&&lostAnns.length)?"":"none";
  $("#test").style.display = m==="test"?"":"none";
  $("#cards").style.display = m==="cards"?"":"none";
  $("#tools").style.display = m==="notes"?"":"none";
  $("#toc").style.display = m==="notes"?"":"none";
  $("#notes").classList.toggle("show", m==="notes"&&notesOpen);
  $("#readbar").style.width="0%";
  if(m!=="notes") hidePop(), hideBub();
  if(m==="test") startTest();
  if(m==="cards") startCards();
  if(current) save("last:"+current,{mode:m});
  scrollTo(0,0);
}
$$(".mode").forEach(b=>b.onclick=()=>{ location.hash=(weakMode?"weak":current)+"/"+b.dataset.m; });

/* ============================ ТЕСТ ============================ */
let tst=null;
function testKey(){ return "test:"+(weakMode?"weak":current); }
function questionsFor(){
  if(weakMode){ const w=lsGet("weak")||{}; const out=[];
    Object.keys(w).forEach(tid=>{ const t=T(tid); if(!t) return; (w[tid]||[]).forEach(qi=>{ if(t.test[qi]) out.push({t:tid,qi:qi,q:t.test[qi]}); }); });
    return out; }
  const t=T(current); return (t.test||[]).map((q,i)=>({t:current,qi:i,q:q}));
}
function startTest(resume){
  const all=questionsFor();
  const box=$("#test"); box.innerHTML="";
  if(!all.length){ box.innerHTML="<p class='empty'>"+(weakMode?"Слабых вопросов пока нет — ошибись в тесте, и они появятся здесь.":"Тест для этой темы пока не добавлен.")+"</p>"; return; }
  const saved=lsGet(testKey());
  if(resume!==false && saved && saved.list && saved.list.length && saved.i<saved.list.length){ tst=saved; drawQ(); return; }
  tst=null; drawSetup(all.length,saved);
}
function drawSetup(total,saved){
  const box=$("#test"); box.innerHTML="";
  const s=document.createElement("div"); s.className="setup";
  const pref=lsGet("testPref")||{size:0,shuffleQ:true};
  s.innerHTML="<h3>"+(weakMode?"Слабые вопросы":"Тест по теме")+"</h3><p>Всего вопросов: "+total+". Варианты ответов перемешиваются при каждом показе.</p>";
  const r1=document.createElement("div"); r1.className="srow";
  r1.innerHTML="<span class='lbl'>Сколько вопросов</span>";
  const sizes=[["10",10],["20",20],["Все",0]];
  sizes.forEach(([l,v])=>{ if(v&&v>total) return; const b=document.createElement("button");
    b.className="btn sm"+(pref.size===v?" on":""); b.textContent=l;
    b.onclick=()=>{ pref.size=v; lsSet("testPref",pref); drawSetup(total,saved); }; r1.appendChild(b); });
  const r2=document.createElement("div"); r2.className="srow";
  r2.innerHTML="<span class='lbl'>Порядок вопросов</span>";
  const sh=document.createElement("button"); sh.className="btn sm"+(pref.shuffleQ?" on":"");
  sh.innerHTML='<svg class="ic sm"><use href="#i-shuffle"/></svg>Перемешать';
  sh.onclick=()=>{ pref.shuffleQ=!pref.shuffleQ; lsSet("testPref",pref); drawSetup(total,saved); };
  const ord=document.createElement("button"); ord.className="btn sm"+(pref.shuffleQ?"":" on"); ord.textContent="По порядку";
  ord.onclick=()=>{ pref.shuffleQ=false; lsSet("testPref",pref); drawSetup(total,saved); };
  r2.append(sh,ord);
  const r3=document.createElement("div"); r3.className="srow"; r3.style.marginTop="16px";
  const go=document.createElement("button"); go.className="btn on";
  go.innerHTML='<svg class="ic sm"><use href="#i-play"/></svg>Начать';
  go.onclick=()=>newRun(pref);
  r3.appendChild(go);
  if(saved&&saved.list&&saved.i>0&&saved.i<saved.list.length){
    const cont=document.createElement("button"); cont.className="btn";
    cont.textContent="Продолжить ("+(saved.i+1)+"/"+saved.list.length+")";
    cont.onclick=()=>{ tst=saved; drawQ(); }; r3.appendChild(cont);
  }
  const best=lsGet("best:"+(weakMode?"weak":current));
  if(best){ const b=document.createElement("span"); b.style.cssText="font-size:13px;color:var(--muted);margin-left:6px";
    b.textContent="лучший результат "+best.c+" из "+best.n; r3.appendChild(b); }
  s.append(r1,r2,r3); box.appendChild(s);
}
function newRun(pref){
  let all=questionsFor();
  if(pref.shuffleQ) all=shuffle(all);
  if(pref.size) all=all.slice(0,pref.size);
  tst={ list:all.map(x=>({t:x.t,qi:x.qi,perm:shuffle([0,1,2,3])})), i:0, ans:{}, full:(!pref.size||pref.size>=questionsFor().length) };
  save(testKey(),tst); drawQ();
}
function qOf(item){ return T(item.t).test[item.qi]; }
function drawQ(){
  const box=$("#test"); box.innerHTML="";
  if(!tst||tst.i>=tst.list.length){ drawResult(); return; }
  const item=tst.list[tst.i], q=qOf(item), perm=item.perm;
  const answered=tst.ans[tst.i]!==undefined;

  const top=document.createElement("div"); top.className="tq-top";
  const right=Object.keys(tst.ans).filter(k=>tst.ans[k]===qOf(tst.list[k]).a).length;
  top.innerHTML="<span>Вопрос "+(tst.i+1)+" из "+tst.list.length+(weakMode?" · слабые":"")+"</span>"+
    "<span>"+(Object.keys(tst.ans).length?("верно "+right+" из "+Object.keys(tst.ans).length):"")+"</span>";
  const pr=document.createElement("div"); pr.className="bar"; pr.style.setProperty("--c","var(--accent)");
  pr.innerHTML="<i style='width:"+(tst.i/tst.list.length*100)+"%'></i>";
  box.append(top,pr);

  const d=document.createElement("div"); d.className="qbox";
  if(weakMode){ const tl=document.createElement("div"); tl.className="tq-top"; tl.style.marginBottom="4px";
    tl.innerHTML="<span style='color:var(--accent-ink)'>"+esc(T(item.t).title)+"</span>"; d.appendChild(tl); }
  const qt=document.createElement("div"); qt.className="qt"; qt.textContent=q.q; d.appendChild(qt);
  const opts=[];
  perm.forEach((orig,pos)=>{
    const b=document.createElement("button"); b.className="opt";
    b.innerHTML="<span class='num'>"+(pos+1)+"</span><span></span>";
    b.lastChild.textContent=q.o[orig];
    b.onclick=()=>{ if(tst.ans[tst.i]!==undefined) return; pick(orig); };
    opts.push([b,orig]); d.appendChild(b);
  });
  const vd=document.createElement("div"); vd.className="verdict";
  const ex=document.createElement("div"); ex.className="expl";
  ex.innerHTML="<b>Ответ:</b> "+esc(q.o[q.a])+". "+esc(q.e||"");
  d.append(vd,ex); box.appendChild(d);

  const nav=document.createElement("div"); nav.className="tnav";
  const next=document.createElement("button"); next.className="btn on"; next.id="tNext";
  next.innerHTML=(tst.i===tst.list.length-1?"Показать результат":"Дальше")+'<svg class="ic sm"><use href="#i-arrow"/></svg>';
  next.style.display="none";
  next.onclick=()=>{ tst.i++; save(testKey(),tst); drawQ(); scrollTo({top:0,behavior:"smooth"}); };
  const skip=document.createElement("button"); skip.className="btn"; skip.id="tSkip"; skip.textContent="Пропустить";
  skip.onclick=()=>{ tst.i++; save(testKey(),tst); drawQ(); scrollTo({top:0,behavior:"smooth"}); };
  const re=document.createElement("button"); re.className="btn"; re.textContent="Заново";
  re.onclick=()=>{ lsDel(testKey()); startTest(false); };
  const hint=document.createElement("span"); hint.className="hint"; hint.textContent="1–4 — выбрать, Enter — дальше";
  nav.append(next,skip,re,hint); box.appendChild(nav);

  function pick(orig){
    tst.ans[tst.i]=orig;
    const w=lsGet("weak")||{};
    if(orig!==q.a){ w[item.t]=w[item.t]||[]; if(!w[item.t].includes(item.qi)) w[item.t].push(item.qi); }
    else if(w[item.t]){ w[item.t]=w[item.t].filter(x=>x!==item.qi); if(!w[item.t].length) delete w[item.t]; }
    save("weak",w); save(testKey(),tst); reveal();
  }
  function reveal(){
    const a=tst.ans[tst.i];
    opts.forEach(([b,orig])=>{ if(orig===q.a) b.classList.add("right"); else if(orig===a) b.classList.add("wrong"); });
    const ok=a===q.a;
    vd.className="verdict show "+(ok?"ok":"no");
    vd.innerHTML='<svg class="ic sm"><use href="'+(ok?"#i-check":"#i-x")+'"/></svg>'+(ok?"Верно":"Неверно");
    ex.classList.add("show"); next.style.display=""; skip.style.display="none";
  }
  if(answered) reveal();
}
function drawResult(){
  const box=$("#test"); box.innerHTML="";
  const n=tst.list.length, c=tst.list.filter((it,i)=>tst.ans[i]===qOf(it).a).length;
  const pct=Math.round(c/n*100);
  const r=document.createElement("div"); r.className="res";
  r.innerHTML="<div class='big-n'>"+pct+"%</div><h3>Верно "+c+" из "+n+"</h3><p>"+
    (pct>=90?"Отличный результат.":pct>=70?"Хорошо, но есть что повторить.":pct>=50?"Половина — стоит перечитать конспект.":"Лучше вернуться к конспекту и пройти ещё раз.")+"</p>";
  const acts=document.createElement("div"); acts.className="acts";
  const again=document.createElement("button"); again.className="btn on"; again.textContent="Пройти заново";
  again.onclick=()=>{ lsDel(testKey()); startTest(false); scrollTo(0,0); };
  acts.appendChild(again);
  const wrong=tst.list.filter((it,i)=>tst.ans[i]!==qOf(it).a);
  if(wrong.length){ const w=document.createElement("button"); w.className="btn"; w.textContent="Только ошибки ("+wrong.length+")";
    w.onclick=()=>{ tst={list:wrong.map(x=>({t:x.t,qi:x.qi,perm:shuffle([0,1,2,3])})),i:0,ans:{},full:false}; save(testKey(),tst); drawQ(); scrollTo(0,0); };
    acts.appendChild(w); }
  if(!weakMode){ const n2=document.createElement("button"); n2.className="btn"; n2.textContent="К конспекту";
    n2.onclick=()=>{ location.hash=current+"/notes"; }; acts.appendChild(n2); }
  r.appendChild(acts);
  if(tst.full){ const key="best:"+(weakMode?"weak":current); const b=lsGet(key);
    if(!b||c/n>b.c/b.n) save(key,{c:c,n:n}); }
  if(wrong.length){
    const wr=document.createElement("div"); wr.className="wrongs";
    wr.innerHTML="<h4>Разбор ошибок</h4>";
    tst.list.forEach((it,i)=>{ const q=qOf(it); if(tst.ans[i]===q.a) return;
      const d=document.createElement("div"); d.className="wi";
      d.innerHTML="<div class='wq'>"+esc(q.q)+"</div><div class='wa'>Верно: "+esc(q.o[q.a])+"</div>"+
        "<div class='wy'>"+(tst.ans[i]===undefined?"Пропущен":"Твой ответ: "+esc(q.o[tst.ans[i]]))+"</div>"+
        "<div style='margin-top:5px;font-size:13.5px;color:var(--dim)'>"+esc(q.e||"")+"</div>";
      wr.appendChild(d); });
    r.appendChild(wr);
  }
  lsDel(testKey());
  box.appendChild(r);
}

/* ============================ КАРТОЧКИ (Лейтнер) ============================ */
const BOX_DAYS={1:0,2:1,3:3,4:7,5:21}, DAY=864e5;
function cardState(id){ return lsGet("cards:"+id)||{}; }
function cardsDue(id){
  const t=T(id); if(!t||!t.cards) return 0; const st=cardState(id); const now=Date.now();
  return t.cards.filter((c,i)=>{ const s=st[i]; return !s || (s.due||0)<=now; }).length;
}
function cardsLearned(id){ const st=cardState(id); return Object.values(st).filter(s=>s.box>=4).length; }
let deck=null;
function startCards(){
  const t=T(current); const st=cardState(current); const now=Date.now();
  const due=[]; (t.cards||[]).forEach((c,i)=>{ const s=st[i]; if(!s||(s.due||0)<=now) due.push(i); });
  deck={ queue:shuffle(due), i:0, flip:false, st:st, done:0 };
  drawCards();
}
function drawCards(){
  const box=$("#cards"); box.innerHTML="";
  const t=T(current); const total=(t.cards||[]).length;
  if(!total){ box.innerHTML="<p class='empty'>Карточки для этой темы пока не добавлены.</p>"; return; }
  const d=document.createElement("div"); d.className="deck";
  if(deck.i>=deck.queue.length){
    const learned=cardsLearned(current);
    d.innerHTML="<div class='done'><h3>На сегодня всё</h3><p>Повторено карточек: "+deck.done+". Выучено "+learned+" из "+total+".</p></div>";
    const acts=document.createElement("div"); acts.className="acts"; acts.style.justifyContent="center";
    const all=document.createElement("button"); all.className="btn on"; all.textContent="Пройти всю колоду";
    all.onclick=()=>{ deck={queue:shuffle([...Array(total).keys()]),i:0,flip:false,st:cardState(current),done:0}; drawCards(); };
    const rs=document.createElement("button"); rs.className="btn"; rs.textContent="Сбросить прогресс";
    rs.onclick=()=>confirmDlg("Сбросить карточки?","Все коробки этой темы вернутся к первой.",()=>{ lsDel("cards:"+current); save("cards:"+current,{}); startCards(); });
    acts.append(all,rs); d.querySelector(".done").appendChild(acts);
    box.appendChild(d); return;
  }
  const idx=deck.queue[deck.i], c=t.cards[idx], s=deck.st[idx]||{box:1};
  const bx=document.createElement("div"); bx.className="boxes";
  for(let i=1;i<=5;i++){ const b=document.createElement("div"); b.className="bx"+(i<=(s.box||1)?" f":""); bx.appendChild(b); }
  const pt=document.createElement("div"); pt.className="prog-t";
  pt.textContent="Коробка "+(s.box||1)+" из 5 · осталось сегодня "+(deck.queue.length-deck.i)+" · выучено "+cardsLearned(current)+" из "+total;
  const fc=document.createElement("div"); fc.className="fc";
  const fci=document.createElement("div"); fci.className="fci"+(deck.flip?" flip":"");
  const f=document.createElement("div"); f.className="fcf";
  f.innerHTML="<div class='fc-h'>Вопрос</div>"; const fq=document.createElement("div"); fq.textContent=c.q; f.appendChild(fq);
  const bk=document.createElement("div"); bk.className="fcb";
  bk.innerHTML="<div class='fc-h'>Ответ</div><div>"+c.a+"</div>";
  fci.append(f,bk); fc.appendChild(fci);
  const sync=()=>{ fci.classList.toggle("flip",deck.flip); const sb=$("#showBtn"); if(sb) sb.textContent=deck.flip?"Скрыть ответ":"Показать ответ"; };
  fci.onclick=()=>{ deck.flip=!deck.flip; sync(); };
  const acts=document.createElement("div"); acts.className="fc-acts";
  const show=document.createElement("button"); show.className="btn"; show.id="showBtn"; show.textContent=deck.flip?"Скрыть ответ":"Показать ответ";
  show.onclick=()=>{ deck.flip=!deck.flip; sync(); };
  const again=document.createElement("button"); again.className="btn again"; again.innerHTML="← Повторить";
  again.onclick=()=>grade(idx,false);
  const know=document.createElement("button"); know.className="btn know"; know.innerHTML="Знаю →";
  know.onclick=()=>grade(idx,true);
  acts.append(again,show,know);
  const hint=document.createElement("div"); hint.className="prog-t"; hint.style.marginTop="12px";
  hint.textContent="Пробел — перевернуть · ← повторить · → знаю";
  d.append(bx,pt,fc,acts,hint); box.appendChild(d);
}
function grade(idx,ok){
  const st=deck.st, cur=st[idx]||{box:1};
  let box=ok?Math.min(5,(cur.box||1)+1):1;
  st[idx]={box:box,due:Date.now()+BOX_DAYS[box]*DAY};
  save("cards:"+current,st);
  deck.done++;
  if(!ok) deck.queue.push(idx);
  deck.i++; deck.flip=false; drawCards();
}

/* ============================ ПОИСК ============================ */
let sIdx=null, sCur=0, sHits=[];
function buildIndex(){
  if(sIdx) return sIdx; sIdx=[];
  TOPICS.forEach(t=>{ const d=document.createElement("div"); d.innerHTML=srcHTML(t.id);
    let head="";
    [...d.querySelectorAll(BLOCK_SEL+",h2")].forEach(el=>{
      if(el.tagName==="H2"){ head=el.textContent; return; }
      if(el.querySelector(BLOCK_SEL)) return;
      const tx=el.textContent.trim(); if(tx.length<12) return;
      sIdx.push({t:t.id,head:head,text:tx});
    });
  });
  return sIdx;
}
function openSearch(){ $("#searchOv").classList.add("show"); $("#sInput").value=""; $("#sRes").innerHTML=""; setTimeout(()=>$("#sInput").focus(),30); }
function closeSearch(){ $("#searchOv").classList.remove("show"); }
function doSearch(q){
  const res=$("#sRes"); res.innerHTML=""; sHits=[]; sCur=0;
  q=q.trim().toLowerCase(); if(q.length<2) return;
  const idx=buildIndex();
  for(const it of idx){ const p=it.text.toLowerCase().indexOf(q); if(p<0) continue;
    sHits.push({...it,p:p}); if(sHits.length>=40) break; }
  sHits.forEach((h,i)=>{
    const d=document.createElement("div"); d.className="sr-item"+(i===0?" cur":"");
    const a=Math.max(0,h.p-60), b=Math.min(h.text.length,h.p+q.length+90);
    const frag=(a>0?"…":"")+h.text.slice(a,h.p)+"<mark>"+esc(h.text.substr(h.p,q.length))+"</mark>"+h.text.slice(h.p+q.length,b)+(b<h.text.length?"…":"");
    d.innerHTML="<div class='st'>"+esc(T(h.t).title)+(h.head?" · "+esc(h.head):"")+"</div><div class='sx'>"+frag+"</div>";
    d.onclick=()=>goHit(h); res.appendChild(d);
  });
  if(!sHits.length) res.innerHTML="<div class='sr-item'><div class='sx'>Ничего не нашлось</div></div>";
}
function goHit(h){
  closeSearch();
  const need=h.t!==current;
  location.hash=h.t+"/notes";
  setTimeout(()=>{
    const el=blocks.find(b=>b.textContent.trim().startsWith(h.text.slice(0,40)))||blocks.find(b=>b.textContent.includes(h.text.slice(0,40)));
    if(el){ el.scrollIntoView({behavior:"smooth",block:"center"}); el.classList.add("flash"); setTimeout(()=>el.classList.remove("flash"),1700); }
  }, need?420:120);
}
$("#sInput").addEventListener("input",e=>doSearch(e.target.value));
$("#sClose").onclick=closeSearch;
$("#searchOv").addEventListener("mousedown",e=>{ if(e.target.id==="searchOv") closeSearch(); });
$("#sInput").addEventListener("keydown",e=>{
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){ e.preventDefault();
    const items=$$("#sRes .sr-item"); if(!items.length) return;
    items[sCur]&&items[sCur].classList.remove("cur");
    sCur=(sCur+(e.key==="ArrowDown"?1:-1)+items.length)%items.length;
    items[sCur].classList.add("cur"); items[sCur].scrollIntoView({block:"nearest"});
  }
  if(e.key==="Enter"&&sHits[sCur]) goHit(sHits[sCur]);
});
$("#searchBtn").onclick=openSearch; $("#searchBtn2").onclick=openSearch;

/* ============================ ДАННЫЕ ============================ */
function exportData(){ const o={}; lsKeys().forEach(k=>{ o[k]=lsGet(k); }); return JSON.stringify({app:"inf-notes",v:3,data:o},null,1); }
$("#dataBtn").onclick=()=>{ $("#dataTa").value=exportData(); $("#dataOv").classList.add("show"); };
$("#dataClose").onclick=()=>$("#dataOv").classList.remove("show");
$("#dataCopy").onclick=async()=>{ try{ await navigator.clipboard.writeText($("#dataTa").value); $("#dataCopy").textContent="Скопировано"; setTimeout(()=>$("#dataCopy").textContent="Скопировать",1500);}catch(e){ $("#dataTa").select(); } };
$("#dataLoad").onclick=()=>{
  let o; try{ o=JSON.parse($("#dataTa").value); }catch(e){ alertBox("Не получилось прочитать JSON"); return; }
  if(!o||!o.data){ alertBox("В тексте нет поля data"); return; }
  confirmDlg("Заменить мои данные?","Текущие выделения, заметки и прогресс будут перезаписаны.",()=>{
    Object.keys(o.data).forEach(k=>lsSet(k,o.data[k]));
    $("#dataOv").classList.remove("show"); location.reload();
  });
};
function alertBox(t){ confirmDlg("Ошибка",t,null); }
let cfCb=null;
function confirmDlg(title,text,cb){ $("#cfTitle").textContent=title; $("#cfText").textContent=text; cfCb=cb;
  $("#cfYes").style.display=cb?"":"none"; $("#cfNo").textContent=cb?"Отмена":"Закрыть"; $("#confirmOv").classList.add("show"); }
$("#cfNo").onclick=()=>$("#confirmOv").classList.remove("show");
$("#cfYes").onclick=()=>{ $("#confirmOv").classList.remove("show"); if(cfCb) cfCb(); };

/* ============================ ГЛАВНАЯ ============================ */
let filter="all";
function renderHome(){
  const f=$("#filters"); f.innerHTML="";
  [["all","Все темы"],...SECTIONS.map(s=>[s,s])].forEach(([v,l])=>{
    const b=document.createElement("button"); b.className="chip"+(filter===v?" on":""); b.textContent=l;
    b.onclick=()=>{ filter=v; renderHome(); }; f.appendChild(b);
  });
  const w=lsGet("weak")||{}; const wn=Object.values(w).reduce((a,b)=>a+b.length,0);
  const wh=$("#weakHome"); wh.innerHTML="";
  if(wn){ const d=document.createElement("div"); d.className="tcard"; d.style.setProperty("--c","var(--warn)");
    d.innerHTML="<h3>Слабые вопросы</h3><p class='ag'>Вопросы, где ты ошибалась — из всех тем</p>";
    const a=document.createElement("div"); a.className="acts";
    const b=document.createElement("button"); b.className="btn on"; b.textContent="Повторить "+wn+" вопрос"+(wn%10===1&&wn%100!==11?"":"ов");
    b.onclick=()=>{ location.hash="weak/test"; };
    const c=document.createElement("button"); c.className="btn"; c.textContent="Очистить";
    c.onclick=()=>confirmDlg("Очистить слабые вопросы?","Список ошибок будет сброшен.",()=>{ save("weak",{}); renderHome(); });
    a.append(b,c); d.appendChild(a); wh.appendChild(d); }
  const box=$("#homeSections"); box.innerHTML="";
  SECTIONS.forEach(sec=>{
    if(filter!=="all"&&filter!==sec) return;
    const list=TOPICS.filter(t=>t.sec===sec); if(!list.length) return;
    const h=document.createElement("p"); h.className="sec-t"; h.textContent=sec; box.appendChild(h);
    const cards=document.createElement("div"); cards.className="cards";
    list.forEach(t=>{
      const d=document.createElement("div"); d.className="tcard"; d.style.setProperty("--c",t.color);
      const read=lsGet("read:"+t.id)||0, best=lsGet("best:"+t.id), due=cardsDue(t.id), learned=cardsLearned(t.id);
      d.innerHTML="<h3>"+esc(t.title)+"</h3><p class='ag'>"+esc(t.agent)+"</p>";
      const st=document.createElement("div"); st.className="tstats";
      st.innerHTML="<span>прочитано <b>"+read+"%</b></span>"+
        "<span>тест <b>"+(best?Math.round(best.c/best.n*100)+"%":"—")+"</b></span>"+
        "<span>карточки <b>"+learned+"/"+t.cards.length+"</b></span>"+
        (due?"<span style='color:var(--warn)'>на повтор <b style='color:var(--warn)'>"+due+"</b></span>":"");
      const bar=document.createElement("div"); bar.className="bar"; bar.innerHTML="<i style='width:"+read+"%'></i>";
      const acts=document.createElement("div"); acts.className="acts";
      const last=lsGet("last:"+t.id);
      if(last&&(read>2||last.mode!=="notes")){
        const c=document.createElement("button"); c.className="btn on";
        c.innerHTML='<svg class="ic sm"><use href="#i-play"/></svg>Продолжить';
        c.onclick=()=>{ location.hash=t.id+"/"+(last.mode||"notes"); }; acts.appendChild(c);
      }
      [["notes","Конспект","i-book"],["test","Тест","i-quiz"],["cards","Карточки","i-cards"]].forEach(([m,l,ic])=>{
        const b=document.createElement("button"); b.className="btn"+(!acts.children.length&&m==="notes"?" on":"");
        b.innerHTML='<svg class="ic sm"><use href="#'+ic+'"/></svg>'+l;
        b.onclick=()=>{ location.hash=t.id+"/"+m; }; acts.appendChild(b);
      });
      d.append(st,bar,acts); cards.appendChild(d);
    });
    box.appendChild(cards);
  });
}

/* ============================ НАВИГАЦИЯ ============================ */
function parseHash(){
  const h=location.hash.replace(/^#/,""); if(!h) return null;
  const [id,m]=h.split("/");
  if(id==="weak") return {id:"weak",mode:"test"};
  if(!TOPICS.some(t=>t.id===id)) return null;
  return {id:id,mode:["notes","test","cards"].includes(m)?m:"notes"};
}
async function route(){
  const r=parseHash();
  hidePop(); hideBub();
  if(!r){ current=null; weakMode=false; $("#app").classList.remove("on"); $("#home").style.display="block"; renderHome(); scrollTo(0,0); return; }
  $("#home").style.display="none"; $("#app").classList.add("on");
  if(r.id==="weak"){
    weakMode=true; current=null;
    document.documentElement.style.setProperty("--accent","#d6973c");
    $("#hero").innerHTML="<div class='main-col'><div class='kicker'>Повторение</div><h1>Слабые вопросы</h1><p class='lead'>Вопросы из всех тем, где был неверный ответ. Ответишь правильно — вопрос уходит из списка.</p></div>";
    $("#cheat").style.display="none"; $("#lost").style.display="none";
    renderTopicList(); setMode("test"); return;
  }
  if(r.id!==current||weakMode) await openTopic(r.id);
  setMode(r.mode);
}
addEventListener("hashchange",route);
$("#sideHome").onclick=()=>{ location.hash=""; $("#side").classList.remove("open"); };
$("#menuBtn").onclick=()=>$("#side").classList.toggle("open");
$("#themeBtn").onclick=()=>applyTheme(theme==="light"?"dark":"light");
$("#themeBtn2").onclick=()=>applyTheme(theme==="light"?"dark":"light");
$("#moreBtn").onclick=()=>$("#sheet").classList.toggle("show");
$$("#sheet [data-sh]").forEach(b=>b.onclick=()=>{
  const a=b.dataset.sh; $("#sheet").classList.remove("show");
  if(a==="edit") $("#editBtn").click();
  if(a==="notes") toggleNotes();
  if(a==="ans") $("#ansBtn").click();
  if(a==="search") openSearch();
  if(a==="theme") applyTheme(theme==="light"?"dark":"light");
  if(a==="reset") resetTopic();
});
function resetTopic(){
  if(!current) return;
  confirmDlg("Убрать мои выделения в этой теме?","Выделения и комментарии этой темы удалятся. Текст конспекта и заметки останутся.",()=>{
    anns=[]; save("ann:"+current,{v:"",items:[]}); renderTopic();
  });
}
function restoreSeed(){
  if(!current||!window.SEED) return;
  const seed=SEED.TOPICS.find(t=>t.id===current); if(!seed) return;
  confirmDlg("Вернуть стартовый текст темы?","Текст конспекта вернётся к версии из методички. Правки, сделанные вами и коллегами, пропадут. Выделения и заметки останутся.",()=>{
    S.saveTopic(current,{content_html:seed.content_html}); renderTopic();
  });
}
function renderMeta(){
  const t=T(current); const el=document.getElementById("topicMeta"); if(!el||!t) return;
  if(!t.updated_at){ el.textContent=""; return; }
  const m=(S.getMembers()||[]).find(x=>x.user_id===t.updated_by);
  const d=new Date(t.updated_at);
  el.textContent="обновлено "+d.toLocaleDateString("ru-RU")+" "+d.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})+(m?" · "+m.email:"");
}
function toast(text){ confirmDlg("Подсказка",text,null); }

/* прогресс чтения, scroll-spy, наверх */
let spyT=null;
addEventListener("scroll",()=>{
  const bt=$("#backtop"); bt.classList.toggle("show",scrollY>500);
  if(mode!=="notes"||!current) return;
  clearTimeout(spyT); spyT=setTimeout(()=>{
    const rect=article.getBoundingClientRect(), top=rect.top+scrollY, h=article.offsetHeight;
    let pct=Math.round(((scrollY+innerHeight-top)/h)*100);
    pct=Math.max(0,Math.min(100,pct));
    $("#readbar").style.width=pct+"%";
    const prev=lsGet("read:"+current)||0;
    if(pct>prev+2) save("read:"+current,pct);
    let cur=null;
    $$("#article h2[id]").forEach(hh=>{ if(hh.getBoundingClientRect().top<120) cur=hh.id; });
    $$("#toc a").forEach(a=>a.classList.toggle("cur",a.dataset.h===cur));
  },80);
},{passive:true});
$("#backtop").onclick=()=>scrollTo({top:0,behavior:"smooth"});

/* горячие клавиши */
addEventListener("keydown",e=>{
  const tag=(e.target.tagName||"").toLowerCase();
  const typing=tag==="input"||tag==="textarea"||e.target.isContentEditable;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){ e.preventDefault(); openSearch(); return; }
  if(e.key==="Escape"){ closeSearch(); $("#dataOv").classList.remove("show"); $("#confirmOv").classList.remove("show"); hideBub(); hidePop(); return; }
  if(typing||!$("#app").classList.contains("on")) return;
  if(mode==="test"&&tst){
    if(["1","2","3","4"].includes(e.key)){ const b=$$("#test .opt")[+e.key-1]; if(b){ e.preventDefault(); b.click(); } }
    if(e.key==="Enter"){ const n=$("#tNext"); if(n&&n.style.display!=="none"){ e.preventDefault(); n.click(); } }
  }
  if(mode==="cards"&&deck){
    if(e.code==="Space"){ e.preventDefault(); const f=$(".fci"); if(f) f.click(); }
    if(e.key==="ArrowRight"){ const b=$(".fc-acts .know"); if(b){ e.preventDefault(); b.click(); } }
    if(e.key==="ArrowLeft"){ const b=$(".fc-acts .again"); if(b){ e.preventDefault(); b.click(); } }
  }
});

/* ============================ СТАРТ ============================ */
function bootApp(){
  rebuildTopics(); applyTheme(theme);
  if(lsGet("helpSeen")) $("#helpBox").open=false; else { $("#helpBox").open=true; lsSet("helpSeen",1); }
  renderHome(); route(); setStatus({status:"saved"});
}
window.bootApp=bootApp;
window.rebuildTopics=rebuildTopics;
window.renderHomeSafe=()=>{ try{ renderHome(); }catch(e){} };
window.reRoute=()=>{ try{ route(); }catch(e){} };
applyTheme(theme);
