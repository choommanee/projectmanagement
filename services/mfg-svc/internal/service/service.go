package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	notiflib "github.com/pmplatform/libs/go/notification"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
	"github.com/pmplatform/services/mfg-svc/internal/store"
)

// Service is the aggregate application service.
type Service struct {
	Items          *store.Items
	WorkCenters    *store.WorkCenters
	BOMs           *store.BOMs
	Routings       *store.Routings
	WorkOrders     *store.WorkOrders
	MRP            *store.MRP
	Genealogy      *store.Genealogy
	Inventory      *store.Inventory
	Suppliers      *store.Suppliers
	PurchaseOrders *store.PurchaseOrders
	MRPEngineURL   string
	TraceEngineURL string
	notif          notiflib.Publisher
	audit          AuditPublisher
}

func New(
	items *store.Items,
	wcs *store.WorkCenters,
	boms *store.BOMs,
	routings *store.Routings,
	wos *store.WorkOrders,
	mrp *store.MRP,
	genealogy *store.Genealogy,
	inventory *store.Inventory,
	suppliers *store.Suppliers,
	purchaseOrders *store.PurchaseOrders,
	mrpEngineURL string,
	traceEngineURL string,
) *Service {
	return &Service{
		Items:          items,
		WorkCenters:    wcs,
		BOMs:           boms,
		Routings:       routings,
		WorkOrders:     wos,
		MRP:            mrp,
		Genealogy:      genealogy,
		Inventory:      inventory,
		Suppliers:      suppliers,
		PurchaseOrders: purchaseOrders,
		MRPEngineURL:   mrpEngineURL,
		TraceEngineURL: traceEngineURL,
		notif:          notiflib.NoopPublisher{},
	}
}

// WithNotifPublisher attaches a notification publisher to the service.
// Returns the receiver for fluent wiring.
func (svc *Service) WithNotifPublisher(pub notiflib.Publisher) *Service {
	svc.notif = pub
	return svc
}

// ReleaseWorkOrder delegates to the store and publishes a notification event.
func (svc *Service) ReleaseWorkOrder(ctx context.Context, tid, woID uuid.UUID, version int, actorID string) (*domain.WorkOrder, error) {
	wo, err := svc.WorkOrders.ReleaseWorkOrder(ctx, tid, woID, version)
	if err != nil {
		return nil, err
	}
	userID := actorID
	if userID == "" {
		userID = tid.String()
	}
	if svc.notif != nil {
		_ = svc.notif.Publish(ctx, notiflib.Event{
			TenantID: tid.String(),
			UserID:   userID,
			Kind:     "mfg.work_order.released",
			Title:    "Work order released",
		})
	}
	return wo, nil
}

// --- UOM ---

type CreateUOMInput struct {
	TenantID    uuid.UUID
	Code        string
	Name        string
	RatioToBase float64
}

func (svc *Service) CreateUOM(ctx context.Context, in CreateUOMInput) (*domain.UOM, error) {
	if strings.TrimSpace(in.Code) == "" || strings.TrimSpace(in.Name) == "" {
		return nil, domain.ErrInvalidInput
	}
	if in.RatioToBase <= 0 {
		in.RatioToBase = 1
	}
	u := &domain.UOM{
		ID:          uuid.New(),
		TenantID:    in.TenantID,
		Code:        strings.ToUpper(strings.TrimSpace(in.Code)),
		Name:        in.Name,
		RatioToBase: in.RatioToBase,
	}
	if err := svc.Items.CreateUOM(ctx, u); err != nil {
		return nil, err
	}
	return u, nil
}

// --- Items ---

type CreateItemInput struct {
	TenantID      uuid.UUID
	Code          string
	Name          string
	Description   string
	Type          domain.ItemType
	Status        domain.ItemStatus
	UomID         uuid.UUID
	LotTracked    bool
	SerialTracked bool
	Attrs         map[string]any
}

func (svc *Service) CreateItem(ctx context.Context, in CreateItemInput) (*domain.Item, error) {
	if strings.TrimSpace(in.Code) == "" {
		return nil, fmt.Errorf("%w: code required", domain.ErrInvalidInput)
	}
	if strings.TrimSpace(in.Name) == "" {
		return nil, fmt.Errorf("%w: name required", domain.ErrInvalidInput)
	}
	if in.Type == "" {
		in.Type = domain.ItemTypeComponent
	}
	if in.Status == "" {
		in.Status = domain.ItemStatusActive
	}
	if in.Attrs == nil {
		in.Attrs = map[string]any{}
	}
	it := &domain.Item{
		ID:            uuid.New(),
		TenantID:      in.TenantID,
		Code:          strings.ToUpper(strings.TrimSpace(in.Code)),
		Name:          in.Name,
		Description:   in.Description,
		Type:          in.Type,
		Status:        in.Status,
		UomID:         in.UomID,
		LotTracked:    in.LotTracked,
		SerialTracked: in.SerialTracked,
		Attrs:         in.Attrs,
		Version:       1,
	}
	if err := svc.Items.Create(ctx, it); err != nil {
		return nil, err
	}
	return it, nil
}

// --- Work Center ---

type CreateWorkCenterInput struct {
	TenantID          uuid.UUID
	Code              string
	Name              string
	Type              domain.WCType
	CapacityPerDayHrs float64
	MachineCount      int
}

func (svc *Service) CreateWorkCenter(ctx context.Context, in CreateWorkCenterInput) (*domain.WorkCenter, error) {
	if strings.TrimSpace(in.Code) == "" || strings.TrimSpace(in.Name) == "" {
		return nil, domain.ErrInvalidInput
	}
	if in.Type == "" {
		in.Type = domain.WCTypeMachine
	}
	if in.CapacityPerDayHrs <= 0 {
		in.CapacityPerDayHrs = 8
	}
	if in.MachineCount <= 0 {
		in.MachineCount = 1
	}
	wc := &domain.WorkCenter{
		ID:                uuid.New(),
		TenantID:          in.TenantID,
		Code:              strings.ToUpper(strings.TrimSpace(in.Code)),
		Name:              in.Name,
		Type:              in.Type,
		CapacityPerDayHrs: in.CapacityPerDayHrs,
		MachineCount:      in.MachineCount,
		Status:            domain.ItemStatusActive,
		Version:           1,
	}
	if err := svc.WorkCenters.Create(ctx, wc); err != nil {
		return nil, err
	}
	return wc, nil
}

// --- MRP ---

// mrpEnginePayloadItem is the per-item payload sent to the Rust engine.
type mrpEnginePayloadItem struct {
	ItemID       string  `json:"item_id"`
	Code         string  `json:"code"`
	DemandQty    float64 `json:"demand_qty"`
	DueDate      string  `json:"due_date"`
	OnHand       float64 `json:"on_hand"`
	LeadTimeDays int     `json:"lead_time_days"`
}

type mrpEnginePayload struct {
	TenantID string                 `json:"tenant_id"`
	Items    []mrpEnginePayloadItem `json:"items"`
}

type mrpEngineDemand struct {
	ItemID    string  `json:"item_id"`
	Qty       float64 `json:"qty"`
	DueDate   string  `json:"due_date"`
	Source    string  `json:"source"`
	SourceRef string  `json:"source_ref"`
}

type mrpEngineSupply struct {
	ItemID      string  `json:"item_id"`
	Qty         float64 `json:"qty"`
	AvailableAt string  `json:"available_at"`
	Source      string  `json:"source"`
	SourceRef   string  `json:"source_ref"`
}

type mrpEngineAction struct {
	Action     string  `json:"action"`
	EntityType string  `json:"entity_type"`
	EntityID   *string `json:"entity_id"`
	Message    string  `json:"message"`
}

type mrpEngineResponse struct {
	Demands []mrpEngineDemand `json:"demands"`
	Supplies []mrpEngineSupply `json:"supplies"`
	Actions []mrpEngineAction `json:"actions"`
}

func (svc *Service) RunMRP(ctx context.Context, tid uuid.UUID, name string) (*domain.MrpRun, error) {
	// 1. Create run record
	run := &domain.MrpRun{
		TenantID: tid,
		Name:     name,
		Params:   map[string]any{},
	}
	if err := svc.MRP.CreateRun(ctx, run); err != nil {
		return nil, err
	}

	// 2. Fetch WOs to build engine payload
	wos, err := svc.WorkOrders.ListForMRP(ctx, tid)
	if err != nil {
		log.Warn().Err(err).Msg("mrp: failed to list WOs")
		wos = nil
	}

	payload := mrpEnginePayload{TenantID: tid.String()}
	for _, wo := range wos {
		due := ""
		if wo.DueDate != nil {
			due = *wo.DueDate
		} else {
			due = time.Now().AddDate(0, 0, 30).Format("2006-01-02")
		}
		payload.Items = append(payload.Items, mrpEnginePayloadItem{
			ItemID:       wo.ItemID.String(),
			Code:         wo.ItemCode,
			DemandQty:    wo.Qty,
			DueDate:      due,
			OnHand:       0,
			LeadTimeDays: 5,
		})
	}

	// 3. Call engine
	var engineResp *mrpEngineResponse
	engineResp, err = svc.callMRPEngine(ctx, payload)
	if err != nil {
		log.Warn().Err(err).Msg("mrp-engine unreachable, using synthetic fallback")
		// Synthetic noop
		engineResp = &mrpEngineResponse{
			Actions: []mrpEngineAction{{
				Action:     "noop",
				EntityType: "mrp_run",
				Message:    "engine unavailable — synthetic run",
			}},
		}
	}

	// 4. Persist results
	var demands []*domain.MrpDemand
	for _, d := range engineResp.Demands {
		itemID, _ := uuid.Parse(d.ItemID)
		var dueDate *time.Time
		if d.DueDate != "" {
			t, err := time.Parse("2006-01-02", d.DueDate)
			if err == nil {
				dueDate = &t
			}
		}
		demands = append(demands, &domain.MrpDemand{
			TenantID:  tid,
			RunID:     run.ID,
			ItemID:    itemID,
			Qty:       d.Qty,
			DueDate:   dueDate,
			Source:    domain.MrpSource(d.Source),
			SourceRef: d.SourceRef,
		})
	}
	if err := svc.MRP.SaveDemands(ctx, tid, demands); err != nil {
		log.Warn().Err(err).Msg("mrp: failed to save demands")
	}

	var supplies []*domain.MrpSupply
	for _, sup := range engineResp.Supplies {
		itemID, _ := uuid.Parse(sup.ItemID)
		var availAt *time.Time
		if sup.AvailableAt != "" {
			t, err := time.Parse("2006-01-02", sup.AvailableAt)
			if err == nil {
				availAt = &t
			}
		}
		supplies = append(supplies, &domain.MrpSupply{
			TenantID:    tid,
			RunID:       run.ID,
			ItemID:      itemID,
			Qty:         sup.Qty,
			AvailableAt: availAt,
			Source:      domain.MrpSource(sup.Source),
			SourceRef:   sup.SourceRef,
		})
	}
	if err := svc.MRP.SaveSupplies(ctx, tid, supplies); err != nil {
		log.Warn().Err(err).Msg("mrp: failed to save supplies")
	}

	var actions []*domain.MrpAction
	for _, a := range engineResp.Actions {
		var eid *uuid.UUID
		if a.EntityID != nil && *a.EntityID != "" {
			id, err := uuid.Parse(*a.EntityID)
			if err == nil {
				eid = &id
			}
		}
		actions = append(actions, &domain.MrpAction{
			TenantID:   tid,
			RunID:      run.ID,
			Action:     domain.MrpActionKind(a.Action),
			EntityType: a.EntityType,
			EntityID:   eid,
			Message:    a.Message,
		})
	}
	if err := svc.MRP.SaveActions(ctx, tid, actions); err != nil {
		log.Warn().Err(err).Msg("mrp: failed to save actions")
	}

	return run, nil
}

func (svc *Service) callMRPEngine(ctx context.Context, payload mrpEnginePayload) (*mrpEngineResponse, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	url := svc.MRPEngineURL + "/run"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mrp-engine returned status %d", resp.StatusCode)
	}
	var result mrpEngineResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}
