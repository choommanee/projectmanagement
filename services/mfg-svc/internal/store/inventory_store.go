package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
)

// Inventory handles stock balance and inventory transaction storage.
type Inventory struct{ p *pgxpool.Pool }

func NewInventory(p *pgxpool.Pool) *Inventory { return &Inventory{p: p} }

func (s *Inventory) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

// ListBalances returns all stock balance rows for the tenant, newest first.
func (s *Inventory) ListBalances(ctx context.Context, tenantID uuid.UUID) ([]domain.StockBalance, error) {
	var out []domain.StockBalance
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT id, tenant_id, item_id, lot_number, location, qty_on_hand, updated_at
			 FROM stock_balance ORDER BY updated_at DESC`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var b domain.StockBalance
			if err := rows.Scan(&b.ID, &b.TenantID, &b.ItemID, &b.LotNumber,
				&b.Location, &b.QtyOnHand, &b.UpdatedAt); err != nil {
				return err
			}
			out = append(out, b)
		}
		return rows.Err()
	})
	return out, err
}

// GetItemBalance returns stock balance rows for a specific item.
func (s *Inventory) GetItemBalance(ctx context.Context, tenantID, itemID uuid.UUID) ([]domain.StockBalance, error) {
	var out []domain.StockBalance
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT id, tenant_id, item_id, lot_number, location, qty_on_hand, updated_at
			 FROM stock_balance WHERE item_id = $1`, itemID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var b domain.StockBalance
			if err := rows.Scan(&b.ID, &b.TenantID, &b.ItemID, &b.LotNumber,
				&b.Location, &b.QtyOnHand, &b.UpdatedAt); err != nil {
				return err
			}
			out = append(out, b)
		}
		return rows.Err()
	})
	return out, err
}

// PostTransaction records a stock movement and updates the stock_balance atomically.
// receive/adjust add to qty; issue subtracts.
func (s *Inventory) PostTransaction(ctx context.Context, tenantID uuid.UUID, p domain.PostTransactionParams) (domain.InventoryTransaction, error) {
	var t domain.InventoryTransaction

	// qty delta: receive/adjust can be positive; issue is always negative
	delta := p.Qty
	if p.TxnType == domain.TxnIssue {
		delta = -p.Qty
	}

	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		// upsert balance
		if _, err := tx.Exec(ctx, `
			INSERT INTO stock_balance (tenant_id, item_id, lot_number, location, qty_on_hand, updated_at)
			VALUES ($1,$2,$3,$4,$5,now())
			ON CONFLICT (tenant_id, item_id, lot_number, location)
			DO UPDATE SET qty_on_hand = stock_balance.qty_on_hand + $5, updated_at = now()`,
			tenantID, p.ItemID, p.LotNumber, p.Location, delta); err != nil {
			return err
		}

		// insert ledger row
		return tx.QueryRow(ctx, `
			INSERT INTO inventory_transaction
			  (tenant_id, item_id, lot_number, location, txn_type, qty, ref_type, ref_id, note, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
			RETURNING id, tenant_id, item_id, lot_number, location, txn_type, qty,
			          ref_type, ref_id, note, created_by, created_at`,
			tenantID, p.ItemID, p.LotNumber, p.Location, string(p.TxnType), p.Qty,
			p.RefType, p.RefID, p.Note, p.CreatedBy,
		).Scan(&t.ID, &t.TenantID, &t.ItemID, &t.LotNumber, &t.Location,
			(*string)(&t.TxnType), &t.Qty, &t.RefType, &t.RefID, &t.Note,
			&t.CreatedBy, &t.CreatedAt)
	})
	return t, err
}

// ListTransactions returns the most recent 200 transactions for a given item.
func (s *Inventory) ListTransactions(ctx context.Context, tenantID, itemID uuid.UUID) ([]domain.InventoryTransaction, error) {
	var out []domain.InventoryTransaction
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, item_id, lot_number, location, txn_type, qty,
			       ref_type, ref_id, note, created_by, created_at
			FROM inventory_transaction WHERE item_id = $1
			ORDER BY created_at DESC LIMIT 200`, itemID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var it domain.InventoryTransaction
			if err := rows.Scan(&it.ID, &it.TenantID, &it.ItemID, &it.LotNumber, &it.Location,
				(*string)(&it.TxnType), &it.Qty, &it.RefType, &it.RefID, &it.Note,
				&it.CreatedBy, &it.CreatedAt); err != nil {
				return err
			}
			out = append(out, it)
		}
		return rows.Err()
	})
	return out, err
}
