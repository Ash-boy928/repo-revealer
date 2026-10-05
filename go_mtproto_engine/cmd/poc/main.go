// Phase 1 POC: one account, GramJS session, optional proxy, health check,
// one safe test DM, RAM report. Isolated — does not touch the live Node bot.
package main

import (
	"context"
	"flag"
	"fmt"
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

func main() {
	apiID := flag.Int("api-id", 0, "Telegram api_id")
	apiHash := flag.String("api-hash", "", "Telegram api_hash")
	sess := flag.String("session", os.Getenv("TG_SESSION"), "GramJS StringSession (or env TG_SESSION)")
	proxyURL := flag.String("proxy", "", "socks5://user:pass@host:port (optional)")
	to := flag.String("to", "", "test DM recipient username (optional, without @)")
	text := flag.String("text", "Hello from Go engine POC", "test DM text")
	idle := flag.Duration("idle", 30*time.Second, "stay connected for idle RAM measurement")
	flag.Parse()

	if *apiID == 0 || *apiHash == "" || *sess == "" {
		log.Fatal("required: -api-id, -api-hash, -session (or TG_SESSION)")
	}
	mem("start")

	gs, err := gramjs.Decode(*sess)
	if err != nil {
		log.Fatalf("session decode: %v", err)
	}
	log.Printf("session: DC%d %s", gs.DC, gs.Addr)

	storage := &session.StorageMemory{}
	if err := (&session.Loader{Storage: storage}).Save(context.Background(), &session.Data{
		DC: gs.DC, Addr: gs.Addr, AuthKey: gs.AuthKey, AuthKeyID: gs.AuthKeyID,
	}); err != nil {
		log.Fatal(err)
	}

	dial, err := dialer(*proxyURL)
	if err != nil {
		log.Fatalf("proxy: %v", err)
	}

	client := telegram.NewClient(*apiID, *apiHash, telegram.Options{
		SessionStorage: storage,
		DC:             gs.DC,
		Resolver:       dcs.Plain(dcs.PlainOptions{Dial: dial}),
		NoUpdates:      true, // POC: no update stream = lower RAM
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	err = client.Run(ctx, func(ctx context.Context) error {
		self, err := client.Self(ctx)
		if err != nil {
			return fmt.Errorf("health check (session invalid/expired?): %w", err)
		}
		log.Printf("connected as id=%d @%s %s", self.ID, self.Username, self.FirstName)
		mem("connected")

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
