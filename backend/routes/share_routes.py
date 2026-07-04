"""
File sharing routes — share files with employees/clients, manage permissions.
"""

from flask import Blueprint, request, jsonify, g

from middleware import require_auth, require_admin
from models import (
    create_file_share, get_shares_for_file, get_shared_files_for_user,
    update_file_share, revoke_file_share, get_all_shares_admin,
    get_employees_and_clients, get_file_by_id_admin,
    create_notification, check_user_file_access,
)

share_bp = Blueprint("shares", __name__, url_prefix="/api/shares")


@share_bp.route("", methods=["POST"])
@require_auth
@require_admin
def share_file():
    """
    Share a file with a user (admin only).
    Body: { file_id, shared_with_user_id, permission, expires_at? }
    Permission: 'view', 'edit', 'download'
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body is required"}), 400

    file_id = data.get("file_id")
    shared_with = data.get("shared_with_user_id")
    permission = data.get("permission", "view")
    expires_at = data.get("expires_at")

    if not file_id or not shared_with:
        return jsonify({"error": "file_id and shared_with_user_id are required"}), 400

    if permission not in ("view", "edit", "download"):
        return jsonify({"error": "Permission must be 'view', 'edit', or 'download'"}), 400

    # Verify the file exists
    file = get_file_by_id_admin(file_id)
    if not file:
        return jsonify({"error": "File not found"}), 404

    try:
        share = create_file_share(
            file_id=file_id,
            shared_by=g.user_id,
            shared_with=shared_with,
            permission=permission,
            expires_at=expires_at,
        )

        # Notify the recipient
        perm_label = {"view": "View Only", "edit": "Edit", "download": "Download"}
        try:
            create_notification(
                user_id=shared_with,
                notif_type="file_shared",
                title="File Shared With You",
                message=f"'{file['file_name']}' has been shared with you ({perm_label.get(permission, permission)} access).",
                related_id=file_id,
            )
        except Exception as e:
            print(f"[Notify] Failed to notify share recipient: {e}")

        return jsonify({"message": "File shared successfully", "share": share}), 201

    except Exception as e:
        error_str = str(e)
        if "uq_share" in error_str.lower() or "unique" in error_str.lower():
            return jsonify({"error": "This file is already shared with that user. Update the permission instead."}), 409
        return jsonify({"error": f"Failed to share file: {error_str}"}), 500


@share_bp.route("/file/<int:file_id>", methods=["GET"])
@require_auth
@require_admin
def list_file_shares(file_id):
    """List all active shares for a specific file (admin only)."""
    shares = get_shares_for_file(file_id)
    return jsonify({"shares": shares}), 200


@share_bp.route("/my", methods=["GET"])
@require_auth
def my_shared_files():
    """Get files shared with the current user (employee/client view)."""
    files = get_shared_files_for_user(g.user_id)
    return jsonify({"shared_files": files}), 200


@share_bp.route("/all", methods=["GET"])
@require_auth
@require_admin
def all_shares():
    """Get all active file shares (admin view)."""
    shares = get_all_shares_admin()
    return jsonify({"shares": shares}), 200


@share_bp.route("/users", methods=["GET"])
@require_auth
@require_admin
def shareable_users():
    """Get list of employees and clients for the share dropdown."""
    users = get_employees_and_clients()
    return jsonify({"users": users}), 200


@share_bp.route("/<int:share_id>", methods=["PUT"])
@require_auth
@require_admin
def update_share(share_id):
    """Update the permission level of an existing share (admin only)."""
    data = request.get_json()
    if not data or "permission" not in data:
        return jsonify({"error": "permission is required"}), 400

    permission = data["permission"]
    if permission not in ("view", "edit", "download"):
        return jsonify({"error": "Permission must be 'view', 'edit', or 'download'"}), 400

    success = update_file_share(share_id, permission)
    if not success:
        return jsonify({"error": "Share not found"}), 404

    return jsonify({"message": "Permission updated"}), 200


@share_bp.route("/<int:share_id>", methods=["DELETE"])
@require_auth
@require_admin
def delete_share(share_id):
    """Revoke a file share (admin only)."""
    success = revoke_file_share(share_id)
    if not success:
        return jsonify({"error": "Share not found"}), 404

    return jsonify({"message": "Share revoked"}), 200
