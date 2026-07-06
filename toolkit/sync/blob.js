// User-mediated profile blob (Phase 3, increment 6) — §6 transport (b): a
// portable JSON object the USER deliberately exports on one device/app and
// imports on another (the XR⇄web demo path). Pure build/validate helpers;
// the Librarian owns the actual read/merge (single-writer discipline).
//
// What it carries:
//   - `abilityModel`: the full modality-neutral view — for READER apps
//     (ArtInsight) that only need to consume the understanding.
//   - `profile`: the ability-model SOURCE fields — what importProfileBlob
//     merges on a toolkit device. Deliberately excludes memories, proposals,
//     grants, and every SurfaceProfile (web fontScale etc. stay device-local,
//     so a phone's 200% and a desktop's 120% are never a "conflict").
//
// Merge rule: plain LAST-WRITE-WINS on the whole blob vs the local profile's
// updatedAt (plan §6). No CRDTs, no field-level merge — prototype scope.
//
// Consent posture: exporting is a deliberate user action (the button IS the
// consent), so it is not gated on sharingPaused — that switch governs
// app-to-app flow, not the user moving their own data by hand.

export const BLOB_KIND = 'aa-profile-blob';
export const BLOB_VERSION = 1;

// Only the ability-model SOURCE keys travel — the exact keys toAbilityModel
// reads (core/ability.js), so the blob's minimization matches the model it
// mirrors and no unrelated `fields.*` legacy data can ride along.
const EXPORTED_FIELD_KEYS = ['needs', 'readingLevel', 'confidence'];

/** Build the portable blob from a stored profile + its AbilityModel view. */
export function buildProfileBlob(profile, abilityModel, now) {
  const p = profile || {};
  const srcFields = (p.fields && typeof p.fields === 'object') ? p.fields : {};
  const fields = {};
  for (const k of EXPORTED_FIELD_KEYS) {
    if (k in srcFields) fields[k] = JSON.parse(JSON.stringify(srcFields[k]));
  }
  return {
    kind: BLOB_KIND,
    v: BLOB_VERSION,
    exportedAt: now,
    abilityModel: abilityModel || null,
    profile: {
      supportAreas: Array.isArray(p.supportAreas) ? p.supportAreas.filter(x => typeof x === 'string').slice(0, 20) : [],
      freeText: String(p.freeText || '').slice(0, 2000),
      fields,
      metaPreferences: { language: (p.metaPreferences && p.metaPreferences.language) || 'standard' },
      updatedAt: p.updatedAt || null,
    },
  };
}

/** True iff `blob` is a structurally valid profile blob this version reads.
 *  `exportedAt` MUST be a finite positive number — a NaN/Infinity timestamp
 *  would defeat the last-write-wins guard (all comparisons against NaN are
 *  false; Infinity freezes the device), so it is rejected here. */
export function validateProfileBlob(blob) {
  return !!(blob
    && blob.kind === BLOB_KIND
    && blob.v === BLOB_VERSION
    && Number.isFinite(blob.exportedAt) && blob.exportedAt > 0
    && blob.profile && typeof blob.profile === 'object'
    && Array.isArray(blob.profile.supportAreas));
}

export default buildProfileBlob;
