package main

import (
	"log"
	"net/http"
	"os"

	"github.com/pmplatform/services/_template/internal/server"
)

func main() {
	addr := ":" + envOr("PORT", "8080")
	log.Printf("listening on %s", addr)
	if err := http.ListenAndServe(addr, server.New()); err != nil {
		log.Fatal(err)
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
