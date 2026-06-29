// Package watch wraps fsnotify to monitor deck folders and broadcast
// change events to registered SSE subscribers.
package watch

import (
	"log"
	"path/filepath"
	"sync"

	"github.com/fsnotify/fsnotify"
)

// Event is a filesystem change event with the deck name and event type.
type Event struct {
	Deck string `json:"deck"`
	Type string `json:"type"`
}

// Watcher watches deck folders and broadcasts Events to subscribers.
type Watcher struct {
	fw          *fsnotify.Watcher
	mu          sync.Mutex
	subscribers map[chan Event]struct{}
}

// New creates and starts a Watcher.
func New() (*Watcher, error) {
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	w := &Watcher{
		fw:          fw,
		subscribers: make(map[chan Event]struct{}),
	}
	go w.loop()
	return w, nil
}

// Watch adds a deck folder to the watch set.
// deckName is the name used in broadcast Events; path is the directory path.
func (w *Watcher) Watch(deckName, path string) error {
	if err := w.fw.Add(path); err != nil {
		return err
	}
	log.Printf("watch: watching deck %q at %s", deckName, path)
	return nil
}

// Subscribe returns a channel that receives Events.  The caller must call
// Unsubscribe when done (e.g. on client disconnect).
func (w *Watcher) Subscribe() chan Event {
	ch := make(chan Event, 16)
	w.mu.Lock()
	w.subscribers[ch] = struct{}{}
	w.mu.Unlock()
	return ch
}

// Unsubscribe removes and closes the subscriber channel.
func (w *Watcher) Unsubscribe(ch chan Event) {
	w.mu.Lock()
	delete(w.subscribers, ch)
	w.mu.Unlock()
	close(ch)
}

// Close shuts down the underlying fsnotify watcher.
func (w *Watcher) Close() error {
	return w.fw.Close()
}

// loop processes fsnotify events and errors in the background.
func (w *Watcher) loop() {
	for {
		select {
		case ev, ok := <-w.fw.Events:
			if !ok {
				return
			}
			if ev.Has(fsnotify.Write) || ev.Has(fsnotify.Create) || ev.Has(fsnotify.Rename) {
				// The deck name is the base name of the parent directory of the
				// changed file (fsnotify watches the deck directory, not the file).
				deckName := filepath.Base(filepath.Dir(ev.Name))
				log.Printf("watch: change in deck %q file=%s op=%s", deckName, ev.Name, ev.Op)
				w.broadcast(Event{Deck: deckName, Type: "changed"})
			}
		case err, ok := <-w.fw.Errors:
			if !ok {
				return
			}
			log.Printf("watch: fsnotify error: %v", err)
		}
	}
}

// broadcast sends an event to all current subscribers.
func (w *Watcher) broadcast(ev Event) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for ch := range w.subscribers {
		select {
		case ch <- ev:
		default:
			// Subscriber is not consuming events; drop to avoid blocking.
			log.Printf("watch: dropping event for slow subscriber")
		}
	}
}
