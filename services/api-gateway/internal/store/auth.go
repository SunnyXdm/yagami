package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID          int64      `json:"id"`
	Username    string     `json:"username"`
	IsAdmin     bool       `json:"is_admin"`
	CreatedAt   time.Time  `json:"created_at"`
	LastLoginAt *time.Time `json:"last_login_at,omitempty"`
}

func (s *Store) UserCount(ctx context.Context) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func (s *Store) CreateUser(ctx context.Context, username, password string) (*User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return nil, err
	}
	u := &User{}
	err = s.pool.QueryRow(ctx, `
	    INSERT INTO users (username, password_hash) VALUES ($1, $2)
	    RETURNING id, username, is_admin, created_at`,
		username, string(hash)).Scan(&u.ID, &u.Username, &u.IsAdmin, &u.CreatedAt)
	return u, err
}

func (s *Store) AuthenticateUser(ctx context.Context, username, password string) (*User, error) {
	var u User
	var hash string
	err := s.pool.QueryRow(ctx, `
	    SELECT id, username, password_hash, is_admin, created_at, last_login_at
	      FROM users WHERE username=$1`,
		username).Scan(&u.ID, &u.Username, &hash, &u.IsAdmin, &u.CreatedAt, &u.LastLoginAt)
	if err != nil {
		return nil, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return nil, err
	}
	_, _ = s.pool.Exec(ctx, `UPDATE users SET last_login_at=NOW() WHERE id=$1`, u.ID)
	return &u, nil
}

func (s *Store) ChangePassword(ctx context.Context, userID int64, newPassword string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), 12)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `UPDATE users SET password_hash=$1 WHERE id=$2`, string(hash), userID)
	return err
}

type Session struct {
	Token     string
	UserID    int64
	ExpiresAt time.Time
}

func newToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Store) CreateSession(ctx context.Context, userID int64, ua, ip string, ttl time.Duration) (*Session, error) {
	tok := newToken()
	exp := time.Now().Add(ttl)
	_, err := s.pool.Exec(ctx, `
	    INSERT INTO sessions (token, user_id, expires_at, user_agent, ip)
	    VALUES ($1,$2,$3,$4,$5)`, tok, userID, exp, ua, ip)
	if err != nil {
		return nil, err
	}
	return &Session{Token: tok, UserID: userID, ExpiresAt: exp}, nil
}

func (s *Store) UserBySession(ctx context.Context, token string) (*User, error) {
	var u User
	err := s.pool.QueryRow(ctx, `
	    SELECT u.id, u.username, u.is_admin, u.created_at, u.last_login_at
	      FROM sessions s JOIN users u ON u.id = s.user_id
	     WHERE s.token=$1 AND s.expires_at > NOW()`, token).
		Scan(&u.ID, &u.Username, &u.IsAdmin, &u.CreatedAt, &u.LastLoginAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE token=$1`, token)
	return err
}

func (s *Store) PurgeExpiredSessions(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at < NOW()`)
	return err
}
