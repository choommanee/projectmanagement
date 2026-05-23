module github.com/pmplatform/services/notification-svc

go 1.25.0

replace (
	github.com/pmplatform/libs/go/auth => ../../libs/go/auth
	github.com/pmplatform/libs/go/nats => ../../libs/go/nats
	github.com/pmplatform/libs/go/notification => ../../libs/go/notification
	github.com/pmplatform/libs/policy => ../../libs/policy
)

require (
	github.com/go-chi/chi/v5 v5.2.5
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.9.2
	github.com/pmplatform/libs/go/auth v0.0.0
	github.com/pmplatform/libs/go/nats v0.0.0
	github.com/pmplatform/libs/go/notification v0.0.0
	github.com/pmplatform/libs/policy v0.0.0
	github.com/rs/zerolog v1.35.1
)

require (
	github.com/cedar-policy/cedar-go v1.6.1 // indirect
	github.com/decred/dcrd/dcrec/secp256k1/v4 v4.4.0 // indirect
	github.com/goccy/go-json v0.10.3 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/klauspost/compress v1.18.5 // indirect
	github.com/lestrrat-go/blackmagic v1.0.3 // indirect
	github.com/lestrrat-go/httpcc v1.0.1 // indirect
	github.com/lestrrat-go/httprc v1.0.6 // indirect
	github.com/lestrrat-go/iter v1.0.2 // indirect
	github.com/lestrrat-go/jwx/v2 v2.1.6 // indirect
	github.com/lestrrat-go/option v1.0.1 // indirect
	github.com/mattn/go-colorable v0.1.14 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/nats-io/nats.go v1.52.0 // indirect
	github.com/nats-io/nkeys v0.4.15 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/segmentio/asm v1.2.1 // indirect
	golang.org/x/crypto v0.51.0 // indirect
	golang.org/x/exp v0.0.0-20220921023135-46d9e7742f1e // indirect
	golang.org/x/sync v0.20.0 // indirect
	golang.org/x/sys v0.44.0 // indirect
	golang.org/x/text v0.37.0 // indirect
	gopkg.in/alexcesaro/quotedprintable.v3 v3.0.0-20150716171945-2caba252f4dc // indirect
	gopkg.in/gomail.v2 v2.0.0-20160411212932-81ebce5c23df // indirect
)
