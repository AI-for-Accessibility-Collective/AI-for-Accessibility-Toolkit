// The demo overlay: the three verification surfaces, on the page itself.
//
// Widget and checkpoint are the SAME card - same background, border, padding,
// type size, shadow. The difference is behavior, not looks: a widget pauses
// the agent and waits (it has the option buttons, and the page dims behind
// it); a checkpoint fades on its own while the agent keeps going. The log is
// a labeled region that stays silent during the run and surfaces once as the
// end report.
//
// Interaction model (settled 2026-08-23 against David's mockup):
//   - she tabs, she does not have to talk. Focus moves to the widget's first
//     option when it appears; tab or arrows walk the options; Enter picks.
//   - every button label stands alone when tabbed cold, with its consequence
//     in it ("Stanford Inn & Suites. A hotel in Anaheim, 350 miles away").
//   - the type-anything field is last in the tab order, so no list of options
//     is ever exhaustive.
//   - checkpoints announce politely and never steal focus.
//   - bold marks deltas and commitments only, visual channel only - a screen
//     reader does not announce bold, and her emphasis is word order.

const STYLE_ID = 'vd-overlay-style';

const CSS = `
.vd-wrap,.vd-wrap *,.vd-drawer,.vd-drawer *{box-sizing:border-box}
.vd-wrap{position:fixed;top:16px;left:50%;transform:translateX(-50%);
 z-index:2147483646;width:min(460px,calc(100vw - 32px));
 font:14px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,Arial,sans-serif}
.vd-scrim{position:fixed;inset:0;background:rgba(0,0,0,.18);z-index:2147483645}
.vd-card{background:#fff;border:1px solid #e4e4e7;border-radius:12px;
 padding:16px 20px;margin:0 0 10px;color:#09090b;
 box-shadow:0 8px 30px rgba(0,0,0,.12)}
.vd-card p{margin:0}
.vd-card b{font-weight:600;color:#09090b}
.vd-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.vd-do{font:inherit;font-size:13.5px;font-weight:500;line-height:1.35;
 padding:8px 14px;background:#fff;color:#09090b;border:1px solid #e4e4e7;
 border-radius:8px;cursor:pointer;text-align:left;max-width:240px}
.vd-do:hover{background:#f4f4f5}
.vd-do.primary{background:#18181b;color:#fafafa;border-color:#18181b}
.vd-do.primary:hover{background:#27272a}
.vd-do b{font-weight:600;color:inherit}
.vd-do:focus{outline:none;box-shadow:0 0 0 2px #fff,0 0 0 4px #18181b}
.vd-type{margin-top:10px;width:100%;font:inherit;font-size:13.5px;
 padding:8px 12px;border:1px solid #e4e4e7;border-radius:8px;color:#09090b}
.vd-type:focus{outline:none;box-shadow:0 0 0 2px #fff,0 0 0 4px #18181b}
.vd-fade{transition:opacity .4s ease}
.vd-gone{opacity:0}
.vd-sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;
 clip:rect(0 0 0 0);white-space:nowrap}
.vd-drawer{position:fixed;left:50%;transform:translateX(-50%);bottom:20px;
 z-index:2147483646;width:min(430px,calc(100vw - 32px));max-height:64vh;
 overflow:auto;background:#fff;border:1px solid #e4e4e7;border-radius:10px;
 padding:18px 22px 14px;box-shadow:0 12px 40px rgba(0,0,0,.18);
 font:13px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,Arial,sans-serif;
 color:#3f3f46}
.vd-drawer h2{margin:0 0 4px;font-size:12px;font-weight:700;text-align:center;
 letter-spacing:3px;text-transform:uppercase;color:#18181b}
.vd-drawer .vd-rule{border:0;border-top:1px dashed #d4d4d8;margin:8px 0}
.vd-drawer ul{list-style:none;margin:0;padding:0}
.vd-drawer li{border:0;border-bottom:1px dashed #e4e4e7;background:none;
 color:#3f3f46;padding:7px 2px;margin:0}
.vd-drawer li:last-child{border-bottom:0}
.vd-drawer li:focus{outline:none;background:#f4f4f5;border-radius:6px}
.vd-drawer li b{font-weight:700;color:#09090b}
.vd-drawer .vd-kind{display:block;font-size:10px;letter-spacing:1px;
 text-transform:uppercase;color:#a1a1aa;margin-bottom:1px}
@media (prefers-reduced-motion: reduce){.vd-fade{transition:none}}
`;

// Beat text carries **bold** markers for deltas and commitments. Everything
// else is escaped - these strings are ours, but the page they land on is not.
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mark = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const plain = (s) => String(s).replace(/\*\*/g, '');

let uid = 0;

export function createOverlay({ mount = document.body, wordMs = 280, voiced = true, rate = 1.75 } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const wrap = document.createElement('div');
  wrap.className = 'vd-wrap';
  // Invisible to the agent, in every sense it can perceive - the run this
  // surface reports on must not be able to press its own gate.
  wrap.setAttribute('data-bh-ignore', 'true');
  wrap.setAttribute('data-ai4a11y-ui', 'true');
  mount.appendChild(wrap);

  // One polite live region for every checkpoint, so there is a single spoken
  // channel. Writes are QUEUED and paced by line length: winnow, sort and ad
  // can fire in one pass milliseconds apart, and a polite region replaced
  // before the reader settles announces only the last write - she would hear
  // the sort line and never the result count.
  const live = document.createElement('div');
  live.className = 'vd-sr';
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('data-bh-ignore', 'true');
  mount.appendChild(live);
  const sayQueue = [];
  let saying = false;
  let idleResolvers = [];
  let everSpoke = false;
  if (voiced && typeof speechSynthesis !== 'undefined') {
    try { speechSynthesis.getVoices(); } catch { /* warmup only */ }
  }

  // Real audio, not only aria-live. The live region is silent unless a
  // screen reader is running - a demo audience heard NOTHING. The browser's
  // own TTS speaks every line; the live region still gets the text so a
  // real screen reader has parity. When presenting WITH VoiceOver, pass
  // voiced:false to createOverlay so the two never talk over each other.
  function tts(text, { interrupt = false } = {}) {
    if (!voiced || typeof speechSynthesis === 'undefined') {
      return new Promise((r) => setTimeout(r, 700 + text.split(/\s+/).length * wordMs));
    }
    // Chrome's engine has two traps this dodges: speak() right after
    // cancel() silently DROPS the new utterance (lines went missing), and
    // long speech stalls mid-sentence unless resume() nudges it.
    return new Promise((resolve) => {
      let settled = false;
      let started = false;
      let keepalive = null;
      const done = () => {
        if (settled) return;
        settled = true;
        clearInterval(keepalive);
        resolve();
      };
      const attempt = () => {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = rate;
        u.onstart = () => { started = true; everSpoke = true; };
        u.onend = done;
        u.onerror = done;
        speechSynthesis.speak(u);
      };
      const begin = () => {
        attempt();
        // Dropped after a cancel: it never starts. Give it one clean retry.
        setTimeout(() => {
          if (!started && !settled) {
            try { speechSynthesis.cancel(); } catch { /* engine state */ }
            setTimeout(attempt, 90);
          }
        }, 500);
        // Still silent after the retry? Chrome blocks speech until the page
        // has USER ACTIVATION - which on a demo tab first arrives when the
        // AGENT starts typing, 10-20s in. Before any line has ever spoken,
        // arm the retry listeners immediately and wait long enough for that
        // first keystroke instead of dropping the opening line.
        const armKick = () => {
          if (started || settled) return;
          const kick = () => {
            if (started || settled) return;
            try { speechSynthesis.cancel(); } catch { /* engine state */ }
            setTimeout(attempt, 90);
          };
          ['pointerdown', 'keydown'].forEach((ev) =>
            document.addEventListener(ev, kick, { capture: true, once: true }));
        };
        if (!everSpoke) armKick(); else setTimeout(armKick, 2100);
        keepalive = setInterval(() => {
          try { speechSynthesis.resume(); } catch { /* engine state */ }
        }, 4000);
        // The give-up clock: normal length once speech started, a long
        // leash while waiting on activation, never a silent drop before.
        // The long activation leash applies ONLY before speech has ever
        // worked - after that, a line that will not start is the drop bug,
        // and 20 silent seconds per line read as the demo hanging.
        const words = text.split(/\s+/).length;
        const guard = () => setTimeout(() => {
          if (settled) return;
          if (started) { done(); return; }
          setTimeout(() => done(), everSpoke ? 1200 : 60000);
        }, 2000 + words * 380);
        guard();
      };
      if (interrupt && (speechSynthesis.speaking || speechSynthesis.pending)) {
        speechSynthesis.cancel();
        setTimeout(begin, 90);
      } else {
        begin();
      }
    });
  }

  async function announce(text, spoken) {
    sayQueue.push({ text, spoken });
    if (saying) return;
    saying = true;
    while (sayQueue.length) {
      // A dialog owns the voice while it is up. Without this, the dialog's
      // interrupt cancels the queue's current line, the queue reads that as
      // "finished" and starts its NEXT line - two voices at once.
      while (open) await new Promise((r) => setTimeout(r, 400));
      const item = sayQueue.shift();
      live.textContent = '';
      await new Promise((r) => setTimeout(r, 60));
      live.textContent = item.text;
      await tts(item.text);
      await new Promise((r) => setTimeout(r, 80));
      // The line has had its slot - the visual card it mirrors can go now.
      try { item.spoken?.(); } catch { /* visual only */ }
    }
    saying = false;
    idleResolvers.splice(0).forEach((r) => r());
  }
  const queueIdle = () => (saying
    ? new Promise((r) => idleResolvers.push(r)) : Promise.resolve());

  // The log region exists in the accessibility tree for the whole run - her
  // rotor can jump to it any time - but draws nothing until report().
  const drawer = document.createElement('aside');
  drawer.className = 'vd-sr';
  drawer.setAttribute('role', 'region');
  drawer.setAttribute('aria-label', 'Agent log');
  drawer.setAttribute('data-bh-ignore', 'true');
  drawer.innerHTML = '<h2>Agent log</h2><ul></ul>';
  mount.appendChild(drawer);
  const entries = [];
  const fading = new Set();

  function checkpoint(beat, { ttl = 2500 } = {}) {
    const card = document.createElement('div');
    card.className = 'vd-card vd-fade';
    // The live region is the one spoken channel; the card is its visual
    // mirror, so it is hidden from the tree to avoid a double announcement.
    card.setAttribute('aria-hidden', 'true');
    card.innerHTML = `<p>${mark(beat.say)}</p>`;
    wrap.appendChild(card);
    fading.add(card);
    // The card fades a beat AFTER its line's speech slot ends, so what is
    // on screen and what is being said stay in step however deep the queue.
    announce(plain(beat.say), () => setTimeout(() => {
      card.classList.add('vd-gone');
      setTimeout(() => { card.remove(); fading.delete(card); }, 450);
    }, ttl));
    return { dismiss: () => { card.remove(); fading.delete(card); } };
  }

  let open = null;   // { id, card, scrim, close } while a dialog is up
  const preDismissed = new Set();

  async function widget(beat) {
    // The dialog waits for the checkpoint queue to finish speaking - a
    // dialog that takes focus mid-line talks over the context she needs for
    // this very question, and the leftover lines then arrive as stale
    // interjections inside the dialog. Capped well above the longest real
    // queue (winnow+sort+ad is ~13s), because a cap that cuts the last line
    // off recreates the exact overlap this wait exists to prevent.
    await Promise.race([queueIdle(), new Promise((r) => setTimeout(r, 20000))]);
    // Answered from another tab while waiting? Never open at all.
    if (preDismissed.delete(beat.id)) return { beat: beat.id, dismissed: true };
    return new Promise((resolve) => {
      // A widget takes the stage alone. Any checkpoint still fading out goes
      // now - it was already spoken, and nothing competes with a pause.
      for (const c of fading) c.remove();
      fading.clear();
      const before = document.activeElement;
      const scrim = document.createElement('div');
      scrim.className = 'vd-scrim';
      scrim.setAttribute('data-bh-ignore', 'true');
      mount.appendChild(scrim);

      const id = `vd-msg-${++uid}`;
      const card = document.createElement('div');
      card.className = 'vd-card';
      card.setAttribute('role', 'alertdialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-labelledby', id);
      card.innerHTML = `<p id="${id}">${mark(beat.say)}</p>`;

      const row = document.createElement('div');
      row.className = 'vd-row';
      const nOpts = (beat.options || []).length;
      // She must know where she is in the list: "1 of 5" like a real screen
      // reader. The group carries the count for AT; the buttons carry their
      // position; the focus speech says both out loud.
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', `${nOpts} choices`);
      (beat.options || []).forEach((o, i) => {
        const b = document.createElement('button');
        b.className = o.primary ? 'vd-do primary' : 'vd-do';
        b.innerHTML = mark(o.label);
        b.setAttribute('aria-posinset', String(i + 1));
        b.setAttribute('aria-setsize', String(nOpts));
        b.addEventListener('click', () => done({ choice: plain(o.label) }));
        row.appendChild(b);
      });
      card.appendChild(row);

      // Last in the tab order on purpose: the buttons are never the whole
      // answer space, and this field is how anything unlisted gets said.
      const input = document.createElement('input');
      input.className = 'vd-type';
      input.type = 'text';
      input.setAttribute('aria-label', 'Or tell me something else');
      input.placeholder = 'Or tell me something else';
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) done({ typed: input.value.trim() });
      });
      card.appendChild(input);
      wrap.appendChild(card);

      const stops = () => [...row.querySelectorAll('button'), input];

      // Tab is trapped inside the dialog (it is modal - the agent is held and
      // the page behind is dimmed), and arrows walk the same stops so either
      // habit works. The screen reader speaks each label on landing, which is
      // why the message itself never lists the options.
      card.addEventListener('keydown', (e) => {
        const s = stops();
        const i = s.indexOf(document.activeElement);
        if (e.key === 'Tab') {
          e.preventDefault();
          const n = e.shiftKey ? (i <= 0 ? s.length - 1 : i - 1) : (i + 1) % s.length;
          s[n].focus();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          if (document.activeElement === input) return;
          e.preventDefault();
          s[Math.min(i + 1, s.length - 1)].focus();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          if (document.activeElement === input) return;
          e.preventDefault();
          s[Math.max(i - 1, 0)].focus();
        }
      });

      // The trap must hold even when focus escapes the card: a scrim press
      // or a screen-reader cursor move lands on the page behind, where
      // aria-modal says nothing exists. Recapture instead of trusting the
      // card's own keydown alone.
      const recapture = (e) => {
        if (!card.contains(e.target)) {
          e.preventDefault?.();
          stops()[0]?.focus();
        }
      };
      scrim.addEventListener('mousedown', recapture);
      document.addEventListener('focusin', recapture);

      function done(answer) {
        document.removeEventListener('focusin', recapture);
        open = null;
        card.remove();
        scrim.remove();
        // A navigation may have replaced the element that had focus; a
        // detached element swallows focus() silently, so only restore what
        // is still on the page.
        if (before?.focus && document.contains(before)) before.focus();
        resolve({ beat: beat.id, ...answer });
      }

      // Speak the question, then speak each option as it takes focus -
      // exactly the order a screen reader gives her.
      card.addEventListener('focusin', (e) => {
        const label = e.target?.getAttribute?.('aria-label')
          || e.target?.textContent || '';
        if (!label.trim()) return;
        // Numbered among the OPTIONS only - "5 choices" then "1 of 6"
        // (counting the text field) is the first thing a screen-reader
        // audience catches. The field announces as what it is instead.
        const btns = [...row.querySelectorAll('button')];
        const i = btns.indexOf(e.target);
        const where = i >= 0 ? `. Option ${i + 1} of ${btns.length}.`
          : '. Text field.';
        tts(`${label.trim()}${where}`, { interrupt: true });
      });
      open = { id: beat.id, close: () => done({ dismissed: true }) };
      // Question - breath - "N choices." - breath - first option. Run
      // together they blurred into one stream.
      tts(plain(beat.say), { interrupt: true })
        .then(() => new Promise((r) => setTimeout(r, 550)))
        .then(() => tts(`${nOpts} choices.`))
        .then(() => {
          setTimeout(() => { if (open?.id === beat.id) stops()[0]?.focus(); }, 450);
        });
    });
  }

  /** Close a dialog answered elsewhere (another tab). Resolves the widget
   *  promise with dismissed:true so no second answer is ever sent. */
  function dismissWidget(id) {
    if (open?.id === id) open.close();
    else preDismissed.add(id);
  }

  function addLi(sayText, kindLabel) {
    const li = document.createElement('li');
    li.innerHTML = (kindLabel ? `<span class="vd-kind">${esc(kindLabel)}</span>` : '')
      + mark(sayText);
    li.setAttribute('tabindex', '0');
    li.addEventListener('focus', () => {
      if (muteNextFocusSpeech) { muteNextFocusSpeech = false; return; }
      const all = [...drawer.querySelectorAll('li')];
      const i = all.indexOf(li);
      tts(`${kindLabel ? `${kindLabel}. ` : ''}${plain(sayText)}. Entry ${i + 1} of ${all.length}.`,
        { interrupt: true });
    });
    drawer.querySelector('ul').appendChild(li);
    return li;
  }

  function log(entry) {
    entries.push(entry);
    addLi(entry.say ?? entry);
  }

  let muteNextFocusSpeech = false;
  // Tab and arrows both walk the entries, wrapping - exactly like the
  // widget options, so one keyboard habit covers the whole demo.
  drawer.addEventListener('keydown', (e) => {
    const fwd = e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey);
    const back = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey);
    if (!fwd && !back) return;
    const all = [...drawer.querySelectorAll('li')];
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    all[fwd ? (i + 1) % all.length : (i - 1 + all.length) % all.length].focus();
  });

  // The end report, GUIDED: orient her first (what this is, how to move),
  // read the notes numbered so each is locatable, say when it ends, then
  // park focus on the first note so Tab and arrows take over from there.
  let reported = false;
  // The FULL record: checkpoints, questions with her answers, and the filed
  // notes - receipt-style. The read-through speaks the decisions and notes;
  // the checkpoints are there to tab through, not to hear twice.
  function report(items) {
    drawer.classList.remove('vd-sr');
    drawer.classList.add('vd-drawer');
    if (reported) return;
    reported = true;
    const all = items && items.length
      ? items : entries.map((e) => ({ say: e.say ?? e, kind: 'note', speak: true }));
    const ul = drawer.querySelector('ul');
    ul.innerHTML = '';
    if (!drawer.querySelector('.vd-rule')) {
      drawer.querySelector('h2').insertAdjacentHTML('afterend', '<hr class="vd-rule">');
    }
    for (const it of all) addLi(it.say, it.kind);
    announce(`The run is over. Here is the full log - ${all.length} entries: `
      + 'what the agent said, what it noted, and what you chose. Tab or '
      + 'arrows move through them.');
    all.filter((it) => it.speak).forEach((it) => announce(it.speech || plain(it.say)));
    announce('End of the log.');
    // Focus lands in the log IMMEDIATELY - waiting for the read-through to
    // finish left the keyboard nowhere for half a minute. Tab and arrows
    // work from the first second; touching an entry speaks it, taking
    // priority over the ongoing read-through, exactly like a screen reader.
    const first = drawer.querySelector('li');
    const grab = (n) => {
      if (!first) return;
      muteNextFocusSpeech = true;
      first.focus();
      if (document.activeElement !== first && n > 0) setTimeout(() => grab(n - 1), 400);
    };
    grab(12);
  }

  function destroy() {
    wrap.remove(); live.remove(); drawer.remove();
    document.getElementById(STYLE_ID)?.remove();
  }

  return { widget, checkpoint, log, report, destroy, dismissWidget, entries };
}
