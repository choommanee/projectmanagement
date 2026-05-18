package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/store"
)

// seedWorkspace creates a workspace and returns its ID.
func seedWorkspace(t *testing.T, p interface{ Exec(context.Context, string, ...any) (interface{ RowsAffected() int64 }, error) }, tid, pid uuid.UUID) uuid.UUID {
	t.Helper()
	return uuid.Nil // handled via store call instead
}

func makeDocument(tid, wsID, pid uuid.UUID) *domain.Document {
	return &domain.Document{
		ID:          uuid.New(),
		TenantID:    tid,
		WorkspaceID: wsID,
		ProjectID:   pid,
		Type:        domain.DocumentType("brd"),
		Title:       "Test BRD",
		Body:        map[string]any{"type": "doc", "content": []any{}},
		Status:      domain.DocDraft,
		Tags:        []string{},
		Version:     1,
	}
}

func TestCreateDocumentCreatesInitialVersion(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, pid := seedTenantAndProject(t, p)
	ws := store.NewWorkspaces(p)
	docs := store.NewDocuments(p)
	ctx := context.Background()

	// Create workspace
	w, err := ws.EnsureForProject(ctx, tid, pid, domain.WSKindBA, "BA WS")
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}

	d := makeDocument(tid, w.ID, pid)
	if err := docs.Create(ctx, d); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// current_version_id must be set
	if d.CurrentVersionID == nil || *d.CurrentVersionID == uuid.Nil {
		t.Fatal("expected current_version_id to be set")
	}

	// Verify rev=1 exists in DB
	var rev int
	err = p.QueryRow(ctx, "SELECT rev FROM document_version WHERE document_id=$1", d.ID).Scan(&rev)
	if err != nil {
		t.Fatalf("query version: %v", err)
	}
	if rev != 1 {
		t.Fatalf("expected rev=1, got %d", rev)
	}
}

func TestGetDocumentNotFound(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, _ := seedTenantAndProject(t, p)
	docs := store.NewDocuments(p)

	_, err := docs.GetByID(context.Background(), tid, uuid.New())
	if err != domain.ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestListByWorkspace(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, pid := seedTenantAndProject(t, p)
	ws := store.NewWorkspaces(p)
	docs := store.NewDocuments(p)
	ctx := context.Background()

	w, _ := ws.EnsureForProject(ctx, tid, pid, domain.WSKindPM, "PM WS")

	d1 := makeDocument(tid, w.ID, pid)
	d1.Type = "project_charter"
	d1.Title = "Charter 1"
	d2 := makeDocument(tid, w.ID, pid)
	d2.Type = "status_report"
	d2.Title = "Status Report 1"

	if err := docs.Create(ctx, d1); err != nil {
		t.Fatalf("Create d1: %v", err)
	}
	if err := docs.Create(ctx, d2); err != nil {
		t.Fatalf("Create d2: %v", err)
	}

	items, total, err := docs.List(ctx, tid, store.ListDocsOpts{WorkspaceID: &w.ID})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total < 2 {
		t.Fatalf("expected at least 2, got total=%d", total)
	}
	if len(items) < 2 {
		t.Fatalf("expected at least 2 items, got %d", len(items))
	}
}

func TestUpdateDocumentCreatesNewVersion(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, pid := seedTenantAndProject(t, p)
	ws := store.NewWorkspaces(p)
	docs := store.NewDocuments(p)
	ctx := context.Background()

	w, _ := ws.EnsureForProject(ctx, tid, pid, domain.WSKindBA, "BA WS")
	d := makeDocument(tid, w.ID, pid)
	if err := docs.Create(ctx, d); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Patch title
	d.Title = "Updated BRD"
	d.Body = map[string]any{"type": "doc", "content": []any{}}
	if err := docs.Update(ctx, d); err != nil {
		t.Fatalf("Update: %v", err)
	}

	// version should be incremented to 2
	if d.Version != 2 {
		t.Fatalf("expected version=2 after update, got %d", d.Version)
	}

	// Should now have rev=2 in document_version
	var maxRev int
	err := p.QueryRow(ctx, "SELECT MAX(rev) FROM document_version WHERE document_id=$1", d.ID).Scan(&maxRev)
	if err != nil {
		t.Fatalf("query version: %v", err)
	}
	if maxRev != 2 {
		t.Fatalf("expected max_rev=2, got %d", maxRev)
	}
}

func TestUpdateVersionConflict(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, pid := seedTenantAndProject(t, p)
	ws := store.NewWorkspaces(p)
	docs := store.NewDocuments(p)
	ctx := context.Background()

	w, _ := ws.EnsureForProject(ctx, tid, pid, domain.WSKindSA, "SA WS")
	d := makeDocument(tid, w.ID, pid)
	if err := docs.Create(ctx, d); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Update once successfully
	d.Title = "v2"
	if err := docs.Update(ctx, d); err != nil {
		t.Fatalf("First update: %v", err)
	}

	// Try updating with stale version (still 1, but DB is now 2)
	d.Version = 1 // stale
	d.Title = "stale"
	err := docs.Update(ctx, d)
	if err != domain.ErrConflict {
		t.Fatalf("expected ErrConflict with stale version, got %v", err)
	}
}

func TestRestoreVersionWritesNewSnapshot(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, pid := seedTenantAndProject(t, p)
	ws := store.NewWorkspaces(p)
	docs := store.NewDocuments(p)
	ctx := context.Background()

	w, _ := ws.EnsureForProject(ctx, tid, pid, domain.WSKindExpert, "Expert WS")
	d := makeDocument(tid, w.ID, pid)
	d.Title = "Original"
	if err := docs.Create(ctx, d); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Update to v2
	d.Title = "Modified"
	if err := docs.Update(ctx, d); err != nil {
		t.Fatalf("Update: %v", err)
	}
	// d.Version is now 2

	// Restore to rev=1
	restored, err := docs.Restore(ctx, tid, d.ID, 1, d.Version)
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if restored.Title != "Original" {
		t.Fatalf("expected title 'Original' after restore, got %s", restored.Title)
	}

	// Should now have rev=3 (initial + update + restore)
	var maxRev int
	p.QueryRow(ctx, "SELECT MAX(rev) FROM document_version WHERE document_id=$1", d.ID).Scan(&maxRev)
	if maxRev != 3 {
		t.Fatalf("expected max_rev=3 after restore, got %d", maxRev)
	}
}
