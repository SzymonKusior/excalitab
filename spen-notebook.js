/*
- S Pen Notebook — Etap 1: Core + S Pen Toggle-Erase (Moduł 1) + Floating Toolbar (Moduł 2)
- Czysty JavaScript (ES2020), brak zewnętrznych zależności.
 */
(function () {
  const DEBUG = true;
  const LOG_PREFIX = "[SPenNotes]";
  const STORAGE_POS_KEY = "spenNotes.toolbarPos.v2";
  const STORAGE_COLLAPSED_KEY = "spenNotes.toolbarCollapsed.v1";
  const PEN_CONTEXT_WINDOW_MS = 600;
  const MOVE_THROTTLE_MS = 140;
  const MAX_OVERLAY_LOGS = 60;
  const SNAP_ENTER_PX = 36;
  const SNAP_EXIT_PX = 58;
  const EDGE_MARGIN_PX = 10;

  if (typeof window.__spenNotesCleanup === "function") {
    try {
      window.__spenNotesCleanup();
    } catch (err) {
      console.error(`${LOG_PREFIX} Błąd czyszczenia poprzedniej instancji:`, err);
    }
  }

  const stats = {
    globalListeners: 0,
    viewListeners: 0,
    domElements: 0,
    activeViewsAttached: 0
  };

  const globalCleanups = [];
  let viewCleanups = [];
  let attachedContainer = null;
  let attachedView = null;

  function registerCleanup(fn, scope = "global") {
    if (typeof fn !== "function") return;
    if (scope === "view") {
      viewCleanups.push(fn);
    } else {
      globalCleanups.push(fn);
    }
  }

  function trackListener(target, eventName, handler, options, scope = "global") {
    target.addEventListener(eventName, handler, options);
    if (scope === "view") stats.viewListeners += 1;
    else stats.globalListeners += 1;

    registerCleanup(() => {
      target.removeEventListener(eventName, handler, options);
      if (scope === "view") stats.viewListeners = Math.max(0, stats.viewListeners - 1);
      else stats.globalListeners = Math.max(0, stats.globalListeners - 1);
    }, scope);
  }

  function trackDomElement(el, parent = document.body, scope = "global") {
    if (!el || !parent) return;
    parent.appendChild(el);
    stats.domElements += 1;

    registerCleanup(() => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
      stats.domElements = Math.max(0, stats.domElements - 1);
    }, scope);
  }

  // Ikony SVG w stylu Lucide (spójne z interfejsem Obsidiana)
  const ICONS = {
    grip: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`,
    pen: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`,
    highlighter: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>`,
    eraser: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>`,
    lasso: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 22a5 5 0 0 1-2-4"/><path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1"/><path d="M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>`,
    undo: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`,
    redo: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>`,
    addPage: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`,
    grid: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>`,
    magnet: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4"/><path d="m12 15 4 4"/></svg>`,
    chevronDown: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    chevronRight: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`
  };

  // Stan Modułu 1 (Toggle-to-Erase przyciskiem S Pen)
  const penEraseState = {
    isAutoErasing: false,
    previousTool: "freedraw",
    previousHighlighter: false,
    previousOpacity: 100,
    previousStrokeWidth: 2,
    wasButtonPressed: false,
    lastToggleTime: 0,
    lastPenActivityTime: 0,
    isPenDown: false
  };

  // Optymistyczny stan paska z niezależnym zapamiętywaniem grubości dla pióra i zakreślacza
  const uiState = {
    tool: "freedraw",
    strokeColor: "#1e1e1e",
    strokeWidth: 2,
    penWidth: 2,
    highlighterWidth: 16,
    opacity: 100,
    highlighter: false
  };

  let toolbarSyncFn = null;
  let activeApi = null;
  let activeEa = null;

  const logHistory = [];
  let overlayLogEl = null;

  function formatTimeStamp() {
    const now = new Date();
    return now.toTimeString().split(" ")[0] + "." + String(now.getMilliseconds()).padStart(3, "0");
  }

  function logMsg(msg, isError = false) {
    const statsSnap = DEBUG
      ? ` [L:${stats.globalListeners + stats.viewListeners} (V:${stats.viewListeners}) DOM:${stats.domElements}]`
      : "";
    const line = `[${formatTimeStamp()}] ${msg}${statsSnap}`;

    if (DEBUG) {
      if (isError) console.error(`${LOG_PREFIX} ${line}`);
      else console.log(`${LOG_PREFIX} ${line}`);
    }

    logHistory.push(line);
    if (logHistory.length > 300) {
      logHistory.shift();
    }

    if (overlayLogEl) {
      const row = document.createElement("div");
      row.textContent = line;
      row.style.borderBottom = "1px solid var(--background-modifier-border, #444)";
      row.style.padding = "2px 0";
      row.style.wordBreak = "break-word";
      if (isError) row.style.color = "var(--text-error, #ff6b6b)";
      overlayLogEl.appendChild(row);

      while (overlayLogEl.childElementCount > MAX_OVERLAY_LOGS) {
        overlayLogEl.removeChild(overlayLogEl.firstChild);
      }
      overlayLogEl.scrollTop = overlayLogEl.scrollHeight;
    }
  }

  function isValidApiObject(obj) {
    return Boolean(obj && typeof obj === "object" && typeof obj.getAppState === "function");
  }

  function resolveExcalidrawContext(view) {
    const eaObj = typeof ea !== "undefined" ? ea : window.ExcalidrawAutomate;
    if (!eaObj) return { eaObj: null, api: null };

    if (view && typeof eaObj.setView === "function") {
      try {
        eaObj.setView(view);
      } catch (err) {
        // Ignoruj
      }
    }

    const candidates = [
      () => (typeof eaObj.getExcalidrawAPI === "function" ? eaObj.getExcalidrawAPI() : null),
      () => view?.excalidrawAPI,
      () => (typeof view?.getExcalidrawAPI === "function" ? view.getExcalidrawAPI() : null),
      () => eaObj.mostRecentExcalidrawAPI,
      () => eaObj.targetView?.excalidrawAPI
    ];

    for (const getter of candidates) {
      try {
        const candidateApi = getter();
        if (isValidApiObject(candidateApi)) {
          return { eaObj, api: candidateApi };
        }
      } catch (err) {
        // Próbuj kolejne źródło
      }
    }

    return { eaObj, api: null };
  }

  function ensureApiReady(reason = "akcja") {
    const prevApi = activeApi;
    const { eaObj, api } = resolveExcalidrawContext(attachedView);
    if (eaObj) activeEa = eaObj;
    if (api) {
      activeApi = api;
      if (prevApi !== api && typeof toolbarSyncFn === "function") {
        toolbarSyncFn(true);
      }
    }
    return activeApi;
  }

  function readAppStateSafe(api) {
    if (!api || typeof api.getAppState !== "function") return null;
    try {
      return api.getAppState();
    } catch (err) {
      return null;
    }
  }

  function getCurrentToolType(api) {
    const st = readAppStateSafe(api);
    if (!st || !st.activeTool) return uiState.tool;
    if (typeof st.activeTool === "string") return st.activeTool;
    return st.activeTool.type || uiState.tool;
  }

  function setToolSafe(api, toolType) {
    const resolved = api || ensureApiReady(`setTool:${toolType}`);
    uiState.tool = toolType;
    if (toolType !== "freedraw") {
      uiState.highlighter = false;
    }
    if (!resolved || typeof resolved.setActiveTool !== "function") {
      logMsg(`Brak api.setActiveTool dla "${toolType}".`, true);
      return false;
    }
    try {
      resolved.setActiveTool({ type: toolType });
      return true;
    } catch (err) {
      logMsg(`Błąd setActiveTool("${toolType}"): ${err.message}`, true);
      return false;
    }
  }

  function updateAppStateSafe(api, patch) {
    const resolved = api || ensureApiReady("updateAppState");
    if (typeof patch.currentItemStrokeColor === "string") {
      uiState.strokeColor = patch.currentItemStrokeColor;
    }
    if (typeof patch.currentItemStrokeWidth === "number") {
      uiState.strokeWidth = patch.currentItemStrokeWidth;
    }
    if (typeof patch.currentItemOpacity === "number") {
      uiState.opacity = patch.currentItemOpacity;
    }

    if (!resolved || typeof resolved.updateScene !== "function") {
      logMsg(`Brak api.updateScene.`, true);
      return false;
    }
    try {
      resolved.updateScene({ appState: patch });
      return true;
    } catch (err) {
      logMsg(`Błąd updateScene(appState): ${err.message}`, true);
      return false;
    }
  }

  function restorePreviousToolAfterErase(reason) {
    if (!penEraseState.isAutoErasing) return;
    const targetTool = penEraseState.previousTool || "freedraw";
    const wasHighlighter = penEraseState.previousHighlighter;
    const prevOpacity = penEraseState.previousOpacity;
    const prevWidth = penEraseState.previousStrokeWidth;

    penEraseState.isAutoErasing = false;

    const api = ensureApiReady(`restore:${reason}`);
    const currentTool = getCurrentToolType(api);

    if ((currentTool === "eraser" || uiState.tool === "eraser") && targetTool !== "eraser") {
      if (targetTool === "freedraw") {
        uiState.highlighter = wasHighlighter;
        uiState.opacity = prevOpacity;
        uiState.strokeWidth = prevWidth;
        if (wasHighlighter) {
          uiState.highlighterWidth = prevWidth;
        } else {
          uiState.penWidth = prevWidth;
        }
        updateAppStateSafe(api, {
          currentItemOpacity: prevOpacity,
          currentItemStrokeWidth: prevWidth
        });
      }
      setToolSafe(api, targetTool);
      if (targetTool === "freedraw") {
        uiState.highlighter = wasHighlighter;
      }
      logMsg(`Toggle-Erase koniec (${reason}) -> przywrócono: ${wasHighlighter ? "zakreślacz" : targetTool}`);
    } else {
      logMsg(`Toggle-Erase stan wyczyszczony (${reason}), aktywne narzędzie: ${currentTool}`);
    }

    if (typeof toolbarSyncFn === "function") {
      toolbarSyncFn(false);
    }
  }

  function toggleEraseFromPenButton(reason) {
    const now = performance.now();
    if (now - penEraseState.lastToggleTime < 150) return;
    penEraseState.lastToggleTime = now;

    const api = ensureApiReady(`toggle:${reason}`);
    if (!api) return;

    const currentTool = getCurrentToolType(api);

    if (penEraseState.isAutoErasing && currentTool !== "eraser" && uiState.tool !== "eraser") {
      penEraseState.isAutoErasing = false;
    }

    if (!penEraseState.isAutoErasing) {
      const toolToSave = (currentTool && currentTool !== "eraser")
        ? currentTool
        : (uiState.tool && uiState.tool !== "eraser" ? uiState.tool : "freedraw");

      penEraseState.previousTool = toolToSave;
      penEraseState.previousHighlighter = Boolean(uiState.highlighter);
      penEraseState.previousOpacity = uiState.opacity;
      penEraseState.previousStrokeWidth = uiState.strokeWidth;
      penEraseState.isAutoErasing = true;

      if (setToolSafe(api, "eraser")) {
        logMsg(`Toggle-Erase WŁĄCZONY (${reason}) -> eraser (zapamiętano: ${penEraseState.previousHighlighter ? "zakreślacz" : toolToSave})`);
      }

      if (typeof toolbarSyncFn === "function") {
        toolbarSyncFn(false);
      }
    } else {
      restorePreviousToolAfterErase(reason);
    }
  }

  function ensureToolbarStyles() {
    if (document.getElementById("spen-notes-toolbar-css")) return;
    const styleEl = document.createElement("style");
    styleEl.id = "spen-notes-toolbar-css";
    styleEl.textContent = `
      #spen-notes-floating-toolbar .spen-toolbar-scroll {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      #spen-notes-floating-toolbar .spen-toolbar-scroll::-webkit-scrollbar {
        display: none;
      }
    `;
    trackDomElement(styleEl, document.head, "global");
  }

  function createDiagnosticOverlay() {
    const root = document.createElement("div");
    root.id = "spen-notes-stage1-diag";
    Object.assign(root.style, {
      position: "fixed",
      bottom: "12px",
      right: "12px",
      width: "min(92vw, 440px)",
      maxHeight: "36vh",
      zIndex: "99998",
      backgroundColor: "var(--background-primary, #1e1e1e)",
      color: "var(--text-normal, #e0e0e0)",
      border: "1px solid var(--background-modifier-border, #555)",
      borderRadius: "8px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
      display: "flex",
      flexDirection: "column",
      fontFamily: "monospace",
      fontSize: "11px",
      overflow: "hidden",
      touchAction: "none"
    });

    ["pointerdown", "pointerup", "pointermove", "touchstart", "contextmenu"].forEach((evtName) => {
      trackListener(root, evtName, (e) => e.stopPropagation(), false, "global");
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "6px 8px",
      backgroundColor: "var(--background-secondary, #2a2a2a)",
      borderBottom: "1px solid var(--background-modifier-border, #444)",
      gap: "4px",
      flexWrap: "wrap"
    });

    const title = document.createElement("span");
    title.textContent = "SPenNotes Diag (Etap 1)";
    title.style.fontWeight = "bold";
    header.appendChild(title);

    const btnGroup = document.createElement("div");
    btnGroup.style.display = "flex";
    btnGroup.style.gap = "4px";

    function makeSmallBtn(label, onClick) {
      const btn = document.createElement("button");
      btn.textContent = label;
      Object.assign(btn.style, {
        minWidth: "32px",
        minHeight: "32px",
        padding: "4px 8px",
        fontSize: "11px",
        cursor: "pointer",
        backgroundColor: "var(--interactive-normal, #3a3a3a)",
        color: "var(--text-normal, #fff)",
        border: "1px solid var(--background-modifier-border, #555)",
        borderRadius: "4px",
        touchAction: "none"
      });
      trackListener(
        btn,
        "click",
        (e) => {
          e.stopPropagation();
          onClick(btn);
        },
        false,
        "global"
      );
      return btn;
    }

    let isCollapsed = true;
    const logBox = document.createElement("div");
    Object.assign(logBox.style, {
      padding: "6px 8px",
      overflowY: "auto",
      maxHeight: "24vh",
      lineHeight: "1.35",
      touchAction: "pan-y",
      userSelect: "text",
      display: "none"
    });

    const copyBtn = makeSmallBtn("Kopiuj", async (btn) => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(logHistory.join("\n"));
          const prev = btn.textContent;
          btn.textContent = "OK!";
          setTimeout(() => {
            btn.textContent = prev;
          }, 1200);
        } else {
          throw new Error("Brak navigator.clipboard");
        }
      } catch (err) {
        logMsg(`Błąd kopiowania: ${err.message}`, true);
      }
    });

    const clearBtn = makeSmallBtn("Wyczyść", () => {
      logHistory.length = 0;
      if (overlayLogEl) overlayLogEl.innerHTML = "";
    });

    const toggleBtn = makeSmallBtn("Logi", (btn) => {
      isCollapsed = !isCollapsed;
      logBox.style.display = isCollapsed ? "none" : "block";
      btn.textContent = isCollapsed ? "Logi" : "Ukryj";
    });

    const closeBtn = makeSmallBtn("X", () => {
      cleanupAll();
    });

    btnGroup.appendChild(copyBtn);
    btnGroup.appendChild(clearBtn);
    btnGroup.appendChild(toggleBtn);
    btnGroup.appendChild(closeBtn);
    header.appendChild(btnGroup);

    root.appendChild(header);
    root.appendChild(logBox);
    trackDomElement(root, document.body, "global");

    overlayLogEl = logBox;
  }

  function createFloatingToolbar(excalidrawContainer) {
    ensureToolbarStyles();

    // Delikatna ramka podglądu dokowania podczas przeciągania (eliminuje migotanie rozmiaru w locie)
    const snapGhost = document.createElement("div");
    Object.assign(snapGhost.style, {
      position: "fixed",
      zIndex: "9989",
      pointerEvents: "none",
      borderRadius: "10px",
      border: "2px dashed var(--interactive-accent, #705dcf)",
      backgroundColor: "rgba(112, 93, 207, 0.14)",
      display: "none",
      boxSizing: "border-box"
    });
    trackDomElement(snapGhost, document.body, "view");

    const bar = document.createElement("div");
    bar.id = "spen-notes-floating-toolbar";
    Object.assign(bar.style, {
      position: "fixed",
      top: "56px",
      left: "56px",
      zIndex: "9990",
      display: "flex",
      alignItems: "center",
      flexWrap: "nowrap",
      gap: "4px",
      padding: "5px 6px",
      backgroundColor: "var(--background-primary, #1e1e1e)",
      color: "var(--text-normal, #e0e0e0)",
      border: "1px solid var(--background-modifier-border, #444)",
      borderRadius: "10px",
      boxShadow: "0 6px 20px rgba(0,0,0,0.28)",
      userSelect: "none",
      fontFamily: "var(--font-interface, sans-serif)",
      fontSize: "11px",
      boxSizing: "border-box"
    });

    ["pointerdown", "pointermove", "pointerup", "touchstart", "contextmenu"].forEach((evtName) => {
      trackListener(bar, evtName, (e) => e.stopPropagation(), false, "view");
    });

    let layoutState = {
      dock: "top", // "top" | "bottom" | "left" | "right" | "none"
      relX: 0.5,
      relY: 0.0
    };
    let isCollapsed = false;

    try {
      const savedPos = JSON.parse(localStorage.getItem(STORAGE_POS_KEY) || "null");
      if (savedPos && typeof savedPos === "object") {
        if (["top", "bottom", "left", "right", "none"].includes(savedPos.dock)) {
          layoutState.dock = savedPos.dock;
        }
        if (typeof savedPos.relX === "number") layoutState.relX = savedPos.relX;
        if (typeof savedPos.relY === "number") layoutState.relY = savedPos.relY;
      }
      isCollapsed = localStorage.getItem(STORAGE_COLLAPSED_KEY) === "1";
    } catch (err) {
      // Ignoruj
    }

    function getViewportBounds() {
      const target = excalidrawContainer && excalidrawContainer.isConnected ? excalidrawContainer : document.body;
      const r = target.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) {
        return {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height
        };
      }
      return {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight
      };
    }

    const dividers = [];
    function applyOrientation(vertical) {
      bar.style.flexDirection = vertical ? "column" : "row";
      contentWrap.style.flexDirection = vertical ? "column" : "row";

      if (vertical) {
        contentWrap.style.overflowX = "hidden";
        contentWrap.style.overflowY = "auto";
        contentWrap.style.touchAction = "pan-y";
        dragHandle.style.width = "30px";
        dragHandle.style.height = "24px";
        collapseBtn.style.width = "30px";
        collapseBtn.style.height = "24px";
      } else {
        contentWrap.style.overflowX = "auto";
        contentWrap.style.overflowY = "hidden";
        contentWrap.style.touchAction = "pan-x";
        dragHandle.style.width = "24px";
        dragHandle.style.height = "30px";
        collapseBtn.style.width = "24px";
        collapseBtn.style.height = "30px";
      }

      dividers.forEach((div) => {
        if (vertical) {
          div.style.width = "20px";
          div.style.height = "1px";
          div.style.margin = "1px 0";
        } else {
          div.style.width = "1px";
          div.style.height = "20px";
          div.style.margin = "0 1px";
        }
      });
    }

    function syncPositionToBounds() {
      const bounds = getViewportBounds();
      const isVertical = layoutState.dock === "left" || layoutState.dock === "right";
      applyOrientation(isVertical);

      const maxAvailW = Math.max(80, bounds.width - EDGE_MARGIN_PX * 2);
      const maxAvailH = Math.max(80, bounds.height - EDGE_MARGIN_PX * 2);

      if (isVertical) {
        bar.style.maxWidth = "none";
        bar.style.maxHeight = `${maxAvailH}px`;
      } else {
        bar.style.maxWidth = `${maxAvailW}px`;
        bar.style.maxHeight = "none";
      }

      const barRect = bar.getBoundingClientRect();
      const w = barRect.width || 40;
      const h = barRect.height || 40;

      const minLeft = bounds.left + EDGE_MARGIN_PX;
      const maxLeft = Math.max(minLeft, bounds.right - w - EDGE_MARGIN_PX);
      const minTop = bounds.top + EDGE_MARGIN_PX;
      const maxTop = Math.max(minTop, bounds.bottom - h - EDGE_MARGIN_PX);

      let nextLeft = minLeft;
      let nextTop = minTop;

      if (layoutState.dock === "top") {
        nextTop = minTop;
        nextLeft = bounds.left + (bounds.width - w) * layoutState.relX;
      } else if (layoutState.dock === "bottom") {
        nextTop = maxTop;
        nextLeft = bounds.left + (bounds.width - w) * layoutState.relX;
      } else if (layoutState.dock === "left") {
        nextLeft = minLeft;
        nextTop = bounds.top + (bounds.height - h) * layoutState.relY;
      } else if (layoutState.dock === "right") {
        nextLeft = maxLeft;
        nextTop = bounds.top + (bounds.height - h) * layoutState.relY;
      } else {
        nextLeft = bounds.left + (bounds.width - w) * layoutState.relX;
        nextTop = bounds.top + (bounds.height - h) * layoutState.relY;
      }

      nextLeft = Math.max(minLeft, Math.min(maxLeft, nextLeft));
      nextTop = Math.max(minTop, Math.min(maxTop, nextTop));

      bar.style.left = `${Math.round(nextLeft)}px`;
      bar.style.top = `${Math.round(nextTop)}px`;
    }

    function saveLayoutState() {
      try {
        localStorage.setItem(STORAGE_POS_KEY, JSON.stringify(layoutState));
      } catch (err) {
        // Ignoruj
      }
    }

    function detectSnapSide(rect, bounds, currentCandidate) {
      const distTop = Math.abs(rect.top - (bounds.top + EDGE_MARGIN_PX));
      const distBottom = Math.abs(bounds.bottom - EDGE_MARGIN_PX - rect.bottom);
      const distLeft = Math.abs(rect.left - (bounds.left + EDGE_MARGIN_PX));
      const distRight = Math.abs(bounds.right - EDGE_MARGIN_PX - rect.right);

      const candidates = [
        { side: "top", dist: distTop },
        { side: "bottom", dist: distBottom },
        { side: "left", dist: distLeft },
        { side: "right", dist: distRight }
      ].sort((a, b) => a.dist - b.dist);

      // Histereza zapobiega migotaniu na granicy strefy dokowania
      const threshold = currentCandidate && currentCandidate !== "none" ? SNAP_EXIT_PX : SNAP_ENTER_PX;
      return candidates[0].dist <= threshold ? candidates[0].side : "none";
    }

    function updateSnapGhost(side, barRect, bounds) {
      if (!side || side === "none") {
        snapGhost.style.display = "none";
        return;
      }

      const isVert = side === "left" || side === "right";
      const longSide = Math.max(barRect.width, barRect.height);
      const shortSide = Math.min(barRect.width, barRect.height);

      const ghostW = isVert
        ? shortSide
        : Math.min(longSide, Math.max(80, bounds.width - EDGE_MARGIN_PX * 2));
      const ghostH = isVert
        ? Math.min(longSide, Math.max(80, bounds.height - EDGE_MARGIN_PX * 2))
        : shortSide;

      let gLeft = barRect.left;
      let gTop = barRect.top;

      if (side === "top") {
        gTop = bounds.top + EDGE_MARGIN_PX;
        gLeft = Math.max(
          bounds.left + EDGE_MARGIN_PX,
          Math.min(bounds.right - ghostW - EDGE_MARGIN_PX, barRect.left)
        );
      } else if (side === "bottom") {
        gTop = bounds.bottom - ghostH - EDGE_MARGIN_PX;
        gLeft = Math.max(
          bounds.left + EDGE_MARGIN_PX,
          Math.min(bounds.right - ghostW - EDGE_MARGIN_PX, barRect.left)
        );
      } else if (side === "left") {
        gLeft = bounds.left + EDGE_MARGIN_PX;
        gTop = Math.max(
          bounds.top + EDGE_MARGIN_PX,
          Math.min(bounds.bottom - ghostH - EDGE_MARGIN_PX, barRect.top)
        );
      } else if (side === "right") {
        gLeft = bounds.right - ghostW - EDGE_MARGIN_PX;
        gTop = Math.max(
          bounds.top + EDGE_MARGIN_PX,
          Math.min(bounds.bottom - ghostH - EDGE_MARGIN_PX, barRect.top)
        );
      }

      snapGhost.style.display = "block";
      snapGhost.style.left = `${Math.round(gLeft)}px`;
      snapGhost.style.top = `${Math.round(gTop)}px`;
      snapGhost.style.width = `${Math.round(ghostW)}px`;
      snapGhost.style.height = `${Math.round(ghostH)}px`;
    }

    const dragHandle = document.createElement("div");
    dragHandle.innerHTML = ICONS.grip;
    dragHandle.title = "Przeciągnij pasek (przyciąga do góry, dołu lub boków)";
    Object.assign(dragHandle.style, {
      width: "24px",
      height: "30px",
      flexShrink: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "grab",
      borderRadius: "7px",
      backgroundColor: "var(--background-secondary, #2b2b2b)",
      border: "1px solid var(--background-modifier-border, #444)",
      color: "var(--text-muted, #aaa)",
      touchAction: "none"
    });
    bar.appendChild(dragHandle);

    let dragState = null;

    trackListener(
      dragHandle,
      "pointerdown",
      (e) => {
        if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
        const rect = bar.getBoundingClientRect();
        dragState = {
          pointerId: e.pointerId,
          offsetX: e.clientX - rect.left,
          offsetY: e.clientY - rect.top,
          pendingSide: layoutState.dock
        };
        dragHandle.style.cursor = "grabbing";
        if (typeof dragHandle.setPointerCapture === "function") {
          try {
            dragHandle.setPointerCapture(e.pointerId);
          } catch (err) {
            // Ignoruj
          }
        }
        e.preventDefault();
      },
      false,
      "view"
    );

    trackListener(
      dragHandle,
      "pointermove",
      (e) => {
        if (!dragState || e.pointerId !== dragState.pointerId) return;
        const bounds = getViewportBounds();
        const rawLeft = e.clientX - dragState.offsetX;
        const rawTop = e.clientY - dragState.offsetY;

        const minLeft = bounds.left + EDGE_MARGIN_PX;
        const maxLeft = Math.max(minLeft, bounds.right - bar.offsetWidth - EDGE_MARGIN_PX);
        const minTop = bounds.top + EDGE_MARGIN_PX;
        const maxTop = Math.max(minTop, bounds.bottom - bar.offsetHeight - EDGE_MARGIN_PX);

        const clampedLeft = Math.max(minLeft, Math.min(maxLeft, rawLeft));
        const clampedTop = Math.max(minTop, Math.min(maxTop, rawTop));

        bar.style.left = `${Math.round(clampedLeft)}px`;
        bar.style.top = `${Math.round(clampedTop)}px`;

        const currentRect = bar.getBoundingClientRect();
        const nextSide = detectSnapSide(currentRect, bounds, dragState.pendingSide);
        dragState.pendingSide = nextSide;
        updateSnapGhost(nextSide, currentRect, bounds);
      },
      false,
      "view"
    );

    const finishDrag = (e) => {
      if (!dragState || (e && e.pointerId !== undefined && e.pointerId !== dragState.pointerId)) return;
      const finalSide = dragState.pendingSide || "none";
      dragState = null;
      dragHandle.style.cursor = "grab";
      snapGhost.style.display = "none";

      const bounds = getViewportBounds();
      layoutState.dock = finalSide;

      const isVertical = layoutState.dock === "left" || layoutState.dock === "right";
      applyOrientation(isVertical);

      const maxAvailW = Math.max(80, bounds.width - EDGE_MARGIN_PX * 2);
      const maxAvailH = Math.max(80, bounds.height - EDGE_MARGIN_PX * 2);
      if (isVertical) {
        bar.style.maxWidth = "none";
        bar.style.maxHeight = `${maxAvailH}px`;
      } else {
        bar.style.maxWidth = `${maxAvailW}px`;
        bar.style.maxHeight = "none";
      }

      const updatedRect = bar.getBoundingClientRect();
      const freeW = Math.max(1, bounds.width - updatedRect.width - EDGE_MARGIN_PX * 2);
      const freeH = Math.max(1, bounds.height - updatedRect.height - EDGE_MARGIN_PX * 2);

      layoutState.relX = Math.max(0, Math.min(1, (updatedRect.left - (bounds.left + EDGE_MARGIN_PX)) / freeW));
      layoutState.relY = Math.max(0, Math.min(1, (updatedRect.top - (bounds.top + EDGE_MARGIN_PX)) / freeH));

      syncPositionToBounds();
      saveLayoutState();
    };

    trackListener(dragHandle, "pointerup", finishDrag, false, "view");
    trackListener(dragHandle, "pointercancel", finishDrag, false, "view");

    const contentWrap = document.createElement("div");
    contentWrap.className = "spen-toolbar-scroll";
    Object.assign(contentWrap.style, {
      display: isCollapsed ? "none" : "flex",
      alignItems: "center",
      gap: "4px",
      flexWrap: "nowrap",
      flex: "1 1 auto",
      minWidth: "0",
      minHeight: "0",
      overflowX: "auto",
      overflowY: "hidden",
      touchAction: "pan-x",
      overscrollBehavior: "contain"
    });
    bar.appendChild(contentWrap);

    trackListener(
      contentWrap,
      "wheel",
      (e) => {
        const isVertical = layoutState.dock === "left" || layoutState.dock === "right";
        if (!isVertical && e.deltaY !== 0 && contentWrap.scrollWidth > contentWrap.clientWidth) {
          contentWrap.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      },
      { passive: false },
      "view"
    );

    function makeDivider() {
      const div = document.createElement("span");
      Object.assign(div.style, {
        width: "1px",
        height: "20px",
        backgroundColor: "var(--background-modifier-border, #555)",
        margin: "0 1px",
        flexShrink: "0"
      });
      dividers.push(div);
      return div;
    }

    function createActionBtn(content, title, onClick, isDisabled = false, isHtml = false) {
      const btn = document.createElement("button");
      btn.type = "button";
      if (isHtml) {
        btn.innerHTML = content;
      } else {
        btn.textContent = content;
      }
      btn.title = title;
      btn.setAttribute("aria-label", title);
      btn.disabled = isDisabled;
      Object.assign(btn.style, {
        width: "30px",
        height: "30px",
        padding: "0",
        flexShrink: "0",
        borderRadius: "7px",
        border: "1px solid var(--background-modifier-border, #555)",
        backgroundColor: "var(--background-secondary, #2a2a2a)",
        color: "var(--text-normal, #e0e0e0)",
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? "0.45" : "1",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: "600",
        fontSize: "11px",
        lineHeight: "1"
      });
      if (!isDisabled) {
        trackListener(
          btn,
          "click",
          (e) => {
            e.stopPropagation();
            onClick();
          },
          false,
          "view"
        );
      }
      return btn;
    }

    function setActiveStyle(btn, active) {
      btn.style.backgroundColor = active
        ? "var(--interactive-accent, #705dcf)"
        : "var(--background-secondary, #2a2a2a)";
      btn.style.color = active
        ? "var(--text-on-accent, #ffffff)"
        : "var(--text-normal, #e0e0e0)";
      btn.style.borderColor = active
        ? "var(--interactive-accent, #705dcf)"
        : "var(--background-modifier-border, #555)";
    }

    function isDarkTheme() {
      const st = readAppStateSafe(activeApi);
      if (st && st.theme) return st.theme === "dark";
      return document.body.classList.contains("theme-dark");
    }

    function renderToolbarVisuals() {
      colorButtons.forEach(({ def, btn }) => {
        const hex = def.getColor();
        btn.style.backgroundColor = hex;
        const isSelected = (uiState.strokeColor || "").toLowerCase() === hex.toLowerCase();
        btn.style.boxShadow = isSelected
          ? "0 0 0 2px var(--background-primary, #1e1e1e), 0 0 0 3.5px var(--interactive-accent, #705dcf)"
          : "none";
      });

      setActiveStyle(penBtn, uiState.tool === "freedraw" && !uiState.highlighter);
      setActiveStyle(highlighterBtn, uiState.tool === "freedraw" && uiState.highlighter);
      setActiveStyle(eraserBtn, uiState.tool === "eraser");
      setActiveStyle(selectBtn, uiState.tool === "selection");

      widthButtons.forEach(({ width, btn }) => {
        setActiveStyle(btn, uiState.strokeWidth === width);
      });
    }

    function pullFromAppState() {
      const st = readAppStateSafe(activeApi);
      if (!st) {
        renderToolbarVisuals();
        return;
      }

      const tool = typeof st.activeTool === "string" ? st.activeTool : st.activeTool?.type;
      if (tool) {
        uiState.tool = tool;
      }
      if (typeof st.currentItemStrokeColor === "string") {
        uiState.strokeColor = st.currentItemStrokeColor;
      }
      if (typeof st.currentItemStrokeWidth === "number") {
        uiState.strokeWidth = st.currentItemStrokeWidth;
      }
      if (typeof st.currentItemOpacity === "number") {
        uiState.opacity = st.currentItemOpacity;
      }

      if (uiState.tool !== "freedraw" || uiState.opacity > 50) {
        uiState.highlighter = false;
        if (uiState.tool === "freedraw") {
          uiState.penWidth = uiState.strokeWidth;
        }
      } else if (uiState.tool === "freedraw" && uiState.opacity <= 50) {
        uiState.highlighter = true;
        uiState.highlighterWidth = uiState.strokeWidth;
      }

      renderToolbarVisuals();
    }

    let syncTimer = null;
    function scheduleSync(fromExternal = false) {
      renderToolbarVisuals();
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncTimer = null;
        if (fromExternal) {
          pullFromAppState();
        } else {
          renderToolbarVisuals();
        }
      }, fromExternal ? 60 : 0);
    }

    const penBtn = createActionBtn(ICONS.pen, "Pióro (freedraw)", () => {
      const api = ensureApiReady("Pióro");
      penEraseState.isAutoErasing = false;
      uiState.highlighter = false;
      uiState.opacity = 100;
      uiState.strokeWidth = uiState.penWidth;
      uiState.tool = "freedraw";
      renderToolbarVisuals();
      updateAppStateSafe(api, {
        currentItemOpacity: 100,
        currentItemStrokeWidth: uiState.penWidth
      });
      setToolSafe(api, "freedraw");
      scheduleSync(false);
    }, false, true);

    const highlighterBtn = createActionBtn(ICONS.highlighter, "Zakreślacz (opacity 40)", () => {
      const api = ensureApiReady("Zakreślacz");
      penEraseState.isAutoErasing = false;
      uiState.highlighter = true;
      uiState.opacity = 40;
      uiState.strokeWidth = uiState.highlighterWidth;
      uiState.tool = "freedraw";
      renderToolbarVisuals();
      updateAppStateSafe(api, {
        currentItemOpacity: 40,
        currentItemStrokeWidth: uiState.highlighterWidth
      });
      setToolSafe(api, "freedraw");
      scheduleSync(false);
    }, false, true);

    const eraserBtn = createActionBtn(ICONS.eraser, "Gumka (eraser)", () => {
      const api = ensureApiReady("Gumka");
      penEraseState.isAutoErasing = false;
      uiState.highlighter = false;
      uiState.tool = "eraser";
      renderToolbarVisuals();
      setToolSafe(api, "eraser");
      scheduleSync(false);
    }, false, true);

    const selectBtn = createActionBtn(ICONS.lasso, "Zaznaczanie (selection)", () => {
      const api = ensureApiReady("Lasso");
      penEraseState.isAutoErasing = false;
      uiState.highlighter = false;
      uiState.tool = "selection";
      renderToolbarVisuals();
      setToolSafe(api, "selection");
      scheduleSync(false);
    }, false, true);

    const undoBtn = createActionBtn(ICONS.undo, "Cofnij (Undo)", () => {
      const api = ensureApiReady("Cofnij");
      if (api && api.history && typeof api.history.undo === "function") {
        api.history.undo();
      } else if (activeEa && typeof activeEa.mostRecentExcalidrawAPI?.history?.undo === "function") {
        activeEa.mostRecentExcalidrawAPI.history.undo();
      } else {
        logMsg("Metoda history.undo nie jest dostępna w tym API.", true);
      }
      scheduleSync(true);
    }, false, true);

    const redoBtn = createActionBtn(ICONS.redo, "Ponów (Redo)", () => {
      const api = ensureApiReady("Ponów");
      if (api && api.history && typeof api.history.redo === "function") {
        api.history.redo();
      } else {
        logMsg("Metoda history.redo nie jest dostępna w tym API.", true);
      }
      scheduleSync(true);
    }, false, true);

    contentWrap.appendChild(penBtn);
    contentWrap.appendChild(highlighterBtn);
    contentWrap.appendChild(eraserBtn);
    contentWrap.appendChild(selectBtn);
    contentWrap.appendChild(makeDivider());
    contentWrap.appendChild(undoBtn);
    contentWrap.appendChild(redoBtn);
    contentWrap.appendChild(makeDivider());

    const paletteDefs = [
      { id: "primary", label: "Podstawowy", getColor: () => (isDarkTheme() ? "#ffffff" : "#1e1e1e") },
      { id: "blue", label: "Niebieski", getColor: () => "#1971c2" },
      { id: "red", label: "Czerwony", getColor: () => "#e03131" },
      { id: "green", label: "Zielony", getColor: () => "#2f9e44" },
      { id: "yellow", label: "Żółty", getColor: () => "#f59f00" },
      { id: "violet", label: "Fioletowy", getColor: () => "#7048e8" }
    ];

    const colorButtons = [];
    paletteDefs.forEach((pDef) => {
      const cBtn = document.createElement("button");
      cBtn.type = "button";
      cBtn.title = pDef.label;
      cBtn.setAttribute("aria-label", pDef.label);
      Object.assign(cBtn.style, {
        width: "26px",
        height: "26px",
        flexShrink: "0",
        borderRadius: "50%",
        border: "1.5px solid var(--background-modifier-border, #666)",
        cursor: "pointer",
        padding: "0"
      });
      trackListener(
        cBtn,
        "click",
        (e) => {
          e.stopPropagation();
          const api = ensureApiReady(`kolor:${pDef.id}`);
          const chosen = pDef.getColor();
          uiState.strokeColor = chosen;
          renderToolbarVisuals();
          updateAppStateSafe(api, { currentItemStrokeColor: chosen });
          scheduleSync(false);
        },
        false,
        "view"
      );
      colorButtons.push({ def: pDef, btn: cBtn });
      contentWrap.appendChild(cBtn);
    });

    contentWrap.appendChild(makeDivider());

    const strokeWidths = [1, 2, 4, 16];
    const widthButtons = [];

    strokeWidths.forEach((w) => {
      const wBtn = createActionBtn(`${w}`, `Grubość ${w}`, () => {
        const api = ensureApiReady(`grubość:${w}`);
        uiState.strokeWidth = w;
        if (uiState.highlighter) {
          uiState.highlighterWidth = w;
          uiState.opacity = 40;
          renderToolbarVisuals();
          updateAppStateSafe(api, {
            currentItemStrokeWidth: w,
            currentItemOpacity: 40
          });
        } else {
          uiState.penWidth = w;
          uiState.opacity = 100;
          renderToolbarVisuals();
          updateAppStateSafe(api, {
            currentItemStrokeWidth: w,
            currentItemOpacity: 100
          });
        }
        scheduleSync(false);
      });
      widthButtons.push({ width: w, btn: wBtn });
      contentWrap.appendChild(wBtn);
    });

    contentWrap.appendChild(makeDivider());

    const pagePlaceholderBtn = createActionBtn(ICONS.addPage, "Dodaj stronę (Etap 2)", () => {}, true, true);
    const gridPlaceholderBtn = createActionBtn(ICONS.grid, "Siatka (Etap 2)", () => {}, true, true);
    const snapPlaceholderBtn = createActionBtn(ICONS.magnet, "Przyciąganie (Etap 2)", () => {}, true, true);

    contentWrap.appendChild(pagePlaceholderBtn);
    contentWrap.appendChild(gridPlaceholderBtn);
    contentWrap.appendChild(snapPlaceholderBtn);

    const collapseBtn = createActionBtn(
      isCollapsed ? ICONS.chevronRight : ICONS.chevronDown,
      isCollapsed ? "Rozwiń pasek" : "Zwiń pasek",
      () => {
        isCollapsed = !isCollapsed;
        contentWrap.style.display = isCollapsed ? "none" : "flex";
        collapseBtn.innerHTML = isCollapsed ? ICONS.chevronRight : ICONS.chevronDown;
        collapseBtn.title = isCollapsed ? "Rozwiń pasek" : "Zwiń pasek";
        syncPositionToBounds();
        try {
          localStorage.setItem(STORAGE_COLLAPSED_KEY, isCollapsed ? "1" : "0");
        } catch (err) {
          // Ignoruj
        }
      },
      false,
      true
    );
    collapseBtn.style.touchAction = "none";
    bar.appendChild(collapseBtn);

    toolbarSyncFn = (fromExternal = true) => scheduleSync(fromExternal);
    pullFromAppState();

    if (activeApi && typeof activeApi.onChange === "function") {
      try {
        const unsub = activeApi.onChange(() => {
          if (!penEraseState.isPenDown) {
            scheduleSync(true);
          }
        });
        if (typeof unsub === "function") {
          registerCleanup(unsub, "view");
        }
      } catch (err) {
        // Ignoruj
      }
    }

    trackDomElement(bar, document.body, "view");

    requestAnimationFrame(syncPositionToBounds);
    trackListener(window, "resize", syncPositionToBounds, false, "view");

    if (typeof ResizeObserver !== "undefined" && excalidrawContainer) {
      const ro = new ResizeObserver(() => {
        if (!dragState) syncPositionToBounds();
      });
      ro.observe(excalidrawContainer);
      registerCleanup(() => ro.disconnect(), "view");
    }

    registerCleanup(() => {
      if (syncTimer) clearTimeout(syncTimer);
      if (toolbarSyncFn) {
        toolbarSyncFn = null;
      }
    }, "view");
  }

  function findExcalidrawContainer(view) {
    const root = view?.containerEl || view?.contentEl;
    if (!root) return null;
    return (
      root.querySelector(".excalidraw-wrapper") ||
      root.querySelector(".excalidraw") ||
      root.querySelector("canvas")?.parentElement ||
      root
    );
  }

  function cleanupCurrentView() {
    penEraseState.isPenDown = false;
    penEraseState.wasButtonPressed = false;
    restorePreviousToolAfterErase("zmiana/zamknięcie widoku");
    while (viewCleanups.length > 0) {
      const fn = viewCleanups.pop();
      try {
        fn();
      } catch (err) {
        logMsg(`Błąd cleanupView: ${err.message}`, true);
      }
    }
    attachedContainer = null;
    attachedView = null;
    activeApi = null;
    activeEa = null;
    stats.activeViewsAttached = 0;
  }

  function attachToActiveView() {
    const activeLeaf = app?.workspace?.activeLeaf;
    const view = activeLeaf?.view;
    const viewType = view?.getViewType?.();

    if (!view || viewType !== "excalidraw") {
      if (attachedContainer) {
        cleanupCurrentView();
        logMsg(`Odpięto od widoku Excalidraw (aktywny: ${viewType || "brak"}).`);
      }
      return;
    }

    const container = findExcalidrawContainer(view);
    if (!container) {
      logMsg("Nie znaleziono kontenera Excalidraw w aktywnym widoku.", true);
      return;
    }

    if (attachedContainer === container && attachedView === view) {
      ensureApiReady("ponowne sprawdzenie widoku");
      if (typeof toolbarSyncFn === "function") toolbarSyncFn(true);
      return;
    }

    cleanupCurrentView();

    const { eaObj, api } = resolveExcalidrawContext(view);
    activeEa = eaObj;
    activeApi = api;
    attachedContainer = container;
    attachedView = view;
    stats.activeViewsAttached = 1;

    logMsg(`Podpięto do widoku Excalidraw (API: ${Boolean(api)}).`);

    createFloatingToolbar(container);

    if (!activeApi) {
      let retries = 0;
      const retryTimer = setInterval(() => {
        retries += 1;
        if (!attachedView || attachedView !== view) {
          clearInterval(retryTimer);
          return;
        }
        const found = ensureApiReady(`retry#${retries}`);
        if (found || retries >= 16) {
          clearInterval(retryTimer);
        }
      }, 250);
      registerCleanup(() => clearInterval(retryTimer), "view");
    }

    let lastMoveLogTime = 0;

    // Detekcja wciśnięcia bocznego przycisku S Pen (Zarówno w hover jak i przy dotyku)
    function isPenSideButtonPressed(e) {
      if (e.pointerType !== "pen") return false;
      const isHoverClick = e.pressure === 0 && e.buttons === 1;
      const hasSecondaryBit = (e.buttons & 2) === 2 || (e.buttons & 32) === 32;
      const isSecondaryTrigger = e.button === 2 || e.button === 5;
      return isHoverClick || hasSecondaryBit || isSecondaryTrigger;
    }

    const onPointerDown = (e) => {
      if (e.pointerType !== "pen") return;
      penEraseState.lastPenActivityTime = performance.now();
      penEraseState.isPenDown = e.pressure > 0;

      const btnPressed = isPenSideButtonPressed(e);

      if (btnPressed) {
        if (!penEraseState.wasButtonPressed) {
          penEraseState.wasButtonPressed = true;
          toggleEraseFromPenButton("pointerdown");
        }
      }

      if (DEBUG) {
        logMsg(
          `PEN down | btn=${e.button} btns=${e.buttons} press=${Number(e.pressure || 0).toFixed(3)} tool=${uiState.tool} autoErase=${penEraseState.isAutoErasing}`
        );
      }
    };

    const onPointerMove = (e) => {
      if (e.pointerType !== "pen") return;
      penEraseState.lastPenActivityTime = performance.now();
      penEraseState.isPenDown = e.pressure > 0;

      const btnPressed = isPenSideButtonPressed(e);

      if (btnPressed) {
        if (!penEraseState.wasButtonPressed) {
          penEraseState.wasButtonPressed = true;
          toggleEraseFromPenButton("hover-click");
        }
      } else if (penEraseState.wasButtonPressed) {
        penEraseState.wasButtonPressed = false;
      }

      if (DEBUG) {
        const now = performance.now();
        if (now - lastMoveLogTime >= MOVE_THROTTLE_MS) {
          lastMoveLogTime = now;
          logMsg(
            `PEN move | btns=${e.buttons} press=${Number(e.pressure || 0).toFixed(3)} tool=${uiState.tool} autoErase=${penEraseState.isAutoErasing}`
          );
        }
      }
    };

    const onPointerUp = (e) => {
      if (e.pointerType !== "pen") return;
      penEraseState.lastPenActivityTime = performance.now();
      penEraseState.isPenDown = false;
      penEraseState.wasButtonPressed = false;

      if (DEBUG) {
        logMsg(
          `PEN up | btn=${e.button} btns=${e.buttons} press=${Number(e.pressure || 0).toFixed(3)} autoErase=${penEraseState.isAutoErasing}`
        );
      }
    };

    const onPointerCancel = (e) => {
      if (e.pointerType === "pen") {
        penEraseState.isPenDown = false;
        penEraseState.wasButtonPressed = false;
        logMsg(`PEN cancel | autoErase=${penEraseState.isAutoErasing}`);
      }
    };

    const onPointerLeave = (e) => {
      if (e.pointerType === "pen") {
        penEraseState.isPenDown = false;
        penEraseState.wasButtonPressed = false;
      }
    };

    const onContextMenu = (e) => {
      const elapsedSincePen = performance.now() - penEraseState.lastPenActivityTime;
      const isRecentPenContext =
        e.pointerType === "pen" ||
        (penEraseState.lastPenActivityTime > 0 && elapsedSincePen <= PEN_CONTEXT_WINDOW_MS);

      if (isRecentPenContext) {
        e.preventDefault();
        e.stopPropagation();
        toggleEraseFromPenButton("contextmenu");
        logMsg(`Zablokowano contextmenu dla S Pen (dt=${Math.round(elapsedSincePen)}ms).`);
      }
    };

    trackListener(container, "pointerdown", onPointerDown, true, "view");
    trackListener(container, "pointermove", onPointerMove, true, "view");
    trackListener(container, "pointerup", onPointerUp, true, "view");
    trackListener(container, "pointercancel", onPointerCancel, true, "view");
    trackListener(container, "pointerleave", onPointerLeave, true, "view");
    trackListener(container, "contextmenu", onContextMenu, true, "view");
  }

  function cleanupAll() {
    cleanupCurrentView();
    while (globalCleanups.length > 0) {
      const fn = globalCleanups.pop();
      try {
        fn();
      } catch (err) {
        console.error(`${LOG_PREFIX} Błąd cleanupAll:`, err);
      }
    }
    delete window.__spenNotesCleanup;
    if (DEBUG) {
      console.log(
        `${LOG_PREFIX} Pełne czyszczenie zakończone. Pozostałe zasoby -> L:${stats.globalListeners + stats.viewListeners}, DOM:${stats.domElements}`
      );
    }
  }

  window.__spenNotesCleanup = cleanupAll;

  createDiagnosticOverlay();
  logMsg("Zainicjowano skrypt Etapu 1 (Moduł 1 Toggle + Moduł 2).");

  if (app?.workspace) {
    const leafRef = app.workspace.on("active-leaf-change", () => {
      attachToActiveView();
    });
    registerCleanup(() => app.workspace.offref(leafRef), "global");

    const layoutRef = app.workspace.on("layout-change", () => {
      if (attachedView && !attachedView.containerEl?.isConnected) {
        cleanupCurrentView();
      }
      attachToActiveView();
    });
    registerCleanup(() => app.workspace.offref(layoutRef), "global");
  }

  trackListener(
    window,
    "blur",
    () => {
      penEraseState.isPenDown = false;
      penEraseState.wasButtonPressed = false;
    },
    false,
    "global"
  );

  if (app?.workspace) {
    const cssChangeRef = app.workspace.on("css-change", () => {
      if (typeof toolbarSyncFn === "function") {
        toolbarSyncFn(false);
      }
    });
    registerCleanup(() => app.workspace.offref(cssChangeRef), "global");
  }

  setTimeout(attachToActiveView, 300);
})();