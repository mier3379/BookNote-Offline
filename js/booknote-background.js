(function () {
  "use strict";
  var browser = globalThis.browser;

  var IDS = {
    add: "booknote107-add",
    note: "booknote107-note",
    favorite: "booknote107-favorite",
    pin: "booknote107-pin",
    open: "booknote107-open"
  };

  function getNotes() {
    return browser.storage.local.get("booknoteNotes").then(function (r) {
      return Array.isArray(r.booknoteNotes) ? r.booknoteNotes : [];
    });
  }

  function saveNotes(notes) {
    return browser.storage.local.set({ booknoteNotes: notes });
  }

  function addNote(mode, info, tab, favorite) {
    return getNotes().then(function (notes) {
      var now = new Date().toISOString();
      var note = {
        id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
        selectedText: info && info.selectionText || "",
        pageUrl: tab && tab.url || "",
        pageTitle: tab && tab.title || "",
        noteText: "",
        mode: mode || "note",
        favorite: !!favorite,
        pinned: mode === "pin",
        tags: [],
        createdAt: now,
        updatedAt: now
      };
      notes.push(note);
      return saveNotes(notes);
    });
  }

  function createMenu(id, title) {
    try {
      browser.menus.create({
        id: id,
        title: title,
        contexts: ["selection"]
      });
    } catch (e) {}
  }

  function createMenus() {
    // Only remove BookNote's own IDs. Never touch Read Aloud's menu entries.
    Object.keys(IDS).forEach(function (k) {
      try { browser.menus.remove(IDS[k]).catch(function () {}); } catch (e) {}
    });

    createMenu(IDS.add, "📝 添加到 BookNote");
    createMenu(IDS.note, "📝 笔记");
    createMenu(IDS.favorite, "⭐ BookNote 收藏");
    createMenu(IDS.pin, "📌 BookNote 点赞");

    try {
      browser.menus.create({
        id: IDS.open,
        title: "📖 打开 BookNote",
        contexts: ["page", "selection"]
      });
    } catch (e) {}
  }

  createMenus();
  browser.runtime.onInstalled.addListener(createMenus);
  if (browser.runtime.onStartup) browser.runtime.onStartup.addListener(createMenus);

  browser.menus.onClicked.addListener(function (info, tab) {
    var id = info.menuItemId;

    if (id === IDS.open) {
      return browser.tabs.create({
        url: browser.runtime.getURL("booknote/panel.html")
      });
    }

    if (!info.selectionText) return;

    var promise = null;
    if (id === IDS.note) {
      return browser.tabs.sendMessage(tab.id, {
        type: "booknote-open-note-editor",
        selectionText: info.selectionText || "",
        pageUrl: (tab && tab.url) || "",
        pageTitle: (tab && tab.title) || ""
      }).catch(function () {
        try { console.error("BookNote note editor could not be opened"); } catch (_) {}
      });
    }

    if (id === IDS.add) {
      promise = addNote("note", info, tab, false);
    } else if (id === IDS.favorite) {
      promise = addNote("note", info, tab, true);
    } else if (id === IDS.pin) {
      promise = addNote("pin", info, tab, false);
    }

    if (!promise) return;

    // Open the manager after saving so the user can immediately see/edit
    // the newly-created BookNote instead of having a silent operation.
    promise.then(function () {
      return browser.tabs.create({
        url: browser.runtime.getURL("booknote/panel.html")
      });
    }).catch(function (e) {
      try { console.error("BookNote save failed", e); } catch (_) {}
    });
  });
})();
  browser.runtime.onMessage.addListener(function(msg) {
    if (!msg || msg.type !== "booknote-jump") return;
    return browser.tabs.create({url: msg.url, active: true}).then(function(tab) {
      var tries=0;
      function send() {
        tries++;
        return browser.tabs.sendMessage(tab.id, {
          type:"booknote-open-existing",
          selectedText:msg.selectedText||"",
          noteId:msg.noteId||"",
          pageUrl:msg.url
        }).catch(function(){
          if(tries<20) return new Promise(function(resolve){
            setTimeout(function(){resolve(send());},400);
          });
        });
      }
      return new Promise(function(resolve){
        setTimeout(function(){resolve(send());},700);
      });
    });
  });

  browser.runtime.onMessage.addListener(function(msg) {
    if (!msg || msg.type !== "booknote-open-voice-settings") return;
    return browser.tabs.create({
      url: browser.runtime.getURL("options.html?referer=booknote-floating"),
      active: true
    });
  });

  browser.runtime.onMessage.addListener(function(msg) {
    if (!msg || msg.type !== "booknote-open-panel-default") return;
    return browser.storage.local.get("booknotePanelState").then(function (r) {
      var st = r.booknotePanelState || {};
      st.themeName = "everforest";
      st.themeMode = "day";
      return browser.storage.local.set({ booknotePanelState: st });
    }).then(function () {
      return browser.tabs.create({
        url: browser.runtime.getURL("booknote/panel.html"),
        active: true
      });
    });
  });

  browser.runtime.onMessage.addListener(function(msg) {
    if (!msg || msg.type !== "booknote-open-panel") return;
    return browser.tabs.create({
      url: browser.runtime.getURL("booknote/panel.html"),
      active: true
    });
  });


  // ============================================================
  // BookNote Floating UI v2 — command bus / reader adapter bridge
  // ============================================================
  browser.runtime.onMessage.addListener(function(msg, sender) {
    if (!msg || msg.type !== "booknote-command") return;
    var command = String(msg.command || "");
    var tab = sender && sender.tab;
    var tabId = tab && tab.id;

    function sendToTab(type, extra) {
      if (!tabId) return Promise.resolve(false);
      var payload = Object.assign({type:type, command:command}, extra || {});
      return browser.tabs.sendMessage(tabId, payload).then(function(){ return true; }).catch(function(){ return false; });
    }
    function openPanel() {
      return browser.tabs.create({url: browser.runtime.getURL("booknote/panel.html"), active:true});
    }

    // Semantic routing: Floating UI never calls reader internals directly.
    if (command === "openReader") return openPanel();
    if (command === "fullscreen" || command === "settings" || command === "play" ||
        command === "pause" || command === "speed" || command === "save" ||
        command === "search" || command === "filter" || command === "new") {
      return sendToTab("booknote-reader-command");
    }
    if (command === "import" || command === "export" || command === "open" || command === "share" ||
        command === "tag" || command === "more" || command === "delete") return openPanel();
    if (command === "capture" || command === "translate" || command === "link") {
      return sendToTab("booknote-radial-web-command");
    }
    return false;
  });
