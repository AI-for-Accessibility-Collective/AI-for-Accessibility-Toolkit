// Local shared-store transport (Phase 3, increment 5) — §6 transport (a):
// same device, multiple apps, zero accounts. A host that has some store all
// co-located apps can reach (a shared file, an app-group container, a native
// bridge) wraps it in the tiny `shared` surface below; the toolkit PUBLISHES
// granted AbilityModel exports onto it and DRAINS an inbox of insights posted
// by consumer apps.
//
// The permission semantics live entirely in the Librarian — this module never
// bypasses them:
//   - publishExports() writes ONLY what exportAbilityModel() returns, so
//     default-deny / scope-filtering / sharingPaused apply unchanged, and a
//     revoked or paused app's envelope is DELETED on the next publish (the
//     shared copy is retracted, not just no longer refreshed).
//   - drainInbox() feeds each posted insight through importInsight(), so a
//     write is still a grant-gated, whitelisted, never-silent proposal.
//
// Prototype scope: plain JSON envelopes, no signing/encryption (see plan §6
// [product-hardening]). Consumer apps are first-party.

/**
 * @typedef {Object} SharedStore
 * Minimal surface for the device-shared area.
 * @property {(key: string) => Promise<any>} get     undefined when absent.
 * @property {(key: string, value: any) => Promise<void>} set
 * @property {(key: string) => Promise<void>} [remove]  optional; set(key, undefined) is the fallback.
 */

export const EXPORT_PREFIX = 'aa.shared.export.'; // + appId
export const INBOX_KEY = 'aa.shared.inbox';
export const ENVELOPE_VERSION = 1;

async function removeKey(shared, key) {
  if (typeof shared.remove === 'function') await shared.remove(key);
  else await shared.set(key, undefined);
}

/**
 * @param {Object} deps
 * @param {SharedStore} deps.shared  The host-provided device-shared store.
 * @param {{now: () => number}} deps.clock
 */
export function createSharedTransport({ shared, clock }) {
  if (!shared) throw new Error('createSharedTransport: shared store is required');
  if (!clock) throw new Error('createSharedTransport: clock is required');

  return {
    // ---- toolkit (user's device) side ----

    // Refresh the shared copies: one envelope per app that currently passes
    // exportAbilityModel (active grant + sharing not paused); every other
    // app's envelope is deleted. `appIds` is the set to reconcile — pass the
    // union of currently-granted apps and any previously published ones so
    // revocations retract.
    async publishExports(librarian, appIds = null) {
      const grants = await librarian.listGrants();
      const ids = new Set([...(appIds || []), ...grants.map(g => g.appId)]);
      const published = [], retracted = [];
      for (const appId of ids) {
        const res = await librarian.exportAbilityModel(appId);
        const key = EXPORT_PREFIX + appId;
        if (res.ok) {
          await shared.set(key, {
            v: ENVELOPE_VERSION, appId, exportedAt: clock.now(), abilityModel: res.abilityModel,
          });
          published.push(appId);
        } else {
          await removeKey(shared, key); // revoked / paused → retract the shared copy
          retracted.push(appId);
        }
      }
      return { published, retracted };
    },

    // Feed every posted insight through the Librarian's grant-gated,
    // never-silent import. Malformed entries are dropped; the inbox is
    // cleared regardless (a failed insight is reported, not retried forever).
    async drainInbox(librarian) {
      const inbox = (await shared.get(INBOX_KEY)) || [];
      const results = [];
      for (const entry of inbox) {
        if (!entry || typeof entry.sourceAppId !== 'string' || !entry.insight) {
          results.push({ ok: false, reason: 'malformed' });
          continue;
        }
        results.push({
          sourceAppId: entry.sourceAppId,
          ...(await librarian.importInsight(entry.sourceAppId, entry.insight)),
        });
      }
      await shared.set(INBOX_KEY, []);
      return results;
    },

    // ---- consumer-app side (what XR / ArtInsight call) ----

    async readExport(appId) {
      const env = await shared.get(EXPORT_PREFIX + appId);
      return env && env.v === ENVELOPE_VERSION ? env : null;
    },

    async postInsight(sourceAppId, insight) {
      const inbox = (await shared.get(INBOX_KEY)) || [];
      inbox.push({ v: ENVELOPE_VERSION, sourceAppId, sentAt: clock.now(), insight });
      await shared.set(INBOX_KEY, inbox);
    },
  };
}

export default createSharedTransport;
