"""Shared-token auth for the localhost sidecar."""
import hmac

from fastapi import Header, HTTPException, Request, status


def require_token(request: Request, x_auth_token: str = Header(default="")) -> None:
    expected = request.app.state.token
    if not expected:  # token disabled (e.g. tests that opt out)
        return
    if not hmac.compare_digest(x_auth_token or "", expected):  # constant-time
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="invalid or missing token")


def ws_token_ok(app, token: str) -> bool:
    expected = app.state.token
    return (not expected) or hmac.compare_digest(token or "", expected)
