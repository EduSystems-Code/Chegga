from unittest.mock import MagicMock, patch

from app.services.chess_com_client import ChessComClient


def _mock_response(status_code: int, json_data: dict, headers: dict | None = None) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.headers = headers or {}
    return resp


def test_get_archive_urls_hits_only_the_official_api():
    client = ChessComClient(contact="test@example.com", min_interval_seconds=0)
    archives = {"archives": ["https://api.chess.com/pub/player/testuser/games/2024/01"]}

    with patch("requests.Session.get", return_value=_mock_response(200, archives)) as mock_get:
        result = client.get_archive_urls("testuser")

    assert result == archives["archives"]
    called_url = mock_get.call_args[0][0]
    assert called_url.startswith("https://api.chess.com/pub/")


def test_get_archive_returns_games_list():
    client = ChessComClient(contact="test@example.com", min_interval_seconds=0)
    payload = {"games": [{"uuid": "abc123"}]}

    with patch("requests.Session.get", return_value=_mock_response(200, payload)):
        games = client.get_archive("https://api.chess.com/pub/player/testuser/games/2024/01")

    assert games == payload["games"]


def test_retries_on_429_then_succeeds():
    client = ChessComClient(contact="test@example.com", min_interval_seconds=0)
    responses = [
        _mock_response(429, {}, headers={"Retry-After": "0"}),
        _mock_response(200, {"games": []}),
    ]

    with patch("requests.Session.get", side_effect=responses), patch("time.sleep"):
        games = client.get_archive("https://api.chess.com/pub/player/testuser/games/2024/01")

    assert games == []


def test_user_agent_identifies_the_app_and_contact():
    client = ChessComClient(contact="test@example.com", min_interval_seconds=0)
    assert "test@example.com" in client._session.headers["User-Agent"]
    assert "Chegga" in client._session.headers["User-Agent"]
