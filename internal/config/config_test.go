package config_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Loxstomper/decks/internal/config"
)

func TestDefaults_WhenFileAbsent(t *testing.T) {
	cfg, err := config.Load("/nonexistent/path/config.toml")
	if err != nil {
		t.Fatalf("expected no error for missing file, got: %v", err)
	}
	if cfg.Port != 3000 {
		t.Errorf("default port: want 3000, got %d", cfg.Port)
	}
	if cfg.AspectRatio != "16:9" {
		t.Errorf("default aspect_ratio: want 16:9, got %q", cfg.AspectRatio)
	}
	if cfg.GridSize != 8 {
		t.Errorf("default grid_size: want 8, got %d", cfg.GridSize)
	}
	if len(cfg.EnabledProviders) != 0 {
		t.Errorf("default enabled_providers: want empty, got %v", cfg.EnabledProviders)
	}
}

func TestLoad_OverridesDefaults(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	content := `port = 8080
aspect_ratio = "4:3"
grid_size = 16
enabled_providers = ["unsplash", "giphy"]
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write toml: %v", err)
	}

	cfg, err := config.Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != 8080 {
		t.Errorf("port: want 8080, got %d", cfg.Port)
	}
	if cfg.AspectRatio != "4:3" {
		t.Errorf("aspect_ratio: want 4:3, got %q", cfg.AspectRatio)
	}
	if cfg.GridSize != 16 {
		t.Errorf("grid_size: want 16, got %d", cfg.GridSize)
	}
	if len(cfg.EnabledProviders) != 2 {
		t.Errorf("enabled_providers: want 2, got %v", cfg.EnabledProviders)
	}
}

func TestLoad_InvalidTOML_ReturnsError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte("not = valid [ toml {{"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := config.Load(path)
	if err == nil {
		t.Fatal("expected error for invalid TOML, got nil")
	}
}
