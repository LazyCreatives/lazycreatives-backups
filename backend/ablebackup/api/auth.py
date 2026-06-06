"""Shared-token auth for the localhost sidecar."""
from fastapi import Header, HTTPException, Request, status


def require_token(request: Request, x_auth_token: str = Header(default="")) -> None:
    expected = request.app.state.token
    if not expected:  # token disabled (e.g. tests that opt out)
        return
    if x_auth_token != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="invalid or missing token")


def ws_token_ok(app, token: str) -> bool:
    expected = app.state.token
    return (not expected) or token == expected
