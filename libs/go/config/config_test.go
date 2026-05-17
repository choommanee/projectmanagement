package config

import (
	"os"
	"testing"
)

type sample struct {
	Port int    `env:"PORT" envDefault:"8080"`
	Name string `env:"NAME,required"`
}

func TestLoadFromEnv(t *testing.T) {
	t.Setenv("NAME", "svc-x")
	t.Setenv("PORT", "9000")
	var c sample
	if err := Load(&c); err != nil {
		t.Fatal(err)
	}
	if c.Port != 9000 || c.Name != "svc-x" {
		t.Fatalf("got %+v", c)
	}
}

func TestLoadMissingRequired(t *testing.T) {
	os.Unsetenv("NAME")
	var c sample
	if err := Load(&c); err == nil {
		t.Fatal("expected error")
	}
}
