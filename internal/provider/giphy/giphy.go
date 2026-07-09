// Package giphy implements the Giphy GIF provider (spec assets-and-media / P5-8).
//
// The Giphy API key is read from the GIPHY_API_KEY environment variable.
// If absent, Enabled() returns false and the provider is omitted from the
// /api/providers listing (graceful degradation, spec principles-and-invariants).
//
// All fetched GIFs are localized into the deck's assets/img/ directory as
// .gif files so they are available offline after the initial download.
//
// API reference: https://developers.giphy.com/docs/api/
package giphy

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"

	"slides-builder/internal/assets"
	"slides-builder/internal/provider"
)

const (
	apiBase     = "https://api.giphy.com/v1/gifs"
	perPage     = 20
	httpTimeout = 15 * time.Second
	// rating parameter – "g" keeps results safe for general audiences.
	rating = "g"
)

// Provider implements provider.Provider for Giphy.
type Provider struct {
	apiKey string
	client *http.Client
}

// New creates a Giphy provider.  The API key is read from GIPHY_API_KEY.
func New() *Provider {
	return &Provider{
		apiKey: os.Getenv("GIPHY_API_KEY"),
		client: &http.Client{Timeout: httpTimeout},
	}
}

// NewWithKey creates a provider with an explicit key (used in tests).
func NewWithKey(key string) *Provider {
	return &Provider{
		apiKey: key,
		client: &http.Client{Timeout: httpTimeout},
	}
}

func (p *Provider) Name() string  { return "giphy" }
func (p *Provider) Label() string { return "Giphy" }
func (p *Provider) Enabled() bool { return p.apiKey != "" }

// Search queries the Giphy /gifs/search endpoint.
func (p *Provider) Search(query string, page int) ([]provider.Result, int, error) {
	if !p.Enabled() {
		return nil, 0, provider.ErrDisabled(p.Name())
	}
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * perPage

	u := fmt.Sprintf("%s/search?api_key=%s&q=%s&limit=%d&offset=%d&rating=%s",
		apiBase,
		p.apiKey,
		url.QueryEscape(query),
		perPage,
		offset,
		rating,
	)

	resp, err := p.client.Get(u)
	if err != nil {
		return nil, 0, fmt.Errorf("giphy search: http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, 0, fmt.Errorf("giphy search: status %d: %s", resp.StatusCode, body)
	}

	var apiResp struct {
		Data []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
			Images struct {
				FixedHeight struct {
					URL    string `json:"url"`
					Width  string `json:"width"`
					Height string `json:"height"`
				} `json:"fixed_height"`
				Original struct {
					Width  string `json:"width"`
					Height string `json:"height"`
					URL    string `json:"url"`
				} `json:"original"`
			} `json:"images"`
		} `json:"data"`
		Pagination struct {
			TotalCount int `json:"total_count"`
			Count      int `json:"count"`
			Offset     int `json:"offset"`
		} `json:"pagination"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return nil, 0, fmt.Errorf("giphy search: decode: %w", err)
	}

	total := apiResp.Pagination.TotalCount
	totalPages := (total + perPage - 1) / perPage
	if totalPages < 1 && total > 0 {
		totalPages = 1
	}

	results := make([]provider.Result, 0, len(apiResp.Data))
	for _, d := range apiResp.Data {
		results = append(results, provider.Result{
			ID:          d.ID,
			ThumbURL:    d.Images.FixedHeight.URL,
			Description: d.Title,
		})
	}
	return results, totalPages, nil
}

// Fetch downloads the GIF with the given ID at original quality, localizes
// it into the deck's assets/img/ directory, and returns a relative src.
func (p *Provider) Fetch(id, root, deckName string) (string, error) {
	if !p.Enabled() {
		return "", provider.ErrDisabled(p.Name())
	}

	// Look up the GIF to get the original URL.
	u := fmt.Sprintf("%s/%s?api_key=%s", apiBase, url.PathEscape(id), p.apiKey)
	resp, err := p.client.Get(u)
	if err != nil {
		return "", fmt.Errorf("giphy fetch: lookup: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("giphy fetch: lookup status %d: %s", resp.StatusCode, body)
	}

	var gifMeta struct {
		Data struct {
			ID    string `json:"id"`
			Title string `json:"title"`
			Images struct {
				Original struct {
					URL string `json:"url"`
				} `json:"original"`
			} `json:"images"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&gifMeta); err != nil {
		return "", fmt.Errorf("giphy fetch: decode: %w", err)
	}

	gifURL := gifMeta.Data.Images.Original.URL
	if gifURL == "" {
		return "", fmt.Errorf("giphy fetch: no original URL for gif %s", id)
	}

	// Download the GIF.
	imgResp, err := p.client.Get(gifURL)
	if err != nil {
		return "", fmt.Errorf("giphy fetch: download: %w", err)
	}
	defer imgResp.Body.Close()

	if imgResp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("giphy fetch: download status %d", imgResp.StatusCode)
	}

	filename := id + ".gif"
	// Localize into deck assets (spec assets-and-media – offline after fetch).
	return assets.LocalizeReader(root, deckName, imgResp.Body, filename, "image/gif")
}
