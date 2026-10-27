import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
  PUBLIC_IMMICH_BUY_HOST: { public: true, static: true },
  PUBLIC_IMMICH_PAY_HOST: { public: true, static: true },
  // Optional; set via the PUBLIC_EXACT_DUPLICATES_URL docker build arg. Unset drops the Utilities link.
  PUBLIC_EXACT_DUPLICATES_URL: { public: true, static: true, schema: (value) => value || undefined },
});
