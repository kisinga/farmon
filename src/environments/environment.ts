/**
 * Default (cloud) build flags. The device build swaps this file for
 * `environment.device.ts` via angular.json fileReplacements.
 */
export const environment = {
  /** Device mode: the build that runs from the controller's own flash and talks
   *  to its `/local/*` endpoints — no PocketBase, no auth, no internet. */
  deviceMode: false,
};
