// A non-web, in-memory ControlPort — the reference receiver for tests and demos.
//
// It is deliberately NOT a browser: no DOM, no tab, no zoom. Its whole job is to
// prove the ControlPort contract stays platform-neutral. Any real receiver
// (mobile / desktop / XR / web) implements the same shape over its own
// platform; this one implements it over a plain object.

/**
 * @param {Object} [opts]
 * @param {string} [opts.platform]        Capability tag (default 'mock').
 * @param {string[]} [opts.settingKeys]   Which settingsMeta keys it accepts.
 * @param {string[]} [opts.actions]       Which performAction ids it supports.
 * @param {Object} [opts.content]         { title, outline[], text } readable content, or null.
 * @param {Object<string,*>} [opts.initial]  Pre-set active settings.
 * @returns {import('./control-port.js').ControlPort & { settings: object, focus: string|null }}
 */
export function createMockReceiver({
  platform = 'mock',
  settingKeys = ['fontScale', 'lineHeight', 'speechRate', 'darkMode', 'contrastMode', 'motionReducer', 'hideDistractions', 'dyslexiaFont', 'bigTargets', 'largeCursor', 'readingGuide', 'focusMode'],
  actions = ['scroll'],
  content = { title: 'Demo document', outline: ['Welcome', 'Getting started', 'Details'], text: 'Welcome. This is a demo document with some readable text.' },
  initial = {},
} = {}) {
  const settings = { ...initial };
  const journal = []; // LIFO of { key: previousValueOrUndefined }
  let focus = content ? 'document' : null;

  const capabilities = { platform, settingKeys: [...settingKeys], actions: [...actions], canReadContent: !!content };

  return {
    settings,               // exposed for assertions/demos
    get focus() { return focus; },

    async describeCapabilities() {
      return { ...capabilities, settingKeys: [...capabilities.settingKeys], actions: [...capabilities.actions] };
    },

    async getContext() {
      return { focus, activeSettings: { ...settings }, capabilities: await this.describeCapabilities() };
    },

    async applySettings(changes) {
      const applied = {};
      const previous = {};
      const rejected = [];
      for (const [k, v] of Object.entries(changes || {})) {
        if (!capabilities.settingKeys.includes(k)) { rejected.push(k); continue; }
        previous[k] = k in settings ? settings[k] : undefined;
        settings[k] = v;
        applied[k] = v;
      }
      if (!Object.keys(applied).length) return { error: 'no applicable settings', rejected };
      journal.push(previous);
      return { applied, previous, rejected };
    },

    async undoLast() {
      if (!journal.length) return { error: 'nothing to undo' };
      const previous = journal.pop();
      const reverted = {};
      for (const [k, v] of Object.entries(previous)) {
        if (v === undefined) delete settings[k]; else settings[k] = v;
        reverted[k] = k in settings ? settings[k] : undefined;
      }
      return { reverted, remainingUndos: journal.length };
    },

    async resetUndo() {
      journal.length = 0;
      return { ok: true };
    },

    async getContent(mode = 'outline') {
      if (!content) return { error: 'no readable content' };
      if (mode === 'text') {
        return { source: 'untrusted-content', title: content.title, text: content.text, chunk: 0, totalChunks: 1 };
      }
      return { source: 'untrusted-content', title: content.title, outline: [...(content.outline || [])] };
    },

    async performAction(action, target) {
      if (!capabilities.actions.includes(action)) return { ok: false, detail: `unsupported action: ${action}` };
      focus = target ? `${action}:${target}` : action; // record it so tests can observe the effect
      return { ok: true, detail: `${action}${target ? ' ' + target : ''}` };
    },
  };
}

export default createMockReceiver;
