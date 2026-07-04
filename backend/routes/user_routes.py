from flask import Blueprint, jsonify, request, g
from middleware import require_auth
from models import get_user_tasks, mark_task_done

user_bp = Blueprint("user", __name__, url_prefix="/api/user")

@user_bp.route("/tasks", methods=["GET"])
@require_auth
def get_tasks():
    """Get all pending tasks assigned to the authenticated user."""
    tasks = get_user_tasks(g.user_id)
    return jsonify({"tasks": tasks}), 200

@user_bp.route("/task/<int:task_id>/done", methods=["PUT"])
@require_auth
def mark_task_done_route(task_id):
    """Mark a task as done. Removes it from the user's pending list."""
    success = mark_task_done(task_id, g.user_id)
    if success:
        return jsonify({"message": "Task marked as done"}), 200
    return jsonify({"error": "Task not found or already completed"}), 404
