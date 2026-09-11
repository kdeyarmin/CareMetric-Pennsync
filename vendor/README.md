# Vendored CareMetric packages

`caremetric-help-sdk-0.4.0.tgz` is the first-party `@caremetric/help-sdk`
package built from `packages/help-sdk` in the private CareMetric Support Hub
repository. It is committed here so PennSync builds are reproducible without a
public registry or an outside help-desk vendor.

Package source revision: `c529172a7e334bda88971b6a54e460246fc4f4a3` in
`kdeyarmin/caremetric-support-hub` (`packages/help-sdk`).

SHA-256:
`d67869a423677d3f1a1c0e867f1e208bfeddef3765dba6406818ce4f28ff7f7a`

The PennSync consumer passes its static route registry as `routeAllowlist`,
required by the 0.4 SDK. Its existing verified-production activation and exact
`VITE_CENTRAL_HELP_ENABLED=false` rollback override are retained. Release tokens
are bounded to the shared contract, and query strings, fragments, identity,
clinical data, and arbitrary help destinations are not forwarded.
