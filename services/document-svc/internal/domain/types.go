package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

type WorkspaceKind string

const (
	WSKindPM     WorkspaceKind = "pm"
	WSKindBA     WorkspaceKind = "ba"
	WSKindSA     WorkspaceKind = "sa"
	WSKindExpert WorkspaceKind = "expert"
)

var validWSKinds = map[WorkspaceKind]bool{
	WSKindPM: true, WSKindBA: true, WSKindSA: true, WSKindExpert: true,
}

func (k WorkspaceKind) Valid() bool { return validWSKinds[k] }

type Workspace struct {
	ID        uuid.UUID     `json:"id"`
	TenantID  uuid.UUID     `json:"tenant_id"`
	ProjectID uuid.UUID     `json:"project_id"`
	Kind      WorkspaceKind `json:"kind"`
	Name      string        `json:"name"`
	CreatedAt time.Time     `json:"created_at"`
	UpdatedAt time.Time     `json:"updated_at"`
}

type DocumentType string
type DocumentStatus string

const (
	DocDraft    DocumentStatus = "draft"
	DocReview   DocumentStatus = "review"
	DocApproved DocumentStatus = "approved"
	DocArchived DocumentStatus = "archived"
)

var validDocStatuses = map[DocumentStatus]bool{
	DocDraft: true, DocReview: true, DocApproved: true, DocArchived: true,
}

// Valid reports whether s is one of the four lifecycle states. Used to reject
// bogus status values with a 400 instead of letting the DB enum 500.
func (s DocumentStatus) Valid() bool { return validDocStatuses[s] }

var validDocTypes = map[DocumentType]bool{
	"project_charter": true, "status_report": true, "risk_register": true,
	"issue_log": true, "change_request": true, "stakeholder_register": true,
	"brd": true, "frd": true, "user_story": true, "use_case": true,
	"process_flow": true, "rtm": true,
	"sdd": true, "adr": true, "er_diagram": true, "api_spec": true,
	"sequence_diagram": true, "tech_stack": true,
	"knowledge_article": true, "decision_log": true, "qa": true,
	"lesson_learned": true, "expertise_profile": true,
	"note": true,
}

func (t DocumentType) Valid() bool { return validDocTypes[t] }

type Document struct {
	ID               uuid.UUID      `json:"id"`
	TenantID         uuid.UUID      `json:"tenant_id"`
	WorkspaceID      uuid.UUID      `json:"workspace_id"`
	ProjectID        uuid.UUID      `json:"project_id"`
	Type             DocumentType   `json:"type"`
	Title            string         `json:"title"`
	Body             map[string]any `json:"body"`
	Metadata         map[string]any `json:"metadata"`
	Status           DocumentStatus `json:"status"`
	OwnerID          *uuid.UUID     `json:"owner_id"`
	Tags             []string       `json:"tags"`
	CurrentVersionID *uuid.UUID     `json:"current_version_id"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	Version          int            `json:"version"`
}

type DocumentVersion struct {
	ID         uuid.UUID      `json:"id"`
	DocumentID uuid.UUID      `json:"document_id"`
	TenantID   uuid.UUID      `json:"tenant_id"`
	Rev        int            `json:"rev"`
	Title      string         `json:"title"`
	Body       map[string]any `json:"body"`
	Status     DocumentStatus `json:"status"`
	CreatedBy  *uuid.UUID     `json:"created_by"`
	CreatedAt  time.Time      `json:"created_at"`
	Note       string         `json:"note"`
}

type Comment struct {
	ID         uuid.UUID      `json:"id"`
	TenantID   uuid.UUID      `json:"tenant_id"`
	DocumentID uuid.UUID      `json:"document_id"`
	ParentID   *uuid.UUID     `json:"parent_id"`
	AuthorID   *uuid.UUID     `json:"author_id"`
	Body       string         `json:"body"`
	Anchor     map[string]any `json:"anchor"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	ResolvedAt *time.Time     `json:"resolved_at"`
}

type Template struct {
	ID        uuid.UUID      `json:"id"`
	TenantID  uuid.UUID      `json:"tenant_id"`
	Type      DocumentType   `json:"type"`
	Name      string         `json:"name"`
	Body      map[string]any `json:"body"`
	IsSystem  bool           `json:"is_system"`
	CreatedAt time.Time      `json:"created_at"`
}

type SignatureStatus string

const (
	SigPending  SignatureStatus = "pending"
	SigSigned   SignatureStatus = "signed"
	SigDeclined SignatureStatus = "declined"
)

// --- Tier-1 e-signature envelope model -------------------------------------

// EnvelopeStatus is the lifecycle state of a signing envelope.
type EnvelopeStatus string

const (
	EnvDraft     EnvelopeStatus = "draft"
	EnvSent      EnvelopeStatus = "sent"
	EnvCompleted EnvelopeStatus = "completed"
	EnvDeclined  EnvelopeStatus = "declined"
	EnvVoided    EnvelopeStatus = "voided"
	EnvExpired   EnvelopeStatus = "expired"
)

// SigningOrder controls how signer routing advances.
type SigningOrder string

const (
	OrderSequential SigningOrder = "sequential"
	OrderParallel   SigningOrder = "parallel"
)

func (o SigningOrder) Valid() bool { return o == OrderSequential || o == OrderParallel }

// RoutingStatus is the per-signer routing state within an envelope.
type RoutingStatus string

const (
	RouteWaiting   RoutingStatus = "waiting"
	RouteActive    RoutingStatus = "active"
	RouteCompleted RoutingStatus = "completed"
	RouteDeclined  RoutingStatus = "declined"
)

// AuthMethod records how the signer authenticated at signing time.
type AuthMethod string

const (
	AuthSession   AuthMethod = "session"
	AuthEmailOTP  AuthMethod = "email_otp"
	AuthSSO       AuthMethod = "sso"
	AuthTypedName AuthMethod = "typed_name"
)

var validAuthMethods = map[AuthMethod]bool{
	AuthSession: true, AuthEmailOTP: true, AuthSSO: true, AuthTypedName: true,
}

func (a AuthMethod) Valid() bool { return validAuthMethods[a] }

// SignEventType enumerates audit-trail event kinds.
type SignEventType string

const (
	EvViewed    SignEventType = "viewed"
	EvConsented SignEventType = "consented"
	EvSigned    SignEventType = "signed"
	EvDeclined  SignEventType = "declined"
	EvSent      SignEventType = "sent"
	EvReminder  SignEventType = "reminder"
	EvCompleted SignEventType = "completed"
	EvVoided    SignEventType = "voided"
)

// SignEnvelope is a signing request over a specific document version.
type SignEnvelope struct {
	ID           uuid.UUID      `json:"id"`
	TenantID     uuid.UUID      `json:"tenant_id"`
	DocumentID   uuid.UUID      `json:"document_id"`
	VersionID    *uuid.UUID     `json:"version_id,omitempty"`
	Title        string         `json:"title"`
	Status       EnvelopeStatus `json:"status"`
	SigningOrder SigningOrder   `json:"signing_order"`
	CreatedBy    *uuid.UUID     `json:"created_by,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	SentAt       *time.Time     `json:"sent_at,omitempty"`
	CompletedAt  *time.Time     `json:"completed_at,omitempty"`
	VoidedAt     *time.Time     `json:"voided_at,omitempty"`
	VoidReason   string         `json:"void_reason,omitempty"`
	ExpiresAt    *time.Time     `json:"expires_at,omitempty"`
	// Signers is populated on detail reads.
	Signers []Signer `json:"signers,omitempty"`
}

// Signer is a single signer row within an envelope. It carries the
// tamper-evident hash chain captured at signing time.
type Signer struct {
	ID            uuid.UUID       `json:"id"`
	TenantID      uuid.UUID       `json:"tenant_id"`
	EnvelopeID    uuid.UUID       `json:"envelope_id"`
	DocumentID    uuid.UUID       `json:"document_id"`
	SignerID      uuid.UUID       `json:"signer_id"`
	SignerName    string          `json:"signer_name"`
	SignerEmail   string          `json:"signer_email"`
	OrderIndex    int             `json:"order_index"`
	Status        SignatureStatus `json:"status"`
	RoutingStatus RoutingStatus   `json:"routing_status"`
	AuthMethod    AuthMethod      `json:"auth_method"`
	TypedName     string          `json:"typed_name,omitempty"`
	HasImage      bool            `json:"has_signature_image"`
	Consent       bool            `json:"consent"`
	RequestedAt   time.Time       `json:"requested_at"`
	ViewedAt      *time.Time      `json:"viewed_at,omitempty"`
	SignedAt      *time.Time      `json:"signed_at,omitempty"`
	DeclinedAt    *time.Time      `json:"declined_at,omitempty"`
	DeclineReason string          `json:"decline_reason,omitempty"`
	ContentHash   string          `json:"content_hash,omitempty"`
	PrevHash      string          `json:"prev_hash,omitempty"`
	ChainedHash   string          `json:"chained_hash,omitempty"`
	// RecordSig is the base64 Ed25519 signature over chained_hash, made with
	// the platform signing key identified by RecordKid. Empty for rows signed
	// before record-signing landed.
	RecordSig string     `json:"record_sig,omitempty"`
	RecordKid string     `json:"record_kid,omitempty"`
	VersionID *uuid.UUID `json:"version_id,omitempty"`
}

// SignEvent is one audit-trail entry for an envelope.
type SignEvent struct {
	ID         uuid.UUID      `json:"id"`
	TenantID   uuid.UUID      `json:"tenant_id"`
	EnvelopeID uuid.UUID      `json:"envelope_id"`
	SignerID   *uuid.UUID     `json:"signer_id,omitempty"`
	EventType  SignEventType  `json:"event_type"`
	ActorID    *uuid.UUID     `json:"actor_id,omitempty"`
	IPAddress  string         `json:"ip_address"`
	UserAgent  string         `json:"user_agent"`
	Geo        string         `json:"geo,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
	CreatedAt  time.Time      `json:"created_at"`
	// Event-level hash chain (tamper-evident audit trail). Nil for legacy
	// rows inserted before the chain landed (migration 00007).
	PrevEventHash *string `json:"prev_event_hash,omitempty"`
	EventHash     *string `json:"event_hash,omitempty"`
}

// EventChainStatus summarizes audit-event hash-chain integrity.
type EventChainStatus string

const (
	// EventChainValid: every event row carries a hash and the chain verifies.
	EventChainValid EventChainStatus = "valid"
	// EventChainInvalid: at least one hashed event fails recomputation.
	EventChainInvalid EventChainStatus = "invalid"
	// EventChainLegacy: some/all rows predate event hashing (00007); the
	// hashed subset (if any) verified, but full-chain guarantee is partial.
	EventChainLegacy EventChainStatus = "legacy"
	// EventChainEmpty: the envelope has no audit events at all.
	EventChainEmpty EventChainStatus = "empty"
)

// ChainVerifyResult reports hash-chain integrity for an envelope.
type ChainVerifyResult struct {
	EnvelopeID uuid.UUID         `json:"envelope_id"`
	Valid      bool              `json:"valid"`
	Links      []ChainLinkResult `json:"links"`
	Reason     string            `json:"reason,omitempty"`
	// EventChain reports tamper-evidence over the audit-event trail.
	EventChain EventChainStatus `json:"event_chain"`
}

// ChainLinkResult is the per-signer verification detail.
type ChainLinkResult struct {
	SignerID          uuid.UUID `json:"signer_id"`
	OrderIndex        int       `json:"order_index"`
	StoredContentHash string    `json:"stored_content_hash"`
	RecomputedContent string    `json:"recomputed_content_hash"`
	StoredChainedHash string    `json:"stored_chained_hash"`
	RecomputedChained string    `json:"recomputed_chained_hash"`
	ContentMatches    bool      `json:"content_matches"`
	ChainMatches      bool      `json:"chain_matches"`
	// AuthMethod surfaces how the signer authenticated (session / email_otp /
	// sso / typed_name) so verifiers see the step-up posture per signer.
	AuthMethod string `json:"auth_method,omitempty"`
	// RecordSigValid reports Ed25519 verification of the stored chained_hash
	// against the platform signing key. Nil for legacy rows without a
	// record signature.
	RecordSigValid *bool `json:"record_sig_valid,omitempty"`
	// TSA reports RFC 3161 trusted-timestamp verification (domain/tsa.go).
	// Nil only when TSA evidence could not be loaded.
	TSA *TSAVerify `json:"tsa,omitempty"`
}

var (
	ErrNotFound     = errors.New("not found")
	ErrConflict     = errors.New("version conflict")
	ErrInvalidInput = errors.New("invalid input")
	// ErrForbidden: the authenticated actor is not allowed to act on this
	// resource (e.g. signing another user's signer row). Mapped to HTTP 403.
	ErrForbidden = errors.New("forbidden")
)
