package store

import "context"

// ResetOAuthYouTubeState clears OAuth-derived diff baselines so the next poll
// silently reseeds instead of diffing a possibly different authorized account.
func (s *Store) ResetOAuthYouTubeState(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	for _, stmt := range []string{
		`DELETE FROM known_likes`,
		`DELETE FROM known_subscriptions`,
		`DELETE FROM config WHERE key IN ('seeded_likes', 'seeded_subs')`,
	} {
		if _, err := tx.Exec(ctx, stmt); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}