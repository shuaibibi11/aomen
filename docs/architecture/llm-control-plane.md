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

Routing snapshots are immutable revision records containing the active template
and enabled ordered routes. They contain identifiers and public configuration,
but neither plaintext credential values nor ciphertext. Administrator read
models also exclude both plaintext and encrypted credential fields. A narrow
future runtime-only lookup may obtain ciphertext by credential ID before using
the AES-256-GCM service.

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
and key version are required. Audit records use a fixed allowlisted metadata
shape and reject secret-like names or values.

## Future failure boundary

The later runtime slice will attempt enabled routes in priority order and use
the existing BasicPlayerAi fallback when all routes are unavailable. The system
dealer remains independent and is unaffected by LLM routing failures. This
foundation performs no direct provider calls, so it cannot affect either path.
