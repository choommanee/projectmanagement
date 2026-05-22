package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/identity-svc/internal/domain"
)

// SSOConfigs persists sso_config rows. RLS requires app.current_tenant in-tx
// for tenant-scoped DML (admin endpoints) but the login start/callback path
// needs to look the row up by (tenant_slug, id) BEFORE we have a tenant
// context (anonymous endpoint). The bypass helpers mirror the
// RefreshTokens.FindByHash / MFAEnrollments.FindByUserUnscoped pattern: a
// uniqueness constraint (sso_config_tenant_issuer_client_unique + the id PK)
// is what makes the lookup safe across tenants.
type SSOConfigs struct{ p *pgxpool.Pool }

func NewSSOConfigs(p *pgxpool.Pool) *SSOConfigs { return &SSOConfigs{p: p} }

func (s *SSOConfigs) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
	tx, err := s.p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String())); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Create inserts a new sso_config. The caller is responsible for encrypting
// client_secret before passing the row in (SSOConfig.ClientSecretEncrypted).
func (s *SSOConfigs) Create(ctx context.Context, c *domain.SSOConfig) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	attrJSON, err := json.Marshal(orEmptyMap(c.AttributeMap))
	if err != nil {
		return err
	}
	return s.withTenant(ctx, c.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
            INSERT INTO sso_config(id, tenant_id, provider, issuer_url, client_id,
                                   client_secret_encrypted, redirect_uri, scopes,
                                   attribute_map, allow_jit_provisioning, default_role,
                                   enabled)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,NULLIF($11,''),$12)`,
			c.ID, c.TenantID, c.Provider, c.IssuerURL, c.ClientID,
			c.ClientSecretEncrypted, c.RedirectURI, c.Scopes,
			string(attrJSON), c.AllowJITProvisioning, c.DefaultRole,
			c.Enabled)
		return err
	})
}

// Update applies a partial patch. nil-valued fields are skipped. ClientSecret
// encryption is the caller's responsibility (see service.OIDC.UpdateConfig).
type SSOConfigPatch struct {
	IssuerURL              *string
	ClientID               *string
	ClientSecretEncrypted  *[]byte
	RedirectURI            *string
	Scopes                 *[]string
	AttributeMap           *map[string]string
	AllowJITProvisioning   *bool
	DefaultRole            *string
	Enabled                *bool
}

// Update mutates a single sso_config row by id. We rebuild the SET clause
// dynamically so a partial PATCH doesn't have to ship every column the
// admin endpoint accepts.
func (s *SSOConfigs) Update(ctx context.Context, tid, id uuid.UUID, p SSOConfigPatch) error {
	setCols := []string{}
	args := []any{}
	idx := 1
	add := func(col string, val any) {
		setCols = append(setCols, fmt.Sprintf("%s = $%d", col, idx))
		args = append(args, val)
		idx++
	}
	if p.IssuerURL != nil {
		add("issuer_url", *p.IssuerURL)
	}
	if p.ClientID != nil {
		add("client_id", *p.ClientID)
	}
	if p.ClientSecretEncrypted != nil {
		add("client_secret_encrypted", *p.ClientSecretEncrypted)
	}
	if p.RedirectURI != nil {
		add("redirect_uri", *p.RedirectURI)
	}
	if p.Scopes != nil {
		add("scopes", *p.Scopes)
	}
	if p.AttributeMap != nil {
		b, err := json.Marshal(orEmptyMap(*p.AttributeMap))
		if err != nil {
			return err
		}
		setCols = append(setCols, fmt.Sprintf("attribute_map = $%d::jsonb", idx))
		args = append(args, string(b))
		idx++
	}
	if p.AllowJITProvisioning != nil {
		add("allow_jit_provisioning", *p.AllowJITProvisioning)
	}
	if p.DefaultRole != nil {
		// empty string -> NULL so callers can clear the default role.
		if *p.DefaultRole == "" {
			setCols = append(setCols, "default_role = NULL")
		} else {
			add("default_role", *p.DefaultRole)
		}
	}
	if p.Enabled != nil {
		add("enabled", *p.Enabled)
	}
	if len(setCols) == 0 {
		// nothing to do; treat as success so the admin UI can no-op safely.
		return nil
	}
	setCols = append(setCols, "updated_at = now()")
	args = append(args, id)
	q := fmt.Sprintf("UPDATE sso_config SET %s WHERE id = $%d",
		joinComma(setCols), idx)
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, q, args...)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrSSOConfigNotFound
		}
		return nil
	})
}

// Delete removes a config row (no soft-delete; SSO config has no audit
// retention requirement and the audit publisher already records the action).
func (s *SSOConfigs) Delete(ctx context.Context, tid, id uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `DELETE FROM sso_config WHERE id = $1`, id)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrSSOConfigNotFound
		}
		return nil
	})
}

// List returns every config for the tenant, newest first.
func (s *SSOConfigs) List(ctx context.Context, tid uuid.UUID) ([]domain.SSOConfig, error) {
	out := []domain.SSOConfig{}
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
            SELECT id, tenant_id, provider, issuer_url, client_id,
                   client_secret_encrypted, redirect_uri, scopes,
                   attribute_map, allow_jit_provisioning,
                   COALESCE(default_role,''), enabled, created_at, updated_at
              FROM sso_config
             WHERE tenant_id = $1
             ORDER BY created_at DESC`, tid)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			c, err := scanConfig(rows)
			if err != nil {
				return err
			}
			out = append(out, *c)
		}
		return rows.Err()
	})
	return out, err
}

// FindByIDUnscoped looks the config row up by primary key bypassing tenant
// RLS. Used by the OIDC start/callback flow before we have a tenant context;
// the id is unguessable (uuid v4) so cross-tenant lookup is safe.
func (s *SSOConfigs) FindByIDUnscoped(ctx context.Context, id uuid.UUID) (*domain.SSOConfig, error) {
	row := s.p.QueryRow(ctx, `
        SELECT id, tenant_id, provider, issuer_url, client_id,
               client_secret_encrypted, redirect_uri, scopes,
               attribute_map, allow_jit_provisioning,
               COALESCE(default_role,''), enabled, created_at, updated_at
          FROM sso_config
         WHERE id = $1`, id)
	c, err := scanConfig(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrSSOConfigNotFound
	}
	if err != nil {
		return nil, err
	}
	return c, nil
}

// scanRow is the small interface satisfied by both *pgx.Row and pgx.Rows.
type scanRow interface {
	Scan(dest ...any) error
}

func scanConfig(row scanRow) (*domain.SSOConfig, error) {
	var c domain.SSOConfig
	var attrRaw []byte
	if err := row.Scan(
		&c.ID, &c.TenantID, &c.Provider, &c.IssuerURL, &c.ClientID,
		&c.ClientSecretEncrypted, &c.RedirectURI, &c.Scopes,
		&attrRaw, &c.AllowJITProvisioning, &c.DefaultRole, &c.Enabled,
		&c.CreatedAt, &c.UpdatedAt,
	); err != nil {
		return nil, err
	}
	c.AttributeMap = map[string]string{}
	if len(attrRaw) > 0 {
		_ = json.Unmarshal(attrRaw, &c.AttributeMap)
	}
	return &c, nil
}

func orEmptyMap(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return m
}

func joinComma(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ", "
		}
		out += p
	}
	return out
}
