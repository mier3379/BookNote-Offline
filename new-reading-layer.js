(function(){
  "use strict";
  var browser=globalThis.browser;
  var reader=document.getElementById("booknoteReader");
  if(!reader)return;

  var els={
    title:reader.querySelector("[data-reader-title]"),author:reader.querySelector("[data-reader-author]"),format:reader.querySelector("[data-reader-format]"),
    content:reader.querySelector("[data-reader-content]"),search:reader.querySelector("[data-reader-search]"),count:reader.querySelector("[data-reader-count]"),
    note:reader.querySelector("[data-reader-note]"),toc:reader.querySelector("[data-reader-toc]"),bookmarks:reader.querySelector("[data-reader-bookmarks]"),
    sidebar:reader.querySelector("[data-reader-sidebar]"),sidebarTitle:reader.querySelector("[data-reader-sidebar-title]"),progress:reader.querySelector("[data-reader-progress]"),
    chapterLabel:reader.querySelector("[data-reader-chapter-label]"),font:reader.querySelector("[data-reader-font]"),line:reader.querySelector("[data-reader-line]"),
    mode:reader.querySelector("[data-reader-mode]"),theme:reader.querySelector("[data-reader-theme]"),pdfNotice:reader.querySelector("[data-reader-pdf-notice]"),
    prevChapter:reader.querySelector("[data-reader-prev-chapter]"),nextChapter:reader.querySelector("[data-reader-next-chapter]"),bookmark:reader.querySelector("[data-reader-bookmark]")
  };

  var state={
    book:null,readingState:null,mode:"text",objectUrl:"",searchTerm:"",hits:[],hitIndex:-1,
    chapters:[],chapterIndex:0,toc:[],activeSidebar:"toc",fontScale:100,lineHeight:1.8,displayMode:"original",theme:"light",dirty:false
  };
  var defaults={fontScale:100,lineHeight:1.8,displayMode:"original",theme:"light"};
  var notesKey="booknoteNotes";

  function esc(s){return String(s==null?"":s).replace(/[&<>\"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
  function toast(msg){var t=document.getElementById("toast");if(t){t.textContent=msg;t.classList.add("show");setTimeout(function(){t.classList.remove("show");},1800);}}
  function key(id){return "booknoteReadingState:"+String(id||"");}
  function getState(id){return browser.storage.local.get(key(id)).then(function(r){return r[key(id)]||{progress:0,locator:{},highlights:[],bookmarks:[]};});}
  function setState(id,s){var o={};o[key(id)]=s;return browser.storage.local.set(o);}
  function getNotes(){return browser.storage.local.get(notesKey).then(function(r){return Array.isArray(r.booknoteNotes)?r.booknoteNotes:[];});}
  function setNotes(v){return browser.storage.local.set((function(){var o={};o[notesKey]=v;return o;})());}
  function decodeBase64(s){var bin=atob(String(s||"")),u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;}
  function bytesToText(bytes){return new TextDecoder("utf-8").decode(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes));}
  function importedTextNodes(root){var a=[],w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null),n;while((n=w.nextNode()))a.push(n);return a;}
  function pointAt(root,pos){var nodes=importedTextNodes(root),total=0;for(var i=0;i<nodes.length;i++){var len=(nodes[i].nodeValue||"").length;if(pos<=total+len)return {node:nodes[i],offset:Math.max(0,pos-total)};total+=len;}if(nodes.length)return {node:nodes[nodes.length-1],offset:nodes[nodes.length-1].nodeValue.length};return null;}
  function selectionOffsets(root){var sel=window.getSelection();if(!sel||!sel.rangeCount||sel.isCollapsed||!root.contains(sel.anchorNode)||!root.contains(sel.focusNode))return null;var range=sel.getRangeAt(0),before=document.createRange();before.selectNodeContents(root);before.setEnd(range.startContainer,range.startOffset);var start=before.toString().length,text=range.toString();return {start:start,end:start+text.length,text:text};}
  function clearMarks(){Array.prototype.slice.call(els.content.querySelectorAll(".reader-search-hit,.reader-highlight")).forEach(function(e){e.replaceWith.apply(e,Array.prototype.slice.call(e.childNodes));});}
  function wrapRange(root,start,end,cls,attrs){if(end<=start)return;var a=pointAt(root,start),b=pointAt(root,end);if(!a||!b)return;var r=document.createRange();try{r.setStart(a.node,a.offset);r.setEnd(b.node,b.offset);}catch(_){return;}var nodes=[],w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null),n;while((n=w.nextNode())){if(n.nodeValue&&r.intersectsNode&&r.intersectsNode(n))nodes.push(n);}nodes.forEach(function(t){var st=0,en=t.nodeValue.length;if(t===a.node)st=a.offset;if(t===b.node)en=b.offset;if(en<=st)return;var tail=t.splitText(en),mid=t;if(st>0)mid=t.splitText(st);var mark=document.createElement("mark");mark.className=cls;if(attrs)Object.keys(attrs).forEach(function(k){mark.setAttribute(k,attrs[k]);});mid.parentNode.insertBefore(mark,mid);mark.appendChild(mid);});}
  function renderMarks(){
    clearMarks();if(!state.book)return;var st=state.readingState||{};
    (st.highlights||[]).forEach(function(h){wrapRange(els.content,Number(h.start)||0,Number(h.end)||0,"reader-highlight",{"data-color":h.color||"yellow"});});
    state.hits=[];if(state.searchTerm){var text=els.content.textContent||"",lower=text.toLocaleLowerCase(),q=state.searchTerm.toLocaleLowerCase(),from=0,p;while(q&&(p=lower.indexOf(q,from))>=0){state.hits.push({start:p,end:p+q.length});from=p+q.length;}}
    state.hits.forEach(function(h){wrapRange(els.content,h.start,h.end,"reader-search-hit",{});});
    els.count.textContent=state.searchTerm?(state.hits.length?((state.hitIndex+1)+" / "+state.hits.length):"0 / 0"):"";
  }
  function sanitizeHtml(html){var d=new DOMParser().parseFromString(String(html||""),"text/html");d.querySelectorAll("script,iframe,object,embed,form,link,meta,base").forEach(function(n){n.remove();});d.querySelectorAll("*").forEach(function(n){Array.prototype.slice.call(n.attributes).forEach(function(a){if(/^on/i.test(a.name)||a.name.toLowerCase()==="srcdoc")n.removeAttribute(a.name);});});return d.body?d.body.innerHTML:"";}
  function htmlFromText(text){return String(text||"").split(/\r?\n/).map(function(line){return line.trim()?"<p>"+esc(line)+"</p>":"<p class=\"reader-blank\"></p>";}).join("");}
  function setContent(html){els.content.innerHTML=sanitizeHtml(html)||"<p>文档正文为空。</p>";els.content.className="reader-text-content";applySettings();renderMarks();}

  async function readZipEntries(buffer){
    var view=new DataView(buffer),u8=new Uint8Array(buffer),dec=new TextDecoder("utf-8"),e=-1;
    for(var i=view.byteLength-22;i>=Math.max(0,view.byteLength-65557);i--){if(view.getUint32(i,true)===0x06054b50){e=i;break;}}
    if(e<0)throw new Error("EPUB ZIP 无效");
    var count=view.getUint16(e+10,true),off=view.getUint32(e+16,true),entries=new Map(),pos=off;
    function u16(o){return view.getUint16(o,true)} function u32(o){return view.getUint32(o,true)}
    for(var n=0;n<count;n++){
      if(u32(pos)!==0x02014b50)throw new Error("EPUB ZIP 目录损坏");
      var flags=u16(pos+8),method=u16(pos+10),csize=u32(pos+20),nl=u16(pos+28),el=u16(pos+30),cl=u16(pos+32),lo=u32(pos+42);
      var name=dec.decode(u8.slice(pos+46,pos+46+nl));pos+=46+nl+el+cl;entries.set(name,{method:method,csize:csize,localOffset:lo,flags:flags});
    }
    async function get(name){var meta=entries.get(name);if(!meta)return null;var lo=meta.localOffset,ln=u16(lo+26),le=u16(lo+28),data=u8.slice(lo+30+ln+le,lo+30+ln+le+meta.csize);if(meta.method===0)return data;if(meta.method===8){var ds=new DecompressionStream("deflate-raw");return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());}throw new Error("EPUB 使用了不支持的压缩方式");}
    return {entries:entries,get:get};
  }
  function dirname(path){return path.includes("/")?path.slice(0,path.lastIndexOf("/")+1):"";}
  function resolvePath(base,target){if(!target)return base;try{return new URL(target,"https://booknote.invalid/"+dirname(base)).pathname.replace(/^\//,"");}catch(_){return (dirname(base)+target).replace(/\/\.\//g,"/");}}
  function localName(el){return String(el.localName||el.nodeName||"").split(":").pop().toLowerCase();}
  function childrenByName(root,name){return Array.prototype.filter.call(root.getElementsByTagName("*"),function(e){return localName(e)===name;});}
  function attr(el,name){return el&&el.getAttribute?el.getAttribute(name)||"":"";}
  async function parseEpub(bytes){
    var zip=await readZipEntries(bytes.buffer),containerBytes=await zip.get("META-INF/container.xml"),opfPath="";
    if(containerBytes){var cdoc=new DOMParser().parseFromString(bytesToText(containerBytes),"application/xml");var rf=childrenByName(cdoc,"rootfile")[0];opfPath=attr(rf,"full-path");}
    if(!opfPath){for(var name of zip.entries.keys()){if(/\.opf$/i.test(name)){opfPath=name;break;}}}
    if(!opfPath)throw new Error("EPUB 未找到 content.opf");
    var opfBytes=await zip.get(opfPath);if(!opfBytes)throw new Error("EPUB content.opf 读取失败");
    var opf=new DOMParser().parseFromString(bytesToText(opfBytes),"application/xml");
    var manifest={},manifestEls=childrenByName(opf,"item");manifestEls.forEach(function(item){var id=attr(item,"id");if(id)manifest[id]={href:resolvePath(opfPath,attr(item,"href").split("#")[0]),media:attr(item,"media-type"),properties:attr(item,"properties")};});
    var spineEls=childrenByName(opf,"itemref").filter(function(e){return localName(e.parentElement)==="spine";});
    var chapters=[];
    for(var i=0;i<spineEls.length;i++){var idref=attr(spineEls[i],"idref"),item=manifest[idref];if(!item||!/x?html?/i.test(item.media))continue;var raw=await zip.get(item.href);if(!raw)continue;var doc=new DOMParser().parseFromString(bytesToText(raw),"text/html");var body=doc.body?doc.body.innerHTML:"";body=sanitizeHtml(body);chapters.push({href:item.href,label:"",html:body,media:item.media});}
    if(!chapters.length)throw new Error("EPUB 没有可阅读章节");
    var title="",author="";childrenByName(opf,"title").some(function(e){title=(e.textContent||"").trim();return !!title;});childrenByName(opf,"creator").some(function(e){author=(e.textContent||"").trim();return !!author;});
    var navItem=manifestEls.find(function(item){return /\bnav\b/i.test(item.getAttribute("properties")||"");}),toc=[];
    if(navItem){var navBytes=await zip.get(navItem.href);if(navBytes){var ndoc=new DOMParser().parseFromString(bytesToText(navBytes),"text/html");var nav=Array.prototype.find.call(ndoc.querySelectorAll("nav"),function(n){return /\btoc\b/i.test(n.getAttribute("epub:type")||"")})||ndoc.querySelector("nav");if(nav){nav.querySelectorAll("a").forEach(function(a){var href=resolvePath(navItem.href,attr(a,"href").split("#")[0]);toc.push({href:href,label:(a.textContent||"").replace(/\s+/g," ").trim()||href});});}}}
    if(!toc.length){chapters.forEach(function(ch,idx){var d=new DOMParser().parseFromString(ch.html,"text/html"),h=d.querySelector("h1,h2,h3,h4,h5,h6");toc.push({href:ch.href,label:(h?h.textContent:"").replace(/\s+/g," ").trim()||("第 "+(idx+1)+" 章")});});}
    chapters.forEach(function(ch,idx){var t=toc.find(function(x){return x.href===ch.href;});ch.label=t?t.label:("第 "+(idx+1)+" 章");});
    return {title:title,author:author,chapters:chapters,toc:toc};
  }
  function buildChapterHtml(chapters){return chapters.map(function(ch,i){return '<section class="reader-chapter" data-chapter-index="'+i+'" data-chapter-href="'+esc(ch.href)+'"><div class="reader-chapter-kicker">'+esc(ch.label||("第 "+(i+1)+" 章"))+'</div>'+ch.html+'</section>';}).join("");}
  function renderToc(){
    els.toc.innerHTML=state.toc.map(function(item,i){return '<button type="button" class="reader-toc-item '+(item.href===((state.chapters[state.chapterIndex]||{}).href)?"active":"")+'" data-toc-index="'+i+'"><span>'+esc(item.label)+'</span></button>';}).join("")||'<p class="reader-side-empty">本书没有可用目录</p>';
    els.toc.querySelectorAll("[data-toc-index]").forEach(function(b){b.onclick=function(){var item=state.toc[Number(b.dataset.tocIndex)];if(item)gotoHref(item.href);};});
  }
  function renderBookmarks(){
    var bs=state.readingState&&state.readingState.bookmarks||[];
    els.bookmarks.innerHTML=bs.map(function(b,i){return '<article class="reader-bookmark-item"><button type="button" data-bookmark-index="'+i+'"><strong>'+esc(b.chapterLabel||"阅读位置")+'</strong><span>'+esc(b.excerpt||"书签位置")+'</span><small>'+Math.round((Number(b.progress)||0)*100)+'%</small></button><button type="button" class="reader-bookmark-delete" data-bookmark-delete="'+i+'" aria-label="删除书签">×</button></article>';}).join("")||'<p class="reader-side-empty">暂无书签</p>';
    els.bookmarks.querySelectorAll("[data-bookmark-index]").forEach(function(b){b.onclick=function(){restoreBookmark(Number(b.dataset.bookmarkIndex));};});
    els.bookmarks.querySelectorAll("[data-bookmark-delete]").forEach(function(b){b.onclick=function(e){e.stopPropagation();var i=Number(b.dataset.bookmarkDelete);state.readingState.bookmarks.splice(i,1);setState(state.book.id,state.readingState).then(renderBookmarks);};});
  }
  function setSidebar(tab){state.activeSidebar=tab;els.toc.hidden=tab!=="toc";els.bookmarks.hidden=tab!=="bookmarks";reader.querySelectorAll("[data-sidebar-tab]").forEach(function(b){b.classList.toggle("active",b.dataset.sidebarTab===tab);});}
  function applyTheme(){reader.dataset.readerTheme=state.theme;document.documentElement.style.setProperty("--booknote-reader-font",(state.fontScale/100)+"");}
  function applySettings(){
    els.content.style.setProperty("--reader-font-scale",String(state.fontScale/100));els.content.style.setProperty("--reader-line-height",String(state.lineHeight));
    els.font.value=String(state.fontScale);els.line.value=String(state.lineHeight);els.mode.value=state.displayMode;els.theme.textContent=state.theme==="dark"?"☾ 深色主题":"☀ 浅色主题";
    applyTheme();
  }
  function persistScroll(){
    if(!state.book||!els.content||!state.readingState)return;var max=Math.max(1,els.content.scrollHeight-els.content.clientHeight),progress=Math.min(1,Math.max(0,els.content.scrollTop/max));state.readingState.progress=progress;state.readingState.locator={progress:progress,chapterIndex:state.chapterIndex};state.readingState.updatedAt=Date.now();void setState(state.book.id,state.readingState);updateProgress();
  }
  function updateProgress(){var p=Number(state.readingState&&state.readingState.progress)||0;els.progress.textContent=Math.round(p*100)+"%";els.chapterLabel.textContent=(state.chapters[state.chapterIndex]&&state.chapters[state.chapterIndex].label)||"正文";els.prevChapter.disabled=state.chapterIndex<=0;els.nextChapter.disabled=state.chapterIndex>=state.chapters.length-1;els.bookmark.textContent="☆";var bs=state.readingState&&state.readingState.bookmarks||[];var here=bs.some(function(b){return Math.abs((Number(b.progress)||0)-p)<0.003&&Number(b.chapterIndex)===state.chapterIndex;});if(here)els.bookmark.textContent="★";}
  function gotoChapter(index){if(index<0||index>=state.chapters.length)return;state.chapterIndex=index;var node=els.content.querySelector('[data-chapter-index="'+index+'"]');if(node){node.scrollIntoView({block:"start"});state.readingState.locator={progress:state.readingState.progress||0,chapterIndex:index};void setState(state.book.id,state.readingState);}renderToc();updateProgress();}
  function gotoHref(href){var i=state.chapters.findIndex(function(c){return c.href===href;});if(i<0)i=state.chapters.findIndex(function(c){return c.href.split("#")[0]===String(href).split("#")[0];});if(i>=0)gotoChapter(i);}
  function restoreBookmark(i){var b=(state.readingState.bookmarks||[])[i];if(!b)return;gotoChapter(Number(b.chapterIndex)||0);setTimeout(function(){var max=Math.max(1,els.content.scrollHeight-els.content.clientHeight);els.content.scrollTop=max*(Number(b.progress)||0);},50);}
  function restorePosition(){var loc=state.readingState&&state.readingState.locator||{},idx=Number(loc.chapterIndex);if(Number.isFinite(idx)&&idx>=0&&idx<state.chapters.length)state.chapterIndex=idx;var max=Math.max(1,els.content.scrollHeight-els.content.clientHeight);els.content.scrollTop=max*(Number(state.readingState&&state.readingState.progress)||0);renderToc();updateProgress();}
  function searchBook(){state.searchTerm=String(els.search.value||"").trim();state.hitIndex=state.searchTerm?0:-1;renderMarks();if(state.hits.length)scrollToOffset(state.hits[0].start);}
  function scrollToOffset(pos){var p=pointAt(els.content,pos);if(!p)return;var r=document.createRange();r.setStart(p.node,p.offset);r.collapse(true);var rect=r.getBoundingClientRect(),cr=els.content.getBoundingClientRect();els.content.scrollTop+=rect.top-cr.top-els.content.clientHeight*.35;}
  function moveHit(dir){if(!state.hits.length)return;state.hitIndex=(state.hitIndex+dir+state.hits.length)%state.hits.length;renderMarks();scrollToOffset(state.hits[state.hitIndex].start);}
  function toggleBookmark(){if(!state.book)return;persistScroll();var p=Number(state.readingState.progress)||0,bs=state.readingState.bookmarks||[],idx=bs.findIndex(function(b){return Number(b.chapterIndex)===state.chapterIndex&&Math.abs((Number(b.progress)||0)-p)<0.003;});if(idx>=0)bs.splice(idx,1);else{var node=els.content.querySelector('[data-chapter-index="'+state.chapterIndex+'"]');var excerpt=(node?node.textContent:els.content.textContent||"").replace(/\s+/g," ").trim().slice(0,150);bs.unshift({id:"bookmark-"+Date.now(),chapterIndex:state.chapterIndex,progress:p,chapterLabel:(state.chapters[state.chapterIndex]||{}).label,excerpt:excerpt,createdAt:Date.now()});}state.readingState.bookmarks=bs;void setState(state.book.id,state.readingState).then(function(){renderBookmarks();updateProgress();toast(idx>=0?"已取消书签":"书签已保存");});}
  function addHighlight(){var s=selectionOffsets(els.content);if(!state.book||!s||!s.text.trim()){toast("请先选择正文");return;}var hs=state.readingState.highlights||[];hs.push({id:"highlight-"+Date.now(),start:s.start,end:s.end,color:"yellow",text:s.text});state.readingState.highlights=hs;void setState(state.book.id,state.readingState).then(function(){renderMarks();window.getSelection().removeAllRanges();toast("高亮已保存");});}
  function saveExcerpt(){var s=selectionOffsets(els.content);if(!state.book||!s||!s.text.trim()){toast("请先选择正文");return;}getNotes().then(function(ns){var now=new Date().toISOString();ns.unshift({id:"reader-excerpt-"+Date.now(),name:state.book.name||state.book.documentFileName||"阅读摘录",pageTitle:state.book.name||state.book.documentFileName,category:"阅读摘录",categoryType:"excerpt",sourceType:"book-reader",selectedText:s.text,noteText:"",createdAt:now,updatedAt:now,bookId:state.book.id,documentFormat:state.book.documentFormat,readerChapter:state.chapters[state.chapterIndex]&&state.chapters[state.chapterIndex].label});return setNotes(ns);}).then(function(){window.getSelection().removeAllRanges();toast("摘录已保存");});}
  function saveNote(){var text=String(els.note.value||"").trim();if(!state.book||!text){toast("请输入 Note");return;}getNotes().then(function(ns){var now=new Date().toISOString();ns.unshift({id:"reader-note-"+Date.now(),name:"阅读 Note · "+(state.book.name||state.book.documentFileName||"书籍"),pageTitle:state.book.name||state.book.documentFileName,category:"阅读 Note",categoryType:"note",sourceType:"book-reader",selectedText:"",noteText:text,createdAt:now,updatedAt:now,bookId:state.book.id,documentFormat:state.book.documentFormat,readerChapter:state.chapters[state.chapterIndex]&&state.chapters[state.chapterIndex].label});return setNotes(ns);}).then(function(){els.note.value="";toast("Note 已保存");});}
  function cycleTheme(){state.theme=state.theme==="dark"?"light":"dark";applySettings();saveReaderSettings();}
  function saveReaderSettings(){var o={fontScale:state.fontScale,lineHeight:state.lineHeight,displayMode:state.displayMode,theme:state.theme};var x={};x.booknoteReaderSettings=o;return browser.storage.local.set(x);}
  function loadReaderSettings(){return browser.storage.local.get("booknoteReaderSettings").then(function(r){var x=r.booknoteReaderSettings||{};state.fontScale=Math.min(180,Math.max(70,Number(x.fontScale)||defaults.fontScale));state.lineHeight=Math.min(2.6,Math.max(1.2,Number(x.lineHeight)||defaults.lineHeight));state.displayMode=/^(original|bilingual|translation)$/.test(x.displayMode)?x.displayMode:defaults.displayMode;state.theme=x.theme==="dark"?"dark":"light";applySettings();});}
  function openPdf(book){state.mode="pdf";els.content.innerHTML="";var bytes=decodeBase64(book.documentOriginalBase64||"");state.objectUrl=URL.createObjectURL(new Blob([bytes],{type:"application/pdf"}));var iframe=document.createElement("iframe");iframe.className="reader-pdf-frame";iframe.src=browser.runtime.getURL("pdf-viewer.html")+"?url="+encodeURIComponent(state.objectUrl);els.content.appendChild(iframe);els.content.className="reader-pdf-content";els.pdfNotice.hidden=false;}
  function setMode(){
    els.content.dataset.displayMode=state.displayMode;
    if(state.displayMode==="original"){els.content.querySelectorAll("[data-reader-translation]").forEach(function(e){e.hidden=true;});}
    else if(state.displayMode==="translation"){els.content.querySelectorAll("[data-reader-translation]").forEach(function(e){e.hidden=false;});}
  }
  async function openBook(book){
    closeBook(false);state.book=book;state.readingState=await getState(book.id);state.searchTerm="";state.hitIndex=-1;state.hits=[];els.search.value="";els.note.value="";els.title.textContent="📖 "+(book.name||book.documentFileName||"未命名书籍");els.author.textContent=book.author||book.documentAuthor||"";els.format.textContent=String(book.documentFormat||"").toUpperCase();reader.classList.add("open");reader.setAttribute("aria-hidden","false");els.pdfNotice.hidden=true;state.chapters=[];state.toc=[];state.chapterIndex=0;
    await loadReaderSettings();
    var fmt=String(book.documentFormat||"").toLowerCase();
    try{
      if(fmt==="pdf")openPdf(book);
      else if(fmt==="epub"&&!book.documentModified){var parsed=await parseEpub(decodeBase64(book.documentOriginalBase64||""));state.chapters=parsed.chapters;state.toc=parsed.toc;els.title.textContent="📖 "+(parsed.title||book.name||book.documentFileName||"未命名书籍");els.author.textContent=parsed.author||els.author.textContent;els.content.innerHTML=buildChapterHtml(state.chapters);els.content.className="reader-text-content reader-epub-content";restorePosition();}
      else {state.chapters=[{href:"document",label:"正文",html:book.noteHtml||htmlFromText(book.noteText||book.documentOriginalText||"")}];state.toc=[{href:"document",label:"正文"}];setContent(state.chapters[0].html);restorePosition();}
    }catch(error){state.chapters=[{href:"document",label:"正文",html:book.noteHtml||htmlFromText(book.noteText||"")}];state.toc=[{href:"document",label:"正文"}];setContent(state.chapters[0].html);restorePosition();toast("EPUB 阅读器已切换到兼容模式");console.error("BookNote reader",error);}
    renderToc();renderBookmarks();setMode();updateProgress();
  }
  function closeBook(save){if(save!==false)persistScroll();reader.classList.remove("open");reader.setAttribute("aria-hidden","true");if(state.objectUrl){URL.revokeObjectURL(state.objectUrl);state.objectUrl="";}state.book=null;state.readingState=null;state.chapters=[];state.toc=[];state.chapterIndex=0;}

  reader.querySelector("[data-reader-close]").onclick=function(){closeBook(true);};
  reader.querySelector("[data-reader-search-btn]").onclick=searchBook;els.search.onkeydown=function(e){if(e.key==="Enter")searchBook();};
  reader.querySelector("[data-reader-prev]").onclick=function(){moveHit(-1);};reader.querySelector("[data-reader-next]").onclick=function(){moveHit(1);};
  reader.querySelector("[data-reader-highlight]").onclick=addHighlight;reader.querySelector("[data-reader-excerpt]").onclick=saveExcerpt;reader.querySelector("[data-reader-note-save]").onclick=saveNote;els.bookmark.onclick=toggleBookmark;
  els.prevChapter.onclick=function(){gotoChapter(state.chapterIndex-1);};els.nextChapter.onclick=function(){gotoChapter(state.chapterIndex+1);};
  reader.querySelectorAll("[data-sidebar-tab]").forEach(function(b){b.onclick=function(){setSidebar(b.dataset.sidebarTab);};});
  els.font.oninput=function(){state.fontScale=Number(els.font.value)||100;applySettings();};els.font.onchange=saveReaderSettings;
  els.line.oninput=function(){state.lineHeight=Number(els.line.value)||1.8;applySettings();};els.line.onchange=saveReaderSettings;
  els.mode.onchange=function(){state.displayMode=els.mode.value;setMode();saveReaderSettings();};
  els.theme.onclick=cycleTheme;
  els.content.addEventListener("scroll",function(){if(state.mode!=="pdf")persistScroll();},{passive:true});
  reader.addEventListener("keydown",function(e){if(e.target&&(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable))return;if(e.key==="ArrowLeft"){e.preventDefault();gotoChapter(state.chapterIndex-1);}else if(e.key==="ArrowRight"){e.preventDefault();gotoChapter(state.chapterIndex+1);}else if(e.key==="PageDown"){e.preventDefault();els.content.scrollTop+=els.content.clientHeight*.9;}else if(e.key==="PageUp"){e.preventDefault();els.content.scrollTop-=els.content.clientHeight*.9;}else if(e.key===" "){e.preventDefault();els.content.scrollTop+=(e.shiftKey?-1:1)*els.content.clientHeight*.85;}});
  els.content.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a");if(!a)return;var href=a.getAttribute("href")||"";if(href&&!/^(?:https?:|mailto:|javascript:)/i.test(href)){e.preventDefault();gotoHref(href.split("#")[0]);}});
  window.BookNoteReadingLayer={open:openBook,close:closeBook};
})();
