// Upload one or more files to a file-input element by index. Mirrors
// browser_use's upload_file(index, file_path) using CDP DOM.setFileInputFiles,
// which sets files without a real OS file chooser (and without a real
// filesystem in the extension context -- the path is resolved by the
// browser).

import { bhAttach, bhCdp } from '../lifecycle.js';
import { _bhWithStaleRecovery } from './stale-recovery.js';

// Wrapper with stale-recovery.
export async function bhUploadFileIndex(tabId, idx, files, opts = {}) {
  return await _bhWithStaleRecovery(tabId, idx, opts, 'upload_file',
    (i, o) => _bhUploadFileIndexCore(tabId, i, files, o));
}

async function _bhUploadFileIndexCore(tabId, idx, files, _opts) {
  await bhAttach(tabId);
  if (!Number.isInteger(idx) || idx < 0) {
    throw new Error(`upload_file: invalid index ${idx}`);
  }
  const list = Array.isArray(files) ? files.slice() : [files];
  if (!list.length) throw new Error('upload_file: no files supplied');

  // Page-side: validate the element is <input type=file>, capture its
  // backendNodeId via DOM.requestNode after focusing. We need a
  // backendNodeId because DOM.setFileInputFiles doesn't accept an
  // objectId directly.
  const resolveExpr = `
    (() => {
      const arr = window.__bhInteractive;
      if (!Array.isArray(arr) || ${idx} >= arr.length) return { error: 'stale_index' };
      const el = arr[${idx}];
      if (!el) return { error: 'stale_element' };
      if (el.__crossOrigin) {
        return { error: 'wrong_action', hint: 'upload_file does not work in cross-origin iframes (parent JS cannot access them).' };
      }
      if (!el.isConnected) return { error: 'stale_element' };
      const tag = el.tagName;
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (tag !== 'INPUT' || t !== 'file') {
        return { error: 'wrong_action', hint: 'upload_file requires <input type=file>; got <' + tag.toLowerCase() + (t ? ' type=' + t : '') + '>.' };
      }
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
      return { ok: true };
    })()
  `;
  const r0 = await bhCdp(tabId, 'Runtime.evaluate', { expression: resolveExpr, returnByValue: false, includeCommandLineAPI: false }, { timeoutMs: 1500 });
  // We need the actual element's objectId for resolveNode. Re-eval to
  // get a non-by-value reference to the element.
  const refExpr = `window.__bhInteractive && window.__bhInteractive[${idx}]`;
  let objectId;
  try {
    const r = await bhCdp(tabId, 'Runtime.evaluate', { expression: refExpr, returnByValue: false }, { timeoutMs: 1500 });
    objectId = r && r.result && r.result.objectId;
  } catch (e) { throw new Error(`upload_file: ${e.message}`); }
  if (!objectId) throw new Error(`upload_file: ${idx} could not resolve element reference`);
  // Validate page-side first (so wrong-action error messages flow nicely).
  // Re-issue resolveExpr but with returnByValue this time so we see the
  // {ok|error} object.
  const validate = await bhCdp(tabId, 'Runtime.evaluate', { expression: resolveExpr, returnByValue: true }, { timeoutMs: 1500 });
  const vv = validate && validate.result && validate.result.value;
  if (!vv || vv.error) {
    if (vv && vv.error === 'wrong_action') throw new Error(`upload_file: ${vv.hint}`);
    throw new Error(`upload_file: ${idx} ${(vv && vv.error) || 'unknown'} (re-enumerate)`);
  }
  // Resolve the objectId to a backendNodeId.
  let backendNodeId;
  try {
    const r = await bhCdp(tabId, 'DOM.requestNode', { objectId }, { timeoutMs: 1500 });
    // requestNode returns nodeId, not backendNodeId. describeNode does.
    const r2 = await bhCdp(tabId, 'DOM.describeNode', { objectId }, { timeoutMs: 1500 });
    backendNodeId = r2 && r2.node && r2.node.backendNodeId;
  } catch (e) { throw new Error(`upload_file: ${e.message}`); }
  if (!backendNodeId) throw new Error(`upload_file: ${idx} could not resolve backendNodeId`);
  await bhCdp(tabId, 'DOM.setFileInputFiles', { files: list, backendNodeId }, { timeoutMs: 5000 });
  return { indexed: idx, files: list };
}
