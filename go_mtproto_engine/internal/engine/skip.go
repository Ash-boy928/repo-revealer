package engine

import "github.com/gotd/td/tgerr"

// SkipReason returns a non-empty reason when a DM error means "this user
// can't receive DMs" (privacy etc.) — skip the user and continue the campaign.
func SkipReason(err error) string {
	for _, c := range []string{
		"USER_PRIVACY_RESTRICTED", "PRIVACY_PREMIUM_REQUIRED", "PRIVACY_PREMIUM_NORMAL",
		"USER_IS_BLOCKED", "YOU_BLOCKED_USER", "USER_IS_BOT", "INPUT_USER_DEACTIVATED",
		"USER_DEACTIVATED", "PEER_ID_INVALID", "CHAT_WRITE_FORBIDDEN", "USER_BANNED_IN_CHANNEL",
	} {
		if tgerr.Is(err, c) {
			return c
		}
	}
	return ""
}
