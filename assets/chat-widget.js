// Website chat assistant widget. Include on any page with:
//   <script src="/assets/chat-widget.js" defer></script>
// Talks to /api/chat. The conversation lives in sessionStorage so it
// survives moving between pages, and is cleared when the tab closes.
(function () {
  if (window.__spChat) return;
  window.__spChat = true;

  var KEY = "sp-chat-v1";
  var GREETING = "Hi, I'm the Sapphire Panda assistant. Ask me about buying Australian wine through us, how orders and samples work, or how a vineyard can join.";
  var state = { open: false, busy: false, messages: [] };
  try { var saved = JSON.parse(sessionStorage.getItem(KEY) || "null"); if (saved && Array.isArray(saved.messages)) state.messages = saved.messages.slice(-30); } catch (e) {}
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify({ messages: state.messages.slice(-30) })); } catch (e) {} }

  var css = "" +
    ".spc-btn{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:900;display:flex;align-items:center;gap:8px;padding:11px 16px;border-radius:999px;border:1px solid #3a6ede;background:#0f1a3d;color:#f4f5fa;font:500 14px/1 Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.45)}" +
    ".spc-btn:hover{background:#16245a}.spc-btn:focus-visible{outline:2px solid #a6c4ff;outline-offset:3px}" +
    ".spc-btn svg{width:18px;height:18px;flex:none}" +
    ".spc-panel{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:901;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 40px));display:flex;flex-direction:column;background:#0e1324;border:1px solid #212c4a;border-radius:6px;box-shadow:0 18px 60px rgba(0,0,0,.55);color:#f4f5fa;font:400 14.5px/1.5 Inter,system-ui,sans-serif;overflow:hidden}" +
    ".spc-panel[hidden]{display:none}" +
    ".spc-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid #212c4a;background:#0a0e1c}" +
    ".spc-title{font:400 17px/1.2 Fraunces,Georgia,serif}.spc-sub{font-size:12px;color:#7c85a6}" +
    ".spc-x{background:none;border:1px solid #212c4a;color:#b3bad2;border-radius:4px;padding:4px 9px;cursor:pointer;font:inherit;font-size:13px}.spc-x:hover{color:#f4f5fa}.spc-x:focus-visible{outline:2px solid #a6c4ff}" +
    ".spc-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}" +
    ".spc-m{max-width:86%;padding:9px 12px;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere}" +
    ".spc-m.a{align-self:flex-start;background:#121a30;border:1px solid #212c4a}" +
    ".spc-m.u{align-self:flex-end;background:#3a6ede;color:#fff}" +
    ".spc-m a{color:#a6c4ff}.spc-m.u a{color:#fff}" +
    ".spc-m.err{background:transparent;border:1px dashed #7c85a6;color:#b3bad2}" +
    ".spc-typing{align-self:flex-start;color:#7c85a6;font-size:13px}" +
    ".spc-form{display:flex;gap:8px;padding:10px;border-top:1px solid #212c4a;background:#0a0e1c}" +
    ".spc-in{flex:1;min-width:0;resize:none;max-height:120px;background:#060810;color:#f4f5fa;border:1px solid #212c4a;border-radius:4px;padding:9px 10px;font:inherit;font-size:16px}" +
    ".spc-in:focus{outline:none;border-color:#6f93e8}" +
    ".spc-send{background:#3a6ede;color:#fff;border:0;border-radius:4px;padding:0 14px;font:inherit;font-weight:600;cursor:pointer}.spc-send:disabled{opacity:.5;cursor:default}.spc-send:focus-visible{outline:2px solid #a6c4ff;outline-offset:2px}" +
    ".spc-foot{font-size:11.5px;color:#7c85a6;padding:0 12px 10px;background:#0a0e1c}" +
    "@media (max-width:480px){.spc-panel{right:0;left:0;bottom:0;width:100%;height:calc(100% - 40px);border-radius:10px 10px 0 0}.spc-btn{right:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px))}}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var btn = document.createElement("button");
  btn.className = "spc-btn"; btn.type = "button"; btn.setAttribute("aria-haspopup", "dialog");
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg><span>Ask a question</span>';

  var panel = document.createElement("section");
  panel.className = "spc-panel"; panel.hidden = true;
  panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Chat with the Sapphire Panda assistant");
  panel.innerHTML =
    '<div class="spc-head"><div><div class="spc-title">Ask Sapphire Panda</div><div class="spc-sub">AI assistant · the team follows up on anything it can\'t answer</div></div><button type="button" class="spc-x">Close</button></div>' +
    '<div class="spc-log" aria-live="polite"></div>' +
    '<form class="spc-form"><label class="spc-sr" for="spc-in" style="position:absolute;left:-9999px">Your message</label><textarea id="spc-in" class="spc-in" rows="1" maxlength="1000" placeholder="Type your question"></textarea><button class="spc-send" type="submit">Send</button></form>' +
    '<div class="spc-foot">Answers are AI-generated and can be wrong. Please don\'t share sensitive details.</div>';

  document.body.appendChild(btn); document.body.appendChild(panel);
  var log = panel.querySelector(".spc-log"), form = panel.querySelector(".spc-form"), input = panel.querySelector(".spc-in"), send = panel.querySelector(".spc-send");

  function linkify(text) {
    var div = document.createElement("div"); div.textContent = text;
    var safe = div.innerHTML;
    return safe
      .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])(\/(?:match|vineyards|contact|faq|privacy|terms))(?=[\s.,;:!?)]|$)/g, '$1<a href="$2">$2</a>');
  }
  function bubble(role, text, cls) {
    var el = document.createElement("div");
    el.className = "spc-m " + (role === "user" ? "u" : "a") + (cls ? " " + cls : "");
    el.innerHTML = linkify(text);
    log.appendChild(el);
  }
  function render() {
    log.innerHTML = "";
    bubble("assistant", GREETING);
    state.messages.forEach(function (m) { bubble(m.role, m.content); });
    if (state.busy) { var t = document.createElement("div"); t.className = "spc-typing"; t.textContent = "Typing…"; log.appendChild(t); }
    log.scrollTop = log.scrollHeight;
    send.disabled = state.busy;
  }
  function open() { state.open = true; panel.hidden = false; btn.hidden = true; render(); input.focus(); }
  function close() { state.open = false; panel.hidden = true; btn.hidden = false; btn.focus(); }

  btn.addEventListener("click", open);
  panel.querySelector(".spc-x").addEventListener("click", close);
  panel.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true })); } });
  input.addEventListener("input", function () { input.style.height = "auto"; input.style.height = Math.min(120, input.scrollHeight) + "px"; });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || state.busy) return;
    input.value = ""; input.style.height = "auto";
    state.messages.push({ role: "user", content: text });
    state.busy = true; save(); render();
    fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: state.messages.slice(-16) }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (res) {
        state.busy = false;
        if (res.ok && res.j.reply) { state.messages.push({ role: "assistant", content: res.j.reply }); save(); render(); }
        else {
          state.messages.pop(); render();
          var msg = res.status === 429 ? "You've sent a lot of messages. Please wait a few minutes and try again." : "The assistant isn't available right now. You can reach the team on the contact page: /contact";
          bubble("assistant", msg, "err"); input.value = text;
        }
      })
      .catch(function () {
        state.busy = false; state.messages.pop(); render();
        bubble("assistant", "Couldn't connect. Check your connection and try again, or use /contact", "err"); input.value = text;
      });
  });
})();
