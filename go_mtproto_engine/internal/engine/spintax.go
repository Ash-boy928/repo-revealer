package engine

import (
	"math/rand"
	"strings"
)

// Spin resolves {a|b|c} groups (nested supported) and fills {name}/{username}.
func Spin(tpl, name, username string) string {
	tpl = strings.ReplaceAll(tpl, "{name}", name)
	tpl = strings.ReplaceAll(tpl, "{username}", username)
	for {
		end := strings.Index(tpl, "}")
		if end < 0 {
			return tpl
		}
		start := strings.LastIndex(tpl[:end], "{")
		if start < 0 {
			return tpl
		}
		opts := strings.Split(tpl[start+1:end], "|")
		tpl = tpl[:start] + opts[rand.Intn(len(opts))] + tpl[end+1:]
	}
}
