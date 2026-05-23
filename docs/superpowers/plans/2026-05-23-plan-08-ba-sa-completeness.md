# Plan #8 — BA/SA Workspace Completeness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BA and SA workspaces fully functional by (1) wiring the `metadata` JSONB column through the Go backend so ADR votes, User Story acceptance criteria, and RTM rows actually persist, and (2) rendering Mermaid code blocks as live diagrams in the document editor.

**Architecture:** The frontend panels (`ADRVotingPanel`, `RTMView`, `DocCover`) and the `handleMetadataChange` PATCH flow are already implemented in `WorkspaceShell.tsx` — they just silently lose data because the backend ignores the `metadata` field in PATCH requests. Migration `00004_metadata_templates.sql` already added the column. Tasks 1–2 wire the Go layer; Task 3 adds Mermaid preview to `DocEditor` by reading the TipTap body JSON and calling `mermaid.render()` client-side.

**Tech Stack:** Go 1.23, pgx/v5, chi, Next.js 15, React 19, TipTap, Mermaid 11 (already in `package.json`), Vitest.

---

## File Structure

```
Modified (Go):
  services/document-svc/internal/domain/types.go          add Metadata to Document struct
  services/document-svc/internal/store/documents.go       add metadata to SELECT x3, UPDATE x1
  services/document-svc/internal/api/handlers.go          add Metadata to patchDocumentReq + apply
  services/document-svc/internal/api/handlers_test.go     add TestPatchDocumentMetadata; fix :5433→:5432
  services/document-svc/internal/store/workspaces_test.go fix :5433→:5432
  services/document-svc/cmd/server/main.go                fix :5433→:5432 (default DSN)

Modified (Frontend):
  apps/web/src/components/DocEditor.tsx                   add Mermaid preview section
```

No new migrations, no new proxy routes, no new npm packages.

---

## Task 1: Wire `metadata` in domain + store (Go)

**Files:**
- Modify: `services/document-svc/internal/domain/types.go`
- Modify: `services/document-svc/internal/store/documents.go`
- Fix: `services/document-svc/internal/store/workspaces_test.go` (DSN port)

- [ ] **Step 1: Add `Metadata` field to domain.Document**

In `services/document-svc/internal/domain/types.go`, find the `Document` struct and add `Metadata`:

```go
type Document struct {
	ID, TenantID, WorkspaceID, ProjectID uuid.UUID
	Type                                  DocumentType
	Title                                 string
	Body                                  map[string]any
	Metadata                              map[string]any
	Status                                DocumentStatus
	OwnerID                               *uuid.UUID
	Tags                                  []string
	CurrentVersionID                      *uuid.UUID
	CreatedAt, UpdatedAt                  time.Time
	Version                               int
}
```

- [ ] **Step 2: Update `GetByID` SELECT to include metadata**

In `services/document-svc/internal/store/documents.go`, find the `GetByID` function (around line 88). Replace its SELECT and Scan:

Before (2 lines to change):
```go
		err := tx.QueryRow(ctx, `
			SELECT id, tenant_id, workspace_id, project_id, type, title, body, status,
			       owner_id, tags, current_version_id, created_at, updated_at, version
			FROM document
			WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
			id, tid,
		).Scan(&d.ID, &d.TenantID, &d.WorkspaceID, &d.ProjectID, &d.Type, &d.Title, &bodyBytes,
			&d.Status, &d.OwnerID, &d.Tags, &d.CurrentVersionID, &d.CreatedAt, &d.UpdatedAt, &d.Version)
		if err != nil {
			return err
		}
		d.Body = fromJSON(bodyBytes)
```

After:
```go
		var metaBytes []byte
		err := tx.QueryRow(ctx, `
			SELECT id, tenant_id, workspace_id, project_id, type, title, body, metadata, status,
			       owner_id, tags, current_version_id, created_at, updated_at, version
			FROM document
			WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
			id, tid,
		).Scan(&d.ID, &d.TenantID, &d.WorkspaceID, &d.ProjectID, &d.Type, &d.Title, &bodyBytes,
			&metaBytes, &d.Status, &d.OwnerID, &d.Tags, &d.CurrentVersionID, &d.CreatedAt, &d.UpdatedAt, &d.Version)
		if err != nil {
			return err
		}
		d.Body = fromJSON(bodyBytes)
		d.Metadata = fromJSON(metaBytes)
```

- [ ] **Step 3: Update `List` SELECT to include metadata**

In `List` (around line 162), replace the SELECT and rows.Scan:

Before:
```go
		rows, err := tx.Query(ctx,
			fmt.Sprintf(`
				SELECT id, tenant_id, workspace_id, project_id, type, title, body, status,
				       owner_id, tags, current_version_id, created_at, updated_at, version
				FROM document
				WHERE %s
				ORDER BY created_at DESC
				LIMIT $%d OFFSET $%d`, whereSQL, idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
        ...
		for rows.Next() {
			var d domain.Document
			var bodyBytes []byte
			if err := rows.Scan(&d.ID, &d.TenantID, &d.WorkspaceID, &d.ProjectID, &d.Type, &d.Title, &bodyBytes,
				&d.Status, &d.OwnerID, &d.Tags, &d.CurrentVersionID, &d.CreatedAt, &d.UpdatedAt, &d.Version); err != nil {
				return err
			}
			d.Body = fromJSON(bodyBytes)
			items = append(items, &d)
		}
```

After:
```go
		rows, err := tx.Query(ctx,
			fmt.Sprintf(`
				SELECT id, tenant_id, workspace_id, project_id, type, title, body, metadata, status,
				       owner_id, tags, current_version_id, created_at, updated_at, version
				FROM document
				WHERE %s
				ORDER BY created_at DESC
				LIMIT $%d OFFSET $%d`, whereSQL, idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
        ...
		for rows.Next() {
			var d domain.Document
			var bodyBytes, metaBytes []byte
			if err := rows.Scan(&d.ID, &d.TenantID, &d.WorkspaceID, &d.ProjectID, &d.Type, &d.Title, &bodyBytes,
				&metaBytes, &d.Status, &d.OwnerID, &d.Tags, &d.CurrentVersionID, &d.CreatedAt, &d.UpdatedAt, &d.Version); err != nil {
				return err
			}
			d.Body = fromJSON(bodyBytes)
			d.Metadata = fromJSON(metaBytes)
			items = append(items, &d)
		}
```

- [ ] **Step 4: Update `Restore` final SELECT to include metadata**

In the `Restore` function (around line 395), the final SELECT that fetches the restored document:

Before:
```go
		err = tx.QueryRow(ctx, `
			SELECT id, tenant_id, workspace_id, project_id, type, title, body, status,
			       owner_id, tags, current_version_id, created_at, updated_at, version
			FROM document
			WHERE id=$1 AND tenant_id=$2`,
			docID, tid,
		).Scan(&d.ID, &d.TenantID, &d.WorkspaceID, &d.ProjectID, &d.Type, &d.Title, &dBodyBytes,
			&d.Status, &d.OwnerID, &d.Tags, &d.CurrentVersionID, &d.CreatedAt, &d.UpdatedAt, &d.Version)
		if err != nil {
			return err
		}
		d.Body = fromJSON(dBodyBytes)
```

After:
```go
		var dMetaBytes []byte
		err = tx.QueryRow(ctx, `
			SELECT id, tenant_id, workspace_id, project_id, type, title, body, metadata, status,
			       owner_id, tags, current_version_id, created_at, updated_at, version
			FROM document
			WHERE id=$1 AND tenant_id=$2`,
			docID, tid,
		).Scan(&d.ID, &d.TenantID, &d.WorkspaceID, &d.ProjectID, &d.Type, &d.Title, &dBodyBytes,
			&dMetaBytes, &d.Status, &d.OwnerID, &d.Tags, &d.CurrentVersionID, &d.CreatedAt, &d.UpdatedAt, &d.Version)
		if err != nil {
			return err
		}
		d.Body = fromJSON(dBodyBytes)
		d.Metadata = fromJSON(dMetaBytes)
```

- [ ] **Step 5: Update `Update` SET clause to include metadata**

In the `Update` function (around line 210), replace the UPDATE SQL and its Exec call:

Before:
```go
	bodyJSON := toJSON(d.Body)
	return s.withTenant(ctx, d.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE document SET
			  title=$3, body=$4, status=$5, owner_id=$6, tags=$7,
			  updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$8 AND deleted_at IS NULL`,
			d.ID, d.TenantID, d.Title, bodyJSON, string(d.Status), d.OwnerID, d.Tags, d.Version,
		)
```

After:
```go
	bodyJSON := toJSON(d.Body)
	metaJSON := toJSON(d.Metadata)
	return s.withTenant(ctx, d.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE document SET
			  title=$3, body=$4, metadata=$5, status=$6, owner_id=$7, tags=$8,
			  updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$9 AND deleted_at IS NULL`,
			d.ID, d.TenantID, d.Title, bodyJSON, metaJSON, string(d.Status), d.OwnerID, d.Tags, d.Version,
		)
```

- [ ] **Step 6: Fix DSN port in store/workspaces_test.go**

In `services/document-svc/internal/store/workspaces_test.go` line 19:

```go
// Before:
dsn = "postgres://app:app@localhost:5433/platform?sslmode=disable"

// After:
dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
```

- [ ] **Step 7: Build to confirm no compile errors**

```bash
cd services/document-svc && go build ./...
```

Expected: no output (clean build).

- [ ] **Step 8: Commit Task 1**

```bash
git add services/document-svc/internal/domain/types.go \
        services/document-svc/internal/store/documents.go \
        services/document-svc/internal/store/workspaces_test.go
git commit -m "feat(document-svc): wire metadata field through domain/store (Plan #8 Task 1)"
```

---

## Task 2: Wire `metadata` in API handler + add test (Go)

**Files:**
- Modify: `services/document-svc/internal/api/handlers.go`
- Modify: `services/document-svc/internal/api/handlers_test.go`
- Fix: `services/document-svc/cmd/server/main.go` (DSN port)

- [ ] **Step 1: Add Metadata to patchDocumentReq and apply in handler**

In `services/document-svc/internal/api/handlers.go`, find `patchDocumentReq` (around line 268):

```go
// Before:
type patchDocumentReq struct {
	Title   string                `json:"title,omitempty"`
	Body    map[string]any        `json:"body,omitempty"`
	Status  domain.DocumentStatus `json:"status,omitempty"`
	OwnerID *uuid.UUID            `json:"owner_id,omitempty"`
	Tags    []string              `json:"tags,omitempty"`
	Version int                   `json:"version"`
}

// After:
type patchDocumentReq struct {
	Title    string                `json:"title,omitempty"`
	Body     map[string]any        `json:"body,omitempty"`
	Metadata map[string]any        `json:"metadata,omitempty"`
	Status   domain.DocumentStatus `json:"status,omitempty"`
	OwnerID  *uuid.UUID            `json:"owner_id,omitempty"`
	Tags     []string              `json:"tags,omitempty"`
	Version  int                   `json:"version"`
}
```

In the `patchDocument` handler body, find the block that applies `req.Body` and add Metadata handling after it:

```go
// Find this existing block:
if req.Body != nil {
    d.Body = req.Body
}
// Add after it:
if req.Metadata != nil {
    d.Metadata = req.Metadata
}
```

- [ ] **Step 2: Fix DSN port in cmd/server/main.go**

In `services/document-svc/cmd/server/main.go` line 23:

```go
// Before:
dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5433/platform?sslmode=disable")

// After:
dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5432/platform?sslmode=disable")
```

- [ ] **Step 3: Write failing test TestPatchDocumentMetadata**

In `services/document-svc/internal/api/handlers_test.go`, add at the end of the file:

```go
func TestPatchDocumentMetadata(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	pid := seedTestProject(t, p, tid)
	h := newTestHandler(p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}
	ctx := context.Background()

	// Ensure workspace
	wsResp := doJSON(t, h, "POST", "/v1/workspaces", map[string]any{
		"project_id": pid.String(), "kind": "sa", "name": "SA Workspace",
	}, headers)
	if wsResp.Code != 200 {
		t.Fatalf("ensure workspace: expected 200, got %d: %s", wsResp.Code, wsResp.Body.String())
	}
	var ws map[string]any
	_ = json.Unmarshal(wsResp.Body.Bytes(), &ws)
	wsID := ws["ID"].(string)

	// Create an ADR document
	createResp := doJSON(t, h, "POST", "/v1/documents", map[string]any{
		"workspace_id": wsID,
		"project_id":   pid.String(),
		"type":         "adr",
		"title":        "Use PostgreSQL",
	}, headers)
	if createResp.Code != 201 {
		t.Fatalf("create: expected 201, got %d: %s", createResp.Code, createResp.Body.String())
	}
	var doc map[string]any
	_ = json.Unmarshal(createResp.Body.Bytes(), &doc)
	docID := doc["ID"].(string)
	t.Cleanup(func() { p.Exec(ctx, "DELETE FROM document WHERE id=$1", docID) })

	// PATCH with metadata (ADR votes)
	votes := []map[string]any{
		{"userId": "user-001", "vote": "accepted", "votedAt": "2026-05-23T10:00:00Z"},
	}
	patchResp := doJSON(t, h, "PATCH", "/v1/documents/"+docID, map[string]any{
		"metadata": map[string]any{"votes": votes},
		"version":  1,
	}, headers)
	if patchResp.Code != 200 {
		t.Fatalf("patch metadata: expected 200, got %d: %s", patchResp.Code, patchResp.Body.String())
	}
	var patched map[string]any
	_ = json.Unmarshal(patchResp.Body.Bytes(), &patched)

	// Assert metadata echoed in response
	meta, ok := patched["Metadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected Metadata in response, got: %v", patched["Metadata"])
	}
	votesOut, ok := meta["votes"].([]any)
	if !ok || len(votesOut) != 1 {
		t.Fatalf("expected 1 vote in metadata, got: %v", meta["votes"])
	}

	// GET to confirm metadata persisted
	getResp := doJSON(t, h, "GET", "/v1/documents/"+docID, nil, headers)
	if getResp.Code != 200 {
		t.Fatalf("get: expected 200, got %d", getResp.Code)
	}
	var fetched map[string]any
	_ = json.Unmarshal(getResp.Body.Bytes(), &fetched)
	fetchedMeta, ok := fetched["Metadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected Metadata in GET response, got: %v", fetched["Metadata"])
	}
	fetchedVotes, ok := fetchedMeta["votes"].([]any)
	if !ok || len(fetchedVotes) != 1 {
		t.Fatalf("expected 1 persisted vote, got: %v", fetchedMeta["votes"])
	}
}
```

- [ ] **Step 4: Fix DSN port in handlers_test.go**

In `services/document-svc/internal/api/handlers_test.go` line 24:

```go
// Before:
dsn = "postgres://app:app@localhost:5433/platform?sslmode=disable"

// After:
dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd services/document-svc && go test -run TestPatchDocumentMetadata ./internal/api/... -v
```

Expected output:
```
--- PASS: TestPatchDocumentMetadata (0.XX s)
PASS
```

If Postgres is unavailable, the test skips — that's acceptable. If it connects but fails, debug the store query.

- [ ] **Step 6: Run full document-svc test suite**

```bash
cd services/document-svc && go test ./...
```

Expected: all tests pass or skip (skip = Postgres unavailable). No FAIL.

- [ ] **Step 7: Commit Task 2**

```bash
git add services/document-svc/internal/api/handlers.go \
        services/document-svc/internal/api/handlers_test.go \
        services/document-svc/cmd/server/main.go
git commit -m "feat(document-svc): expose metadata in PATCH + GET + test (Plan #8 Task 2)"
```

---

## Task 3: Mermaid rendering in DocEditor (Frontend)

**Files:**
- Modify: `apps/web/src/components/DocEditor.tsx`

The `mermaid` npm package is already installed (`"mermaid": "^11.15.0"` in `apps/web/package.json`). We read mermaid code blocks directly from the TipTap body JSON and render SVG previews below the editor — no TipTap extension changes needed.

- [ ] **Step 1: Add Mermaid imports and initialization to DocEditor.tsx**

At the top of `apps/web/src/components/DocEditor.tsx`, after existing imports, add:

```ts
import mermaid from "mermaid";

mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });
```

- [ ] **Step 2: Add extractMermaidBlocks helper**

After the existing imports section (before the component functions), add:

```ts
function extractMermaidBlocks(doc: Record<string, unknown> | null): string[] {
  if (!doc) return [];
  const blocks: string[] = [];
  function walk(node: Record<string, unknown>) {
    if (node.type === "codeBlock" && (node.attrs as Record<string, unknown>)?.language === "mermaid") {
      const text = ((node.content as Record<string, unknown>[]) ?? [])
        .map((n) => (n.text as string) ?? "")
        .join("");
      if (text.trim()) blocks.push(text);
    }
    ((node.content as Record<string, unknown>[]) ?? []).forEach(walk);
  }
  walk(doc);
  return blocks;
}
```

- [ ] **Step 3: Add MermaidPreviewSection component**

Add this component inside `DocEditor.tsx` (before the main `DocEditor` export):

```tsx
function MermaidPreviewSection({ blocks }: { blocks: string[] }) {
  const [svgs, setSvgs] = useState<string[]>([]);

  useEffect(() => {
    if (blocks.length === 0) { setSvgs([]); return; }
    let cancelled = false;
    Promise.all(
      blocks.map(async (code, i) => {
        try {
          const id = `mermaid-${i}-${Math.random().toString(36).slice(2)}`;
          const { svg } = await mermaid.render(id, code);
          return svg;
        } catch {
          return '<p class="text-[11px] text-danger p-2">⚠ Diagram syntax error</p>';
        }
      }),
    ).then((results) => {
      if (!cancelled) setSvgs(results);
    });
    return () => { cancelled = true; };
  }, [blocks.join("\n")]);

  if (svgs.length === 0) return null;
  return (
    <div className="border-t border-line bg-surface-2/40 px-4 py-3 space-y-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Diagram Preview</p>
      {svgs.map((svg, i) => (
        <div
          key={i}
          className="overflow-x-auto rounded-xs border border-line bg-paper p-3"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ))}
    </div>
  );
}
```

`useState` and `useEffect` are already imported at the top of `DocEditor.tsx` — no new imports needed for these.

- [ ] **Step 4: Wire MermaidPreviewSection into the DocEditor return**

In the `DocEditor` component, find where `value` is used and compute mermaid blocks. Add a `useMemo` call (after the `useEditor` call):

```tsx
const mermaidBlocks = useMemo(() => extractMermaidBlocks(value), [value]);
```

`useMemo` is already in the React import at the top of the file — if not present, add it to the existing React import.

Then find the return JSX of `DocEditor`. After `<EditorContent editor={editor} />` (and after any bubble/floating menus), add:

```tsx
<MermaidPreviewSection blocks={mermaidBlocks} />
```

The full return structure should look like:

```tsx
return (
  <div className="flex flex-col ...">
    {/* Toolbar */}
    <div className="...">
      {/* ... existing toolbar buttons ... */}
    </div>
    {/* Editor */}
    <div className="...">
      {editor && <BubbleMenu ...>...</BubbleMenu>}
      {editor && <FloatingMenu ...>...</FloatingMenu>}
      <EditorContent editor={editor} />
    </div>
    {/* Mermaid preview — only visible when doc has mermaid code blocks */}
    <MermaidPreviewSection blocks={mermaidBlocks} />
  </div>
);
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/web && pnpm typecheck 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Run full test suite**

```bash
cd apps/web && pnpm test 2>&1 | tail -10
```

Expected: all 144+ tests pass.

- [ ] **Step 7: Commit Task 3**

```bash
git add apps/web/src/components/DocEditor.tsx
git commit -m "feat(web): Mermaid diagram preview in DocEditor (Plan #8 Task 3)"
```

---

## Self-review

**Spec coverage:**
- ✅ `metadata` wired in domain (Task 1 Step 1)
- ✅ `metadata` in SELECT — GetByID (Task 1 Step 2), List (Task 1 Step 3), Restore (Task 1 Step 4)
- ✅ `metadata` in UPDATE (Task 1 Step 5)
- ✅ `Metadata` in patchDocumentReq + handler applied (Task 2 Step 1)
- ✅ Test: PATCH metadata persists + GET confirms (Task 2 Step 3)
- ✅ DSN port fix: handlers_test.go (Task 2 Step 4), workspaces_test.go (Task 1 Step 6), main.go (Task 2 Step 2)
- ✅ Mermaid: extractMermaidBlocks from TipTap JSON (Task 3 Step 2)
- ✅ Mermaid: MermaidPreviewSection with SVG rendering (Task 3 Step 3)
- ✅ Mermaid: wired into DocEditor below EditorContent (Task 3 Step 4)

**Placeholder scan:** None — all steps have exact code.

**Type consistency:**
- `d.Metadata` (Go domain) set in Task 1, read in Task 2 handler — consistent
- `mermaidBlocks` (string[]) produced by `extractMermaidBlocks`, consumed by `MermaidPreviewSection` — consistent
- `value` prop on `DocEditor` is `Record<string, unknown> | null` — `extractMermaidBlocks` accepts this exact type

**No placeholders found.** Plan is complete.
