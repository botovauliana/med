/* ============================================================
   store.js — слой данных.
   Источник истины — Supabase. localStorage используется только
   как кэш на время офлайна: при возврате сети всё досылается.
   ============================================================ */
window.Store = (function(){
  const CACHE = "inf-cache:";                 // префикс локального кэша
  const CLIENT_ID = (()=>{ let v=localStorage.getItem(CACHE+"client");
    if(!v){ v=Math.random().toString(36).slice(2)+Date.now().toString(36); localStorage.setItem(CACHE+"client",v);} return v; })();

  let sb=null, user=null, cfg=null;
  let topics=[], state={}, members=[], me=null, queue={}, flushT=null, status="idle", statusMsg="";
  const listeners={status:[],remote:[],auth:[],members:[]};

  function on(ev,fn){ (listeners[ev]||[]).push(fn); }
  function emit(ev,a){ (listeners[ev]||[]).forEach(f=>{ try{ f(a); }catch(e){} }); }
  function setStatus(s,msg){ status=s; statusMsg=msg||""; emit("status",{status:s,msg:statusMsg}); }

  function cGet(k){ try{ return JSON.parse(localStorage.getItem(CACHE+k)); }catch(e){ return null; } }
  function cSet(k,v){ try{ localStorage.setItem(CACHE+k,JSON.stringify(v)); }catch(e){} }
  function cDel(k){ try{ localStorage.removeItem(CACHE+k); }catch(e){} }

  /* ---------- конфигурация ---------- */
  async function loadConfig(){
    // 1) переменные окружения через serverless-функцию Vercel
    try{
      const r=await fetch("/api/config",{cache:"no-store"});
      if(r.ok){ const j=await r.json(); if(j && j.url && j.anonKey) return j; }
    }catch(e){}
    // 2) ручная настройка (локальная разработка или свой хостинг)
    const local=cGet("config");
    if(local && local.url && local.anonKey) return local;
    return null;
  }
  function saveLocalConfig(url,anonKey){ cSet("config",{url:url,anonKey:anonKey}); }

  /* ---------- запуск ---------- */
  async function init(){
    cfg=await loadConfig();
    if(!cfg) return {ok:false,reason:"no-config"};
    if(!window.supabase||!window.supabase.createClient) return {ok:false,reason:"no-lib"};
    sb=window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data}=await sb.auth.getSession();
    user=data && data.session ? data.session.user : null;
    sb.auth.onAuthStateChange((_e,s)=>{ const was=user&&user.id; user=s?s.user:null;
      if((user&&user.id)!==was) emit("auth",user); });
    addEventListener("online",flush);
    setInterval(flush,15000);
    return {ok:true};
  }
  function ready(){ return !!sb; }
  function currentUser(){ return user; }

  /* ---------- вход ---------- */
  async function signIn(email){
    const {error}=await sb.auth.signInWithOtp({email:email,options:{emailRedirectTo:location.origin+location.pathname}});
    if(error) throw error; return true;
  }
  async function signInPassword(email,password){
    const {error}=await sb.auth.signInWithPassword({email:email,password:password});
    if(error) throw error; return true;
  }
  async function signUpPassword(email,password){
    const {error}=await sb.auth.signUp({email:email,password:password,options:{emailRedirectTo:location.origin+location.pathname}});
    if(error) throw error; return true;
  }
  async function signOut(){ try{ await sb.auth.signOut(); }catch(e){} user=null; topics=[]; state={}; emit("auth",null); }

  /* ---------- загрузка данных ---------- */
  async function loadAll(){
    if(!user) return {topics:[],state:{}};
    setStatus("loading");
    // кэш показываем сразу, чтобы не ждать сеть
    const ct=cGet("topics:"+user.id), cs=cGet("state:"+user.id);
    if(ct) topics=ct; if(cs) state=cs;
    try{
      const t=await sb.from("topics").select("*").order("position",{ascending:true});
      if(t.error) throw t.error;
      const s=await sb.from("user_state").select("key,value");
      if(s.error) throw s.error;
      const m=await sb.from("members").select("user_id,email,role");
      topics=t.data||[];
      state={}; (s.data||[]).forEach(r=>{ state[r.key]=r.value; });
      members=m.error?[]:(m.data||[]);
      me=members.find(x=>x.user_id===user.id)||null;
      cSet("topics:"+user.id,topics); cSet("state:"+user.id,state);
      subscribe();
      setStatus("saved");
    }catch(e){ setStatus("offline","нет связи, показываю сохранённую копию"); }
    return {topics:topics,state:state};
  }
  function getTopics(){ return topics; }
  function getTopic(id){ return topics.find(t=>t.slug===id); }

  /* ---------- пользовательское состояние (ключ → значение) ---------- */
  function get(key){ return state[key]!==undefined?state[key]:null; }
  function set(key,val){
    state[key]=val;
    if(user) cSet("state:"+user.id,state);
    queue["state:"+key]={kind:"state",key:key,value:val};
    scheduleFlush();
  }
  function del(key){
    delete state[key];
    if(user) cSet("state:"+user.id,state);
    queue["state:"+key]={kind:"state-del",key:key};
    scheduleFlush();
  }
  function allState(){ return state; }

  /* ---------- темы ---------- */
  function saveTopic(slug,patch){
    const t=getTopic(slug); if(!t) return;
    Object.assign(t,patch); t.updated_at=new Date().toISOString();
    if(user) cSet("topics:"+user.id,topics);
    queue["topic:"+slug]={kind:"topic",slug:slug,patch:patch};
    scheduleFlush();
  }
  async function seedTopics(seed){
    if(!user) throw new Error("нет входа");
    const rows=seed.TOPICS.map((t,i)=>({
      slug:t.id, title:t.title, section:t.sec, lesson:t.lesson||null, color:t.color,
      agent:t.agent||"", lead:t.lead||"", facts:t.facts||[], cheat:t.cheat||[],
      content_html:t.content_html||"", test:t.test||[], cards:t.cards||[], position:i, updated_by:user.id
    }));
    const {error}=await sb.from("topics").upsert(rows,{onConflict:"slug"});
    if(error) throw error;
    await loadAll();
  }

  /* ---------- отправка в базу ---------- */
  function scheduleFlush(){
    setStatus("saving");
    cSet("queue",queue);
    clearTimeout(flushT); flushT=setTimeout(flush,900);
  }
  async function flush(){
    if(!user||!sb) return;
    const pending=Object.assign({},cGet("queue")||{},queue);
    const keys=Object.keys(pending);
    if(!keys.length){ if(status==="saving") setStatus("saved"); return; }
    if(!navigator.onLine){ setStatus("offline","сохранено на устройстве, отправлю при сети"); return; }
    try{
      const states=keys.filter(k=>pending[k].kind==="state").map(k=>({
        owner:user.id, key:pending[k].key, value:pending[k].value,
        updated_at:new Date().toISOString(), client_id:CLIENT_ID }));
      if(states.length){ const {error}=await sb.from("user_state").upsert(states,{onConflict:"owner,key"}); if(error) throw error; }
      for(const k of keys){ const it=pending[k];
        if(it.kind==="state-del"){ const {error}=await sb.from("user_state").delete().eq("owner",user.id).eq("key",it.key); if(error) throw error; }
        if(it.kind==="topic"){ const p=Object.assign({},it.patch,{updated_at:new Date().toISOString(),client_id:CLIENT_ID,updated_by:user.id});
          const {error}=await sb.from("topics").update(p).eq("slug",it.slug); if(error) throw error; }
      }
      queue={}; cDel("queue"); setStatus("saved");
    }catch(e){
      queue=pending; cSet("queue",queue);
      setStatus("error",(e&&e.message)||"не удалось сохранить");
    }
  }
  function retry(){ flush(); }
  function pendingCount(){ return Object.keys(Object.assign({},cGet("queue")||{},queue)).length; }

  /* ---------- синхронизация между устройствами ---------- */
  let channel=null;
  function subscribe(){
    if(!sb||!user||channel) return;
    channel=sb.channel("sync-"+user.id)
      .on("postgres_changes",{event:"*",schema:"public",table:"user_state",filter:"owner=eq."+user.id},p=>{
        const row=p.new||p.old; if(!row) return;
        if(row.client_id===CLIENT_ID) return;
        if(p.eventType==="DELETE") delete state[row.key]; else state[row.key]=row.value;
        cSet("state:"+user.id,state); emit("remote",{kind:"state",key:row.key});
      })
      .on("postgres_changes",{event:"*",schema:"public",table:"topics"},p=>{
        const row=p.new; if(!row||row.client_id===CLIENT_ID) return;
        const i=topics.findIndex(t=>t.slug===row.slug);
        if(i>=0) topics[i]=row; else topics.push(row);
        cSet("topics:"+user.id,topics); emit("remote",{kind:"topic",slug:row.slug});
      })
      .subscribe();
    addEventListener("focus",()=>{ if(navigator.onLine) refresh(); });
  }
  async function refresh(){
    if(!user||!sb) return;
    try{
      const t=await sb.from("topics").select("*").order("position",{ascending:true});
      const s=await sb.from("user_state").select("key,value");
      if(t.error||s.error) return;
      const m=await sb.from("members").select("user_id,email,role");
      if(!m.error){ members=m.data||[]; me=members.find(x=>x.user_id===user.id)||null; emit("members",members); }
      topics=t.data||[]; state={}; (s.data||[]).forEach(r=>{ state[r.key]=r.value; });
      cSet("topics:"+user.id,topics); cSet("state:"+user.id,state);
      emit("remote",{kind:"full"});
    }catch(e){}
  }

  /* ---------- картинки ---------- */
  async function uploadImage(file){
    if(!user) throw new Error("нет входа");
    const ext=(file.name.split(".").pop()||"png").toLowerCase().replace(/[^a-z0-9]/g,"");
    const path=user.id+"/"+Date.now()+"-"+Math.random().toString(36).slice(2,8)+"."+ext;
    const {error}=await sb.storage.from("images").upload(path,file,{cacheControl:"31536000",upsert:false});
    if(error) throw error;
    const {data}=sb.storage.from("images").getPublicUrl(path);
    return data.publicUrl;
  }

  /* ---------- экспорт и импорт ---------- */
  function exportAll(){
    return { app:"inf-notes", version:4, exportedAt:new Date().toISOString(),
      topics:topics.map(t=>({slug:t.slug,title:t.title,section:t.section,lesson:t.lesson,color:t.color,
        agent:t.agent,lead:t.lead,facts:t.facts,cheat:t.cheat,content_html:t.content_html,
        test:t.test,cards:t.cards,position:t.position})),
      state:state };
  }
  async function importAll(obj,mode){
    if(!user) throw new Error("нет входа");
    if(!obj||typeof obj!=="object") throw new Error("файл не похож на резервную копию");
    // поддержка старого экспорта из артефакта (ключи inf3:)
    if(obj.data && !obj.state){ obj={state:obj.data,topics:[]}; }
    if(obj.topics&&obj.topics.length){
      const rows=obj.topics.map((t,i)=>Object.assign({},t,{position:t.position!=null?t.position:i,client_id:CLIENT_ID,updated_by:user.id}));
      const {error}=await sb.from("topics").upsert(rows,{onConflict:"slug"});
      if(error) throw error;
    }
    if(obj.state){
      if(mode==="replace"){ const {error}=await sb.from("user_state").delete().eq("owner",user.id); if(error) throw error; }
      const rows=Object.keys(obj.state).map(k=>({owner:user.id,key:k,value:obj.state[k],client_id:CLIENT_ID,updated_at:new Date().toISOString()}));
      for(let i=0;i<rows.length;i+=200){
        const {error}=await sb.from("user_state").upsert(rows.slice(i,i+200),{onConflict:"owner,key"});
        if(error) throw error;
      }
    }
    await loadAll();
  }

  /* ---------- команда ---------- */
  function getMembers(){ return members; }
  function myRole(){ return me?me.role:(members.length?"viewer":"owner"); }
  function canEdit(){ const r=myRole(); return r==="owner"||r==="editor"; }
  async function listInvites(){ const {data,error}=await sb.from("invites").select("email,role,created_at"); return error?[]:(data||[]); }
  async function invite(email,role){
    const {error}=await sb.from("invites").upsert({email:email.trim().toLowerCase(),role:role||"editor",invited_by:user.id},{onConflict:"email"});
    if(error) throw error; return true;
  }
  async function revokeInvite(email){ const {error}=await sb.from("invites").delete().eq("email",email); if(error) throw error; }
  async function setRole(userId,role){
    const {error}=await sb.from("members").update({role:role}).eq("user_id",userId); if(error) throw error;
    await refresh();
  }
  async function removeMember(userId){
    const {error}=await sb.from("members").delete().eq("user_id",userId); if(error) throw error;
    await refresh();
  }

  return { init, ready, currentUser, getMembers, myRole, canEdit, listInvites, invite, revokeInvite, setRole, removeMember, signIn, signInPassword, signUpPassword, signOut,
    loadAll, refresh, getTopics, getTopic, seedTopics, saveTopic,
    get, set, del, allState, on, status:()=>({status:status,msg:statusMsg}), retry, pendingCount,
    uploadImage, exportAll, importAll, saveLocalConfig, hasConfig:()=>!!cfg };
})();
