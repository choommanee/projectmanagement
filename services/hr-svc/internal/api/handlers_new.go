package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/pmplatform/services/hr-svc/internal/domain"
	"github.com/pmplatform/services/hr-svc/internal/service"
	"github.com/pmplatform/services/hr-svc/internal/store"
)

// ---- Training ----

type createTrainingReq struct {
	Title           string  `json:"title"`
	Description     string  `json:"description,omitempty"`
	Trainer         string  `json:"trainer,omitempty"`
	Location        string  `json:"location,omitempty"`
	StartDate       *string `json:"start_date,omitempty"`
	EndDate         *string `json:"end_date,omitempty"`
	Status          string  `json:"status,omitempty"`
	MaxParticipants int     `json:"max_participants,omitempty"`
}

func listTraining(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListTrainingOpts{
			Query:  r.URL.Query().Get("q"),
			Status: r.URL.Query().Get("status"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		items, total, err := svc.Training.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

func createTraining(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createTrainingReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Title == "" {
			writeErr(w, 400, errors.New("title required"))
			return
		}
		in := domain.CreateTrainingInput{
			Title:           req.Title,
			Description:     req.Description,
			Trainer:         req.Trainer,
			Location:        req.Location,
			MaxParticipants: req.MaxParticipants,
			Status:          domain.TrainingStatus(req.Status),
		}
		if req.StartDate != nil {
			if t, err := time.Parse("2006-01-02", *req.StartDate); err == nil {
				in.StartDate = &t
			}
		}
		if req.EndDate != nil {
			if t, err := time.Parse("2006-01-02", *req.EndDate); err == nil {
				in.EndDate = &t
			}
		}
		tr, err := svc.Training.Create(r.Context(), in, tid)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, tr)
	}
}

func getTraining(svc *service.Service) http.HandlerFunc {
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
		tr, err := svc.Training.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, tr)
	}
}

type patchTrainingReq struct {
	Title           *string `json:"title,omitempty"`
	Description     *string `json:"description,omitempty"`
	Trainer         *string `json:"trainer,omitempty"`
	Location        *string `json:"location,omitempty"`
	StartDate       *string `json:"start_date,omitempty"`
	EndDate         *string `json:"end_date,omitempty"`
	Status          *string `json:"status,omitempty"`
	MaxParticipants *int    `json:"max_participants,omitempty"`
}

func patchTraining(svc *service.Service) http.HandlerFunc {
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
		var req patchTrainingReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateTrainingInput{
			Title:           req.Title,
			Description:     req.Description,
			Trainer:         req.Trainer,
			Location:        req.Location,
			MaxParticipants: req.MaxParticipants,
		}
		if req.Status != nil {
			s := domain.TrainingStatus(*req.Status)
			in.Status = &s
		}
		if req.StartDate != nil {
			if t, err := time.Parse("2006-01-02", *req.StartDate); err == nil {
				in.StartDate = &t
			}
		}
		if req.EndDate != nil {
			if t, err := time.Parse("2006-01-02", *req.EndDate); err == nil {
				in.EndDate = &t
			}
		}
		tr, err := svc.UpdateTraining(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, tr)
	}
}

// ---- Jobs / Recruitment ----

type createJobReq struct {
	Title        string     `json:"title"`
	DepartmentID *uuid.UUID `json:"department_id,omitempty"`
	Description  string     `json:"description,omitempty"`
	Requirements string     `json:"requirements,omitempty"`
	SalaryMin    *float64   `json:"salary_min,omitempty"`
	SalaryMax    *float64   `json:"salary_max,omitempty"`
	Status       string     `json:"status,omitempty"`
	PostedDate   *string    `json:"posted_date,omitempty"`
	ClosesDate   *string    `json:"closes_date,omitempty"`
}

func listJobs(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListJobOpts{
			Query:  r.URL.Query().Get("q"),
			Status: r.URL.Query().Get("status"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		items, total, err := svc.Jobs.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

func createJob(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createJobReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Title == "" {
			writeErr(w, 400, errors.New("title required"))
			return
		}
		in := domain.CreateJobPostingInput{
			Title:        req.Title,
			DepartmentID: req.DepartmentID,
			Description:  req.Description,
			Requirements: req.Requirements,
			SalaryMin:    req.SalaryMin,
			SalaryMax:    req.SalaryMax,
			Status:       domain.JobStatus(req.Status),
		}
		if req.PostedDate != nil {
			if t, err := time.Parse("2006-01-02", *req.PostedDate); err == nil {
				in.PostedDate = &t
			}
		}
		if req.ClosesDate != nil {
			if t, err := time.Parse("2006-01-02", *req.ClosesDate); err == nil {
				in.ClosesDate = &t
			}
		}
		job, err := svc.Jobs.Create(r.Context(), in, tid)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, job)
	}
}

func getJob(svc *service.Service) http.HandlerFunc {
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
		job, err := svc.Jobs.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, job)
	}
}

type patchJobReq struct {
	Title        *string  `json:"title,omitempty"`
	Description  *string  `json:"description,omitempty"`
	Requirements *string  `json:"requirements,omitempty"`
	Status       *string  `json:"status,omitempty"`
	SalaryMin    *float64 `json:"salary_min,omitempty"`
	SalaryMax    *float64 `json:"salary_max,omitempty"`
	Openings     *int     `json:"openings,omitempty"`
	ClosesDate   *string  `json:"closes_date,omitempty"`
}

func patchJob(svc *service.Service) http.HandlerFunc {
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
		var req patchJobReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateJobInput{
			Title:        req.Title,
			Description:  req.Description,
			Requirements: req.Requirements,
			SalaryMin:    req.SalaryMin,
			SalaryMax:    req.SalaryMax,
		}
		if req.Status != nil {
			s := domain.JobStatus(*req.Status)
			in.Status = &s
		}
		if req.ClosesDate != nil {
			if t, err := time.Parse("2006-01-02", *req.ClosesDate); err == nil {
				in.ClosesDate = &t
			}
		}
		job, err := svc.UpdateJob(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, job)
	}
}

func listApplicants(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		jobID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		limit := atoiOr(r.URL.Query().Get("limit"), 100)
		offset := atoiOr(r.URL.Query().Get("offset"), 0)
		items, total, err := svc.Jobs.ListApplicants(r.Context(), tid, jobID, limit, offset)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type createApplicantReq struct {
	Name      string `json:"name"`
	Email     string `json:"email,omitempty"`
	Phone     string `json:"phone,omitempty"`
	ResumeURL string `json:"resume_url,omitempty"`
	Notes     string `json:"notes,omitempty"`
}

func createApplicant(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		jobID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req createApplicantReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Name == "" {
			writeErr(w, 400, errors.New("name required"))
			return
		}
		in := domain.CreateApplicantInput{
			JobID:     jobID,
			Name:      req.Name,
			Email:     req.Email,
			Phone:     req.Phone,
			ResumeURL: req.ResumeURL,
			Notes:     req.Notes,
		}
		a, err := svc.Jobs.CreateApplicant(r.Context(), in, tid)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, a)
	}
}

type patchApplicantReq struct {
	Status string `json:"status"`
}

func patchApplicant(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		applicantID, err := uuid.Parse(chi.URLParam(r, "applicantId"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req patchApplicantReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Status == "" {
			writeErr(w, 400, errors.New("status required"))
			return
		}
		a, err := svc.Jobs.UpdateApplicantStatus(r.Context(), tid, applicantID, domain.ApplicantStatus(req.Status))
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, a)
	}
}

// ---- Performance Reviews ----

type createReviewReq struct {
	EmployeeID      string `json:"employee_id"`
	ReviewPeriod    string `json:"review_period"`
	Status          string `json:"status,omitempty"`
	OverallRating   *int   `json:"overall_rating,omitempty"`
	SelfComments    string `json:"self_comments,omitempty"`
	ManagerComments string `json:"manager_comments,omitempty"`
}

func listPerformanceReviews(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListReviewOpts{
			Status: r.URL.Query().Get("status"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		if s := r.URL.Query().Get("employee_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				opts.EmployeeID = &id
			}
		}
		items, total, err := svc.PerformanceReviews.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

func createPerformanceReview(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createReviewReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		empID, err := uuid.Parse(req.EmployeeID)
		if err != nil {
			writeErr(w, 400, errors.New("employee_id must be a valid UUID"))
			return
		}
		if req.ReviewPeriod == "" {
			writeErr(w, 400, errors.New("review_period required"))
			return
		}
		in := domain.CreateReviewInput{
			EmployeeID:      empID,
			ReviewPeriod:    req.ReviewPeriod,
			Status:          domain.ReviewStatus(req.Status),
			OverallRating:   req.OverallRating,
			SelfComments:    req.SelfComments,
			ManagerComments: req.ManagerComments,
		}
		rv, err := svc.PerformanceReviews.Create(r.Context(), in, tid)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, rv)
	}
}

func getPerformanceReview(svc *service.Service) http.HandlerFunc {
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
		rv, err := svc.PerformanceReviews.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, rv)
	}
}

type patchReviewReq struct {
	Status          *string `json:"status,omitempty"`
	Score           *int    `json:"score,omitempty"`
	Comments        *string `json:"comments,omitempty"`
	ManagerComments *string `json:"manager_comments,omitempty"`
}

func patchPerformanceReview(svc *service.Service) http.HandlerFunc {
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
		var req patchReviewReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateReviewInput{
			Score:           req.Score,
			Comments:        req.Comments,
			ManagerComments: req.ManagerComments,
		}
		if req.Status != nil {
			s := domain.ReviewStatus(*req.Status)
			in.Status = &s
		}
		rv, err := svc.UpdatePerformanceReview(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, rv)
	}
}

// ---- Payroll Runs ----

type createPayrollRunReq struct {
	Period          string  `json:"period"`
	Status          string  `json:"status,omitempty"`
	TotalGross      float64 `json:"total_gross,omitempty"`
	TotalDeductions float64 `json:"total_deductions,omitempty"`
	TotalNet        float64 `json:"total_net,omitempty"`
	EmployeeCount   int     `json:"employee_count,omitempty"`
}

func listPayrollRuns(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListPayrollRunOpts{
			Status: r.URL.Query().Get("status"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		items, total, err := svc.PayrollRuns.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

func createPayrollRun(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createPayrollRunReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Period == "" {
			writeErr(w, 400, errors.New("period required"))
			return
		}
		in := domain.CreatePayrollRunInput{
			Period:          req.Period,
			Status:          domain.PayrunStatus(req.Status),
			TotalGross:      req.TotalGross,
			TotalDeductions: req.TotalDeductions,
			TotalNet:        req.TotalNet,
			EmployeeCount:   req.EmployeeCount,
		}
		pr, err := svc.PayrollRuns.Create(r.Context(), in, tid)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, pr)
	}
}

func getPayrollRun(svc *service.Service) http.HandlerFunc {
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
		pr, err := svc.PayrollRuns.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, pr)
	}
}

type patchPayrollRunReq struct {
	Status          *string  `json:"status,omitempty"`
	TotalGross      *float64 `json:"total_gross,omitempty"`
	TotalDeductions *float64 `json:"total_deductions,omitempty"`
	TotalNet        *float64 `json:"total_net,omitempty"`
	EmployeeCount   *int     `json:"employee_count,omitempty"`
}

func patchPayrollRun(svc *service.Service) http.HandlerFunc {
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
		var req patchPayrollRunReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdatePayrollRunInput{
			TotalGross:      req.TotalGross,
			TotalDeductions: req.TotalDeductions,
			TotalNet:        req.TotalNet,
			EmployeeCount:   req.EmployeeCount,
		}
		if req.Status != nil {
			s := domain.PayrunStatus(*req.Status)
			in.Status = &s
		}
		pr, err := svc.UpdatePayrollRun(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, pr)
	}
}
