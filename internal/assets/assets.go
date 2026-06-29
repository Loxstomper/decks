// Package assets implements the asset copy pipeline for slides-builder.
//
// # Storage model (spec 08, spec 12)
//
// Assets are stored per-deck under decks/<name>/assets/ so each deck is
// self-contained and portable.  Shared library files (shared/) are COPIED
// into the deck's assets/ on insert — never referenced cross-deck — keeping
// decks offline-capable without dependencies on each other.
//
// # Traversal safety (spec 12)
//
// All paths are constructed from deck.DeckPath + a program-controlled subdir.
// The original filename is sanitised through SafeFilename which strips every
// directory component and replaces path-unsafe characters, so a crafted
// filename cannot escape the assets/ subtree.
//
// # Deduplication
//
// Before writing, the content SHA-256 is compared against the existing file
// (if any).  Same content → return the existing relative src without a second
// write.  Different content at the same path → append _1, _2, … until a free
// slot is found.
package assets

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

// subdirFor returns the assets/ sub-directory for a given MIME type prefix.
// This keeps images, videos, and generic files in separate folders for clarity.
func subdirFor(mimeType string) string {
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return "img"
	case strings.HasPrefix(mimeType, "video/"):
		return "video"
	case strings.HasPrefix(mimeType, "audio/"):
		return "audio"
	default:
		return "files"
	}
}

// SafeFilename strips all directory components from name, then replaces any
// character that is not alphanumeric, '.', '-', or '_' with '_'.  The result
// is guaranteed to be a safe single-segment filename with no path separators.
// An empty or all-unsafe input returns "file".
func SafeFilename(name string) string {
	// Keep only the base name — strip any directory the client may have sent.
	base := filepath.Base(name)

	var b strings.Builder
	for _, r := range base {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '.' || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	safe := b.String()
	if safe == "" || safe == "." {
		return "file"
	}
	return safe
}

// hashBytes returns the SHA-256 hex digest of data.
func hashBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return fmt.Sprintf("%x", sum)
}

// hashFile returns the SHA-256 hex digest of the file at path, or "" on error.
func hashFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return hashBytes(data)
}

// dedupeWrite writes data to a file in destDir with the given filename.
// If a file with the same name and identical content already exists, the
// existing filename is returned (no-op).  If the name exists with different
// content, numeric suffixes (_1, _2, …) are tried on the stem until a free
// slot is found.  Returns the final filename chosen (not a full path).
func dedupeWrite(destDir, filename string, data []byte) (string, error) {
	target := filepath.Join(destDir, filename)
	wantHash := hashBytes(data)

	// Check if the exact filename exists.
	if _, err := os.Stat(target); err == nil {
		// File exists — same content?
		if hashFile(target) == wantHash {
			// Idempotent: already localized.
			return filename, nil
		}
		// Different content: find a free name by appending _1, _2, …
		ext := filepath.Ext(filename)
		stem := strings.TrimSuffix(filename, ext)
		for i := 1; i < 10000; i++ {
			candidate := fmt.Sprintf("%s_%d%s", stem, i, ext)
			t2 := filepath.Join(destDir, candidate)
			if _, err2 := os.Stat(t2); os.IsNotExist(err2) {
				// Free slot found.
				filename = candidate
				target = t2
				break
			}
			// That slot also exists — check for content match (rare but possible).
			if hashFile(t2) == wantHash {
				return candidate, nil
			}
		}
	}

	// Write the file.
	if err := os.WriteFile(target, data, 0o644); err != nil {
		return "", fmt.Errorf("assets: write %s: %w", target, err)
	}
	return filename, nil
}

// LocalizeReader copies bytes from r into decks/<deckName>/assets/<subdir>/
// under root, inferring the sub-directory from mimeType.  originalName
// provides the filename hint; it is sanitised before use.
//
// Returns the relative src suitable for an HTML <img src="…"> attribute,
// e.g. "assets/img/photo.jpg".  The path is relative to the deck folder.
func LocalizeReader(root, deckName string, r io.Reader, originalName, mimeType string) (string, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return "", fmt.Errorf("assets: read: %w", err)
	}
	return LocalizeBytes(root, deckName, data, originalName, mimeType)
}

// LocalizeBytes localizes data into the deck's assets with a given filename and
// MIME type.  This is the core localisation function used by both the upload
// endpoint and the image provider Fetch implementations.
func LocalizeBytes(root, deckName string, data []byte, originalName, mimeType string) (string, error) {
	subdir := subdirFor(mimeType)
	safe := SafeFilename(originalName)

	// Construct and create the destination directory.
	destDir := filepath.Join(root, "decks", deckName, "assets", subdir)
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return "", fmt.Errorf("assets: mkdir %s: %w", destDir, err)
	}

	finalName, err := dedupeWrite(destDir, safe, data)
	if err != nil {
		return "", err
	}

	// Return path relative to the deck folder so it works as an HTML src.
	return "assets/" + subdir + "/" + finalName, nil
}

// SharedEntry describes a single file in the workspace shared/ directory.
type SharedEntry struct {
	Name string `json:"name"`
	// RelSrc is the path relative to the workspace root, e.g. "shared/logo.png".
	RelSrc   string `json:"rel_src"`
	MimeType string `json:"mime_type"`
	Size     int64  `json:"size"`
}

// ListShared returns all regular files in root/shared/ (non-recursive).
// Vendor sub-directories (shared/vendor/) are skipped as they are internal.
func ListShared(root string) ([]SharedEntry, error) {
	dir := filepath.Join(root, "shared")
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []SharedEntry{}, nil
		}
		return nil, fmt.Errorf("shared: readdir: %w", err)
	}

	var result []SharedEntry
	for _, e := range entries {
		// Skip the internal vendor reference copy.
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		name := e.Name()
		mt := mimeFromName(name)
		result = append(result, SharedEntry{
			Name:     name,
			RelSrc:   "shared/" + name,
			MimeType: mt,
			Size:     info.Size(),
		})
	}
	return result, nil
}

// CopyFromShared copies a file from root/shared/<filename> into the deck's
// assets/ directory and returns the relative src.  Never creates a cross-deck
// reference (spec 08).
func CopyFromShared(root, deckName, filename string) (string, error) {
	// Sanitise filename to prevent traversal within shared/.
	safe := SafeFilename(filename)
	if safe != filename {
		// The caller sent an un-sanitised name; be strict.
		return "", fmt.Errorf("shared copy: invalid filename %q", filename)
	}

	src := filepath.Join(root, "shared", safe)
	data, err := os.ReadFile(src)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("shared copy: file not found: %s", safe)
		}
		return "", fmt.Errorf("shared copy: read: %w", err)
	}

	mt := mimeFromName(safe)
	return LocalizeBytes(root, deckName, data, safe, mt)
}

// mimeFromName returns a best-guess MIME type from the file extension.
// It covers the asset types used in presentations; unknown types default to
// "application/octet-stream".
func mimeFromName(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".avif":
		return "image/avif"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mov":
		return "video/quicktime"
	case ".avi":
		return "video/avi"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".ogg":
		return "audio/ogg"
	case ".pdf":
		return "application/pdf"
	default:
		return "application/octet-stream"
	}
}
