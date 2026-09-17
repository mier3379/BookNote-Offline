(function(){
  'use strict';
  /* Search Engine v3 — v7.10.140 full-text complete-hit / offline production profile.
     Persistent truth: IndexedDB. Runtime accelerator: compact in-memory postings.
     Correctness rule: postings only produce candidates; final matching is exact. */
  var DB='booknote-local-index', VER=6, DOCS='docs', TERMS='terms', META='meta', SECTIONS='sections', SECTION_TERMS='section_terms';
  var dbPromise=null, mem=null, buildPromise=null;

  function open(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise(function(resolve,reject){
      var r=indexedDB.open(DB,VER);
      r.onupgradeneeded=function(){
        var d=r.result;
        if(!d.objectStoreNames.contains(DOCS))d.createObjectStore(DOCS,{keyPath:'id'});
        if(!d.objectStoreNames.contains(TERMS))d.createObjectStore(TERMS,{keyPath:'term'});
        if(!d.objectStoreNames.contains(META))d.createObjectStore(META,{keyPath:'key'});
        if(!d.objectStoreNames.contains(SECTIONS))d.createObjectStore(SECTIONS,{keyPath:'id'});
        if(!d.objectStoreNames.contains(SECTION_TERMS))d.createObjectStore(SECTION_TERMS,{keyPath:'term'});
        /* v6: section/chapter/TOC search index. Existing stores are preserved; section stores are derived and rebuildable.
           No raw BookLibraryDB data is touched by this migration. */
        /* v5: persistent body snapshot. SearchDB is derived/cache data, but the upgrade itself must never clear raw BookLibraryDB data.
           Existing v4 derived records are intentionally rebuilt by ensure() when schema=5 is detected. */
      };
      r.onsuccess=function(){var db=r.result;db.onversionchange=function(){db.close();dbPromise=null;mem=null;};resolve(db);};
      r.onerror=function(){dbPromise=null;reject(r.error||new Error('Search DB open failed'));};
    });
    return dbPromise;
  }

  function bytesToText(bytes){return new TextDecoder('utf-8',{fatal:false}).decode(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes));}
  /* v7.10.135: one normalization contract for query and corpus.
     NFKC handles compatibility/full-width forms; default-ignorable characters
     are removed; whitespace is collapsed. Mapping is kept at grapheme-cluster
     granularity so normalized hits can still be projected back to original text. */
  var INVISIBLE_RE=/[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u206a-\u206f\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;
  function normalizeUnit(s){
    var x=String(s==null?'':s);
    try{x=x.normalize('NFKC');}catch(_){}
    x=x.replace(INVISIBLE_RE,'');
    return x.toLocaleLowerCase();
  }
  function graphemes(s){
    var str=String(s==null?'':s),out=[];
    try{
      if(typeof Intl!=='undefined'&&Intl.Segmenter){
        var seg=new Intl.Segmenter(undefined,{granularity:'grapheme'});
        for(var it=seg.segment(str)[Symbol.iterator](),step;!(step=it.next()).done;)out.push({text:step.value.segment,start:step.value.index,end:step.value.index+step.value.segment.length});
        return out;
      }
    }catch(_){}
    for(var i=0;i<str.length;){var cp=str.codePointAt(i),len=cp>0xffff?2:1;out.push({text:str.slice(i,i+len),start:i,end:i+len});i+=len;}
    return out;
  }
  function normalize(s){
    var gs=graphemes(s),out='',pendingSpace=false;
    for(var i=0;i<gs.length;i++){
      var x=normalizeUnit(gs[i].text);
      if(/\s/.test(x)){if(out)pendingSpace=true;continue;}
      if(pendingSpace){out+=' ';pendingSpace=false;}
      out+=x;
    }
    return out.trim();
  }
  function normalizedWithMap(s){
    var str=String(s==null?'':s),gs=graphemes(str),out='',mapStart=[],mapEnd=[],pendingSpace=false,pendingStart=-1,pendingEnd=-1;
    for(var i=0;i<gs.length;i++){
      var g=gs[i],x=normalizeUnit(g.text);
      if(!x)continue;
      if(/\s/.test(x)){
        if(out&&!pendingSpace){pendingSpace=true;pendingStart=g.start;pendingEnd=g.end;}
        continue;
      }
      if(pendingSpace){out+=' ';mapStart.push(pendingStart);mapEnd.push(pendingEnd);pendingSpace=false;}
      out+=x;for(var j=0;j<x.length;j++){mapStart.push(g.start);mapEnd.push(g.end);}
    }
    while(out.endsWith(' ')){out=out.slice(0,-1);mapStart.pop();mapEnd.pop();}
    return {text:out,map:mapStart,mapEnd:mapEnd};
  }
  function isCjk(ch){return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(ch);}
  var segmenter=null;
  function getSegmenter(){
    if(segmenter!==null)return segmenter;
    try{segmenter=(typeof Intl!=='undefined'&&Intl.Segmenter)?new Intl.Segmenter(undefined,{granularity:'word'}):false;}catch(_){segmenter=false;}
    return segmenter;
  }
  function terms(s){
    s=normalize(s);var out=[],seen=Object.create(null);
    function add(x){x=String(x||'');if(!x||seen[x])return;seen[x]=1;out.push(x);}
    var seg=getSegmenter();
    if(seg){try{for(var it=seg.segment(s)[Symbol.iterator](),step;!(step=it.next()).done;){var x=step.value;if(x.isWordLike)add(x.segment);}}catch(_){ }}
    (s.match(/[a-z0-9][a-z0-9_'-]*/g)||[]).forEach(add);
    var run=[];
    function flushRun(){if(!run.length)return;for(var x=0;x<run.length;x++)add(run[x]);for(var y=0;y<run.length-1;y++)add(run[y]+run[y+1]);run=[];}
    for(var i=0;i<s.length;i++){var ch=s.charAt(i);if(isCjk(ch))run.push(ch);else flushRun();}flushRun();
    /* Keep non-CJK short/mixed strings searchable even when segmentation is unavailable. */
    if(!out.length&&s)add(s);
    return out;
  }
  function bookText(n){return [n.documentTitle,n.name,n.documentAuthor,n.documentPublisher,n.documentDescription,n.category,n.documentFileName].filter(Boolean).join('\n');}
  function bookBodyText(n){return String(n.documentOriginalText||n.noteText||'');}
  async function loadBookContent(id){if(globalThis.BookLibraryDB){var c=await BookLibraryDB.getContent(id);return c?String(c.text||''):'';}return '';}
  function annotationText(a){return [a.text,a.note,a.chapterLabel,(a.tags||[]).join(' ')].filter(Boolean).join('\n');}
  function allAnnotations(){return globalThis.BookNoteAnnotations?BookNoteAnnotations.list().catch(function(){return [];}):Promise.resolve([]);}
  function hash(s){var h=2166136261; s=String(s||'');for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24);h=h>>>0;}return ('00000000'+h.toString(16)).slice(-8);}
  function signature(books,annotations){
    var a=(books||[]).map(function(n){return 'b:'+String(n.id)+'|'+String(n.updatedAt||n.createdAt||'')+'|m:'+hash(bookText(n));});
    var b=(annotations||[]).map(function(n){return 'a:'+String(n.id)+'|'+String(n.updatedAt||n.createdAt||'')+'|'+hash(annotationText(n));});
    return a.concat(b).sort().join('§');
  }
  function stamp(v){var n=Number(v);if(Number.isFinite(n))return n;var t=Date.parse(String(v||''));return Number.isFinite(t)?t:0;}
  function yieldNow(){return new Promise(function(resolve){setTimeout(resolve,0);});}
  function addPosting(map,term,ord){var b=map.get(term);if(!b){b=[];map.set(term,b);}if(b.length===0||b[b.length-1]!==ord)b.push(ord);}
  async function makeRecord(n,ord){
    var body=await loadBookContent(n.id), text=bookText(n), content=null, chapters=[];
    try{content=globalThis.BookLibraryDB?await BookLibraryDB.getContent(n.id):null;chapters=content&&Array.isArray(content.chapters)?content.chapters.map(function(ch,i){return {index:Number(ch.index!=null?ch.index:i),label:String(ch.label||''),href:String(ch.href||''),textStart:Number(ch.textStart||0),textEnd:Number(ch.textEnd!=null?ch.textEnd:body.length||0)};}):[];}catch(_){chapters=[];}
    return {id:'book:'+String(n.id),ordinal:ord,kind:'book',bookId:String(n.id),title:String(n.documentTitle||n.name||n.documentFileName||''),author:String(n.documentAuthor||''),format:String(n.documentFormat||''),text:text,bodyText:body,bodyUpdatedAt:String(n.updatedAt||n.createdAt||''),bodyHash:hash(body),chapters:chapters};
  }
  function makeSectionRecords(rec,startOrd){
    var body=String(rec.bodyText||''),chs=Array.isArray(rec.chapters)?rec.chapters:[],out=[];
    if(!chs.length){
      if(body.trim())out.push({id:'section:'+rec.bookId+':0',ordinal:startOrd,kind:'book',bookId:rec.bookId,title:rec.title,author:rec.author,format:rec.format,text:'',bodyText:body,bodyUpdatedAt:rec.bodyUpdatedAt,bodyHash:hash(body),chapterIndex:0,chapterLabel:'',href:'',textStart:0,textEnd:body.length});
      return out;
    }
    for(var i=0;i<chs.length;i++){
      var ch=chs[i],st=Math.max(0,Number(ch.textStart)||0),en=Number(ch.textEnd);
      if(!Number.isFinite(en)||en<=st)en=i<chs.length-1?Math.max(st,Number(chs[i+1].textStart)||st):body.length;
      en=Math.min(body.length,Math.max(st,en));
      var txt=body.slice(st,en);
      if(!txt.trim())continue;
      out.push({id:'section:'+rec.bookId+':'+String(ch.index!=null?ch.index:i),ordinal:startOrd+out.length,kind:'book',bookId:rec.bookId,title:rec.title,author:rec.author,format:rec.format,text:'',bodyText:txt,bodyUpdatedAt:rec.bodyUpdatedAt,bodyHash:hash(txt),chapterIndex:Number(ch.index!=null?ch.index:i),chapterLabel:String(ch.label||''),href:String(ch.href||''),textStart:st,textEnd:en});
    }
    return out;
  }
  function makeAnnotationRecord(a,ord){
    var text=annotationText(a);
    return {id:'annotation:'+String(a.id),ordinal:ord,kind:'annotation',annotationId:String(a.id),bookId:String(a.bookId||''),type:String(a.type||'note'),title:String(a.chapterLabel||''),author:'',format:'',text:text,bodyText:text,updatedAt:String(a.updatedAt||a.createdAt||'')};
  }
  function clearAndBuild(books,annotations){
    if(buildPromise)return buildPromise;
    buildPromise=(async function(){
      var db=await open(), records=[],sections=[],posting=new Map(),sectionPosting=new Map(), ord=0, secOrd=0, listBooks=books||[], listAnnotations=annotations||[];
      for(var i=0;i<listBooks.length;i++){
        var rec=await makeRecord(listBooks[i],ord++);
        records.push(rec);
        terms(rec.text).forEach(function(term){addPosting(posting,term,rec.ordinal);});
        var sr=makeSectionRecords(rec,secOrd);
        sr.forEach(function(sec){sections.push(sec);terms(sec.bodyText).forEach(function(term){addPosting(sectionPosting,term,sec.ordinal);});});
        secOrd+=sr.length;
        if((i%3)===2)await yieldNow();
      }
      for(var j=0;j<listAnnotations.length;j++){
        var ar=makeAnnotationRecord(listAnnotations[j],ord);
        if(ar.text.trim()){records.push(ar);terms(ar.text).forEach(function(term){addPosting(posting,term,ar.ordinal);});ord++;}
        if((j%20)===19)await yieldNow();
      }
      var sig=signature(listBooks,listAnnotations);
      await new Promise(function(resolve,reject){
        var t=db.transaction([DOCS,TERMS,META,SECTIONS,SECTION_TERMS],'readwrite'),d=t.objectStore(DOCS),tm=t.objectStore(TERMS),m=t.objectStore(META),sd=t.objectStore(SECTIONS),stm=t.objectStore(SECTION_TERMS);
        d.clear();tm.clear();sd.clear();stm.clear();
        records.forEach(function(rec){d.put(rec);});
        sections.forEach(function(rec){sd.put(rec);});
        posting.forEach(function(ids,term){tm.put({term:term,ids:ids});});
        sectionPosting.forEach(function(ids,term){stm.put({term:term,ids:ids});});
        m.put({key:'version',schema:6,bookCount:listBooks.length,annotationCount:listAnnotations.length,signature:sig,builtAt:Date.now(),docCount:records.length,termCount:posting.size,sectionCount:sections.length,sectionTermCount:sectionPosting.size,bodySnapshot:true,sectionIndex:true});
        t.oncomplete=function(){resolve();};t.onerror=function(){reject(t.error||new Error('Search index build failed'));};t.onabort=function(){reject(t.error||new Error('Search index build aborted'));};
      });
      mem={docs:records,sections:sections,docById:new Map(),sectionByOrdinal:new Map(),postings:new Map(),sectionPostings:new Map(),docCount:records.length,termCount:posting.size,sectionCount:sections.length,signature:sig,builtAt:Date.now()};
      records.forEach(function(r){mem.docById.set(r.id,r);});
      sections.forEach(function(r){mem.sectionByOrdinal.set(r.ordinal,r);});
      posting.forEach(function(ids,term){mem.postings.set(term,new Uint32Array(ids));});
      sectionPosting.forEach(function(ids,term){mem.sectionPostings.set(term,new Uint32Array(ids));});
      return records.length;
    })().finally(function(){buildPromise=null;});
    return buildPromise;
  }
  async function loadMemory(){
    if(mem)return mem;
    var db=await open();
    var data=await new Promise(function(resolve,reject){var t=db.transaction([DOCS,TERMS,META,SECTIONS,SECTION_TERMS],'readonly'),d=t.objectStore(DOCS),tm=t.objectStore(TERMS),m=t.objectStore(META),sd=t.objectStore(SECTIONS),stm=t.objectStore(SECTION_TERMS),docs,termsList,meta,sections,sectionTerms;var rd=d.getAll(),rt=tm.getAll(),rm=m.get('version'),rs=sd.getAll(),rst=stm.getAll();rd.onsuccess=function(){docs=rd.result||[];};rt.onsuccess=function(){termsList=rt.result||[];};rm.onsuccess=function(){meta=rm.result||{};};rs.onsuccess=function(){sections=rs.result||[];};rst.onsuccess=function(){sectionTerms= rst.result||[];};t.oncomplete=function(){resolve({docs:docs||[],terms:termsList||[],meta:meta||{},sections:sections||[],sectionTerms:sectionTerms||[]});};t.onerror=function(){reject(t.error||new Error('Search index load failed'));};});
    mem={docs:data.docs,sections:data.sections,docById:new Map(),sectionByOrdinal:new Map(),postings:new Map(),sectionPostings:new Map(),docCount:data.docs.length,termCount:data.terms.length,sectionCount:data.sections.length,signature:String(data.meta.signature||''),builtAt:Number(data.meta.builtAt)||0};
    data.docs.forEach(function(r){mem.docById.set(r.id,r);});data.sections.forEach(function(r){mem.sectionByOrdinal.set(r.ordinal,r);});data.terms.forEach(function(x){mem.postings.set(x.term,new Uint32Array(x.ids||[]));});data.sectionTerms.forEach(function(x){mem.sectionPostings.set(x.term,new Uint32Array(x.ids||[]));});return mem;
  }
  function bitmapAnd(lists){
    if(!lists.length)return null;
    lists.sort(function(a,b){return a.length-b.length;});
    var base=lists[0],set=new Set();for(var i=0;i<base.length;i++)set.add(base[i]);
    for(var j=1;j<lists.length;j++){var next=new Set(),cur=lists[j];for(var k=0;k<cur.length;k++)if(set.has(cur[k]))next.add(cur[k]);set=next;if(!set.size)break;}
    return set;
  }
  function exactMatches(text,q,max){return findMatches(text,q,max);}
  function findMatches(text,q,max){
    var source=String(text==null?'':text),nm=normalizedWithMap(source),nq=normalize(q),out=[],from=0,p,cap=max==null?Infinity:Math.max(0,Number(max));
    if(!nq)return out;
    /* Completeness rule: occurrences are discovered at every normalized start position.
       Increment by one, not by query length, so overlapping occurrences are never lost. */
    while(out.length<cap&&(p=nm.text.indexOf(nq,from))>=0){
      var endPos=p+nq.length-1,startOrig=nm.map[p],endOrig=endPos<nm.mapEnd.length?nm.mapEnd[endPos]:source.length;
      out.push({start:startOrig,end:endOrig,text:source.slice(startOrig,endOrig)});
      from=p+1;
    }
    return out;
  }
  async function resultFor(rec,q){
    var content=null;
    var body=String(rec.bodyText||'');
    var bodyMatches=exactMatches(body,q,20);if(!bodyMatches.length)bodyMatches=findMatches(body,q,20);var metaMatches=[];
    if(!bodyMatches.length&&rec.kind==='book')metaMatches=findMatches(rec.text||'',q,10);
    var matches=bodyMatches.length?bodyMatches:metaMatches;if(!matches.length)return null;
    var first=matches[0],src=bodyMatches.length?'body':'metadata',sourceText=bodyMatches.length?body:(rec.text||'');
    var nm=normalizedWithMap(sourceText),normStart=nm.text.indexOf(normalize(q)),normEnd=normStart<0?0:normStart+normalize(q).length;
    var snippetStart=Math.max(0,normStart<0?0:normStart-90),snippetEnd=Math.min(nm.text.length,normStart<0?180:normEnd+180),snippet=normStart<0?sourceText.slice(0,180):sourceText.slice(nm.map[snippetStart]||0,(snippetEnd<nm.map.length?nm.map[snippetEnd]+1:sourceText.length));
    var chapterIndex=null,chapterLabel="",chapters=Array.isArray(rec.chapters)?rec.chapters:[];
    if(rec.chapterIndex!=null){chapterIndex=Number(rec.chapterIndex);chapterLabel=String(rec.chapterLabel||'');}else if(src==='body'&&chapters.length){for(var ci=0;ci<chapters.length;ci++){var ch=chapters[ci];if(first.start>=Number(ch.textStart||0)&&first.start<Number(ch.textEnd||0)){chapterIndex=Number(ch.index!=null?ch.index:ci);chapterLabel=String(ch.label||"");break;}}}
    var base=Number(rec.textStart)||0;return Object.assign({},rec,{matchSource:src,matches:matches,matchStart:first.start+base,matchEnd:first.end+base,matchLocalStart:first.start,matchLocalEnd:first.end,matchText:first.text,snippet:snippet,chapterIndex:chapterIndex,chapterLabel:chapterLabel,locator:{version:4,bookId:String(rec.bookId||''),chapterIndex:chapterIndex,chapterLabel:chapterLabel,start:first.start+base,end:first.end+base,quote:first.text}});
  }
  function blockText(el){return String(el&&el.textContent||'').replace(/\s+/g,' ').trim();}
  function sanitizeExtractHtml(html){var d=new DOMParser().parseFromString(String(html||''),'text/html');d.querySelectorAll('script,iframe,object,embed,form,link,meta,base').forEach(function(n){n.remove();});d.querySelectorAll('*').forEach(function(n){Array.prototype.slice.call(n.attributes).forEach(function(a){if(/^on/i.test(a.name)||a.name.toLowerCase()==='srcdoc')n.removeAttribute(a.name);});});return d;}
  function extractBlockForOffset(html,localStart,localEnd,matchText,chapterText){
    var doc=sanitizeExtractHtml(html),root=doc.body||doc,blocks=Array.prototype.slice.call(root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,blockquote,li,pre,dt,dd'));
    if(!blocks.length)blocks=Array.prototype.slice.call(root.children);
    var targetStart=Math.max(0,Number(localStart)||0),qnorm=normalize(matchText||''),best=null;
    var chapterNorm=normalizedWithMap(String(chapterText||'')),chapterProbe=chapterNorm.text;
    var canonicalTarget=-1;
    if(chapterProbe){
      var rawTarget=targetStart;
      canonicalTarget=Math.max(0,Math.min(chapterProbe.length,rawTarget));
      /* canonical chapter offsets may differ from normalized offsets; locate the nearest normalized position. */
      if(chapterNorm.map&&chapterNorm.map.length){
        var lo=0,hi=chapterNorm.map.length;
        while(lo<hi){var mid=(lo+hi)>>1;if(Number(chapterNorm.map[mid]||0)<rawTarget)lo=mid+1;else hi=mid;}
        canonicalTarget=Math.max(0,Math.min(chapterProbe.length,lo));
      }
    }
    var cursor=0;
    for(var i=0;i<blocks.length;i++){
      var b=blocks[i],raw=String(b.textContent||''),norm=normalize(raw),probe=normalizedWithMap(raw),qpos=qnorm?probe.text.indexOf(qnorm):-1;
      var score=-Infinity;
      if(qnorm&&qpos>=0){
        score=100000;
        /* Build a normalized block coordinate so we can compare with the canonical chapter offset. */
        var blockStart=cursor,blockEnd=cursor+probe.text.length;
        if(canonicalTarget>=0){
          var dist=canonicalTarget<blockStart?blockStart-canonicalTarget:canonicalTarget>blockEnd?canonicalTarget-blockEnd:0;
          score-=Math.min(dist,100000);
        }
        score-=Math.min(Math.abs(qpos),1000)*0.01;
      }
      if(score>-Infinity){
        if(!best||score>best.score)best={score:score,html:b.outerHTML,text:raw};
      }
      cursor+=probe.text.length+1;
    }
    /* 最后的安全条件：摘出的段落必须实际包含命中词组；否则宁可不摘取，也不能产生错误段落。 */
    if(best&&qnorm&&normalize(best.text).indexOf(qnorm)<0)return null;
    return best?{html:best.html,text:best.text}:null;
  }
  function chapterLabelOf(ch,index){
    var label=String(ch&&ch.label!=null?ch.label:'').replace(/\s+/g,' ').trim();
    return label||('第'+(Number(index)+1)+'章');
  }
  function resolveChapter(chapters,offset,bodyLength){
    var list=Array.isArray(chapters)?chapters:[];
    for(var i=0;i<list.length;i++){
      var ch=list[i]||{},start=Number(ch.textStart),end=Number(ch.textEnd);
      if(!Number.isFinite(start))start=0;
      if(!Number.isFinite(end)||end<=start)end=bodyLength;
      if(offset>=start && (offset<end || (i===list.length-1&&offset===end)))return {index:Number.isFinite(Number(ch.index))?Number(ch.index):i,label:chapterLabelOf(ch,i),chapter:ch};
    }
    return null;
  }
  async function extractParagraphs(results,options){
    options=options||{};
    var limit=Number(options.limit),selected=Array.isArray(results)?(limit>0?results.slice(0,limit):results.slice()):[],out=[],groups=new Map();
    selected.forEach(function(r){
      if(!r||r.kind!=='book'||!r.bookId)return;
      var ms=Array.isArray(r.matches)&&r.matches.length?r.matches:[{start:Number(r.matchStart)||0,end:Number(r.matchEnd)||0,text:String(r.matchText||'')}];
      ms.forEach(function(m){
        var key=String(r.bookId)+'|'+String(m.start||0);
        if(!groups.has(key))groups.set(key,{result:r,match:m});
      });
    });
    for(var git=groups.values(),gs;!(gs=git.next()).done;){
      var g=gs.value,r=g.result,m=g.match,content=await BookLibraryDB.getContent(g.result.bookId),meta=await BookLibraryDB.getMeta(g.result.bookId),chapters=content&&Array.isArray(content.chapters)?content.chapters:[],bodyLength=String(content&&content.text||'').length;
      var resolved=resolveChapter(chapters,Number(m.start)||0,bodyLength),chapterIndex=resolved?resolved.index:null,chapterLabel=resolved?resolved.label:'';
      var ch=resolved?resolved.chapter:null;
      var html='';
      if(ch&&String(meta&&meta.documentFormat||'').toLowerCase()==='epub'){
        var src=await BookLibraryDB.getSource(g.result.bookId);
        if(src&&src.blob){var ab=await src.blob.arrayBuffer(),entries=await unzipRequested(ab,String(ch.href||''));html=entries?entries.html:'';entries=null;ab=null;}
      }else if(content)html=String(content.html||'');
      var localStart=Number(m.start)||0,localEnd=Number(m.end)||localStart;
      if(ch){localStart-=Number(ch.textStart||0);localEnd-=Number(ch.textStart||0);}
      var chapterRaw=ch&&content?String(content.text||'').slice(Number(ch.textStart||0),Number(ch.textEnd||String(content.text||'').length)):'';
      var block=extractBlockForOffset(html,localStart,localEnd,String(m.text||r.matchText||''),chapterRaw);
      if(block)out.push({bookId:String(g.result.bookId),bookTitle:String(r.title||meta&&meta.documentTitle||meta&&meta.name||''),chapterIndex:chapterIndex,chapterLabel:chapterLabel,paragraphHtml:block.html,paragraphText:block.text,matchText:String(m.text||r.matchText||'')});
      html='';content=null;meta=null;ch=null;
    }
    groups.clear();
    /* 保持稳定顺序，并去掉同一书/章节/段落的重复命中。 */
    var seen=new Set(),ded=[];out.forEach(function(x){var k=x.bookId+'|'+String(x.chapterIndex)+'|'+normalize(x.paragraphText);if(!seen.has(k)){seen.add(k);ded.push(x);}});return ded;
  }
  async function unzipRequested(buffer,name){
    var view=new DataView(buffer),u8=new Uint8Array(buffer),dec=new TextDecoder('utf-8'),e=-1;
    for(var i=view.byteLength-22;i>=Math.max(0,view.byteLength-65557);i--){if(view.getUint32(i,true)===0x06054b50){e=i;break;}}
    if(e<0)return null;var count=view.getUint16(e+10,true),off=view.getUint32(e+16,true),pos=off;
    function u16(o){return view.getUint16(o,true)}function u32(o){return view.getUint32(o,true)}
    for(var n=0;n<count;n++){if(u32(pos)!==0x02014b50)break;var flags=u16(pos+8),method=u16(pos+10),csize=u32(pos+20),nl=u16(pos+28),el=u16(pos+30),cl=u16(pos+32),lo=u32(pos+42),entry=dec.decode(u8.slice(pos+46,pos+46+nl));pos+=46+nl+el+cl;if(entry!==name)continue;var ln=u16(lo+26),le=u16(lo+28),data=u8.slice(lo+30+ln+le,lo+30+ln+le+csize),raw;if(method===0)raw=data;else if(method===8){var ds=new DecompressionStream('deflate-raw');raw=new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());}else return null;var text=bytesToText(raw);var d=new DOMParser().parseFromString(text,'text/html');return {html:d.body?d.body.innerHTML:text};}
    return null;
  }
  async function search(q,limit){
    q=String(q||'').trim();
    /* 完整性硬规则：limit 仅保留兼容参数，不允许截断书籍或命中。 */
    limit=Infinity;
    if(!q||!globalThis.BookLibraryDB)return [];
    /* v7.10.134:正文真源搜索。索引不参与“有没有结果”的判定。逐本读取正文，避免整库同时驻留内存。 */
    var books=await BookLibraryDB.listMeta(),out=[];
    for(var i=0;i<books.length;i++){
      var meta=books[i];
      if(!meta||!meta.id)continue;
      var content=null;
      try{content=await BookLibraryDB.getContent(String(meta.id));}catch(_){content=null;}
      var body=content?String(content.text||''):'';
      if(body){
        var matches=findMatches(body,q);
        if(matches.length){
          var first=matches[0],chapters=content&&Array.isArray(content.chapters)?content.chapters:[],chapterIndex=null,chapterLabel='';
          for(var ci=0;ci<chapters.length;ci++){
            var ch=chapters[ci];
            if(first.start>=Number(ch.textStart||0)&&first.start<Number(ch.textEnd||body.length)){
              chapterIndex=Number(ch.index!=null?ch.index:ci);chapterLabel=String(ch.label||'');break;
            }
          }
          var nm=normalizedWithMap(body),nq=normalize(q),ns=nm.text.indexOf(nq),ne=ns<0?0:ns+nq.length;
          var ss=Math.max(0,ns<0?0:ns-90),ee=Math.min(nm.text.length,ns<0?180:ne+180);
          var snippet=ns<0?body.slice(0,180):body.slice(nm.map[ss]||0,(ee<nm.map.length?nm.map[ee]+1:body.length));
          out.push({
            id:'book:'+String(meta.id),kind:'book',bookId:String(meta.id),
            title:String(meta.documentTitle||meta.name||meta.documentFileName||''),
            author:String(meta.documentAuthor||''),format:String(meta.documentFormat||''),
            text:'',bodyText:'',chapters:chapters,matchSource:'body',matches:matches,
            matchStart:first.start,matchEnd:first.end,matchLocalStart:first.start,matchLocalEnd:first.end,
            matchText:first.text,snippet:snippet,chapterIndex:chapterIndex,chapterLabel:chapterLabel,
            bodyUpdatedAt:String(content&&content.updatedAt||meta.updatedAt||meta.createdAt||''),
            locator:{version:4,bookId:String(meta.id),chapterIndex:chapterIndex,chapterLabel:chapterLabel,start:first.start,end:first.end,quote:first.text}
          });
        }
      }
      content=null;body='';
      if(i%2===1)await yieldNow();
    }
    return out;
  }
  async function ensure(books){
    /* 搜索索引改为可选缓存；正文搜索不依赖索引构建。保留接口兼容书架启动流程。 */
    if(globalThis.BookLibraryDB&&BookLibraryDB.ensure)await BookLibraryDB.ensure();
    return false;
  }
  function rebuild(books){return allAnnotations().then(function(a){mem=null;return clearAndBuild(Array.isArray(books)?books:[],a);});}
  function xmlEsc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
  function odtInline(node){
    if(node.nodeType===3)return xmlEsc(node.nodeValue||'');
    if(node.nodeType!==1)return '';
    var inner='';Array.prototype.forEach.call(node.childNodes,function(c){inner+=odtInline(c);});
    var t=String(node.tagName||'').toUpperCase();
    if(t==='BR')return '<text:line-break/>';
    if(t==='STRONG'||t==='B')return '<text:span text:style-name="GN_B">'+inner+'</text:span>';
    if(t==='EM'||t==='I')return '<text:span text:style-name="GN_I">'+inner+'</text:span>';
    if(t==='U')return '<text:span text:style-name="GN_U">'+inner+'</text:span>';
    if(t==='S'||t==='DEL')return '<text:span text:style-name="GN_S">'+inner+'</text:span>';
    return inner;
  }
  function groupExtractItems(items){
    var books=new Map(),bookOrder=0;
    (items||[]).forEach(function(x){
      if(!x)return;
      var bookKey=String(x.bookId||x.bookTitle||'未命名书籍'),book=books.get(bookKey);
      if(!book){book={bookId:bookKey,title:String(x.bookTitle||'未命名书籍'),chapters:new Map(),order:bookOrder++};books.set(bookKey,book);}
      var chapterKey=String(x.chapterIndex!=null?x.chapterIndex:(x.chapterLabel||'document')),chapter=book.chapters.get(chapterKey);
      if(!chapter){chapter={index:x.chapterIndex!=null?Number(x.chapterIndex):Number.MAX_SAFE_INTEGER,label:String(x.chapterLabel||'').replace(/\s+/g,' ').trim()||'未标注章节',paragraphs:[],order:book.chapters.size};book.chapters.set(chapterKey,chapter);}
      var text=String(x.paragraphText==null?'':x.paragraphText);
      if(normalize(text))chapter.paragraphs.push({html:x.paragraphHtml,text:text});
    });
    var out=Array.from(books.values()).sort(function(a,b){return a.order-b.order;});
    out.forEach(function(book){book.chapters=Array.from(book.chapters.values()).sort(function(a,b){return (a.index-b.index)||(a.order-b.order);});});
    return out;
  }
  function buildTemplateText(items){
    var books=groupExtractItems(items),out=[];
    books.forEach(function(book){
      book.chapters.forEach(function(chapter){
        out.push('《'+book.title+'》');
        out.push('章节：'+(chapter.label||'未标注章节'));
        chapter.paragraphs.forEach(function(p){out.push(p.text);});
        out.push('              《'+book.title+'》');
        out.push('');
      });
    });
    while(out.length&&out[out.length-1]==='')out.pop();
    return out.join('\n');
  }
  function paragraphsToOdtXml(items,q){
    var books=groupExtractItems(items),body=['<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2"><office:automatic-styles><style:style style:name="GN_B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="GN_I" style:family="text"><style:text-properties fo:font-style="italic"/></style:style><style:style style:name="GN_U" style:family="text"><style:text-properties style:text-underline-style="solid"/></style:style><style:style style:name="GN_S" style:family="text"><style:text-properties style:text-line-through-style="solid"/></style:style></office:automatic-styles><office:body><office:text>'];
    books.forEach(function(book){
      book.chapters.forEach(function(chapter){
        body.push('<text:h text:outline-level="1">'+xmlEsc('《'+book.title+'》')+'</text:h>');
        body.push('<text:h text:outline-level="2">'+xmlEsc('章节：'+(chapter.label||'未标注章节'))+'</text:h>');
        chapter.paragraphs.forEach(function(p){
          var d=new DOMParser().parseFromString(String(p.html||'<p>'+xmlEsc(p.text)+'</p>'),'text/html'),el=d.body&&d.body.firstElementChild;
          if(!el){body.push('<text:p>'+xmlEsc(p.text)+'</text:p>');return;}
          var t=String(el.tagName||'').toUpperCase(),inl=odtInline(el);
          if(/^H[1-6]$/.test(t))body.push('<text:h text:outline-level="'+t.slice(1)+'">'+inl+'</text:h>');
          else body.push('<text:p>'+inl+'</text:p>');
        });
        body.push('<text:p>'+xmlEsc('              《'+book.title+'》')+'</text:p>');
      });
    });
    body.push('</office:text></office:body></office:document-content>');return body.join('');
  }
  function u16(n){return new Uint8Array([n&255,(n>>>8)&255]);}
  function u32(n){return new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);}
  function cat(){var a=Array.prototype.slice.call(arguments),len=0;a.forEach(function(x){len+=x.length;});var o=new Uint8Array(len),p=0;a.forEach(function(x){o.set(x,p);p+=x.length;});return o;}
  function crc32(data){var c=~0;for(var i=0;i<data.length;i++){c^=data[i];for(var k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return (~c)>>>0;}
  function zipStored(entries){var enc=new TextEncoder(),ls=[],cs=[],off=0;entries.forEach(function(e){var name=enc.encode(e.name),data=e.data instanceof Uint8Array?e.data:enc.encode(e.data),crc=crc32(data),local=cat(new Uint8Array([80,75,3,4]),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data),central=cat(new Uint8Array([80,75,1,2]),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(off),name);ls.push(local);cs.push(central);off+=local.length;});var central=cat.apply(null,cs),locals=cat.apply(null,ls);return cat(locals,central,cat(new Uint8Array([80,75,5,6]),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(central.length),u32(locals.length),u16(0)));}
  function safeOdtFilename(q){var n=String(q||'搜索摘取').replace(/[\\/:*?"<>|]+/g,'_').replace(/[\x00-\x1f]/g,'_').trim();return (n||'搜索摘取').slice(0,180)+'.odt';}
  function buildOdtBlob(items,q){var content=paragraphsToOdtXml(items,q),styles='<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" office:version="1.2"><office:styles><style:style style:name="Standard" style:family="paragraph"/></office:styles></office:document-styles>',manifest='<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:media-type="application/vnd.oasis.opendocument.text" manifest:full-path="/"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="styles.xml"/></manifest:manifest>',zip=zipStored([{name:'mimetype',data:'application/vnd.oasis.opendocument.text'},{name:'content.xml',data:content},{name:'styles.xml',data:styles},{name:'META-INF/manifest.xml',data:manifest}]);return new Blob([zip],{type:'application/vnd.oasis.opendocument.text'});}
  function referenceFindMatches(text,q){
    /* 独立参考实现：只做规范化 + indexOf 全量扫描，不调用正式 findMatches。 */
    var source=String(text==null?'':text), nm=normalizedWithMap(source), nq=normalize(q), out=[];
    if(!nq)return out;
    var from=0,p;
    while((p=nm.text.indexOf(nq,from))>=0){
      var endPos=p+nq.length-1;
      var startOrig=nm.map[p];
      var endOrig=endPos<nm.mapEnd.length?nm.mapEnd[endPos]:source.length;
      out.push({start:startOrig,end:endOrig,text:source.slice(startOrig,endOrig)});
      from=p+1;
    }
    return out;
  }
  async function referenceScan(q){
    q=String(q||'').trim();if(!q||!globalThis.BookLibraryDB)return {query:q,booksScanned:0,booksMatched:0,totalMatches:0,occurrences:[]};
    var books=await BookLibraryDB.listMeta(),occurrences=[],booksMatched=0;
    for(var i=0;i<books.length;i++){
      var b=books[i];if(!b||!b.id)continue;
      var c=null;try{c=await BookLibraryDB.getContent(String(b.id));}catch(_){c=null;}
      var body=c?String(c.text||''):'';
      var ms=referenceFindMatches(body,q);
      if(ms.length){booksMatched++;ms.forEach(function(m){occurrences.push({bookId:String(b.id),start:m.start,end:m.end,text:m.text});});}
      c=null;body='';if(i%2===1)await yieldNow();
    }
    return {query:q,booksScanned:books.length,booksMatched:booksMatched,totalMatches:occurrences.length,occurrences:occurrences};
  }
  function occurrenceKey(x){return String(x.bookId)+'|'+String(x.start)+'|'+String(x.end)+'|'+String(x.text||'');}
  async function verifySearch(q){
    var expected=await referenceScan(q),actualRaw=await search(q),actual=[];
    (actualRaw||[]).forEach(function(r){(r.matches||[]).forEach(function(m){actual.push({bookId:String(r.bookId),start:Number(m.start)||0,end:Number(m.end)||0,text:String(m.text||'')});});});
    var eSet=new Set(expected.occurrences.map(occurrenceKey)),aSet=new Set(actual.map(occurrenceKey)),missing=[],extra=[];
    eSet.forEach(function(k){if(!aSet.has(k))missing.push(k);});aSet.forEach(function(k){if(!eSet.has(k))extra.push(k);});
    return {query:String(q||''),expected:expected,actual:{booksMatched:new Set(actual.map(function(x){return x.bookId;})).size,totalMatches:actual.length,occurrences:actual},missing:missing,extra:extra,pass:missing.length===0&&extra.length===0};
  }
  globalThis.BookNoteSearchIndex={ensure:ensure,rebuild:rebuild,search:search,referenceScan:referenceScan,verifySearch:verifySearch,extractParagraphs:extractParagraphs,terms:terms,normalize:normalize,findMatches:findMatches,stats:function(){return mem?{docCount:mem.docCount,termCount:mem.termCount,sectionCount:mem.sectionCount,builtAt:mem.builtAt}:null;},buildOdtBlob:buildOdtBlob,buildTemplateText:buildTemplateText,safeOdtFilename:safeOdtFilename};
})();
