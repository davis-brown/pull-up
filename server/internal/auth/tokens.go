package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

var ErrInvalidToken = errors.New("invalid token")

type Issuer struct {
	secret    []byte
	accessTTL time.Duration
}

func NewIssuer(secret []byte, accessTTL time.Duration) *Issuer {
	return &Issuer{secret: secret, accessTTL: accessTTL}
}

func (i *Issuer) IssueAccessToken(userID uuid.UUID, now time.Time) (string, error) {
	claims := jwt.RegisteredClaims{
		Subject:   userID.String(),
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(i.accessTTL)),
		Issuer:    "pull-up",
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(i.secret)
}

func (i *Issuer) VerifyAccessToken(token string) (uuid.UUID, error) {
	parsed, err := jwt.ParseWithClaims(token, &jwt.RegisteredClaims{}, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, ErrInvalidToken
		}
		return i.secret, nil
	}, jwt.WithIssuer("pull-up"), jwt.WithExpirationRequired())
	if err != nil || !parsed.Valid {
		return uuid.Nil, ErrInvalidToken
	}
	claims, ok := parsed.Claims.(*jwt.RegisteredClaims)
	if !ok {
		return uuid.Nil, ErrInvalidToken
	}
	id, err := uuid.Parse(claims.Subject)
	if err != nil {
		return uuid.Nil, ErrInvalidToken
	}
	return id, nil
}

// NewRefreshToken returns the opaque token given to the client and the
// sha256 hash that gets persisted. Only the hash ever touches the database.
func NewRefreshToken() (token string, hash string, err error) {
	return newOpaqueToken()
}

// NewEmailVerificationToken returns a one-time token and the hash persisted by
// the server. It intentionally has the same entropy as a refresh token.
func NewEmailVerificationToken() (token string, hash string, err error) {
	return newOpaqueToken()
}

func newOpaqueToken() (token string, hash string, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	token = hex.EncodeToString(raw)
	return token, HashRefreshToken(token), nil
}

func HashRefreshToken(token string) string {
	return hashOpaqueToken(token)
}

func HashEmailVerificationToken(token string) string {
	return hashOpaqueToken(token)
}

func hashOpaqueToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
