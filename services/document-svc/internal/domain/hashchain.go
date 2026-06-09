package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"time"
)

// CanonicalContentHash returns the SHA-256 (hex) of a document body snapshot.
//
// The body is a ProseMirror JSON document (map[string]any). We canonicalize
// by re-marshaling with sorted keys so that semantically identical content
// always hashes identically regardless of Go map iteration order or whitespace
// in the original serialization. This is the EXACT content snapshot bound into
// each signature, so any later edit to the document body changes this hash and
// breaks chain verification.
func CanonicalContentHash(body map[string]any) string {
	canon := canonicalize(body)
	b, _ := json.Marshal(canon)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// ChainHash computes the chained hash for a signing event:
//
//	chained = sha256( prevHash || contentHash || signerID || signedAtRFC3339 || authMethod || typedName )
//
// prevHash is the chained_hash of the previous signed signer in the envelope
// (empty for the first signer). This produces a tamper-evident chain: altering
// any earlier link's inputs invalidates every subsequent chained hash.
func ChainHash(prevHash, contentHash, signerID, signedAt, authMethod, typedName string) string {
	h := sha256.New()
	h.Write([]byte(prevHash))
	h.Write([]byte("|"))
	h.Write([]byte(contentHash))
	h.Write([]byte("|"))
	h.Write([]byte(signerID))
	h.Write([]byte("|"))
	h.Write([]byte(signedAt))
	h.Write([]byte("|"))
	h.Write([]byte(authMethod))
	h.Write([]byte("|"))
	h.Write([]byte(typedName))
	return hex.EncodeToString(h.Sum(nil))
}

// EventChainHash computes the tamper-evident hash for one audit-trail event:
//
//	event_hash = sha256( canonicalJSON({prev, envelope_id, signer_id,
//	                     event_type, actor_id, ip, ua, geo, metadata,
//	                     created_at}) )
//
// prev is the event_hash of the previous hashed event for the envelope
// (empty for the first). created_at MUST be µs-truncated UTC before hashing
// so the value round-trips identically through Postgres timestamptz.
func EventChainHash(prev string, ev SignEvent) string {
	signerID := ""
	if ev.SignerID != nil {
		signerID = ev.SignerID.String()
	}
	actorID := ""
	if ev.ActorID != nil {
		actorID = ev.ActorID.String()
	}
	meta := ev.Metadata
	if meta == nil {
		meta = map[string]any{}
	}
	payload := map[string]any{
		"prev":        prev,
		"envelope_id": ev.EnvelopeID.String(),
		"signer_id":   signerID,
		"event_type":  string(ev.EventType),
		"actor_id":    actorID,
		"ip_address":  ev.IPAddress,
		"user_agent":  ev.UserAgent,
		"geo":         ev.Geo,
		"metadata":    meta,
		"created_at":  ev.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	b, _ := json.Marshal(canonicalize(payload))
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// canonicalize recursively converts maps into ordered representations so that
// JSON marshaling is deterministic. Slices preserve order; maps become sorted
// key/value pairs.
func canonicalize(v any) any {
	switch t := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make([][2]any, 0, len(keys))
		for _, k := range keys {
			out = append(out, [2]any{k, canonicalize(t[k])})
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, e := range t {
			out[i] = canonicalize(e)
		}
		return out
	default:
		return t
	}
}
