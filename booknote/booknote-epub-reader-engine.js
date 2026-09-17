(function(){
  "use strict";

  // Section-oriented EPUB renderer inspired by Readest/Foliate's model:
  // the book is represented as independent sections, while the UI keeps the
  // library/annotation/search layers outside the rendering engine.
  function Engine(host){
    this.host=host;
    this.data=null;
    this.frame=null;
    this.index=-1;
    this.resourceUrls=new Map();
    this.objectUrls=[];
    this.fontScale=1;
    this.lineHeight=1.8;
    this.theme="light";
    this.loading=Promise.resolve();
  }

  Engine.prototype.destroy=function(){
    this.loading=Promise.resolve();
    if(this.frame)this.frame.src="about:blank";
    this.frame=null;
    this.host.innerHTML="";
    this.resourceUrls.forEach(function(url){try{URL.revokeObjectURL(url);}catch(_){} });
    this.resourceUrls.clear();
    this.objectUrls.length=0;
    this.data=null;
    this.index=-1;
  };

  Engine.prototype.setData=function(data){
    this.data=data;
    this.index=-1;
  };

  Engine.prototype.setSettings=function(settings){
    settings=settings||{};
    this.fontScale=Math.max(.7,Math.min(1.8,Number(settings.fontScale||100)/100));
    this.lineHeight=Math.max(1.2,Math.min(2.6,Number(settings.lineHeight||1.8)));
    this.theme=settings.theme||"light";
    var doc=this.getDocument();
    if(doc){
      doc.documentElement.style.setProperty("--booknote-font-scale",String(this.fontScale));
      doc.documentElement.style.setProperty("--booknote-line-height",String(this.lineHeight));
      doc.documentElement.dataset.booknoteTheme=this.theme;
    }
  };

  Engine.prototype.getDocument=function(){
    try{return this.frame&&this.frame.contentDocument||null;}catch(_){return null;}
  };

  Engine.prototype.getText=function(){
    var doc=this.getDocument();
    return doc&&doc.body?String(doc.body.textContent||""):"";
  };

  Engine.prototype.getSelection=function(){
    var doc=this.getDocument();
    if(!doc)return null;
    var win=doc.defaultView,sel=win&&win.getSelection?win.getSelection():null;
    if(!sel||!sel.rangeCount||sel.isCollapsed)return null;
    var text=String(sel.toString()||"").replace(/\s+/g," ").trim();
    if(!text)return null;
    var range=sel.getRangeAt(0),before=doc.createRange();
    before.selectNodeContents(doc.body);before.setEnd(range.startContainer,range.startOffset);
    var start=before.toString().length;
    var rect=range.getBoundingClientRect();
    var chapter=(this.data&&this.data.chapters||[])[this.index]||{};
    return {text:text,start:start,end:start+text.length,chapterIndex:this.index,chapterHref:chapter.href||"",prefix:(doc.body.textContent||"").slice(Math.max(0,start-40),start),suffix:(doc.body.textContent||"").slice(start+text.length,start+text.length+40),rect:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom}};
  };

  Engine.prototype.scrollToOffset=function(pos){
    var doc=this.getDocument();
    if(!doc||!doc.body)return false;
    var nodes=[],walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT,null),n;
    while((n=walker.nextNode()))nodes.push(n);
    var total=0,target=null,offset=0,pos=Math.max(0,Number(pos)||0);
    for(var i=0;i<nodes.length;i++){
      var len=(nodes[i].nodeValue||"").length;
      if(pos<=total+len){target=nodes[i];offset=Math.max(0,pos-total);break;}
      total+=len;
    }
    if(!target&&nodes.length){target=nodes[nodes.length-1];offset=target.nodeValue.length;}
    if(!target)return false;
    var range=doc.createRange();range.setStart(target,offset);range.collapse(true);
    var el=target.parentElement||target;el.scrollIntoView({block:"center",behavior:"auto"});
    return true;
  };

  Engine.prototype.highlight=function(hits,activeIndex){
    var doc=this.getDocument();
    if(!doc||!doc.body)return;
    // Remove previous search marks without touching the book's markup.
    doc.querySelectorAll("mark[data-booknote-search]").forEach(function(mark){
      var p=mark.parentNode;if(!p)return;p.replaceChild(doc.createTextNode(mark.textContent||""),mark);p.normalize();
    });
    if(!hits||!hits.length)return;
    var hit=hits[activeIndex>=0?activeIndex:0];
    if(!hit)return;
    var start=Number(hit.localStart!=null?hit.localStart:hit.start)||0,end=Number(hit.localEnd!=null?hit.localEnd:hit.end)||start;
    var walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT,null),nodes=[],n,total=0;
    while((n=walker.nextNode()))nodes.push({node:n,start:total,end:total+(n.nodeValue||"").length}),total+=(n.nodeValue||"").length;
    var range=doc.createRange(),startNode=null,endNode=null,startOffset=0,endOffset=0;
    for(var i=0;i<nodes.length;i++){
      var x=nodes[i];
      if(start>=x.start&&start<=x.end){startNode=x.node;startOffset=start-x.start;}
      if(end>=x.start&&end<=x.end){endNode=x.node;endOffset=end-x.start;break;}
    }
    if(!startNode||!endNode)return;
    try{range.setStart(startNode,startOffset);range.setEnd(endNode,endOffset);var mark=doc.createElement("mark");mark.dataset.booknoteSearch="1";mark.style.background="#FFE58A";mark.style.color="#20252B";range.surroundContents(mark);mark.scrollIntoView({block:"center",behavior:"auto"});}catch(_){}
  };

  Engine.prototype.resourceUrl=async function(path){
    path=String(path||"");
    if(!path)return "";
    if(this.resourceUrls.has(path))return this.resourceUrls.get(path);
    var zip=this.data&&this.data.zip,meta=this.data&&this.data.resources&&this.data.resources[path];
    if(!zip||!meta)return "";
    var bytes=await zip.get(path);if(!bytes)return "";
    var blob=new Blob([bytes],{type:meta.media||"application/octet-stream"});
    var url=URL.createObjectURL(blob);this.resourceUrls.set(path,url);this.objectUrls.push(url);return url;
  };

  function escAttr(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
  function unquote(s){s=String(s||"").trim();if((s[0]==='"'&&s[s.length-1]==='"')||(s[0]==="'"&&s[s.length-1]==="'"))return s.slice(1,-1);return s;}

  Engine.prototype.rewriteCss=async function(css,basePath,seen){
    var self=this;seen=seen||new Set();basePath=String(basePath||"");
    var importRe=/@import\s+(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?\s*([^;]*);/gi;
    var out="",last=0,m;
    while((m=importRe.exec(String(css||"")))){
      out+=String(css||"").slice(last,m.index);last=importRe.lastIndex;
      var target=self.resolve(basePath,m[1]);
      if(!seen.has(target)){
        seen.add(target);
        try{var raw=await self.data.zip.get(target);if(raw){var text=new TextDecoder("utf-8").decode(raw);out+=await self.rewriteCss(text,target,seen);}}catch(_){}
      }
    }
    out+=String(css||"").slice(last);
    out=out.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi,function(full,q,target){
      target=String(target||"").trim();
      if(!target||/^(?:data:|https?:|blob:|#)/i.test(target))return full;
      var path=self.resolve(basePath,target.split("#")[0]);
      var meta=self.data.resources&&self.data.resources[path];
      if(!meta)return full;
      // URL creation is asynchronous; placeholders are replaced after scanning below.
      return "__BOOKNOTE_RESOURCE__"+path.replace(/[^A-Za-z0-9_./-]/g,"_")+"__";
    });
    var paths=[];out.replace(/__BOOKNOTE_RESOURCE__(.*?)__/g,function(_,p){paths.push(p);return _;});
    var unique=[];paths.forEach(function(p){if(unique.indexOf(p)<0)unique.push(p);});
    for(var i=0;i<unique.length;i++){var path=unique[i],url=await self.resourceUrl(path);out=out.split("__BOOKNOTE_RESOURCE__"+path.replace(/[^A-Za-z0-9_./-]/g,"_")+"__").join(url?url:"data:, ");}
    return out;
  };

  Engine.prototype.resolve=function(base,target){
    if(!target)return base;
    try{return new URL(target,"https://booknote.invalid/"+String(base||"").replace(/[^/]*$/,"" )).pathname.replace(/^\//,"");}catch(_){return (String(base||"").replace(/[^/]*$/,"" )+target).replace(/\/\.\//g,"/");}
  };

  Engine.prototype.rewriteHtml=async function(html,basePath){
    var self=this,parser=new DOMParser(),doc=parser.parseFromString(String(html||""),"text/html");
    doc.querySelectorAll("script,iframe,object,embed,form,base,meta").forEach(function(n){n.remove();});
    doc.querySelectorAll("*[onload],[onclick],[onerror],[onmouseover],[onmousedown],[onmouseup],[onkeydown],[onkeyup]").forEach(function(n){Array.prototype.slice.call(n.attributes).forEach(function(a){if(/^on/i.test(a.name))n.removeAttribute(a.name);});});
    var links=Array.prototype.slice.call(doc.querySelectorAll('link[rel~="stylesheet"][href]'));
    for(var i=0;i<links.length;i++){
      var href=links[i].getAttribute("href"),path=self.resolve(basePath,href.split("#")[0]),raw=null;
      try{raw=await self.data.zip.get(path);}catch(_){}
      if(raw){var css=new TextDecoder("utf-8").decode(raw),style=doc.createElement("style");style.textContent=await self.rewriteCss(css,path,new Set([path]));links[i].replaceWith(style);}else links[i].remove();
    }
    var imgs=Array.prototype.slice.call(doc.querySelectorAll("img[src],image[href],image[xlink\\:href],source[src],video[src],audio[src]"));
    for(var j=0;j<imgs.length;j++){
      var node=imgs[j],attr=node.hasAttribute("src")?"src":(node.hasAttribute("href")?"href":"xlink:href"),value=node.getAttribute(attr)||"";
      if(!value||/^(?:data:|https?:|blob:|#)/i.test(value))continue;
      var path2=self.resolve(basePath,value.split("#")[0]),url2=await self.resourceUrl(path2);if(url2)node.setAttribute(attr,url2);
    }
    var styled=Array.prototype.slice.call(doc.querySelectorAll("[style]"));
    for(var k=0;k<styled.length;k++){var st=styled[k].getAttribute("style");if(st&&/url\(/i.test(st))styled[k].setAttribute("style",await self.rewriteCss(st,basePath,new Set()));}
    doc.querySelectorAll("a[href]").forEach(function(a){var href=a.getAttribute("href")||"";if(!href||/^(?:https?:|mailto:|javascript:|#)/i.test(href))a.dataset.booknoteHref=self.resolve(basePath,href);});
    return {head:doc.head?doc.head.innerHTML:"",body:doc.body?doc.body.innerHTML:"",lang:doc.documentElement.getAttribute("lang")||"",dir:doc.documentElement.getAttribute("dir")||""};
  };

  Engine.prototype.makeSrcdoc=async function(chapter){
    var body=await this.rewriteHtml(chapter.html,chapter.href),lang=body.lang||chapter.lang||"",dir=body.dir||chapter.dir||"";
    var css='html,body{margin:0!important;padding:0!important;min-height:100%;}body{box-sizing:border-box!important;padding:28px clamp(20px,6vw,76px) 80px!important;font-size:calc(1em * var(--booknote-font-scale,1))!important;line-height:var(--booknote-line-height,1.8)!important;overflow-y:auto!important;overflow-x:auto!important;}img,svg,video{max-width:100%!important;height:auto;}table{max-width:100%;overflow:auto;}pre,code{white-space:pre-wrap;overflow-wrap:anywhere;}a{cursor:pointer;}::selection{background:rgba(80,130,220,.28);}';
    var theme=dir?dir:"ltr";
    return '<!doctype html><html lang="'+escAttr(lang)+'" dir="'+escAttr(theme)+'"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; font-src data: blob:; media-src data: blob:;">'+body.head+'<style data-booknote-engine>'+css+'</style></head><body>'+body.body+'</body></html>';
  };

  Engine.prototype.load=function(index){
    var self=this,data=this.data;if(!data||!data.chapters||!data.chapters[index])return Promise.reject(new Error("EPUB 章节不存在"));
    this.loading=this.loading.then(async function(){
      var chapter=data.chapters[index],srcdoc=await self.makeSrcdoc(chapter);
      if(self.frame){self.frame.remove();self.frame=null;}
      var frame=document.createElement("iframe");frame.className="reader-epub-frame";frame.setAttribute("sandbox","allow-same-origin");frame.setAttribute("referrerpolicy","no-referrer");frame.setAttribute("title",chapter.label||("第 "+(index+1)+" 章"));
      self.host.innerHTML="";self.host.appendChild(frame);self.frame=frame;self.index=index;
      await new Promise(function(resolve,reject){var timer=setTimeout(function(){resolve();},3500);frame.addEventListener("load",function(){clearTimeout(timer);resolve();},{once:true});frame.addEventListener("error",function(){clearTimeout(timer);reject(new Error("EPUB 章节渲染失败"));},{once:true});frame.srcdoc=srcdoc;});
      self.setSettings({fontScale:self.fontScale*100,lineHeight:self.lineHeight,theme:self.theme});
      var doc=self.getDocument();
      if(doc){
        doc.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a"):null;if(!a)return;var href=a.getAttribute("href")||a.dataset.booknoteHref||"";if(!href)return;if(!/^(?:https?:|mailto:|javascript:)/i.test(href)){e.preventDefault();self.host.dispatchEvent(new CustomEvent("booknote-epub-link",{detail:{href:href,chapterIndex:self.index}}));}},true);
        doc.addEventListener("mouseup",function(){self.host.dispatchEvent(new CustomEvent("booknote-epub-selection"));});
        doc.addEventListener("keyup",function(){self.host.dispatchEvent(new CustomEvent("booknote-epub-selection"));});
        var scrollTarget=doc.documentElement||doc.body;if(scrollTarget)scrollTarget.addEventListener("scroll",function(){self.host.dispatchEvent(new CustomEvent("booknote-epub-scroll"));},{passive:true});
      }
    });
    return this.loading;
  };

  globalThis.BookNoteEpubReaderEngine=Engine;
})();
