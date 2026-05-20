package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/pmplatform/services/quality-svc/internal/domain"
	"github.com/pmplatform/services/quality-svc/internal/service"
	"github.com/pmplatform/services/quality-svc/internal/store"
)

func NewRouter(svc *service.Service) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	r.Route("/v1", func(r chi.Router) {
		// APQP
		r.Get("/apqp", listAPQP(svc))
		r.Post("/apqp", createAPQP(svc))
		r.Get("/apqp/{id}", getAPQP(svc))
		r.Patch("/apqp/{id}", updateAPQP(svc))
		r.Delete("/apqp/{id}", deleteAPQP(svc))

		// PPAP
		r.Get("/ppap", listPPAP(svc))
		r.Post("/ppap", createPPAP(svc))
		r.Get("/ppap/{id}", getPPAP(svc))
		r.Patch("/ppap/{id}", updatePPAP(svc))
		r.Delete("/ppap/{id}", deletePPAP(svc))
		r.Get("/ppap/{id}/elements", listPPAPElements(svc))
		r.Patch("/ppap-elements/{id}", updatePPAPElement(svc))

		// FMEA
		r.Get("/fmea", listFMEA(svc))
		r.Post("/fmea", createFMEA(svc))
		r.Get("/fmea/{id}", getFMEA(svc))
		r.Patch("/fmea/{id}", updateFMEA(svc))
		r.Delete("/fmea/{id}", deleteFMEA(svc))
		r.Get("/fmea/{id}/modes", listFMEAModes(svc))
		r.Post("/fmea/{id}/modes", addFMEAMode(svc))
		r.Patch("/fmea-modes/{id}", updateFMEAMode(svc))
		r.Delete("/fmea-modes/{id}", deleteFMEAMode(svc))

		// Control Plans
		r.Get("/control-plans", listControlPlans(svc))
		r.Post("/control-plans", createControlPlan(svc))
		r.Get("/control-plans/{id}", getControlPlan(svc))
		r.Patch("/control-plans/{id}", updateControlPlan(svc))
		r.Get("/control-plans/{id}/characteristics", listCharacteristics(svc))
		r.Post("/control-plans/{id}/characteristics", addCharacteristic(svc))
		r.Patch("/control-plan-chars/{id}", updateCharacteristic(svc))
		r.Delete("/control-plan-chars/{id}", deleteCharacteristic(svc))

		// Inspections
		r.Get("/inspections", listInspections(svc))
		r.Post("/inspections", createInspection(svc))
		r.Get("/inspections/{id}", getInspection(svc))

		// NCRs
		r.Get("/ncrs", listNCRs(svc))
		r.Post("/ncrs", createNCR(svc))
		r.Get("/ncrs/{id}", getNCR(svc))
		r.Patch("/ncrs/{id}", updateNCR(svc))
		r.Post("/ncrs/{id}/capa", createCAPA(svc))
		r.Get("/ncrs/{id}/capa", listCAPA(svc))
		r.Patch("/capa/{id}", updateCAPA(svc))
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

// ---- APQP ----

type createAPQPReq struct {
	ItemID      *uuid.UUID         `json:"item_id,omitempty"`
	WorkOrderID *uuid.UUID         `json:"work_order_id,omitempty"`
	Name        string             `json:"name"`
	Phase       domain.APQPPhase   `json:"phase,omitempty"`
	Status      domain.APQPStatus  `json:"status,omitempty"`
	TargetDate  *string            `json:"target_date,omitempty"`
	OwnerID     *uuid.UUID         `json:"owner_id,omitempty"`
}

func createAPQP(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createAPQPReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Name == "" {
			writeErr(w, 400, errors.New("name required"))
			return
		}
		if req.Phase == "" {
			req.Phase = domain.APQPPhaseConcept
		}
		if req.Status == "" {
			req.Status = domain.APQPStatusNotStarted
		}
		a := &domain.APQPProject{
			TenantID:    tid,
			ItemID:      req.ItemID,
			WorkOrderID: req.WorkOrderID,
			Name:        req.Name,
			Phase:       req.Phase,
			Status:      req.Status,
			OwnerID:     req.OwnerID,
			Milestones:  []byte("[]"),
		}
		if req.TargetDate != nil {
			if t, err := time.Parse("2006-01-02", *req.TargetDate); err == nil {
				a.TargetDate = &t
			}
		}
		if err := svc.APQP.Create(r.Context(), a); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, a)
	}
}

func getAPQP(svc *service.Service) http.HandlerFunc {
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
		a, err := svc.APQP.GetByID(r.Context(), tid, id)
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

func listAPQP(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListAPQPOpts{
			Phase:  r.URL.Query().Get("phase"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		if s := r.URL.Query().Get("item_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				opts.ItemID = &id
			}
		}
		if s := r.URL.Query().Get("work_order_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				opts.WorkOrderID = &id
			}
		}
		items, total, err := svc.APQP.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateAPQPReq struct {
	Name       string             `json:"name,omitempty"`
	Phase      domain.APQPPhase   `json:"phase,omitempty"`
	Status     domain.APQPStatus  `json:"status,omitempty"`
	TargetDate *string            `json:"target_date,omitempty"`
	OwnerID    *uuid.UUID         `json:"owner_id,omitempty"`
	Milestones json.RawMessage    `json:"milestones,omitempty"`
	Version    int                `json:"version"`
}

func updateAPQP(svc *service.Service) http.HandlerFunc {
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
		// Get current to merge
		cur, err := svc.APQP.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updateAPQPReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateAPQPInput{
			Name:       cur.Name,
			Phase:      cur.Phase,
			Status:     cur.Status,
			Milestones: cur.Milestones,
			TargetDate: cur.TargetDate,
			OwnerID:    cur.OwnerID,
			Version:    req.Version,
		}
		if req.Name != "" {
			in.Name = req.Name
		}
		if req.Phase != "" {
			in.Phase = req.Phase
		}
		if req.Status != "" {
			in.Status = req.Status
		}
		if req.Milestones != nil {
			in.Milestones = req.Milestones
		}
		if req.TargetDate != nil {
			if t, err := time.Parse("2006-01-02", *req.TargetDate); err == nil {
				in.TargetDate = &t
			}
		}
		if req.OwnerID != nil {
			in.OwnerID = req.OwnerID
		}
		a, err := svc.APQP.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, a)
	}
}

func deleteAPQP(svc *service.Service) http.HandlerFunc {
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
		if err := svc.APQP.Delete(r.Context(), tid, id, version); err != nil {
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

// ---- PPAP ----

type createPPAPReq struct {
	ItemID   uuid.UUID  `json:"item_id"`
	PartNo   string     `json:"part_no"`
	Customer string     `json:"customer,omitempty"`
	Level    int        `json:"level"`
	Notes    string     `json:"notes,omitempty"`
}

func createPPAP(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createPPAPReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.PartNo == "" || req.Level < 1 || req.Level > 5 {
			writeErr(w, 400, errors.New("part_no and level (1-5) required"))
			return
		}
		sub := &domain.PPAPSubmission{
			TenantID: tid,
			ItemID:   req.ItemID,
			PartNo:   req.PartNo,
			Customer: req.Customer,
			Level:    req.Level,
			Notes:    req.Notes,
		}
		if err := svc.PPAP.Create(r.Context(), sub); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, sub)
	}
}

func getPPAP(svc *service.Service) http.HandlerFunc {
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
		p, err := svc.PPAP.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, p)
	}
}

func listPPAP(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListPPAPOpts{
			Status: r.URL.Query().Get("status"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		if s := r.URL.Query().Get("item_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				opts.ItemID = &id
			}
		}
		items, total, err := svc.PPAP.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updatePPAPReq struct {
	Status      domain.PPAPStatus `json:"status,omitempty"`
	Notes       string            `json:"notes,omitempty"`
	SubmittedAt *string           `json:"submitted_at,omitempty"`
	DecisionAt  *string           `json:"decision_at,omitempty"`
	Version     int               `json:"version"`
}

func updatePPAP(svc *service.Service) http.HandlerFunc {
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
		cur, err := svc.PPAP.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updatePPAPReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdatePPAPInput{
			Status:      cur.Status,
			Notes:       cur.Notes,
			SubmittedAt: cur.SubmittedAt,
			DecisionAt:  cur.DecisionAt,
			Version:     req.Version,
		}
		if req.Status != "" {
			in.Status = req.Status
		}
		if req.Notes != "" {
			in.Notes = req.Notes
		}
		sub, err := svc.PPAP.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, sub)
	}
}

func deletePPAP(svc *service.Service) http.HandlerFunc {
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
		if err := svc.PPAP.Delete(r.Context(), tid, id, version); err != nil {
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

func listPPAPElements(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		subID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		elems, err := svc.PPAP.ListElements(r.Context(), tid, subID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": elems, "total": len(elems)})
	}
}

type updateElemReq struct {
	Status      domain.PPAPElementStatus `json:"status,omitempty"`
	EvidenceURL string                   `json:"evidence_url,omitempty"`
	Notes       string                   `json:"notes,omitempty"`
}

func updatePPAPElement(svc *service.Service) http.HandlerFunc {
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
		var req updateElemReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		e, err := svc.PPAP.UpdateElement(r.Context(), tid, id, store.UpdatePPAPElementInput{
			Status:      req.Status,
			EvidenceURL: req.EvidenceURL,
			Notes:       req.Notes,
		})
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

// ---- FMEA ----

type createFMEAReq struct {
	Type   domain.FMEAType  `json:"type,omitempty"`
	ItemID *uuid.UUID       `json:"item_id,omitempty"`
	Name   string           `json:"name"`
	Team   []string         `json:"team,omitempty"`
}

func createFMEA(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createFMEAReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Name == "" {
			writeErr(w, 400, errors.New("name required"))
			return
		}
		if req.Type == "" {
			req.Type = domain.FMEATypePFMEA
		}
		f := &domain.FMEA{
			TenantID: tid,
			Type:     req.Type,
			ItemID:   req.ItemID,
			Name:     req.Name,
			Team:     req.Team,
		}
		if err := svc.FMEA.Create(r.Context(), f); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, f)
	}
}

func getFMEA(svc *service.Service) http.HandlerFunc {
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
		f, err := svc.FMEA.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, f)
	}
}

func listFMEA(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListFMEAOpts{
			Type:   r.URL.Query().Get("type"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		if s := r.URL.Query().Get("item_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				opts.ItemID = &id
			}
		}
		items, total, err := svc.FMEA.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateFMEAReq struct {
	Name    string            `json:"name,omitempty"`
	Status  domain.APQPStatus `json:"status,omitempty"`
	Team    []string          `json:"team,omitempty"`
	Version int               `json:"version"`
}

func updateFMEA(svc *service.Service) http.HandlerFunc {
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
		cur, err := svc.FMEA.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updateFMEAReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateFMEAInput{
			Name:    cur.Name,
			Status:  cur.Status,
			Team:    cur.Team,
			Version: req.Version,
		}
		if req.Name != "" {
			in.Name = req.Name
		}
		if req.Status != "" {
			in.Status = req.Status
		}
		if req.Team != nil {
			in.Team = req.Team
		}
		f, err := svc.FMEA.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, f)
	}
}

func deleteFMEA(svc *service.Service) http.HandlerFunc {
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
		if err := svc.FMEA.Delete(r.Context(), tid, id, version); err != nil {
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

func listFMEAModes(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		fmeaID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		modes, err := svc.FMEA.ListFailureModes(r.Context(), tid, fmeaID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": modes, "total": len(modes)})
	}
}

type addFMEAModeReq struct {
	Function    string  `json:"function"`
	FailureMode string  `json:"failure_mode"`
	Effect      string  `json:"effect,omitempty"`
	Severity    int     `json:"severity"`
	Cause       string  `json:"cause,omitempty"`
	Occurrence  int     `json:"occurrence"`
	Detection   int     `json:"detection"`
	Actions     string  `json:"actions,omitempty"`
	TargetDate  *string `json:"target_date,omitempty"`
	SortOrder   int     `json:"sort_order,omitempty"`
}

func addFMEAMode(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		fmeaID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req addFMEAModeReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		m := &domain.FMEAFailureMode{
			TenantID:    tid,
			FMEAID:      fmeaID,
			Function:    req.Function,
			FailureMode: req.FailureMode,
			Effect:      req.Effect,
			Severity:    req.Severity,
			Cause:       req.Cause,
			Occurrence:  req.Occurrence,
			Detection:   req.Detection,
			Actions:     req.Actions,
			SortOrder:   req.SortOrder,
		}
		if req.TargetDate != nil {
			if t, err := time.Parse("2006-01-02", *req.TargetDate); err == nil {
				m.TargetDate = &t
			}
		}
		if err := svc.FMEA.AddFailureMode(r.Context(), m); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, m)
	}
}

func updateFMEAMode(svc *service.Service) http.HandlerFunc {
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
		var req addFMEAModeReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateFMEAModeInput{
			Function:    req.Function,
			FailureMode: req.FailureMode,
			Effect:      req.Effect,
			Severity:    req.Severity,
			Cause:       req.Cause,
			Occurrence:  req.Occurrence,
			Detection:   req.Detection,
			Actions:     req.Actions,
			SortOrder:   req.SortOrder,
		}
		if req.TargetDate != nil {
			if t, err := time.Parse("2006-01-02", *req.TargetDate); err == nil {
				in.TargetDate = &t
			}
		}
		m, err := svc.FMEA.UpdateFailureMode(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, m)
	}
}

func deleteFMEAMode(svc *service.Service) http.HandlerFunc {
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
		if err := svc.FMEA.DeleteFailureMode(r.Context(), tid, id); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		w.WriteHeader(204)
	}
}

// ---- Control Plans ----

type createCPReq struct {
	ItemID uuid.UUID         `json:"item_id"`
	Name   string            `json:"name"`
	Status domain.APQPStatus `json:"status,omitempty"`
	Notes  string            `json:"notes,omitempty"`
}

func createControlPlan(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createCPReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Name == "" {
			writeErr(w, 400, errors.New("name required"))
			return
		}
		c := &domain.ControlPlan{
			TenantID: tid,
			ItemID:   req.ItemID,
			Name:     req.Name,
			Status:   req.Status,
			Notes:    req.Notes,
		}
		if err := svc.ControlPlan.Create(r.Context(), c); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, c)
	}
}

func getControlPlan(svc *service.Service) http.HandlerFunc {
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
		c, err := svc.ControlPlan.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, c)
	}
}

func listControlPlans(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListCPOpts{
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		if s := r.URL.Query().Get("item_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				opts.ItemID = &id
			}
		}
		items, total, err := svc.ControlPlan.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateCPReq struct {
	Name    string            `json:"name,omitempty"`
	Status  domain.APQPStatus `json:"status,omitempty"`
	Notes   string            `json:"notes,omitempty"`
	Version int               `json:"version"`
}

func updateControlPlan(svc *service.Service) http.HandlerFunc {
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
		cur, err := svc.ControlPlan.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updateCPReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateCPInput{
			Name:    cur.Name,
			Status:  cur.Status,
			Notes:   cur.Notes,
			Version: req.Version,
		}
		if req.Name != "" {
			in.Name = req.Name
		}
		if req.Status != "" {
			in.Status = req.Status
		}
		if req.Notes != "" {
			in.Notes = req.Notes
		}
		c, err := svc.ControlPlan.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, c)
	}
}

func listCharacteristics(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		cpID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		chars, err := svc.ControlPlan.ListCharacteristics(r.Context(), tid, cpID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": chars, "total": len(chars)})
	}
}

type addCharReq struct {
	No                int    `json:"no"`
	Characteristic    string `json:"characteristic"`
	Spec              string `json:"spec,omitempty"`
	SampleSize        string `json:"sample_size,omitempty"`
	SampleFreq        string `json:"sample_freq,omitempty"`
	MeasurementMethod string `json:"measurement_method,omitempty"`
	ReactionPlan      string `json:"reaction_plan,omitempty"`
	SortOrder         int    `json:"sort_order,omitempty"`
}

func addCharacteristic(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		cpID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req addCharReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		c := &domain.ControlPlanCharacteristic{
			TenantID:          tid,
			ControlPlanID:     cpID,
			No:                req.No,
			Characteristic:    req.Characteristic,
			Spec:              req.Spec,
			SampleSize:        req.SampleSize,
			SampleFreq:        req.SampleFreq,
			MeasurementMethod: req.MeasurementMethod,
			ReactionPlan:      req.ReactionPlan,
			SortOrder:         req.SortOrder,
		}
		if err := svc.ControlPlan.AddCharacteristic(r.Context(), c); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, c)
	}
}

func updateCharacteristic(svc *service.Service) http.HandlerFunc {
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
		var req addCharReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		c, err := svc.ControlPlan.UpdateCharacteristic(r.Context(), tid, id, store.UpdateCPCInput{
			No:                req.No,
			Characteristic:    req.Characteristic,
			Spec:              req.Spec,
			SampleSize:        req.SampleSize,
			SampleFreq:        req.SampleFreq,
			MeasurementMethod: req.MeasurementMethod,
			ReactionPlan:      req.ReactionPlan,
			SortOrder:         req.SortOrder,
		})
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, c)
	}
}

func deleteCharacteristic(svc *service.Service) http.HandlerFunc {
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
		if err := svc.ControlPlan.DeleteCharacteristic(r.Context(), tid, id); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		w.WriteHeader(204)
	}
}

// ---- Inspections ----

type createInspectionReq struct {
	WorkOrderID *uuid.UUID               `json:"work_order_id,omitempty"`
	ItemID      uuid.UUID                `json:"item_id"`
	LotID       *uuid.UUID               `json:"lot_id,omitempty"`
	Inspector   string                   `json:"inspector,omitempty"`
	Result      domain.InspectionResult  `json:"result,omitempty"`
	Notes       string                   `json:"notes,omitempty"`
	Measurements json.RawMessage         `json:"measurements,omitempty"`
}

func createInspection(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createInspectionReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		i := &domain.Inspection{
			TenantID:    tid,
			WorkOrderID: req.WorkOrderID,
			ItemID:      req.ItemID,
			LotID:       req.LotID,
			Inspector:   req.Inspector,
			Result:      req.Result,
			Notes:       req.Notes,
		}
		if req.Measurements != nil {
			i.Measurements = []byte(req.Measurements)
		}
		if err := svc.Inspection.Create(r.Context(), i); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, i)
	}
}

func getInspection(svc *service.Service) http.HandlerFunc {
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
		i, err := svc.Inspection.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, i)
	}
}

func listInspections(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListInspectionOpts{
			Result: r.URL.Query().Get("result"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		if s := r.URL.Query().Get("work_order_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				opts.WorkOrderID = &id
			}
		}
		if s := r.URL.Query().Get("item_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				opts.ItemID = &id
			}
		}
		items, total, err := svc.Inspection.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

// ---- NCRs ----

type createNCRReq struct {
	ItemID      uuid.UUID  `json:"item_id"`
	LotID       *uuid.UUID `json:"lot_id,omitempty"`
	WorkOrderID *uuid.UUID `json:"work_order_id,omitempty"`
	Qty         float64    `json:"qty"`
	Severity    int        `json:"severity"`
	Description string     `json:"description"`
}

func createNCR(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createNCRReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Description == "" {
			writeErr(w, 400, errors.New("description required"))
			return
		}
		n := &domain.Nonconformance{
			TenantID:    tid,
			ItemID:      req.ItemID,
			LotID:       req.LotID,
			WorkOrderID: req.WorkOrderID,
			Qty:         req.Qty,
			Severity:    req.Severity,
			Description: req.Description,
		}
		if n.Severity < 1 || n.Severity > 5 {
			n.Severity = 1
		}
		if err := svc.NCR.Create(r.Context(), n); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, n)
	}
}

func getNCR(svc *service.Service) http.HandlerFunc {
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
		n, err := svc.NCR.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, n)
	}
}

func listNCRs(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListNCROpts{
			Status: r.URL.Query().Get("status"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		if s := r.URL.Query().Get("item_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				opts.ItemID = &id
			}
		}
		items, total, err := svc.NCR.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateNCRReq struct {
	Status      domain.NCRStatus `json:"status,omitempty"`
	Description string           `json:"description,omitempty"`
	Version     int              `json:"version"`
}

func updateNCR(svc *service.Service) http.HandlerFunc {
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
		cur, err := svc.NCR.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updateNCRReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateNCRInput{
			Status:      cur.Status,
			Description: cur.Description,
			Version:     req.Version,
		}
		if req.Status != "" {
			in.Status = req.Status
		}
		if req.Description != "" {
			in.Description = req.Description
		}
		n, err := svc.NCR.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, n)
	}
}

type createCAPAReq struct {
	RootCause  string     `json:"root_cause,omitempty"`
	Action     string     `json:"action,omitempty"`
	OwnerID    *uuid.UUID `json:"owner_id,omitempty"`
	TargetDate *string    `json:"target_date,omitempty"`
	Evidence   string     `json:"evidence,omitempty"`
}

func createCAPA(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		ncrID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req createCAPAReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		c := &domain.CAPA{
			TenantID:         tid,
			NonconformanceID: ncrID,
			RootCause:        req.RootCause,
			Action:           req.Action,
			OwnerID:          req.OwnerID,
			Evidence:         req.Evidence,
		}
		if req.TargetDate != nil {
			if t, err := time.Parse("2006-01-02", *req.TargetDate); err == nil {
				c.TargetDate = &t
			}
		}
		if err := svc.NCR.CreateCAPA(r.Context(), c); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, c)
	}
}

func listCAPA(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		ncrID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		items, err := svc.NCR.GetCAPA(r.Context(), tid, ncrID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
	}
}

type updateCAPAReq struct {
	RootCause  string            `json:"root_cause,omitempty"`
	Action     string            `json:"action,omitempty"`
	Status     domain.APQPStatus `json:"status,omitempty"`
	Evidence   string            `json:"evidence,omitempty"`
	TargetDate *string           `json:"target_date,omitempty"`
	OwnerID    *uuid.UUID        `json:"owner_id,omitempty"`
}

func updateCAPA(svc *service.Service) http.HandlerFunc {
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
		var req updateCAPAReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateCAPAInput{
			RootCause: req.RootCause,
			Action:    req.Action,
			Status:    req.Status,
			Evidence:  req.Evidence,
			OwnerID:   req.OwnerID,
		}
		if req.TargetDate != nil {
			if t, err := time.Parse("2006-01-02", *req.TargetDate); err == nil {
				in.TargetDate = &t
			}
		}
		c, err := svc.NCR.UpdateCAPA(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, c)
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
