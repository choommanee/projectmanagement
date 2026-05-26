package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/hr-svc/internal/domain"
	"github.com/pmplatform/services/hr-svc/internal/service"
	"github.com/pmplatform/services/hr-svc/internal/store"
)

var initURLParam = sync.OnceFunc(func() {
	libauth.URLParam = chi.URLParam
})

// NewRouter wires the hr-svc HTTP surface.
// authz is the Cedar-backed authorizer used to gate write endpoints.
// When nil the RequireAction middleware becomes a no-op.
func NewRouter(svc *service.Service, authz libauth.Authorizer) http.Handler {
	initURLParam()

	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	r.Route("/v1", func(r chi.Router) {
		// Departments
		r.Get("/departments", listDepartments(svc))
		r.With(libauth.RequireAction(authz, "hr.department.create", "*")).Post("/departments", createDepartment(svc))
		r.Get("/departments/{id}", getDepartment(svc))
		r.With(libauth.RequireAction(authz, "hr.department.update", "*")).Patch("/departments/{id}", updateDepartment(svc))
		r.With(libauth.RequireAction(authz, "hr.department.delete", "*")).Delete("/departments/{id}", deleteDepartment(svc))

		// Positions
		r.Get("/positions", listPositions(svc))
		r.With(libauth.RequireAction(authz, "hr.position.create", "*")).Post("/positions", createPosition(svc))
		r.Get("/positions/{id}", getPosition(svc))
		r.With(libauth.RequireAction(authz, "hr.position.update", "*")).Patch("/positions/{id}", updatePosition(svc))
		r.With(libauth.RequireAction(authz, "hr.position.delete", "*")).Delete("/positions/{id}", deletePosition(svc))

		// Employees
		r.Get("/employees", listEmployees(svc))
		r.With(libauth.RequireAction(authz, "hr.employee.create", "*")).Post("/employees", createEmployee(svc))
		r.Get("/employees/{id}", getEmployee(svc))
		r.With(libauth.RequireAction(authz, "hr.employee.update", "*")).Patch("/employees/{id}", updateEmployee(svc))
		r.With(libauth.RequireAction(authz, "hr.employee.terminate", "*")).Post("/employees/{id}/terminate", terminateEmployee(svc))
	})

	return r
}

func tenantOr400(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	raw := r.Header.Get("X-Tenant-Id")
	tid, err := uuid.Parse(raw)
	if err != nil {
		writeErr(w, 400, errors.New("X-Tenant-Id required"))
		return uuid.Nil, false
	}
	return tid, true
}

// ---- Departments ----

type createDeptReq struct {
	Code     string     `json:"code"`
	Name     string     `json:"name"`
	ParentID *uuid.UUID `json:"parent_id,omitempty"`
	Active   *bool      `json:"active,omitempty"`
}

func createDepartment(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createDeptReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Code == "" || req.Name == "" {
			writeErr(w, 400, errors.New("code and name required"))
			return
		}
		active := true
		if req.Active != nil {
			active = *req.Active
		}
		d := &domain.Department{
			TenantID: tid,
			Code:     req.Code,
			Name:     req.Name,
			ParentID: req.ParentID,
			Active:   active,
		}
		if err := svc.Departments.Create(r.Context(), d); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, d)
	}
}

func getDepartment(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		d, err := svc.Departments.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, d)
	}
}

func listDepartments(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListDepartmentOpts{
			Query:  r.URL.Query().Get("q"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		items, total, err := svc.Departments.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateDeptReq struct {
	Name     string     `json:"name,omitempty"`
	ParentID *uuid.UUID `json:"parent_id,omitempty"`
	Active   *bool      `json:"active,omitempty"`
	Version  int        `json:"version"`
}

func updateDepartment(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		cur, err := svc.Departments.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updateDeptReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateDepartmentInput{
			Name:     cur.Name,
			ParentID: cur.ParentID,
			Active:   cur.Active,
			Version:  req.Version,
		}
		if req.Name != "" {
			in.Name = req.Name
		}
		if req.ParentID != nil {
			in.ParentID = req.ParentID
		}
		if req.Active != nil {
			in.Active = *req.Active
		}
		d, err := svc.Departments.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, d)
	}
}

func deleteDepartment(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		version, _ := strconv.Atoi(r.URL.Query().Get("version"))
		if version <= 0 {
			writeErr(w, 400, errors.New("version query param required"))
			return
		}
		if err := svc.Departments.Delete(r.Context(), tid, id, version); err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		w.WriteHeader(204)
	}
}

// ---- Positions ----

type createPosReq struct {
	Code   string `json:"code"`
	Name   string `json:"name"`
	Grade  string `json:"grade,omitempty"`
	Active *bool  `json:"active,omitempty"`
}

func createPosition(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createPosReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Code == "" || req.Name == "" {
			writeErr(w, 400, errors.New("code and name required"))
			return
		}
		active := true
		if req.Active != nil {
			active = *req.Active
		}
		pos := &domain.Position{
			TenantID: tid,
			Code:     req.Code,
			Name:     req.Name,
			Grade:    req.Grade,
			Active:   active,
		}
		if err := svc.Positions.Create(r.Context(), pos); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, pos)
	}
}

func getPosition(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		pos, err := svc.Positions.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, pos)
	}
}

func listPositions(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListPositionOpts{
			Query:  r.URL.Query().Get("q"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		items, total, err := svc.Positions.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updatePosReq struct {
	Name    string `json:"name,omitempty"`
	Grade   string `json:"grade,omitempty"`
	Active  *bool  `json:"active,omitempty"`
	Version int    `json:"version"`
}

func updatePosition(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		cur, err := svc.Positions.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updatePosReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdatePositionInput{
			Name:    cur.Name,
			Grade:   cur.Grade,
			Active:  cur.Active,
			Version: req.Version,
		}
		if req.Name != "" {
			in.Name = req.Name
		}
		if req.Grade != "" {
			in.Grade = req.Grade
		}
		if req.Active != nil {
			in.Active = *req.Active
		}
		pos, err := svc.Positions.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, pos)
	}
}

func deletePosition(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		version, _ := strconv.Atoi(r.URL.Query().Get("version"))
		if version <= 0 {
			writeErr(w, 400, errors.New("version query param required"))
			return
		}
		if err := svc.Positions.Delete(r.Context(), tid, id, version); err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		w.WriteHeader(204)
	}
}

// ---- Employees ----

type createEmpReq struct {
	EmpNo        string            `json:"emp_no"`
	FirstName    string            `json:"first_name"`
	LastName     string            `json:"last_name"`
	Email        string            `json:"email,omitempty"`
	Phone        string            `json:"phone,omitempty"`
	DepartmentID *uuid.UUID        `json:"department_id,omitempty"`
	PositionID   *uuid.UUID        `json:"position_id,omitempty"`
	Status       domain.EmpStatus  `json:"status,omitempty"`
	HireDate     *string           `json:"hire_date,omitempty"`
}

func createEmployee(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createEmpReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.EmpNo == "" || req.FirstName == "" || req.LastName == "" {
			writeErr(w, 400, errors.New("emp_no, first_name, and last_name required"))
			return
		}
		if req.Status == "" {
			req.Status = domain.EmpStatusActive
		}
		e := &domain.Employee{
			TenantID:     tid,
			EmpNo:        req.EmpNo,
			FirstName:    req.FirstName,
			LastName:     req.LastName,
			Email:        req.Email,
			Phone:        req.Phone,
			DepartmentID: req.DepartmentID,
			PositionID:   req.PositionID,
			Status:       req.Status,
			HireDate:     time.Now(),
		}
		if req.HireDate != nil {
			if t, err := time.Parse("2006-01-02", *req.HireDate); err == nil {
				e.HireDate = t
			}
		}
		if err := svc.Employees.Create(r.Context(), e); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, e)
	}
}

func getEmployee(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		e, err := svc.Employees.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, e)
	}
}

func listEmployees(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListEmployeeOpts{
			Query:  r.URL.Query().Get("q"),
			Status: r.URL.Query().Get("status"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		if s := r.URL.Query().Get("dept_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				opts.DepartmentID = &id
			}
		}
		items, total, err := svc.Employees.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateEmpReq struct {
	FirstName    string           `json:"first_name,omitempty"`
	LastName     string           `json:"last_name,omitempty"`
	Email        string           `json:"email,omitempty"`
	Phone        string           `json:"phone,omitempty"`
	DepartmentID *uuid.UUID       `json:"department_id,omitempty"`
	PositionID   *uuid.UUID       `json:"position_id,omitempty"`
	Status       domain.EmpStatus `json:"status,omitempty"`
	Version      int              `json:"version"`
}

func updateEmployee(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		cur, err := svc.Employees.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updateEmpReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateEmployeeInput{
			FirstName:    cur.FirstName,
			LastName:     cur.LastName,
			Email:        cur.Email,
			Phone:        cur.Phone,
			DepartmentID: cur.DepartmentID,
			PositionID:   cur.PositionID,
			Status:       cur.Status,
			Version:      req.Version,
		}
		if req.FirstName != "" {
			in.FirstName = req.FirstName
		}
		if req.LastName != "" {
			in.LastName = req.LastName
		}
		if req.Email != "" {
			in.Email = req.Email
		}
		if req.Phone != "" {
			in.Phone = req.Phone
		}
		if req.DepartmentID != nil {
			in.DepartmentID = req.DepartmentID
		}
		if req.PositionID != nil {
			in.PositionID = req.PositionID
		}
		if req.Status != "" {
			in.Status = req.Status
		}
		e, err := svc.Employees.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, e)
	}
}

type terminateEmpReq struct {
	TerminationDate *string `json:"termination_date,omitempty"`
	Version         int     `json:"version"`
}

func terminateEmployee(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req terminateEmpReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Version <= 0 {
			writeErr(w, 400, errors.New("version required"))
			return
		}
		terminationDate := time.Now()
		if req.TerminationDate != nil {
			if t, err := time.Parse("2006-01-02", *req.TerminationDate); err == nil {
				terminationDate = t
			}
		}
		e, err := svc.Employees.Terminate(r.Context(), tid, id, terminationDate, req.Version)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, e)
	}
}

// ---- Helpers ----

func atoiOr(s string, def int) int {
	if v, err := strconv.Atoi(s); err == nil {
		return v
	}
	return def
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}
