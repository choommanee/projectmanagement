package service_test

import (
	"testing"
	"time"

	"github.com/pmplatform/services/audit-svc/internal/service"
)

func TestParseTime_DateOnlyIsStartOfDay(t *testing.T) {
	got := service.ParseTime("2026-06-07")
	if got == nil {
		t.Fatal("expected non-nil time")
	}
	want := time.Date(2026, 6, 7, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("ParseTime date-only = %v, want %v (start of day)", got, want)
	}
}

func TestParseTimeUpper_DateOnlyIsEndOfDay(t *testing.T) {
	got := service.ParseTimeUpper("2026-06-07")
	if got == nil {
		t.Fatal("expected non-nil time")
	}
	// End of day must be on 2026-06-07 (not rolled into the 8th) and after
	// every real timestamp on that day. This is the bound that makes a
	// same-day from==to filter (sparkline drill-down) return that day's rows.
	if got.Year() != 2026 || got.Month() != time.June || got.Day() != 7 {
		t.Fatalf("ParseTimeUpper rolled off the day: %v", got)
	}
	noon := time.Date(2026, 6, 7, 12, 0, 0, 0, time.UTC)
	if !got.After(noon) {
		t.Fatalf("ParseTimeUpper %v should be after midday %v", got, noon)
	}
	nextMidnight := time.Date(2026, 6, 8, 0, 0, 0, 0, time.UTC)
	if !got.Before(nextMidnight) {
		t.Fatalf("ParseTimeUpper %v should be before next midnight %v", got, nextMidnight)
	}
}

func TestParseTimeUpper_RFC3339PassesThrough(t *testing.T) {
	got := service.ParseTimeUpper("2026-06-07T08:30:00Z")
	if got == nil {
		t.Fatal("expected non-nil time")
	}
	want := time.Date(2026, 6, 7, 8, 30, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("ParseTimeUpper datetime = %v, want %v", got, want)
	}
}

func TestParseTime_EmptyReturnsNil(t *testing.T) {
	if service.ParseTime("") != nil {
		t.Fatal("ParseTime(\"\") should be nil")
	}
	if service.ParseTimeUpper("") != nil {
		t.Fatal("ParseTimeUpper(\"\") should be nil")
	}
}
