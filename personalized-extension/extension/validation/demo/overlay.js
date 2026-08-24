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
.vd-drawer{position:fixed;right:16px;bottom:16px;z-index:2147483646;
 width:min(380px,calc(100vw - 32px));max-height:60vh;overflow:auto;
 background:#fff;border:1px solid #e4e4e7;border-radius:12px;
 padding:14px 16px;box-shadow:0 8px 30px rgba(0,0,0,.12);
 font:13px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,Arial,sans-serif;
 color:#09090b}
.vd-drawer h2{margin:0 0 8px;font-size:11px;font-weight:600;
 letter-spacing:.5px;text-transform:uppercase;color:#71717a}
.vd-drawer ul{list-style:none;margin:0;padding:0}
.vd-drawer li{border:1px dashed #d4d4d8;border-radius:10px;background:#fafafa;
 color:#71717a;padding:8px 12px;margin:0 0 8px}
.vd-drawer li b{font-weight:600;color:#3f3f46}
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
        u.onstart = () => { started = true; };
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
        }, 900);
        // Still silent after the retry? Chrome blocks speech until the page
        // has USER ACTIVATION - the run's first line fires before anyone
        // has touched the page and was silently dropped. Hold the line and
        // speak it on the first pointer or key instead of losing it.
        setTimeout(() => {
          if (started || settled) return;
          const kick = () => {
            if (started || settled) return;
            try { speechSynthesis.cancel(); } catch { /* engine state */ }
            setTimeout(attempt, 90);
          };
          ['pointerdown', 'keydown'].forEach((ev) =>
            document.addEventListener(ev, kick, { capture: true, once: true }));
        }, 2100);
        keepalive = setInterval(() => {
          try { speechSynthesis.resume(); } catch { /* engine state */ }
        }, 4000);
        // The give-up clock: normal length once speech started, a long
        // leash while waiting on activation, never a silent drop before.
        const words = text.split(/\s+/).length;
        const guard = () => setTimeout(() => {
          if (settled) return;
          if (started) { done(); return; }
          setTimeout(() => done(), 20000);
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
      const item = sayQueue.shift();
      live.textContent = '';
      await new Promise((r) => setTimeout(r, 60));
      live.textContent = item.text;
      await tts(item.text);
      await new Promise((r) => setTimeout(r, 120));
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
        const all = stops();
        const i = all.indexOf(e.target);
        const where = i >= 0 ? `. ${i + 1} of ${all.length}` : '';
        tts(`${label.trim()}${where}`, { interrupt: true });
      });
      open = { id: beat.id, close: () => done({ dismissed: true }) };
      // The question speaks in full with the choice count, THEN focus lands
      // (which speaks the first option and its position).
      tts(`${plain(beat.say)} ${nOpts} choices.`, { interrupt: true }).then(() => {
        if (open?.id === beat.id) stops()[0]?.focus();
      });
    });
  }

  /** Close a dialog answered elsewhere (another tab). Resolves the widget
   *  promise with dismissed:true so no second answer is ever sent. */
  function dismissWidget(id) {
    if (open?.id === id) open.close();
    else preDismissed.add(id);
  }

  function log(entry) {
    entries.push(entry);
    const li = document.createElement('li');
    li.innerHTML = mark(entry.say ?? entry);
    // Reachable by Tab, not only by rotor - and each entry speaks when it
    // takes focus, like the widget options do.
    li.setAttribute('tabindex', '0');
    li.addEventListener('focus', () => tts(plain(entry.say ?? entry), { interrupt: true }));
    drawer.querySelector('ul').appendChild(li);
  }

  // The end report: the same region, now drawn - and SPOKEN. Without a
  // screen reader the drawer was a silent box nobody could navigate; the
  // voice reads it through, and Tab walks the entries one by one.
  let reported = false;
  function report() {
    drawer.classList.remove('vd-sr');
    drawer.classList.add('vd-drawer');
    if (reported) return;
    reported = true;
    announce(`The report. ${entries.length} notes.`);
    for (const e of entries) announce(plain(e.say ?? e));
  }

  function destroy() {
    wrap.remove(); live.remove(); drawer.remove();
    document.getElementById(STYLE_ID)?.remove();
  }

  return { widget, checkpoint, log, report, destroy, dismissWidget, entries };
}
