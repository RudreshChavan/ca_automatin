"""
Authentication routes — signup, login, profile.
"""

import bcrypt
from flask import Blueprint, request, jsonify, g

from auth import create_token
from middleware import require_auth
from models import create_user, get_user_by_email, get_user_by_id, get_user_count, create_folder, update_folder_drive_id, create_storage_quota, get_storage_quota
from config import Config
from services import drive_service

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.route("/signup", methods=["POST"])
def signup():
    """Create a new account and auto-setup default folders."""
    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body is required"}), 400

    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    name = (data.get("name") or "").strip()

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    # Check if user already exists
    existing = get_user_by_email(email)
    if existing:
        return jsonify({"error": "An account with this email already exists"}), 409

    # Hash password
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    # First user becomes admin, rest are regular users
    user_count = get_user_count()
    role = "admin" if user_count == 0 else "user"

    # Create user
    user = create_user(email, hashed, name=name or None, role=role)
    user_id = user["id"]

    # ── AUTO-SETUP: Create default folders ──
    drive_root_id = None

    # Try to create root Google Drive folder
    if drive_service.is_available():
        drive_root_id = drive_service.create_folder(f"DAM_{user_id}")

    # Create each default folder in DB and Drive
    for folder_name in Config.DEFAULT_FOLDERS:
        folder = create_folder(folder_name, user_id)

        if drive_service.is_available() and drive_root_id:
            drive_folder_id = drive_service.create_folder(folder_name, drive_root_id)
            if drive_folder_id:
                update_folder_drive_id(folder["id"], drive_folder_id)

    # ── AUTO-SETUP: Create storage quota (1 TB free) ──
    try:
        create_storage_quota(user_id)
    except Exception as e:
        print(f"[Signup] Could not create storage quota: {e}")

    # Generate JWT (includes role)
    token = create_token(user_id, email, role)

    return jsonify({
        "message": "Account created successfully",
        "token": token,
        "user": {"id": user_id, "email": email, "name": user.get("name"), "role": role},
    }), 201


@auth_bp.route("/login", methods=["POST"])
def login():
    """Authenticate user and return JWT."""
    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body is required"}), 400

    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    user = get_user_by_email(email)
    if not user:
        return jsonify({"error": "Invalid email or password"}), 401

    # Verify password
    if not bcrypt.checkpw(password.encode("utf-8"), user["password"].encode("utf-8")):
        return jsonify({"error": "Invalid email or password"}), 401

    role = user.get("role", "user")

    # Ensure storage quota exists (backfill for existing users)
    try:
        if not get_storage_quota(user["id"]):
            create_storage_quota(user["id"])
    except Exception as e:
        print(f"[Login] Could not ensure storage quota: {e}")

    token = create_token(user["id"], user["email"], role)

    return jsonify({
        "message": "Login successful",
        "token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user.get("name"),
            "role": role,
        },
    }), 200


@auth_bp.route("/me", methods=["GET"])
@require_auth
def me():
    """Get current user profile."""
    user = get_user_by_id(g.user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    return jsonify({"user": user}), 200
