// Permission broker — cross-app, permission-guarded flow of understanding
// (Phase 3 of the toolkit refactor plan).
//
// One *person*, many *apps*. An app is a principal holding a **grant** that
// names exactly what it may read from the person's understanding and whether
// it may contribute insights back. Principles (from the plan §6):
//
//   - Default deny: no grant → nothing leaves. Grants are explicit,
//     revocable, and auditable (every export/import is logged).
//   - Sensitivity classes: the AbilityModel's dimensions are shareable per
//     grant; free-text self-description is its own scope (it's the person's
//     words); raw memories and the episodic log NEVER leave through the
//     broker — only the derived, device-independent model does.
//   - Provenance travels: every exported understanding and imported insight
//     carries { source, sharedAt, grantId }.
//   - Incoming insights are proposals, never silent application ("avoiding
//     judgement"): importInsight routes through the Librarian's existing
//     consent pipeline, so the person accepts/declines/suppresses in the
//     same UI they already know.
//
// Transport is the host's job (local shared store first, per the plan); the
// broker is the pure policy layer both ends run.

// Read scopes an app can be granted. 'ability.*' = every dimension except
// the person's own words; those need the explicit 'ability.freeText'.
export const READ_SCOPES = [
  'ability.supportAreas',
  'ability.text',
  'ability.vision',
  'ability.motion',
  'ability.audio',
  'ability.input',
  'ability.cognition',
  'ability.freeText',
];

const DIMENSION_BY_SCOPE = {
  'ability.supportAreas': 'supportAreas',
  'ability.text': 'text',
  'ability.vision': 'vision',
  'ability.motion': 'motion',
  'ability.audio': 'audio',
  'ability.input': 'input',
  'ability.cognition': 'cognition',
  'ability.freeText': 'freeText',
};

// Who holds a grant, relative to the person: an app acting for the person
// themself, someone in their circle (family, friends, carers), or anyone
// beyond it. The profile's sharing level — 'personal', 'friends', or
// 'anyone' (the diagrams' access-control choices) — is the CEILING: a grant
// whose audience sits above the current level exports nothing until the
// person raises it. Enforced at export time, so lowering the level
// immediately cuts off out-of-level grants without needing to revoke them.
export const AUDIENCES = ['personal', 'friends', 'anyone'];
const AUDIENCE_ORDER = { personal: 0, friends: 1, anyone: 2 };

// Proposal `change` ops an external app is allowed to suggest. `profile-set`
// is deliberately EXCLUDED: it lets a proposal write an arbitrary profile
// path, and even accepted, a malicious path (`__proto__.x`) is a pollution
// vector. Apps contribute understanding as memories/actions, which are
// scoped records — not raw profile mutations.
const ALLOWED_INSIGHT_OPS = new Set(['add-memory', 'add-profile-action']);
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

// Reject any object graph whose keys include prototype-pollution vectors —
// even accepted, these must never reach a path-walking writer. Bounded depth
// so a hostile deeply-nested insight can't hang the check.
function hasUnsafeKeys(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  for (const [k, v] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(k)) return true;
    if (hasUnsafeKeys(v, depth + 1)) return true;
  }
  return false;
}

/**
 * @param {Object} deps
 * @param {() => any} deps.datastore  - lazy Datastore getter (owns mine.grants / mine.shareAudit)
 * @param {any} deps.librarian       - Librarian instance (consent pipeline for imports)
 * @param {import('./ports.js').Clock} [deps.clock]
 */
export function createBroker({ datastore, librarian, clock = { now: () => Date.now() } }) {
  const DS = datastore;

  function newId(prefix) {
    return `${prefix}-${clock.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function audit(entry) {
    await DS().patch('mine.shareAudit', (log) => {
      log.push({ ...entry, t: clock.now() });
      if (log.length > 500) log.splice(0, log.length - 500);
      return log;
    });
  }

  async function requireGrant(grantId) {
    const grants = await DS().get('mine.grants');
    const g = grants.find(x => x.id === grantId);
    if (!g) throw new Error(`Broker: unknown grant "${grantId}"`);
    if (g.revokedAt) throw new Error(`Broker: grant "${grantId}" was revoked`);
    return g;
  }

  return {
    READ_SCOPES,

    async listGrants() {
      return await DS().get('mine.grants');
    },

    /**
     * Create a grant for an app. The USER creates grants (through consent
     * UI); apps request them. Default deny: empty read/write until granted.
     * @param {{ appId: string, appName?: string, read?: string[], write?: boolean,
     *           audience?: 'personal'|'friends'|'anyone' }} req
     */
    async createGrant({ appId, appName = '', read = [], write = false, audience = 'personal' }) {
      if (!appId) throw new Error('Broker: appId required');
      const bad = read.filter(s => !READ_SCOPES.includes(s));
      if (bad.length) throw new Error(`Broker: unknown read scopes: ${bad.join(', ')}`);
      if (!AUDIENCES.includes(audience)) throw new Error(`Broker: unknown audience "${audience}"`);
      const grant = {
        id: newId('grant'),
        appId,
        appName,
        read: [...new Set(read)],
        write: !!write,           // may contribute insights (as proposals)
        audience,                 // who this grant's holder is to the person
        createdAt: clock.now(),
        revokedAt: null,
      };
      await DS().patch('mine.grants', (grants) => { grants.push(grant); return grants; });
      await audit({ kind: 'grant-created', grantId: grant.id, appId, read: grant.read, write: grant.write });
      return grant;
    },

    async revokeGrant(grantId) {
      let found = false;
      await DS().patch('mine.grants', (grants) => {
        const g = grants.find(x => x.id === grantId);
        if (g && !g.revokedAt) { g.revokedAt = clock.now(); found = true; }
        return grants;
      });
      if (found) await audit({ kind: 'grant-revoked', grantId });
      return found;
    },

    /**
     * Export the person's understanding for an app: the AbilityModel
     * filtered to the grant's read scopes. Ungrated dimensions come back as
     * `undefined` — absent, not zeroed, so the consumer can't confuse "no
     * access" with "typical ability". Raw memories/episodic log are not
     * reachable through this API at all.
     */
    async exportUnderstanding(grantId) {
      const g = await requireGrant(grantId);
      // The privacy layer's access-control gate: the profile's sharing level
      // must cover this grant's audience, checked on EVERY export. Fail
      // CLOSED on unrecognized values: an unknown sharing level counts as
      // 'personal' (the most private ceiling) and an unknown audience never
      // passes — a corrupted field must narrow access, not widen it.
      const profile = await librarian.getProfile();
      const sharing = profile?.metaPreferences?.sharing || 'personal';
      const audience = g.audience || 'personal';
      const ceiling = AUDIENCE_ORDER[sharing] ?? 0;
      if ((AUDIENCE_ORDER[audience] ?? Infinity) > ceiling) {
        await audit({ kind: 'export-blocked', grantId: g.id, appId: g.appId, audience, sharing });
        throw new Error(`Broker: profile sharing is "${sharing}" — a "${audience}" grant may not read it`);
      }
      const model = await librarian.getAbilityModel();
      const out = {
        schemaVersion: model.schemaVersion,
        provenance: { source: 'librarian', grantId: g.id, appId: g.appId, sharedAt: clock.now() },
        confidence: {},
      };
      for (const scope of g.read) {
        const dim = DIMENSION_BY_SCOPE[scope];
        out[dim] = structuredClone(model[dim]);
        for (const [path, conf] of Object.entries(model.confidence)) {
          if (path === dim || path.startsWith(dim + '.')) out.confidence[path] = conf;
        }
      }
      await audit({ kind: 'export', grantId: g.id, appId: g.appId, scopes: g.read });
      return out;
    },

    /**
     * An app contributes an insight back (e.g. XR: "FOV measurement suggests
     * larger text"). Requires write permission. NEVER auto-applies: it lands
     * in the Librarian's proposal queue with full provenance, subject to the
     * same suppression/cooldown/weekly-cap gates as internal inferences.
     * @param {string} grantId
     * @param {{ aspect: string, aspectLabel?: string, change: object,
     *           rationale?: string, confidence?: number }} insight
     */
    async importInsight(grantId, insight) {
      const g = await requireGrant(grantId);
      if (!g.write) throw new Error(`Broker: grant "${grantId}" has no write permission`);
      if (!insight?.aspect || !insight?.change) throw new Error('Broker: insight needs aspect + change');
      // Validate the change shape at the trust boundary — an app-supplied
      // change becomes an accepted proposal only through here.
      if (!ALLOWED_INSIGHT_OPS.has(insight.change.op)) {
        throw new Error(`Broker: insight op "${insight.change.op}" not permitted for external apps`);
      }
      if (hasUnsafeKeys(insight.change)) {
        throw new Error('Broker: insight change contains unsafe keys');
      }
      // An action insight becomes, on accept, a task the browser agent RUNS —
      // validate its shape at the trust boundary with the same rigor
      // hasUnsafeKeys gives to key names: real, bounded strings only.
      if (insight.change.op === 'add-profile-action') {
        const a = insight.change.action;
        const types = insight.change.siteTypes;
        if (!a || typeof a.name !== 'string' || !a.name.trim() || a.name.length > 120
            || typeof a.prompt !== 'string' || !a.prompt.trim() || a.prompt.length > 1000) {
          throw new Error('Broker: add-profile-action needs action.name and action.prompt as bounded strings');
        }
        if (!Array.isArray(types) || types.length === 0 || types.length > 5
            || types.some(t => typeof t !== 'string' || !t.trim() || t.length > 40)) {
          throw new Error('Broker: add-profile-action needs siteTypes as a short list of category ids');
        }
      }
      const accepted = await librarian.proposeInsight({
        aspect: insight.aspect,
        aspectLabel: insight.aspectLabel || insight.aspect,
        change: insight.change,
        rationale: insight.rationale || '',
        evidence: [],
      }, { source: g.appId, grantId: g.id, confidence: insight.confidence });
      await audit({ kind: 'import', grantId: g.id, appId: g.appId, aspect: insight.aspect, accepted });
      return { queued: accepted };
    },

    async getAuditLog() {
      return await DS().get('mine.shareAudit');
    },
  };
}
