package policy

import (
	"os"
	"path/filepath"
	"testing"

	libauth "github.com/pmplatform/libs/go/auth"
)

func TestLoadSharedPermitsPlatformAdmin(t *testing.T) {
	ps, err := LoadShared()
	if err != nil {
		t.Fatalf("LoadShared: %v", err)
	}
	a := &Adapter{Policies: ps}

	allow, err := a.IsAllowed(libauth.AuthzRequest{
		Principal: `User::"sub-1"`,
		Action:    `Action::"jwt.rotate"`,
		Resource:  `Resource::"*"`,
		Context:   map[string]any{"roles": []string{"platform-admin"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !allow {
		t.Fatal("platform-admin should be allowed to jwt.rotate")
	}
}

func TestLoadSharedDeniesNonAdmin(t *testing.T) {
	ps, err := LoadShared()
	if err != nil {
		t.Fatalf("LoadShared: %v", err)
	}
	a := &Adapter{Policies: ps}

	allow, err := a.IsAllowed(libauth.AuthzRequest{
		Principal: `User::"sub-1"`,
		Action:    `Action::"jwt.rotate"`,
		Resource:  `Resource::"*"`,
		Context:   map[string]any{"roles": []string{"viewer"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if allow {
		t.Fatal("non-admin must not be allowed to jwt.rotate")
	}
}

func TestLoadSharedProjectReadIsPublic(t *testing.T) {
	ps, err := LoadShared()
	if err != nil {
		t.Fatalf("LoadShared: %v", err)
	}
	a := &Adapter{Policies: ps}
	allow, err := a.IsAllowed(libauth.AuthzRequest{
		Principal: `User::"sub-1"`,
		Action:    `Action::"project.read"`,
		Resource:  `Project::"p1"`,
		Context:   map[string]any{"roles": []string{}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !allow {
		t.Fatal("project.read should be allowed for any authenticated user")
	}
}

func TestAdapterNilDenies(t *testing.T) {
	var a *Adapter
	allow, err := a.IsAllowed(libauth.AuthzRequest{
		Principal: `User::"x"`,
		Action:    `Action::"jwt.rotate"`,
		Resource:  `Resource::"*"`,
	})
	if err != nil {
		t.Fatalf("nil adapter must not error: %v", err)
	}
	if allow {
		t.Fatal("nil adapter must deny")
	}

	empty := &Adapter{}
	allow, err = empty.IsAllowed(libauth.AuthzRequest{
		Principal: `User::"x"`,
		Action:    `Action::"jwt.rotate"`,
		Resource:  `Resource::"*"`,
	})
	if err != nil {
		t.Fatalf("empty adapter must not error: %v", err)
	}
	if allow {
		t.Fatal("empty adapter must deny")
	}
}

func TestLoadSharedFromPathOverride(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bundle.cedar")
	src := `permit (principal, action == Action::"custom.act", resource);`
	if err := os.WriteFile(path, []byte(src), 0o600); err != nil {
		t.Fatal(err)
	}
	ps, err := LoadSharedFromPath(path)
	if err != nil {
		t.Fatalf("LoadSharedFromPath: %v", err)
	}
	a := &Adapter{Policies: ps}
	allow, err := a.IsAllowed(libauth.AuthzRequest{
		Principal: `User::"x"`,
		Action:    `Action::"custom.act"`,
		Resource:  `Resource::"*"`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !allow {
		t.Fatal("custom action must be allowed by overridden bundle")
	}
}
