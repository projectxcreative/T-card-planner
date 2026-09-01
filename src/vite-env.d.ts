/// <reference types="vite/client" />

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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
