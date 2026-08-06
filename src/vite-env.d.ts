/// <reference types="vite/client" />

/**
 * `vite/client` types `import.meta.env` with an index signature, so an unknown
 * key would come back as `any` and a typo would compile. Declaring the one
 * variable this app reads makes it `string | undefined` instead — which is why
 * client.ts has to handle it being unset rather than assuming a value.
 */
interface ImportMetaEnv {
  /**
   * Where the mock API lives. `/api` (the default) goes through a proxy that
   * strips the prefix; an absolute origin is called directly. Set per
   * environment in .env.development / .env.production — never in code.
   */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
