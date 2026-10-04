/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The Azure app (client) id used for Microsoft sign-in, set at build time. */
  readonly MAIN_VITE_MSA_CLIENT_ID?: string
}
