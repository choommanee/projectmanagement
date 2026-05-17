package config

import "github.com/caarlos0/env/v11"

func Load[T any](into *T) error {
	return env.Parse(into)
}
