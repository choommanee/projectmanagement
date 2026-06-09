package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	libauth "github.com/pmplatform/libs/go/auth"
	libpolicy "github.com/pmplatform/libs/policy"

	"github.com/pmplatform/services/project-svc/internal/api"
	"github.com/pmplatform/services/project-svc/internal/service"
	"github.com/pmplatform/services/project-svc/internal/store"
)

// seedTaskForCedar creates a project + task directly via the stores under the
// given tenant and returns the task id.
func seedTaskForCedar(t *testing.T, p *pgxpool.Pool, tid uuid.UUID) uuid.UUID {
	t.Helper()
	pid := uuid.New()
	taskID := uuid.New()
	tx, err := p.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(context.Background())
	if _, e := tx.Exec(context.Background(), "SET LOCAL app.current_tenant = '"+tid.String()+"'"); e != nil {
		t.Fatalf("set local: %v", e)
	}
	if _, e := tx.Exec(context.Background(),
		`INSERT INTO project(id,tenant_id,code,name,status,version) VALUES ($1,$2,$3,$4,'active',1)`,
		pid, tid, "CWC-"+uuid.NewString()[:6], "Cedar CW"); e != nil {
		t.Fatalf("seed project: %v", e)
	}
	if _, e := tx.Exec(context.Background(),
		`INSERT INTO task(id,tenant_id,project_id,code,title,type,status,priority,version)
		 VALUES ($1,$2,$3,$4,$5,'task','todo','med',1)`,
		taskID, tid, pid, "CWT-"+uuid.NewString()[:6], "Cedar CW Task"); e != nil {
		t.Fatalf("seed task: %v", e)
	}
	if e := tx.Commit(context.Background()); e != nil {
		t.Fatalf("commit: %v", e)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid)
	})
	return taskID
}

func cwServer(t *testing.T, p *pgxpool.Pool, authz libauth.Authorizer, roles []string, tid uuid.UUID) http.Handler {
	t.Helper()
	svc := service.New(store.NewProjects(p), store.NewTasks(p), store.NewSprints(p))
	svc.Worklog = store.NewWorklogStore(p)
	svc.WithActivity(store.NewActivity(p))
	router := api.NewRouter(svc, authz)
	return withClaims(router, &libauth.ParsedClaims{
		Subject:  "sub-cw",
		TenantID: tid.String(),
		Roles:    roles,
		ExpireAt: time.Now().Add(5 * time.Minute),
	})
}

func TestCedarCommentUpdate_AllowsPM_DeniesOperator(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()
	tid := seedCedarTenant(t, p)

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	authz := &libpolicy.Adapter{Policies: ps}
	taskID := seedTaskForCedar(t, p, tid)

	// project-manager creates a comment, then edits it → allowed.
	h := cwServer(t, p, authz, []string{"project-manager"}, tid)
	authorID := uuid.New().String()
	body, _ := json.Marshal(map[string]any{"body": "hi", "author_id": authorID})
	req := httptest.NewRequest(http.MethodPost, "/v1/tasks/"+taskID.String()+"/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tid.String())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create comment: want 201 got %d: %s", rec.Code, rec.Body.String())
	}
	var c map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &c)
	cid := c["id"].(string)

	editBody, _ := json.Marshal(map[string]any{"body": "edited", "version": 1})
	req = httptest.NewRequest(http.MethodPatch, "/v1/comments/"+cid, bytes.NewReader(editBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tid.String())
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("pm comment update: want 200 got %d: %s", rec.Code, rec.Body.String())
	}

	// mfg-operator (no permit) attempts delete → 403.
	hOp := cwServer(t, p, authz, []string{"mfg-operator"}, tid)
	req = httptest.NewRequest(http.MethodDelete, "/v1/comments/"+cid+"?version=2", nil)
	req.Header.Set("X-Tenant-Id", tid.String())
	rec = httptest.NewRecorder()
	hOp.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("operator comment delete: want 403 got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCedarWorklogUpdate_AllowsAdmin_DeniesOperator(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()
	tid := seedCedarTenant(t, p)

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	authz := &libpolicy.Adapter{Policies: ps}
	taskID := seedTaskForCedar(t, p, tid)

	hAdmin := cwServer(t, p, authz, []string{"tenant-admin"}, tid)
	userID := uuid.New().String()
	body, _ := json.Marshal(map[string]any{"user_id": userID, "logged_md": 1.0, "work_date": "2026-05-25"})
	req := httptest.NewRequest(http.MethodPost, "/v1/tasks/"+taskID.String()+"/worklogs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tid.String())
	rec := httptest.NewRecorder()
	hAdmin.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create worklog: want 201 got %d: %s", rec.Code, rec.Body.String())
	}
	var e map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &e)
	wid := e["id"].(string)

	editBody, _ := json.Marshal(map[string]any{"logged_md": 2.0, "version": 1})
	req = httptest.NewRequest(http.MethodPatch, "/v1/worklogs/"+wid, bytes.NewReader(editBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tid.String())
	rec = httptest.NewRecorder()
	hAdmin.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin worklog update: want 200 got %d: %s", rec.Code, rec.Body.String())
	}

	hOp := cwServer(t, p, authz, []string{"mfg-operator"}, tid)
	req = httptest.NewRequest(http.MethodPatch, "/v1/worklogs/"+wid, bytes.NewReader(editBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tid.String())
	rec = httptest.NewRecorder()
	hOp.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("operator worklog update: want 403 got %d: %s", rec.Code, rec.Body.String())
	}
}
