/* ============================================================
   editor.js — правка конспекта прямо на странице.
   Форматирование, списки, блоки «Запомни», ссылки, картинки.
   Картинки уходят в хранилище Supabase, в текст подставляется ссылка.
   ============================================================ */
window.Editor = (function(){
  let host=null, bar=null, onChange=null, active=false;

  const BTN=[
    ["h2","Заголовок",   "Раздел (H2)"],
    ["h3","Подзаголовок","Подзаголовок (H3)"],
    ["p","Текст",        "Обычный абзац"],
    ["sep"],
    ["bold","Ж",         "Жирный (Ctrl+B)"],
    ["italic","К",       "Курсив (Ctrl+I)"],
    ["sep"],
    ["ul","Список",      "Маркированный список"],
    ["ol","1. Список",   "Нумерованный список"],
    ["sep"],
    ["key","Запомни",    "Блок «Запомни»"],
    ["def","Определение","Выделенное определение"],
    ["sep"],
    ["link","Ссылка",    "Вставить ссылку"],
    ["img","Картинка",   "Загрузить изображение"],
    ["sep"],
    ["clear","Очистить", "Убрать форматирование"]
  ];

  function build(){
    bar=document.createElement("div"); bar.className="etb"; bar.id="etb";
    BTN.forEach(b=>{
      if(b[0]==="sep"){ const s=document.createElement("span"); s.className="sep"; bar.appendChild(s); return; }
      const el=document.createElement("button"); el.type="button"; el.dataset.cmd=b[0];
      el.textContent=b[1]; el.title=b[2];
      if(b[0]==="bold") el.style.fontWeight="800";
      if(b[0]==="italic") el.style.fontStyle="italic";
      el.addEventListener("mousedown",e=>e.preventDefault());
      el.onclick=()=>run(b[0]);
      bar.appendChild(el);
    });
    const g=document.createElement("span"); g.className="grow"; bar.appendChild(g);
    const note=document.createElement("span"); note.className="upl"; note.id="etbNote"; note.textContent="правки сохраняются автоматически";
    bar.appendChild(note);
    const done=document.createElement("button"); done.type="button"; done.className="on"; done.textContent="Готово";
    done.onclick=()=>window.dispatchEvent(new CustomEvent("editor:done")); bar.appendChild(done);
    return bar;
  }

  function blockOf(){
    const s=getSelection(); if(!s.rangeCount) return null;
    let n=s.getRangeAt(0).startContainer;
    if(n.nodeType===3) n=n.parentElement;
    while(n&&n!==host&&!/^(P|H2|H3|LI|DIV|BLOCKQUOTE)$/.test(n.tagName)) n=n.parentElement;
    return (n&&n!==host)?n:null;
  }
  function wrapBlock(cls){
    const b=blockOf(); if(!b) return;
    const outer=b.closest(".key,.def");
    if(outer&&outer.classList.contains(cls)){ // снять
      while(outer.firstChild) outer.parentNode.insertBefore(outer.firstChild,outer);
      outer.remove(); changed(); return;
    }
    const d=document.createElement("div"); d.className=cls;
    b.parentNode.insertBefore(d,b); d.appendChild(b); changed();
  }
  async function pickImage(){
    const inp=document.createElement("input"); inp.type="file"; inp.accept="image/*";
    inp.onchange=async()=>{
      const f=inp.files&&inp.files[0]; if(!f) return;
      const note=document.getElementById("etbNote");
      if(f.size>5*1024*1024){ if(note) note.textContent="файл больше 5 МБ — ужми его"; return; }
      if(note) note.textContent="загружаю картинку…";
      try{
        const url=await Store.uploadImage(f);
        host.focus();
        document.execCommand("insertHTML",false,'<figure><img src="'+url+'" alt=""><figcaption>Подпись к картинке</figcaption></figure><p><br></p>');
        changed(); if(note) note.textContent="картинка добавлена";
      }catch(e){ if(note) note.textContent="не вышло загрузить: "+((e&&e.message)||"ошибка"); }
      setTimeout(()=>{ const n2=document.getElementById("etbNote"); if(n2) n2.textContent="правки сохраняются автоматически"; },3000);
    };
    inp.click();
  }
  function run(cmd){
    host.focus();
    if(cmd==="h2"||cmd==="h3"||cmd==="p") document.execCommand("formatBlock",false,cmd.toUpperCase());
    else if(cmd==="bold") document.execCommand("bold");
    else if(cmd==="italic") document.execCommand("italic");
    else if(cmd==="ul") document.execCommand("insertUnorderedList");
    else if(cmd==="ol") document.execCommand("insertOrderedList");
    else if(cmd==="key") return wrapBlock("key");
    else if(cmd==="def") return wrapBlock("def");
    else if(cmd==="clear"){ document.execCommand("removeFormat"); document.execCommand("unlink"); }
    else if(cmd==="link"){
      const u=prompt("Адрес ссылки (https://…)"); if(u) document.execCommand("createLink",false,u);
    }
    else if(cmd==="img") return pickImage();
    changed();
  }
  function changed(){ if(onChange) onChange(cleanHTML()); }

  /* чистим мусор, который приходит при вставке из Word и браузера */
  function cleanHTML(){
    const d=document.createElement("div"); d.innerHTML=host.innerHTML;
    d.querySelectorAll("[data-b]").forEach(e=>e.removeAttribute("data-b"));
    d.querySelectorAll("mark.hl,span.big,span.cmt").forEach(e=>{
      const p=e.parentNode; while(e.firstChild) p.insertBefore(e.firstChild,e); p.removeChild(e);
    });
    d.querySelectorAll("*").forEach(e=>{
      if(e.tagName==="IMG") { e.removeAttribute("style"); e.removeAttribute("class"); return; }
      e.removeAttribute("style"); e.removeAttribute("class$");
      if(e.className && /^(Mso|docx)/i.test(e.className)) e.removeAttribute("class");
      [...e.attributes].forEach(a=>{ if(/^(on|data-(?!b))/i.test(a.name)) e.removeAttribute(a.name); });
    });
    d.querySelectorAll("script,style,meta,link").forEach(e=>e.remove());
    return d.innerHTML;
  }

  function onPaste(e){
    if(!active) return;
    const items=e.clipboardData && e.clipboardData.items;
    if(items) for(const it of items){
      if(it.type.indexOf("image")===0){
        e.preventDefault(); const f=it.getAsFile(); if(!f) return;
        const note=document.getElementById("etbNote"); if(note) note.textContent="загружаю картинку…";
        Store.uploadImage(f).then(url=>{
          document.execCommand("insertHTML",false,'<figure><img src="'+url+'" alt=""></figure><p><br></p>');
          changed(); if(note) note.textContent="картинка добавлена";
        }).catch(err=>{ if(note) note.textContent="не вышло загрузить: "+((err&&err.message)||"ошибка"); });
        return;
      }
    }
    const html=e.clipboardData.getData("text/html");
    if(html){
      e.preventDefault();
      const d=document.createElement("div"); d.innerHTML=html;
      d.querySelectorAll("script,style,meta,link,o\\:p").forEach(x=>x.remove());
      d.querySelectorAll("*").forEach(x=>{ x.removeAttribute("style"); x.removeAttribute("class");
        [...x.attributes].forEach(a=>{ if(/^(on|lang|dir|align|width|height|face|color)/i.test(a.name)) x.removeAttribute(a.name); }); });
      document.execCommand("insertHTML",false,d.innerHTML);
      changed();
    }
  }

  function start(el,cb){
    host=el; onChange=cb; active=true;
    if(!bar) build();
    if(!bar.parentNode) el.parentNode.insertBefore(bar,el);
    bar.classList.add("show");
    el.contentEditable="true"; el.classList.add("editing");
    el.addEventListener("input",changed);
    el.addEventListener("paste",onPaste);
    try{ document.execCommand("defaultParagraphSeparator",false,"p"); }catch(e){}
    el.focus();
  }
  function stop(){
    if(!host) return cleanHTMLSafe();
    active=false;
    const html=cleanHTML();
    host.contentEditable="false"; host.classList.remove("editing");
    host.removeEventListener("input",changed);
    host.removeEventListener("paste",onPaste);
    if(bar) bar.classList.remove("show");
    return html;
  }
  function cleanHTMLSafe(){ return ""; }
  function isActive(){ return active; }
  return { start, stop, isActive, toolbar:()=>bar||build() };
})();
