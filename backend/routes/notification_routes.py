"""
Notification routes — list, read, unread count.
"""

from flask import Blueprint, request, jsonify, g

from middleware import require_auth
from models import (
    get_user_notifications, get_unread_notification_count,
    mark_notification_read, mark_all_notifications_read,
)

notification_bp = Blueprint("notifications", __name__, url_prefix="/api/notifications")


@notification_bp.route("", methods=["GET"])
@require_auth
def list_notifications():
    """Get all notifications for the current user."""
    limit = request.args.get("limit", 50, type=int)
    notifications = get_user_notifications(g.user_id, limit=limit)
    return jsonify({"notifications": notifications}), 200


@notification_bp.route("/unread-count", methods=["GET"])
@require_auth
def unread_count():
    """Get the count of unread notifications."""
    count = get_unread_notification_count(g.user_id)
    return jsonify({"count": count}), 200


@notification_bp.route("/<int:notification_id>/read", methods=["PUT"])
@require_auth
def read_notification(notification_id):
    """Mark a single notification as read."""
    success = mark_notification_read(notification_id, g.user_id)
    if not success:
        return jsonify({"error": "Notification not found"}), 404
    return jsonify({"message": "Notification marked as read"}), 200


@notification_bp.route("/read-all", methods=["PUT"])
@require_auth
def read_all_notifications():
    """Mark all notifications as read."""
    count = mark_all_notifications_read(g.user_id)
    return jsonify({"message": f"{count} notifications marked as read"}), 200
