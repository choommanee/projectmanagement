# BA/SA Workspace Completeness Design

**Date:** 2026-05-23  
**Status:** Approved

## Goal

Make the BA Workspace and SA Workspace fully functional. The backend (`document-svc` on port 8084) is already complete — all CRUD, versioning, comments, templates, Cedar ABAC, and RLS are implemented. What's missing is:

1. The `metadata` JSONB column (added by migration `00004_metadata_templates.sql`) is not wired through the Go domain/store/API layer.
2. `DocEditor.tsx` does not render Mermaid code blocks as diagrams (the ER Diagram and Sequence Diagram system templates already embed mermaid syntax).
3. `WorkspaceShell.tsx` has no structured panels for ADR voting (SA), User Story acceptance criteria (BA), or RTM linkage (BA).
4. `document-svc` store tests hardcode `:5433` instead of the native dev port `:5432`.

---

## Architecture

All structured panel data (ADR votes, User Story fields, RTM rows) is stored in `document.metadata` JSONB, which already exists in the database. No new migrations, no new services, no new Go packages. The flow is:

```
User edits panel → PATCH /api/documents/{id} with { metadata: {...}, version: n }
  → Next.js proxy → document-svc patchDocument
  → UPDATE document SET metadata=$1 ...
  → Response includes updated metadata
  → WorkspaceShell re-renders panel
```

Mermaid rendering is purely client-side: the TipTap editor already stores code blocks with `language: "mermaid"` in the `body` JSON. DocEditor detects these and calls `mermaid.render()` via `useEffect`, displaying the SVG below the code block.

---

## File Structure

```
Modified (Go):
  services/document-svc/internal/domain/types.go       add Metadata field to Document
  services/document-svc/internal/store/documents.go    add metadata to SELECT + UPDATE
  services/document-svc/internal/api/handlers.go       add Metadata to patchDocumentReq + apply
  services/document-svc/internal/store/*_test.go (5)   fix :5433 → :5432

New (npm):
  apps/web/package.json                                 add mermaid dependency

Modified (Frontend):
  apps/web/src/components/DocEditor.tsx                 Mermaid rendering for code blocks
  apps/web/src/components/WorkspaceShell.tsx            ADR, User Story, RTM panels
```

No new migrations. No new proxy routes. No new npm packages beyond `mermaid`.

---

## Section 1: Backend — wire `metadata` field

### domain/types.go

Add one field to `Document`:

```go
type Document struct {
    // ... existing fields ...
    Metadata map[string]any // stored as JSONB; nil means no structured metadata yet
}
```

### store/documents.go

In every SELECT that scans a `Document`, add `metadata` to the column list and scan:

```sql
SELECT id, tenant_id, workspace_id, project_id, type, title, body, metadata, status,
       owner_id, tags, current_version_id, created_at, updated_at, version
```

Scan addition (after `bodyBytes`):
```go
var metaBytes []byte
// ... scan ..., &metaBytes, ...
d.Metadata = fromJSON(metaBytes) // fromJSON already exists in the store package
```

In `Update()`, add `metadata` to the SET clause:
```sql
UPDATE document SET title=$2, body=$3, metadata=$4, status=$5, owner_id=$6,
       tags=$7, updated_at=now(), version=version+1
WHERE id=$1 AND tenant_id=$8 AND version=$9 AND deleted_at IS NULL
```

### api/handlers.go — patchDocumentReq

```go
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

In `patchDocument`, add after the Body block:
```go
if req.Metadata != nil {
    d.Metadata = req.Metadata
}
```

### store test DSN fix

All 5 test files in `internal/store/` hardcode `localhost:5433`. Change to `localhost:5432` to match native dev.

---

## Section 2: Mermaid rendering in DocEditor

Install: `pnpm add mermaid` in `apps/web`.

**Approach:** A `MermaidBlock` React component renders inside `DocEditor` for code blocks where `language === "mermaid"`. It calls `mermaid.render()` in a `useEffect` and shows the resulting SVG. A toggle button switches between "Diagram" and "Source" views.

```tsx
// Inside DocEditor, detect mermaid code blocks via TipTap's lowlight/CodeBlock extension
// When language === "mermaid": render a collapsible preview below the code block

function MermaidPreview({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid.render(id, code).then(({ svg }) => {
      if (ref.current) ref.current.innerHTML = svg;
    }).catch(() => {
      if (ref.current) ref.current.textContent = "⚠ Diagram syntax error";
    });
  }, [code]);
  return <div ref={ref} className="my-2 overflow-x-auto" />;
}
```

TipTap stores code blocks as `{ type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: "..." }] }`. DocEditor already renders the body JSON to `EditorContent`. To intercept mermaid blocks, we add a custom TipTap Node extension that replaces the default code block renderer for `language="mermaid"` with a `ReactNodeViewRenderer` that shows both the editable code and the live preview below it.

Initialization: `mermaid.initialize({ startOnLoad: false, theme: "neutral" })` once at module level.

---

## Section 3: ADR Voting Panel (SA Workspace)

**Trigger:** Rendered in `WorkspaceShell.tsx` when `activeDoc.type === "adr"`, inside a collapsible sidebar panel labeled "Team Votes".

**Data shape** stored in `document.metadata.votes`:
```ts
interface ADRVote {
  userId: string;   // from JWT sub (via useAuth)
  choice: "approve" | "reject" | "abstain";
  comment: string;
  votedAt: string;  // ISO timestamp
}
// document.metadata.votes: ADRVote[]
```

**UI:**
- Three buttons: ✓ Approve / ✗ Reject / ~ Abstain
- Current user's existing vote is highlighted
- Vote tally: "3 approve · 1 reject · 0 abstain"
- List of votes with user ID + comment (truncated to 60 chars)
- Comment input (optional, max 140 chars) before casting vote

**Write flow:**
1. User clicks a choice button (optionally adds comment)
2. Optimistic: update local `metadata.votes` immediately
3. PATCH `/api/documents/{id}` with `{ metadata: { ...doc.metadata, votes: newVotes }, version: doc.version }`
4. On conflict (409): reload document, re-render panel

---

## Section 4: User Story Panel (BA Workspace)

**Trigger:** Rendered when `activeDoc.type === "user_story"`, above the editor body.

**Data shape** stored in `document.metadata.user_story`:
```ts
interface UserStoryMeta {
  role: string;      // "As a [role]"
  want: string;      // "I want [capability]"
  benefit: string;   // "So that [outcome]"
  criteria: Array<{ given: string; when: string; then: string }>;
}
```

**UI:**
- Three labelled text inputs: "As a" / "I want" / "So that" — full-width, auto-save on blur
- Acceptance Criteria table with Add / Remove row buttons
- Each row has three cells: Given / When / Then (inline editable)
- Panel auto-saves on blur or row change (debounced 500 ms)

---

## Section 5: RTM Panel (BA Workspace)

**Trigger:** Rendered when `activeDoc.type === "rtm"`, below the editor body.

**Data shape** stored in `document.metadata.rtm`:
```ts
interface RTMRow {
  id: string;          // local UUID for React key
  reqId: string;       // e.g. "BR-001"
  description: string;
  priority: "high" | "medium" | "low";
  linkedIds: string;   // free-text: "US-001, US-002"
  status: "open" | "in_progress" | "verified" | "deferred";
}
// document.metadata.rtm: RTMRow[]
```

**UI:**
- Full-width table below editor: Req ID | Description | Priority | Linked Stories | Status | Delete
- "+ Add Requirement" button appends blank row
- Inline editable cells (contentEditable or input on focus)
- Auto-save on blur (debounced 500 ms)
- Export to CSV button (client-side only, via Blob URL)

---

## Error handling

- **PATCH 409 conflict:** reload document and re-render panel with fresh data; show toast "Updated by someone else — your changes were discarded."
- **PATCH 500:** show inline error, keep panel state so user can retry
- **Mermaid parse error:** show "⚠ Diagram syntax error" in the preview area; code block remains editable

---

## Testing

### Go (document-svc)
- `TestPatchDocumentMetadata` in `internal/api/handlers_test.go`: seed doc, PATCH with `{"metadata":{"votes":[]},"version":1}`, assert 200 and metadata echoed in response
- `TestPatchDocumentMetadata_Conflict`: PATCH with wrong version, assert 409
- Fix store test DSN from `:5433` → `:5432` (5 files)

### TypeScript (apps/web)
- Update `notifications.test.ts` → already done (Plan #5)
- Add `src/components/DocEditor.test.tsx`: render `<DocEditor>` with a mermaid code block in body, assert mermaid container rendered (mock `mermaid.render`)
- Panel tests live inside `WorkspaceShell` — add to `DocEditor.test.tsx` or a new `PanelADR.test.tsx` etc. (mock `updateDocument`)

---

## Out of scope (deferred)

- Task-level RTM linking (requires cross-service call to project-svc) — deferred to a future plan
- ADR voting identity resolution (showing display names, not just user IDs) — deferred until user directory API lands
- Mermaid export to PNG/SVG file — deferred
- Expert workspace panels (knowledge article, expertise profile) — deferred
