package service

import (
	"context"
	"strings"

	"github.com/google/uuid"

	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/store"
)

// Service wires together the store layer.
type Service struct {
	Workspaces *store.Workspaces
	Documents  *store.Documents
	Comments   *store.Comments
	Templates  *store.Templates
	Signatures *store.Signatures
}

func New(w *store.Workspaces, d *store.Documents, c *store.Comments, t *store.Templates) *Service {
	return &Service{Workspaces: w, Documents: d, Comments: c, Templates: t}
}

// WithSignatures attaches the signature store; returns the receiver for fluent wiring.
func (svc *Service) WithSignatures(s *store.Signatures) *Service {
	svc.Signatures = s
	return svc
}

// EnsureWorkspaceInput holds params for workspace upsert.
type EnsureWorkspaceInput struct {
	TenantID  uuid.UUID
	ProjectID uuid.UUID
	Kind      domain.WorkspaceKind
	Name      string
}

// EnsureWorkspace validates and upserts a workspace.
func (svc *Service) EnsureWorkspace(ctx context.Context, in EnsureWorkspaceInput) (*domain.Workspace, error) {
	if !in.Kind.Valid() {
		return nil, domain.ErrInvalidInput
	}
	if strings.TrimSpace(in.Name) == "" {
		in.Name = string(in.Kind) + " workspace"
	}
	return svc.Workspaces.EnsureForProject(ctx, in.TenantID, in.ProjectID, in.Kind, in.Name)
}

// CreateDocumentInput holds params for document creation.
type CreateDocumentInput struct {
	TenantID    uuid.UUID
	WorkspaceID uuid.UUID
	ProjectID   uuid.UUID
	Type        domain.DocumentType
	Title       string
	Body        map[string]any
	OwnerID     *uuid.UUID
	Tags        []string
}

var defaultBody = map[string]any{"type": "doc", "content": []any{}}

// CreateDocument validates and creates a new document with initial version.
func (svc *Service) CreateDocument(ctx context.Context, in CreateDocumentInput) (*domain.Document, error) {
	if in.WorkspaceID == uuid.Nil {
		return nil, domain.ErrInvalidInput
	}
	if in.ProjectID == uuid.Nil {
		return nil, domain.ErrInvalidInput
	}
	if !in.Type.Valid() {
		return nil, domain.ErrInvalidInput
	}
	if strings.TrimSpace(in.Title) == "" {
		return nil, domain.ErrInvalidInput
	}
	body := in.Body
	if body == nil {
		body = defaultBody
	}
	tags := in.Tags
	if tags == nil {
		tags = []string{}
	}
	d := &domain.Document{
		ID:          uuid.New(),
		TenantID:    in.TenantID,
		WorkspaceID: in.WorkspaceID,
		ProjectID:   in.ProjectID,
		Type:        in.Type,
		Title:       in.Title,
		Body:        body,
		Status:      domain.DocDraft,
		OwnerID:     in.OwnerID,
		Tags:        tags,
		Version:     1,
	}
	if err := svc.Documents.Create(ctx, d); err != nil {
		return nil, err
	}
	return d, nil
}

// CreateCommentInput holds params for adding a comment.
type CreateCommentInput struct {
	TenantID   uuid.UUID
	DocumentID uuid.UUID
	ParentID   *uuid.UUID
	AuthorID   *uuid.UUID
	Body       string
	Anchor     map[string]any
}

// CreateComment validates and creates a comment.
func (svc *Service) CreateComment(ctx context.Context, in CreateCommentInput) (*domain.Comment, error) {
	if strings.TrimSpace(in.Body) == "" {
		return nil, domain.ErrInvalidInput
	}
	c := &domain.Comment{
		ID:         uuid.New(),
		TenantID:   in.TenantID,
		DocumentID: in.DocumentID,
		ParentID:   in.ParentID,
		AuthorID:   in.AuthorID,
		Body:       in.Body,
		Anchor:     in.Anchor,
	}
	if err := svc.Comments.Create(ctx, c); err != nil {
		return nil, err
	}
	return c, nil
}

// CreateTemplateInput holds params for template creation.
type CreateTemplateInput struct {
	TenantID uuid.UUID
	Type     domain.DocumentType
	Name     string
	Body     map[string]any
	IsSystem bool
}

// CreateTemplate validates and creates a template.
func (svc *Service) CreateTemplate(ctx context.Context, in CreateTemplateInput) (*domain.Template, error) {
	if !in.Type.Valid() {
		return nil, domain.ErrInvalidInput
	}
	if strings.TrimSpace(in.Name) == "" {
		return nil, domain.ErrInvalidInput
	}
	body := in.Body
	if body == nil {
		body = defaultBody
	}
	t := &domain.Template{
		ID:       uuid.New(),
		TenantID: in.TenantID,
		Type:     in.Type,
		Name:     in.Name,
		Body:     body,
		IsSystem: in.IsSystem,
	}
	if err := svc.Templates.Create(ctx, t); err != nil {
		return nil, err
	}
	return t, nil
}
