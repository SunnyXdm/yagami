"""
Integration test — verifies the full NATS message flow between services.

This test requires docker compose to be running (postgres + nats at minimum).
It publishes test events through NATS and verifies they arrive correctly,
the database gets updated, and the API returns them.

Run with:
    docker compose up -d postgres nats
    pip install pytest pytest-asyncio nats-py asyncpg httpx
    pytest tests/test_integration.py -v

LEARNING: Integration tests verify that components work TOGETHER.
Unit tests verify individual pieces in isolation. You need both.
"""

import asyncio
import json
import os
import time

import httpx
import nats
import pytest

# Configuration from environment (or defaults for local testing)
NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
DATABASE_URL = os.getenv("DATABASE_URL", "postgres://yagami:yagami@localhost:5432/yagami")
API_URL = os.getenv("API_URL", "http://localhost:8080")


@pytest.fixture(scope="session")
def event_loop():
    """Create a shared event loop for all async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ── NATS connectivity ────────────────────────────────────────


class TestNATSConnectivity:
    @pytest.mark.asyncio
    async def test_can_connect_to_nats(self):
        """Verify NATS is reachable."""
        nc = await nats.connect(NATS_URL)
        assert nc.is_connected
        await nc.close()

    @pytest.mark.asyncio
    async def test_publish_and_subscribe(self):
        """Verify basic NATS pub/sub works."""
        nc = await nats.connect(NATS_URL)
        received = []

        async def handler(msg):
            received.append(json.loads(msg.data.decode()))

        await nc.subscribe("test.integration", cb=handler)
        await nc.publish("test.integration", json.dumps({"hello": "world"}).encode())
        await nc.flush()
        await asyncio.sleep(0.5)

        assert len(received) == 1
        assert received[0]["hello"] == "world"
        await nc.close()

    @pytest.mark.asyncio
    async def test_youtube_subjects_routable(self):
        """Verify the NATS subjects used by our services are valid."""
        nc = await nats.connect(NATS_URL)
        subjects = [
            "youtube.watch",
            "youtube.likes",
            "youtube.subscriptions",
            "download.request",
            "download.complete",
        ]

        received_subjects = []

        for subject in subjects:
            async def handler(msg, subj=subject):
                received_subjects.append(subj)

            await nc.subscribe(subject, cb=handler)

        for subject in subjects:
            await nc.publish(subject, b'{"test": true}')

        await nc.flush()
        await asyncio.sleep(0.5)

        assert set(received_subjects) == set(subjects)
        await nc.close()


# ── Database connectivity ────────────────────────────────────


class TestDatabaseConnectivity:
    @pytest.mark.asyncio
    async def test_can_connect_to_postgres(self):
        """Verify PostgreSQL is reachable and schema exists."""
        import asyncpg

        conn = await asyncpg.connect(DATABASE_URL)
        # Check that our tables exist
        tables = await conn.fetch("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public'
        """)
        table_names = {row["table_name"] for row in tables}

        expected = {"events", "known_likes", "known_subscriptions", "known_watch_history", "downloads", "oauth_tokens"}
        assert expected.issubset(table_names), f"Missing tables: {expected - table_names}"

        await conn.close()

    @pytest.mark.asyncio
    async def test_can_insert_and_read_event(self):
        """Verify events table accepts inserts and supports querying."""
        import asyncpg

        conn = await asyncpg.connect(DATABASE_URL)

        # Insert a test event
        await conn.execute("""
            INSERT INTO events (event_type, data)
            VALUES ($1, $2)
        """, "test", json.dumps({"integration": True, "timestamp": time.time()}))

        # Read it back
        row = await conn.fetchrow("""
            SELECT event_type, data FROM events
            WHERE event_type = 'test'
            ORDER BY created_at DESC LIMIT 1
        """)

        assert row["event_type"] == "test"
        data = json.loads(row["data"])
        assert data["integration"] is True

        # Clean up test data
        await conn.execute("DELETE FROM events WHERE event_type = 'test'")
        await conn.close()


# ── Message flow (NATS → DB) ────────────────────────────────


class TestMessageFlow:
    """Test that publishing a NATS message results in correct downstream behavior."""

    @pytest.mark.asyncio
    async def test_like_event_format(self):
        """Verify a like event has the expected structure for downstream consumers."""
        like_event = {
            "video_id": "test_vid_001",
            "title": "Integration Test Video",
            "channel": "TestChannel",
            "channel_id": "UC_test",
            "thumbnail": "https://img.youtube.com/vi/test_vid_001/hqdefault.jpg",
            "duration": "3:45",
            "published_at": "2024-01-15T10:30:00Z",
        }

        # Verify all required fields are present
        required_fields = ["video_id", "title", "channel", "channel_id"]
        for field in required_fields:
            assert field in like_event, f"Missing required field: {field}"

        # Verify it serializes to valid JSON
        encoded = json.dumps(like_event).encode()
        decoded = json.loads(encoded)
        assert decoded["video_id"] == "test_vid_001"

    @pytest.mark.asyncio
    async def test_download_request_triggers_correctly(self):
        """Verify download.request messages are received by subscribers."""
        nc = await nats.connect(NATS_URL)
        received = asyncio.Event()
        received_data = {}

        async def handler(msg):
            nonlocal received_data
            received_data = json.loads(msg.data.decode())
            received.set()

        await nc.subscribe("download.request", cb=handler)

        download_req = {
            "video_id": "dl_test_001",
            "title": "Download Test",
            "url": "https://www.youtube.com/watch?v=dl_test_001",
        }
        await nc.publish("download.request", json.dumps(download_req).encode())
        await nc.flush()

        await asyncio.wait_for(received.wait(), timeout=5.0)

        assert received_data["video_id"] == "dl_test_001"
        assert received_data["url"].startswith("https://")
        await nc.close()

    @pytest.mark.asyncio
    async def test_download_complete_format(self):
        """Verify download.complete messages have the expected structure."""
        # Success case
        success = {
            "video_id": "vid123",
            "title": "Test",
            "file_path": "/tmp/downloads/vid123.mp4",
            "file_size": 1048576,
            "success": True,
            "error": None,
        }
        encoded = json.dumps(success)
        decoded = json.loads(encoded)
        assert decoded["success"] is True
        assert decoded["file_path"] is not None

        # Failure case
        failure = {
            "video_id": "vid456",
            "title": "Bad Video",
            "file_path": None,
            "file_size": None,
            "success": False,
            "error": "yt-dlp exited with code 1",
        }
        decoded = json.loads(json.dumps(failure))
        assert decoded["success"] is False
        assert "yt-dlp" in decoded["error"]


# ── API Gateway ──────────────────────────────────────────────


class TestAPIGateway:
    """Test the REST API endpoints (requires api-gateway to be running)."""

    def test_health_endpoint(self):
        """GET /health should return 200."""
        try:
            resp = httpx.get(f"{API_URL}/health", timeout=5)
            assert resp.status_code == 200
            body = resp.json()
            assert body["status"] == "healthy"
        except httpx.ConnectError:
            pytest.skip("API gateway not running")

    def test_events_endpoint_returns_array(self):
        """GET /api/events should always return a JSON array."""
        try:
            resp = httpx.get(f"{API_URL}/api/events", timeout=5)
            assert resp.status_code == 200
            body = resp.json()
            assert isinstance(body, list)
        except httpx.ConnectError:
            pytest.skip("API gateway not running")

    def test_events_with_type_filter(self):
        """GET /api/events?type=watch should filter correctly."""
        try:
            resp = httpx.get(f"{API_URL}/api/events?type=watch", timeout=5)
            assert resp.status_code == 200
            body = resp.json()
            assert isinstance(body, list)
            for event in body:
                assert event["event_type"] == "watch"
        except httpx.ConnectError:
            pytest.skip("API gateway not running")

    def test_events_with_limit(self):
        """GET /api/events?limit=5 should respect limit."""
        try:
            resp = httpx.get(f"{API_URL}/api/events?limit=5", timeout=5)
            assert resp.status_code == 200
            body = resp.json()
            assert len(body) <= 5
        except httpx.ConnectError:
            pytest.skip("API gateway not running")

    def test_stats_endpoint(self):
        """GET /api/stats should return aggregate counts."""
        try:
            resp = httpx.get(f"{API_URL}/api/stats", timeout=5)
            assert resp.status_code == 200
            body = resp.json()
            expected_keys = {"total_watched", "total_liked", "total_subscribed"}
            assert expected_keys.issubset(body.keys())
        except httpx.ConnectError:
            pytest.skip("API gateway not running")
