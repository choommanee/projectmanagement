package auth

import "net/http"

func TenantHeader(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if c, ok := FromCtx(r.Context()); ok && c.TenantID != "" {
            r.Header.Set("X-Tenant-Id", c.TenantID)
        }
        next.ServeHTTP(w, r)
    })
}
