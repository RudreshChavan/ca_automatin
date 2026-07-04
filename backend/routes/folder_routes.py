"""
Folder routes — list user folders and create subfolders.
"""

from flask import Blueprint, jsonify, request, g

from middleware import require_auth
from models import get_user_folders, create_folder

folder_bp = Blueprint("folders", __name__, url_prefix="/api/folders")


@folder_bp.route("", methods=["GET"])
@require_auth
def list_folders():
    """Get all folders for the current user."""
    folders = get_user_folders(g.user_id)
    return jsonify({"folders": folders}), 200


@folder_bp.route("", methods=["POST"])
@require_auth
def create_subfolder():
    """Client creates a subfolder within their space."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body is required"}), 400

    folder_name = (data.get("name") or "").strip()
    if not folder_name:
        return jsonify({"error": "Folder name is required"}), 400

    try:
        folder = create_folder(name=folder_name, user_id=g.user_id)
        return jsonify({"message": f"Folder '{folder_name}' created", "folder": folder}), 201
    except Exception as e:
        return jsonify({"error": f"Failed to create folder: {str(e)}"}), 500

