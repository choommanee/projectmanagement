package logger

import (
	"io"
	"os"

	"github.com/rs/zerolog"
)

func New(level string) zerolog.Logger {
	return NewWithWriter(os.Stdout, level)
}

func NewWithWriter(w io.Writer, level string) zerolog.Logger {
	lvl, err := zerolog.ParseLevel(level)
	if err != nil {
		lvl = zerolog.InfoLevel
	}
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnixMs
	return zerolog.New(w).Level(lvl).With().Timestamp().Logger()
}
