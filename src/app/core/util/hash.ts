/** SHA-256 hex digest via Web Crypto. Shared by the build pipeline (version
 *  de-duplication) and the docs pipeline (diagram topology stamping).
 *
 *  Requires a secure context — `crypto.subtle` is only present on HTTPS or
 *  `localhost`. On a plain-HTTP LAN IP/hostname it's undefined and this throws
 *  ("Cannot read properties of undefined (reading 'digest')"). Serve admin tools
 *  that hit this (deploy/docs generation) over HTTPS or via localhost. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
