// Package scheduler runs the background timer that wakes paused workflow
// instances whose wait-step timer (wake_at) has elapsed, and resumes them.
package scheduler

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/pmplatform/services/workflow-svc/internal/service"
	"github.com/pmplatform/services/workflow-svc/internal/store"
)

// Poller periodically finds due paused instances and resumes them.
type Poller struct {
	svc       *service.Service
	instances *store.Instances
	interval  time.Duration
	batch     int
	stop      chan struct{}
	done      chan struct{}
}

// New constructs a Poller. interval<=0 defaults to 30s.
func New(svc *service.Service, instances *store.Instances, interval time.Duration) *Poller {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	return &Poller{
		svc:       svc,
		instances: instances,
		interval:  interval,
		batch:     100,
		stop:      make(chan struct{}),
		done:      make(chan struct{}),
	}
}

// Start launches the poll loop in a goroutine. Call Stop to terminate it.
func (p *Poller) Start(ctx context.Context) {
	go func() {
		defer close(p.done)
		ticker := time.NewTicker(p.interval)
		defer ticker.Stop()
		log.Info().Dur("interval", p.interval).Msg("workflow scheduler poller started")
		for {
			select {
			case <-ctx.Done():
				return
			case <-p.stop:
				return
			case <-ticker.C:
				p.tick(ctx)
			}
		}
	}()
}

// Stop signals the loop to terminate and waits for it to finish.
func (p *Poller) Stop() {
	close(p.stop)
	<-p.done
}

// tick processes one batch of due wakes. Exported indirectly via RunOnce for tests.
func (p *Poller) tick(ctx context.Context) {
	p.RunOnce(ctx)
}

// RunOnce finds due wakes and resumes each. Returns the number of instances
// it attempted to resume. Errors per instance are logged, not fatal.
func (p *Poller) RunOnce(ctx context.Context) int {
	due, err := p.instances.FindDueWakes(ctx, p.batch)
	if err != nil {
		log.Warn().Err(err).Msg("scheduler: find due wakes failed")
		return 0
	}
	for _, d := range due {
		p.resume(ctx, d.TenantID, d.InstanceID)
	}
	return len(due)
}

func (p *Poller) resume(ctx context.Context, tid, instID uuid.UUID) {
	_, err := p.svc.ResumeInstance(ctx, service.ResumeInstanceInput{
		TenantID:   tid,
		InstanceID: instID,
	})
	if err != nil {
		log.Warn().Err(err).Str("instance", instID.String()).Msg("scheduler: resume failed")
	}
}
