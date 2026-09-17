(() => {
  "use strict";

  // ============================================================
  // BookNote Floating UI v2 Fusion Master
  // Single Root only. Legacy Roots are actively purged.
  // Data -> Geometry -> SVG/DOM Render -> Interaction -> Spring FX
  // ============================================================
  if (window.top !== window) return;

  const HOST_ID = "booknote-floating-ui-v2-host";
  // Every older Lab instance lives under this dedicated host namespace.
  // The current build creates exactly one Root host.

  // ------------------------------------------------------------
  // LEGACY COMPATIBILITY CLEANUP
  // ------------------------------------------------------------
  // If an older Radial Lab instance is still present, do NOT destroy
  // its Root #2 or its L2 tools. The requested fallback behavior is:
  //   Root #2 / L1 = keep
  //   Root #2 / L2 = keep
  //   Root #2 / L3 = remove
  // This is intentionally narrower than deleting the whole legacy host.
  const stripLegacyL3 = (scope) => {
    if (!scope) return;

    // HARD FALLBACK POLICY FOR TOOL #2:
    // Keep its L1 trigger and L2 buttons, but remove every known L3
    // container/button/fan/tunnel. This is intentionally scoped to the
    // legacy secondary namespace and never removes generic page buttons.
    const removeSelectors = [
      '.bn-secondary-children',
      '.bn-secondary-child',
      '.bn-secondary-fan',
      '.bn-secondary-tunnel',
      '[data-radial-level="3"]',
      '[data-level="3"]',
      '[data-radial-l3]'
    ];
    for (const selector of removeSelectors) {
      scope.querySelectorAll?.(selector).forEach(node => node.remove());
    }

    // Older experimental builds may have renamed the L3 class but kept the
    // secondary namespace. Remove only secondary elements whose class/name
    // explicitly identifies a child/L3/fan/tunnel layer. Never touch
    // .bn-secondary-trigger or .bn-secondary-item (L1/L2 are preserved).
    scope.querySelectorAll?.('[class*="secondary"], [id*="secondary"]').forEach(node => {
      const name = `${node.className?.baseVal || node.className || ''} ${node.id || ''}`.toLowerCase();
      if (/(child|children|l3|fan|tunnel)/.test(name) && !/trigger|item/.test(name)) {
        node.remove();
      }
    });

    // Traverse open shadow roots so cleanup also works when the legacy
    // instance is encapsulated in Shadow DOM.
    scope.querySelectorAll?.('*').forEach(node => {
      if (node.shadowRoot) stripLegacyL3(node.shadowRoot);
    });
    if (typeof ShadowRoot !== 'undefined' && scope instanceof ShadowRoot) {
      scope.querySelectorAll('*').forEach(node => {
        if (node.shadowRoot) stripLegacyL3(node.shadowRoot);
      });
    }
  };

  const purgeLegacy = () => {
    // Keep old Root #2 (L1) and its L2 tools; remove ALL legacy L3 layers.
    stripLegacyL3(document);
  };
  purgeLegacy();

  const legacyObserver = new MutationObserver(() => stripLegacyL3(document));
  if (document.documentElement) {
    legacyObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  const legacyTimer = setInterval(purgeLegacy, 700);
  window.addEventListener("pagehide", () => {
    legacyObserver.disconnect();
    clearInterval(legacyTimer);
  }, { once: true });

  if (document.getElementById(HOST_ID)) return;

  const NS = "http://www.w3.org/2000/svg";
  const TAU = Math.PI * 2;

  // ============================================================
  // 1. DATA LAYER
  // ============================================================
  const menuConfig = [
    { id:"bookmark", icon:"bookmark", label:"书签", color:"#7b61ff", children:["open","save","share"] },
    { id:"reader", icon:"book", label:"阅读", color:"#4ca8ff", children:["openReader","fullscreen","settings"] },
    { id:"tts", icon:"sound", label:"朗读", color:"#20d7c8", children:["play","pause","speed"] },
    { id:"document", icon:"document", label:"文档", color:"#ff8b5c", children:["open","import","export"] },
    { id:"web", icon:"globe", label:"网页", color:"#36d978", children:["capture","translate","link"] },
    { id:"search", icon:"search", label:"搜索", color:"#38bdf8", children:["search","filter","settings"] },
    { id:"note", icon:"edit", label:"笔记", color:"#b36cff", children:["new","tag","share"] },
    { id:"tools", icon:"grid", label:"工具", color:"#ff5fd2", children:["settings","more","delete"] }
  ];

  const childConfig = {
    open:{icon:"open",label:"打开",color:"#43b5ff"},
    openReader:{icon:"book",label:"打开阅读器",color:"#4ca8ff"},
    fullscreen:{icon:"fullscreen",label:"全屏",color:"#8c7cff"},
    save:{icon:"save",label:"保存",color:"#53d88a"},
    share:{icon:"share",label:"分享",color:"#c26dff"},
    play:{icon:"play",label:"播放",color:"#30d7c8"},
    pause:{icon:"pause",label:"暂停",color:"#ffb347"},
    settings:{icon:"settings",label:"设置",color:"#ff6fcf"},
    speed:{icon:"speed",label:"语速",color:"#4da6ff"},
    import:{icon:"import",label:"导入",color:"#45d88b"},
    export:{icon:"export",label:"导出",color:"#a873ff"},
    capture:{icon:"capture",label:"捕获",color:"#38d98c"},
    translate:{icon:"translate",label:"翻译",color:"#40b8ff"},
    link:{icon:"link",label:"链接",color:"#9f70ff"},
    search:{icon:"search",label:"搜索",color:"#38bdf8"},
    filter:{icon:"filter",label:"筛选",color:"#55d6c6"},
    new:{icon:"plus",label:"新建",color:"#52d98a"},
    tag:{icon:"tag",label:"标签",color:"#ff9a58"},
    delete:{icon:"trash",label:"删除",color:"#ff5b72"},
    more:{icon:"more",label:"更多",color:"#b36cff"}
  };

  const icons = {
    grid:'<rect x="5" y="5" width="5" height="5"/><rect x="14" y="5" width="5" height="5"/><rect x="5" y="14" width="5" height="5"/><rect x="14" y="14" width="5" height="5"/>',
    bookmark:'<path d="M7 4.5h10v15l-5-3-5 3z"/>',
    book:'<path d="M5 5.5c2.5-.9 4.7-.7 7 1v12c-2.3-1.7-4.5-1.9-7-1z"/><path d="M19 5.5c-2.5-.9-4.7-.7-7 1v12c2.3-1.7-4.5-1.9-7-1z"/>'.replace('-4.5','-4.5'),
    sound:'<path d="M5 10h3l4-4v12l-4-4H5z"/><path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10"/>',
    document:'<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v5h4M10 13h5M10 16h5"/>',
    globe:'<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5z"/>',
    search:'<circle cx="10.5" cy="10.5" r="5.8"/><path d="m15 15 5 5"/>',
    edit:'<path d="m5 19 3.5-.7L19 7.8a2.1 2.1 0 0 0-3-3L5.5 15.3 5 19Z"/><path d="m14.5 6.5 3 3"/>',
    open:'<path d="M4 7.5h6l2 2h8v9H4z"/><path d="M12 10v6M9 13h6"/>',
    save:'<path d="M5 4h12l2 2v14H5z"/><path d="M8 4v6h8V4M8 16h8"/>',
    share:'<circle cx="6" cy="12" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="m8 11 8-4M8 13l8 4"/>',
    play:'<path d="m8 5 10 7-10 7z"/>',
    pause:'<path d="M8 5v14M16 5v14"/>',
    settings:'<path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.5 1.5M16.5 16.5 18 18M18 6l-1.5 1.5M7.5 16.5 6 18"/><circle cx="12" cy="12" r="4"/>',
    speed:'<path d="M4 16a8 8 0 1 1 16 0"/><path d="m12 12 4-4"/><path d="M7 18h10"/>',
    import:'<path d="M12 4v11M8 11l4 4 4-4M5 19h14"/>',
    export:'<path d="M12 20V9M8 13l4-4 4 4M5 5h14"/>',
    capture:'<path d="M5 8V5h3M16 5h3v3M19 16v3h-3M8 19H5v-3"/><circle cx="12" cy="12" r="4"/>',
    translate:'<path d="M5 5h7M8.5 5v2c0 4-2 6-4 7M6 10c1.5 1.5 3.2 2.7 5.5 3.5M14 6h5M16.5 6v2l-3 8M14.5 13h6"/>',
    link:'<path d="M9.2 14.8 7.7 16.3a4 4 0 0 1-5.7-5.7l3-3a4 4 0 0 1 5.7 0M14.8 9.2l1.5-1.5a4 4 0 1 1 5.7 5.7l-3 3a4 4 0 0 1-5.7 0M8 16l8-8"/>',
    filter:'<path d="M4 6h16M7 12h10M10 18h4"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    tag:'<path d="M4 6v7l7 7 9-9-7-7z"/><circle cx="9" cy="9" r="1"/>',
    trash:'<path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13M10 10v7M14 10v7"/>',
    more:'<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    fullscreen:'<path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"/>'
  };

  // ============================================================
  // 2. GEOMETRY CONFIG / STATE
  // ============================================================
  const G = {
    rootSize: 64,
    l2Size: 56,
    l3Size: 52,
    l2Radius: 88,
    l3ForwardMin: 70,
    l3ForwardIdeal: 86,
    l3ForwardStep: 6,
    l3Gap: 10,
    childTangentStep: 64,
    edgePad: 14,
    safePageGap: 10,
    hoverDelay: 85,
    dragThreshold: 4,
    springStiffness: 0.28,
    springDamping: 0.72,
    openSpring: 0.24
  };

  const state = {
    open: false,
    activeIndex: -1,
    rootX: Math.max(88, innerWidth - 88),
    rootY: Math.max(88, innerHeight - 88),
    targetX: Math.max(88, innerWidth - 88),
    targetY: Math.max(88, innerHeight - 88),
    vx: 0,
    vy: 0,
    drag: false,
    moved: false,
    downX: 0,
    downY: 0,
    hoverTimer: 0,
    animationFrame: 0,
    layout: null
  };

  // ============================================================
  // 3. DOM / STYLE LAYER
  // ============================================================
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "all:initial;position:fixed;inset:0;width:100vw;height:100vh;overflow:visible;contain:none;z-index:2147483647;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);

  const css = `
    :host{all:initial}
    .stage{position:fixed;inset:0;width:100vw;height:100vh;overflow:visible;pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;user-select:none;z-index:2147483647}
    .menu{position:absolute;left:0;top:0;width:100vw;height:100vh;min-width:100vw;min-height:100vh;overflow:visible;contain:none;pointer-events:none}
    button{font:inherit}
    .trigger,.item,.child{position:absolute;display:grid;place-items:center;border-radius:50%;padding:0;cursor:pointer;pointer-events:auto;box-sizing:border-box;transform-origin:center;will-change:transform,left,top}
    .trigger{width:${G.rootSize}px;height:${G.rootSize}px;left:0;top:0;transform:translate(-50%,-50%);border:1px solid rgba(255,255,255,.78);color:#fff;background:linear-gradient(135deg,#765cff,#4b8cff 48%,#27d0ce);box-shadow:0 0 0 1px rgba(255,255,255,.16),0 14px 38px rgba(66,72,180,.44),0 0 30px rgba(87,110,255,.58),inset 0 1px 0 rgba(255,255,255,.8);z-index:100;transition:filter .18s ease,box-shadow .18s ease}
    .trigger:hover{filter:saturate(1.12) brightness(1.04);box-shadow:0 0 0 1px rgba(255,255,255,.22),0 16px 42px rgba(66,72,180,.5),0 0 36px rgba(87,110,255,.72),inset 0 1px 0 rgba(255,255,255,.85)}
    .trigger::before{content:"";position:absolute;inset:-10px;border-radius:50%;background:conic-gradient(#7c5cff,#29dfff,#5ce8a2,#ffd166,#ff63d5,#7c5cff);filter:blur(10px);opacity:.48;z-index:-1;animation:spin 5s linear infinite}
    .trigger svg,.item svg,.child svg{width:24px;height:24px;position:relative;z-index:2}
    .orbit{position:absolute;left:0;top:0;width:${G.l2Radius*2}px;height:${G.l2Radius*2}px;transform:translate(-50%,-50%);border:1px solid rgba(115,125,255,.22);border-radius:50%;pointer-events:none;opacity:0;transition:opacity .2s ease}
    .menu.open .orbit{opacity:1}
    .orbit::after{content:"";position:absolute;inset:-2px;border-radius:50%;border:1px solid transparent;border-top-color:#62dcff;border-right-color:#ff69dc;filter:drop-shadow(0 0 5px rgba(88,210,255,.65));animation:spin 7s linear infinite}
    .item{width:${G.l2Size}px;height:${G.l2Size}px;left:0;top:0;transform:translate(-50%,-50%) scale(.2);opacity:0;border:1px solid rgba(255,255,255,.82);color:#16233e;background:linear-gradient(145deg,#fff,#f2f5ff);z-index:40;box-shadow:0 10px 25px rgba(21,29,58,.18),0 0 20px color-mix(in srgb,var(--c) 38%,transparent),inset 0 1px 0 #fff;transition:opacity .16s ease,filter .18s ease,box-shadow .18s ease}
    .item.visible{opacity:1;transform:translate(-50%,-50%) scale(1)}
    .item:hover{filter:saturate(1.18);box-shadow:0 16px 34px rgba(21,29,58,.23),0 0 30px color-mix(in srgb,var(--c) 70%,transparent),inset 0 1px 0 #fff}
    .item::before{content:"";position:absolute;inset:-5px;border-radius:50%;background:conic-gradient(var(--c),transparent 30%,#fff 50%,transparent 72%,var(--c));filter:blur(5px);opacity:.28;animation:pulse 2.7s ease-in-out infinite}
    .child{width:${G.l3Size}px;height:${G.l3Size}px;left:0;top:0;transform:translate(-50%,-50%) scale(.18);opacity:0;border:1px solid rgba(255,255,255,.84);color:#16233e;background:linear-gradient(145deg,#fff,#f5fff9);z-index:50;box-shadow:0 12px 28px rgba(22,56,44,.18),0 0 18px color-mix(in srgb,var(--c) 52%,transparent),inset 0 1px 0 #fff;transition:opacity .16s ease,filter .18s ease,box-shadow .18s ease}
    .child.visible{opacity:1;transform:translate(-50%,-50%) scale(1)}
    .child:hover{filter:saturate(1.2);box-shadow:0 18px 36px rgba(22,56,44,.24),0 0 32px color-mix(in srgb,var(--c) 78%,transparent),inset 0 1px 0 #fff}
    .child::before{content:"";position:absolute;inset:-7px;border-radius:50%;background:conic-gradient(var(--c),#55e7cf,#a36cff,#ff6bc9,var(--c));filter:blur(7px);opacity:.3;animation:spin 4.5s linear infinite}
    .svg{position:fixed;left:0;top:0;width:100vw;height:100vh;min-width:100vw;min-height:100vh;overflow:visible;contain:none;pointer-events:none;z-index:25}
    .fan{fill:rgba(92,112,255,.08);stroke:url(#fanGrad);stroke-width:1.1;filter:url(#fanGlow);opacity:0;transition:opacity .16s ease}
    .fan.visible{opacity:1}
    .tunnel{fill:transparent;stroke:transparent;stroke-width:32;pointer-events:auto;cursor:default}
    .tooltip{position:fixed;left:0;top:0;transform:translate(-50%,-135%);padding:6px 9px;border-radius:8px;color:#fff;background:rgba(13,17,29,.9);backdrop-filter:blur(8px);font:12px/1.2 system-ui;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .1s ease;z-index:1000}
    .tooltip.show{opacity:1}
    .debug-ray{stroke:#35e4ff;stroke-width:1;stroke-dasharray:4 5;opacity:0}
    .menu.debug .debug-ray{opacity:.22}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes pulse{0%,100%{opacity:.14;transform:scale(.94)}50%{opacity:.44;transform:scale(1.06)}}
    @media(prefers-reduced-motion:reduce){.trigger::before,.item::before,.child::before,.orbit::after{animation:none}.item,.child,.trigger,.fan,.tooltip{transition:none}}
  `;
  const style = document.createElement("style");
  style.textContent = css;
  shadow.appendChild(style);

  const stage = document.createElement("div");
  stage.className = "stage";
  stage.innerHTML = `
    <div class="menu" id="menu">
      <svg class="svg" id="svg" viewBox="0 0 ${Math.max(1,innerWidth)} ${Math.max(1,innerHeight)}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="fanGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#44dfff"/><stop offset=".45" stop-color="#9b67ff"/><stop offset="1" stop-color="#ff63cf"/>
          </linearGradient>
          <filter id="fanGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <g id="visual"></g>
        <g id="tunnels"></g>
      </svg>
      <div class="orbit" id="orbit"></div>
      <button class="trigger" id="trigger" aria-label="打开径向菜单" aria-expanded="false">${iconSvg('grid')}</button>
      <div id="items"></div>
      <div id="children"></div>
    </div>
    <div class="tooltip" id="tooltip"></div>`;
  shadow.appendChild(stage);

  const menu = shadow.getElementById("menu");
  const trigger = shadow.getElementById("trigger");
  const items = shadow.getElementById("items");
  const children = shadow.getElementById("children");
  const svg = shadow.getElementById("svg");
  const visual = shadow.getElementById("visual");
  const tunnels = shadow.getElementById("tunnels");
  const tooltip = shadow.getElementById("tooltip");

  // ============================================================
  // 4. MATH / GEOMETRY ENGINE
  // ============================================================
  const polar = (r, a) => ({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
  const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
  const rootPoint = () => ({x:state.rootX,y:state.rootY});
  const l2Angle = i => -Math.PI/2 + i*(TAU/menuConfig.length);

  function l2Point(i) {
    const a = l2Angle(i), p = polar(G.l2Radius,a);
    return {x:state.rootX+p.x,y:state.rootY+p.y,angle:a};
  }

  function childSpread(count) {
    if (count <= 1) return [0];
    if (count === 2) return [-G.childTangentStep/2, G.childTangentStep/2];
    if (count === 3) return [-G.childTangentStep,0,G.childTangentStep];
    const max = G.childTangentStep * 1.8;
    return Array.from({length:count},(_,i)=>-max/2 + max*i/(count-1));
  }

  function candidateLayout(index, forward) {
    const item = menuConfig[index];
    const parent = l2Point(index);
    const u = {x:Math.cos(parent.angle),y:Math.sin(parent.angle)};
    const t = {x:-u.y,y:u.x};
    const center = {x:parent.x+u.x*forward,y:parent.y+u.y*forward};
    const offsets = childSpread(item.children.length);
    const points = item.children.map((id,j)=>({
      id,
      x:center.x+t.x*offsets[j],
      y:center.y+t.y*offsets[j],
      center,
      parent,
      u,
      t
    }));
    return {parent,center,points,forward,u,t};
  }

  function layoutValid(index, layout) {
    if (!layout || !layout.points) return false;
    const parent = layout.parent;
    const root = {x: state.rootX, y: state.rootY};
    const minParentGap = (G.l2Size + G.l3Size) / 2 + G.l3Gap;
    const minChildGap = G.l3Size + G.l3Gap;
    const minRootGap = (G.rootSize + G.l3Size) / 2 + G.l3Gap;

    for (const p of layout.points) {
      // Hard outward invariant: L2 -> L3 must point in the same outward hemisphere.
      const vx = p.x - parent.x;
      const vy = p.y - parent.y;
      const rx = parent.x - root.x;
      const ry = parent.y - root.y;
      if (vx * rx + vy * ry <= 0) return false;
      if (Math.hypot(vx, vy) < minParentGap) return false;
      // L3 may not overlap L1, but L2 is not a container/boundary.
      if (dist(p, root) < minRootGap) return false;
    }

    for (let i = 0; i < layout.points.length; i++) {
      for (let j = i + 1; j < layout.points.length; j++) {
        if (dist(layout.points[i], layout.points[j]) < minChildGap) return false;
      }
    }
    return true;
  }

  // L1/L2 are not containers for L3. They are only anchor geometry.
  // L3 is rendered in the same viewport coordinate space and may extend
  // outward without moving Root #1.

  function solveLayout(index) {
    const diagonal = Math.hypot(innerWidth, innerHeight);
    const maxSearch = Math.max(320, diagonal * 1.5 + G.l3Size * 2);
    let forward = G.l3ForwardIdeal;
    let layout = candidateLayout(index, forward);

    // Only L3 distance changes. Root #1 and the L2 ring remain fixed.
    // No viewport-fit pass is allowed to move the Root.
    for (let f = G.l3ForwardMin; f <= maxSearch; f += G.l3ForwardStep) {
      const c = candidateLayout(index, f);
      layout = c;
      forward = f;
      if (layoutValid(index, c)) break;
    }

    return { ...candidateLayout(index, forward), forward };
  }

  // ============================================================
  // 5. RENDER ENGINE
  // ============================================================
  function iconSvg(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.more}</svg>`;
  }

  function place(el,x,y,scale=1) {
    el.style.left=`${x}px`;
    el.style.top=`${y}px`;
    el.style.transform=`translate(-50%,-50%) scale(${scale})`;
  }

  function sectorPath(cx,cy,r0,r1,a0,a1) {
    const p=(r,a)=>[cx+Math.cos(a)*r,cy+Math.sin(a)*r];
    const A=p(r0,a0),B=p(r1,a0),C=p(r1,a1),D=p(r0,a1);
    const large=Math.abs(a1-a0)>Math.PI?1:0;
    return `M ${A[0]} ${A[1]} L ${B[0]} ${B[1]} A ${r1} ${r1} 0 ${large} 1 ${C[0]} ${C[1]} L ${D[0]} ${D[1]} A ${r0} ${r0} 0 ${large} 0 ${A[0]} ${A[1]} Z`;
  }

  function renderL2() {
    items.innerHTML="";
    menuConfig.forEach((item,i)=>{
      const p=l2Point(i);
      const b=document.createElement("button");
      b.className="item";
      b.dataset.index=String(i);
      b.dataset.label=item.label;
      b.style.setProperty("--c",item.color);
      b.setAttribute("aria-label",item.label);
      place(b,p.x,p.y,state.open?1:.2);
      b.innerHTML=iconSvg(item.icon);
      items.appendChild(b);
    });
  }

  const childEls = new Map();
  let fanKey = "";

  function dispatchCommand(commandId) {
    const payload = { type:"booknote-command", command:String(commandId||""), source:"radial-ring-v2", timestamp:Date.now() };
    try {
      if (globalThis.browser && browser.runtime && browser.runtime.sendMessage) {
        browser.runtime.sendMessage(payload).catch(()=>{});
      }
    } catch (_) {}
    try {
      window.dispatchEvent(new CustomEvent("booknote-radial-command", { detail: payload }));
    } catch (_) {}
    closeMenu();
  }

  function renderFan(index, force = false) {
    if(index<0 || !state.open) return;
    const solved=solveLayout(index);
    state.layout=solved;
    const key=`${index}:${Math.round(state.rootX)}:${Math.round(state.rootY)}:${Math.round(solved.forward)}`;
    if(!force && key===fanKey) {
      updateFanPositions(solved);
      return;
    }
    fanKey=key;

    visual.innerHTML="";
    tunnels.innerHTML="";
    children.innerHTML="";
    childEls.clear();

    const parent=solved.parent;
    const center=solved.center;
    const offsets=childSpread(solved.points.length);
    const a=Math.atan2(center.y-state.rootY,center.x-state.rootX);
    const half=Math.max(28, Math.abs(offsets[offsets.length-1]||0)+G.l3Size/2+10);
    const span=Math.min(Math.PI*0.56, Math.max(Math.PI*0.16, half/Math.max(40,solved.forward)));
    const fanR0=Math.max(G.l2Radius+14,solved.forward-G.l3Size/2-8);
    const fanR1=solved.forward+half+G.l3Size/2+10;

    const path=document.createElementNS(NS,"path");
    path.setAttribute("class","fan visible");
    path.setAttribute("d",sectorPath(state.rootX,state.rootY,fanR0,fanR1,a-span,a+span));
    visual.appendChild(path);

    const tunnel=document.createElementNS(NS,"path");
    tunnel.setAttribute("class","tunnel");
    tunnel.setAttribute("d",`M ${parent.x} ${parent.y} L ${center.x} ${center.y}`);
    tunnels.appendChild(tunnel);
    tunnel.addEventListener("mouseenter",()=>clearTimeout(state.hoverTimer));

    const item=menuConfig[index];
    item.children.forEach((id,j)=>{
      const data=childConfig[id]||childConfig.more;
      const p=solved.points[j];
      const b=document.createElement("button");
      b.className="child visible";
      b.dataset.label=data.label;
      b.style.setProperty("--c",data.color);
      b.setAttribute("aria-label",data.label);
      b.innerHTML=iconSvg(data.icon);
      children.appendChild(b);
      childEls.set(b,p);
      b.addEventListener("mouseenter",()=>showTooltip(b,data.label));
      b.addEventListener("mouseleave",scheduleTooltipHide);
      b.addEventListener("click",()=>dispatchCommand(id));
    });
    updateFanPositions(solved);
  }

  function updateFanPositions(solved) {
    if(!solved) return;
    [...childEls.entries()].forEach(([b,p],i)=>{
      const next=solved.points[i];
      if(!next) return;
      childEls.set(b,next);
      place(b,next.x,next.y,1);
    });
    const path=visual.querySelector(".fan");
    if(path) {
      const offsets=childSpread(solved.points.length);
      const a=Math.atan2(solved.center.y-state.rootY,solved.center.x-state.rootX);
      const half=Math.max(28,Math.abs(offsets[offsets.length-1]||0)+G.l3Size/2+10);
      const span=Math.min(Math.PI*0.56,Math.max(Math.PI*0.16,half/Math.max(40,solved.forward)));
      const fanR0=Math.max(G.l2Radius+14,solved.forward-G.l3Size/2-8);
      const fanR1=solved.forward+half+G.l3Size/2+10;
      path.setAttribute("d",sectorPath(state.rootX,state.rootY,fanR0,fanR1,a-span,a+span));
    }
    const tunnel=tunnels.querySelector(".tunnel");
    if(tunnel) tunnel.setAttribute("d",`M ${solved.parent.x} ${solved.parent.y} L ${solved.center.x} ${solved.center.y}`);
  }

  function renderAll() {
    trigger.setAttribute("aria-expanded",String(state.open));
    menu.classList.toggle("open",state.open);
    place(trigger,state.rootX,state.rootY,1);
    place(shadow.getElementById("orbit"),state.rootX,state.rootY,1);
    [...items.children].forEach((b,i)=>{
      const p=l2Point(i);
      place(b,p.x,p.y,state.open?1:.2);
      b.classList.toggle("visible",state.open);
    });
    if(state.open && state.activeIndex>=0) renderFan(state.activeIndex, true);
    else { visual.innerHTML=""; tunnels.innerHTML=""; children.innerHTML=""; childEls.clear(); fanKey=""; }
  }

  // ============================================================
  // 6. SPRING / ANIMATION ENGINE
  // ============================================================
  function tick() {
    const dx=state.targetX-state.rootX;
    const dy=state.targetY-state.rootY;
    state.vx=(state.vx+dx*G.springStiffness)*G.springDamping;
    state.vy=(state.vy+dy*G.springStiffness)*G.springDamping;
    state.rootX+=state.vx;
    state.rootY+=state.vy;
    if(Math.abs(dx)<.05 && Math.abs(dy)<.05 && Math.abs(state.vx)<.05 && Math.abs(state.vy)<.05) {
      state.rootX=state.targetX; state.rootY=state.targetY; state.vx=0; state.vy=0;
    }
    if(state.open) {
      place(trigger,state.rootX,state.rootY,1);
      [...items.children].forEach((b,i)=>{ const p=l2Point(i); place(b,p.x,p.y,1); });
      if(state.activeIndex>=0) {
        const solved=solveLayout(state.activeIndex);
        state.layout=solved;
        updateFanPositions(solved);
      }
    } else {
      place(trigger,state.rootX,state.rootY,1);
    }
    state.animationFrame=requestAnimationFrame(tick);
  }

  // ============================================================
  // 7. INTERACTION / TOOLTIP
  // ============================================================
  function showTooltip(el,text) {
    clearTimeout(state.hoverTimer);
    const r=el.getBoundingClientRect();
    tooltip.textContent=text;
    tooltip.style.left=`${r.left+r.width/2}px`;
    tooltip.style.top=`${Math.max(10,r.top)}px`;
    tooltip.classList.add("show");
  }
  function scheduleTooltipHide() {
    clearTimeout(state.hoverTimer);
    state.hoverTimer=setTimeout(()=>tooltip.classList.remove("show"),G.hoverDelay);
  }
  function openMenu() {
    state.open=true;
    renderL2();
    renderAll();
  }
  function closeMenu() {
    state.open=false;
    state.activeIndex=-1;
    state.layout=null;
    fanKey="";
    tooltip.classList.remove("show");
    renderAll();
  }
  function activate(i) {
    if(!state.open) return;
    state.activeIndex=i;
    renderFan(i, true);
  }

  trigger.addEventListener("pointerdown",e=>{
    if(e.button!==0)return;
    state.drag=true; state.moved=false; state.downX=e.clientX; state.downY=e.clientY;
    trigger.setPointerCapture(e.pointerId);
  });
  trigger.addEventListener("pointermove",e=>{
    if(!state.drag)return;
    const dx=e.clientX-state.downX,dy=e.clientY-state.downY;
    if(Math.hypot(dx,dy)>G.dragThreshold)state.moved=true;
    const min=G.rootSize/2+G.edgePad;
    state.targetX=clamp(e.clientX,min,innerWidth-min);
    state.targetY=clamp(e.clientY,min,innerHeight-min);
  });
  trigger.addEventListener("pointerup",e=>{
    state.drag=false;
    try{trigger.releasePointerCapture(e.pointerId)}catch(_){ }
    if(!state.moved) state.open?closeMenu():openMenu();
  });

  document.addEventListener("pointerdown",e=>{
    if(state.open && !host.contains(e.target)) closeMenu();
  },true);
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&state.open)closeMenu()});

  window.addEventListener("resize",()=>{
    const min=G.rootSize/2+G.edgePad;
    state.targetX=clamp(state.targetX,min,innerWidth-min);
    state.targetY=clamp(state.targetY,min,innerHeight-min);
    svg.setAttribute("viewBox",`0 0 ${Math.max(1,innerWidth)} ${Math.max(1,innerHeight)}`);
    renderL2();
    renderAll();
  });

  // Bind L2 hover/click after initial render; buttons are regenerated only
  // when opening/resizing, so delegation is used for stable interaction.
  items.addEventListener("pointerover",e=>{
    const b=e.target.closest?.("button.item");
    if(!b)return;
    const i=Number(b.dataset.index);
    if(Number.isFinite(i)) activate(i);
    showTooltip(b,b.dataset.label);
  });
  items.addEventListener("pointerout",e=>{
    if(e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    scheduleTooltipHide();
  });
  items.addEventListener("click",e=>{
    const b=e.target.closest?.("button.item");
    if(!b)return;
    activate(Number(b.dataset.index));
  });

  // ============================================================
  // 8. BOOT
  // ============================================================
  renderL2();
  renderAll();
  state.animationFrame=requestAnimationFrame(tick);
})();
