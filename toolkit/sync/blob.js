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

/** Build the portable blob from a stored profile + its AbilityModel view. */
export function buildProfileBlob(profile, abilityModel, now) {
  const p = profile || {};
  return {
    kind: BLOB_KIND,
    v: BLOB_VERSION,
    exportedAt: now,
    abilityModel: abilityModel || null,
    profile: {
      supportAreas: Array.isArray(p.supportAreas) ? [...p.supportAreas] : [],
      freeText: String(p.freeText || ''),
      fields: p.fields ? JSON.parse(JSON.stringify(p.fields)) : {},
      metaPreferences: { language: (p.metaPreferences && p.metaPreferences.language) || 'standard' },
      updatedAt: p.updatedAt || null,
    },
  };
}

/** True iff `blob` is a structurally valid profile blob this version reads. */
export function validateProfileBlob(blob) {
  return !!(blob
    && blob.kind === BLOB_KIND
    && blob.v === BLOB_VERSION
    && typeof blob.exportedAt === 'number'
    && blob.profile && typeof blob.profile === 'object'
    && Array.isArray(blob.profile.supportAreas));
}

export default buildProfileBlob;
