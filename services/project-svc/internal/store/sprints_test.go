package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/project-svc/internal/domain"
	"github.com/pmplatform/services/project-svc/internal/store"
)

func TestSprintCreate(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)

	projects := store.NewProjects(p)
	proj := createTestProject(t, projects, tid, "SP-P001")
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID) })

	sprints := store.NewSprints(p)
	sp := &domain.Sprint{
		ID:       uuid.New(),
		TenantID: tid,
		ProjectID: proj.ID,
		Name:     "Sprint 1",
		Goal:     "Launch MVP",
		Status:   domain.SprintPlanning,
		Version:  1,
	}
	if err := sprints.Create(context.Background(), sp); err != nil {
		t.Fatalf("Create sprint: %v", err)
	}
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM sprint WHERE id=$1", sp.ID) })

	items, err := sprints.List(context.Background(), tid, proj.ID)
	if err != nil {
		t.Fatalf("List sprints: %v", err)
	}
	if len(items) != 1 || items[0].Name != "Sprint 1" {
		t.Fatalf("expected 1 sprint named 'Sprint 1', got %d items", len(items))
	}
}

func TestSprintList(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)

	projects := store.NewProjects(p)
	proj := createTestProject(t, projects, tid, "SP-P002")
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID) })

	sprints := store.NewSprints(p)
	for i := 0; i < 3; i++ {
		sp := &domain.Sprint{
			ID: uuid.New(), TenantID: tid, ProjectID: proj.ID,
			Name: "Sprint " + string(rune('A'+i)), Status: domain.SprintPlanning, Version: 1,
		}
		_ = sprints.Create(context.Background(), sp)
		t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM sprint WHERE id=$1", sp.ID) })
	}

	items, err := sprints.List(context.Background(), tid, proj.ID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("expected 3 sprints, got %d", len(items))
	}
}

func TestSprintGetByID(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)

	projects := store.NewProjects(p)
	proj := createTestProject(t, projects, tid, "SP-P004")
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID) })

	sprints := store.NewSprints(p)
	sp := &domain.Sprint{
		ID: uuid.New(), TenantID: tid, ProjectID: proj.ID,
		Name: "GetByID Sprint", Goal: "Test Goal", Status: domain.SprintPlanning, Version: 1,
	}
	if err := sprints.Create(context.Background(), sp); err != nil {
		t.Fatalf("Create: %v", err)
	}
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM sprint WHERE id=$1", sp.ID) })

	got, err := sprints.GetByID(context.Background(), tid, sp.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.ID != sp.ID {
		t.Fatalf("expected ID %v, got %v", sp.ID, got.ID)
	}
	if got.Name != "GetByID Sprint" {
		t.Fatalf("expected name 'GetByID Sprint', got %q", got.Name)
	}
	if got.Goal != "Test Goal" {
		t.Fatalf("expected goal 'Test Goal', got %q", got.Goal)
	}
}

func TestSprintTasksAfterAssign(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)

	projects := store.NewProjects(p)
	proj := createTestProject(t, projects, tid, "SP-P005")
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID) })

	sprints := store.NewSprints(p)
	sp := &domain.Sprint{
		ID: uuid.New(), TenantID: tid, ProjectID: proj.ID,
		Name: "Tasks Sprint", Status: domain.SprintPlanning, Version: 1,
	}
	_ = sprints.Create(context.Background(), sp)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM sprint WHERE id=$1", sp.ID) })

	tasks := store.NewTasks(p)
	task := &domain.Task{
		ID: uuid.New(), TenantID: tid, ProjectID: proj.ID,
		Code: "SP-T002", Title: "Tasks sprint task",
		Type: domain.TaskTypeTask, Status: domain.TaskTodo,
		Priority: domain.PrioMed, Tags: []string{}, Version: 1,
	}
	_ = tasks.Create(context.Background(), task)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", task.ID) })

	// Before assign, Tasks returns empty
	items, err := sprints.Tasks(context.Background(), tid, sp.ID)
	if err != nil {
		t.Fatalf("Tasks before assign: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected 0 tasks before assign, got %d", len(items))
	}

	if err := sprints.AssignTask(context.Background(), tid, sp.ID, task.ID); err != nil {
		t.Fatalf("AssignTask: %v", err)
	}

	// After assign, Tasks returns 1
	items, err = sprints.Tasks(context.Background(), tid, sp.ID)
	if err != nil {
		t.Fatalf("Tasks after assign: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 task after assign, got %d", len(items))
	}
	if items[0].ID != task.ID {
		t.Fatalf("expected task ID %v, got %v", task.ID, items[0].ID)
	}

	// Unassign clears
	if err := sprints.UnassignTask(context.Background(), tid, sp.ID, task.ID); err != nil {
		t.Fatalf("UnassignTask: %v", err)
	}
	items, err = sprints.Tasks(context.Background(), tid, sp.ID)
	if err != nil {
		t.Fatalf("Tasks after unassign: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected 0 tasks after unassign, got %d", len(items))
	}
}

func TestSprintAssignUnassignTask(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)

	projects := store.NewProjects(p)
	proj := createTestProject(t, projects, tid, "SP-P003")
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID) })

	sprints := store.NewSprints(p)
	sp := &domain.Sprint{
		ID: uuid.New(), TenantID: tid, ProjectID: proj.ID,
		Name: "Sprint Assign", Status: domain.SprintPlanning, Version: 1,
	}
	_ = sprints.Create(context.Background(), sp)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM sprint WHERE id=$1", sp.ID) })

	tasks := store.NewTasks(p)
	task := &domain.Task{
		ID: uuid.New(), TenantID: tid, ProjectID: proj.ID,
		Code: "SP-T001", Title: "Task to assign",
		Type: domain.TaskTypeTask, Status: domain.TaskTodo,
		Priority: domain.PrioMed, Tags: []string{}, Version: 1,
	}
	_ = tasks.Create(context.Background(), task)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", task.ID) })

	if err := sprints.AssignTask(context.Background(), tid, sp.ID, task.ID); err != nil {
		t.Fatalf("AssignTask: %v", err)
	}

	var count int
	p.QueryRow(context.Background(), "SELECT count(*) FROM sprint_task WHERE sprint_id=$1 AND task_id=$2", sp.ID, task.ID).Scan(&count)
	if count != 1 {
		t.Fatal("task not found in sprint_task")
	}

	// idempotent
	if err := sprints.AssignTask(context.Background(), tid, sp.ID, task.ID); err != nil {
		t.Fatalf("AssignTask idempotent: %v", err)
	}

	if err := sprints.UnassignTask(context.Background(), tid, sp.ID, task.ID); err != nil {
		t.Fatalf("UnassignTask: %v", err)
	}
	p.QueryRow(context.Background(), "SELECT count(*) FROM sprint_task WHERE sprint_id=$1 AND task_id=$2", sp.ID, task.ID).Scan(&count)
	if count != 0 {
		t.Fatal("task still in sprint after unassign")
	}
}
