import type { ProviderAdapter } from "./core/types.js";

/**
 * Built-in adapter auto-registration table.
 *
 * This module is deliberately kept SEPARATE from `src/index.ts` (the `Meridian`
 * class) and is reached only through a dynamic `import("./builtin-adapters.js")`
 * inside `Meridian.initializeProvider`. That isolation matters for bundlers:
 * because the 46 `import()` specifiers below are not part of any module the
 * `Meridian` class statically imports, they never land in the main entry chunk,
 * and a bundle-conscious consumer who configures providers with explicit
 * adapter instances can drop *all* of them by marking this one module external
 * (e.g. esbuild `--external:*builtin-adapters*`) — the auto-registration path is
 * the only thing that references it. See docs/adapters.md.
 *
 * Config-driven zero-config usage (`providers: { stripe: { auth } }`, no adapter
 * import) is unaffected: the dynamic import resolves this table at runtime and
 * lazily loads only the configured providers, on both Node and edge runtimes.
 */

type AdapterLoader = () => Promise<new () => ProviderAdapter>;

// Each entry is a dynamic import so that resolving a provider only pays for the
// providers actually configured, not all built-in adapters. Keep one entry per
// line as `name: loader,` — scripts/list-providers.mjs parses this block with a
// regex to build the CI contract-test matrix.
export const BUILTIN_ADAPTER_LOADERS: Record<string, AdapterLoader> = {
  github: () => import("./providers/crm/github/adapter.js").then((m) => m.GitHubAdapter),
  googlemaps: () =>
    import("./providers/maps/googlemaps/adapter.js").then((m) => m.GoogleMapsAdapter),
  billdesk: () => import("./providers/payments/billdesk/adapter.js").then((m) => m.BilldeskAdapter),
  ccavenue: () => import("./providers/payments/ccavenue/adapter.js").then((m) => m.CcavenueAdapter),
  datadog: () => import("./providers/monitoring/datadog/adapter.js").then((m) => m.DatadogAdapter),
  anthropic: () => import("./providers/ai/anthropic/adapter.js").then((m) => m.AnthropicAdapter),
  openai: () => import("./providers/ai/openai/adapter.js").then((m) => m.OpenAIAdapter),
  stripe: () => import("./providers/payments/stripe/adapter.js").then((m) => m.StripeAdapter),
  razorpay: () => import("./providers/payments/razorpay/adapter.js").then((m) => m.RazorpayAdapter),
  cashfree: () => import("./providers/payments/cashfree/adapter.js").then((m) => m.CashfreeAdapter),
  payu: () => import("./providers/payments/payu/adapter.js").then((m) => m.PayuAdapter),
  juspay: () => import("./providers/payments/juspay/adapter.js").then((m) => m.JuspayAdapter),
  msg91: () => import("./providers/messaging/msg91/adapter.js").then((m) => m.Msg91Adapter),
  exotel: () => import("./providers/messaging/exotel/adapter.js").then((m) => m.ExotelAdapter),
  gupshup: () => import("./providers/messaging/gupshup/adapter.js").then((m) => m.GupshupAdapter),
  setu: () => import("./providers/identity/setu/adapter.js").then((m) => m.SetuAdapter),
  decentro: () => import("./providers/identity/decentro/adapter.js").then((m) => m.DecentroAdapter),
  shiprocket: () =>
    import("./providers/logistics/shiprocket/adapter.js").then((m) => m.ShiprocketAdapter),
  delhivery: () =>
    import("./providers/logistics/delhivery/adapter.js").then((m) => m.DelhiveryAdapter),
  hyperverge: () =>
    import("./providers/identity/hyperverge/adapter.js").then((m) => m.HyperVergeAdapter),
  digio: () => import("./providers/identity/digio/adapter.js").then((m) => m.DigioAdapter),
  karza: () => import("./providers/identity/karza/adapter.js").then((m) => m.KarzaAdapter),
  idfy: () => import("./providers/identity/idfy/adapter.js").then((m) => m.IdfyAdapter),
  cleartax: () => import("./providers/tax/cleartax/adapter.js").then((m) => m.CleartaxAdapter),
  mapmyindia: () =>
    import("./providers/maps/mapmyindia/adapter.js").then((m) => m.MapmyindiaAdapter),
  perfios: () => import("./providers/identity/perfios/adapter.js").then((m) => m.PerfiosAdapter),
  twilio: () => import("./providers/messaging/twilio/adapter.js").then((m) => m.TwilioAdapter),
  sendgrid: () =>
    import("./providers/messaging/sendgrid/adapter.js").then((m) => m.SendgridAdapter),
  sentry: () => import("./providers/monitoring/sentry/adapter.js").then((m) => m.SentryAdapter),
  mailgun: () => import("./providers/messaging/mailgun/adapter.js").then((m) => m.MailgunAdapter),
  vonage: () => import("./providers/messaging/vonage/adapter.js").then((m) => m.VonageAdapter),
  adyen: () => import("./providers/payments/adyen/adapter.js").then((m) => m.AdyenAdapter),
  gemini: () => import("./providers/ai/gemini/adapter.js").then((m) => m.GeminiAdapter),
  auth0: () => import("./providers/identity/auth0/adapter.js").then((m) => m.Auth0Adapter),
  hubspot: () => import("./providers/crm/hubspot/adapter.js").then((m) => m.HubSpotAdapter),
  supabase: () => import("./providers/storage/supabase/adapter.js").then((m) => m.SupabaseAdapter),
  braintree: () =>
    import("./providers/payments/braintree/adapter.js").then((m) => m.BraintreeAdapter),
  phonepe: () => import("./providers/payments/phonepe/adapter.js").then((m) => m.PhonePeAdapter),
  checkout: () => import("./providers/payments/checkout/adapter.js").then((m) => m.CheckoutAdapter),
  cohere: () => import("./providers/ai/cohere/adapter.js").then((m) => m.CohereAdapter),
  klarna: () => import("./providers/payments/klarna/adapter.js").then((m) => m.KlarnaAdapter),
  mistral: () => import("./providers/ai/mistral/adapter.js").then((m) => m.MistralAdapter),
  mollie: () => import("./providers/payments/mollie/adapter.js").then((m) => m.MollieAdapter),
  apollo: () => import("./providers/healthcare/apollo/adapter.js").then((m) => m.ApolloAdapter),
  hunter: () => import("./providers/crm/hunter/adapter.js").then((m) => m.HunterAdapter),
  s3: () => import("./providers/storage/s3/adapter.js").then((m) => m.S3Adapter),
};

/** Provider names with a built-in adapter, without importing any of them. */
export const BUILTIN_ADAPTER_NAMES: readonly string[] = Object.keys(BUILTIN_ADAPTER_LOADERS);

/**
 * Resolve (and instantiate, once) a built-in adapter by provider name. Returns
 * null if there is no built-in adapter for `name`. Instances are memoized in
 * the supplied `cache` so repeated provider initialization reuses them.
 */
export async function getBuiltinAdapter(
  name: string,
  cache: Map<string, ProviderAdapter>,
): Promise<ProviderAdapter | null> {
  if (cache.has(name)) {
    return cache.get(name)!;
  }

  const loadAdapter = BUILTIN_ADAPTER_LOADERS[name];
  if (!loadAdapter) {
    return null;
  }

  const AdapterClass = await loadAdapter();
  const adapter = new AdapterClass();
  cache.set(name, adapter);
  return adapter;
}
