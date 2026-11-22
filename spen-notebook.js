/*
- S Pen Notebook — Etap 1: Core + S Pen Toggle-Erase (Moduł 1) + Floating Toolbar (Moduł 2)
- Czysty JavaScript (ES2020), brak zewnętrznych zależności.
 */
(function () {
  const DEBUG = true;
  const LOG_PREFIX = "[SPenNotes]";
  const STORAGE_POS_KEY = "spenNotes.toolbarPos.v1";
  const STORAGE_COLLAPSED_KEY = "spenNotes.toolbarCollapsed.v1";
  const PEN_CONTEXT_WINDOW_MS = 600;
  const MOVE_THROTTLE_MS = 140;
  const MAX_OVERLAY_LOGS = 60;

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

  // Optymistyczny stan paska, aby UI nie było o "krok w tył" względem getAppState()
  const uiState = {
    tool: "freedraw",
    strokeColor: "#1e1e1e",
    strokeWidth: 2,
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
      if (wasHighlighter && targetTool === "freedraw") {
        uiState.highlighter = true;
        uiState.opacity = prevOpacity;
        uiState.strokeWidth = prevWidth;
        updateAppStateSafe(api, {
          currentItemOpacity: prevOpacity,
          currentItemStrokeWidth: prevWidth
        });
      }
      setToolSafe(api, targetTool);
      if (wasHighlighter && targetTool === "freedraw") {
        uiState.highlighter = true;
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
    // Zabezpieczenie przed podwójnym wyzwoleniem z tego samego kliknięcia (np. pointerdown + contextmenu)
    if (now - penEraseState.lastToggleTime < 150) return;
    penEraseState.lastToggleTime = now;

    const api = ensureApiReady(`toggle:${reason}`);
    if (!api) return;

    const currentTool = getCurrentToolType(api);

    // Jeśli użytkownik w międzyczasie ręcznie zmienił gumkę na inne narzędzie na pasku, synchronizujemy stan
    if (penEraseState.isAutoErasing && currentTool !== "eraser" && uiState.tool !== "eraser") {
      penEraseState.isAutoErasing = false;
    }

    if (!penEraseState.isAutoErasing) {
      // 1. Kliknięcie: Włącz gumkę i zapamiętaj poprzednie narzędzie (wraz ze stanem zakreślacza)
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
      // 2. Kliknięcie: Wyłącz gumkę i wróć do poprzedniego narzędzia
      restorePreviousToolAfterErase(reason);
    }
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
        minWidth: "36px",
        minHeight: "36px",
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

  function createFloatingToolbar(parentContainer) {
    const bar = document.createElement("div");
    bar.id = "spen-notes-floating-toolbar";
    Object.assign(bar.style, {
      position: "fixed",
      top: "56px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "9990",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "6px 8px",
      maxWidth: "96vw",
      flexWrap: "wrap",
      backgroundColor: "var(--background-primary, #1e1e1e)",
      color: "var(--text-normal, #e0e0e0)",
      border: "1px solid var(--background-modifier-border, #444)",
      borderRadius: "12px",
      boxShadow: "0 6px 20px rgba(0,0,0,0.28)",
      touchAction: "none",
      userSelect: "none",
      fontFamily: "var(--font-interface, sans-serif)",
      fontSize: "12px"
    });

    ["pointerdown", "pointermove", "pointerup", "touchstart", "contextmenu"].forEach((evtName) => {
      trackListener(bar, evtName, (e) => e.stopPropagation(), false, "view");
    });

    let isCollapsed = false;
    try {
      const savedPos = JSON.parse(localStorage.getItem(STORAGE_POS_KEY) || "null");
      if (savedPos && typeof savedPos.left === "number" && typeof savedPos.top === "number") {
        bar.style.transform = "none";
        bar.style.left = `${Math.max(8, Math.min(window.innerWidth - 80, savedPos.left))}px`;
        bar.style.top = `${Math.max(8, Math.min(window.innerHeight - 60, savedPos.top))}px`;
      }
      isCollapsed = localStorage.getItem(STORAGE_COLLAPSED_KEY) === "1";
    } catch (err) {
      // Ignoruj
    }

    const dragHandle = document.createElement("div");
    dragHandle.textContent = "⋮⋮";
    dragHandle.title = "Przeciągnij pasek";
    Object.assign(dragHandle.style, {
      minWidth: "36px",
      minHeight: "36px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "grab",
      borderRadius: "8px",
      backgroundColor: "var(--background-secondary, #2b2b2b)",
      border: "1px solid var(--background-modifier-border, #444)",
      touchAction: "none",
      fontWeight: "bold"
    });
    bar.appendChild(dragHandle);

    let dragState = null;

    trackListener(
      dragHandle,
      "pointerdown",
      (e) => {
        if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
        const rect = bar.getBoundingClientRect();
        bar.style.transform = "none";
        bar.style.left = `${rect.left}px`;
        bar.style.top = `${rect.top}px`;
        dragState = {
          pointerId: e.pointerId,
          offsetX: e.clientX - rect.left,
          offsetY: e.clientY - rect.top
        };
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
        const maxX = Math.max(8, window.innerWidth - bar.offsetWidth - 8);
        const maxY = Math.max(8, window.innerHeight - bar.offsetHeight - 8);
        const nextLeft = Math.max(8, Math.min(maxX, e.clientX - dragState.offsetX));
        const nextTop = Math.max(8, Math.min(maxY, e.clientY - dragState.offsetY));
        bar.style.left = `${nextLeft}px`;
        bar.style.top = `${nextTop}px`;
      },
      false,
      "view"
    );

    const finishDrag = (e) => {
      if (!dragState || (e && e.pointerId !== undefined && e.pointerId !== dragState.pointerId)) return;
      dragState = null;
      const rect = bar.getBoundingClientRect();
      try {
        localStorage.setItem(
          STORAGE_POS_KEY,
          JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) })
        );
      } catch (err) {
        // Ignoruj
      }
    };

    trackListener(dragHandle, "pointerup", finishDrag, false, "view");
    trackListener(dragHandle, "pointercancel", finishDrag, false, "view");

    const contentWrap = document.createElement("div");
    Object.assign(contentWrap.style, {
      display: isCollapsed ? "none" : "flex",
      alignItems: "center",
      gap: "6px",
      flexWrap: "wrap"
    });
    bar.appendChild(contentWrap);

    function makeDivider() {
      const div = document.createElement("span");
      Object.assign(div.style, {
        width: "1px",
        height: "24px",
        backgroundColor: "var(--background-modifier-border, #555)",
        margin: "0 2px"
      });
      return div;
    }

    function createActionBtn(label, title, onClick, isDisabled = false) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.title = title;
      btn.disabled = isDisabled;
      Object.assign(btn.style, {
        minWidth: "36px",
        minHeight: "36px",
        padding: "0 8px",
        borderRadius: "8px",
        border: "1px solid var(--background-modifier-border, #555)",
        backgroundColor: "var(--background-secondary, #2a2a2a)",
        color: "var(--text-normal, #e0e0e0)",
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? "0.45" : "1",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        touchAction: "none",
        fontWeight: "600"
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
          ? "0 0 0 2px var(--background-primary, #1e1e1e), 0 0 0 4px var(--interactive-accent, #705dcf)"
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
      } else if (uiState.tool === "freedraw" && uiState.opacity <= 50 && uiState.strokeWidth === 16) {
        uiState.highlighter = true;
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

    const penBtn = createActionBtn("Pióro", "Pióro (freedraw)", () => {
      const api = ensureApiReady("Pióro");
      penEraseState.isAutoErasing = false;
      uiState.highlighter = false;
      uiState.opacity = 100;
      uiState.tool = "freedraw";
      renderToolbarVisuals();
      updateAppStateSafe(api, { currentItemOpacity: 100 });
      setToolSafe(api, "freedraw");
      scheduleSync(false);
    });

    const highlighterBtn = createActionBtn("Zakreślacz", "Zakreślacz (opacity 40, grubość 16)", () => {
      const api = ensureApiReady("Zakreślacz");
      penEraseState.isAutoErasing = false;
      uiState.highlighter = true;
      uiState.opacity = 40;
      uiState.strokeWidth = 16;
      uiState.tool = "freedraw";
      renderToolbarVisuals();
      updateAppStateSafe(api, {
        currentItemOpacity: 40,
        currentItemStrokeWidth: 16
      });
      setToolSafe(api, "freedraw");
      scheduleSync(false);
    });

    const eraserBtn = createActionBtn("Gumka", "Gumka (eraser)", () => {
      const api = ensureApiReady("Gumka");
      penEraseState.isAutoErasing = false;
      uiState.highlighter = false;
      uiState.tool = "eraser";
      renderToolbarVisuals();
      setToolSafe(api, "eraser");
      scheduleSync(false);
    });

    const selectBtn = createActionBtn("Lasso", "Zaznaczanie (selection)", () => {
      const api = ensureApiReady("Lasso");
      penEraseState.isAutoErasing = false;
      uiState.highlighter = false;
      uiState.tool = "selection";
      renderToolbarVisuals();
      setToolSafe(api, "selection");
      scheduleSync(false);
    });

    const undoBtn = createActionBtn("Cofnij", "Cofnij (Undo)", () => {
      const api = ensureApiReady("Cofnij");
      if (api && api.history && typeof api.history.undo === "function") {
        api.history.undo();
      } else if (activeEa && typeof activeEa.mostRecentExcalidrawAPI?.history?.undo === "function") {
        activeEa.mostRecentExcalidrawAPI.history.undo();
      } else {
        logMsg("Metoda history.undo nie jest dostępna w tym API.", true);
      }
      scheduleSync(true);
    });

    const redoBtn = createActionBtn("Ponów", "Ponów (Redo)", () => {
      const api = ensureApiReady("Ponów");
      if (api && api.history && typeof api.history.redo === "function") {
        api.history.redo();
      } else {
        logMsg("Metoda history.redo nie jest dostępna w tym API.", true);
      }
      scheduleSync(true);
    });

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
      Object.assign(cBtn.style, {
        minWidth: "36px",
        minHeight: "36px",
        borderRadius: "50%",
        border: "2px solid var(--background-modifier-border, #666)",
        cursor: "pointer",
        padding: "0",
        touchAction: "none"
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
        uiState.highlighter = false;
        uiState.strokeWidth = w;
        uiState.opacity = 100;
        renderToolbarVisuals();
        updateAppStateSafe(api, {
          currentItemStrokeWidth: w,
          currentItemOpacity: 100
        });
        scheduleSync(false);
      });
      widthButtons.push({ width: w, btn: wBtn });
      contentWrap.appendChild(wBtn);
    });

    contentWrap.appendChild(makeDivider());

    const pagePlaceholderBtn = createActionBtn("+ Strona", "Dostępne w Etapie 2", () => {}, true);
    const gridPlaceholderBtn = createActionBtn("Siatka", "Dostępne w Etapie 2", () => {}, true);
    const snapPlaceholderBtn = createActionBtn("Przyciąg.", "Dostępne w Etapie 2", () => {}, true);

    contentWrap.appendChild(pagePlaceholderBtn);
    contentWrap.appendChild(gridPlaceholderBtn);
    contentWrap.appendChild(snapPlaceholderBtn);

    const collapseBtn = createActionBtn(
      isCollapsed ? "▸" : "▾",
      isCollapsed ? "Rozwiń pasek" : "Zwiń pasek",
      () => {
        isCollapsed = !isCollapsed;
        contentWrap.style.display = isCollapsed ? "none" : "flex";
        collapseBtn.textContent = isCollapsed ? "▸" : "▾";
        try {
          localStorage.setItem(STORAGE_COLLAPSED_KEY, isCollapsed ? "1" : "0");
        } catch (err) {
          // Ignoruj
        }
      }
    );
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

    trackDomElement(bar, parentContainer || document.body, "view");
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

    createFloatingToolbar(document.body);

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
        // Reaguj wyłącznie w momencie kliknięcia (zbocze narastające)
        if (!penEraseState.wasButtonPressed) {
          penEraseState.wasButtonPressed = true;
          toggleEraseFromPenButton("hover-click");
        }
      } else if (penEraseState.wasButtonPressed) {
        // Przycisk został puszczony — resetujemy flagę detekcji kliknięcia, ale gumka zostaje aktywna
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
      // Gumka NIE wyłącza się po oderwaniu rysika od ekranu — czeka na ponowne kliknięcie przycisku
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