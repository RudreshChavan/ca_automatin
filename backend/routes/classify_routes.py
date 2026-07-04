"""
Document Classification Routes — classify, review, override, stats.
All classification management endpoints for admin.
"""

import os
from flask import Blueprint, request, jsonify, g

from middleware import require_auth, require_admin
from models import (
    get_classification_log, get_files_needing_review,
    get_all_classification_logs, mark_classification_reviewed,
    update_file_classification, reclassify_file_manual,
    get_classification_stats, get_all_files_for_reclassification,
    create_classification_log, get_file_by_id_admin,
    get_folder_by_name, create_folder, move_file_to_folder,
)
from services.classify_service import (
    classify_document, get_all_categories, get_category_display_name,
)

classify_bp = Blueprint("classify", __name__, url_prefix="/api/classify")

# Local storage directory (same as file_routes)
LOCAL_STORAGE_DIR = os.path.join(os.path.dirname(__file__), "..", "local_storage")


@classify_bp.route("/stats", methods=["GET"])
@require_auth
@require_admin
def classification_stats():
    """Get classification distribution stats for the dashboard."""
    stats = get_classification_stats()
    return jsonify(stats), 200


@classify_bp.route("/review-queue", methods=["GET"])
@require_auth
@require_admin
def review_queue():
    """Get all files needing manual review (confidence < 80%)."""
    files = get_files_needing_review()
    return jsonify({"files": files, "count": len(files)}), 200


@classify_bp.route("/logs", methods=["GET"])
@require_auth
@require_admin
def all_logs():
    """Get all recent classification logs."""
    logs = get_all_classification_logs()
    return jsonify({"logs": logs}), 200


@classify_bp.route("/<int:file_id>", methods=["GET"])
@require_auth
def get_file_classification(file_id):
    """Get classification result for a specific file."""
    log = get_classification_log(file_id)
    if not log:
        return jsonify({"error": "No classification found for this file"}), 404
    return jsonify({"classification": log}), 200


@classify_bp.route("/<int:file_id>/approve", methods=["POST"])
@require_auth
@require_admin
def approve_classification(file_id):
    """Admin approves a classification — marks as reviewed."""
    log = get_classification_log(file_id)
    if not log:
        return jsonify({"error": "No classification found for this file"}), 404

    success = mark_classification_reviewed(log["id"], g.user_id)
    if not success:
        return jsonify({"error": "Failed to approve classification"}), 500

    return jsonify({"message": "Classification approved"}), 200


@classify_bp.route("/<int:file_id>/override", methods=["POST"])
@require_auth
@require_admin
def override_classification(file_id):
    """Admin manually overrides the classification of a file."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body is required"}), 400

    category = (data.get("category") or "").strip()
    sub_category = (data.get("sub_category") or "").strip()
    financial_year = (data.get("financial_year") or "").strip() or None

    if not category or not sub_category:
        return jsonify({"error": "category and sub_category are required"}), 400

    success = reclassify_file_manual(file_id, category, sub_category, financial_year, g.user_id)
    if not success:
        return jsonify({"error": "Failed to override classification"}), 500

    # ── Auto-move file to category folder ──
    moved_to_folder = None
    try:
        file_record = get_file_by_id_admin(file_id)
        if file_record:
            user_id = file_record["user_id"]
            folder_name = category  # e.g. "GST", "INCOME_TAX"

            # Check if user already has this category folder
            existing = get_folder_by_name(user_id, folder_name)
            if existing:
                target_folder_id = existing["id"]
            else:
                # Create the category folder for this user
                new_folder = create_folder(folder_name, user_id)
                target_folder_id = new_folder["id"]

            # Move file to the category folder
            if file_record["folder_id"] != target_folder_id:
                move_file_to_folder(file_id, target_folder_id)
                moved_to_folder = folder_name
    except Exception as e:
        print(f"[Classify] Auto-move failed for file {file_id}: {e}")

    return jsonify({
        "message": f"File reclassified as {category}/{sub_category}",
        "category": category,
        "sub_category": sub_category,
        "financial_year": financial_year,
        "moved_to_folder": moved_to_folder,
    }), 200


@classify_bp.route("/categories", methods=["GET"])
@require_auth
def list_categories():
    """Return all available categories and sub-categories."""
    categories = get_all_categories()
    # Add display names
    result = {}
    for cat, subs in categories.items():
        result[cat] = {
            "display_name": get_category_display_name(cat),
            "sub_categories": subs,
        }
    return jsonify({"categories": result}), 200


@classify_bp.route("/reclassify-all", methods=["POST"])
@require_auth
@require_admin
def reclassify_all_files():
    """
    Batch re-classify all existing files in the database.
    This processes each file through the classification engine and creates logs.
    """
    files = get_all_files_for_reclassification()

    classified = 0
    errors = 0

    for f in files:
        try:
            # Determine file path for content extraction
            file_path = None
            web_link = f.get("drive_web_link", "")
            if web_link.startswith("/api/files/serve/"):
                relative = web_link.replace("/api/files/serve/", "")
                candidate = os.path.join(LOCAL_STORAGE_DIR, relative)
                if os.path.isfile(candidate):
                    file_path = candidate

            client_name = f.get("user_name") or f.get("user_email", "Unknown")

            # Run classification
            result = classify_document(
                filename=f["file_name"],
                file_path=file_path,
                mime_type=f.get("file_type", ""),
                client_name=client_name,
                client_id=f["user_id"],
            )

            # Save classification log
            create_classification_log(f["id"], f["user_id"], result)

            # Update file record
            update_file_classification(
                file_id=f["id"],
                category=result["category"],
                sub_category=result["sub_category"],
                financial_year=result.get("financial_year"),
                confidence=result.get("confidence_score"),
            )

            classified += 1
        except Exception as e:
            print(f"[Classify] Error classifying file {f['id']} ({f['file_name']}): {e}")
            errors += 1

    return jsonify({
        "message": f"Batch reclassification complete",
        "total_files": len(files),
        "classified": classified,
        "errors": errors,
    }), 200


@classify_bp.route("/analyze", methods=["POST"])
@require_auth
@require_admin
def analyze_file():
    """
    Classify a single file by ID.
    Body: { "file_id": int }
    """
    data = request.get_json()
    if not data or not data.get("file_id"):
        return jsonify({"error": "file_id is required"}), 400

    file_id = data["file_id"]
    file_record = get_file_by_id_admin(file_id)
    if not file_record:
        return jsonify({"error": "File not found"}), 404

    # Determine file path for content extraction
    file_path = None
    web_link = file_record.get("drive_web_link", "")
    if web_link.startswith("/api/files/serve/"):
        relative = web_link.replace("/api/files/serve/", "")
        candidate = os.path.join(LOCAL_STORAGE_DIR, relative)
        if os.path.isfile(candidate):
            file_path = candidate

    # Get user info for client name
    from models import get_user_by_id
    user = get_user_by_id(file_record["user_id"])
    client_name = (user.get("name") if user else None) or (user.get("email") if user else "Unknown")

    # Run classification
    result = classify_document(
        filename=file_record["file_name"],
        file_path=file_path,
        mime_type=file_record.get("file_type", ""),
        client_name=client_name,
        client_id=file_record["user_id"],
    )

    # Save classification log
    log = create_classification_log(file_id, file_record["user_id"], result)

    # Update file record
    update_file_classification(
        file_id=file_id,
        category=result["category"],
        sub_category=result["sub_category"],
        financial_year=result.get("financial_year"),
        confidence=result.get("confidence_score"),
    )

    return jsonify({
        "classification": result,
        "log": log,
    }), 200
