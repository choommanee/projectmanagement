package domain

import (
	"errors"
	"regexp"
	"time"

	"github.com/google/uuid"
)

type Tier string

const (
	TierShared    Tier = "shared"
	TierSchema    Tier = "schema"
	TierDedicated Tier = "dedicated"
)

type Status string

const (
	StatusActive    Status = "active"
	StatusSuspended Status = "suspended"
	StatusArchived  Status = "archived"
)

type Tenant struct {
	ID        uuid.UUID
	Slug      string
	Name      string
	Tier      Tier
	Status    Status
	Region    string
	Settings  map[string]any
	CreatedAt time.Time
	UpdatedAt time.Time
	Version   int
}

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,62}$`)

var (
	ErrInvalidSlug = errors.New("invalid slug")
	ErrInvalidName = errors.New("name required")
	ErrNotFound    = errors.New("tenant not found")
	ErrConflict    = errors.New("version conflict")
)

func NewTenant(slug, name, region string, tier Tier) (*Tenant, error) {
	if !slugRe.MatchString(slug) {
		return nil, ErrInvalidSlug
	}
	if name == "" {
		return nil, ErrInvalidName
	}
	if tier == "" {
		tier = TierShared
	}
	if region == "" {
		region = "ap-southeast-1"
	}
	return &Tenant{
		ID: uuid.New(), Slug: slug, Name: name, Tier: tier,
		Status: StatusActive, Region: region, Settings: map[string]any{},
		Version: 1,
	}, nil
}
