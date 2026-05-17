package policy

import "testing"

func TestEvaluateAllow(t *testing.T) {
	pol := `permit(principal == User::"alice", action == Action::"read", resource == Doc::"d1");`
	e, err := New([]Policy{{Name: "p1", Body: pol}})
	if err != nil {
		t.Fatal(err)
	}
	ok, err := e.IsAllowed(Request{
		Principal: `User::"alice"`,
		Action:    `Action::"read"`,
		Resource:  `Doc::"d1"`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected allow")
	}
}

func TestEvaluateDenyByDefault(t *testing.T) {
	e, err := New(nil)
	if err != nil {
		t.Fatal(err)
	}
	ok, err := e.IsAllowed(Request{
		Principal: `User::"x"`, Action: `Action::"read"`, Resource: `Doc::"y"`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected deny")
	}
}

func TestEvaluateDenyMismatched(t *testing.T) {
	pol := `permit(principal == User::"alice", action == Action::"read", resource == Doc::"d1");`
	e, _ := New([]Policy{{Name: "p1", Body: pol}})
	ok, err := e.IsAllowed(Request{
		Principal: `User::"bob"`, // different principal
		Action:    `Action::"read"`,
		Resource:  `Doc::"d1"`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected deny for non-matching principal")
	}
}
