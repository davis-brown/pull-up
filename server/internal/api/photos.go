package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

// Photos live in R2, fronted by the deploy/api Worker. The Go API never
// touches the bytes: it issues a short-lived HMAC-signed upload URL that the
// Worker verifies with the dedicated UPLOAD_SIGNING_SECRET before writing to
// the bucket. Reads are authorized through the internal media endpoint.

// signUpload returns the signature for an upload of key valid until exp
// (unix seconds). Must match the Worker's verification exactly.
func signUpload(secret []byte, key string, exp int64) string {
	mac := hmac.New(sha256.New, secret)
	fmt.Fprintf(mac, "%s:%d", key, exp)
	return hex.EncodeToString(mac.Sum(nil))
}

func uploadAuthorization(secret []byte, key string, exp int64) string {
	return fmt.Sprintf("PullUp-Upload %d.%s", exp, signUpload(secret, key, exp))
}
