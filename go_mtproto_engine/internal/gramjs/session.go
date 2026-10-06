// Package gramjs decodes GramJS StringSession strings (the format the
// existing Node bot stores) into the raw parts gotd/td needs, so existing
// logged-in accounts can be reused without a new OTP login.
//
// GramJS layout (version "1" + base64):
//
//	dcId(1) | addrLen(2, BE) | addr(addrLen) | port(2, BE) | authKey(256)
//
// If addrLen > 100 the address is a raw 16-byte IPv6 instead.
package gramjs

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"strings"
)

type Session struct {
	DC        int
	Addr      string // host:port
	AuthKey   []byte // 256 bytes
	AuthKeyID []byte // 8 bytes, sha1(key)[12:20]
}

func Decode(s string) (*Session, error) {
	s = strings.TrimSpace(s)
	if len(s) < 2 || s[0] != '1' {
		return nil, errors.New("unsupported GramJS session version (expected prefix '1')")
	}
	raw, err := base64.StdEncoding.DecodeString(s[1:])
	if err != nil {
		if raw, err = base64.RawStdEncoding.DecodeString(s[1:]); err != nil {
			return nil, fmt.Errorf("base64: %w", err)
		}
	}
	if len(raw) < 1+2+4+2+256 {
		return nil, fmt.Errorf("session too short: %d bytes", len(raw))
	}
	off := 0
	dc := int(raw[off])
	off++
	addrLen := int(binary.BigEndian.Uint16(raw[off:]))
	var host string
	if addrLen > 100 { // IPv6 raw bytes
		host = net.IP(raw[off : off+16]).String()
		off += 16
	} else {
		off += 2
		if off+addrLen > len(raw) {
			return nil, errors.New("bad address length")
		}
		host = string(raw[off : off+addrLen])
		off += addrLen
	}
	if off+2+256 > len(raw) {
		return nil, errors.New("truncated port/authKey")
	}
	port := int(binary.BigEndian.Uint16(raw[off:]))
	off += 2
	key := append([]byte(nil), raw[off:off+256]...)
	h := sha1.Sum(key)
	return &Session{
		DC:        dc,
		Addr:      net.JoinHostPort(host, fmt.Sprint(port)),
		AuthKey:   key,
		AuthKeyID: append([]byte(nil), h[12:20]...),
	}, nil
}
