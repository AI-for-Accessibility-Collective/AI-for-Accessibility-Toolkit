(() => {
  // extension/validation/ask.js
  var OPENERS = /^\s*(?:can you |could you |please |i(?:'m| am)? ?(?:looking for|need|want|'d like)|find(?: me)?|get(?: me)?|buy(?: me)?|order(?: me)?|search for|shop for|help me (?:find|buy|get)|look for)\b[:,]?\s*/i;
  var PACKAGING = /^\s*(?:an?|the|some)?\s*(?:pair|set|couple|bunch)\s+of\s+/i;
  var LEAD_ARTICLE = /^\s*(?:an?|the|some)\s+/i;
  var TAIL_FOR = /\s+for\s+(?:my|our|her|his|their|the|a|an)?\s*[\w' ]{1,24}$/i;
  var BUDGET = [
    /\bunder\s*\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
    /\bbelow\s*\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
    /\bless than\s*\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
    /\bno more than\s*\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
    /\bnothing over\s*\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
    /\bat most\s*\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
    /\bmax(?:imum)?\s*(?:of\s*)?\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
    /\bbudget(?:\s+is)?\s*\$?\s*(\d[\d,]*(?:\.\d\d)?)/i,
    /\$\s*(\d[\d,]*(?:\.\d\d)?)\s*or less\b/i
  ];
  var SIZE = [
    /\bsize\s*:?\s*(\d+(?:\.\d+)?(?:\s?[a-z]{1,5})?)\b/i,
    /\bsize\s*:?\s*(x{0,2}(?:small|medium|large)|s|m|l|xl|xxl)\b/i,
    /\b(\d+(?:\.\d+)?)\s+in\s+(?:kids?|women'?s?|men'?s?)\b/i
  ];
  var DEADLINE = [
    /\bby\s+(today|tomorrow|tonight|mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thur?s?(?:day)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i,
    /\b(today|tomorrow|tonight)\b/i,
    /\bbefore\s+(mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thur?s?(?:day)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i,
    /\bin\s+(\d+\s+days?)\b/i,
    /\bby\s+the\s+(\d+(?:st|nd|rd|th))\b/i
  ];
  var QUANTITY = [
    /\b(\d+)\s*(?:pairs?|packs?|boxes|units?|of them)\b/i,
    /\bqty\s*:?\s*(\d+)\b/i,
    /\b(two|three|four|five|six)\s+(?:pairs?|packs?|of them)\b/i
  ];
  var WORD_NUM = { two: 2, three: 3, four: 4, five: 5, six: 6 };
  var SPLIT_CLAUSE = /\s*(?:,|\band\b|\bwith\b|\bthat has\b|\bthat's\b|\bplus\b)\s*/i;
  var first = (patterns, text) => {
    for (const re of patterns) {
      const m = text.match(re);
      if (m) return { value: m[1], matched: m[0] };
    }
    return null;
  };
  var tidy = (s) => String(s || "").replace(/\s+/g, " ").replace(/^[\s,;.]+|[\s,;.]+$/g, "");
  function contractFromAsk(text) {
    const said = String(text || "");
    let rest = said;
    const budget = first(BUDGET, rest);
    if (budget) rest = rest.replace(budget.matched, " ");
    const size = first(SIZE, rest);
    if (size) rest = rest.replace(size.matched, " ");
    const qty = first(QUANTITY, rest);
    if (qty) rest = rest.replace(qty.matched, " ");
    const by = first(DEADLINE, rest);
    if (by) rest = rest.replace(by.matched, " ");
    rest = tidy(rest.replace(OPENERS, ""));
    const clauses = rest.split(SPLIT_CLAUSE).map(tidy).filter(Boolean);
    const head = clauses.shift() || "";
    const item = tidy(head.replace(PACKAGING, "").replace(LEAD_ARTICLE, "").replace(TAIL_FOR, ""));
    const mustHaves = clauses.map((c) => tidy(c.replace(PACKAGING, ""))).filter((c) => c && !/^for\b/i.test(c) && c.length > 1);
    const q = qty ? WORD_NUM[String(qty.value).toLowerCase()] || parseInt(qty.value, 10) : 1;
    return {
      item: item || tidy(said) || "something",
      mustHaves,
      size: size ? tidy(size.value) : null,
      budget: budget ? `$${String(budget.value).replace(/,/g, "")}` : null,
      quantity: Number.isFinite(q) && q > 0 ? q : 1,
      deadline: by ? tidy(by.value) : null,
      said
    };
  }
  var NEEDS = {
    size: ["the size actually selected on the page", "a size that sold out mid-task"],
    budget: ["whether a price is inside what you said", "shipping pushing the total over"],
    mustHaves: [
      "whether the item really has the features you asked for",
      "a substitution that drops one of them"
    ],
    deadline: ["whether it arrives in time", "a delivery date that slipped past the day"]
  };
  function gaps(c) {
    const out = [];
    if (!c.size) {
      out.push({ field: "size", ask: "What size do you need?", unchecked: NEEDS.size });
    }
    if (!c.budget) {
      out.push({
        field: "budget",
        ask: "What's the most you want to spend?",
        unchecked: NEEDS.budget
      });
    }
    if (!c.mustHaves?.length) {
      out.push({
        field: "mustHaves",
        ask: "Anything it has to have?",
        unchecked: NEEDS.mustHaves
      });
    }
    if (!c.deadline) {
      out.push({
        field: "deadline",
        ask: "When do you need it by?",
        unchecked: NEEDS.deadline
      });
    }
    return out;
  }
  function readAnswer(field, said) {
    const t = tidy(said);
    if (!t) return { value: null, note: null };
    if (field === "budget") {
      const m = t.match(/(\d[\d,]*(?:\.\d\d)?)/);
      if (!m) return { value: null, note: null };
      const v = `$${m[1].replace(/,/g, "")}`;
      return { value: v, note: `I\u2019ll treat ${v} as the ceiling, not a target.` };
    }
    if (field === "size") {
      const parsed = first(SIZE, /\bsize\b/i.test(t) ? t : `size ${t}`);
      const v = parsed ? tidy(parsed.value) : t;
      return { value: v, note: null };
    }
    if (field === "deadline") {
      const parsed = first(DEADLINE, /\b(by|before|in)\b/i.test(t) ? t : `by ${t}`);
      return { value: parsed ? tidy(parsed.value) : t, note: null };
    }
    if (field === "mustHaves") {
      const parts = t.split(/,\s*|\s+and\s+/).map(tidy).filter(Boolean);
      return {
        value: parts,
        note: parts.length > 1 ? `${parts.join(" and ")}. Those are deal-breakers, then.` : `${parts[0]}. That\u2019s a deal-breaker, then.`
      };
    }
    return { value: t, note: null };
  }
  function describe(c) {
    const bits = [c.item];
    if (c.mustHaves?.length) bits.push(c.mustHaves.join(" and "));
    if (c.size) bits.push(`size ${c.size}`);
    if (c.budget) bits.push(`under ${c.budget}`);
    if (c.quantity > 1) bits.push(`${c.quantity} of them`);
    return `${bits.filter(Boolean).join(", ")}.`;
  }
  function interview(c, unlocks = {}) {
    const ASK = {
      mustHaves: "Anything that would make you say no to one?",
      size: "What size?",
      budget: "What\u2019s your ceiling on price?",
      deadline: "When do you need it by?"
    };
    const ORDER = ["mustHaves", "size", "budget", "deadline"];
    return gaps(c).slice().sort((a, b) => ORDER.indexOf(a.field) - ORDER.indexOf(b.field)).map((g) => ({
      field: g.field,
      ask: ASK[g.field] || g.ask,
      unchecked: g.unchecked,
      unlocks: (unlocks[g.field] || []).length,
      examples: (unlocks[g.field] || []).slice(0, 3)
    }));
  }

  // extension/validation/panel.js
  var KEY = "aa.validation";
  function mountValidationPanel(root, { onControl } = {}) {
    root.classList.add("va");
    root.setAttribute("aria-live", "polite");
    root.setAttribute("aria-relevant", "additions text");
    let state = null;
    let draft = null;
    const asList = (v) => Array.isArray(v) ? v : [];
    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    function render() {
      root.textContent = "";
      if (draft) {
        root.append(forming());
        return;
      }
      if (!state || !state.contract) {
        root.append(startForm());
        return;
      }
      const c = state.contract;
      const ask = el("section", "va-ask");
      ask.append(el("h2", null, "What you asked for"));
      ask.append(el("p", null, describe2(c)));
      const edit = el("button", "va-edit", "Change something");
      edit.addEventListener("click", () => onControl?.({ action: "edit-ask" }));
      ask.append(edit);
      root.append(ask);
      for (const g of asList(state.unspecified)) {
        const q = el("section", "va-gap");
        q.append(el("p", "va-text", g.ask));
        q.append(el("p", "va-where", `without it I can't check ${g.unchecked[0]}`));
        const b = el("button", "va-do", "Tell it");
        b.addEventListener("click", () => onControl?.({ action: "fill-gap", field: g.field }));
        q.append(b);
        root.append(q);
      }
      if (state.gate && state.gate.allowed === false) {
        const gate = el("section", "va-gate");
        gate.setAttribute("role", "alertdialog");
        gate.setAttribute("aria-label", "The agent is waiting for you");
        gate.append(el("h2", null, "Waiting for you"));
        gate.append(el("p", null, state.gate.say || "Something needs your decision."));
        const answers = el("div", "va-answers");
        for (const [label, response, primary] of gateChoices(state)) {
          const b = el("button", `va-do${primary ? " primary" : ""}`, label);
          b.addEventListener("click", () => onControl?.({
            action: "answer",
            widget: (state.gate.waitingOn || [])[0],
            response
          }));
          answers.append(b);
        }
        gate.append(answers);
        root.append(gate);
        requestAnimationFrame(() => gate.querySelector(".va-do")?.focus());
      }
      const findings = (state.findings || []).filter((f) => f.level !== "ambient" || f.confirming);
      if (!findings.length) {
        root.append(el("div", "va-empty", "Nothing to flag yet."));
      } else {
        const list = el("ul", "va-list");
        for (const f of findings) {
          const li = el("li", `va-item ${tone(f)}`);
          li.append(el("span", "va-dot"));
          const body = el("div", "va-body");
          body.append(el("p", "va-text", f.say));
          if (f.from) body.append(el("p", "va-where", f.from));
          if (f.control) {
            const b = el("button", "va-do", f.control.label);
            b.addEventListener("click", () => onControl?.(f.control));
            body.append(b);
          }
          li.append(body);
          list.append(li);
        }
        root.append(list);
      }
      const foot = el("div", "va-foot");
      const n = (state.said || []).length;
      foot.append(el(
        "span",
        null,
        `${n} thing${n === 1 ? "" : "s"} said \xB7 ${state.spokenWords || 0} words`
      ));
      const more = el("button", null, "What else did you check?");
      more.addEventListener("click", () => onControl?.({ action: "on-request" }));
      foot.append(more);
      root.append(foot);
    }
    function startForm() {
      const s = el("section", "va-start");
      const id = "va-ask-input";
      const label = el("label", null, "What are you looking for?");
      label.setAttribute("for", id);
      s.append(label);
      const row = el("div", "va-start-row");
      const input = el("input");
      input.id = id;
      input.type = "text";
      input.placeholder = "flat sandals with a back strap, size 5, under $40";
      const go = el("button", "va-do primary", "Start checking");
      const submit = () => {
        const said = input.value.trim();
        if (!said) {
          input.focus();
          return;
        }
        const contract = contractFromAsk(said);
        draft = { contract, queue: interview(contract, state?.unlocks || {}), i: 0, notes: [] };
        render();
      };
      go.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
      row.append(input, go);
      s.append(row);
      s.append(el(
        "p",
        "va-hint",
        "Say it however you like. Anything you leave out, I\u2019ll ask about \u2014 I won\u2019t assume it."
      ));
      return s;
    }
    function forming() {
      const s = el("section", "va-form");
      const q = draft.queue[draft.i];
      if (q) {
        s.append(el("p", "va-form-step", `${draft.i + 1} of ${draft.queue.length}`));
        s.append(el("h2", "va-form-ask", q.ask));
        if (q.unlocks) {
          s.append(el(
            "p",
            "va-form-why",
            `Answering this switches on ${q.unlocks} check${q.unlocks === 1 ? "" : "s"}` + (q.examples?.length ? ` \u2014 ${q.examples.join(", ")}` : "")
          ));
        } else {
          s.append(el("p", "va-form-why", `Without it I can\u2019t check ${q.unchecked[0]}`));
        }
        const row2 = el("div", "va-start-row");
        const input = el("input", "va-form-input");
        input.type = "text";
        input.setAttribute("aria-label", q.ask);
        const next = () => {
          const { value, note } = readAnswer(q.field, input.value);
          if (value != null && value !== "") {
            draft.contract = { ...draft.contract, [q.field]: value };
            if (note) draft.notes = [...draft.notes || [], note];
          }
          draft.i += 1;
          render();
        };
        const go = el("button", "va-do primary", "Next");
        go.addEventListener("click", next);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") next();
        });
        const skip = el("button", "va-do", "Skip");
        skip.addEventListener("click", () => {
          draft.i += 1;
          render();
        });
        row2.append(input, go, skip);
        s.append(row2);
        const last = (draft.notes || [])[draft.notes.length - 1];
        if (last && draft.i > 0) s.append(el("p", "va-form-note", last));
        requestAnimationFrame(() => input.focus());
        return s;
      }
      s.append(el("h2", "va-form-ask", "Sound right?"));
      s.append(el("p", "va-form-back", describe(draft.contract)));
      const promises = el("ul", "va-form-promises");
      for (const line of [
        "I won\u2019t press Buy Now",
        "I won\u2019t place the order \u2014 I\u2019ll bring it to you first",
        "I\u2019ll read facts from the page in its own words"
      ]) {
        promises.append(el("li", null, line));
      }
      s.append(promises);
      const left = interview(draft.contract, state?.unlocks || {});
      if (left.length) {
        s.append(el(
          "p",
          "va-form-why",
          `${left.length} thing${left.length === 1 ? "" : "s"} you skipped, so ${left.map((x) => x.unchecked[0]).join(" and ")} stay${left.length === 1 ? "s" : ""} unchecked.`
        ));
      }
      const row = el("div", "va-start-row");
      const yes = el("button", "va-do primary", "Yes, go");
      yes.addEventListener("click", () => {
        const c = draft.contract;
        draft = null;
        onControl?.({ action: "start", contract: c });
      });
      const back = el("button", "va-do", "Change something");
      back.addEventListener("click", () => {
        draft.i = 0;
        render();
      });
      row.append(yes, back);
      s.append(row);
      return s;
    }
    const tone = (f) => f.confirming ? "ok" : f.level === "stop" ? "stop" : f.level === "aside" ? "note" : "quiet";
    function gateChoices(s) {
      const w = ((s.gate.waitingOn || [])[0] || "").toLowerCase();
      if (/size/.test(w)) {
        return [["Use it anyway", "use it", false], ["Change the size", "change it", true]];
      }
      if (/extra items|cap/.test(w)) {
        return [["Remove the extras", "remove them", true], ["Go ahead", "go ahead", false]];
      }
      if (/land/.test(w)) {
        return [["Try again", "try again", true], ["Stop here", "stop", false]];
      }
      return [["Go on", "go on", true], ["Stop here", "stop", false]];
    }
    function describe2(c) {
      const bits = [c.item];
      if (c.mustHaves?.length) bits.push(c.mustHaves.join(" and "));
      if (c.size) bits.push(`size ${c.size}`);
      if (c.budget) bits.push(`under ${c.budget}`);
      if (c.deadline) bits.push(`by ${c.deadline}`);
      return `${bits.filter(Boolean).join(", ")}.`;
    }
    chrome.storage.local.get(KEY).then((r) => {
      state = r[KEY] || null;
      render();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[KEY]) return;
      state = changes[KEY].newValue;
      render();
    });
    return { render, get state() {
      return state;
    } };
  }

  // extension/sidepanel/src/store.js
  var STATE_KEY = "voiceState";
  var RESUME_HANDLE_KEY = "voiceResumeHandle";
  var _store = {
    connection: "disconnected",
    recording: false,
    speaking: false,
    micActivity: false,
    backgroundMode: false,
    error: null,
    transcript: [],
    // True when chrome.storage holds a session-resumption handle from a
    // prior offscreen instance. Drives the "Resume" vs "Start" button
    // label so the user knows the conversation will pick up where it
    // left off.
    hasResumeHandle: false
  };
  var _listeners = /* @__PURE__ */ new Set();
  function get() {
    return { ..._store, transcript: _store.transcript.slice() };
  }
  function subscribe(fn) {
    _listeners.add(fn);
    try {
      fn(get());
    } catch {
    }
    return () => _listeners.delete(fn);
  }
  function _emit() {
    const snap = get();
    for (const fn of _listeners) {
      try {
        fn(snap);
      } catch {
      }
    }
  }
  async function hydrate() {
    const data = await chrome.storage.local.get([STATE_KEY, RESUME_HANDLE_KEY]);
    const s = data[STATE_KEY];
    _store.hasResumeHandle = !!data[RESUME_HANDLE_KEY];
    if (s) {
      _store.connection = s.connection || "disconnected";
      _store.recording = !!s.recording;
      _store.speaking = !!s.speaking;
      _store.backgroundMode = !!s.backgroundMode;
      _store.error = s.error || null;
      _store.transcript = Array.isArray(s.transcript) ? s.transcript.slice() : [];
    }
    _emit();
  }
  function installListener() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "voiceState" && msg.state) {
        Object.assign(_store, msg.state);
        _emit();
        return;
      }
      if (msg.type === "voiceTranscript" && msg.delta) {
        _appendTranscript(msg.delta);
        _emit();
        return;
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (RESUME_HANDLE_KEY in changes) {
        _store.hasResumeHandle = !!changes[RESUME_HANDLE_KEY].newValue;
        _emit();
      }
      if (STATE_KEY in changes) {
        const s = changes[STATE_KEY].newValue;
        if (s) {
          const differs = s.connection !== _store.connection || !!s.recording !== _store.recording || !!s.speaking !== _store.speaking || !!s.backgroundMode !== _store.backgroundMode || (s.error || null) !== _store.error || Array.isArray(s.transcript) && _transcriptDiffers(s.transcript, _store.transcript);
          _store.connection = s.connection || "disconnected";
          _store.recording = !!s.recording;
          _store.speaking = !!s.speaking;
          _store.backgroundMode = !!s.backgroundMode;
          _store.error = s.error || null;
          if (Array.isArray(s.transcript)) _store.transcript = s.transcript.slice();
          if (differs) _emit();
        }
      }
    });
  }
  function _transcriptDiffers(a, b) {
    if (a.length !== b.length) return true;
    if (!a.length) return false;
    const x = a[a.length - 1], y = b[b.length - 1];
    return x.ts !== y.ts || x.text !== y.text || x.role !== y.role;
  }
  function _appendTranscript({ role, text, finished, details, ts, tool, ok, undoable, actionId }) {
    if (role === "event") {
      _store.transcript.push({
        role,
        text,
        details: Array.isArray(details) ? details : [],
        ts: ts || Date.now()
      });
      return;
    }
    if (role === "action") {
      _store.transcript.push({
        role,
        text,
        tool: tool || null,
        ok: ok !== false,
        undoable: !!undoable,
        actionId: actionId || null,
        ts: ts || Date.now()
      });
      return;
    }
    const last = _store.transcript[_store.transcript.length - 1];
    if (last && last.role === role && last.partial) {
      if (text.startsWith(last.text) && text.length >= last.text.length) {
        last.text = text;
      } else {
        last.text += text;
      }
      if (finished) last.partial = false;
    } else {
      _store.transcript.push({ role, text, ts: ts || Date.now(), partial: !finished });
    }
  }

  // extension/sidepanel/src/ui/transcript.js
  var _openDetails = /* @__PURE__ */ new Set();
  function mountTranscript(rootEl, emptyEl, { onUndo } = {}) {
    function render(snap) {
      const list = snap.transcript || [];
      const last = list[list.length - 1];
      const hasUserPartial = last && last.role === "user" && last.partial;
      const showListening = !!snap.micActivity && !hasUserPartial;
      if (!list.length && !showListening) {
        emptyEl.hidden = false;
        rootEl.innerHTML = "";
        return;
      }
      emptyEl.hidden = true;
      let newestUndoable = null;
      if (snap.connection === "live" && !snap.undoInFlight) {
        for (let i = list.length - 1; i >= 0; i--) {
          const e = list[i];
          if (e.role === "action" && e.undoable && e.ok) {
            newestUndoable = e;
            break;
          }
          if (e.role === "action" && e.tool === "undo_last_change") break;
        }
      }
      const scroller = rootEl.parentElement;
      const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
      const frag = document.createDocumentFragment();
      for (const entry of list) {
        frag.appendChild(_renderEntry(entry, { canUndo: entry === newestUndoable, onUndo }));
      }
      if (showListening) {
        frag.appendChild(_renderListeningPlaceholder());
      }
      rootEl.replaceChildren(frag);
      if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    }
    return { render };
  }
  function _renderListeningPlaceholder() {
    const li = document.createElement("li");
    li.className = "vp-msg vp-msg-user vp-msg-listening";
    const icon = document.createElement("span");
    icon.className = "vp-listening-icon";
    icon.textContent = "\u{1F3A4}";
    const text = document.createElement("span");
    text.textContent = " Listening\u2026";
    li.appendChild(icon);
    li.appendChild(text);
    return li;
  }
  function _renderEntry(entry, opts = {}) {
    if (entry.role === "event") return _renderEventBubble(entry);
    if (entry.role === "action") return _renderActionChip(entry, opts);
    return _renderSpeechBubble(entry);
  }
  function _renderActionChip(entry, { canUndo, onUndo } = {}) {
    const li = document.createElement("li");
    li.className = "vp-msg vp-msg-action" + (entry.ok ? "" : " vp-msg-action-failed");
    const icon = document.createElement("span");
    icon.className = "vp-action-icon";
    icon.textContent = entry.ok ? "\u2713" : "\u26A0";
    icon.setAttribute("aria-hidden", "true");
    li.appendChild(icon);
    const text = document.createElement("span");
    text.className = "vp-action-text";
    text.textContent = entry.text || "(action)";
    li.appendChild(text);
    if (canUndo && typeof onUndo === "function") {
      const btn = document.createElement("button");
      btn.className = "vp-btn vp-undo-btn";
      btn.textContent = "Undo";
      btn.setAttribute("aria-label", `Undo: ${entry.text || "last change"}`);
      btn.addEventListener("click", () => {
        btn.disabled = true;
        onUndo(entry);
      });
      li.appendChild(btn);
    }
    li.appendChild(_timeEl(entry.ts));
    return li;
  }
  function _renderSpeechBubble(entry) {
    const li = document.createElement("li");
    li.className = `vp-msg vp-msg-${entry.role}` + (entry.partial ? " vp-msg-partial" : "");
    li.textContent = entry.text;
    li.appendChild(_timeEl(entry.ts));
    return li;
  }
  function _renderEventBubble(entry) {
    const li = document.createElement("li");
    li.className = "vp-msg vp-msg-event";
    const det = document.createElement("details");
    det.open = _openDetails.has(entry.ts);
    det.addEventListener("toggle", () => {
      if (det.open) _openDetails.add(entry.ts);
      else _openDetails.delete(entry.ts);
    });
    const summary = document.createElement("summary");
    summary.className = "vp-event-summary";
    const icon = document.createElement("span");
    icon.className = "vp-event-icon";
    icon.textContent = "\u{1F310}";
    summary.appendChild(icon);
    const title = document.createElement("span");
    title.className = "vp-event-title";
    title.textContent = entry.text || "(event)";
    summary.appendChild(title);
    det.appendChild(summary);
    if (entry.details && entry.details.length) {
      const ul = document.createElement("ul");
      ul.className = "vp-event-details";
      for (const row of entry.details) {
        const item = document.createElement("li");
        item.className = "vp-event-row";
        const tag = document.createElement("span");
        tag.className = "vp-event-tag";
        tag.textContent = row.action || row.sub || row.kind || "\xB7";
        const txt = document.createElement("span");
        txt.className = "vp-event-text";
        txt.textContent = row.text || "";
        item.appendChild(tag);
        item.appendChild(txt);
        ul.appendChild(item);
      }
      det.appendChild(ul);
    }
    li.appendChild(det);
    li.appendChild(_timeEl(entry.ts));
    return li;
  }
  function _timeEl(ts) {
    const t = document.createElement("span");
    t.className = "vp-msg-time";
    t.textContent = _fmtTime(ts);
    return t;
  }
  function _fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  // extension/sidepanel/src/ui/status.js
  function mountStatus(statusEl, errorEl) {
    function render(snap) {
      statusEl.className = `vp-status ${snap.connection || "disconnected"}`;
      statusEl.textContent = snap.connection || "disconnected";
      if (snap.error) {
        errorEl.hidden = false;
        errorEl.textContent = snap.error;
      } else {
        errorEl.hidden = true;
        errorEl.textContent = "";
      }
    }
    return { render };
  }

  // extension/sidepanel/src/ui/controls.js
  function mountControls({
    startBtn,
    micBtn,
    endBtn,
    restartBtn,
    bgWrapper,
    bgToggle,
    textForm,
    onStart,
    onEnd,
    onRestart,
    onMicToggle,
    onBackgroundChange
  }) {
    startBtn.addEventListener("click", () => onStart());
    endBtn.addEventListener("click", () => onEnd());
    restartBtn.addEventListener("click", () => onRestart());
    micBtn.addEventListener("click", () => onMicToggle());
    bgToggle.addEventListener("change", (e) => onBackgroundChange(!!e.target.checked));
    function render(snap) {
      const live = snap.connection === "live" || snap.connection === "connecting";
      if (textForm) {
        textForm.hidden = snap.connection !== "live";
      }
      const showRestart = live || !live && !!snap.hasResumeHandle;
      startBtn.hidden = live;
      micBtn.hidden = !live;
      endBtn.hidden = !live;
      restartBtn.hidden = !showRestart;
      bgWrapper.hidden = !live;
      const connecting = snap.connection === "connecting";
      restartBtn.disabled = connecting;
      micBtn.disabled = connecting;
      if (live) {
        micBtn.classList.toggle("muted", !snap.recording);
        micBtn.title = snap.recording ? "Mute mic" : "Unmute mic";
        bgToggle.checked = !!snap.backgroundMode;
      }
      if (connecting) {
        startBtn.textContent = snap.hasResumeHandle ? "Resuming\u2026" : "Connecting\u2026";
        startBtn.disabled = true;
      } else {
        startBtn.textContent = snap.hasResumeHandle ? "Resume" : "Start";
        startBtn.disabled = false;
      }
    }
    return { render };
  }

  // extension/sidepanel/src/index.js
  var $ = (id) => document.getElementById(id);
  async function main() {
    chrome.runtime.connect({ name: "voice-ui" });
    await hydrate();
    installListener();
    let undoInFlight = false;
    let undoTimer = null;
    const transcript = mountTranscript($("vp-transcript"), $("vp-empty"), {
      onUndo: async () => {
        if (undoInFlight) return;
        undoInFlight = true;
        transcript.render({ ...get(), undoInFlight });
        if (undoTimer) clearTimeout(undoTimer);
        undoTimer = setTimeout(() => {
          undoInFlight = false;
          transcript.render({ ...get(), undoInFlight });
        }, 8e3);
        await send({ type: "voiceUndoLast" });
      }
    });
    const status = mountStatus($("vp-status"), $("vp-error"));
    const controls = mountControls({
      startBtn: $("vp-start"),
      micBtn: $("vp-mic"),
      endBtn: $("vp-end"),
      restartBtn: $("vp-restart"),
      bgWrapper: $("vp-bg-wrapper"),
      bgToggle: $("vp-bg-toggle"),
      textForm: $("vp-text-form"),
      onStart: handleStart,
      onEnd: handleEnd,
      onRestart: handleRestart,
      onMicToggle: handleMicToggle,
      onBackgroundChange: handleBackgroundChange
    });
    const textForm = $("vp-text-form");
    const textInput = $("vp-text-input");
    textForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = textInput.value.trim();
      if (!text) return;
      textInput.value = "";
      const resp = await send({ type: "voiceTextTurn", text });
      if (resp && resp.error) await _writeError(`Send failed: ${resp.error}`);
    });
    const proposalPill = $("vp-proposals");
    async function refreshProposalPill() {
      const resp = await send({ type: "librarianListProposals", status: "pending" });
      const n = resp && resp.proposals && resp.proposals.length || 0;
      proposalPill.hidden = n === 0;
      proposalPill.textContent = n === 1 ? "1 suggestion" : `${n} suggestions`;
    }
    proposalPill.addEventListener("click", async () => {
      if (get().connection === "live") {
        await send({ type: "voiceTextTurn", text: "What suggestions are waiting for me?" });
      }
    });
    refreshProposalPill();
    setInterval(refreshProposalPill, 6e4);
    const micSettingsBtn = $("vp-open-mic-settings");
    micSettingsBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: "chrome://settings/content/microphone" });
    });
    let _lastMemoryActionId = null;
    let _lastUndoActionId = null;
    subscribe((snap) => {
      const newestAction = [...snap.transcript].reverse().find((e) => e.role === "action");
      if (undoInFlight && newestAction && newestAction.tool === "undo_last_change" && newestAction.actionId !== _lastUndoActionId) {
        _lastUndoActionId = newestAction.actionId;
        undoInFlight = false;
        if (undoTimer) {
          clearTimeout(undoTimer);
          undoTimer = null;
        }
      }
      transcript.render({ ...snap, undoInFlight });
      status.render(snap);
      controls.render(snap);
      const showMic = !!snap.error && /micropho|mic settings/i.test(snap.error);
      micSettingsBtn.hidden = !showMic;
      const memoryTools = /* @__PURE__ */ new Set(["respond_to_proposal", "forget_memory", "remember"]);
      for (let i = snap.transcript.length - 1; i >= 0; i--) {
        const e = snap.transcript[i];
        if (e.role !== "action") continue;
        if (memoryTools.has(e.tool) && e.actionId !== _lastMemoryActionId) {
          _lastMemoryActionId = e.actionId;
          refreshProposalPill();
        }
        break;
      }
    });
  }
  async function handleStart() {
    const micResult = await _ensureMicPermission();
    if (!micResult.granted) {
      await _writeError(micResult.message);
      return;
    }
    const ensureResp = await send({ type: "voiceEnsure" });
    if (ensureResp && ensureResp.error) {
      await _writeError(`Offscreen create failed: ${ensureResp.error}`);
      return;
    }
    const ready = await _waitForOffscreenReady(5e3);
    if (!ready) {
      await _writeError("Voice engine did not start. Try clicking Start again.");
      return;
    }
    const connectResp = await send({ type: "voiceConnect" });
    if (connectResp && connectResp.error) {
      console.error("[sidepanel] voiceConnect failed:", connectResp.error, connectResp.stack || "");
      await _writeError(`Connect failed: ${connectResp.error}`);
    }
  }
  async function _ensureMicPermission() {
    try {
      const perm = await navigator.permissions.query({ name: "microphone" });
      if (perm && perm.state === "granted") return { granted: true };
    } catch {
    }
    const result = await _requestMicViaPopup();
    if (result.granted) return result;
    if (result.errorName === "CancelledByUser") {
      return {
        granted: false,
        message: "Microphone permission window closed. Click Start again to retry."
      };
    }
    let priorDenial = false;
    try {
      const perm = await navigator.permissions.query({ name: "microphone" });
      priorDenial = perm.state === "denied";
    } catch {
    }
    const name = result.errorName || "";
    let message;
    if (priorDenial || name === "NotAllowedError" || name === "SecurityError") {
      message = "Microphone access is blocked for this extension. Open mic settings below, find this extension, set it to Allow, then click Start again.";
    } else if (name === "NotFoundError" || name === "OverconstrainedError") {
      message = "No microphone found. Plug one in and try again.";
    } else if (name === "NotReadableError") {
      message = "Microphone is in use by another app. Close it and try again.";
    } else if (name === "TimeoutError") {
      message = "Permission iframe did not respond. Reload the extension and try again.";
    } else {
      message = `Microphone access failed: ${result.errorMessage || name || "unknown error"}`;
    }
    return { granted: false, message, showSettings: true };
  }
  function _requestMicViaPopup() {
    return new Promise((resolve) => {
      let resolved = false;
      let popupWinId = null;
      const safeResolve = (val) => {
        if (resolved) return;
        resolved = true;
        chrome.runtime.onMessage.removeListener(onMessage);
        chrome.windows.onRemoved.removeListener(onWinClosed);
        clearTimeout(timer);
        resolve(val);
      };
      const onMessage = (msg) => {
        if (!msg || msg.type !== "micPermissionResult") return;
        safeResolve({
          granted: !!msg.granted,
          errorName: msg.errorName,
          errorMessage: msg.errorMessage
        });
      };
      const onWinClosed = (winId) => {
        if (popupWinId != null && winId === popupWinId) {
          safeResolve({ granted: false, errorName: "CancelledByUser" });
        }
      };
      chrome.runtime.onMessage.addListener(onMessage);
      chrome.windows.onRemoved.addListener(onWinClosed);
      chrome.windows.create({
        url: chrome.runtime.getURL("permission/permission.html"),
        type: "popup",
        width: 460,
        height: 280
      }, (win) => {
        if (chrome.runtime.lastError || !win) {
          safeResolve({
            granted: false,
            errorName: "PopupOpenError",
            errorMessage: chrome.runtime.lastError?.message || "could not open permission window"
          });
          return;
        }
        popupWinId = win.id;
      });
      const timer = setTimeout(() => {
        safeResolve({ granted: false, errorName: "TimeoutError" });
      }, 12e4);
    });
  }
  async function _waitForOffscreenReady(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const resp = await send({ type: "voicePing" });
      if (resp && resp.ok) return true;
      await wait(150);
    }
    return false;
  }
  async function _writeError(text) {
    await chrome.storage.local.set({
      voiceState: {
        ...(await chrome.storage.local.get("voiceState")).voiceState,
        connection: "error",
        error: text
      }
    });
  }
  async function handleEnd() {
    await send({ type: "voiceTeardown" });
  }
  async function handleRestart() {
    const snap = get();
    if (snap.connection === "live" || snap.connection === "connecting") {
      await send({ type: "voiceRestart" });
      return;
    }
    const micResult = await _ensureMicPermission();
    if (!micResult.granted) {
      await _writeError(micResult.message);
      return;
    }
    const ensureResp = await send({ type: "voiceEnsure" });
    if (ensureResp && ensureResp.error) {
      await _writeError(`Offscreen create failed: ${ensureResp.error}`);
      return;
    }
    const ready = await _waitForOffscreenReady(5e3);
    if (!ready) {
      await _writeError("Voice engine did not start. Try clicking Restart again.");
      return;
    }
    const restartResp = await send({ type: "voiceRestart" });
    if (restartResp && restartResp.error) {
      console.error("[sidepanel] voiceRestart failed:", restartResp.error, restartResp.stack || "");
      await _writeError(`Restart failed: ${restartResp.error}`);
    }
  }
  async function handleMicToggle() {
    await send({ type: "voiceMicToggle" });
  }
  async function handleBackgroundChange(enabled) {
    await send({ type: "voiceBackgroundMode", enabled });
  }
  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (resp) => {
        const _ = chrome.runtime.lastError;
        resolve(resp || {});
      });
    });
  }
  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  main().catch((e) => {
    console.error("[sidepanel] init failed", e);
  });
  var vaRoot = document.getElementById("va-panel");
  if (vaRoot) {
    mountValidationPanel(vaRoot, {
      onControl: (c) => {
        if (c.action === "start") {
          chrome.runtime.sendMessage({
            type: "validationStart",
            contract: c.contract || c.said,
            alsoRunAgent: !!c.contract
          });
          return;
        }
        if (c.action === "answer") {
          chrome.runtime.sendMessage({
            type: "validationAnswer",
            widget: c.widget,
            response: c.response
          });
          return;
        }
        if (c.action === "on-request") {
          chrome.runtime.sendMessage({ type: "validationOnRequest" }, (r) => {
            for (const i of r?.items || []) console.log("[also checked]", i.say);
          });
          return;
        }
        chrome.runtime.sendMessage({ type: "validationControl", control: c });
      }
    });
  }
})();
