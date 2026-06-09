package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type Status string

const (
	StatusActive    Status = "active"
	StatusInvited   Status = "invited"
	StatusSuspended Status = "suspended"
)

// UserSummary is a read-only view for pickers and the admin user list — no
// sensitive fields (password hash etc.). Roles/Status/CreatedAt let the admin
// pm/users table render the roles, status, and joined columns.
type UserSummary struct {
	ID          uuid.UUID `json:"id"`
	DisplayName string    `json:"display_name"`
	Email       string    `json:"email"`
	Status      Status    `json:"status"`
	Roles       []string  `json:"roles"`
	CreatedAt   time.Time `json:"created_at"`
}

type User struct {
	ID           uuid.UUID
	TenantID     uuid.UUID
	Email        string
	DisplayName  string
	Status       Status
	PasswordHash string
	ExternalIDP  string
	ExternalSub  string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	Version      int
}

var (
	ErrNotFound     = errors.New("user not found")
	ErrInvalidCreds = errors.New("invalid credentials")
	ErrInvalidEmail = errors.New("invalid email")
	ErrPasswordWeak = errors.New("password too weak")
)

func HashPassword(plain string) (string, error) {
	if len(plain) < 10 {
		return "", ErrPasswordWeak
	}
	h, err := bcrypt.GenerateFromPassword([]byte(plain), 12)
	return string(h), err
}

func CheckPassword(hash, plain string) error {
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)); err != nil {
		return ErrInvalidCreds
	}
	return nil
}
