#!/usr/bin/env bash
# seed-templates.sh — Idempotent seed script for document templates.
# Usage: TENANT_ID=<uuid> ./tools/scripts/seed-templates.sh
# Or set X_TENANT_ID env var. Falls back to resolving demo-co from tenant-svc.

set -euo pipefail

DOC_SVC="${DOCUMENT_URL:-http://localhost:8084}"
TENANT_SVC="${TENANT_URL:-http://localhost:8081}"

# ─── Resolve tenant ID ─────────────────────────────────────────────────────────

if [ -n "${TENANT_ID:-}" ]; then
  TID="$TENANT_ID"
elif [ -n "${X_TENANT_ID:-}" ]; then
  TID="$X_TENANT_ID"
else
  echo "Resolving demo-co tenant from $TENANT_SVC …"
  TID=$(curl -sf "$TENANT_SVC/v1/tenants" | python3 -c '
import json, sys
tenants = json.load(sys.stdin)
arr = tenants.get("items", tenants) if isinstance(tenants, dict) else tenants
for t in arr:
    slug = t.get("Slug") or t.get("slug") or ""
    if slug == "demo-co":
        print(t.get("ID") or t.get("id", ""))
        sys.exit(0)
print("")
' 2>/dev/null || true)
  if [ -z "$TID" ]; then
    echo "ERROR: Could not resolve demo-co tenant. Pass TENANT_ID=<uuid> explicitly."
    exit 1
  fi
fi

echo "Using tenant: $TID"

# ─── Helpers ───────────────────────────────────────────────────────────────────

# Fetch existing templates once
EXISTING=$(curl -sf -H "X-Tenant-Id: $TID" "$DOC_SVC/v1/templates" || echo '[]')

template_exists() {
  local type="$1"
  local name="$2"
  echo "$EXISTING" | python3 -c "
import json, sys
data = json.load(sys.stdin)
arr = data.get('items', data) if isinstance(data, dict) else data
for t in arr:
    tp = t.get('Type') or t.get('type') or ''
    nm = t.get('Name') or t.get('name') or ''
    if tp == '$type' and nm == '$name':
        print('exists')
        sys.exit(0)
print('missing')
" 2>/dev/null || echo "missing"
}

post_template() {
  local type="$1"
  local name="$2"
  local body="$3"

  if [ "$(template_exists "$type" "$name")" = "exists" ]; then
    echo "  SKIP  [$type] $name (already exists)"
    return
  fi

  payload=$(python3 -c "
import json, sys
print(json.dumps({'type': sys.argv[1], 'name': sys.argv[2], 'body': json.loads(sys.argv[3])}))
" "$type" "$name" "$body")

  result=$(curl -sf -X POST \
    -H "Content-Type: application/json" \
    -H "X-Tenant-Id: $TID" \
    -d "$payload" \
    "$DOC_SVC/v1/templates" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('ID') or d.get('id', '?'))
" 2>/dev/null || echo "error")

  echo "  CREATE [$type] $name → id=$result"
}

# ─── BRD Template ─────────────────────────────────────────────────────────────

BRD_BODY='{"type":"doc","content":[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Business Requirements Document"}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"1. Overview"}]},{"type":"paragraph","content":[{"type":"text","text":"Describe the business problem and goal."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"2. Stakeholders"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Primary stakeholder"}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"3. Requirements"}]},{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Functional requirement 1"}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"4. Acceptance Criteria"}]},{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Criterion 1"}]}]}]}]}'

# ─── SDD Template ─────────────────────────────────────────────────────────────

SDD_BODY='{"type":"doc","content":[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Software Design Document"}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"1. Purpose"}]},{"type":"paragraph","content":[{"type":"text","text":"Describe what this system or module does."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"2. Architecture Overview"}]},{"type":"paragraph","content":[{"type":"text","text":"High-level architecture description."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"3. Components"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Component A — responsibility"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Component B — responsibility"}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"4. Data Flow"}]},{"type":"paragraph","content":[{"type":"text","text":"Describe how data flows between components."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"5. API Contracts"}]},{"type":"paragraph","content":[{"type":"text","text":"List key endpoints or interface contracts."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"6. Open Questions"}]},{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Open question 1"}]}]}]}]}'

# ─── ADR Template ─────────────────────────────────────────────────────────────

ADR_BODY='{"type":"doc","content":[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Architecture Decision Record"}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Status"}]},{"type":"paragraph","content":[{"type":"text","text":"Proposed | Accepted | Deprecated | Superseded by ADR-XXX"}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Context"}]},{"type":"paragraph","content":[{"type":"text","text":"Describe the problem, forces, and context driving this decision."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Decision"}]},{"type":"paragraph","content":[{"type":"text","text":"State the decision made."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Alternatives Considered"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Option A — pros/cons"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Option B — pros/cons"}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Consequences"}]},{"type":"paragraph","content":[{"type":"text","text":"Describe positive and negative consequences of this decision."}]}]}'

# ─── Knowledge Article Template ───────────────────────────────────────────────

KB_BODY='{"type":"doc","content":[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Knowledge Article"}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Summary"}]},{"type":"paragraph","content":[{"type":"text","text":"One-sentence description of this article."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Background"}]},{"type":"paragraph","content":[{"type":"text","text":"Provide context and background for the reader."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Details"}]},{"type":"paragraph","content":[{"type":"text","text":"Main body of the article."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Key Takeaways"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Key point 1"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Key point 2"}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Related Articles"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Link to related article"}]}]}]}]}'

# ─── Seed ──────────────────────────────────────────────────────────────────────

echo ""
echo "Seeding templates into $DOC_SVC …"
echo ""

post_template "brd"              "BRD Skeleton"              "$BRD_BODY"
post_template "sdd"              "SDD Skeleton"              "$SDD_BODY"
post_template "adr"              "ADR Skeleton"              "$ADR_BODY"
post_template "knowledge_article" "Knowledge Article Skeleton" "$KB_BODY"

echo ""
echo "Done."
