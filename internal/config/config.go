// Package config loads editor preferences from config.toml (non-secret) and
// exposes sane defaults when the file is absent.  Secrets (API keys, etc.)
// must come from environment variables – never from config.toml.
package config

import (
	"log"
	"os"

	"github.com/BurntSushi/toml"
)

// Config holds editor preferences read from config.toml.
type Config struct {
	Port             int      `toml:"port"`
	AspectRatio      string   `toml:"aspect_ratio"`
	GridSize         int      `toml:"grid_size"`
	EnabledProviders []string `toml:"enabled_providers"`
}

// defaults returns a Config with built-in sane defaults.
func defaults() Config {
	return Config{
		Port:             3000,
		AspectRatio:      "16:9",
		GridSize:         8,
		EnabledProviders: []string{},
	}
}

// Load reads config.toml from path.  If the file does not exist the defaults
// are returned without error.  Any other I/O error is returned.
func Load(path string) (Config, error) {
	cfg := defaults()

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("config: %s not found, using defaults", path)
			return cfg, nil
		}
		return cfg, err
	}

	if _, err := toml.Decode(string(data), &cfg); err != nil {
		return cfg, err
	}
	log.Printf("config: loaded %s (port=%d, aspect=%s, grid=%d)", path, cfg.Port, cfg.AspectRatio, cfg.GridSize)
	return cfg, nil
}
