/**
 * A small, stable, non-cryptographic string hash (djb2), rendered as base36.
 * Used to derive compact disc-identity strings from structural fingerprints
 * (track count + durations) when no proper disc-ID mechanism is available
 * from the underlying tool (e.g. lsdvd, unlike MakeMKV, has none).
 */
export function hashString(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0 // hash*33 + c, kept in 32-bit range
  }
  // >>> 0 turns the signed 32-bit result into an unsigned value before
  // base36 encoding, so the output never contains a leading minus sign.
  return (hash >>> 0).toString(36)
}
