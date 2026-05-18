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
	ID, TenantID, ProjectID uuid.UUID
	Kind                    WorkspaceKind
	Name                    string
	CreatedAt, UpdatedAt    time.Time
}

type DocumentType string
type DocumentStatus string

const (
	DocDraft    DocumentStatus = "draft"
	DocReview   DocumentStatus = "review"
	DocApproved DocumentStatus = "approved"
	DocArchived DocumentStatus = "archived"
)

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
	ID, TenantID, WorkspaceID, ProjectID uuid.UUID
	Type                                  DocumentType
	Title                                 string
	Body                                  map[string]any
	Status                                DocumentStatus
	OwnerID                               *uuid.UUID
	Tags                                  []string
	CurrentVersionID                      *uuid.UUID
	CreatedAt, UpdatedAt                  time.Time
	Version                               int
}

type DocumentVersion struct {
	ID, DocumentID, TenantID uuid.UUID
	Rev                      int
	Title                    string
	Body                     map[string]any
	Status                   DocumentStatus
	CreatedBy                *uuid.UUID
	CreatedAt                time.Time
	Note                     string
}

type Comment struct {
	ID, TenantID, DocumentID uuid.UUID
	ParentID                 *uuid.UUID
	AuthorID                 *uuid.UUID
	Body                     string
	Anchor                   map[string]any
	CreatedAt, UpdatedAt     time.Time
	ResolvedAt               *time.Time
}

type Template struct {
	ID, TenantID uuid.UUID
	Type         DocumentType
	Name         string
	Body         map[string]any
	IsSystem     bool
	CreatedAt    time.Time
}

var (
	ErrNotFound     = errors.New("not found")
	ErrConflict     = errors.New("version conflict")
	ErrInvalidInput = errors.New("invalid input")
)
