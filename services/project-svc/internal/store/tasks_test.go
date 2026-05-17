package store_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/project-svc/internal/domain"
	"github.com/pmplatform/services/project-svc/internal/store"
)

func createTestProject(t *testing.T, projects *store.Projects, tid uuid.UUID, code string) *domain.Project {
	t.Helper()
	proj := &domain.Project{
		ID: uuid.New(), TenantID: tid, Code: code,
		Name: "Test Project " + code, Status: domain.ProjectPlanning,
		Tags: []string{}, Settings: map[string]any{}, Version: 1,
	}
	if err := projects.Create(context.Background(), proj); err != nil {
		t.Fatalf("createTestProject: %v", err)
	}
	return proj
}

func TestTaskCreate(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)

	projects := store.NewProjects(p)
	proj := createTestProject(t, projects, tid, "TK-P001")
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID) })

	tasks := store.NewTasks(p)
	task := &domain.Task{
		ID: uuid.New(), TenantID: tid, ProjectID: proj.ID,
		Code: "TK-0001", Title: "Test Task",
		Type: domain.TaskTypeTask, Status: domain.TaskTodo,
		Priority: domain.PrioMed, Tags: []string{}, Version: 1,
	}
	if err := tasks.Create(context.Background(), task); err != nil {
		t.Fatalf("Create task: %v", err)
	}
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", task.ID) })

	got, err := tasks.GetByID(context.Background(), tid, task.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Code != "TK-0001" {
		t.Fatalf("expected TK-0001, got %s", got.Code)
	}
	if got.Title != "Test Task" {
		t.Fatalf("expected Test Task, got %s", got.Title)
	}
}

func TestTaskListByProject(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)

	projects := store.NewProjects(p)
	proj := createTestProject(t, projects, tid, "TK-P002")
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID) })

	tasks := store.NewTasks(p)
	marker := uuid.NewString()[:6]
	for i := 0; i < 3; i++ {
		task := &domain.Task{
			ID: uuid.New(), TenantID: tid, ProjectID: proj.ID,
			Code: fmt.Sprintf("L%s-%04d", marker, i), Title: fmt.Sprintf("Task %d", i),
			Type: domain.TaskTypeTask, Status: domain.TaskTodo,
			Priority: domain.PrioMed, Tags: []string{}, Version: 1,
		}
		if err := tasks.Create(context.Background(), task); err != nil {
			t.Fatalf("Create: %v", err)
		}
		t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", task.ID) })
	}

	items, total, err := tasks.List(context.Background(), tid, store.ListTasksOpts{
		ProjectID: &proj.ID, Limit: 10,
	})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 3 || len(items) != 3 {
		t.Fatalf("expected 3/3, got %d/%d", len(items), total)
	}
}

func TestTaskListByStatus(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)

	projects := store.NewProjects(p)
	proj := createTestProject(t, projects, tid, "TK-P003")
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID) })

	tasks := store.NewTasks(p)
	marker := uuid.NewString()[:6]

	t1 := &domain.Task{
		ID: uuid.New(), TenantID: tid, ProjectID: proj.ID,
		Code: fmt.Sprintf("S%s-001", marker), Title: "In Progress Task",
		Type: domain.TaskTypeTask, Status: domain.TaskInProgress,
		Priority: domain.PrioMed, Tags: []string{}, Version: 1,
	}
	t2 := &domain.Task{
		ID: uuid.New(), TenantID: tid, ProjectID: proj.ID,
		Code: fmt.Sprintf("S%s-002", marker), Title: "Todo Task",
		Type: domain.TaskTypeTask, Status: domain.TaskTodo,
		Priority: domain.PrioMed, Tags: []string{}, Version: 1,
	}
	_ = tasks.Create(context.Background(), t1)
	_ = tasks.Create(context.Background(), t2)
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", t1.ID)
		p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", t2.ID)
	})

	items, _, err := tasks.List(context.Background(), tid, store.ListTasksOpts{
		ProjectID: &proj.ID, Status: "in_progress", Limit: 10,
	})
	if err != nil {
		t.Fatalf("List by status: %v", err)
	}
	if len(items) != 1 || items[0].Status != domain.TaskInProgress {
		t.Fatalf("expected 1 in_progress task, got %d", len(items))
	}
}

func TestTaskListByAssignee(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)

	projects := store.NewProjects(p)
	proj := createTestProject(t, projects, tid, "TK-P004")
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID) })

	tasks := store.NewTasks(p)
	assigneeID := uuid.New()
	marker := uuid.NewString()[:6]

	ta := &domain.Task{
		ID: uuid.New(), TenantID: tid, ProjectID: proj.ID,
		Code: fmt.Sprintf("A%s-001", marker), Title: "Assigned Task",
		Type: domain.TaskTypeTask, Status: domain.TaskTodo,
		Priority: domain.PrioMed, AssigneeID: &assigneeID,
		Tags: []string{}, Version: 1,
	}
	tu := &domain.Task{
		ID: uuid.New(), TenantID: tid, ProjectID: proj.ID,
		Code: fmt.Sprintf("A%s-002", marker), Title: "Unassigned Task",
		Type: domain.TaskTypeTask, Status: domain.TaskTodo,
		Priority: domain.PrioMed, Tags: []string{}, Version: 1,
	}
	_ = tasks.Create(context.Background(), ta)
	_ = tasks.Create(context.Background(), tu)
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", ta.ID)
		p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", tu.ID)
	})

	items, _, err := tasks.List(context.Background(), tid, store.ListTasksOpts{
		ProjectID: &proj.ID, Assignee: &assigneeID, Limit: 10,
	})
	if err != nil {
		t.Fatalf("List by assignee: %v", err)
	}
	if len(items) != 1 || *items[0].AssigneeID != assigneeID {
		t.Fatalf("expected 1 assigned task, got %d", len(items))
	}
}

func TestTaskUpdate(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)

	projects := store.NewProjects(p)
	proj := createTestProject(t, projects, tid, "TK-P005")
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID) })

	tasks := store.NewTasks(p)
	task := &domain.Task{
		ID: uuid.New(), TenantID: tid, ProjectID: proj.ID,
		Code: "UPD-T001", Title: "Original",
		Type: domain.TaskTypeTask, Status: domain.TaskTodo,
		Priority: domain.PrioMed, Tags: []string{}, Version: 1,
	}
	_ = tasks.Create(context.Background(), task)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", task.ID) })

	task.Title = "Updated"
	task.Status = domain.TaskInProgress
	if err := tasks.Update(context.Background(), task); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if task.Version != 2 {
		t.Fatalf("expected version 2, got %d", task.Version)
	}
	got, _ := tasks.GetByID(context.Background(), tid, task.ID)
	if got.Title != "Updated" || got.Status != domain.TaskInProgress {
		t.Fatalf("unexpected task state: %+v", got)
	}
}

func TestTaskDependencyAddRemove(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)

	projects := store.NewProjects(p)
	proj := createTestProject(t, projects, tid, "TK-P006")
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID) })

	tasks := store.NewTasks(p)
	t1 := &domain.Task{
		ID: uuid.New(), TenantID: tid, ProjectID: proj.ID,
		Code: "DEP-T001", Title: "Predecessor",
		Type: domain.TaskTypeTask, Status: domain.TaskTodo,
		Priority: domain.PrioMed, Tags: []string{}, Version: 1,
	}
	t2 := &domain.Task{
		ID: uuid.New(), TenantID: tid, ProjectID: proj.ID,
		Code: "DEP-T002", Title: "Successor",
		Type: domain.TaskTypeTask, Status: domain.TaskTodo,
		Priority: domain.PrioMed, Tags: []string{}, Version: 1,
	}
	_ = tasks.Create(context.Background(), t1)
	_ = tasks.Create(context.Background(), t2)
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", t1.ID)
		p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", t2.ID)
	})

	dep := &domain.TaskDependency{
		ID:            uuid.New(),
		TenantID:      tid,
		PredecessorID: t1.ID,
		SuccessorID:   t2.ID,
		Type:          domain.DepFS,
		LagDays:       2,
	}
	if err := tasks.AddDependency(context.Background(), tid, dep); err != nil {
		t.Fatalf("AddDependency: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM task_dependency WHERE id=$1", dep.ID)
	})

	// Verify it exists
	var count int
	p.QueryRow(context.Background(), "SELECT count(*) FROM task_dependency WHERE id=$1", dep.ID).Scan(&count)
	if count != 1 {
		t.Fatal("dependency not found in DB")
	}

	// Remove
	if err := tasks.RemoveDependency(context.Background(), tid, dep.ID); err != nil {
		t.Fatalf("RemoveDependency: %v", err)
	}
	p.QueryRow(context.Background(), "SELECT count(*) FROM task_dependency WHERE id=$1", dep.ID).Scan(&count)
	if count != 0 {
		t.Fatal("dependency still exists after remove")
	}
}
