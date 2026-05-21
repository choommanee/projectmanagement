package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

type Visibility string

const (
	VisPrivate Visibility = "private"
	VisTeam    Visibility = "team"
	VisTenant  Visibility = "tenant"
)

type Dashboard struct {
	ID          uuid.UUID  `json:"id"`
	TenantID    uuid.UUID  `json:"tenantId"`
	OwnerID     *uuid.UUID `json:"ownerId,omitempty"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Visibility  Visibility `json:"visibility"`
	Layout      []byte     `json:"-"`
	Widgets     []byte     `json:"-"`
	IsPinned    bool       `json:"isPinned"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	Version     int        `json:"version"`
}

// DashboardFull is for API responses where layout/widgets are embedded as raw JSON
type DashboardFull struct {
	ID          uuid.UUID      `json:"id"`
	TenantID    uuid.UUID      `json:"tenantId"`
	OwnerID     *uuid.UUID     `json:"ownerId,omitempty"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Visibility  Visibility     `json:"visibility"`
	Layout      RawJSON        `json:"layout"`
	Widgets     RawJSON        `json:"widgets"`
	IsPinned    bool           `json:"isPinned"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
	Version     int            `json:"version"`
}

// RawJSON is a helper to embed raw JSON blobs in structs
type RawJSON []byte

func (r RawJSON) MarshalJSON() ([]byte, error) {
	if r == nil {
		return []byte("[]"), nil
	}
	return r, nil
}

// SummaryMetrics holds cross-service KPI aggregates
type SummaryMetrics struct {
	Projects struct {
		Total     int `json:"total"`
		Active    int `json:"active"`
		Completed int `json:"completed"`
		Planning  int `json:"planning"`
	} `json:"projects"`
	Tasks struct {
		Total   int `json:"total"`
		Open    int `json:"open"`
		Done    int `json:"done"`
		Overdue int `json:"overdue"`
	} `json:"tasks"`
	WorkOrders struct {
		Total      int `json:"total"`
		Planned    int `json:"planned"`
		Released   int `json:"released"`
		InProgress int `json:"inProgress"`
		Completed  int `json:"completed"`
	} `json:"workOrders"`
	NcrsOpen         int `json:"ncrsOpen"`
	FmeaHighRpn      int `json:"fmeaHighRpn"`
	Documents struct {
		Total    int `json:"total"`
		Draft    int `json:"draft"`
		Approved int `json:"approved"`
	} `json:"documents"`
	WorkflowRunsToday int `json:"workflowRunsToday"`
	AuditEvents24h    int `json:"auditEvents24h"`
}

type TimeseriesPoint struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
}

type ByStatusPoint struct {
	Status string `json:"status"`
	Count  int    `json:"count"`
}

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("version conflict")
)
