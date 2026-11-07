/* ============================================================
   app.js — вход, команда, синхронизация, резервные копии.
   ============================================================ */
(function(){
  const $=s=>document.querySelector(s);
  const SCREENS=["setup","gate","noaccess","shell"];
  function show(id){ SCREENS.forEach(x=>{ const e=$("#"+x); if(!e) return;
    e.style.display = (x===id) ? (x==="shell"?"block":"flex") : "none"; }); }
  function msg(el,text,kind){ const m=$(el); if(!m) return;
    m.textContent=text; m.className="msg show "+(kind||""); if(!text) m.className="msg"; }

  /* ---------------- экран настройки ---------------- */
  function setupScreen(){
    show("setup");
    $("#cfgSave").onclick=async()=>{
      const u=$("#cfgUrl").value.trim().replace(/\/+$/,""), k=$("#cfgKey").value.trim();
      if(!/^https:\/\/.+\.supabase\.co$/.test(u)){ msg("#cfgMsg","Адрес выглядит так: https://xxxx.supabase.co","err"); return; }
      if(k.length<30){ msg("#cfgMsg","Ключ слишком короткий — скопируй anon/publishable key целиком","err"); return; }
      Store.saveLocalConfig(u,k); msg("#cfgMsg","Готово, перезагружаю…","ok"); setTimeout(()=>location.reload(),600);
    };
  }

  /* ---------------- вход ---------------- */
  let signUpMode=false;
  function gateScreen(){
    show("gate");
    const email=$("#authEmail"), pass=$("#authPass"), go=$("#authGo");
    $("#authToggle").onclick=()=>{
      signUpMode=!signUpMode;
      go.textContent=signUpMode?"Создать аккаунт":"Войти";
      $("#authToggle").textContent=signUpMode?"У меня уже есть аккаунт":"Я здесь впервые — создать аккаунт";
      pass.setAttribute("autocomplete",signUpMode?"new-password":"current-password");
      msg("#authMsg","");
    };
    $("#authLink").onclick=async()=>{
      const e=email.value.trim(); if(!e){ msg("#authMsg","Сначала впиши почту","err"); return; }
      try{ await Store.signIn(e); msg("#authMsg","Письмо отправлено. Открой ссылку из него на этом устройстве.","ok"); }
      catch(err){ msg("#authMsg",human(err),"err"); }
    };
    go.onclick=async()=>{
      const e=email.value.trim(), p=pass.value;
      if(!e||!p){ msg("#authMsg","Нужны почта и пароль","err"); return; }
      if(p.length<6){ msg("#authMsg","Пароль не короче 6 символов","err"); return; }
      go.disabled=true;
      try{
        if(signUpMode){ await Store.signUpPassword(e,p);
          msg("#authMsg","Аккаунт создан. Если Supabase просит подтвердить почту — открой письмо и вернись сюда.","ok"); }
        else await Store.signInPassword(e,p);
      }catch(err){ msg("#authMsg",human(err),"err"); }
      go.disabled=false;
    };
    [email,pass].forEach(i=>i.addEventListener("keydown",ev=>{ if(ev.key==="Enter") go.click(); }));
  }
  function human(e){
    const m=(e&&e.message)||String(e);
    if(/Invalid login/i.test(m)) return "Неверная почта или пароль";
    if(/already registered/i.test(m)) return "Такая почта уже есть — войди с паролем";
    if(/Email not confirmed/i.test(m)) return "Почта не подтверждена: открой письмо от Supabase";
    if(/rate limit|too many/i.test(m)) return "Слишком много попыток, подожди минуту";
    if(/Failed to fetch|NetworkError/i.test(m)) return "Нет связи с базой. Проверь интернет и адрес проекта";
    return m;
  }

  /* ---------------- команда ---------------- */
  async function openTeam(){
    $("#teamOv").classList.add("show"); msg("#teamMsg","");
    const list=$("#teamList"); list.innerHTML="";
    const me=Store.currentUser(), role=Store.myRole(), isOwner=role==="owner";
    (Store.getMembers()||[]).forEach(p=>{
      const d=document.createElement("div"); d.className="person";
      const em=document.createElement("span"); em.className="em"; em.textContent=p.email+(p.user_id===me.id?" (это ты)":"");
      d.appendChild(em);
      if(isOwner && p.user_id!==me.id){
        const sel=document.createElement("select");
        [["owner","владелец"],["editor","может править"],["viewer","только читать"]].forEach(([v,l])=>{
          const o=document.createElement("option"); o.value=v; o.textContent=l; if(p.role===v) o.selected=true; sel.appendChild(o); });
        sel.onchange=async()=>{ try{ await Store.setRole(p.user_id,sel.value); openTeam(); }catch(e){ msg("#teamMsg",human(e),"err"); } };
        const del=document.createElement("button"); del.className="btn sm"; del.textContent="Убрать";
        del.onclick=async()=>{ try{ await Store.removeMember(p.user_id); openTeam(); }catch(e){ msg("#teamMsg",human(e),"err"); } };
        d.append(sel,del);
      } else {
        const r=document.createElement("span"); r.className="ro";
        r.textContent={owner:"владелец",editor:"может править",viewer:"только читать"}[p.role]||p.role;
        d.appendChild(r);
      }
      list.appendChild(d);
    });
    $("#inviteBox").style.display=isOwner?"":"none";
    if(isOwner){
      const inv=await Store.listInvites(); const box=$("#invList"); box.innerHTML="";
      if(inv.length){ const h=document.createElement("div"); h.className="who"; h.style.margin="0";
        h.textContent="Приглашены, но ещё не заходили:"; box.appendChild(h); }
      inv.forEach(i=>{ const d=document.createElement("div"); d.className="person";
        const em=document.createElement("span"); em.className="em"; em.textContent=i.email;
        const r=document.createElement("span"); r.className="ro"; r.textContent=i.role==="viewer"?"только читать":"может править";
        const del=document.createElement("button"); del.className="btn sm"; del.textContent="Отменить";
        del.onclick=async()=>{ try{ await Store.revokeInvite(i.email); openTeam(); }catch(e){ msg("#teamMsg",human(e),"err"); } };
        d.append(em,r,del); box.appendChild(d); });
      $("#invAdd").onclick=async()=>{
        const e=$("#invEmail").value.trim();
        if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)){ msg("#teamMsg","Проверь адрес почты","err"); return; }
        try{ await Store.invite(e,$("#invRole").value); $("#invEmail").value="";
          msg("#teamMsg","Готово. Скажи коллеге зайти на сайт и создать аккаунт на эту почту — доступ появится сразу.","ok");
          openTeam(); }catch(err){ msg("#teamMsg",human(err),"err"); }
      };
    }
  }
  function wireTeam(){
    $("#teamBtn").onclick=openTeam;
    $("#teamClose").onclick=()=>$("#teamOv").classList.remove("show");
    $("#teamOv").addEventListener("mousedown",e=>{ if(e.target.id==="teamOv") $("#teamOv").classList.remove("show"); });
    $("#signOutBtn").onclick=async()=>{ await Store.signOut(); location.reload(); };
    $("#naOut").onclick=async()=>{ await Store.signOut(); location.reload(); };
  }

  /* ---------------- резервные копии ---------------- */
  function download(name,text){
    const b=new Blob([text],{type:"application/json;charset=utf-8"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download=name;
    document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000);
  }
  function wireData(){
    const ov=$("#dataOv");
    $("#dataBtn").onclick=()=>{
      const d=new Date().toISOString().slice(0,10);
      ov.querySelector(".modal").innerHTML=
        '<h3>Мои данные</h3>'+
        '<p>Резервная копия — один файл: конспекты всех тем плюс твои выделения, комментарии, заметки и прогресс. Храни его где удобно, из него всё восстанавливается.</p>'+
        '<div class="row left" style="margin-bottom:14px">'+
          '<button class="btn sm on" id="dlBtn"><svg class="ic sm"><use href="#i-down"/></svg>Скачать копию</button>'+
          '<button class="btn sm" id="upBtn"><svg class="ic sm"><use href="#i-up2"/></svg>Загрузить из файла</button>'+
          '<input type="file" id="upFile" accept="application/json,.json" style="display:none">'+
        '</div>'+
        '<p style="font-size:13px">Загрузка добавит данные из файла к текущим: одинаковые записи заменятся, остальное останется. Полная замена — только через кнопку ниже, она сначала удалит твои нынешние выделения и заметки.</p>'+
        '<div class="row left"><button class="btn sm" id="replBtn">Восстановить с полной заменой</button></div>'+
        '<div class="msg" id="dataMsg"></div>'+
        '<div class="row" style="margin-top:14px"><button class="btn sm on" id="dataClose2">Закрыть</button></div>';
      ov.classList.add("show");
      $("#dataClose2").onclick=()=>ov.classList.remove("show");
      $("#dlBtn").onclick=()=>download("konspekty-"+d+".json",JSON.stringify(Store.exportAll(),null,1));
      const file=$("#upFile");
      const load=async(mode)=>{
        file.onchange=async()=>{
          const f=file.files&&file.files[0]; if(!f) return;
          try{
            const text=await f.text(); const obj=JSON.parse(text);
            msg("#dataMsg","Загружаю…","ok");
            await Store.importAll(obj,mode);
            window.rebuildTopics(); window.renderHomeSafe(); window.reRoute();
            msg("#dataMsg","Готово: данные загружены.","ok");
          }catch(e){ msg("#dataMsg","Не вышло: "+human(e),"err"); }
          file.value="";
        };
        file.click();
      };
      $("#upBtn").onclick=()=>load("merge");
      $("#replBtn").onclick=()=>load("replace");
    };
    ov.addEventListener("mousedown",e=>{ if(e.target.id==="dataOv") ov.classList.remove("show"); });
  }

  /* ---------------- синхронизация ---------------- */
  function wireSync(){
    const banner=$("#remoteBanner");
    Store.on("remote",info=>{
      window.rebuildTopics();
      if(info.kind==="topic"){
        const open=location.hash.replace(/^#/,"").split("/")[0];
        if(info.slug===open){
          if(Editor.isActive()){
            $("#remoteText").textContent="Коллега только что изменил эту тему. Твои правки сохранятся поверх.";
            banner.classList.add("show");
          } else { window.reRoute(); }
        }
      }
      window.renderHomeSafe();
    });
    $("#remoteApply").onclick=()=>{ banner.classList.remove("show"); if(!Editor.isActive()) window.reRoute(); };
    $("#remoteHide").onclick=()=>banner.classList.remove("show");
  }

  /* ---------------- запуск ---------------- */
  async function afterLogin(){
    const u=Store.currentUser(); if(!u) return gateScreen();
    await Store.loadAll();
    const me=(Store.getMembers()||[]).find(m=>m.user_id===u.id);
    if(!me){ $("#naEmail").textContent=u.email||""; show("noaccess"); return; }
    window.rebuildTopics();
    show("shell");
    wireTeam(); wireData(); wireSync();
    $("#seedBtn").onclick=()=>window.restoreSeed&&window.restoreSeed();
    if(!Store.getTopics().length){
      if(Store.canEdit() && window.SEED){
        if(confirm("В кабинете пока нет тем. Загрузить пять готовых конспектов (холера, ботулизм, амебиаз, чума, туляремия)?")){
          try{ await Store.seedTopics(window.SEED); window.rebuildTopics(); }
          catch(e){ alert("Не получилось загрузить темы: "+human(e)); }
        }
      }
    }
    window.bootApp();
  }
  async function start(){
    Store.on("status",s=>{ if(window.setStatus) window.setStatus(s); });
    Store.on("auth",u=>{ if(u) afterLogin(); else gateScreen(); });
    const r=await Store.init();
    if(!r.ok){
      if(r.reason==="no-config") return setupScreen();
      document.body.innerHTML="<div class='gate'><div class='gate-box'><h1>Не загрузилась библиотека</h1>"+
        "<p>Файл assets/vendor/supabase.js не найден. Проверь, что он есть в репозитории.</p></div></div>";
      return;
    }
    if(Store.currentUser()) afterLogin(); else gateScreen();
  }
  start();
})();
