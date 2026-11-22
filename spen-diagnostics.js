
/*
 * S Pen Notebook — Etap 0: Skrypt diagnostyczny
 * Czysty JavaScript (ES2020), brak zewnętrznych zależności.
 */
(function () {
  const DEBUG = true;
  const LOG_PREFIX = "[SPenNotes]";
  const MAX_OVERLAY_LOGS = 60;
  const MOVE_THROTTLE_MS = 100;

  // Zabezpieczenie przed wielokrotnym uruchomieniem — sprzątanie poprzedniej instancji
  if (typeof window.__spenNotesCleanup === "function") {
    try {
      window.__spenNotesCleanup();
    } catch (e) {
      console.error(`${LOG_PREFIX} Błąd podczas czyszczenia poprzedniej instancji:`, e);
    }
  }

  // Rejestr funkcji sprzątających (globalny i per aktywny widok)
  const globalCleanups = [];
  let viewCleanups = [];
  let attachedContainer = null;

  function registerGlobalCleanup(fn) {
    if (typeof fn === "function") globalCleanups.push(fn);
  }

  function registerViewCleanup(fn) {
    if (typeof fn === "function") viewCleanups.push(fn);
  }

  function cleanupView() {
    while (viewCleanups.length > 0) {
      const fn = viewCleanups.pop();
      try {
        fn();
      } catch (e) {
        console.error(`${LOG_PREFIX} Błąd cleanupView:`, e);
      }
    }
    attachedContainer = null;
  }

  function cleanupAll() {
    cleanupView();
    while (globalCleanups.length > 0) {
      const fn = globalCleanups.pop();
      try {
        fn();
      } catch (e) {
        console.error(`${LOG_PREFIX} Błąd cleanupAll:`, e);
      }
    }
    delete window.__spenNotesCleanup;
    if (DEBUG) console.log(`${LOG_PREFIX} Wyczyszczono wszystkie nasłuchy i elementy DOM.`);
  }

  window.__spenNotesCleanup = cleanupAll;

  // Bufor logów do okna na ekranie i kopiowania
  const logHistory = [];
  let overlayLogEl = null;
  let overlayRootEl = null;

  function formatMsg(msg) {
    const now = new Date();
    const ts = now.toTimeString().split(" ")[0] + "." + String(now.getMilliseconds()).padStart(3, "0");
    return `[${ts}] ${msg}`;
  }

  function appendLog(msg, isError = false) {
    const line = formatMsg(msg);
    if (DEBUG) {
      if (isError) console.error(`${LOG_PREFIX} ${line}`);
      else console.log(`${LOG_PREFIX} ${line}`);
    }

    logHistory.push(line);
    if (logHistory.length > 300) {
      logHistory.shift();
    }

    if (overlayLogEl) {
      const entry = document.createElement("div");
      entry.textContent = line;
      entry.style.borderBottom = "1px solid var(--background-modifier-border, #444)";
      entry.style.padding = "2px 0";
      entry.style.wordBreak = "break-word";
      if (isError) entry.style.color = "var(--text-error, #ff6b6b)";
      overlayLogEl.appendChild(entry);

      while (overlayLogEl.childElementCount > MAX_OVERLAY_LOGS) {
        overlayLogEl.removeChild(overlayLogEl.firstChild);
      }
      overlayLogEl.scrollTop = overlayLogEl.scrollHeight;
    }
  }

  // Tworzenie nakładki diagnostycznej na ekranie
  function createOverlay() {
    const root = document.createElement("div");
    root.id = "spen-notes-diag-overlay";
    Object.assign(root.style, {
      position: "fixed",
      bottom: "12px",
      right: "12px",
      width: "min(92vw, 420px)",
      maxHeight: "42vh",
      zIndex: "99999",
      backgroundColor: "var(--background-primary, #1e1e1e)",
      color: "var(--text-normal, #e0e0e0)",
      border: "1px solid var(--background-modifier-border, #555)",
      borderRadius: "8px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      display: "flex",
      flexDirection: "column",
      fontFamily: "monospace",
      fontSize: "11px",
      overflow: "hidden",
      touchAction: "none"
    });

    // Blokowanie propagacji zdarzeń z nakładki do płótna Excalidraw
    ["pointerdown", "pointerup", "pointermove", "touchstart", "contextmenu"].forEach((evtName) => {
      const stop = (e) => e.stopPropagation();
      root.addEventListener(evtName, stop);
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "6px 8px",
      backgroundColor: "var(--background-secondary, #2a2a2a)",
      borderBottom: "1px solid var(--background-modifier-border, #444)",
      gap: "6px",
      flexWrap: "wrap"
    });

    const title = document.createElement("span");
    title.textContent = "SPenNotes Diag (Etap 0)";
    title.style.fontWeight = "bold";
    header.appendChild(title);

    const btnGroup = document.createElement("div");
    btnGroup.style.display = "flex";
    btnGroup.style.gap = "4px";

    function makeBtn(label, onClick) {
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
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick(btn);
      });
      return btn;
    }

    let isCollapsed = false;
    const logContainer = document.createElement("div");
    Object.assign(logContainer.style, {
      padding: "6px 8px",
      overflowY: "auto",
      flex: "1",
      maxHeight: "30vh",
      lineHeight: "1.35",
      touchAction: "pan-y",
      userSelect: "text"
    });

    const copyBtn = makeBtn("Kopiuj", async (btn) => {
      const text = logHistory.join("\n");
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          const old = btn.textContent;
          btn.textContent = "OK!";
          setTimeout(() => (btn.textContent = old), 1200);
        } else {
          throw new Error("Brak navigator.clipboard");
        }
      } catch (err) {
        appendLog("Nie udało się skopiować automatycznie: " + err.message, true);
      }
    });

    const clearBtn = makeBtn("Wyczyść", () => {
      logHistory.length = 0;
      if (overlayLogEl) overlayLogEl.innerHTML = "";
    });

    const toggleBtn = makeBtn("Zwiń", (btn) => {
      isCollapsed = !isCollapsed;
      logContainer.style.display = isCollapsed ? "none" : "block";
      btn.textContent = isCollapsed ? "Rozwiń" : "Zwiń";
    });

    const closeBtn = makeBtn("X", () => {
      cleanupAll();
    });

    btnGroup.appendChild(copyBtn);
    btnGroup.appendChild(clearBtn);
    btnGroup.appendChild(toggleBtn);
    btnGroup.appendChild(closeBtn);
    header.appendChild(btnGroup);

    root.appendChild(header);
    root.appendChild(logContainer);
    document.body.appendChild(root);

    overlayRootEl = root;
    overlayLogEl = logContainer;

    registerGlobalCleanup(() => {
      if (overlayRootEl && overlayRootEl.parentNode) {
        overlayRootEl.parentNode.removeChild(overlayRootEl);
      }
      overlayRootEl = null;
      overlayLogEl = null;
    });
  }

  // Inspekcja API ExcalidrawAutomate i ExcalidrawAPI
  function inspectEnvironment(view) {
    const eaObj = typeof ea !== "undefined" ? ea : window.ExcalidrawAutomate;
    const pluginVersion = eaObj?.plugin?.manifest?.version || "nieznana";
    appendLog(`Wersja wtyczki Excalidraw: ${pluginVersion}`);

    if (!eaObj) {
      appendLog("BŁĄD: Obiekt 'ea' (ExcalidrawAutomate) nie jest dostępny!", true);
      return;
    }

    try {
      const eaKeys = Object.keys(eaObj);
      appendLog(`Object.keys(ea) (${eaKeys.length}): ${eaKeys.join(", ")}`);
    } catch (e) {
      appendLog(`Błąd odczytu Object.keys(ea): ${e.message}`, true);
    }

    // Ustawienie aktywnego widoku w ea, jeśli to konieczne i dostępne
    if (view && typeof eaObj.setView === "function") {
      try {
        eaObj.setView(view);
      } catch (e) {
        // Ignoruj, jeśli setView nie przyjmuje tego obiektu
      }
    }

    let api = null;
    try {
      api = typeof eaObj.getExcalidrawAPI === "function" ? eaObj.getExcalidrawAPI() : null;
    } catch (e) {
      appendLog(`Błąd wywołania ea.getExcalidrawAPI(): ${e.message}`, true);
    }

    appendLog(`ea.getExcalidrawAPI() zwraca obiekt: ${Boolean(api && typeof api === "object")}`);

    if (api && typeof api === "object") {
      const apiKeys = Object.keys(api);
      appendLog(`Object.keys(api) (${apiKeys.length}): ${apiKeys.join(", ")}`);

      const checkList = [
        "setActiveTool",
        "updateScene",
        "getAppState",
        "getSceneElements",
        "scrollToContent",
        "history"
      ];
      const availability = checkList.map((m) => {
        const val = api[m];
        const kind = val === undefined ? "brak" : typeof val;
        return `${m}:${kind}`;
      });
      appendLog(`Metody API -> ${availability.join(" | ")}`);

      // Dodatkowe sprawdzenie pól w appState pod kątem Etapu 1 i 2
      if (typeof api.getAppState === "function") {
        try {
          const st = api.getAppState();
          const stateChecks = [
            "activeTool",
            "currentItemStrokeColor",
            "currentItemStrokeWidth",
            "currentItemOpacity",
            "gridModeEnabled",
            "gridSize",
            "theme"
          ].map((k) => `${k}:${k in st ? JSON.stringify(st[k]) : "brak"}`);
          appendLog(`appState -> ${stateChecks.join(" | ")}`);
        } catch (e) {
          appendLog(`Błąd getAppState(): ${e.message}`, true);
        }
      }
    }
  }

  // Znajdowanie kontenera płótna Excalidraw w aktywnym widoku
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

  // Podpinanie nasłuchów zdarzeń wskaźnika na kontenerze Excalidraw
  function attachToActiveView() {
    const activeLeaf = app?.workspace?.activeLeaf;
    const view = activeLeaf?.view;
    const viewType = view?.getViewType?.();

    if (!view || viewType !== "excalidraw") {
      cleanupView();
      appendLog(`Aktywny widok nie jest Excalidraw (typ: ${viewType || "brak"}). Oczekiwanie...`);
      return;
    }

    const container = findExcalidrawContainer(view);
    if (!container) {
      appendLog("Nie znaleziono kontenera Excalidraw w widoku.", true);
      return;
    }

    if (attachedContainer === container) {
      return; // Już podpięte do tego kontenera
    }

    cleanupView();
    attachedContainer = container;
    appendLog(`Podpięto diagnostykę do widoku Excalidraw.`);

    inspectEnvironment(view);

    let lastMoveTime = 0;
    let lastMoveButtons = null;

    function formatPointerEvent(e) {
      const pType = e.pointerType ?? "brak";
      const btn = e.button ?? "brak";
      const btns = e.buttons ?? "brak";
      const press = typeof e.pressure === "number" ? e.pressure.toFixed(3) : "brak";
      const ts = typeof e.timeStamp === "number" ? Math.round(e.timeStamp) : "brak";
      const mods = [
        e.ctrlKey ? "C" : "",
        e.shiftKey ? "S" : "",
        e.altKey ? "A" : ""
      ].filter(Boolean).join("");
      return `${e.type} | type=${pType} btn=${btn} btns=${btns} press=${press} ts=${ts}${mods ? " mod=" + mods : ""}`;
    }

    const onPointerDown = (e) => appendLog(formatPointerEvent(e));
    const onPointerUp = (e) => appendLog(formatPointerEvent(e));
    const onPointerCancel = (e) => appendLog(formatPointerEvent(e));
    const onContextMenu = (e) => appendLog(formatPointerEvent(e));

    const onPointerMove = (e) => {
      const now = performance.now();
      // Loguj natychmiast przy zmianie stanu przycisków (np. wciśnięcie przycisku S Pen w trakcie ruchu)
      // lub co MOVE_THROTTLE_MS milisekund
      if (e.buttons !== lastMoveButtons || now - lastMoveTime >= MOVE_THROTTLE_MS) {
        lastMoveTime = now;
        lastMoveButtons = e.buttons;
        appendLog(formatPointerEvent(e));
      }
    };

    const onTouchStart = (e) => {
      const touches = e.touches ? e.touches.length : 0;
      const ts = typeof e.timeStamp === "number" ? Math.round(e.timeStamp) : "brak";
      appendLog(`touchstart | touches=${touches} ts=${ts}`);
    };

    // Używamy capture: true, aby przechwycić zdarzenia przed wewnętrznymi handlerami Excalidraw
    const events = [
      ["pointerdown", onPointerDown, true],
      ["pointermove", onPointerMove, true],
      ["pointerup", onPointerUp, true],
      ["pointercancel", onPointerCancel, true],
      ["contextmenu", onContextMenu, true],
      ["touchstart", onTouchStart, true]
    ];

    events.forEach(([name, fn, cap]) => {
      container.addEventListener(name, fn, cap);
      registerViewCleanup(() => container.removeEventListener(name, fn, cap));
    });
  }

  // Start
  createOverlay();
  appendLog("Uruchomiono skrypt diagnostyczny Etapu 0.");

  if (app?.workspace) {
    const leafRef = app.workspace.on("active-leaf-change", () => {
      attachToActiveView();
    });
    registerGlobalCleanup(() => app.workspace.offref(leafRef));
  }

  // Opóźnione pierwsze podpięcie na wypadek, gdyby widok Excalidraw jeszcze się ładował przy starcie
  setTimeout(attachToActiveView, 300);
})();