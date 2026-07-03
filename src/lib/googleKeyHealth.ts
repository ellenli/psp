// ---------------------------------------------------------------------------
// Shared "is the Google key currently working?" memo (server-side).
//
// A key with billing disabled fails EVERY request; without this memo each
// places/metric call wastes seconds on a doomed Google attempt before falling
// back to OSM, making the whole app feel broken. When Google rejects the key
// we skip Google for a cooldown window, then probe again automatically — so
// enabling billing upgrades the app with no restart.
// ---------------------------------------------------------------------------

const COOLDOWN_MS = 5 * 60 * 1000;

let deadUntil = 0;

/** True while the key recently failed auth/billing — skip Google calls. */
export function googleLooksDead(): boolean {
  return Date.now() < deadUntil;
}

/** Call after an auth/billing rejection (401/403/REQUEST_DENIED). */
export function markGoogleDead(): void {
  deadUntil = Date.now() + COOLDOWN_MS;
}

/** Call after any successful Google response. */
export function markGoogleAlive(): void {
  deadUntil = 0;
}
