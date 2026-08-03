# LLM Control Plane Foundation

## Scope

This slice supplies durable domain and persistence primitives for a future
multi-provider LLM routing runtime. It does not call a provider, decrypt a
credential for a request, connect to a live Room, add an administrator HTTP UI,
or add a REST API.

The active `AI_MODE=llm` behavior is still the legacy environment-configured,
single-provider decision path. `LLM_CONTROL_PLANE_MODE=disabled` is the default,
and enabling the PostgreSQL foundation alone does not change game behavior.

## Model and trust boundaries

The `player_bet` route scope is the sole supported scope. A route is the only
failover ordering source of truth: enabled routes are read in ascending
priority. Each route must consistently bind one enabled provider, endpoint,
credential, and model. Models and credentials are bound to the same endpoint
and provider as their route.

Prompt templates are keyed to `player_bet`, versioned, checksum protected, and
immutable after draft creation. Activation creates a routing revision and only
one template version can be active for a key. The renderer accepts only
`publicStateJson` and `styleInstructions`; future code owns the separate strict
JSON response contract.

Routing snapshots are deeply immutable internal runtime records. Every enabled
route carries copied execution values: provider kind, canonical endpoint URL,
upstream model name, credential ID and key version, timeout limits, and route
ordering. The active template is likewise copied as its immutable version,
checksum, and content. Snapshots contain neither plaintext credential values
nor ciphertext. A future request must use those captured values rather than
querying mutable provider, endpoint, or model rows while building a request.
The sole narrow future runtime-only lookup may obtain ciphertext by the
snapshot's credential ID before using the AES-256-GCM service; it is not an
administrator read model.

`llm_routing_revisions` has exactly one current row per scope and starts with
the `player_bet` baseline at revision `0`. `llm_routing_snapshots` retains the
immutable snapshot for every revision, including an empty revision-zero
snapshot with `activeTemplate: null`. An effective mutation locks that scope
row with `SELECT ... FOR UPDATE`, compares `expectedRevision`, applies the
resource or route change, increments the current revision, stores the copied
snapshot, and inserts its audit record in one database transaction. A stale
revision and any surviving PostgreSQL unique-race path become
`LlmRoutingRevisionConflictError`.

Creating an unreferenced provider, endpoint, model, credential, or draft
template does not advance a routing revision. Once a resource can affect a
route, all provider, endpoint, model, credential-enabled, route, and template
activation changes must go through `LlmControlPlaneService` with an
`expectedRevision` and `MutationAuditContext`. Resource relationship bindings
are validated and immutable: a route must bind a compatible enabled provider,
endpoint, credential, and model. Credential material is never updated in
place: rotation creates a new credential ID/key version, then a revisioned
route switch starts using it. This prevents a request that already captured a
snapshot from observing a changed key version.

## Endpoint and secret controls

Configured endpoints must be canonical HTTPS URLs with no userinfo, IP literal,
query, fragment, or non-default port. The hostname must exactly match the
operator-provided `LLM_ENDPOINT_ALLOWED_HOSTS` DNS allowlist; the documented
safe defaults are for known upstreams only. Wildcards and internal-style names
are rejected.

This policy prevents arbitrary configured endpoints, but it does not make DNS
rebinding safe. Production must add an egress firewall or proxy that enforces
the expected upstream network boundary after DNS resolution. No generic DNS
check is claimed as a rebinding defense.

Credential writes encrypt an API key immediately with AES-256-GCM. A 32-byte
base64url master key, 12-byte nonce, and AAD binding credential ID, provider ID,
and key version are required. Every effective mutation writes its audit record
inside the same transaction as its data, revision, and snapshot; no optional
later append can omit it. Metadata has a fixed allowlisted shape, rejects
secret-like names or values, and audit queries select no credential cipher or
secret fields. PostgreSQL `BIGINT` revisions are accepted only when they fit a
JavaScript safe integer before they enter the domain model.

## Future failure boundary

The later runtime slice will attempt enabled routes in priority order and use
the existing BasicPlayerAi fallback when all routes are unavailable. The system
dealer remains independent and is unaffected by LLM routing failures. This
foundation performs no direct provider calls, so it cannot affect either path.
