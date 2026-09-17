(function(){
  "use strict";
  var browser=globalThis.browser;
  var root=document.getElementById("booknoteReader");
  if(!root || !browser || !browser.runtime) return;

  // Engine-neutral command surface. The reader now uses a section-oriented EPUB engine
  // modeled on the Readest/Foliate separation of book sections from the UI/data layer.
  // Floating UI and BookNote storage continue to depend only on this command boundary.
  var ReaderAdapter={
    id:"readest-section-reader-v2",
    version:2,
    command:function(command){
      command=String(command||"");
      var q=function(sel){return root.querySelector(sel);};
      if(command==="openReader") return true;
      if(command==="fullscreen"){
        var target=q(".booknote-reader")||root;
        if(document.fullscreenElement) return document.exitFullscreen();
        return target.requestFullscreen ? target.requestFullscreen().catch(function(){}) : false;
      }
      if(command==="settings"){
        var theme=q("[data-reader-theme]"); if(theme){theme.focus();return true;}
        root.dispatchEvent(new CustomEvent("booknote-reader-settings")); return true;
      }
      if(command==="play") { var b=q("[data-tts-toggle]")||q("[data-reader-tts-launch]"); if(b){b.click();return true;} }
      if(command==="pause") { var b=q("[data-tts-toggle]"); if(b){b.click();return true;} }
      if(command==="speed") { var b=q("[data-tts-rate]"); if(b){b.click();return true;} }
      if(command==="save") { var b=q("[data-reader-bookmark]"); if(b){b.click();return true;} }
      if(command==="search") { var b=q("[data-reader-search]"); if(b){b.focus();return true;} }
      if(command==="filter") { root.dispatchEvent(new CustomEvent("booknote-reader-filter")); return true; }
      if(command==="new") { var b=q("[data-reader-selection-note]"); if(b&&!b.hidden){b.click();return true;} root.dispatchEvent(new CustomEvent("booknote-reader-new-note")); return true; }
      return false;
    }
  };
  globalThis.BookNoteReaderAdapter=ReaderAdapter;
  browser.runtime.onMessage.addListener(function(msg){
    if(!msg || msg.type!=="booknote-reader-command") return;
    return Promise.resolve(ReaderAdapter.command(msg.command));
  });
})();
