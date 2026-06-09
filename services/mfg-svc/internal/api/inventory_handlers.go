package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
	"github.com/pmplatform/services/mfg-svc/internal/service"
)

// GET /v1/inventory
func listInventory(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		balances, err := svc.Inventory.ListBalances(r.Context(), tid)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		if balances == nil {
			balances = []domain.StockBalance{}
		}
		writeJSON(w, 200, map[string]any{"items": balances, "total": len(balances)})
	}
}

// GET /v1/inventory/items/{itemId}/balance
func getItemBalance(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		itemID, err := uuid.Parse(chi.URLParam(r, "itemId"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		balances, err := svc.Inventory.GetItemBalance(r.Context(), tid, itemID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		if balances == nil {
			balances = []domain.StockBalance{}
		}
		writeJSON(w, 200, map[string]any{"items": balances})
	}
}

// POST /v1/inventory/transactions
func postInventoryTransaction(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req struct {
			ItemID    string  `json:"item_id"`
			LotNumber string  `json:"lot_number"`
			Location  string  `json:"location"`
			TxnType   string  `json:"txn_type"`
			Qty       float64 `json:"qty"`
			Note      string  `json:"note"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		itemID, err := uuid.Parse(req.ItemID)
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var createdBy uuid.UUID
		if c, ok := libauth.FromCtx(r.Context()); ok {
			createdBy, _ = uuid.Parse(c.Subject)
		}
		if req.Qty <= 0 {
			writeErr(w, 400, domain.ErrInvalidInput)
			return
		}
		txnType := domain.TxnType(req.TxnType)
		if txnType != domain.TxnReceive && txnType != domain.TxnIssue && txnType != domain.TxnAdjust {
			writeErr(w, 400, domain.ErrInvalidInput)
			return
		}
		if req.Location == "" {
			req.Location = "default"
		}
		txn, err := svc.Inventory.PostTransaction(r.Context(), tid, domain.PostTransactionParams{
			ItemID:    itemID,
			LotNumber: req.LotNumber,
			Location:  req.Location,
			TxnType:   txnType,
			Qty:       req.Qty,
			Note:      req.Note,
			CreatedBy: createdBy,
		})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		auditWriteMeta(svc, r, tid, "mfg.inventory.post", "inventory_transaction", txn.ID.String(),
			map[string]any{"txn_type": string(txn.TxnType), "qty": txn.Qty})
		writeJSON(w, 201, txn)
	}
}
