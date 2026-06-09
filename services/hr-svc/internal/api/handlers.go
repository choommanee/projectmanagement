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

		// Payslips
		r.Get("/payslips", listPayslips(svc))
		r.With(libauth.RequireAction(authz, "hr.payslip.create", "*")).Post("/payslips", createPayslip(svc))
		r.Get("/payslips/{id}", getPayslip(svc))
		r.With(libauth.RequireAction(authz, "hr.payslip.approve", "*")).Post("/payslips/{id}/approve", approvePayslip(svc))
		r.With(libauth.RequireAction(authz, "hr.payslip.pay", "*")).Post("/payslips/{id}/mark-paid", markPayslipPaid(svc))

		// Leave Requests
		r.Get("/leave-requests", listLeaveRequests(svc))
		r.With(libauth.RequireAction(authz, "hr.leave.create", "*")).Post("/leave-requests", createLeaveRequest(svc))
		r.Get("/leave-requests/{id}", getLeaveRequest(svc))
		r.With(libauth.RequireAction(authz, "hr.leave.approve", "*")).Post("/leave-requests/{id}/approve", approveLeaveRequest(svc))
		r.With(libauth.RequireAction(authz, "hr.leave.approve", "*")).Post("/leave-requests/{id}/reject", rejectLeaveRequest(svc))

		// Training
		r.Get("/training", listTraining(svc))
		r.With(libauth.RequireAction(authz, "hr.training.create", "*")).Post("/training", createTraining(svc))
		r.Get("/training/{id}", getTraining(svc))
		r.With(libauth.RequireAction(authz, "hr.training.update", "*")).Patch("/training/{id}", patchTraining(svc))

		// Jobs / Recruitment
		r.Get("/jobs", listJobs(svc))
		r.With(libauth.RequireAction(authz, "hr.job.create", "*")).Post("/jobs", createJob(svc))
		r.Get("/jobs/{id}", getJob(svc))
		r.With(libauth.RequireAction(authz, "hr.job.update", "*")).Patch("/jobs/{id}", patchJob(svc))
		r.Get("/jobs/{id}/applicants", listApplicants(svc))
		r.With(libauth.RequireAction(authz, "hr.applicant.create", "*")).Post("/jobs/{id}/applicants", createApplicant(svc))
		r.With(libauth.RequireAction(authz, "hr.applicant.update", "*")).Patch("/jobs/{id}/applicants/{applicantId}", patchApplicant(svc))

		// Performance Reviews
		r.Get("/performance-reviews", listPerformanceReviews(svc))
		r.With(libauth.RequireAction(authz, "hr.review.create", "*")).Post("/performance-reviews", createPerformanceReview(svc))
		r.Get("/performance-reviews/{id}", getPerformanceReview(svc))
		r.With(libauth.RequireAction(authz, "hr.review.update", "*")).Patch("/performance-reviews/{id}", patchPerformanceReview(svc))

		// Payroll Runs
		r.Get("/payroll-runs", listPayrollRuns(svc))
		r.With(libauth.RequireAction(authz, "hr.payroll_run.create", "*")).Post("/payroll-runs", createPayrollRun(svc))
		r.Get("/payroll-runs/{id}", getPayrollRun(svc))
		r.With(libauth.RequireAction(authz, "hr.payroll_run.update", "*")).Patch("/payroll-runs/{id}", patchPayrollRun(svc))
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
		emitAudit(svc, r, "hr.department.create", "department", d.ID.String(), nil,
			map[string]any{"code": d.Code, "name": d.Name})
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
		emitAudit(svc, r, "hr.department.update", "department", id.String(),
			map[string]any{"name": cur.Name, "active": cur.Active},
			map[string]any{"name": d.Name, "active": d.Active})
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
		emitAudit(svc, r, "hr.department.delete", "department", id.String(), nil, nil)
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
		emitAudit(svc, r, "hr.position.create", "position", pos.ID.String(), nil,
			map[string]any{"code": pos.Code, "name": pos.Name})
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
		emitAudit(svc, r, "hr.position.update", "position", id.String(),
			map[string]any{"name": cur.Name, "active": cur.Active},
			map[string]any{"name": pos.Name, "active": pos.Active})
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
		emitAudit(svc, r, "hr.position.delete", "position", id.String(), nil, nil)
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
		emitAudit(svc, r, "hr.employee.create", "employee", e.ID.String(), nil,
			map[string]any{"emp_no": e.EmpNo, "status": e.Status})
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
		emitAudit(svc, r, "hr.employee.update", "employee", id.String(),
			map[string]any{"status": cur.Status},
			map[string]any{"status": e.Status})
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
		emitAudit(svc, r, "hr.employee.terminate", "employee", id.String(), nil,
			map[string]any{"status": e.Status, "termination_date": terminationDate.Format("2006-01-02")})
		writeJSON(w, 200, e)
	}
}

// ---- Payslips ----

type createPayslipReq struct {
	EmployeeID  string  `json:"employee_id"`
	PeriodStart string  `json:"period_start"`
	PeriodEnd   string  `json:"period_end"`
	BaseSalary  float64 `json:"base_salary"`
	Allowances  float64 `json:"allowances"`
	Deductions  float64 `json:"deductions"`
	Currency    string  `json:"currency"`
}

func createPayslip(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createPayslipReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		empID, err := uuid.Parse(req.EmployeeID)
		if err != nil {
			writeErr(w, 400, errors.New("employee_id must be a valid UUID"))
			return
		}
		periodStart, err := time.Parse("2006-01-02", req.PeriodStart)
		if err != nil {
			writeErr(w, 400, errors.New("period_start must be YYYY-MM-DD"))
			return
		}
		periodEnd, err := time.Parse("2006-01-02", req.PeriodEnd)
		if err != nil {
			writeErr(w, 400, errors.New("period_end must be YYYY-MM-DD"))
			return
		}
		inp := domain.CreatePayslipInput{
			EmployeeID:  empID,
			PeriodStart: periodStart,
			PeriodEnd:   periodEnd,
			BaseSalary:  req.BaseSalary,
			Allowances:  req.Allowances,
			Deductions:  req.Deductions,
			Currency:    req.Currency,
		}
		ps, err := svc.Payslips.Create(r.Context(), tid, inp)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		emitAudit(svc, r, "hr.payslip.create", "payslip", ps.ID.String(), nil,
			map[string]any{"employee_id": empID.String(), "period_start": req.PeriodStart, "period_end": req.PeriodEnd})
		writeJSON(w, 201, ps)
	}
}

func getPayslip(svc *service.Service) http.HandlerFunc {
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
		ps, err := svc.Payslips.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, ps)
	}
}

func listPayslips(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var employeeID *uuid.UUID
		if s := r.URL.Query().Get("employee_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				employeeID = &id
			}
		}
		var status *domain.PayslipStatus
		if s := r.URL.Query().Get("status"); s != "" {
			v := domain.PayslipStatus(s)
			status = &v
		}
		limit := atoiOr(r.URL.Query().Get("limit"), 100)
		offset := atoiOr(r.URL.Query().Get("offset"), 0)
		items, total, err := svc.Payslips.List(r.Context(), tid, employeeID, status, limit, offset)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

func approvePayslip(svc *service.Service) http.HandlerFunc {
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
		var approvedBy *uuid.UUID
		if claims, ok := libauth.FromCtx(r.Context()); ok {
			if uid, err := uuid.Parse(claims.Subject); err == nil {
				approvedBy = &uid
			}
		}
		if err := svc.Payslips.UpdateStatus(r.Context(), tid, id, domain.PayslipApproved, approvedBy); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		emitAudit(svc, r, "hr.payslip.approve", "payslip", id.String(), nil,
			map[string]any{"status": domain.PayslipApproved})
		ps, err := svc.Payslips.GetByID(r.Context(), tid, id)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, ps)
	}
}

func markPayslipPaid(svc *service.Service) http.HandlerFunc {
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
		if err := svc.Payslips.UpdateStatus(r.Context(), tid, id, domain.PayslipPaid, nil); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		emitAudit(svc, r, "hr.payslip.pay", "payslip", id.String(), nil,
			map[string]any{"status": domain.PayslipPaid})
		ps, err := svc.Payslips.GetByID(r.Context(), tid, id)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, ps)
	}
}

// ---- Leave Requests ----

type createLeaveReq struct {
	EmployeeID string `json:"employee_id"`
	LeaveType  string `json:"leave_type"`
	StartDate  string `json:"start_date"`
	EndDate    string `json:"end_date"`
	Reason     string `json:"reason,omitempty"`
}

func createLeaveRequest(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createLeaveReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		empID, err := uuid.Parse(req.EmployeeID)
		if err != nil {
			writeErr(w, 400, errors.New("employee_id must be a valid UUID"))
			return
		}
		startDate, err := time.Parse("2006-01-02", req.StartDate)
		if err != nil {
			writeErr(w, 400, errors.New("start_date must be YYYY-MM-DD"))
			return
		}
		endDate, err := time.Parse("2006-01-02", req.EndDate)
		if err != nil {
			writeErr(w, 400, errors.New("end_date must be YYYY-MM-DD"))
			return
		}
		if endDate.Before(startDate) {
			writeErr(w, 400, errors.New("end_date must be >= start_date"))
			return
		}
		inp := domain.CreateLeaveInput{
			EmployeeID: empID,
			LeaveType:  domain.LeaveType(req.LeaveType),
			StartDate:  startDate,
			EndDate:    endDate,
			Reason:     req.Reason,
		}
		lr, err := svc.LeaveRequests.Create(r.Context(), tid, inp)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		emitAudit(svc, r, "hr.leave.create", "leave_request", lr.ID.String(), nil,
			map[string]any{"employee_id": empID.String(), "leave_type": req.LeaveType, "start_date": req.StartDate, "end_date": req.EndDate})
		writeJSON(w, 201, lr)
	}
}

func getLeaveRequest(svc *service.Service) http.HandlerFunc {
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
		lr, err := svc.LeaveRequests.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, lr)
	}
}

func listLeaveRequests(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var employeeID *uuid.UUID
		if s := r.URL.Query().Get("employee_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				employeeID = &id
			}
		}
		var status *domain.LeaveStatus
		if s := r.URL.Query().Get("status"); s != "" {
			v := domain.LeaveStatus(s)
			status = &v
		}
		limit := atoiOr(r.URL.Query().Get("limit"), 100)
		offset := atoiOr(r.URL.Query().Get("offset"), 0)
		items, total, err := svc.LeaveRequests.List(r.Context(), tid, employeeID, status, limit, offset)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

func approveLeaveRequest(svc *service.Service) http.HandlerFunc {
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
		var approvedBy *uuid.UUID
		if claims, ok := libauth.FromCtx(r.Context()); ok {
			if uid, err := uuid.Parse(claims.Subject); err == nil {
				approvedBy = &uid
			}
		}
		if err := svc.LeaveRequests.UpdateStatus(r.Context(), tid, id, domain.LeaveApproved, approvedBy, ""); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		emitAudit(svc, r, "hr.leave.approve", "leave_request", id.String(), nil,
			map[string]any{"status": domain.LeaveApproved})
		lr, err := svc.LeaveRequests.GetByID(r.Context(), tid, id)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, lr)
	}
}

type rejectLeaveReq struct {
	Reason string `json:"reason"`
}

func rejectLeaveRequest(svc *service.Service) http.HandlerFunc {
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
		var req rejectLeaveReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if err := svc.LeaveRequests.UpdateStatus(r.Context(), tid, id, domain.LeaveRejected, nil, req.Reason); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		emitAudit(svc, r, "hr.leave.reject", "leave_request", id.String(), nil,
			map[string]any{"status": domain.LeaveRejected, "reason": req.Reason})
		lr, err := svc.LeaveRequests.GetByID(r.Context(), tid, id)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, lr)
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
