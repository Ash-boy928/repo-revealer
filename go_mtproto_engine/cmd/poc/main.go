// Phase 1 POC: one account, GramJS session, optional proxy, health check,
// one safe test DM, RAM report. Isolated — does not touch the live Node bot.
package main

import (
	"bufio"
	"context"
	"errors"
	"strings"

	"flag"
	"fmt"
	"github.com/gotd/td/telegram/auth"
	"github.com/gotd/td/tg"
	"log"
	"math/rand"
	"net"
	"net/url"
	"os"
	"runtime"
	"time"

	"github.com/gotd/td/session"
	"github.com/gotd/td/telegram"
	"github.com/gotd/td/telegram/dcs"
	"github.com/gotd/td/telegram/message"
	"github.com/gotd/td/tgerr"
	"golang.org/x/net/proxy"

	"leotelebot/go_mtproto_engine/internal/engine"
	"leotelebot/go_mtproto_engine/internal/gramjs"
)

func mem(tag string) {
	var m runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&m)
	log.Printf("[RAM %s] heap=%.2fMB sys=%.2fMB goroutines=%d",
		tag, float64(m.HeapAlloc)/1e6, float64(m.Sys)/1e6, runtime.NumGoroutine())
}

func dialer(proxyURL string) (dcs.DialFunc, error) {
	if proxyURL == "" {
		d := &net.Dialer{Timeout: 15 * time.Second}
		return d.DialContext, nil
	}
	u, err := url.Parse(proxyURL) // socks5://user:pass@host:port
	if err != nil {
		return nil, err
	}
	p, err := proxy.FromURL(u, proxy.Direct)
	if err != nil {
		return nil, err
	}
	cd, ok := p.(proxy.ContextDialer)
	if !ok {
		return nil, fmt.Errorf("proxy does not support context dialing")
	}
	return cd.DialContext, nil
}

// termAuth asks phone/OTP/2FA in the terminal.
type termAuth struct {
	phone string
	in    *bufio.Reader
}

func (a termAuth) ask(q string) string {
	fmt.Print(q)
	t, _ := a.in.ReadString('\n')
	return strings.TrimSpace(t)
}
func (a termAuth) Phone(_ context.Context) (string, error) { return a.phone, nil }
func (a termAuth) Password(_ context.Context) (string, error) {
	return a.ask("2FA password: "), nil
}
func (a termAuth) Code(_ context.Context, _ *tg.AuthSentCode) (string, error) {
	return a.ask("OTP code (Telegram app/SMS): "), nil
}
func (a termAuth) AcceptTermsOfService(_ context.Context, tos tg.HelpTermsOfService) error {
	return errors.New("number not registered on Telegram; sign up in official app first")
}
func (a termAuth) SignUp(_ context.Context) (auth.UserInfo, error) {
	return auth.UserInfo{}, errors.New("sign up not supported")
}

func main() {
	apiID := flag.Int("api-id", 0, "Telegram api_id")
	apiHash := flag.String("api-hash", "", "Telegram api_hash")
	sess := flag.String("session", os.Getenv("TG_SESSION"), "GramJS StringSession (or env TG_SESSION)")
	proxyURL := flag.String("proxy", "", "socks5://user:pass@host:port (optional)")
	to := flag.String("to", "", "test DM recipient username (optional, without @)")
	text := flag.String("text", "Hello from Go engine POC", "test DM text")
	phone := flag.String("phone", "", "login with phone + OTP (e.g. +919999999999) instead of -session")
	sessFile := flag.String("session-file", "go_session.json", "where OTP-login session is saved/reused")
	idle := flag.Duration("idle", 30*time.Second, "stay connected for idle RAM measurement")
	stream := flag.String("stream", "", "channel/group username or t.me link with active live stream")
	limit := flag.Int("limit", 5, "max participants to DM from the live stream")
	tpl := flag.String("spintax", "{Hi|Hello|Namaste} {name}, {kaise ho|kya haal hai}?", "DM template: {a|b} spin, {name}, {username}")
	minDelay := flag.Duration("min-delay", 20*time.Second, "min delay between DMs")
	maxDelay := flag.Duration("max-delay", 45*time.Second, "max delay between DMs")
	dryRun := flag.Bool("dry-run", false, "only list stream participants, send nothing")
	spamCheck := flag.Bool("spamcheck", false, "check @SpamBot status before running")
	storeFile := flag.String("store", "dm_history.json", "remembers DMed/skipped users so nobody gets a 2nd DM")
	wait := flag.Duration("wait", 0, "with -stream auto: keep re-scanning this long until a live stream starts (e.g. 30m)")
	runFor := flag.Duration("timeout", 2*time.Hour, "max total run time")
	flag.Parse()
	if *maxDelay < *minDelay {
		*maxDelay = *minDelay
	}

	if *apiID == 0 || *apiHash == "" {
		log.Fatal("required: -api-id, -api-hash")
	}
	mem("start")

	var storage session.Storage
	dc := 2
	if *sess != "" {
		gs, err := gramjs.Decode(*sess)
		if err != nil {
			log.Fatalf("session decode: %v", err)
		}
		log.Printf("session: DC%d %s", gs.DC, gs.Addr)
		ms := &session.StorageMemory{}
		if err := (&session.Loader{Storage: ms}).Save(context.Background(), &session.Data{
			DC: gs.DC, Addr: gs.Addr, AuthKey: gs.AuthKey, AuthKeyID: gs.AuthKeyID,
		}); err != nil {
			log.Fatal(err)
		}
		storage, dc = ms, gs.DC
	} else {
		log.Printf("using session file %s (OTP login if not logged in)", *sessFile)
		storage = &session.FileStorage{Path: *sessFile}
	}

	dial, err := dialer(*proxyURL)
	if err != nil {
		log.Fatalf("proxy: %v", err)
	}

	client := telegram.NewClient(*apiID, *apiHash, telegram.Options{
		SessionStorage: storage,
		DC:             dc,
		Resolver:       dcs.Plain(dcs.PlainOptions{Dial: dial}),
		NoUpdates:      true, // POC: no update stream = lower RAM
	})

	ctx, cancel := context.WithTimeout(context.Background(), *runFor)
	defer cancel()

	err = client.Run(ctx, func(ctx context.Context) error {
		if *sess == "" {
			st, err := client.Auth().Status(ctx)
			if err != nil {
				return err
			}
			if !st.Authorized {
				if *phone == "" {
					return errors.New("not logged in: pass -phone +91XXXXXXXXXX for OTP login")
				}
				flow := auth.NewFlow(termAuth{phone: *phone, in: bufio.NewReader(os.Stdin)}, auth.SendCodeOptions{})
				if err := client.Auth().IfNecessary(ctx, flow); err != nil {
					return fmt.Errorf("login: %w", err)
				}
				log.Printf("login OK, session saved to %s", *sessFile)
			}
		}
		self, err := client.Self(ctx)
		if err != nil {
			return fmt.Errorf("health check (session invalid/expired?): %w", err)
		}
		log.Printf("connected as id=%d @%s %s", self.ID, self.Username, self.FirstName)
		mem("connected")

		if *spamCheck {
			free, reply, err := engine.CheckSpamBot(ctx, client.API())
			if err != nil {
				log.Printf("SpamBot check failed: %v", err)
			} else {
				log.Printf("SpamBot free=%v reply=%q", free, reply)
				if !free && *stream != "" {
					return errors.New("account limited by SpamBot; campaign aborted to protect the ID")
				}
			}
		}

		if *stream != "" {
			var users []engine.Participant
			if *stream == "auto" {
				log.Print("auto-detecting live stream in joined channels/groups...")
				deadline := time.Now().Add(*wait)
				var name string
				var u []engine.Participant
				for {
					name, u, err = engine.AutoDetectLiveStream(ctx, client.API(), *limit*3, self.ID)
					if err == nil || time.Now().After(deadline) {
						break
					}
					log.Printf("no live stream yet, re-scan in 60s (%v)", err)
					time.Sleep(60 * time.Second)
				}
				if err != nil {
					return err
				}
				log.Printf("live stream detected: %s", name)
				users = u
			} else {
				u, err := engine.ScrapeLiveStream(ctx, client.API(), *stream, *limit*3, self.ID)
				if err != nil && len(u) == 0 {
					return err
				}
				users = u
			}
			store := engine.OpenStore(*storeFile)
			fresh := users[:0]
			for _, u := range users {
				if !store.Has(u.ID) && len(fresh) < *limit {
					fresh = append(fresh, u)
				}
			}
			log.Printf("history: %d already DMed/skipped users filtered out", len(users)-len(fresh))
			users = fresh
			log.Printf("live stream %s: %d DM-able participants", *stream, len(users))
			for i, u := range users {
				log.Printf("  #%d id=%d @%s %s", i+1, u.ID, u.Username, u.FirstName)
			}
			if *dryRun {
				log.Print("dry-run: no DMs sent")
				return nil
			}
			sender := message.NewSender(client.API())
			sent, skipped := 0, 0
			for i, u := range users {
				txt := engine.Spin(*tpl, u.FirstName, u.Username)
				_, err := sender.To(u.Peer()).Text(ctx, txt)
				if d, ok := tgerr.AsFloodWait(err); ok {
					log.Printf("FLOOD_WAIT %s — stopping campaign", d)
					break
				}
				if tgerr.Is(err, "PEER_FLOOD") {
					log.Print("PEER_FLOOD — account limited, stopping campaign")
					break
				}
				if r := engine.SkipReason(err); r != "" {
					skipped++
					store.Mark(u.ID, r)
					log.Printf("  [SKIP] id=%d @%s: %s — next user, no delay", u.ID, u.Username, r)
					continue
				}
				if err != nil {
					skipped++
					log.Printf("  skip id=%d: %v", u.ID, err)
				} else {
					sent++
					store.Mark(u.ID, "sent")
					log.Printf("  DM %d/%d sent to id=%d @%s: %q", sent, len(users), u.ID, u.Username, txt)
				}
				if i < len(users)-1 {
					d := *minDelay + time.Duration(rand.Int63n(int64(*maxDelay-*minDelay)+1))
					log.Printf("  waiting %s", d.Round(time.Second))
					time.Sleep(d)
				}
			}
			log.Printf("campaign done: %d sent, %d skipped, %d total", sent, skipped, len(users))
			mem("after-campaign")
			return nil
		}

		if *to != "" {
			// small human-like jitter before sending
			time.Sleep(time.Duration(2000+rand.Intn(3000)) * time.Millisecond)
			sender := message.NewSender(client.API())
			for attempt := 0; attempt < 2; attempt++ {
				_, err = sender.Resolve(*to).Text(ctx, *text)
				if d, ok := tgerr.AsFloodWait(err); ok {
					log.Printf("FLOOD_WAIT %s — waiting, then one retry", d)
					if d > 2*time.Minute {
						return fmt.Errorf("flood wait too long (%s), aborting", d)
					}
					time.Sleep(d + time.Second)
					continue
				}
				break
			}
			if err != nil {
				return fmt.Errorf("send DM: %w", err)
			}
			log.Printf("DM sent to @%s", *to)
			mem("after-dm")
		}

		log.Printf("idling %s for RAM measurement...", *idle)
		time.Sleep(*idle)
		mem("idle")
		return nil
	})
	if err != nil {
		log.Fatalf("error: %v", err)
	}
	log.Print("done")
}
