(function(){
  "use strict";
  var browser=globalThis.browser;
  var reader=document.getElementById("booknoteReader");
  if(!reader)return;

  var els={
    title:reader.querySelector("[data-reader-title]"),author:reader.querySelector("[data-reader-author]"),format:reader.querySelector("[data-reader-format]"),
    content:reader.querySelector("[data-reader-content]"),search:reader.querySelector("[data-reader-search]"),searchMode:reader.querySelector("[data-reader-search-mode]"),count:reader.querySelector("[data-reader-count]"),
    note:reader.querySelector("[data-reader-note]"),toc:reader.querySelector("[data-reader-toc]"),bookmarks:reader.querySelector("[data-reader-bookmarks]"),annotations:reader.querySelector("[data-reader-annotations]"),
    sidebar:reader.querySelector("[data-reader-sidebar]"),sidebarTitle:reader.querySelector("[data-reader-sidebar-title]"),progress:reader.querySelector("[data-reader-progress]"),
    chapterLabel:reader.querySelector("[data-reader-chapter-label]"),font:reader.querySelector("[data-reader-font]"),line:reader.querySelector("[data-reader-line]"),
    mode:reader.querySelector("[data-reader-mode]"),theme:reader.querySelector("[data-reader-theme]"),pdfNotice:reader.querySelector("[data-reader-pdf-notice]"),
    prevChapter:reader.querySelector("[data-reader-prev-chapter]"),nextChapter:reader.querySelector("[data-reader-next-chapter]"),bookmark:reader.querySelector("[data-reader-bookmark]"),
    ttsLaunch:reader.querySelector("[data-reader-tts-launch]"),ttsFloat:reader.querySelector("[data-reader-tts]"),ttsToggle:reader.querySelector("[data-tts-toggle]"),ttsRate:reader.querySelector("[data-tts-rate]"),ttsVoice:reader.querySelector("[data-tts-voice]"),ttsClose:reader.querySelector("[data-tts-close]"),ttsDrag:reader.querySelector("[data-tts-drag]"),online:reader.querySelector("[data-reader-online]"),selectionFloat:reader.querySelector("[data-reader-selection-float]"),selectionNote:reader.querySelector("[data-reader-selection-note]"),selectionHighlight:reader.querySelector("[data-reader-selection-highlight]"),selectionExcerpt:reader.querySelector("[data-reader-selection-excerpt]"),selectionRead:reader.querySelector("[data-reader-selection-read]"),notePopover:reader.querySelector("[data-reader-note-popover]"),noteSelection:reader.querySelector("[data-reader-note-selection]"),noteCancel:reader.querySelector("[data-reader-note-cancel]")
  };

  var state={
    book:null,readingState:null,annotations:[],mode:"text",objectUrl:"",searchTerm:"",searchMode:"contains",hits:[],hitIndex:-1,
    chapters:[],chapterIndex:0,toc:[],activeSidebar:"toc",fontScale:100,lineHeight:1.8,displayMode:"original",theme:"light",themeName:"everforest",dirty:false,searchSelected:new Set(),searchParagraphs:[],
    tts:{active:false,paused:false,rate:1,voiceName:"",voiceId:"",engine:"",voices:[],units:[],index:0,token:0,utterance:null,sentenceMark:null,wordMark:null,dragging:false,autoScroll:true,selectionText:"",requestId:""},
    pendingSelection:null,selectionTimer:0,epubData:null,epubEngine:null
  };
  var defaults={fontScale:100,lineHeight:1.8,displayMode:"original",theme:"light"};
  var notesKey="booknoteNotes";
  var searchWorker=null,searchRequestSeq=0,searchPending=new Map();

  function esc(s){return String(s==null?"":s).replace(/[&<>\"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
  function toast(msg){var t=document.getElementById("toast");if(t){t.textContent=msg;t.classList.add("show");setTimeout(function(){t.classList.remove("show");},1800);}}
  function key(id){return "booknoteReadingState:"+String(id||"");}
  function getState(id){return browser.storage.local.get(key(id)).then(function(r){return r[key(id)]||{progress:0,locator:{},highlights:[],bookmarks:[]};});}
  function setState(id,s){var o={};o[key(id)]=s;return browser.storage.local.set(o);}
  function getNotes(){return globalThis.BookLibraryDB?BookLibraryDB.listNotes():browser.storage.local.get(notesKey).then(function(r){return Array.isArray(r.booknoteNotes)?r.booknoteNotes:[];});}
  function setNotes(v){return globalThis.BookLibraryDB?BookLibraryDB.saveNotes(v):browser.storage.local.set((function(){var o={};o[notesKey]=v;return o;})());}
  function ensureReaderSummaryCategory(term){
    term=String(term||"").trim();
    if(!term)return Promise.resolve();
    return browser.storage.local.get("booknoteCategories").then(function(r){
      var cats=Array.isArray(r.booknoteCategories)?r.booknoteCategories.slice():[];
      if(cats.indexOf(term)<0)cats.push(term);
      return browser.storage.local.set({booknoteCategories:cats});
    });
  }
  function readerSummaryHtml(items,term){
    var safeTerm=esc(term||"搜索摘要");
    var html='<h2>搜索摘要：'+safeTerm+'</h2><p>来源书籍：'+esc(state.book&&((state.book.documentTitle||state.book.name||state.book.documentFileName)||"未命名书籍"))+'</p><p>搜索时间：'+esc(new Date().toLocaleString())+'</p><hr>';
    (items||[]).forEach(function(x,i){
      html+='<h3>'+(i+1)+'. '+esc(x.chapterLabel||"正文")+'</h3>'+sanitizeHtml(x.paragraphHtml||('<p>'+esc(x.paragraphText||"")+'</p>'));
    });
    return html;
  }
  function readerSummaryText(items,term){
    var out=["搜索摘要："+String(term||""),"","来源书籍："+String(state.book&&((state.book.documentTitle||state.book.name||state.book.documentFileName)||"未命名书籍")),"搜索时间："+new Date().toLocaleString(),"","—— 搜索结果 ——",""];
    (items||[]).forEach(function(x,i){out.push((i+1)+". "+String(x.chapterLabel||"正文"));out.push(String(x.paragraphText||"").trim());out.push("");});
    return out.join("\n").trim();
  }
  function saveReaderSearchSummary(mode){
    if(!state.searchTerm||!state.hits.length){toast("请先搜索当前书籍");return;}
    var items=state.searchParagraphs&&state.searchParagraphs.length?state.searchParagraphs:searchParagraphItems();
    if(mode==='selected')items=items.filter(function(x){return state.searchSelected.has(x.id);}).slice(0,20);
    if(!items.length){toast(mode==='selected'?"请先选择要保存的搜索结果":"没有找到可保存的搜索结果");return;}
    var term=String(state.searchTerm||"").trim(),now=new Date().toISOString(),bookTitle=String(state.book&&((state.book.documentTitle||state.book.name||state.book.documentFileName)||"未命名书籍")),name="搜索摘要："+term;
    var note={id:"search-summary-reader-"+Date.now()+"-"+Math.random().toString(36).slice(2,10),name:name,pageTitle:name,pageUrl:"",createdAt:now,updatedAt:now,category:term||"未分类",categoryType:"summary",sourceType:"search-summary",searchQuery:term,summaryMode:mode==='selected'?"selected":"all",summaryResultCount:items.length,selectedText:readerSummaryText(items,term),noteText:readerSummaryText(items,term),noteHtml:readerSummaryHtml(items,term),documentFormat:"",documentFileName:"",tags:[],pinned:false,favorite:false,bookId:state.book&&state.book.id||"",readerBookTitle:bookTitle,readerChapter:items.map(function(x){return x.chapterLabel||"正文";}).join("；")};
    toast("正在生成"+(mode==='selected'?"选中":"全部")+"搜索摘要笔记…");
    return ensureReaderSummaryCategory(term).then(function(){return browser.storage.local.get(notesKey);}).then(function(r){var ns=Array.isArray(r[notesKey])?r[notesKey]:[];ns.unshift(note);var o={};o[notesKey]=ns;return browser.storage.local.set(o);}).then(function(){state.searchSelected.clear();renderReaderSearchResults();toast("已保存搜索摘要笔记，分类："+(term||"未分类"));}).catch(function(e){console.error("reader save search summary",e);toast("保存摘要笔记失败："+(e&&e.message||"未知错误"));});
  }
  async function hydrateBook(book,needContent,needSource){if(!book||!globalThis.BookLibraryDB)return book;var id=String(book.id||"");if(!id)throw new Error("书籍 ID 为空");var meta=await BookLibraryDB.getMeta(id);if(!meta)throw new Error("书籍元数据不存在："+id);if(needContent){var content=await BookLibraryDB.getContent(id);if(content){meta.noteText=content.text||"";meta.documentOriginalText=content.text||"";meta.noteHtml=content.html||"";meta.documentOriginalHtml=content.html||"";if(Array.isArray(content.chapters))meta.documentChapters=content.chapters;}}if(needSource){var source=await BookLibraryDB.getSource(id);if(source&&source.blob)meta.__source=source;}return meta;}
  function decodeBase64(s){var bin=atob(String(s||"")),u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;}
  function bytesToText(bytes){return new TextDecoder("utf-8").decode(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes));}
  function importedTextNodes(root){var a=[],w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null),n;while((n=w.nextNode()))a.push(n);return a;}
  function pointAt(root,pos){var nodes=importedTextNodes(root),total=0;pos=Math.max(0,Number(pos)||0);for(var i=0;i<nodes.length;i++){var len=(nodes[i].nodeValue||"").length;if(pos<=total+len)return {node:nodes[i],offset:Math.max(0,pos-total)};total+=len;}if(nodes.length)return {node:nodes[nodes.length-1],offset:nodes[nodes.length-1].nodeValue.length};return null;}
  function chapterRootFromNode(node){var el=node&&node.nodeType===1?node:node&&node.parentElement;return el&&el.closest?el.closest("[data-chapter-index]"):null;}
  function engineSelectionOffsets(){if(!state.epubEngine)return null;var s=state.epubEngine.getSelection();if(!s)return null;return {start:s.start,end:s.end,text:s.text,chapterIndex:s.chapterIndex,chapterHref:s.chapterHref,locator:{version:2,chapterIndex:s.chapterIndex,chapterHref:s.chapterHref,start:s.start,end:s.end,quote:s.text,prefix:s.prefix,suffix:s.suffix},rect:s.rect};}
  function selectionOffsets(root){if(state.epubEngine)return engineSelectionOffsets();var sel=window.getSelection();if(!sel||!sel.rangeCount||sel.isCollapsed||!root.contains(sel.anchorNode)||!root.contains(sel.focusNode))return null;var range=sel.getRangeAt(0),chapter=chapterRootFromNode(sel.anchorNode),focusChapter=chapterRootFromNode(sel.focusNode);if(chapter&&focusChapter&&chapter!==focusChapter)return null;var localRoot=chapter||root,before=document.createRange();before.selectNodeContents(localRoot);before.setEnd(range.startContainer,range.startOffset);var start=before.toString().length,text=range.toString();var idx=chapter?Number(chapter.dataset.chapterIndex):state.chapterIndex;var href=chapter?String(chapter.dataset.chapterHref||""):(state.chapters[idx]&&state.chapters[idx].href)||"";var source=localRoot.textContent||"",prefix=source.slice(Math.max(0,start-40),start),suffix=source.slice(start+text.length,start+text.length+40);return {start:start,end:start+text.length,text:text,chapterIndex:idx,chapterHref:href,locator:{version:2,chapterIndex:idx,chapterHref:href,start:start,end:start+text.length,quote:text,prefix:prefix,suffix:suffix}};}
  function clearMarks(){Array.prototype.slice.call(els.content.querySelectorAll(".reader-search-hit,.reader-highlight")).forEach(function(e){e.replaceWith.apply(e,Array.prototype.slice.call(e.childNodes));});}
  function wrapRange(root,start,end,cls,attrs){if(end<=start)return;var a=pointAt(root,start),b=pointAt(root,end);if(!a||!b)return;var r=document.createRange();try{r.setStart(a.node,a.offset);r.setEnd(b.node,b.offset);}catch(_){return;}var nodes=[],w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null),n;while((n=w.nextNode())){if(n.nodeValue&&r.intersectsNode&&r.intersectsNode(n))nodes.push(n);}nodes.forEach(function(t){var st=0,en=t.nodeValue.length;if(t===a.node)st=a.offset;if(t===b.node)en=b.offset;if(en<=st)return;var tail=t.splitText(en),mid=t;if(st>0)mid=t.splitText(st);var mark=document.createElement("mark");mark.className=cls;if(attrs)Object.keys(attrs).forEach(function(k){mark.setAttribute(k,attrs[k]);});mid.parentNode.insertBefore(mark,mid);mark.appendChild(mid);});}
  function renderMarks(){
    if(state.epubEngine){var ci=state.chapterIndex,localHits=state.hits.filter(function(h){return Number(h.chapterIndex)===ci;});state.epubEngine.highlight(localHits,Math.max(0,localHits.findIndex(function(h){return h===state.hits[state.hitIndex];})));return;}
    clearMarks();if(!state.book)return;var st=state.readingState||{};
    (st.highlights||[]).forEach(function(h){var loc=h.locator&&Number(h.locator.version)>=2?h.locator:null;if(loc){var cr=els.content.querySelector('[data-chapter-index="'+Number(loc.chapterIndex)+'"]');if(cr)wrapRange(cr,Number(loc.start)||0,Number(loc.end)||0,"reader-highlight",{"data-color":h.color||"yellow"});}else wrapRange(els.content,Number(h.start)||0,Number(h.end)||0,"reader-highlight",{"data-color":h.color||"yellow"});});
    state.hits.forEach(function(h){
      var runs=Array.isArray(h.runs)&&h.runs.length?h.runs:[{start:h.start,end:h.end}];
      runs.forEach(function(run){wrapRange(els.content,Number(run.start)||0,Number(run.end)||0,"reader-search-hit",{});});
    });
    els.count.textContent=state.searchTerm?(state.hits.length?((state.hitIndex+1)+" / "+state.hits.length):"0 / 0"):"";
  }
  function ensureSearchWorker(){
    if(searchWorker)return searchWorker;
    try{searchWorker=new Worker(browser.runtime.getURL("js/booknote-search-worker.js"));
      searchWorker.onmessage=function(e){var d=e.data||{},item=searchPending.get(d.id);if(!item)return;searchPending.delete(d.id);if(d.type==='error')item.reject(Object.assign(new Error(d.message||'搜索失败'),{code:d.code||''}));else item.resolve(Array.isArray(d.matches)?d.matches:[]);};
      searchWorker.onerror=function(){searchPending.forEach(function(item){item.reject(new Error('搜索 Worker 不可用'));});searchPending.clear();searchWorker=null;};
    }catch(_){searchWorker=null;}
    return searchWorker;
  }
  function fallbackSearch(text,q,mode,limit){
    text=String(text||'');q=String(q||'');if(!q)return [];var options={matchCase:false,matchDiacritics:false,locale:document.documentElement.lang||'zh-CN'};
    var folded=function(v){return options.matchCase?v:v.toLocaleLowerCase(options.locale);};
    if(mode==='regex'){try{var rx=new RegExp(q,'giu'),a=[],m;while((m=rx.exec(text))!==null){if(m[0])a.push({start:m.index,end:m.index+m[0].length,runs:[{start:m.index,end:m.index+m[0].length}]});if(a.length>=limit)break;}return a;}catch(e){e.code='INVALID_REGEX';throw e;}}
    var needle=folded(q),src=folded(text),out=[],p=src.indexOf(needle);while(p>=0&&out.length<limit){out.push({start:p,end:p+needle.length,runs:[{start:p,end:p+needle.length}]});p=src.indexOf(needle,p+Math.max(1,needle.length));}
    if(mode==='whole-words'){var words=[];try{var seg=new Intl.Segmenter(options.locale,{granularity:'word'});for(var it=seg.segment(text),iter=it[Symbol.iterator](),step;(step=iter.next())&&!step.done;){var x=step.value;if(x.isWordLike)words.push({start:x.index,end:x.index+x.segment.length});}}catch(_){ }var starts=new Set(words.map(function(x){return x.start;})),ends=new Set(words.map(function(x){return x.end;}));out=out.filter(function(x){return starts.has(x.start)&&ends.has(x.end);});}
    return out;
  }
  function runSearchEngine(text,q,mode,limit){
    var worker=ensureSearchWorker(),requestId='s'+(++searchRequestSeq);
    if(!worker)return Promise.resolve(fallbackSearch(text,q,mode,limit));
    return new Promise(function(resolve,reject){searchPending.set(requestId,{resolve:resolve,reject:reject});worker.postMessage({type:'search',id:requestId,payload:{text:String(text||''),query:String(q||''),mode:mode||'contains',limit:limit||100,options:{matchCase:false,matchDiacritics:false,locale:document.documentElement.lang||'zh-CN',nearbyWords:10}}});});
  }
  function sanitizeHtml(html){var d=new DOMParser().parseFromString(String(html||""),"text/html");d.querySelectorAll("script,iframe,object,embed,form,link,meta,base").forEach(function(n){n.remove();});d.querySelectorAll("*").forEach(function(n){Array.prototype.slice.call(n.attributes).forEach(function(a){if(/^on/i.test(a.name)||a.name.toLowerCase()==="srcdoc")n.removeAttribute(a.name);});});return d.body?d.body.innerHTML:"";}
  function htmlFromText(text){return String(text||"").split(/\r?\n/).map(function(line){return line.trim()?"<p>"+esc(line)+"</p>":"<p class=\"reader-blank\"></p>";}).join("");}
  function bytesToDataUrl(bytes,mime){var u=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),bin="";for(var i=0;i<u.length;i+=0x8000)bin+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return "data:"+(mime||"application/octet-stream")+";base64,"+btoa(bin);}
  function imageMime(path){var ext=String(path).split(".").pop().toLowerCase();return {jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",gif:"image/gif",webp:"image/webp",svg:"image/svg+xml"}[ext]||"application/octet-stream";}
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
    var opf=new DOMParser().parseFromString(bytesToText(opfBytes),"application/xml"),manifest={},resources={};
    var manifestEls=childrenByName(opf,"item");manifestEls.forEach(function(item){var id=attr(item,"id"),href=resolvePath(opfPath,attr(item,"href").split("#")[0]),media=attr(item,"media-type"),properties=attr(item,"properties");if(id){manifest[id]={href:href,media:media,properties:properties};resources[href]={media:media,properties:properties};}});
    var spineEls=childrenByName(opf,"itemref").filter(function(e){return localName(e.parentElement)==="spine";}),chapters=[];
    for(var i=0;i<spineEls.length;i++){
      var idref=attr(spineEls[i],"idref"),item=manifest[idref];if(!item||!/x?html?/i.test(item.media))continue;
      var raw=await zip.get(item.href);if(!raw)continue;
      var doc=new DOMParser().parseFromString(bytesToText(raw),"text/html"),body=doc.body?doc.body.innerHTML:"";
      var text=(doc.body?doc.body.textContent:"").replace(/\s+/g," ").trim();
      var styles=[];doc.querySelectorAll('link[rel~="stylesheet"][href]').forEach(function(link){styles.push(resolvePath(item.href,attr(link,"href").split("#")[0]));});
      // Keep the book's semantic HTML and style tags. The new renderer isolates
      // each section in its own document instead of flattening the whole EPUB.
      body=sanitizeHtml(body);
      chapters.push({href:item.href,label:"",html:body,text:text,styles:styles,lang:doc.documentElement&&doc.documentElement.getAttribute("lang")||"",dir:doc.documentElement&&doc.documentElement.getAttribute("dir")||"",media:item.media});
    }
    if(!chapters.length)throw new Error("EPUB 没有可阅读章节");
    var title="",author="";childrenByName(opf,"title").some(function(e){title=(e.textContent||"").trim();return !!title;});childrenByName(opf,"creator").some(function(e){author=(e.textContent||"").trim();return !!author;});
    var navItem=manifestEls.find(function(item){return /\bnav\b/i.test(item.getAttribute("properties")||"");}),toc=[];
    if(navItem){var navBytes=await zip.get(navItem.href);if(navBytes){var ndoc=new DOMParser().parseFromString(bytesToText(navBytes),"text/html"),nav=Array.prototype.find.call(ndoc.querySelectorAll("nav"),function(n){return /\btoc\b/i.test(n.getAttribute("epub:type")||"")})||ndoc.querySelector("nav");if(nav){nav.querySelectorAll("a").forEach(function(a){var href=resolvePath(navItem.href,attr(a,"href"));toc.push({href:href.split("#")[0],fragment:(attr(a,"href").split("#")[1]||""),label:(a.textContent||"").replace(/\s+/g," ").trim()||href});});}}}
    if(!toc.length){chapters.forEach(function(ch,idx){var d=new DOMParser().parseFromString(ch.html,"text/html"),h=d.querySelector("h1,h2,h3,h4,h5,h6");toc.push({href:ch.href,label:(h?h.textContent:"").replace(/\s+/g," ").trim()||("第 "+(idx+1)+" 章")});});}
    chapters.forEach(function(ch,idx){var t=toc.find(function(x){return x.href===ch.href;});ch.label=t?t.label:("第 "+(idx+1)+" 章");});
    var offset=0;chapters.forEach(function(ch){ch.searchStart=offset;ch.searchEnd=offset+ch.text.length;offset=ch.searchEnd+1;});
    return {title:title,author:author,chapters:chapters,toc:toc,zip:zip,resources:resources,opfPath:opfPath,totalText:chapters.map(function(c){return c.text;}).join(" ")};
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
  function renderAnnotations(){
    if(!els.annotations)return;
    var items=Array.isArray(state.annotations)?state.annotations:[];
    var escText=function(x){return esc(x);};
    els.annotations.innerHTML=items.map(function(a,i){var type=a.type==="highlight"?"🟡":a.type==="bookmark"?"🔖":a.type==="quote"?"✂️":"📝";var title=a.chapterLabel||"阅读位置";var body=(a.note||a.text||"标记").replace(/\s+/g," ").trim().slice(0,140);return '<article class="reader-bookmark-item"><button type="button" data-annotation-index="'+i+'"><strong>'+type+' '+escText(title)+'</strong><span>'+escText(body)+'</span><small>'+((a.progress!=null)?Math.round(Number(a.progress)*100)+"%":"")+'</small></button><button type="button" class="reader-bookmark-delete" data-annotation-delete="'+i+'" aria-label="删除标记">×</button></article>';}).join("")||'<p class="reader-side-empty">暂无标记</p>';
    els.annotations.querySelectorAll("[data-annotation-index]").forEach(function(b){b.onclick=function(){var a=items[Number(b.dataset.annotationIndex)];if(a)restoreAnnotation(a);};});
    els.annotations.querySelectorAll("[data-annotation-delete]").forEach(function(b){b.onclick=function(e){e.stopPropagation();var a=items[Number(b.dataset.annotationDelete)];if(!a)return;var done=function(){state.annotations=state.annotations.filter(function(x){return x.id!==a.id;});renderAnnotations();renderMarks();};if(globalThis.BookNoteAnnotations)BookNoteAnnotations.remove(a.id).then(done).catch(function(){toast("删除标记失败");});else done();};});
  }
  function findQuoteInChapter(chapter,quote,prefix,suffix){if(!chapter||!quote)return null;var text=chapter.textContent||"",from=0,p;while((p=text.indexOf(quote,from))>=0){if((!prefix||text.slice(Math.max(0,p-prefix.length),p).endsWith(prefix))&&(!suffix||text.slice(p+quote.length,p+quote.length+suffix.length).startsWith(suffix))){var a=pointAt(chapter,p),b=pointAt(chapter,p+quote.length);if(a&&b){var r=document.createRange();try{r.setStart(a.node,a.offset);r.setEnd(b.node,b.offset);return {range:r,start:p,end:p+quote.length};}catch(_){}}}from=p+Math.max(1,quote.length);}return null;}
  function scrollToRange(range){if(!range)return false;try{var rect=range.getBoundingClientRect(),cr=els.content.getBoundingClientRect();els.content.scrollTop+=rect.top-cr.top-els.content.clientHeight*.35;return true;}catch(_){return false;}}
  function restoreAnnotation(a){
    var loc=a&&a.locator&&Number(a.locator.version)>=2?a.locator:null;
    var idx=loc&&Number.isFinite(Number(loc.chapterIndex))?Number(loc.chapterIndex):Number(a&&a.chapterIndex);
    if(state.epubEngine){
      if(!Number.isFinite(idx)||idx<0||idx>=state.chapters.length)idx=state.chapterIndex;
      var local=loc&&loc.start!=null?Number(loc.start):0;
      void gotoChapter(idx,0).then(function(){if(state.epubEngine)state.epubEngine.scrollToOffset(local);});
      return;
    }
    if(Number.isFinite(idx)&&idx>=0&&idx<state.chapters.length)gotoChapter(idx);
    setTimeout(function(){
      var chapter=els.content.querySelector('[data-chapter-index="'+(Number.isFinite(idx)?idx:state.chapterIndex)+'"]')||els.content;
      if(loc){
        var exact=findQuoteInChapter(chapter,String(loc.quote||a.text||""),String(loc.prefix||""),String(loc.suffix||""));
        if(exact&&scrollToRange(exact.range))return;
        var byOffset=pointAt(chapter,Number(loc.start)||0);if(byOffset&&byOffset.node){var rr=document.createRange();try{rr.setStart(byOffset.node,byOffset.offset);rr.collapse(true);if(scrollToRange(rr))return;}catch(_){}
        }
      }else if(a&&a.start!=null&&a.end!=null){var old=pointAt(els.content,Number(a.start)||0);if(old&&old.node){var ro=document.createRange();try{ro.setStart(old.node,old.offset);ro.collapse(true);if(scrollToRange(ro))return;}catch(_){} }}
      var max=Math.max(1,els.content.scrollHeight-els.content.clientHeight);if(a&&a.progress!=null)els.content.scrollTop=max*Math.max(0,Math.min(1,Number(a.progress)||0));
    },90);
  }
  function setSidebar(tab){state.activeSidebar=tab;els.toc.hidden=tab!=="toc";els.bookmarks.hidden=tab!=="bookmarks";if(els.annotations)els.annotations.hidden=tab!=="annotations";reader.querySelectorAll("[data-sidebar-tab]").forEach(function(b){b.classList.toggle("active",b.dataset.sidebarTab===tab);});}
  function applyTheme(){reader.dataset.readerTheme=state.theme;reader.dataset.readerPalette=state.themeName||"everforest";document.documentElement.style.setProperty("--booknote-reader-font",(state.fontScale/100)+"");}
  function applySettings(){
    els.content.style.setProperty("--reader-font-scale",String(state.fontScale/100));els.content.style.setProperty("--reader-line-height",String(state.lineHeight));
    els.font.value=String(state.fontScale);els.line.value=String(state.lineHeight);els.mode.value=state.displayMode;els.theme.textContent=state.theme==="dark"?"🌙 夜晚":"☀ 白天";
    applyTheme();
    if(state.epubEngine)state.epubEngine.setSettings({fontScale:state.fontScale,lineHeight:state.lineHeight,theme:state.theme});
  }
  function currentSectionProgress(){if(!state.epubEngine)return 0;var d=state.epubEngine.getDocument();if(!d||!d.documentElement)return 0;var max=Math.max(1,d.documentElement.scrollHeight-d.documentElement.clientHeight);return Math.min(1,Math.max(0,(d.documentElement.scrollTop||d.body&&d.body.scrollTop||0)/max));}
  function overallProgress(local){var count=Math.max(1,state.chapters.length),idx=Math.max(0,state.chapterIndex);return Math.min(1,Math.max(0,(idx+Math.max(0,Math.min(1,local||0)))/count));}
  function persistScroll(){
    if(!state.book||!state.readingState)return;var local=currentSectionProgress(),progress=overallProgress(local);state.readingState.progress=progress;state.readingState.locator={progress:progress,chapterIndex:state.chapterIndex,sectionProgress:local};state.readingState.updatedAt=Date.now();void setState(state.book.id,state.readingState);updateProgress();
  }
  function updateProgress(){var p=Number(state.readingState&&state.readingState.progress)||0;els.progress.textContent=Math.round(p*100)+"%";els.chapterLabel.textContent=(state.chapters[state.chapterIndex]&&state.chapters[state.chapterIndex].label)||"正文";els.prevChapter.disabled=state.chapterIndex<=0;els.nextChapter.disabled=state.chapterIndex>=state.chapters.length-1;els.bookmark.textContent="☆";var bs=state.readingState&&state.readingState.bookmarks||[];var here=bs.some(function(b){return Math.abs((Number(b.progress)||0)-p)<0.003&&Number(b.chapterIndex)===state.chapterIndex;});if(here)els.bookmark.textContent="★";}
  async function gotoChapter(index,localProgress){if(index<0||index>=state.chapters.length)return;state.chapterIndex=index;if(state.epubEngine){await state.epubEngine.load(index);state.epubEngine.setSettings({fontScale:state.fontScale,lineHeight:state.lineHeight,theme:state.theme});var d=state.epubEngine.getDocument();var sp=localProgress!=null?Number(localProgress):0;if(d){var max=Math.max(1,d.documentElement.scrollHeight-d.documentElement.clientHeight);d.documentElement.scrollTop=max*Math.max(0,Math.min(1,sp));}state.readingState.locator={progress:overallProgress(sp),chapterIndex:index,sectionProgress:sp};state.readingState.progress=overallProgress(sp);void setState(state.book.id,state.readingState);}renderToc();updateProgress();}
  function gotoHref(href){var raw=String(href||""),base=raw.split("#")[0],frag=raw.split("#")[1]||"",i=state.chapters.findIndex(function(c){return c.href===base||c.href.split("#")[0]===base;});if(i<0)i=state.chapters.findIndex(function(c){return c.href===raw;});if(i>=0){void gotoChapter(i,0).then(function(){if(frag&&state.epubEngine){var d=state.epubEngine.getDocument(),el=d&&d.getElementById(frag);if(el)el.scrollIntoView({block:"start"});}});}}
  function restoreBookmark(i){var b=(state.readingState.bookmarks||[])[i];if(!b)return;var local=b.sectionProgress!=null?Number(b.sectionProgress):0;void gotoChapter(Number(b.chapterIndex)||0,local);}
  function restorePosition(){var loc=state.readingState&&state.readingState.locator||{},idx=Number(loc.chapterIndex),local=loc.sectionProgress!=null?Number(loc.sectionProgress):0;if(!Number.isFinite(idx)||idx<0||idx>=state.chapters.length)idx=0;void gotoChapter(idx,local);}
  var readerSearchHistoryKey="booknoteSearchHistory",readerSearchHistory=[];
  function getReaderSearchHistory(){
    if(readerSearchHistory.length)return Promise.resolve(readerSearchHistory.slice());
    return browser.storage.local.get([readerSearchHistoryKey,"booknoteReaderSearchHistory"]).then(function(r){var shared=Array.isArray(r[readerSearchHistoryKey])?r[readerSearchHistoryKey]:[];var legacy=Array.isArray(r.booknoteReaderSearchHistory)?r.booknoteReaderSearchHistory:[];readerSearchHistory=shared.concat(legacy).filter(function(x){return typeof x==="string"&&x.trim();}).filter(function(x,i,a){return a.indexOf(x)===i;}).slice(0,20);if(!shared.length&&legacy.length)void browser.storage.local.set((function(){var o={};o[readerSearchHistoryKey]=readerSearchHistory;return o;})());return readerSearchHistory.slice();});
  }
  function renderReaderSearchHistory(filter){
    var box=reader.querySelector("[data-reader-search-history]");
    if(!box)return Promise.resolve();
    var term=String(filter==null?els.search.value||"":filter).trim().toLocaleLowerCase();
    return getReaderSearchHistory().then(function(items){
      var visible=term?items.filter(function(x){return x.toLocaleLowerCase().indexOf(term)>=0;}):items;
      box.innerHTML='<div class="reader-search-history-head"><span>搜索历史</span><button type="button" data-reader-search-clear title="清空阅读器搜索记录">清空记录</button></div>'+
        (visible.length?visible.map(function(x){return '<button type="button" class="reader-search-history-item" data-reader-search-history-item="'+esc(x)+'"><span>🕘</span><span class="reader-search-history-text">'+esc(x)+'</span></button>';}).join(""):'<div class="reader-search-history-empty">'+(items.length&&term?'没有匹配的搜索记录':'暂无搜索历史')+'</div>');
      box.querySelector("[data-reader-search-clear]").onclick=function(e){
        e.preventDefault();e.stopPropagation();
        browser.storage.local.remove(readerSearchHistoryKey).then(function(){renderReaderSearchHistory("");toast("阅读器搜索历史已清空");});
      };
      box.querySelectorAll("[data-reader-search-history-item]").forEach(function(el){
        el.onclick=function(e){
          e.preventDefault();e.stopPropagation();
          els.search.value=el.getAttribute("data-reader-search-history-item")||"";
          hideReaderSearchHistory();
          searchBook();
        };
      });
    });
  }
  function showReaderSearchHistory(){
    var box=reader.querySelector("[data-reader-search-history]");
    if(!box)return;
    box.hidden=false;box.classList.add("open");renderReaderSearchHistory();
  }
  function hideReaderSearchHistory(){
    var box=reader.querySelector("[data-reader-search-history]");
    if(!box)return;
    box.classList.remove("open");box.hidden=true;
  }
  function saveReaderSearchHistory(term){
    term=String(term||"").trim();if(!term)return Promise.resolve();
    return getReaderSearchHistory().then(function(items){
      items=items.filter(function(x){return x!==term;});items.unshift(term);items=items.slice(0,20);readerSearchHistory=items.slice();
      return browser.storage.local.set((function(){var o={};o[readerSearchHistoryKey]=items;return o;})()).then(function(){renderReaderSearchHistory();});
    });
  }
  function searchBook(){
    state.searchTerm=String(els.search.value||"").trim();state.searchMode=String(els.searchMode&&els.searchMode.value||state.searchMode||"contains");state.hitIndex=state.searchTerm?0:-1;state.searchSelected.clear();state.searchParagraphs=[];
    if(state.searchTerm)void saveReaderSearchHistory(state.searchTerm);
    if(!state.searchTerm){state.hits=[];renderMarks();if(els.searchExport)els.searchExport.disabled=true;renderReaderSearchResults();hideReaderSearchHistory();return;}
    var seq=++searchRequestSeq,text=state.epubData&&state.epubData.totalText?state.epubData.totalText:(els.content.textContent||"");
    if(els.searchExport)els.searchExport.disabled=true;
    els.count.textContent="搜索中…";
    runSearchEngine(text,state.searchTerm,state.searchMode,500).then(function(hits){
      if(seq!==searchRequestSeq)return;
      if(state.epubData){
        hits=(hits||[]).map(function(h){var ci=0;for(var i=0;i<state.chapters.length;i++){var c=state.chapters[i];if(h.start>=c.searchStart&&h.start<=c.searchEnd){ci=i;break;}}var c=state.chapters[ci]||{};return Object.assign({},h,{chapterIndex:ci,localStart:Math.max(0,h.start-(c.searchStart||0)),localEnd:Math.max(0,h.end-(c.searchStart||0))});});
      }
      state.hits=hits||[];renderMarks();if(els.searchExport)els.searchExport.disabled=!state.hits.length;renderReaderSearchResults();if(state.hits.length)void scrollToOffset(state.hits[0].start);
    }).catch(function(e){
      if(seq!==searchRequestSeq)return;state.hits=[];renderMarks();if(els.searchExport)els.searchExport.disabled=true;toast("搜索失败："+(e&&e.message||"未知错误"));
    });
    hideReaderSearchHistory();
  }
  function searchParagraphItems(){
    var out=[],seen=new Set();
    if(!state.searchTerm||!state.hits.length)return out;
    if(state.epubData){
      for(var i=0;i<state.hits.length;i++){
        var h=state.hits[i],ci=Number(h.chapterIndex)||0,ch=state.chapters[ci]||{},text=String(ch.text||"");
        var ls=Math.max(0,Number(h.localStart)||0),a=Math.max(0,text.lastIndexOf("\n",ls)),b=text.indexOf("\n",ls);if(a<0)a=0;if(b<0)b=text.length;
        var para=text.slice(a,b).replace(/\s+/g," ").trim();if(!para)para=text.slice(Math.max(0,ls-80),Math.min(text.length,ls+180)).replace(/\s+/g," ").trim();
        var key=String(ci)+"|"+para;if(seen.has(key))continue;seen.add(key);
        out.push({id:String(ci)+"|"+out.length,sourceHitIndex:i,bookId:String(state.book&&state.book.id||""),bookTitle:String(state.book&&((state.book.documentTitle||state.book.name||state.book.documentFileName)||"")||""),chapterIndex:ci,chapterLabel:String(ch.label||""),paragraphHtml:"<p>"+esc(para)+"</p>",paragraphText:para,matchText:String(state.searchTerm)});
      }
      return out;
    }
    for(var i=0;i<state.hits.length;i++){
      var h=state.hits[i],p=pointAt(els.content,h.start);if(!p)continue;
      var el=p.node&&p.node.parentElement,block=el&&el.closest?el.closest('h1,h2,h3,h4,h5,h6,p,blockquote,li,pre,dt,dd'):null;
      if(!block)block=el&&el.closest?el.closest('[data-chapter-index]'):null;
      if(!block)continue;
      var chapter=block.closest?block.closest('[data-chapter-index]'):null,ci=chapter?Number(chapter.dataset.chapterIndex):state.chapterIndex,key=String(ci)+'|'+(block.textContent||'');
      if(seen.has(key))continue;seen.add(key);
      out.push({id:String(ci)+'|'+out.length,sourceHitIndex:i,bookId:String(state.book&&state.book.id||''),bookTitle:String(state.book&&((state.book.documentTitle||state.book.name||state.book.documentFileName)||'')||''),chapterIndex:ci,chapterLabel:String((state.chapters[ci]||{}).label||''),paragraphHtml:block.outerHTML,paragraphText:String(block.textContent||'').replace(/\s+/g,' ').trim(),matchText:String(state.searchTerm)});
    }
    return out;
  }
  function renderReaderSearchResults(){
    var box=reader.querySelector('[data-reader-search-results]');if(!box)return;
    if(!state.searchTerm||!state.hits.length){box.hidden=true;box.innerHTML='';return;}
    state.searchParagraphs=searchParagraphItems();
    box.hidden=false;
    box.innerHTML='<div class="reader-search-results-head"><strong>搜索结果段落</strong><span>'+state.searchParagraphs.length+' 个段落</span><span class="reader-search-results-actions"><span class="reader-search-results-action-group"><b>导出</b><button type="button" data-reader-export-all '+(state.searchParagraphs.length?'':'disabled')+'>📘 全部搜索结果</button><button type="button" data-reader-export-selected '+(state.searchSelected.size?'':'disabled')+'>☑ 选中（'+state.searchSelected.size+'/20）</button></span><span class="reader-search-results-action-group save"><b>保存</b><button type="button" data-reader-save-summary-all '+(state.searchParagraphs.length?'':'disabled')+'>📝 全部为摘要笔记</button><button type="button" data-reader-save-summary-selected '+(state.searchSelected.size?'':'disabled')+'>☑ 选中为摘要笔记（'+state.searchSelected.size+'/20）</button></span></span></div>'+(state.searchParagraphs.length?'<div class="reader-search-results-list">'+state.searchParagraphs.map(function(x,i){var checked=state.searchSelected.has(x.id);return '<label class="reader-search-result-item"><input type="checkbox" data-reader-search-select="'+esc(x.id)+'" '+(checked?'checked':'')+'><span><b>'+(i+1)+'. '+esc(x.chapterLabel||'正文')+'</b><small>'+esc(x.paragraphText||'')+'</small></span></label>';}).join('')+'</div>':'<div class="reader-search-results-empty">没有可摘取的段落。</div>');
    box.querySelectorAll('[data-reader-search-select]').forEach(function(cb){cb.onchange=function(){var id=String(cb.getAttribute('data-reader-search-select'));if(cb.checked){if(state.searchSelected.size>=20){cb.checked=false;toast('最多选择 20 个段落');return;}state.searchSelected.add(id);}else state.searchSelected.delete(id);renderReaderSearchResults();};});
    var all=box.querySelector('[data-reader-export-all]');if(all)all.onclick=function(){exportReaderSearchParagraphs('all');};
    var selected=box.querySelector('[data-reader-export-selected]');if(selected)selected.onclick=function(){exportReaderSearchParagraphs('selected');};
    var saveAll=box.querySelector('[data-reader-save-summary-all]');if(saveAll)saveAll.onclick=function(){saveReaderSearchSummary('all');};
    var saveSelected=box.querySelector('[data-reader-save-summary-selected]');if(saveSelected)saveSelected.onclick=function(){saveReaderSearchSummary('selected');};
  }
  function exportReaderSearchParagraphs(mode){
    if(!state.searchTerm||!state.hits.length){toast('请先搜索当前书籍');return;}
    if(!globalThis.BookNoteSearchIndex||!BookNoteSearchIndex.buildOdtBlob){toast('搜索导出模块未就绪');return;}
    var items=state.searchParagraphs&&state.searchParagraphs.length?state.searchParagraphs:searchParagraphItems();
    if(mode==='selected')items=items.filter(function(x){return state.searchSelected.has(x.id);}).slice(0,20);
    if(!items.length){toast(mode==='selected'?'请先选择要导出的搜索结果':'没有找到可摘取的段落');return;}
    var blob=BookNoteSearchIndex.buildOdtBlob(items,state.searchTerm),url=URL.createObjectURL(blob),filename=BookNoteSearchIndex.safeOdtFilename(state.searchTerm);
    toast('正在生成 '+(mode==='selected'?'选中':'全部')+'搜索结果…');
    browser.downloads.download({url:url,filename:filename,saveAs:true,conflictAction:'uniquify'}).then(function(){setTimeout(function(){URL.revokeObjectURL(url);},10000);toast('已导出 '+items.length+' 个搜索结果段落');}).catch(function(e){toast('导出失败：'+(e&&e.message||'未知错误'));});
  }

  async function scrollToOffset(pos){
    if(state.epubData&&state.epubEngine){var h=state.hits.find(function(x){return Number(x.start)===Number(pos);})||null,ci=h&&h.chapterIndex!=null?Number(h.chapterIndex):0,c=state.chapters[ci]||{},local=h&&h.localStart!=null?Number(h.localStart):Math.max(0,Number(pos)-(c.searchStart||0));if(ci!==state.chapterIndex)await gotoChapter(ci,0);state.epubEngine.scrollToOffset(local);state.epubEngine.highlight(state.hits.filter(function(x){return Number(x.chapterIndex)===ci;}),Math.max(0,state.hits.filter(function(x){return Number(x.chapterIndex)===ci;}).findIndex(function(x){return x===h;})));return true;}
    var p=pointAt(els.content,pos);if(!p)return false;var r=document.createRange();r.setStart(p.node,p.offset);r.collapse(true);var rect=r.getBoundingClientRect(),cr=els.content.getBoundingClientRect();els.content.scrollTop+=rect.top-cr.top-els.content.clientHeight*.35;return true;
  }
  function moveHit(dir){if(!state.hits.length)return;state.hitIndex=(state.hitIndex+dir+state.hits.length)%state.hits.length;renderMarks();void scrollToOffset(state.hits[state.hitIndex].start);}
  function toggleBookmark(){if(!state.book)return;persistScroll();var p=Number(state.readingState.progress)||0,bs=state.readingState.bookmarks||[],existing=bs.find(function(b){return Number(b.chapterIndex)===state.chapterIndex&&Math.abs((Number(b.progress)||0)-p)<0.003;});if(existing){var rid=existing.id;var remove=globalThis.BookNoteAnnotations?BookNoteAnnotations.remove(rid):Promise.resolve();void remove.then(function(){state.annotations=state.annotations.filter(function(a){return a.id!==rid;});var idx=bs.indexOf(existing);if(idx>=0)bs.splice(idx,1);return setState(state.book.id,state.readingState);}).then(function(){renderBookmarks();renderAnnotations();updateProgress();toast("已取消书签");});return;}var excerpt=(state.epubEngine?state.epubEngine.getText():(els.content.textContent||"")).replace(/\s+/g," ").trim().slice(0,150);var a={id:"bookmark-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),bookId:state.book.id,type:"bookmark",text:excerpt,chapterIndex:state.chapterIndex,progress:p,chapterLabel:(state.chapters[state.chapterIndex]||{}).label||"",locator:state.readingState.locator||{}};void (globalThis.BookNoteAnnotations?BookNoteAnnotations.upsert(a):Promise.resolve(a)).then(function(saved){state.annotations.push(saved);bs.unshift({id:saved.id,chapterIndex:saved.chapterIndex,progress:saved.progress,chapterLabel:saved.chapterLabel,excerpt:saved.text,createdAt:saved.createdAt});state.readingState.bookmarks=bs;return setState(state.book.id,state.readingState);}).then(function(){renderBookmarks();renderAnnotations();updateProgress();toast("书签已保存");});}
  function addHighlight(){var s=selectionOffsets(els.content);if(!state.book||!s||!s.text.trim()){toast("请先选择正文");return;}var a={id:"highlight-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),bookId:state.book.id,type:"highlight",start:s.start,end:s.end,color:"yellow",text:s.text,chapterIndex:s.chapterIndex!=null?s.chapterIndex:state.chapterIndex,chapterLabel:(state.chapters[s.chapterIndex!=null?s.chapterIndex:state.chapterIndex]||{}).label||"",progress:Number(state.readingState&&state.readingState.progress)||0,locator:s.locator||{}};var save=globalThis.BookNoteAnnotations?BookNoteAnnotations.upsert(a):Promise.resolve(a);void save.then(function(saved){state.annotations.push(saved);var hs=state.readingState.highlights||[];hs.push({id:saved.id,start:saved.start,end:saved.end,color:saved.color,text:saved.text,chapterIndex:saved.chapterIndex,chapterLabel:saved.chapterLabel,progress:saved.progress,locator:saved.locator||{}});state.readingState.highlights=hs;return setState(state.book.id,state.readingState);}).then(function(){renderMarks();renderAnnotations();window.getSelection().removeAllRanges();toast("高亮已保存");}).catch(function(){toast("高亮保存失败");});}
  function saveExcerpt(){var s=selectionOffsets(els.content);if(!state.book||!s||!s.text.trim()){toast("请先选择正文");return;}var now=new Date().toISOString(),a={id:"quote-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),bookId:state.book.id,type:"quote",text:s.text,start:s.start,end:s.end,chapterIndex:s.chapterIndex!=null?s.chapterIndex:state.chapterIndex,chapterLabel:(state.chapters[s.chapterIndex!=null?s.chapterIndex:state.chapterIndex]||{}).label||"",progress:Number(state.readingState&&state.readingState.progress)||0,locator:s.locator||{}};Promise.resolve(globalThis.BookNoteAnnotations?BookNoteAnnotations.upsert(a):a).then(function(saved){state.annotations.push(saved);return getNotes().then(function(ns){ns.unshift({id:"reader-excerpt-"+Date.now(),name:state.book.name||state.book.documentFileName||"阅读摘录",pageTitle:state.book.name||state.book.documentFileName,category:"阅读摘录",categoryType:"excerpt",sourceType:"book-reader",selectedText:s.text,noteText:"",createdAt:now,updatedAt:now,bookId:state.book.id,documentFormat:state.book.documentFormat,readerChapter:a.chapterLabel,readerProgress:a.progress,annotationId:saved.id});return setNotes(ns);});}).then(function(){renderAnnotations();window.getSelection().removeAllRanges();toast("摘录已保存");});}
  function saveNote(){
    var text=String(els.note.value||"").trim(),sel=state.pendingSelection;
    if(!state.book||!text){toast("请输入笔记内容");return;}
    var selected=sel&&sel.text||"",now=new Date().toISOString(),a={id:"note-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),bookId:state.book.id,type:"note",text:selected,note:text,start:sel&&sel.start,end:sel&&sel.end,chapterIndex:sel&&sel.chapterIndex!=null?sel.chapterIndex:state.chapterIndex,chapterLabel:(state.chapters[sel&&sel.chapterIndex!=null?sel.chapterIndex:state.chapterIndex]||{}).label||"",progress:Number(state.readingState&&state.readingState.progress)||0,locator:sel&&sel.locator||{}};
    Promise.resolve(globalThis.BookNoteAnnotations?BookNoteAnnotations.upsert(a):a).then(function(saved){state.annotations.push(saved);return getNotes().then(function(ns){ns.unshift({id:"reader-note-"+Date.now(),name:"阅读笔记 · "+(state.book.name||state.book.documentFileName||"书籍"),pageTitle:state.book.name||state.book.documentFileName,category:"阅读笔记",categoryType:"note",sourceType:"book-reader",selectedText:selected,noteText:text,createdAt:now,updatedAt:now,bookId:state.book.id,documentFormat:state.book.documentFormat,readerChapter:a.chapterLabel,readerProgress:a.progress,annotationId:saved.id});return setNotes(ns);});}).then(function(){
      els.note.value="";state.pendingSelection=null;
      if(els.notePopover)els.notePopover.hidden=true;if(els.selectionFloat)els.selectionFloat.hidden=true;
      toast("📝 阅读笔记已保存");
    }).catch(function(){toast("笔记保存失败");});
  }
  function getReaderSelection(){
    if(state.mode==="pdf")return null;
    if(state.epubEngine){var es=engineSelectionOffsets();if(!es)return null;var hostRect=els.content.getBoundingClientRect();return {text:es.text,start:es.start,end:es.end,chapterIndex:es.chapterIndex,chapterHref:es.chapterHref,locator:es.locator,rect:{left:hostRect.left+Number(es.rect.left||0),top:hostRect.top+Number(es.rect.top||0),right:hostRect.left+Number(es.rect.right||0),bottom:hostRect.top+Number(es.rect.bottom||0)}};}
    var sel=window.getSelection();if(!sel||!sel.rangeCount||sel.isCollapsed)return null;
    var text=String(sel.toString()||"").replace(/\s+/g," ").trim();if(!text||!els.content.contains(sel.anchorNode)||!els.content.contains(sel.focusNode))return null;
    var range=sel.getRangeAt(0),rect=range.getBoundingClientRect();if(!rect||(!rect.width&&!rect.height))return null;
    var offsets=selectionOffsets(els.content);return {text:text,start:offsets&&offsets.start||0,end:offsets&&offsets.end||0,chapterIndex:offsets&&offsets.chapterIndex!=null?offsets.chapterIndex:state.chapterIndex,chapterHref:offsets&&offsets.chapterHref||"",locator:offsets&&offsets.locator||{},rect:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom}};
  }
  function hideSelectionFloat(){if(els.selectionFloat)els.selectionFloat.hidden=true;}
  function positionSelectionFloat(){
    var s=state.pendingSelection;if(!s||!els.selectionFloat)return;
    var r=s.rect||{},w=els.selectionFloat.offsetWidth||300,h=els.selectionFloat.offsetHeight||40;
    var x=(Number(r.left)+Number(r.right))/2, y=Number(r.top)-8;
    x=Math.max(w/2+8,Math.min(window.innerWidth-w/2-8,x));
    if(y-h<8)y=Math.min(window.innerHeight-8,Number(r.bottom)+h+8);
    els.selectionFloat.style.left=x+"px";els.selectionFloat.style.top=y+"px";els.selectionFloat.hidden=false;
  }
  function captureReaderSelection(){clearTimeout(state.selectionTimer);state.selectionTimer=setTimeout(function(){var s=getReaderSelection();if(!s){hideSelectionFloat();return;}state.pendingSelection=s;positionSelectionFloat();},35);}
  function openReaderNote(){if(!state.pendingSelection){toast("请先选择正文");return;}if(!els.notePopover)return;els.noteSelection.textContent=state.pendingSelection.text.slice(0,1000);els.note.value="";els.notePopover.hidden=false;setTimeout(function(){try{els.note.focus();}catch(_){ }},0);}
  function ttsReadSelection(){var s=state.pendingSelection;if(!s){toast("请先选择正文");return;}if(state.mode==="pdf"){toast("PDF 当前使用原始阅读器");return;}state.tts.selectionText=s.text;ttsStart(0);}
  function markdownFromSnapshot(snapshot){var title=String(snapshot.title||"网页文章").trim()||"网页文章",url=String(snapshot.url||"").trim(),text=String(snapshot.text||"").replace(/\r/g,"").trim();var paras=text.split(/\n{2,}/).map(function(x){return x.replace(/\n+/g," ").replace(/\s{2,}/g," ").trim();}).filter(Boolean);return "# "+title+"\n\n来源："+url+"\n\n"+paras.join("\n\n");}
  function importOnlinePage(){
    var raw=window.prompt("输入网页地址（http/https）：","https://");if(raw===null)return;var url=String(raw||"").trim();if(!/^https?:\/\//i.test(url)){toast("请输入 http:// 或 https:// 网页地址");return;}if(!els.online)return;
    els.online.disabled=true;els.online.textContent="⏳ 读取网页…";var tabId=null,tries=0;
    function closeTab(){if(tabId!==null){try{browser.tabs.remove(tabId);}catch(_){ }tabId=null;}}
    function finish(){els.online.disabled=false;els.online.textContent="🌐 网上加入";}
    function request(){tries++;browser.tabs.sendMessage(tabId,{type:"booknote-get-page-snapshot"}).then(function(snapshot){if(!snapshot||!snapshot.text)throw new Error("网页正文为空");var md=markdownFromSnapshot(snapshot),now=new Date().toISOString();return getNotes().then(function(ns){var title=String(snapshot.title||url).replace(/[\\/:*?"<>|]+/g,"_").slice(0,90)||"网上文章",name=title+".md",html=htmlFromText(md),existing=ns.find(function(n){return n&&n.sourceType==="imported-document"&&String(n.pageUrl||"")===String(snapshot.url||url);});if(existing){existing.noteText=md;existing.noteHtml=html;existing.documentOriginalText=md;existing.documentOriginalHtml=html;existing.documentFormat="md";existing.documentFileName=name;existing.name=name;existing.pageTitle=title;existing.updatedAt=now;existing.documentModified=false;return setNotes(ns).then(function(){return {updated:true,record:existing};});}var record={id:"web-doc-"+Date.now()+"-"+Math.random().toString(36).slice(2,9),name:name,pageTitle:title,pageUrl:String(snapshot.url||url),createdAt:now,updatedAt:now,category:"网上加入",categoryType:"document",sourceType:"imported-document",documentFileName:name,selectedText:"",noteText:md,noteHtml:html,documentFormat:"md",documentOriginalHtml:html,documentOriginalText:md,documentOriginalBase64:"",documentEncoding:"utf-8",documentEncodingBom:false,documentModified:false,favorite:false,pinned:false,excerptHighlights:[],documentEditable:true};ns.unshift(record);return setNotes(ns).then(function(){return {updated:false,record:record};});});}).then(function(result){closeTab();finish();try{if(typeof render==="function")render();}catch(_){ }toast(result.updated?"🌐 已更新网页文档":"🌐 网页已加入文档管理");if(result.record)openBook(result.record);}).catch(function(){if(tries<12){setTimeout(request,500);return;}closeTab();finish();toast("网页读取失败：页面可能禁止扩展读取");});}
    browser.tabs.create({url:url,active:false}).then(function(tab){tabId=tab.id;setTimeout(request,900);}).catch(function(){finish();toast("无法打开网页");});
  }
  var ttsRates=[0.5,0.75,1,1.25,1.5,2];
  function ttsNormalizeText(s){return String(s||"").replace(/\s+/g," ").trim();}
  function ttsGetSharedVoice(){
    return browser.storage.local.get(["voiceName","voice","selectedVoice","rate","engine","ttsEngine"]).then(function(r){
      var v=r.voice||r.selectedVoice||{};
      return {voiceName:r.voiceName||v.voiceName||v.name||"",voiceId:v.localVoiceId||v.voiceId||v.id||"",engine:r.engine||r.ttsEngine||(v.engine||"")||"",voice:v&&typeof v==="object"?v:null};
    });
  }
  function ttsDisplayVoiceLabel(){
    var v=ttsCurrentVoice();
    if(state.tts.voiceName)return state.tts.voiceName;
    if(v&&v.name)return v.name;
    if(state.tts.voiceId)return state.tts.voiceId;
    return "默认朗读人";
  }
  function ttsClearMarks(){
    [state.tts.sentenceMark,state.tts.wordMark].forEach(function(mark){
      if(mark&&mark.parentNode){var parent=mark.parentNode;while(mark.firstChild)parent.insertBefore(mark.firstChild,mark);parent.removeChild(mark);}
    });
    state.tts.sentenceMark=null;state.tts.wordMark=null;
  }
  function ttsRangeForText(root,text){
    var wanted=ttsNormalizeText(text),nodes=importedTextNodes(root),joined="",map=[];
    nodes.forEach(function(n){var t=n.nodeValue||"",start=joined.length;joined+=ttsNormalizeText(t);map.push({node:n,start:start,end:joined.length});});
    var normalized=ttsNormalizeText(joined),idx=normalized.indexOf(wanted);if(idx<0)return null;
    var startNode=null,endNode=null,startOffset=0,endOffset=0;
    for(var i=0;i<map.length;i++){
      if(startNode===null&&idx>=map[i].start&&idx<=map[i].end){startNode=map[i].node;startOffset=Math.max(0,Math.min((map[i].node.nodeValue||"").length,idx-map[i].start));}
      if(idx+wanted.length>=map[i].start&&idx+wanted.length<=map[i].end){endNode=map[i].node;endOffset=Math.max(0,Math.min((map[i].node.nodeValue||"").length,idx+wanted.length-map[i].start));break;}
    }
    if(!startNode||!endNode)return null;var r=document.createRange();r.setStart(startNode,startOffset);r.setEnd(endNode,endOffset);return r;
  }
  function ttsMarkUnit(unit){
    ttsClearMarks();if(!unit)return;
    if(unit.selectionStart!=null&&unit.selectionEnd!=null){
      wrapRange(els.content,Number(unit.selectionStart)||0,Number(unit.selectionEnd)||0,"reader-tts-sentence",{});state.tts.sentenceMark=els.content.querySelector("mark.reader-tts-sentence");
    }else if(unit.node){
      var sentence=document.createElement("mark");sentence.className="reader-tts-sentence";
      try{var r=document.createRange();r.selectNodeContents(unit.node);r.surroundContents(sentence);state.tts.sentenceMark=sentence;}catch(_){state.tts.sentenceMark=null;}
    }
    if(state.tts.sentenceMark&&state.tts.autoScroll){try{state.tts.sentenceMark.scrollIntoView({block:"center",behavior:"smooth"});}catch(_){state.tts.sentenceMark.scrollIntoView();}}
  }
  function ttsMarkWord(unit,startIndex,endIndex){
    if(!unit||!state.tts.sentenceMark)return;
    var text=unit.text.slice(Math.max(0,startIndex),Math.max(startIndex,endIndex));if(!text)return;
    var range=ttsRangeForText(state.tts.sentenceMark,text);if(!range)return;
    try{var word=document.createElement("mark");word.className="reader-tts-word";range.surroundContents(word);state.tts.wordMark=word;}catch(_){state.tts.wordMark=null;}
  }
  function ttsSentenceParts(text){
    var src=ttsNormalizeText(text),parts=[],last=0,m,rx=/[^。！？!?]+[。！？!?]+|[^。！？!?]+$/g;
    while((m=rx.exec(src))!==null){var p=ttsNormalizeText(m[0]);if(p)parts.push(p);last=rx.lastIndex;}
    if(!parts.length&&src)parts.push(src);return parts;
  }
  function ttsBuildUnits(){
    var root=els.content,units=[],candidates=[];
    if(!root)return units;
    candidates=Array.prototype.filter.call(root.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th"),function(el){
      if(el.closest(".reader-tts-float,.reader-tts-launch"))return false;
      return !el.querySelector("p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th")&&ttsNormalizeText(el.textContent||"").length>0;
    });
    if(!candidates.length)candidates=Array.prototype.filter.call(root.children||[],function(el){return ttsNormalizeText(el.textContent||"").length>0;});
    candidates.forEach(function(node){ttsSentenceParts(node.textContent||"").forEach(function(text){units.push({text:text,node:node});});});
    return units;
  }
  function ttsFindVoiceList(){
    return Array.isArray(state.tts.voices)?state.tts.voices.filter(function(v){return v&&String(v.voiceName||v.name||"");}).sort(function(a,b){return String(a.lang||"").localeCompare(String(b.lang||""))||String(a.voiceName||a.name||"").localeCompare(String(b.voiceName||b.name||""));}):[];
  }
  function ttsPopulateVoices(){
    if(!els.ttsVoice)return Promise.resolve();
    var voices=ttsFindVoiceList(),previous=state.tts.voiceName;els.ttsVoice.innerHTML="";
    if(!voices.length){var empty=document.createElement("option");empty.value="";empty.textContent="默认朗读人";els.ttsVoice.appendChild(empty);return Promise.resolve();}
    voices.forEach(function(v){var name=String(v.voiceName||v.name||"");var o=document.createElement("option");o.value=name;o.textContent=name+(v.lang?" · "+v.lang:"");els.ttsVoice.appendChild(o);});
    var chosen=voices.find(function(v){return String(v.voiceName||v.name||"")===previous;})||voices.find(function(v){return /^zh(-|$)/i.test(v.lang||"");})||voices.find(function(v){return /^en(-|$)/i.test(v.lang||"");})||voices[0];
    if(chosen){state.tts.voiceName=String(chosen.voiceName||chosen.name||"");els.ttsVoice.value=state.tts.voiceName;}
    return Promise.resolve();
  }
  function ttsLoadVoiceRegistry(){
    return Promise.all([browser.runtime.sendMessage({method:"getSpeechVoices",args:[]}).catch(function(){return []; }),ttsGetSharedVoice()]).then(function(all){
      state.tts.voices=Array.isArray(all[0])?all[0]:[];var shared=all[1]||{};
      state.tts.voiceName=state.tts.voiceName||shared.voiceName||"";state.tts.voiceId=shared.voiceId||"";state.tts.engine=shared.engine||"";state.tts.sharedVoice=shared.voice||null;
      return ttsPopulateVoices();
    });
  }
  function ttsSaveSettings(){var o={rate:state.tts.rate,voiceName:state.tts.voiceName,autoScroll:state.tts.autoScroll};var x={};x.booknoteReaderTtsSettings=o;return browser.storage.local.set(x);}
  function ttsLoadSettings(){return Promise.all([browser.storage.local.get(["booknoteReaderTtsSettings","voiceName","rate"]),ttsGetSharedVoice()]).then(function(all){var r=all[0],shared=all[1],x=r.booknoteReaderTtsSettings||{},legacyRate=Number(r.rate);state.tts.rate=ttsRates.indexOf(Number(x.rate))>=0?Number(x.rate):(ttsRates.indexOf(legacyRate)>=0?legacyRate:1);state.tts.voiceName=x.voiceName||shared.voiceName||r.voiceName||"";state.tts.voiceId=x.voiceId||shared.voiceId||"";state.tts.engine=x.engine||shared.engine||"";state.tts.sharedVoice=shared.voice||null;state.tts.autoScroll=x.autoScroll!==false;updateTtsUi();});}
  function updateTtsUi(){
    if(!els.ttsRate||!els.ttsToggle)return;
    els.ttsRate.textContent=String(state.tts.rate).replace(/\.0$/,"x");
    if(String(els.ttsRate.textContent).slice(-1)!="x")els.ttsRate.textContent=String(state.tts.rate)+"×";
    els.ttsToggle.textContent=state.tts.active&&!state.tts.paused?"Ⅱ":(state.tts.paused?"▶":"▶");
    els.ttsLaunch.hidden=state.tts.active||state.mode==="pdf";els.ttsFloat.hidden=!state.tts.active||state.mode==="pdf";
  }
  function ttsCurrentVoice(){
    var voices=ttsFindVoiceList(),name=state.tts.voiceName;return voices.find(function(v){return String(v.voiceName||v.name||"")===name;})||state.tts.sharedVoice||voices.find(function(v){return /^zh(-|$)/i.test(v.lang||"");})||voices[0]||null;
  }
  function ttsStop(keepPlayer){
    var requestId=state.tts.requestId;state.tts.token++;state.tts.active=false;state.tts.paused=false;state.tts.utterance=null;state.tts.units=[];state.tts.index=0;state.tts.requestId="";
    browser.runtime.sendMessage({method:"stop",args:[]}).catch(function(){});
    ttsClearMarks();if(!keepPlayer){}updateTtsUi();
  }
  function ttsSpeakIndex(index){
    if(state.mode==="pdf")return;
    var units=state.tts.units;if(!units.length){toast("当前文档没有可朗读内容");ttsStop(false);return;}
    if(index>=units.length){
      var next=state.chapterIndex+1;if(next<state.chapters.length){gotoChapter(next);setTimeout(function(){state.tts.units=ttsBuildUnits();state.tts.index=0;ttsSpeakIndex(0);},120);return;}
      ttsStop(false);toast("本书朗读完成");return;
    }
    state.tts.index=index;state.tts.active=true;state.tts.paused=false;updateTtsUi();ttsClearMarks();
    var unit=units[index],text=unit.text,voice=ttsCurrentVoice(),requestId=String(Date.now())+"-"+Math.random().toString(36).slice(2);state.tts.requestId=requestId;state.tts.utterance={text:text};ttsMarkUnit(unit);
    var lang=(voice&&voice.lang)||"";var token=++state.tts.token;
    browser.runtime.sendMessage({method:"playReaderText",args:[text,{readerTtsId:requestId,lang:lang,rate:state.tts.rate,voiceName:voice&&voice.voiceName||state.tts.voiceName||""}]}).catch(function(error){if(token!==state.tts.token)return;console.error("BookNote Reader TTS",error);ttsStop(false);toast("朗读启动失败");});
  }
  function ttsHandleBackgroundEvent(msg){
    if(!msg||msg.type!=="booknote-reader-tts-event"||msg.readerTtsId!==state.tts.requestId)return;
    var event=msg.event||{},unit=state.tts.units[state.tts.index];
    if(event.type==="start"){state.tts.active=true;state.tts.paused=false;ttsMarkUnit(unit);updateTtsUi();}
    else if(event.type==="sentence"){if(Number.isFinite(event.startIndex))ttsMarkWord(unit,Number(event.startIndex),Number.isFinite(event.endIndex)?Number(event.endIndex):Number(event.startIndex)+1);}
    else if(event.type==="pause"){state.tts.paused=true;updateTtsUi();}
    else if(event.type==="resume"){state.tts.paused=false;updateTtsUi();}
    else if(event.type==="end"){state.tts.utterance=null;ttsClearMarks();state.tts.index++;ttsSpeakIndex(state.tts.index);}
    else if(event.type==="error"){state.tts.utterance=null;ttsClearMarks();ttsStop(false);toast("朗读发生错误，已停止");}
  }
  function ttsStart(fromIndex){
    if(state.mode==="pdf"){toast("PDF 当前使用原始阅读器，朗读暂不接管 PDF 页面");return;}
    var selectionText=String(state.tts.selectionText||"").trim();state.tts.units=selectionText?[{text:selectionText,node:null,selectionStart:state.pendingSelection&&state.pendingSelection.start,selectionEnd:state.pendingSelection&&state.pendingSelection.end}]:ttsBuildUnits();state.tts.selectionText="";
    if(!state.tts.units.length){toast("当前文档没有可朗读内容");return;}
    state.tts.active=true;state.tts.paused=false;updateTtsUi();ttsSpeakIndex(Math.max(0,Math.min(Number(fromIndex)||0,state.tts.units.length-1)));ttsSaveSettings();
  }
  function ttsToggle(){
    if(!state.tts.active){ttsStart(0);return;}
    var method=state.tts.paused?"play":"pause";browser.runtime.sendMessage({method:method,args:[]}).then(function(){state.tts.paused=!state.tts.paused;updateTtsUi();}).catch(function(){});
  }
  function ttsCycleRate(){var i=ttsRates.indexOf(state.tts.rate);state.tts.rate=ttsRates[(i+1)%ttsRates.length];updateTtsUi();ttsSaveSettings();if(state.tts.active){var idx=state.tts.index;ttsStart(idx);}}
  function ttsChangeVoice(){state.tts.voiceName=els.ttsVoice.value||"";ttsSaveSettings();if(state.tts.active)ttsStart(state.tts.index);}
  function ttsReadFromElement(element){
    if(!element||state.mode==="pdf")return;
    var units=ttsBuildUnits(),idx=units.findIndex(function(u){return u.node===element;});
    if(idx<0){var txt=ttsNormalizeText(element.textContent||"");idx=units.findIndex(function(u){return txt&&u.text&&txt.indexOf(u.text)>=0;});}
    if(idx>=0){state.tts.units=units;ttsStart(idx);}
  }
  function ttsInitDrag(){
    if(!els.ttsFloat||!els.ttsDrag)return;
    var drag={active:false,offsetX:0,offsetY:0};
    els.ttsDrag.addEventListener("pointerdown",function(e){drag.active=true;els.ttsFloat.classList.add("is-dragging");var r=els.ttsFloat.getBoundingClientRect();drag.offsetX=e.clientX-r.left;drag.offsetY=e.clientY-r.top;try{els.ttsDrag.setPointerCapture(e.pointerId);}catch(_){ }e.preventDefault();});
    els.ttsDrag.addEventListener("pointermove",function(e){if(!drag.active)return;var x=Math.max(8,Math.min(window.innerWidth-70,e.clientX-drag.offsetX));var y=Math.max(70,Math.min(window.innerHeight-80,e.clientY-drag.offsetY));els.ttsFloat.style.left=x+"px";els.ttsFloat.style.top=y+"px";els.ttsFloat.style.right="auto";els.ttsFloat.style.transform="none";});
    els.ttsDrag.addEventListener("pointerup",function(){drag.active=false;els.ttsFloat.classList.remove("is-dragging");});
  }
  function cycleTheme(){return browser.storage.local.get("booknotePanelState").then(function(r){var g=r.booknotePanelState||{};g.themeMode=g.themeMode==="night"?"day":"night";g.themeName=/^(nord|atom|everforest|onehalf|dracula)$/.test(g.themeName)?g.themeName:"everforest";return browser.storage.local.set({booknotePanelState:g});});}
  function saveReaderSettings(){var o={fontScale:state.fontScale,lineHeight:state.lineHeight,displayMode:state.displayMode};var x={};x.booknoteReaderSettings=o;return browser.storage.local.set(x);}
  function loadReaderSettings(){return Promise.all([browser.storage.local.get("booknoteReaderSettings"),browser.storage.local.get("booknotePanelState")]).then(function(rs){var x=rs[0].booknoteReaderSettings||{},g=rs[1].booknotePanelState||{};state.fontScale=Math.min(180,Math.max(70,Number(x.fontScale)||defaults.fontScale));state.lineHeight=Math.min(2.6,Math.max(1.2,Number(x.lineHeight)||defaults.lineHeight));state.displayMode=/^(original|bilingual|translation)$/.test(x.displayMode)?x.displayMode:defaults.displayMode;state.theme=g.themeMode==="night"?"dark":"light";state.themeName=/^(nord|atom|everforest|onehalf|dracula)$/.test(g.themeName)?g.themeName:"everforest";applySettings();});}
  function loadGlobalTheme(){return browser.storage.local.get("booknotePanelState").then(function(r){var g=r.booknotePanelState||{};state.theme=g.themeMode==="night"?"dark":"light";state.themeName=/^(nord|atom|everforest|onehalf|dracula)$/.test(g.themeName)?g.themeName:"everforest";applySettings();});}
  function exportOriginal(){
    if(!state.book)return;
    var raw=state.book.documentOriginalBase64||"";
    var finish=function(blob,mime){var url=URL.createObjectURL(blob);browser.downloads.download({url:url,filename:state.book.documentFileName||state.book.name||"BookNote-document",saveAs:true,conflictAction:"uniquify"}).then(function(){setTimeout(function(){URL.revokeObjectURL(url);},10000);toast("原文件已导出");}).catch(function(){URL.revokeObjectURL(url);toast("导出失败");});};
    if(globalThis.BookLibraryDB&&!raw){return BookLibraryDB.getSource(state.book.id).then(function(src){if(!src||!src.blob){toast("当前文档没有可导出的原始文件");return;}finish(src.blob,src.mime);});}
    if(!raw){toast("当前文档没有可导出的原始文件");return;}
    var bytes=decodeBase64(raw),mime={epub:"application/epub+zip",pdf:"application/pdf",txt:"text/plain;charset=utf-8",md:"text/markdown;charset=utf-8",odt:"application/vnd.oasis.opendocument.text",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}[String(state.book.documentFormat||"").toLowerCase()]||"application/octet-stream";
    finish(new Blob([bytes],{type:mime}),mime);
  }
  async function openPdf(book){state.mode="pdf";els.content.innerHTML="";var blob=null;if(globalThis.BookLibraryDB){var src=await BookLibraryDB.getSource(book.id);if(src)blob=src.blob;}if(!blob&&book.documentOriginalBase64)blob=new Blob([decodeBase64(book.documentOriginalBase64)],{type:"application/pdf"});if(!blob)throw new Error("PDF source missing");state.objectUrl=URL.createObjectURL(blob);var iframe=document.createElement("iframe");iframe.className="reader-pdf-frame";iframe.src=browser.runtime.getURL("pdf-viewer.html")+"?url="+encodeURIComponent(state.objectUrl);els.content.appendChild(iframe);els.content.className="reader-pdf-content";els.pdfNotice.hidden=false;}
  function setMode(){
    els.content.dataset.displayMode=state.displayMode;
    if(state.displayMode==="original"){els.content.querySelectorAll("[data-reader-translation]").forEach(function(e){e.hidden=true;});}
    else if(state.displayMode==="translation"){els.content.querySelectorAll("[data-reader-translation]").forEach(function(e){e.hidden=false;});}
  }
  async function openBook(book,openOptions){
    if(state.epubEngine){try{state.epubEngine.destroy();}catch(_){}}state.epubEngine=null;state.epubData=null;
    closeBook(false);
    reader.classList.add("open");
    reader.setAttribute("aria-hidden","false");var bookFmt=String(book&&book.documentFormat||"").toLowerCase();book=await hydrateBook(book,bookFmt!=="pdf"&&bookFmt!=="epub"||!!book.documentModified,bookFmt==="pdf"||(bookFmt==="epub"&&!book.documentModified));state.book=book;state.readingState=await getState(book.id);state.annotations=[];if(globalThis.BookNoteAnnotations){try{
      /* 书架直达 Reader 时禁止触发 BookLibraryDB.listNotes()/legacy migration。
         Reader 的书籍数据已经由 BookLibraryDB 按 bookId 懒加载，标注也有独立 Annotation DB；
         这里仅迁移当前 readingState 中的旧高亮/书签，避免打开 Reader 被 legacy notes 阻塞。 */
      state.annotations=await BookNoteAnnotations.migrateBook(book,state.readingState,[]);
    }catch(_){state.annotations=[];}}state.searchTerm="";state.searchMode="contains";state.hitIndex=-1;state.hits=[];state.searchSelected.clear();state.searchParagraphs=[];els.search.value="";hideReaderSearchHistory();els.note.value="";els.title.textContent="📖 "+(book.name||book.documentFileName||"未命名书籍");els.author.textContent=book.author||book.documentAuthor||"";els.format.textContent=String(book.documentFormat||"").toUpperCase();els.pdfNotice.hidden=true;state.chapters=[];state.toc=[];state.chapterIndex=0;
    await loadReaderSettings();
    var fmt=String(book.documentFormat||"").toLowerCase();
    try{
      if(fmt==="pdf")await openPdf(book);
      else if(fmt==="epub"&&!book.documentModified){var rawBytes=book.documentOriginalBase64?decodeBase64(book.documentOriginalBase64):null;if(!rawBytes&&book.__source)rawBytes=new Uint8Array(await book.__source.blob.arrayBuffer());if(!rawBytes)throw new Error("EPUB source missing");var parsed=await parseEpub(rawBytes);state.epubData=parsed;state.chapters=parsed.chapters;state.toc=parsed.toc;els.title.textContent="📖 "+(parsed.title||book.name||book.documentFileName||"未命名书籍");els.author.textContent=parsed.author||els.author.textContent;els.content.className="reader-text-content reader-epub-content reader-engine-host";if(!state.epubEngine)state.epubEngine=new BookNoteEpubReaderEngine(els.content);state.epubEngine.setData(parsed);await restorePosition();}
      else {state.chapters=[{href:"document",label:"正文",html:book.noteHtml||htmlFromText(book.noteText||book.documentOriginalText||"")}];state.toc=[{href:"document",label:"正文"}];setContent(state.chapters[0].html);restorePosition();}
    }catch(error){if(state.epubEngine){try{state.epubEngine.destroy();}catch(_){}}state.epubEngine=null;state.epubData=null;state.chapters=[{href:"document",label:"正文",html:book.noteHtml||htmlFromText(book.noteText||"")}];state.toc=[{href:"document",label:"正文"}];setContent(state.chapters[0].html);restorePosition();toast("EPUB 阅读器已切换到兼容模式");console.error("BookNote reader",error);}
    renderToc();renderBookmarks();renderAnnotations();setMode();updateProgress();updateTtsUi();
    if(openOptions&&openOptions.searchTerm){els.search.value=String(openOptions.searchTerm);searchBook();}
    if(openOptions&&openOptions.annotationId){var target=state.annotations.find(function(a){return String(a.id)===String(openOptions.annotationId);})||openOptions;setTimeout(function(){restoreAnnotation(target);setSidebar("annotations");},120);}
    document.body.classList.remove("reader-launch-pending");
  }
  function closeBook(save){if(state.epubEngine){try{state.epubEngine.destroy();}catch(_){}}state.epubEngine=null;state.epubData=null;var io=reader.querySelector("[data-reader-io-modal]");if(io)io.hidden=true;var iof=reader.querySelector("[data-reader-io-frame]");if(iof)iof.src="about:blank";ttsStop(false);if(els.selectionFloat)els.selectionFloat.hidden=true;if(els.notePopover)els.notePopover.hidden=true;state.pendingSelection=null;if(save!==false)persistScroll();reader.classList.remove("open");reader.setAttribute("aria-hidden","true");if(state.objectUrl){URL.revokeObjectURL(state.objectUrl);state.objectUrl="";}state.book=null;state.readingState=null;state.annotations=[];state.chapters=[];state.toc=[];state.chapterIndex=0;}

  reader.querySelector("[data-reader-close]").onclick=function(){if(document.body.classList.contains("reader-standalone")){location.href=browser.runtime.getURL("booknote/panel.html");return;}closeBook(true);};
  var readerHomeBtn=reader.querySelector("[data-reader-close]");
  reader.querySelector("[data-reader-search-btn]").onclick=searchBook;
  var readerSearchClear=reader.querySelector("[data-reader-search-clear]");
  function updateReaderSearchClear(){var box=reader.querySelector("[data-reader-search-box]");if(box)box.classList.toggle("has-value",!!String(els.search.value||""));}
  function clearReaderSearch(){
    els.search.value=""; state.searchTerm=""; state.hitIndex=-1; state.hits=[]; state.searchSelected.clear(); state.searchParagraphs=[];
    renderMarks(); renderReaderSearchResults(); hideReaderSearchHistory(); updateReaderSearchClear(); els.search.focus();
  }
  if(readerSearchClear)readerSearchClear.onclick=function(e){e.preventDefault();e.stopPropagation();clearReaderSearch();};
  updateReaderSearchClear();
  els.search.onfocus=function(){showReaderSearchHistory();};
  els.search.oninput=function(){updateReaderSearchClear();showReaderSearchHistory();};
  if(els.searchMode)els.searchMode.onchange=function(){if(String(els.search.value||"").trim())searchBook();};
  els.search.onkeydown=function(e){if(e.key==="Enter"){e.preventDefault();searchBook();}else if(e.key==="Escape"){hideReaderSearchHistory();}};
  document.addEventListener("mousedown",function(e){var box=reader.querySelector("[data-reader-search-box]");if(box&&reader.classList.contains("open")&&!box.contains(e.target))hideReaderSearchHistory();});
  reader.querySelector("[data-reader-prev]").onclick=function(){moveHit(-1);};reader.querySelector("[data-reader-next]").onclick=function(){moveHit(1);};
  els.bookmark.onclick=toggleBookmark;
  if(els.online)els.online.onclick=importOnlinePage;
  if(els.selectionNote)els.selectionNote.onclick=function(){openReaderNote();};
  if(els.selectionHighlight)els.selectionHighlight.onclick=function(){addHighlight();hideSelectionFloat();};
  if(els.selectionExcerpt)els.selectionExcerpt.onclick=function(){saveExcerpt();hideSelectionFloat();};
  if(els.selectionRead)els.selectionRead.onclick=function(){ttsReadSelection();hideSelectionFloat();};
  if(els.noteCancel)els.noteCancel.onclick=function(){if(els.notePopover)els.notePopover.hidden=true;};
  var noteSave=reader.querySelector("[data-reader-note-save]");if(noteSave)noteSave.onclick=saveNote;
  if(els.notePopover)els.notePopover.addEventListener("mousedown",function(e){e.stopPropagation();});
  if(els.selectionFloat)els.selectionFloat.addEventListener("mousedown",function(e){e.preventDefault();e.stopPropagation();});
  if(els.note)els.note.addEventListener("keydown",function(e){if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();saveNote();}});
  if(els.ttsLaunch)els.ttsLaunch.onclick=function(){ttsStart(0);};
  if(els.ttsToggle)els.ttsToggle.onclick=function(){ttsToggle();};
  if(els.ttsRate)els.ttsRate.onclick=function(){ttsCycleRate();};
  if(els.ttsVoice)els.ttsVoice.onchange=function(){ttsChangeVoice();};
  if(els.ttsClose)els.ttsClose.onclick=function(){ttsStop(false);};
  ttsInitDrag();
  browser.runtime.onMessage.addListener(ttsHandleBackgroundEvent);
  void ttsLoadSettings().then(ttsLoadVoiceRegistry).catch(function(error){console.error("BookNote Reader TTS voice registry",error);});
  els.content.addEventListener("booknote-epub-selection",captureReaderSelection);
  els.content.addEventListener("booknote-epub-scroll",function(){if(state.mode!=="pdf")persistScroll();});
  els.content.addEventListener("booknote-epub-link",function(e){var d=e.detail||{};gotoHref(d.href||"");});
  els.content.addEventListener("mouseup",captureReaderSelection);
  els.content.addEventListener("keyup",captureReaderSelection);
  document.addEventListener("selectionchange",captureReaderSelection);
  window.addEventListener("resize",function(){if(state.pendingSelection&&els.selectionFloat&&!els.selectionFloat.hidden)positionSelectionFloat();});
  /* 正文点击保持纯阅读交互：不再因普通鼠标点击自动启动朗读，也不改变正文视觉状态。朗读统一由朗读浮标或选中文本操作触发。 */
  els.prevChapter.onclick=function(){gotoChapter(state.chapterIndex-1);};els.nextChapter.onclick=function(){gotoChapter(state.chapterIndex+1);};
  reader.querySelectorAll("[data-sidebar-tab]").forEach(function(b){b.onclick=function(){setSidebar(b.dataset.sidebarTab);};});
  els.font.oninput=function(){state.fontScale=Number(els.font.value)||100;applySettings();};els.font.onchange=saveReaderSettings;
  els.line.oninput=function(){state.lineHeight=Number(els.line.value)||1.8;applySettings();};els.line.onchange=saveReaderSettings;
  els.mode.onchange=function(){state.displayMode=els.mode.value;setMode();saveReaderSettings();};
  els.theme.onclick=cycleTheme;
  browser.storage.onChanged.addListener(function(changes,area){if(area!=="local"||!changes.booknotePanelState)return;var g=changes.booknotePanelState.newValue||{};state.theme=g.themeMode==="night"?"dark":"light";state.themeName=/^(nord|atom|everforest|onehalf|dracula)$/.test(g.themeName)?g.themeName:"everforest";applySettings();});
  els.content.addEventListener("scroll",function(){if(state.mode!=="pdf"&&!state.epubEngine)persistScroll();},{passive:true});
  reader.addEventListener("keydown",function(e){if(e.target&&(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable))return;if(e.key==="ArrowLeft"){e.preventDefault();gotoChapter(state.chapterIndex-1);}else if(e.key==="ArrowRight"){e.preventDefault();gotoChapter(state.chapterIndex+1);}else if(e.key==="PageDown"){e.preventDefault();els.content.scrollTop+=els.content.clientHeight*.9;}else if(e.key==="PageUp"){e.preventDefault();els.content.scrollTop-=els.content.clientHeight*.9;}else if(e.key===" "){e.preventDefault();els.content.scrollTop+=(e.shiftKey?-1:1)*els.content.clientHeight*.85;}});
  els.content.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a");if(!a)return;var href=a.getAttribute("href")||"";if(href&&!/^(?:https?:|mailto:|javascript:)/i.test(href)){e.preventDefault();gotoHref(href.split("#")[0]);}});
  window.BookNoteReadingLayer={open:openBook,close:closeBook};
})();
