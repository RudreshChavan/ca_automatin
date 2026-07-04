"""
Admin routes — user management, file oversight, task assignment, admin dashboard.
All routes require admin role.
"""

import os
import bcrypt
from flask import Blueprint, request, jsonify, g

from middleware import require_auth, require_admin
from models import (
    get_all_users, delete_user, get_user_by_email,
    create_user, get_all_files, get_file_by_id_admin,
    delete_file_admin, get_admin_dashboard_stats,
    create_folder, update_folder_drive_id,
    get_user_stats, create_task, get_all_tasks,
    get_completed_tasks,
    get_pending_files, get_pending_files_count,
    update_file_status, create_notification,
    create_folder_for_client, get_all_folders_admin,
)
from config import Config
from services import drive_service

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")

# Local storage directory (same as file_routes)
LOCAL_STORAGE_DIR = os.path.join(os.path.dirname(__file__), "..", "local_storage")


# ═══════════════════════════════════════════════════════════
# ADMIN DASHBOARD
# ═══════════════════════════════════════════════════════════

@admin_bp.route("/dashboard", methods=["GET"])
@require_auth
@require_admin
def admin_dashboard():
    """Get admin dashboard statistics: total users, files, storage, recent uploads."""
    stats = get_admin_dashboard_stats()
    return jsonify(stats), 200


# ═══════════════════════════════════════════════════════════
# USER MANAGEMENT
# ═══════════════════════════════════════════════════════════

@admin_bp.route("/users", methods=["GET"])
@require_auth
@require_admin
def list_users():
    """List all users with file/folder counts."""
    users = get_all_users()
    return jsonify({"users": users}), 200


@admin_bp.route("/create-user", methods=["POST"])
@require_auth
@require_admin
def create_user_admin():
    """Create a new user account (admin action)."""
    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body is required"}), 400

    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    role = data.get("role", "user")

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    if role not in ("admin", "user"):
        return jsonify({"error": "Role must be 'admin' or 'user'"}), 400

    # Check if email already exists
    existing = get_user_by_email(email)
    if existing:
        return jsonify({"error": "An account with this email already exists"}), 409

    # Hash password
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    # Create user
    user = create_user(email, hashed, name=name or None, role=role)
    user_id = user["id"]

    # Auto-create default folders
    drive_root_id = None
    if drive_service.is_available():
        drive_root_id = drive_service.create_folder(f"DAM_{user_id}")

    for folder_name in Config.DEFAULT_FOLDERS:
        folder = create_folder(folder_name, user_id)
        if drive_service.is_available() and drive_root_id:
            drive_folder_id = drive_service.create_folder(folder_name, drive_root_id)
            if drive_folder_id:
                update_folder_drive_id(folder["id"], drive_folder_id)

    # Remove password from response
    user.pop("password", None)

    return jsonify({
        "message": f"User '{email}' created successfully",
        "user": user,
    }), 201


@admin_bp.route("/user/<int:user_id>", methods=["DELETE"])
@require_auth
@require_admin
def delete_user_route(user_id):
    """Delete a user and all their data."""
    # Prevent admin from deleting themselves
    if user_id == g.user_id:
        return jsonify({"error": "Cannot delete your own account"}), 400

    # Delete local storage files for this user
    user_storage = os.path.join(LOCAL_STORAGE_DIR, str(user_id))
    if os.path.isdir(user_storage):
        import shutil
        shutil.rmtree(user_storage, ignore_errors=True)

    # Delete from DB (cascades files + folders)
    success = delete_user(user_id)
    if not success:
        return jsonify({"error": "User not found or could not be deleted"}), 404

    return jsonify({"message": "User and all their data deleted successfully"}), 200


# ═══════════════════════════════════════════════════════════
# FILE OVERSIGHT
# ═══════════════════════════════════════════════════════════

@admin_bp.route("/files", methods=["GET"])
@require_auth
@require_admin
def list_all_files():
    """List all files across all users. Optional ?user_id= filter, ?search= filter, ?status= filter, ?folder_id= filter."""
    user_id_filter = request.args.get("user_id", type=int)
    folder_id_filter = request.args.get("folder_id", type=int)
    search = request.args.get("search", "").strip()
    status = request.args.get("status", "").strip()

    files = get_all_files(
        user_id_filter=user_id_filter,
        folder_id_filter=folder_id_filter,
        search=search or None,
        status=status or None,
    )
    return jsonify({"files": files}), 200


@admin_bp.route("/file/<int:file_id>", methods=["DELETE"])
@require_auth
@require_admin
def admin_delete_file(file_id):
    """Delete any file (admin — no user scoping)."""
    file = get_file_by_id_admin(file_id)
    if not file:
        return jsonify({"error": "File not found"}), 404

    # Delete from Google Drive
    if file.get("drive_file_id"):
        drive_service.delete_file(file["drive_file_id"])

    # Delete local file if exists
    web_link = file.get("drive_web_link", "")
    if web_link.startswith("/api/files/serve/"):
        relative_path = web_link.replace("/api/files/serve/", "")
        local_path = os.path.join(LOCAL_STORAGE_DIR, relative_path)
        if os.path.exists(local_path):
            os.remove(local_path)

    # Delete from DB
    delete_file_admin(file_id)

    return jsonify({"message": "File deleted successfully"}), 200


@admin_bp.route("/files/gdrive-edit/<int:file_id>", methods=["GET"])
@require_auth
@require_admin
def admin_gdrive_edit_file(file_id):
    """
    Grant the admin edit access (writer) to a Google Drive file,
    and return the Drive web link to open in a new tab.
    """
    file = get_file_by_id_admin(file_id)
    if not file:
        return jsonify({"error": "File not found"}), 404

    web_link = file.get("drive_web_link", "")
    if not web_link or web_link.startswith("/api/files/serve/"):
        return jsonify({"error": "This file is not hosted on Google Drive."}), 400

    drive_file_id = file.get("drive_file_id")
    admin_email = getattr(g, 'email', None)

    if not drive_file_id or not admin_email:
        return jsonify({"error": "Missing Drive File ID or Admin Email."}), 400

    # Grant edit access to the admin's email
    success = drive_service.grant_edit_access(drive_file_id, admin_email)
    if not success:
        return jsonify({
            "error": "Failed to grant edit access.",
            "detail": "Make sure your Admin email is a valid Google Account."
        }), 500

    return jsonify({"drive_web_link": web_link}), 200



@admin_bp.route("/user/<int:user_id>/stats", methods=["GET"])
@require_auth
@require_admin
def admin_get_user_stats(user_id):
    """Get basic file stats for a specific user to check upload status."""
    stats = get_user_stats(user_id)
    return jsonify({"stats": stats}), 200


# ══════════════════════════════════════════════════════════════
# TASK ASSIGNMENT SYSTEM
# ══════════════════════════════════════════════════════════════

@admin_bp.route("/task", methods=["POST"])
@require_auth
@require_admin
def admin_create_task():
    """Create and assign a task to a user."""
    data = request.json
    user_id = data.get("user_id")
    title = (data.get("title") or "").strip()
    description = (data.get("description") or "").strip() or None

    if not user_id or not title:
        return jsonify({"error": "user_id and title are required"}), 400

    task = create_task(user_id, g.user_id, title, description)
    return jsonify({"message": "Task assigned successfully", "task": task}), 201


@admin_bp.route("/tasks", methods=["GET"])
@require_auth
@require_admin
def admin_get_all_tasks():
    """Get all tasks across all users (pending and completed)."""
    tasks = get_all_tasks()
    return jsonify({"tasks": tasks}), 200


@admin_bp.route("/tasks/completed", methods=["GET"])
@require_auth
@require_admin
def admin_get_completed_tasks():
    """Get all completed tasks across all users."""
    tasks = get_completed_tasks()
    return jsonify({"tasks": tasks}), 200


# ═══════════════════════════════════════════════════════════
# FILE REVIEW WORKFLOW
# ═══════════════════════════════════════════════════════════

@admin_bp.route("/files/pending", methods=["GET"])
@require_auth
@require_admin
def get_pending_review_files():
    """Get all files pending review."""
    files = get_pending_files()
    count = get_pending_files_count()
    return jsonify({"files": files, "count": count}), 200


@admin_bp.route("/file/<int:file_id>/review", methods=["POST"])
@require_auth
@require_admin
def review_file(file_id):
    """Mark a file as reviewed. Changes status to 'reviewed' and notifies the client."""
    file = get_file_by_id_admin(file_id)
    if not file:
        return jsonify({"error": "File not found"}), 404

    # Update status
    success = update_file_status(file_id, "reviewed", reviewed_by=g.user_id)
    if not success:
        return jsonify({"error": "Failed to update file status"}), 500

    # Notify the file owner
    try:
        create_notification(
            user_id=file["user_id"],
            notif_type="file_reviewed",
            title="File Reviewed",
            message=f"Your file '{file['file_name']}' has been reviewed by the CA.",
            related_id=file_id,
        )
    except Exception as e:
        print(f"[Notify] Failed to notify user: {e}")

    return jsonify({"message": f"File '{file['file_name']}' marked as reviewed"}), 200


# ═══════════════════════════════════════════════════════════
# FOLDER MANAGEMENT
# ═══════════════════════════════════════════════════════════

@admin_bp.route("/folder", methods=["POST"])
@require_auth
@require_admin
def admin_create_folder():
    """Create a custom folder for a client."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body is required"}), 400

    folder_name = (data.get("name") or "").strip()
    user_id = data.get("user_id")
    parent_id = data.get("parent_id")

    if not folder_name or not user_id:
        return jsonify({"error": "Folder name and user_id are required"}), 400

    try:
        folder = create_folder_for_client(
            name=folder_name,
            user_id=user_id,
            created_by=g.user_id,
            parent_id=parent_id,
        )
        return jsonify({"message": f"Folder '{folder_name}' created", "folder": folder}), 201
    except Exception as e:
        return jsonify({"error": f"Failed to create folder: {str(e)}"}), 500


@admin_bp.route("/user/<int:user_id>/folders", methods=["GET"])
@require_auth
@require_admin
def admin_get_user_folders(user_id):
    """Get all folders for a specific client."""
    folders = get_all_folders_admin(user_id=user_id)
    return jsonify({"folders": folders}), 200
