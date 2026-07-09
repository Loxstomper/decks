// Package unsplash implements the Unsplash image provider (spec assets-and-media / P5-7).
//
// The Unsplash API key is read from the UNSPLASH_ACCESS_KEY environment
// variable.  If the variable is absent, Enabled() returns false and the
// provider is omitted from the /api/providers listing.  All fetched images
// are localized into the deck's assets/img/ directory so they are available
// offline after the initial download (spec assets-and-media / spec principles-and-invariants).
//
// API reference: https://unsplash.com/documentation
package unsplash

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"slides-builder/internal/assets"
	"slides-builder/internal/provider"
)

const (
	apiBase    = "https://api.unsplash.com"
	perPage    = 20 // results per search page
	httpTimeout = 15 * time.Second
)

// Provider implements provider.Provider for Unsplash.
type Provider struct {
	// accessKey is read from env at construction time so tests can inject
	// a key without mutating global env during the test.
	accessKey string
	client    *http.Client
}

// New creates an Unsplash provider.  The access key is read from the
// UNSPLASH_ACCESS_KEY environment variable; when absent Enabled() is false.
func New() *Provider {
	return &Provider{
		accessKey: os.Getenv("UNSPLASH_ACCESS_KEY"),
		client:    &http.Client{Timeout: httpTimeout},
	}
}

// NewWithKey creates a provider with an explicit key (used in tests).
func NewWithKey(key string) *Provider {
	return &Provider{
		accessKey: key,
		client:    &http.Client{Timeout: httpTimeout},
	}
}

func (p *Provider) Name() string  { return "unsplash" }
func (p *Provider) Label() string { return "Unsplash" }
func (p *Provider) Enabled() bool { return p.accessKey != "" }

// Search queries the Unsplash /search/photos endpoint and returns up to
// perPage results for the given query and 1-based page number.
func (p *Provider) Search(query string, page int) ([]provider.Result, int, error) {
	if !p.Enabled() {
		return nil, 0, provider.ErrDisabled(p.Name())
	}
	if page < 1 {
		page = 1
	}

	u := fmt.Sprintf("%s/search/photos?query=%s&page=%d&per_page=%d",
		apiBase,
		url.QueryEscape(query),
		page,
		perPage,
	)

	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return nil, 0, fmt.Errorf("unsplash search: build request: %w", err)
	}
	// Unsplash requires the Authorization header with the client ID.
	req.Header.Set("Authorization", "Client-ID "+p.accessKey)
	req.Header.Set("Accept-Version", "v1")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("unsplash search: http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, 0, fmt.Errorf("unsplash search: status %d: %s", resp.StatusCode, body)
	}

	var apiResp struct {
		TotalPages int `json:"total_pages"`
		Results    []struct {
			ID          string `json:"id"`
			Description string `json:"description"`
			AltDesc     string `json:"alt_description"`
			Width       int    `json:"width"`
			Height      int    `json:"height"`
			URLs        struct {
				Thumb   string `json:"thumb"`
				Regular string `json:"regular"`
				Full    string `json:"full"`
			} `json:"urls"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return nil, 0, fmt.Errorf("unsplash search: decode: %w", err)
	}

	results := make([]provider.Result, 0, len(apiResp.Results))
	for _, r := range apiResp.Results {
		desc := r.Description
		if desc == "" {
			desc = r.AltDesc
		}
		results = append(results, provider.Result{
			ID:          r.ID,
			ThumbURL:    r.URLs.Thumb,
			Description: desc,
			Width:       r.Width,
			Height:      r.Height,
		})
	}
	return results, apiResp.TotalPages, nil
}

// Fetch downloads the Unsplash photo with the given ID at "regular" size,
// localizes it into the deck's assets/img/ directory, and triggers the
// required Unsplash download tracking endpoint (API guideline).
//
// The returned relSrc is relative to the deck folder, e.g. "assets/img/abc.jpg".
func (p *Provider) Fetch(id, root, deckName string) (string, error) {
	if !p.Enabled() {
		return "", provider.ErrDisabled(p.Name())
	}

	// 1. Look up the photo to get the download URL + trigger tracking endpoint.
	u := fmt.Sprintf("%s/photos/%s", apiBase, url.PathEscape(id))
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return "", fmt.Errorf("unsplash fetch: lookup request: %w", err)
	}
	req.Header.Set("Authorization", "Client-ID "+p.accessKey)
	req.Header.Set("Accept-Version", "v1")

	resp, err := p.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("unsplash fetch: lookup: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("unsplash fetch: lookup status %d: %s", resp.StatusCode, body)
	}

	var photo struct {
		Slug  string `json:"slug"`
		Width int    `json:"width"`
		URLs  struct {
			Regular  string `json:"regular"`
			Download string `json:"download"` // tracking URL (must be hit per API guidelines)
		} `json:"urls"`
		Links struct {
			DownloadLocation string `json:"download_location"`
		} `json:"links"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&photo); err != nil {
		return "", fmt.Errorf("unsplash fetch: decode photo: %w", err)
	}

	// 2. Trigger the required download tracking call (Unsplash API guidelines).
	if photo.Links.DownloadLocation != "" {
		dlReq, _ := http.NewRequest("GET", photo.Links.DownloadLocation, nil)
		dlReq.Header.Set("Authorization", "Client-ID "+p.accessKey)
		dlReq.Header.Set("Accept-Version", "v1")
		dlResp, err := p.client.Do(dlReq)
		if err == nil {
			io.Copy(io.Discard, dlResp.Body)
			dlResp.Body.Close()
		}
		// Non-fatal if the tracking call fails.
	}

	// 3. Download the image at "regular" quality (1080px wide, good for slides).
	imgURL := photo.URLs.Regular
	if imgURL == "" {
		return "", fmt.Errorf("unsplash fetch: no regular URL for photo %s", id)
	}

	imgResp, err := p.client.Get(imgURL)
	if err != nil {
		return "", fmt.Errorf("unsplash fetch: download image: %w", err)
	}
	defer imgResp.Body.Close()

	if imgResp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unsplash fetch: image status %d", imgResp.StatusCode)
	}

	// Derive a filename from the photo slug + image width for uniqueness.
	slug := photo.Slug
	if slug == "" {
		slug = id
	}
	filename := safeSlug(slug) + "_" + strconv.Itoa(photo.Width) + ".jpg"

	// 4. Localize: copy into deck assets (spec assets-and-media – decks self-contained).
	return assets.LocalizeReader(root, deckName, imgResp.Body, filename, "image/jpeg")
}

// safeSlug converts an Unsplash slug to a safe filename stem.
func safeSlug(slug string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
			return r
		case r >= 'A' && r <= 'Z':
			return r + 32 // to lower
		default:
			return '_'
		}
	}, slug)
}
