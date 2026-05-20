package service

import (
	"github.com/pmplatform/services/quality-svc/internal/store"
)

// Service aggregates all quality domain stores.
type Service struct {
	APQP        *store.APQP
	PPAP        *store.PPAP
	FMEA        *store.FMEAStore
	ControlPlan *store.ControlPlanStore
	Inspection  *store.InspectionStore
	NCR         *store.NCRStore
}

func New(
	apqp *store.APQP,
	ppap *store.PPAP,
	fmea *store.FMEAStore,
	cp *store.ControlPlanStore,
	insp *store.InspectionStore,
	ncr *store.NCRStore,
) *Service {
	return &Service{
		APQP:        apqp,
		PPAP:        ppap,
		FMEA:        fmea,
		ControlPlan: cp,
		Inspection:  insp,
		NCR:         ncr,
	}
}
