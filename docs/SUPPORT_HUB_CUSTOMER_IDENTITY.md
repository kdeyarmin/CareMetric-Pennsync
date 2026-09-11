# Customer support identity proof

The existing `centralAdminRead` named function supports `support.identity.resolve` for an exact native user ID and agency ID. Only its operation-bound Hub SMS authority may request this proof. Existing current native platform-administrator checks remain in force.

The function reads at most two projected rows per requested entity and requires exactly one protected User, an active or trial Agency, and an active server-owned AgencyMembership with the canonical `agency:user` membership key, matching immutable IDs, an allowed tenant role and positive integer membership version. Suspended/revoked/duplicate/missing relationships fail closed. Custom profile fields cannot substitute for membership authority. Additional user `is_active=false` denies access.

Only IDs, account kind, relationship and an opaque evidence revision are returned. No agency join code, user email, clinical data or provider credential is exported. The Hub re-resolves this proof before an explicitly reviewed customer-only grant, with case intake off. This native operation writes nothing and creates no app or Hub account. Deploy only `centralAdminRead` after paired Hub support for the new capability is live.
