/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /**
   * The Application (client) ID of an Entra ID app registration this build
   * ships with, so nobody using the board has to make one of their own.
   *
   * Not a secret. A single-page app is a *public* client: the client id is an
   * identifier, and PKCE — not a shared secret — is what proves the browser
   * asking for tokens is the one that started the sign-in. Baking it into the
   * bundle is the intended use, and it grants nothing on its own.
   */
  readonly VITE_M365_CLIENT_ID?: string;
  /** `common`, `organizations`, or a specific tenant id. Defaults to `common`. */
  readonly VITE_M365_TENANT?: string;
  /**
   * Clerk's publishable key for this instance. Not a secret — same reasoning
   * as `VITE_M365_CLIENT_ID` above: a single-page app is a public client, and
   * this key only identifies which Clerk instance to talk to.
   *
   * Left unset, accounts are off entirely and the board runs exactly as it
   * did before Clerk existed — local storage, plus Access or a BOARD_TOKEN if
   * those are configured on the Worker.
   */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
