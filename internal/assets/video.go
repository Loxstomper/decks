// video.go – optional ffmpeg transcoding for the asset pipeline.
//
// Video is treated as a regular asset (stored under assets/video/).  When the
// uploaded format may not play in all browsers (e.g. .mov, .avi), ffmpeg can
// re-encode it to H.264/MP4 for maximum compatibility.
//
// ffmpeg is an OPTIONAL dependency (spec 14 / spec 08 – graceful degradation):
//   - If ffmpeg is on PATH and the input is a non-web-native format, Transcode
//     re-encodes to .mp4.
//   - If ffmpeg is absent, or the input is already web-native (mp4/webm), the
//     file is stored as-is.  Callers should check HasFFmpeg() to surface the
//     capability flag to the UI.
package assets

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// webNativeVideoExt lists MIME types that modern browsers handle natively,
// so transcoding is unnecessary even when ffmpeg is present.
var webNativeVideoExt = map[string]bool{
	".mp4":  true,
	".webm": true,
	".ogv":  true,
}

// HasFFmpeg reports whether the ffmpeg binary is on the system PATH.
// Used to surface the transcode capability to the frontend (spec 14).
func HasFFmpeg() bool {
	_, err := exec.LookPath("ffmpeg")
	return err == nil
}

// TranscodeToMP4 re-encodes inputPath to H.264/MP4 using ffmpeg and writes
// the result to outputPath.  It uses libx264 with the "fast" preset and AAC
// audio to maximise browser compatibility while keeping encoding time low.
//
// Returns an error if ffmpeg is absent or transcoding fails.  The caller
// should remove outputPath on error.
func TranscodeToMP4(inputPath, outputPath string) error {
	if !HasFFmpeg() {
		return fmt.Errorf("transcode: ffmpeg not found on PATH")
	}

	// -y           overwrite output without prompt (we never call this on an
	//              existing file, but be safe against temp-file collisions)
	// -i <input>   input file
	// -c:v libx264 H.264 video codec
	// -preset fast trade-off: reasonable speed + quality
	// -crf 23      constant rate factor (18=high quality, 28=low; 23 is default)
	// -c:a aac     AAC audio
	// -movflags +faststart  move MOOV atom to front for HTTP progressive play
	cmd := exec.Command("ffmpeg",
		"-y",
		"-i", inputPath,
		"-c:v", "libx264",
		"-preset", "fast",
		"-crf", "23",
		"-c:a", "aac",
		"-movflags", "+faststart",
		outputPath,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("transcode: ffmpeg: %w\n%s", err, out)
	}
	return nil
}

// LocalizeVideo handles video asset upload with optional transcoding.
//
// It first localizes the uploaded bytes as-is (for atomicity), then — if
// ffmpeg is available and the format is not already web-native — transcodes
// to MP4, replaces the stored file, and returns the .mp4 relative src.
//
// Returns (relSrc, transcoded, error):
//   - relSrc is the relative src of the final stored file.
//   - transcoded is true when ffmpeg re-encoded the file.
func LocalizeVideo(root, deckName string, data []byte, originalName string) (relSrc string, transcoded bool, err error) {
	// Store the original first, so we have a concrete path to transcode from.
	relSrc, err = LocalizeBytes(root, deckName, data, originalName, "video/mp4")
	if err != nil {
		return "", false, err
	}

	ext := strings.ToLower(filepath.Ext(originalName))
	if webNativeVideoExt[ext] || !HasFFmpeg() {
		// Already web-compatible or no ffmpeg: serve as-is.
		return relSrc, false, nil
	}

	// Build absolute paths for ffmpeg.
	srcPath := filepath.Join(root, "decks", deckName, relSrc)
	stem := strings.TrimSuffix(filepath.Base(relSrc), filepath.Ext(relSrc))
	mp4Name := stem + ".mp4"
	mp4Dir := filepath.Join(root, "decks", deckName, "assets", "video")
	mp4Path := filepath.Join(mp4Dir, mp4Name)

	if err := TranscodeToMP4(srcPath, mp4Path); err != nil {
		// Transcode failed: log and fall back to the original file.
		// We do NOT return an error here — graceful degradation (spec 14).
		_ = err // caller gets relSrc of original, transcoded=false
		return relSrc, false, nil
	}

	// Remove the un-transcoded original now that MP4 is written.
	if srcPath != mp4Path {
		_ = os.Remove(srcPath)
	}

	mp4Rel := "assets/video/" + mp4Name
	return mp4Rel, true, nil
}
