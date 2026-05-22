package policy

import (
	"testing"

	libauth "github.com/pmplatform/libs/go/auth"
)

func TestBundleLoadsAndPermitsPlatformAdmin(t *testing.T) {
	eng, err := LoadBundle("")
	if err != nil {
		t.Fatalf("LoadBundle: %v", err)
	}
	a := Adapter{E: eng}

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

func TestBundleDeniesNonAdmin(t *testing.T) {
	eng, err := LoadBundle("")
	if err != nil {
		t.Fatalf("LoadBundle: %v", err)
	}
	a := Adapter{E: eng}

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

func TestBundleProjectReadIsPublic(t *testing.T) {
	eng, err := LoadBundle("")
	if err != nil {
		t.Fatalf("LoadBundle: %v", err)
	}
	a := Adapter{E: eng}
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
