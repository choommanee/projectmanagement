package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/store"
)

func seedDocumentForComments(t *testing.T, tid, pid uuid.UUID) (wsID, docID uuid.UUID) {
	t.Helper()
	p := pool(t)
	defer p.Close()

	ws := store.NewWorkspaces(p)
	docs := store.NewDocuments(p)
	ctx := context.Background()

	w, err := ws.EnsureForProject(ctx, tid, pid, domain.WSKindPM, "PM WS for comments")
	if err != nil {
		t.Fatalf("seedDocumentForComments workspace: %v", err)
	}

	d := makeDocument(tid, w.ID, pid)
	d.Type = domain.DocumentType("note")
	d.Title = "Comment Target Doc"
	if err := docs.Create(ctx, d); err != nil {
		t.Fatalf("seedDocumentForComments doc: %v", err)
	}
	return w.ID, d.ID
}

func TestCreateAndListComments(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, pid := seedTenantAndProject(t, p)
	ctx := context.Background()

	ws := store.NewWorkspaces(p)
	docs := store.NewDocuments(p)
	comms := store.NewComments(p)

	w, _ := ws.EnsureForProject(ctx, tid, pid, domain.WSKindPM, "PM WS")
	d := makeDocument(tid, w.ID, pid)
	d.Type = "note"
	d.Title = "Comment Doc"
	if err := docs.Create(ctx, d); err != nil {
		t.Fatalf("Create doc: %v", err)
	}

	c1 := &domain.Comment{
		ID: uuid.New(), TenantID: tid, DocumentID: d.ID, Body: "First comment",
	}
	c2 := &domain.Comment{
		ID: uuid.New(), TenantID: tid, DocumentID: d.ID, Body: "Second comment",
	}
	if err := comms.Create(ctx, c1); err != nil {
		t.Fatalf("Create c1: %v", err)
	}
	if err := comms.Create(ctx, c2); err != nil {
		t.Fatalf("Create c2: %v", err)
	}

	items, err := comms.ListForDocument(ctx, tid, d.ID)
	if err != nil {
		t.Fatalf("ListForDocument: %v", err)
	}
	if len(items) < 2 {
		t.Fatalf("expected at least 2 comments, got %d", len(items))
	}
}

func TestResolveComment(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, pid := seedTenantAndProject(t, p)
	ctx := context.Background()

	ws := store.NewWorkspaces(p)
	docs := store.NewDocuments(p)
	comms := store.NewComments(p)

	w, _ := ws.EnsureForProject(ctx, tid, pid, domain.WSKindBA, "BA WS")
	d := makeDocument(tid, w.ID, pid)
	d.Type = "brd"
	d.Title = "Resolve Test Doc"
	if err := docs.Create(ctx, d); err != nil {
		t.Fatalf("Create doc: %v", err)
	}

	c := &domain.Comment{
		ID: uuid.New(), TenantID: tid, DocumentID: d.ID, Body: "To be resolved",
	}
	if err := comms.Create(ctx, c); err != nil {
		t.Fatalf("Create comment: %v", err)
	}

	if err := comms.Resolve(ctx, tid, c.ID); err != nil {
		t.Fatalf("Resolve: %v", err)
	}

	// Verify resolved_at is set in DB
	var resolvedAt interface{}
	err := p.QueryRow(ctx, "SELECT resolved_at FROM document_comment WHERE id=$1", c.ID).Scan(&resolvedAt)
	if err != nil {
		t.Fatalf("query resolved_at: %v", err)
	}
	if resolvedAt == nil {
		t.Fatal("expected resolved_at to be set")
	}

	// Second resolve should return ErrNotFound (already resolved)
	err = comms.Resolve(ctx, tid, c.ID)
	if err != domain.ErrNotFound {
		t.Fatalf("expected ErrNotFound on second resolve, got %v", err)
	}
}
