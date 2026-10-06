package engine

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gotd/td/telegram/message"
	"github.com/gotd/td/tg"
)

// CheckSpamBot sends /start to @SpamBot and reads the reply.
// Returns (free, replyText, error).
func CheckSpamBot(ctx context.Context, api *tg.Client) (bool, string, error) {
	res, err := api.ContactsResolveUsername(ctx, &tg.ContactsResolveUsernameRequest{Username: "SpamBot"})
	if err != nil {
		return false, "", fmt.Errorf("resolve SpamBot: %w", err)
	}
	var bot *tg.User
	for _, u := range res.Users {
		if v, ok := u.(*tg.User); ok {
			bot = v
		}
	}
	if bot == nil {
		return false, "", fmt.Errorf("SpamBot not found")
	}
	peer := &tg.InputPeerUser{UserID: bot.ID, AccessHash: bot.AccessHash}
	if _, err := message.NewSender(api).To(peer).Text(ctx, "/start"); err != nil {
		return false, "", fmt.Errorf("send /start: %w", err)
	}
	time.Sleep(4 * time.Second)
	h, err := api.MessagesGetHistory(ctx, &tg.MessagesGetHistoryRequest{Peer: peer, Limit: 2})
	if err != nil {
		return false, "", err
	}
	var msgs []tg.MessageClass
	switch v := h.(type) {
	case *tg.MessagesMessages:
		msgs = v.Messages
	case *tg.MessagesMessagesSlice:
		msgs = v.Messages
	}
	for _, m := range msgs {
		if mm, ok := m.(*tg.Message); ok && !mm.Out {
			t := strings.ToLower(mm.Message)
			free := strings.Contains(t, "good news") || strings.Contains(t, "no limits") ||
				strings.Contains(t, "free as a bird") || strings.Contains(t, "your account is free")
			return free, mm.Message, nil
		}
	}
	return false, "", fmt.Errorf("no reply from SpamBot")
}
