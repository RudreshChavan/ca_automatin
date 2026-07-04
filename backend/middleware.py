"""
Authentication middleware — JWT decorators for route protection.
"""

from functools import wraps
from flask import request, jsonify, g
from auth import decode_token


def require_auth(f):
    """
    Decorator that extracts and verifies the JWT from the Authorization header.
    Sets g.user_id, g.email, and g.role on success.
    """

    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        token = None

        if auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1]
        elif request.args.get("token"):
            token = request.args.get("token")

        if not token:
            return jsonify({"error": "Missing or invalid authorization token"}), 401

        try:
            payload = decode_token(token)
            g.user_id = payload["user_id"]
            g.email = payload["email"]
            g.role = payload.get("role", "user")
        except Exception as e:
            return jsonify({"error": "Invalid or expired token", "detail": str(e)}), 401

        return f(*args, **kwargs)

    return decorated


def require_admin(f):
    """
    Decorator that enforces admin-only access.
    Must be used AFTER @require_auth so that g.role is already set.

    Usage:
        @route(...)
        @require_auth
        @require_admin
        def admin_endpoint():
            ...
    """

    @wraps(f)
    def decorated(*args, **kwargs):
        if getattr(g, "role", None) != "admin":
            return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)

    return decorated
