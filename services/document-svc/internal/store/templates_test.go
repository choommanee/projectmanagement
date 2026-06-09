package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/store"
)

func TestCreateAndListTemplatesByType(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, _ := seedTenantAndProject(t, p)
	tmpls := store.NewTemplates(p)
	ctx := context.Background()

	t1 := &domain.Template{
		ID: uuid.New(), TenantID: tid,
		Type: domain.DocumentType("brd"), Name: "Standard BRD",
		Body: map[string]any{"type": "doc", "content": []any{}},
	}
	t2 := &domain.Template{
		ID: uuid.New(), TenantID: tid,
		Type: domain.DocumentType("brd"), Name: "Minimal BRD",
		Body: map[string]any{"type": "doc", "content": []any{}},
	}
	// Different type — should not appear in brd listing
	t3 := &domain.Template{
		ID: uuid.New(), TenantID: tid,
		Type: domain.DocumentType("adr"), Name: "Standard ADR",
		Body: map[string]any{"type": "doc", "content": []any{}},
	}

	for _, tmpl := range []*domain.Template{t1, t2, t3} {
		if err := tmpls.Create(ctx, tmpl); err != nil {
			t.Fatalf("Create template %s: %v", tmpl.Name, err)
		}
	}

	items, err := tmpls.ListByType(ctx, tid, domain.DocumentType("brd"))
	if err != nil {
		t.Fatalf("ListByType: %v", err)
	}
	if len(items) < 2 {
		t.Fatalf("expected at least 2 brd templates, got %d", len(items))
	}
	// Ensure no adr template leaks in
	for _, item := range items {
		if item.Type != "brd" {
			t.Fatalf("unexpected type %s in brd listing", item.Type)
		}
	}
}

func TestGetTemplateByID(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, _ := seedTenantAndProject(t, p)
	tmpls := store.NewTemplates(p)
	ctx := context.Background()

	tmpl := &domain.Template{
		ID: uuid.New(), TenantID: tid,
		Type: domain.DocumentType("note"), Name: "Quick Note Template",
		Body: map[string]any{"type": "doc", "content": []any{
			map[string]any{"type": "heading", "attrs": map[string]any{"level": float64(1)}},
		}},
	}
	if err := tmpls.Create(ctx, tmpl); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := tmpls.GetByID(ctx, tid, tmpl.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Name != tmpl.Name {
		t.Fatalf("expected name=%s, got %s", tmpl.Name, got.Name)
	}
	if got.Type != tmpl.Type {
		t.Fatalf("expected type=%s, got %s", tmpl.Type, got.Type)
	}
	// Regression guard: GetByID must populate Body (it previously returned the
	// Scan error directly and never decoded body → callers saw body=null,
	// breaking the template detail view + template instantiation).
	if got.Body == nil || got.Body["type"] != "doc" {
		t.Fatalf("expected body to round-trip, got %v", got.Body)
	}
	content, ok := got.Body["content"].([]any)
	if !ok || len(content) != 1 {
		t.Fatalf("expected 1 content node in body, got %v", got.Body["content"])
	}

	// Not found for random ID
	_, err = tmpls.GetByID(ctx, tid, uuid.New())
	if err != domain.ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}
