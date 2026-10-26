package auth

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// AppleTokens exchanges one-time codes and revokes Apple refresh tokens.
// The .p8 signing key and the dedicated 32-byte encryption key are server secrets.
type AppleTokens struct {
	ClientID   string
	teamID     string
	keyID      string
	signingKey *ecdsa.PrivateKey
	key        []byte
	endpoint   string
	http       *http.Client
}

// NewAppleTokens takes the Sign in with Apple key (.p8 PEM contents). An
// unparseable key leaves token management disabled; config.Load rejects it
// in production.
func NewAppleTokens(clientID, teamID, keyID, privateKeyPEM, encryptionKey string) *AppleTokens {
	signingKey, _ := ParseApplePrivateKey(privateKeyPEM)
	return &AppleTokens{ClientID: clientID, teamID: teamID, keyID: keyID, signingKey: signingKey, key: []byte(encryptionKey), endpoint: "https://appleid.apple.com", http: &http.Client{Timeout: 8 * time.Second}}
}

func ParseApplePrivateKey(privateKeyPEM string) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(privateKeyPEM))
	if block == nil {
		return nil, errors.New("Apple private key is not PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("Apple private key is not PKCS#8")
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("Apple private key is not an EC key")
	}
	return key, nil
}

func (a *AppleTokens) Enabled() bool {
	return a != nil && a.ClientID != "" && a.teamID != "" && a.keyID != "" && a.signingKey != nil && len(a.key) == 32
}

// clientSecret signs a fresh short-lived client secret per call, so there is
// no long-lived JWT to renew (Apple caps those at six months).
func (a *AppleTokens) clientSecret() (string, error) {
	now := time.Now()
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.RegisteredClaims{
		Issuer:    a.teamID,
		Subject:   a.ClientID,
		Audience:  jwt.ClaimStrings{"https://appleid.apple.com"},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
	})
	tok.Header["kid"] = a.keyID
	return tok.SignedString(a.signingKey)
}

func (a *AppleTokens) post(ctx context.Context, path string, form url.Values, dst any) error {
	secret, err := a.clientSecret()
	if err != nil {
		return errors.New("cannot sign Apple client secret")
	}
	form.Set("client_id", a.ClientID)
	form.Set("client_secret", secret)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.endpoint+path, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := a.http.Do(req)
	if err != nil {
		return errors.New("Apple token service unavailable")
	}
	defer resp.Body.Close()
	// Never include Apple's response body, submitted codes, or tokens in errors.
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Apple token service returned HTTP %d", resp.StatusCode)
	}
	if dst == nil {
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64*1024)).Decode(dst); err != nil {
		return errors.New("invalid Apple token response")
	}
	return nil
}

// Exchange returns the encrypted refresh token and Apple's fresh identity token.
// The caller must verify that identity before associating the token to a user.
func (a *AppleTokens) Exchange(ctx context.Context, code string) ([]byte, string, error) {
	if !a.Enabled() {
		return nil, "", errors.New("Apple token management not configured")
	}
	if code == "" || len(code) > 4096 {
		return nil, "", errors.New("Apple authorization code required")
	}
	var tokens struct {
		Refresh  string `json:"refresh_token"`
		Identity string `json:"id_token"`
	}
	if err := a.post(ctx, "/auth/token", url.Values{"grant_type": {"authorization_code"}, "code": {code}}, &tokens); err != nil {
		return nil, "", err
	}
	if tokens.Refresh == "" || tokens.Identity == "" {
		return nil, "", errors.New("incomplete Apple token response")
	}
	encrypted, err := a.encrypt(tokens.Refresh)
	return encrypted, tokens.Identity, err
}

func (a *AppleTokens) encrypt(token string) ([]byte, error) {
	block, err := aes.NewCipher(a.key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, []byte(token), []byte(a.ClientID)), nil
}

func (a *AppleTokens) Revoke(ctx context.Context, encrypted []byte) error {
	if !a.Enabled() {
		return errors.New("Apple token management not configured")
	}
	block, err := aes.NewCipher(a.key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	if len(encrypted) < gcm.NonceSize() {
		return errors.New("invalid encrypted Apple token")
	}
	token, err := gcm.Open(nil, encrypted[:gcm.NonceSize()], encrypted[gcm.NonceSize():], []byte(a.ClientID))
	if err != nil {
		return errors.New("cannot decrypt Apple token")
	}
	return a.post(ctx, "/auth/revoke", url.Values{"token": {string(token)}, "token_type_hint": {"refresh_token"}}, nil)
}
