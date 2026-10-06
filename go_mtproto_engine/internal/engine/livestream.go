package engine

import (
	"context"
	"fmt"
	"strings"

	"github.com/gotd/td/tg"
)

// Participant is a live-stream listener with the access hash needed to DM.
type Participant struct {
	ID         int64
	AccessHash int64
	Username   string
	FirstName  string
	Bot        bool
}

func (p Participant) Peer() *tg.InputPeerUser {
	return &tg.InputPeerUser{UserID: p.ID, AccessHash: p.AccessHash}
}

// ScrapeLiveStream resolves a channel/group, finds its active voice chat /
// live stream and returns its participants (paginated).
func ScrapeLiveStream(ctx context.Context, api *tg.Client, target string, max int, selfID int64) ([]Participant, error) {
	target = strings.TrimPrefix(strings.TrimPrefix(strings.TrimPrefix(target, "https://t.me/"), "t.me/"), "@")
	res, err := api.ContactsResolveUsername(ctx, &tg.ContactsResolveUsernameRequest{Username: target})
	if err != nil {
		return nil, fmt.Errorf("resolve %s: %w", target, err)
	}
	var ch *tg.Channel
	for _, c := range res.Chats {
		if v, ok := c.(*tg.Channel); ok {
			ch = v
		}
	}
	if ch == nil {
		return nil, fmt.Errorf("%s is not a channel/supergroup", target)
	}
	full, err := api.ChannelsGetFullChannel(ctx, &tg.InputChannel{ChannelID: ch.ID, AccessHash: ch.AccessHash})
	if err != nil {
		return nil, fmt.Errorf("get full channel: %w", err)
	}
	cf, ok := full.FullChat.(*tg.ChannelFull)
	if !ok {
		return nil, fmt.Errorf("unexpected full chat type")
	}
	call, ok := cf.GetCall()
	if !ok || call == nil {
		return nil, fmt.Errorf("no active live stream / voice chat in %s", target)
	}

	seen := map[int64]bool{}
	var out []Participant
	offset := ""
	for len(out) < max {
		pr, err := api.PhoneGetGroupParticipants(ctx, &tg.PhoneGetGroupParticipantsRequest{
			Call: call, IDs: []tg.InputPeerClass{}, Sources: []int{}, Offset: offset, Limit: 100,
		})
		if err != nil {
			return out, fmt.Errorf("get participants: %w", err)
		}
		added := 0
		for _, u := range pr.Users {
			usr, ok := u.(*tg.User)
			if !ok || seen[usr.ID] || usr.ID == selfID || usr.Bot || usr.Deleted || usr.AccessHash == 0 {
				continue
			}
			seen[usr.ID] = true
			out = append(out, Participant{ID: usr.ID, AccessHash: usr.AccessHash, Username: usr.Username, FirstName: usr.FirstName})
			added++
			if len(out) >= max {
				break
			}
		}
		if pr.NextOffset == "" || pr.NextOffset == offset || added == 0 {
			break
		}
		offset = pr.NextOffset
	}
	return out, nil
}
