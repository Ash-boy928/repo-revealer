package engine

import (
	"encoding/json"
	"os"
	"sync"
	"time"
)

// Store persists already-messaged / permanently-skipped user IDs so a user is
// never DMed twice across runs (file-backed JSON, tiny RAM footprint).
type Store struct {
	path string
	mu   sync.Mutex
	Done map[int64]Entry `json:"done"`
}

type Entry struct {
	Status string `json:"s"` // "sent" or skip reason
	At     int64  `json:"t"`
}

func OpenStore(path string) *Store {
	s := &Store{path: path, Done: map[int64]Entry{}}
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, s)
		if s.Done == nil {
			s.Done = map[int64]Entry{}
		}
	}
	return s
}

func (s *Store) Has(id int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.Done[id]
	return ok
}

func (s *Store) Mark(id int64, status string) {
	s.mu.Lock()
	s.Done[id] = Entry{Status: status, At: time.Now().Unix()}
	b, _ := json.Marshal(s)
	s.mu.Unlock()
	tmp := s.path + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, s.path)
	}
}
