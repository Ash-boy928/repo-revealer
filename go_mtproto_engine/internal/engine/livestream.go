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
	return scrapeChannel(ctx, api, ch, max, selfID)
}

// AutoDetectLiveStream scans the account's joined channels/groups and returns
// participants of the first one with an active live stream / voice chat.
func AutoDetectLiveStream(ctx context.Context, api *tg.Client, max int, selfID int64) (string, []Participant, error) {
	res, err := api.MessagesGetDialogs(ctx, &tg.MessagesGetDialogsRequest{
		OffsetPeer: &tg.InputPeerEmpty{}, Limit: 100,
	})
	if err != nil {
		return "", nil, fmt.Errorf("get dialogs: %w", err)
	}
	var chats []tg.ChatClass
	switch d := res.(type) {
	case *tg.MessagesDialogs:
		chats = d.Chats
	case *tg.MessagesDialogsSlice:
		chats = d.Chats
	}
	for _, c := range chats {
		ch, ok := c.(*tg.Channel)
		if !ok || !ch.CallActive {
			continue
		}
		users, err := scrapeChannel(ctx, api, ch, max, selfID)
		if err != nil && len(users) == 0 {
			continue
		}
		name := ch.Username
		if name == "" {
			name = ch.Title
		}
		return name, users, nil
	}
	return "", nil, fmt.Errorf("no active live stream found in joined channels/groups")
}

func scrapeChannel(ctx context.Context, api *tg.Client, ch *tg.Channel, max int, selfID int64) ([]Participant, error) {
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
		return nil, fmt.Errorf("no active live stream / voice chat in %s", ch.Title)
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
