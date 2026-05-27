package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/hr-svc/internal/domain"
)

type JobStore struct{ p *pgxpool.Pool }

func NewJobStore(p *pgxpool.Pool) *JobStore { return &JobStore{p: p} }

const jobSelect = `
    SELECT id, tenant_id, title, department_id, description, requirements,
           salary_min, salary_max, status, posted_date, closes_date, created_at, updated_at
    FROM job_posting`

func scanJob(row interface{ Scan(...any) error }, j *domain.JobPosting) error {
	return row.Scan(
		&j.ID, &j.TenantID, &j.Title, &j.DepartmentID, &j.Description, &j.Requirements,
		&j.SalaryMin, &j.SalaryMax, &j.Status, &j.PostedDate, &j.ClosesDate,
		&j.CreatedAt, &j.UpdatedAt,
	)
}

type ListJobOpts struct {
	Query  string
	Status string
	Limit  int
	Offset int
}

func (s *JobStore) List(ctx context.Context, tid uuid.UUID, opts ListJobOpts) ([]*domain.JobPosting, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if opts.Query != "" {
		where = append(where, fmt.Sprintf("title ILIKE $%d", idx))
		args = append(args, "%"+opts.Query+"%")
		idx++
	}
	if opts.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, opts.Status)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	items := make([]*domain.JobPosting, 0)
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			jobSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var j domain.JobPosting
			if err := scanJob(rows, &j); err != nil {
				return err
			}
			items = append(items, &j)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM job_posting WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

func (s *JobStore) Create(ctx context.Context, in domain.CreateJobPostingInput, tid uuid.UUID) (*domain.JobPosting, error) {
	j := &domain.JobPosting{
		ID:           uuid.New(),
		TenantID:     tid,
		Title:        in.Title,
		DepartmentID: in.DepartmentID,
		Description:  in.Description,
		Requirements: in.Requirements,
		SalaryMin:    in.SalaryMin,
		SalaryMax:    in.SalaryMax,
		Status:       in.Status,
		PostedDate:   in.PostedDate,
		ClosesDate:   in.ClosesDate,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	if j.Status == "" {
		j.Status = domain.JobDraft
	}
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO job_posting(id, tenant_id, title, department_id, description, requirements,
			                        salary_min, salary_max, status, posted_date, closes_date,
			                        created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
			j.ID, j.TenantID, j.Title, j.DepartmentID, j.Description, j.Requirements,
			j.SalaryMin, j.SalaryMax, j.Status, j.PostedDate, j.ClosesDate,
			j.CreatedAt, j.UpdatedAt,
		)
		return err
	})
	if err != nil {
		return nil, err
	}
	return j, nil
}

func (s *JobStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.JobPosting, error) {
	var j domain.JobPosting
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanJob(tx.QueryRow(ctx, jobSelect+" WHERE id=$1", id), &j)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

func (s *JobStore) UpdateStatus(ctx context.Context, tid, id uuid.UUID, status domain.JobStatus) (*domain.JobPosting, error) {
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			"UPDATE job_posting SET status=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2",
			id, tid, status,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetByID(ctx, tid, id)
}

// ---- Applicants ----

const applicantSelect = `
    SELECT id, tenant_id, job_id, name, email, phone, status, resume_url, notes, applied_at, updated_at
    FROM applicant`

func scanApplicant(row interface{ Scan(...any) error }, a *domain.Applicant) error {
	return row.Scan(
		&a.ID, &a.TenantID, &a.JobID, &a.Name, &a.Email, &a.Phone,
		&a.Status, &a.ResumeURL, &a.Notes, &a.AppliedAt, &a.UpdatedAt,
	)
}

func (s *JobStore) ListApplicants(ctx context.Context, tid, jobID uuid.UUID, limit, offset int) ([]*domain.Applicant, int, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	items := make([]*domain.Applicant, 0)
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			applicantSelect+" WHERE tenant_id=$1 AND job_id=$2 ORDER BY applied_at DESC LIMIT $3 OFFSET $4",
			tid, jobID, limit, offset,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a domain.Applicant
			if err := scanApplicant(rows, &a); err != nil {
				return err
			}
			items = append(items, &a)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx,
			"SELECT count(*) FROM applicant WHERE tenant_id=$1 AND job_id=$2",
			tid, jobID,
		).Scan(&total)
	})
	return items, total, err
}

func (s *JobStore) CreateApplicant(ctx context.Context, in domain.CreateApplicantInput, tid uuid.UUID) (*domain.Applicant, error) {
	a := &domain.Applicant{
		ID:        uuid.New(),
		TenantID:  tid,
		JobID:     in.JobID,
		Name:      in.Name,
		Email:     in.Email,
		Phone:     in.Phone,
		Status:    domain.ApplicantApplied,
		ResumeURL: in.ResumeURL,
		Notes:     in.Notes,
		AppliedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO applicant(id, tenant_id, job_id, name, email, phone,
			                      status, resume_url, notes, applied_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			a.ID, a.TenantID, a.JobID, a.Name, a.Email, a.Phone,
			a.Status, a.ResumeURL, a.Notes, a.AppliedAt, a.UpdatedAt,
		)
		return err
	})
	if err != nil {
		return nil, err
	}
	return a, nil
}

func (s *JobStore) UpdateApplicantStatus(ctx context.Context, tid, applicantID uuid.UUID, status domain.ApplicantStatus) (*domain.Applicant, error) {
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			"UPDATE applicant SET status=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2",
			applicantID, tid, status,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	var a domain.Applicant
	err = withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanApplicant(tx.QueryRow(ctx, applicantSelect+" WHERE id=$1", applicantID), &a)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}
