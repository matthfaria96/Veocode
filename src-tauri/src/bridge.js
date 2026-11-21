// Ponte do navegador do Veocode. O WebKit põe este script em toda página e moldura do app;
// ele só acorda numa moldura que está direto dentro do Veocode e só conversa com ele.
// Faz: escolher um elemento (contorno + nome ao passar o mouse), voltar/avançar/recarregar,
// contar endereço, título e se a página tem recarga própria (Vite, Next), guardar o console
// da página (erros, avisos, pedidos de rede que falharam), ler a página e clicar/digitar/rolar
// para a IA, e apagar os dados daquele site. Só responde ao que o Veocode pede.
(function () {
  try {
    if (window.top === window || window.parent !== window.top || window.__veoBridge) return;
    // a página em branco que o WebKit deixa no lugar de um site que não abre em moldura (ou de
    // um endereço que falhou) não é a página: calada, o Veocode percebe e avisa
    if (location.href === "about:blank") return;
    var anc = location.ancestorOrigins;
    var top = anc && anc.length ? anc[anc.length - 1] : "";
    var OK = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420", "http://127.0.0.1:1420"];
    if (OK.indexOf(top) < 0) return;
    window.__veoBridge = 1;
  } catch (e) {
    return;
  }
  // cada documento tem um nome: o Veocode sabe quando a página trocou de verdade
  var DOC = Math.random().toString(36).slice(2, 10);
  var post = function (m) {
    m.__veo = 1;
    m.doc = DOC;
    try {
      parent.postMessage(m, top);
    } catch (e) {}
  };
  var hmr = function () {
    try {
      return !!(document.querySelector('script[src*="/@vite/client"]') || window.next || window.__NEXT_DATA__ || window.__NUXT__ || window.webpackHotUpdate || window.parcelRequire);
    } catch (e) {
      return false;
    }
  };
  var hello = function (t) {
    post({ t: t, url: location.href, title: document.title || "", hmr: hmr() });
  };

  // ------------------------------------------------------------ apagar os dados deste site
  var clearNow = function () {
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    try {
      document.cookie.split(";").forEach(function (c) {
        var n = c.split("=")[0].trim();
        if (!n) return;
        var bits = location.pathname.split("/");
        for (var i = bits.length; i > 0; i--) document.cookie = n + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=" + (bits.slice(0, i).join("/") || "/");
      });
    } catch (e) {}
    var jobs = [];
    try { if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })); } catch (e) {}
    try {
      if (indexedDB && indexedDB.databases) jobs.push(indexedDB.databases().then(function (dbs) {
        return Promise.all(dbs.map(function (d) { return new Promise(function (ok) { var q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = ok; }); }));
      }));
    } catch (e) {}
    try { if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })); } catch (e) {}
    return Promise.all(jobs).catch(function () {});
  };
  // "dados só até fechar o Veocode": a 1ª página de cada site em cada abertura do app começa
  // limpa, antes de qualquer script dela rodar (o Veocode marca a moldura pelo nome)
  try {
    if (window.name === "veo-session" && !sessionStorage.getItem("__veo_s")) {
      clearNow();
      sessionStorage.setItem("__veo_s", "1");
    }
  } catch (e) {}

  // ------------------------------------------------------------ console da página
  var sec = 0, inSec = 0, dropped = 0;
  var show = function (a) {
    try {
      if (a instanceof Error) return a.stack && a.stack.indexOf(a.message) >= 0 ? a.stack : a.name + ": " + a.message + (a.stack ? "\n" + a.stack : "");
      if (typeof a === "string") return a;
      if (a === undefined) return "undefined";
      if (a && a.nodeType === 1) return "<" + a.tagName.toLowerCase() + (a.id ? "#" + a.id : "") + ">";
      if (a && typeof a === "object") return JSON.stringify(a).slice(0, 1500);
      return String(a);
    } catch (e) {
      return String(a);
    }
  };
  var joinArgs = function (args) {
    var list = [].slice.call(args);
    // console.log("%cOi", "color: red"): tira os estilos
    if (typeof list[0] === "string" && list[0].indexOf("%c") >= 0) {
      var n = (list[0].match(/%c/g) || []).length;
      list = [list[0].replace(/%c/g, "")].concat(list.slice(1 + n));
    }
    return list.map(show).join(" ");
  };
  var log = function (level, text, kind) {
    var s = Math.floor(Date.now() / 1000);
    if (s !== sec) { sec = s; inSec = 0; }
    // uma página que escreve sem parar não afoga o Veocode
    if (++inSec > 40) { dropped++; return; }
    post({ t: "console", l: level, m: String(text).slice(0, 4000), k: kind || "", at: Date.now(), drop: dropped });
    dropped = 0;
  };
  ["error", "warn", "info", "log", "debug"].forEach(function (k) {
    var orig = console[k];
    if (typeof orig !== "function") return;
    console[k] = function () {
      try { log(k === "debug" ? "log" : k, joinArgs(arguments), "console"); } catch (e) {}
      return orig.apply(this, arguments);
    };
  });
  addEventListener("error", function (e) {
    var t = e.target;
    if (t && t !== window && t.tagName) {
      log("error", "Failed to load " + t.tagName.toLowerCase() + ": " + (t.currentSrc || t.src || t.href || ""), "resource");
      return;
    }
    var where = e.filename ? " (" + e.filename + ":" + e.lineno + (e.colno ? ":" + e.colno : "") + ")" : "";
    log("error", (e.error && e.error.stack && e.error.stack.indexOf(e.message) >= 0 ? e.error.stack : (e.message || "Error") + where), "exception");
  }, true);
  addEventListener("unhandledrejection", function (e) {
    log("error", "Unhandled promise rejection: " + show(e.reason), "exception");
  });
  // pedidos de rede que falharam (fetch e XMLHttpRequest)
  try {
    if (window.fetch) {
      var origFetch = window.fetch;
      window.fetch = function (input, init) {
        var url = typeof input === "string" ? input : (input && input.url) || String(input);
        var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
        return origFetch.apply(this, arguments).then(function (r) {
          if (!r.ok && r.type !== "opaque") log("error", method + " " + url + " → " + r.status + (r.statusText ? " " + r.statusText : ""), "network");
          return r;
        }, function (err) {
          if (!err || err.name !== "AbortError") log("error", method + " " + url + " → " + ((err && err.message) || "failed"), "network");
          throw err;
        });
      };
    }
    var XP = XMLHttpRequest.prototype, xOpen = XP.open, xSend = XP.send;
    XP.open = function (m, u) {
      this.__veoReq = String(m).toUpperCase() + " " + u;
      return xOpen.apply(this, arguments);
    };
    XP.send = function () {
      var x = this, aborted = false;
      x.addEventListener("abort", function () { aborted = true; });
      x.addEventListener("loadend", function () {
        if (!aborted && (x.status === 0 || x.status >= 400)) log("error", (x.__veoReq || "XHR") + " → " + (x.status || "failed"), "network");
      });
      return xSend.apply(this, arguments);
    };
  } catch (e) {}

  // endereço mudando sem recarregar (apps de uma página só)
  ["pushState", "replaceState"].forEach(function (k) {
    var orig = history[k];
    history[k] = function () {
      var r = orig.apply(this, arguments);
      setTimeout(function () { hello("nav"); }, 0);
      return r;
    };
  });
  addEventListener("popstate", function () { hello("nav"); });
  addEventListener("hashchange", function () { hello("nav"); });
  addEventListener("DOMContentLoaded", function () {
    hello("ready");
    try {
      var t = document.querySelector("title");
      if (t) new MutationObserver(function () { hello("nav"); }).observe(t, { childList: true, characterData: true, subtree: true });
    } catch (e) {}
  });
  addEventListener("load", function () { hello("ready"); });
  // saindo desta página (link, formulário): o Veocode mostra que está carregando
  addEventListener("pagehide", function () { post({ t: "bye" }); });

  // ------------------------------------------------------------ desenho por cima da página
  var Z = "2147483647";
  var css = function (el, s) { for (var k in s) el.style.setProperty(k, s[k], "important"); };
  // um contorno que pisca onde a IA clicou ou digitou (a pessoa vê o que aconteceu)
  var flash = function (el) {
    try {
      var r = el.getBoundingClientRect();
      var f = document.createElement("div");
      f.setAttribute("data-veo", "");
      css(f, { position: "fixed", "pointer-events": "none", "z-index": Z, left: r.left - 3 + "px", top: r.top - 3 + "px", width: r.width + 6 + "px", height: r.height + 6 + "px", border: "2px solid #a855f7", "border-radius": "6px", background: "rgba(168,85,247,.14)", "box-shadow": "0 0 0 4px rgba(168,85,247,.18)", "box-sizing": "border-box", margin: "0", padding: "0", opacity: "1", transition: "opacity .5s ease .45s" });
      document.documentElement.appendChild(f);
      requestAnimationFrame(function () { css(f, { opacity: "0" }); });
      setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1100);
    } catch (e) {}
  };

  // ------------------------------------------------------------ escolher um elemento
  var on = false, cur = null, box = null, tag = null, cursor = "";
  var junk = /^(css|sc|jsx|svelte|emotion|chakra)-|[0-9a-f]{6,}|__/i;
  var short = function (el) {
    var s = el.tagName.toLowerCase();
    if (el.id && !/\d{3,}/.test(el.id)) return s + "#" + el.id;
    var cls = [].slice.call(el.classList || []).filter(function (c) { return !junk.test(c); }).slice(0, 2);
    return s + (cls.length ? "." + cls.join(".") : "");
  };
  var path = function (el) {
    var parts = [], n = el;
    while (n && n.nodeType === 1 && parts.length < 6) {
      var p = short(n);
      if (n.id && !/\d{3,}/.test(n.id)) { parts.unshift(p); break; }
      var par = n.parentElement;
      if (par) {
        var same = [].filter.call(par.children, function (c) { return c.tagName === n.tagName; });
        if (same.length > 1) p += ":nth-of-type(" + (same.indexOf(n) + 1) + ")";
      }
      parts.unshift(p);
      if (!par || par === document.body || par === document.documentElement) break;
      n = par;
    }
    return parts.join(" > ");
  };
  // de que componente veio (React, Vue, Svelte em modo de desenvolvimento)
  var component = function (el) {
    try {
      for (var n = el; n; n = n.parentElement) {
        var keys = Object.keys(n);
        for (var i = 0; i < keys.length; i++) {
          if (keys[i].indexOf("__reactFiber$") === 0) {
            for (var f = n[keys[i]]; f; f = f.return) {
              var t = f.type;
              if (typeof t === "function" || (t && typeof t === "object" && (t.render || t.type))) {
                var name = t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name));
                if (name) {
                  var src = f._debugSource;
                  return { name: name, file: src ? src.fileName + (src.lineNumber ? ":" + src.lineNumber : "") : null, lib: "React" };
                }
              }
            }
          }
        }
        if (n.__vueParentComponent) {
          var c = n.__vueParentComponent.type || {};
          return { name: c.name || c.__name || null, file: c.__file || null, lib: "Vue" };
        }
        if (n.__svelte_meta && n.__svelte_meta.loc) return { name: null, file: n.__svelte_meta.loc.file + ":" + (n.__svelte_meta.loc.line + 1), lib: "Svelte" };
      }
    } catch (e) {}
    return null;
  };
  var STY = ["display", "position", "width", "height", "margin", "padding", "color", "background-color", "background-image", "font-family", "font-size", "font-weight", "line-height", "border", "border-radius", "box-shadow", "gap", "flex-direction", "justify-content", "align-items", "grid-template-columns", "opacity", "z-index"];
  var info = function (el) {
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el), st = {};
    STY.forEach(function (k) {
      var v = cs.getPropertyValue(k);
      if (!v || /^(none|normal|auto|0px|static|rgba\(0, 0, 0, 0\))$/.test(v) || /^0px none/.test(v) || (k === "opacity" && v === "1")) return;
      st[k] = v;
    });
    // detalhes de flex/grid só quando o elemento é flex ou grid
    if (!/flex|grid/.test(st.display || "")) ["flex-direction", "justify-content", "align-items", "gap", "grid-template-columns"].forEach(function (k) { delete st[k]; });
    var html = el.outerHTML || "";
    if (html.length > 4000) html = html.slice(0, 4000) + "\n…";
    return {
      label: short(el),
      selector: path(el),
      text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 400),
      html: html,
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      vw: innerWidth,
      vh: innerHeight,
      styles: st,
      component: component(el),
      url: location.href,
      title: document.title || ""
    };
  };
  var ui = function () {
    if (box) return;
    box = document.createElement("div");
    tag = document.createElement("div");
    box.setAttribute("data-veo", "");
    tag.setAttribute("data-veo", "");
    css(box, { position: "fixed", "pointer-events": "none", "z-index": Z, border: "2px solid #3b82f6", background: "rgba(59,130,246,.10)", "border-radius": "3px", "box-sizing": "border-box", margin: "0", padding: "0", transition: "all .05s linear", left: "-9px", top: "-9px", width: "0", height: "0" });
    css(tag, { position: "fixed", "pointer-events": "none", "z-index": Z, background: "#3b82f6", color: "#fff", font: "600 11px/18px -apple-system,BlinkMacSystemFont,system-ui,sans-serif", padding: "0 6px", "border-radius": "4px", "white-space": "nowrap", "box-shadow": "0 2px 6px rgba(0,0,0,.25)", margin: "0", left: "-999px", top: "-999px", "max-width": "70vw", overflow: "hidden", "text-overflow": "ellipsis" });
  };
  var place = function (el) {
    var r = el.getBoundingClientRect();
    css(box, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    tag.textContent = short(el) + "  " + Math.round(r.width) + " × " + Math.round(r.height);
    var ty = r.top - 22 >= 2 ? r.top - 22 : Math.min(r.bottom + 4, innerHeight - 22);
    css(tag, { left: Math.max(2, Math.min(r.left, innerWidth - tag.offsetWidth - 2)) + "px", top: ty + "px" });
  };
  var at = function (e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    return el && !el.hasAttribute("data-veo") && el !== document.documentElement ? el : null;
  };
  var move = function (e) {
    var el = at(e);
    if (el && el !== cur) { cur = el; place(el); }
  };
  var eat = function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  };
  var pickClick = function (e) {
    eat(e);
    var el = at(e) || cur;
    if (!el) return;
    var data = info(el);
    pickOff();
    post({ t: "pick", el: data });
  };
  var follow = function () { if (cur) place(cur); };
  var pickOn = function () {
    if (on) return;
    on = true;
    ui();
    document.documentElement.appendChild(box);
    document.documentElement.appendChild(tag);
    cursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "crosshair";
    addEventListener("mousemove", move, true);
    addEventListener("click", pickClick, true);
    ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "contextmenu"].forEach(function (k) { addEventListener(k, eat, true); });
    addEventListener("scroll", follow, true);
  };
  var pickOff = function () {
    if (!on) return;
    on = false;
    cur = null;
    removeEventListener("mousemove", move, true);
    removeEventListener("click", pickClick, true);
    ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "contextmenu"].forEach(function (k) { removeEventListener(k, eat, true); });
    removeEventListener("scroll", follow, true);
    if (box && box.parentNode) box.parentNode.removeChild(box);
    if (tag && tag.parentNode) tag.parentNode.removeChild(tag);
    document.documentElement.style.cursor = cursor;
  };
  addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (on) { eat(e); pickOff(); post({ t: "pick-cancel" }); return; }
    post({ t: "key", key: "Escape" });
  }, true);

  // ------------------------------------------------------------ ler e mexer na página (IA)
  var ACT = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],[contenteditable=""],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])';
  var FIELDS = 'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]),textarea,select,[contenteditable=""],[contenteditable=true]';
  var refs = {}, refN = 0;
  var visible = function (el) {
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };
  var clean = function (s) { return String(s || "").trim().replace(/\s+/g, " "); };
  var nameOf = function (el) {
    var t = el.getAttribute("aria-label") || "";
    var tagName = el.tagName;
    if (!t && (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT")) {
      var lab = null;
      try { lab = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); } catch (e) {}
      var wrap = el.closest("label");
      t = (lab && lab.innerText) || (wrap && wrap.innerText) || el.getAttribute("placeholder") || el.getAttribute("name") || "";
      if (!t && (el.type === "submit" || el.type === "button")) t = el.value;
    }
    if (!t) t = el.innerText || el.getAttribute("title") || el.getAttribute("alt") || "";
    if (!t) {
      var img = el.querySelector && el.querySelector("img[alt],[aria-label]");
      t = img ? img.getAttribute("alt") || img.getAttribute("aria-label") : "";
    }
    return clean(t).slice(0, 80);
  };
  var describe = function (el) {
    var n = nameOf(el);
    return el.tagName.toLowerCase() + (n ? ' "' + n + '"' : el.id ? "#" + el.id : "");
  };
  // o que rola: a página ou, em apps de tela cheia, a caixa com rolagem maior
  var scroller = function () {
    var d = document.scrollingElement || document.documentElement;
    if (d.scrollHeight - d.clientHeight > 4) return d;
    var best = null, most = 0;
    [].forEach.call(document.querySelectorAll("body *"), function (el) {
      var extra = el.scrollHeight - el.clientHeight;
      if (extra > most && el.clientHeight > 80) {
        var o = getComputedStyle(el).overflowY;
        if (o === "auto" || o === "scroll" || o === "overlay") { best = el; most = extra; }
      }
    });
    return best || d;
  };
  var scrollInfo = function () {
    var s = scroller();
    return { y: Math.round(s.scrollTop), max: Math.max(0, Math.round(s.scrollHeight - s.clientHeight)) };
  };
  var read = function (m) {
    refs = {};
    refN = 0;
    var els = [].slice.call(document.querySelectorAll(ACT)).filter(visible).slice(0, 150);
    var list = els.map(function (el) {
      var id = "e" + ++refN;
      refs[id] = el;
      var tg = el.tagName.toLowerCase();
      var o = { ref: id, role: el.getAttribute("role") || (tg === "a" ? "link" : tg === "input" ? el.type || "text" : tg), name: nameOf(el) };
      if (tg === "input" || tg === "textarea" || tg === "select") {
        o.value = el.type === "password" ? (el.value ? "(filled)" : "") : clean(el.value).slice(0, 80);
        if (el.type === "checkbox" || el.type === "radio") o.checked = !!el.checked;
      }
      if (el.disabled) o.disabled = true;
      if (tg === "a") o.href = el.getAttribute("href");
      var r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) o.offscreen = true;
      return o;
    });
    var max = Math.max(500, Math.min(+m.max || 12000, 60000));
    var text = (document.body ? document.body.innerText || "" : "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return { url: location.href, title: document.title || "", text: text.length > max ? text.slice(0, max) + "\n…" : text, chars: text.length, elements: list, scroll: scrollInfo(), vw: innerWidth, vh: innerHeight };
  };
  var find = function (m, fields) {
    if (m.ref) {
      var r = refs[m.ref];
      if (r && r.isConnected) return r;
      throw new Error(r ? "ref " + m.ref + " is gone (the page changed): call browser_read again" : "unknown ref " + m.ref + ": call browser_read first");
    }
    if (m.selector) {
      var s = document.querySelector(m.selector);
      if (!s) throw new Error("nothing matches the selector " + m.selector);
      return s;
    }
    if (m.text) {
      var want = clean(m.text).toLowerCase();
      var pool = [].slice.call(document.querySelectorAll(fields ? FIELDS : ACT)).filter(visible);
      var hit = pool.filter(function (el) { return nameOf(el).toLowerCase() === want; })[0] || pool.filter(function (el) { return nameOf(el).toLowerCase().indexOf(want) >= 0; })[0];
      if (!hit && !fields) {
        // qualquer coisa com esse texto (um cartão clicável sem papel de botão)
        var all = [].slice.call(document.querySelectorAll("body *")).filter(function (el) { return el.children.length === 0 && clean(el.textContent).toLowerCase() === want && visible(el); });
        hit = all[0];
      }
      if (hit) return hit;
      throw new Error("no " + (fields ? "field" : "element") + ' with the text "' + m.text + '"');
    }
    throw new Error("give ref, selector or text");
  };
  var press = function (el) {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    flash(el);
    var r = el.getBoundingClientRect();
    var o = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    try { el.dispatchEvent(new PointerEvent("pointerdown", o)); } catch (e) {}
    el.dispatchEvent(new MouseEvent("mousedown", o));
    try { if (el.focus) el.focus({ preventScroll: true }); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent("pointerup", o)); } catch (e) {}
    el.dispatchEvent(new MouseEvent("mouseup", o));
    el.click();
    return { clicked: describe(el) };
  };
  var setValue = function (el, v) {
    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var d = Object.getOwnPropertyDescriptor(proto, "value");
    // o "set" do próprio navegador: o React percebe a mudança
    if (d && d.set) d.set.call(el, v);
    else el.value = v;
  };
  var typeIn = function (m) {
    var el = find(m, true);
    el.scrollIntoView({ block: "center", inline: "nearest" });
    flash(el);
    try { el.focus({ preventScroll: true }); } catch (e) {}
    var v = String(m.value == null ? "" : m.value);
    if (el.isContentEditable) {
      if (!m.append) document.execCommand("selectAll", false);
      document.execCommand("insertText", false, v);
    } else if (el.tagName === "SELECT") {
      var opt = [].filter.call(el.options, function (o) { return o.value === v || clean(o.text) === clean(v); })[0];
      if (!opt) throw new Error('no option "' + v + '" in this list');
      setValue(el, opt.value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      setValue(el, m.append ? (el.value || "") + v : v);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: v, inputType: "insertText" }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (m.submit) {
      var k = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
      var go = el.dispatchEvent(new KeyboardEvent("keydown", k));
      el.dispatchEvent(new KeyboardEvent("keypress", k));
      el.dispatchEvent(new KeyboardEvent("keyup", k));
      var form = el.form || (el.closest && el.closest("form"));
      if (go && form) {
        if (form.requestSubmit) form.requestSubmit();
        else form.submit();
      }
    }
    return { typed: describe(el) };
  };
  var roll = function (m) {
    if (m.ref || m.selector || m.text) {
      var el = find(m);
      el.scrollIntoView({ block: "center", inline: "nearest" });
      flash(el);
    } else {
      var s = scroller();
      var page = Math.max(100, s.clientHeight * 0.85);
      if (m.to === "top") s.scrollTop = 0;
      else if (m.to === "bottom") s.scrollTop = s.scrollHeight;
      else s.scrollTop += m.to === "up" ? -page : page;
    }
    return scrollInfo();
  };
  var ASK = {
    read: read,
    click: function (m) { return press(find(m)); },
    type: typeIn,
    scroll: roll,
    where: function () { return { url: location.href, title: document.title || "" }; }
  };

  // ------------------------------------------------------------ pedidos do Veocode
  addEventListener("message", function (ev) {
    if (ev.source !== parent || ev.origin !== top) return;
    var m = ev.data;
    if (!m || m.__veo !== 1) return;
    // pergunta com resposta (as ferramentas da IA)
    if (m.id) {
      var res;
      try {
        if (!ASK[m.t]) throw new Error("unknown request " + m.t);
        res = { ok: true, data: ASK[m.t](m) };
      } catch (e) {
        res = { ok: false, error: String((e && e.message) || e) };
      }
      post({ t: "res", id: m.id, ok: res.ok, data: res.data, error: res.error });
      return;
    }
    if (m.t === "ping") hello("ready");
    else if (m.t === "pick") (m.on ? pickOn : pickOff)();
    else if (m.t === "back") history.back();
    else if (m.t === "forward") history.forward();
    else if (m.t === "reload") location.reload();
    else if (m.t === "clear") clearNow().then(function () {
      post({ t: "cleared" });
      location.reload();
    });
  });
})();
