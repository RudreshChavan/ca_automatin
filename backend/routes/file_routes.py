"""
File routes — upload, list, get, delete, serve local files.
"""

import os
import shutil
import mimetypes
from flask import Blueprint, request, jsonify, g, send_from_directory

from middleware import require_auth
from models import (
    get_folder_by_name, get_folder_by_id, get_files,
    get_file_by_id, create_file, delete_file as db_delete_file,
    create_folder, update_folder_drive_id,
    update_file_category, notify_admins,
    check_user_file_access,
    create_classification_log, update_file_classification,
)
from services import drive_service, file_service
from services.classify_service import classify_document
from config import Config

file_bp = Blueprint("files", __name__, url_prefix="/api/files")

# Local storage directory (used when Google Drive is not available)
LOCAL_STORAGE_DIR = os.path.join(os.path.dirname(__file__), "..", "local_storage")
os.makedirs(LOCAL_STORAGE_DIR, exist_ok=True)


def _ensure_folder_exists(user_id: int, folder_name: str) -> dict:
    """
    Get a folder by name for the user. If it doesn't exist, create it
    dynamically (in DB and optionally in Google Drive).
    This allows new categories like Software, Archives, Audio to be
    created on the fly when a file of that type is first uploaded.
    """
    folder = get_folder_by_name(user_id, folder_name)
    if folder:
        return folder

    # Folder doesn't exist — create it dynamically
    print(f"[Upload] Auto-creating new folder '{folder_name}' for user {user_id}")

    drive_folder_id = None
    if drive_service.is_available():
        # Try to find user's root Drive folder and create subfolder
        try:
            drive_folder_id = drive_service.create_folder(folder_name)
        except Exception as e:
            print(f"[Drive] Could not create Drive folder '{folder_name}': {e}")

    folder = create_folder(folder_name, user_id, drive_folder_id)
    return folder


@file_bp.route("/upload", methods=["POST"])
@require_auth
def upload_file():
    """
    Upload a file. Auto-organizes by type unless folder_id is provided.
    If the detected category folder doesn't exist, it is created automatically.
    Accepts multipart/form-data with:
        - file: the file
        - folder_id (optional): target folder ID
    """
    # ── ADMIN RESTRICTION ──
    if getattr(g, 'role', 'user') == 'admin':
        return jsonify({"error": "Admins cannot upload files."}), 403

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    uploaded = request.files["file"]
    if uploaded.filename == "":
        return jsonify({"error": "No file selected"}), 400

    # Read into a temp file
    filename = uploaded.filename
    mime_type = uploaded.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"

    # Check file size
    uploaded.seek(0, os.SEEK_END)
    file_size = uploaded.tell()
    uploaded.seek(0)

    if file_size > Config.MAX_FILE_SIZE_BYTES:
        return jsonify({"error": f"File exceeds maximum size of {Config.MAX_FILE_SIZE_MB}MB"}), 413

    # ── Resolve target folder ──
    folder_id = request.form.get("folder_id")
    target_folder = None

    if folder_id:
        # Manual folder selection
        target_folder = get_folder_by_id(int(folder_id), g.user_id)
        if not target_folder:
            return jsonify({"error": "Selected folder not found"}), 404
    else:
        # AUTO MODE: detect folder from CA keywords first, then file type
        ca_folder_name = file_service.detect_ca_folder(filename, mime_type)
        if ca_folder_name:
            folder_name = ca_folder_name
            print(f"[Upload] CA auto-categorized '{filename}' → folder '{folder_name}'")
        else:
            folder_name = file_service.detect_folder(mime_type, filename)
        # This will auto-create new folders (Software, Archives, Audio, etc.)
        target_folder = _ensure_folder_exists(g.user_id, folder_name)

    # ── Save to temp file for processing ──
    temp_dir = os.path.join(os.path.dirname(__file__), "..", "temp_uploads")
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, filename)

    try:
        uploaded.save(temp_path)

        # ── Upload to Google Drive OR save locally ──
        drive_file_id = None
        drive_web_link = None

        if drive_service.is_available():
            drive_folder_id = target_folder.get("drive_folder_id")
            drive_file_id, drive_web_link = drive_service.upload_file(
                temp_path, filename, mime_type, drive_folder_id
            )

        if not drive_file_id:
            # ── LOCAL STORAGE MODE (Fallback or Default) ──
            # Save file locally, organized by user_id/folder_name
            user_dir = os.path.join(LOCAL_STORAGE_DIR, str(g.user_id), target_folder["name"])
            os.makedirs(user_dir, exist_ok=True)

            # Handle duplicate filenames
            local_filename = filename
            local_path = os.path.join(user_dir, local_filename)
            counter = 1
            while os.path.exists(local_path):
                name, ext = os.path.splitext(filename)
                local_filename = f"{name}_{counter}{ext}"
                local_path = os.path.join(user_dir, local_filename)
                counter += 1

            shutil.copy2(temp_path, local_path)
            drive_web_link = f"/api/files/serve/{g.user_id}/{target_folder['name']}/{local_filename}"

        # ── Detect CA category from filename ──
        category = file_service.detect_category(filename, mime_type)

        # ── Save metadata to DB ──
        file_record = create_file(
            file_name=filename,
            file_type=mime_type,
            file_size=file_size,
            drive_file_id=drive_file_id or "",
            drive_web_link=drive_web_link or "",
            folder_id=target_folder["id"],
            user_id=g.user_id,
        )

        # ── Set category if detected (basic) ──
        if category and file_record.get("id"):
            update_file_category(file_record["id"], category)
            file_record["category"] = category

        # ── Run AI Classification Engine ──
        classification_result = None
        try:
            user_email = getattr(g, 'email', 'a client')
            user_name = getattr(g, 'name', None) or user_email

            # Determine local file path for content extraction
            classify_path = None
            if not drive_file_id and 'local_path' in locals():
                classify_path = local_path

            classification_result = classify_document(
                filename=filename,
                file_path=classify_path,
                mime_type=mime_type,
                client_name=user_name,
                client_id=g.user_id,
            )

            # Save classification log
            if file_record.get("id"):
                create_classification_log(file_record["id"], g.user_id, classification_result)
                update_file_classification(
                    file_id=file_record["id"],
                    category=classification_result["category"],
                    sub_category=classification_result["sub_category"],
                    financial_year=classification_result.get("financial_year"),
                    confidence=classification_result.get("confidence_score"),
                )
                file_record["category"] = classification_result["category"]
                file_record["sub_category"] = classification_result["sub_category"]
        except Exception as e:
            print(f"[Classify] Auto-classification failed for '{filename}': {e}")

        # ── Notify all admins about new upload ──
        try:
            user_email = getattr(g, 'email', 'a client')
            notify_admins(
                notif_type="file_uploaded",
                title="New File Uploaded",
                message=f"{user_email} uploaded '{filename}' to {target_folder['name']}",
                related_id=file_record.get("id"),
            )
        except Exception as e:
            print(f"[Notify] Failed to notify admins: {e}")

        return jsonify({
            "message": f"File uploaded to {target_folder['name']}",
            "file": file_record,
            "folder_name": target_folder["name"],
            "category": category,
            "classification": classification_result,
        }), 201

    finally:
        # Clean up temp file (local copy already saved separately)
        if os.path.exists(temp_path):
            os.remove(temp_path)


@file_bp.route("/serve/<int:user_id>/<path:filepath>", methods=["GET"])
@require_auth
def serve_local_file(user_id, filepath):
    """
    Serve a locally stored file.
    Path format: /api/files/serve/{user_id}/{folder_name}/{filename}
    Also allows access for users with active file shares.
    """
    # Regular users can only access their own files, shared files, or admins can access any.
    if getattr(g, 'role', 'user') != 'admin' and g.user_id != user_id:
        # Check if user has shared access to this file
        # We need the file_id from the filepath — look up by drive_web_link
        web_link = f"/api/files/serve/{user_id}/{filepath}"
        from database import get_connection
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM files WHERE drive_web_link = %s", (web_link,))
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        if row:
            permission = check_user_file_access(g.user_id, row[0])
            if not permission:
                return jsonify({"error": "Access denied"}), 403
            # View and edit permissions allow serving; download check is in download route
        else:
            return jsonify({"error": "Access denied"}), 403

    user_dir = os.path.join(LOCAL_STORAGE_DIR, str(user_id))
    full_path = os.path.join(user_dir, filepath)

    # Security: ensure the resolved path is within LOCAL_STORAGE_DIR
    real_base = os.path.realpath(LOCAL_STORAGE_DIR)
    real_path = os.path.realpath(full_path)
    if not real_path.startswith(real_base):
        return jsonify({"error": "Access denied"}), 403

    if not os.path.isfile(full_path):
        return jsonify({"error": "File not found"}), 404

    directory = os.path.dirname(full_path)
    filename = os.path.basename(full_path)
    return send_from_directory(directory, filename)


@file_bp.route("", methods=["GET"])
@require_auth
def list_files():
    """
    List files for the current user.
    Query params: folder_id, search
    """
    folder_id = request.args.get("folder_id", type=int)
    search = request.args.get("search", "").strip()
    status = request.args.get("status", "").strip()

    files = get_files(g.user_id, folder_id=folder_id, search=search or None, status=status or None)
    return jsonify({"files": files}), 200


@file_bp.route("/<int:file_id>", methods=["GET"])
@require_auth
def get_file(file_id):
    """Get a single file's metadata."""
    file = get_file_by_id(file_id, g.user_id)
    if not file:
        return jsonify({"error": "File not found"}), 404
    return jsonify({"file": file}), 200


@file_bp.route("/<int:file_id>", methods=["DELETE"])
@require_auth
def delete_file(file_id):
    """Delete a file from DB, Google Drive, and local storage."""
    file = get_file_by_id(file_id, g.user_id)
    if not file:
        return jsonify({"error": "File not found"}), 404

    # Delete from Google Drive
    if file.get("drive_file_id"):
        drive_service.delete_file(file["drive_file_id"])

    # Delete local file if it exists
    web_link = file.get("drive_web_link", "")
    if web_link.startswith("/api/files/serve/"):
        # Extract path from the URL
        relative_path = web_link.replace("/api/files/serve/", "")
        local_path = os.path.join(LOCAL_STORAGE_DIR, relative_path)
        if os.path.exists(local_path):
            os.remove(local_path)

    # Delete from DB
    db_delete_file(file_id, g.user_id)

    return jsonify({"message": "File deleted successfully"}), 200

# ══════════════════════════════════════════════════════════════
# INLINE FILE EDITOR ROUTES (ADMIN ONLY)
# ══════════════════════════════════════════════════════════════

@file_bp.route("/download/<int:file_id>", methods=["GET"])
@require_auth
def download_file(file_id):
    """
    Download the raw file. Useful for frontend editors to parse Blobs.
    Admins can access any file.
    """
    if getattr(g, 'role', 'user') != 'admin':
        return jsonify({"error": "Admin access required for editing workflows."}), 403

    # Need user_id to find the file correctly
    # Since admins can view any user's file, we need a way to look up the file globally
    # For now, we will query the DB directly to get the owner
    from database import get_connection
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM files WHERE id = %s", (file_id,))
    file_record = cursor.fetchone()
    conn.close()

    if not file_record:
        return jsonify({"error": "File not found"}), 404

    file_dict = {cursor.description[i][0]: value for i, value in enumerate(file_record)}
    web_link = file_dict.get("drive_web_link", "")

    if not web_link.startswith("/api/files/serve/"):
        return jsonify({"error": "File is not stored locally and cannot be edited inline."}), 400

    relative_path = web_link.replace("/api/files/serve/", "")
    full_path = os.path.join(LOCAL_STORAGE_DIR, relative_path)

    if not os.path.exists(full_path):
        return jsonify({"error": "Local file not found"}), 404

    # ── AUTO CONVERT .doc TO .docx ──
    file_name_lower = file_dict.get("file_name", "").lower()
    if file_name_lower.endswith(".doc"):
        # Auto-conversion via Aspose.Words has been disabled to prevent server crashes.
        # Legacy .doc files will be served as-is.
        pass

    directory = os.path.dirname(full_path)
    filename = os.path.basename(full_path)
    return send_from_directory(directory, filename, as_attachment=True)


@file_bp.route("/edit/<int:file_id>", methods=["PUT"])
@require_auth
def edit_local_file(file_id):
    """
    Overwrite a local file with new content from the frontend editor.
    Admin only. Supports text or Blob/FormData uploads.
    """
    if getattr(g, 'role', 'user') != 'admin':
        return jsonify({"error": "Admin access required"}), 403

    from database import get_connection
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM files WHERE id = %s", (file_id,))
    file_record = cursor.fetchone()
    
    if not file_record:
        conn.close()
        return jsonify({"error": "File not found"}), 404
        
    file_dict = {cursor.description[i][0]: value for i, value in enumerate(file_record)}
    web_link = file_dict.get("drive_web_link", "")

    if not web_link.startswith("/api/files/serve/"):
        conn.close()
        return jsonify({"error": "Cannot edit files stored in external Google Drive."}), 400

    relative_path = web_link.replace("/api/files/serve/", "")
    full_path = os.path.join(LOCAL_STORAGE_DIR, relative_path)

    if not os.path.exists(full_path):
        conn.close()
        return jsonify({"error": "Local file not found"}), 404

    # Save the new content
    try:
        if "file" in request.files:
            # Handle Blob/Binary upload (e.g. from SheetJS export)
            uploaded_file = request.files["file"]
            uploaded_file.save(full_path)
        else:
            # Handle Raw Text upload
            data = request.get_json()
            if not data or "content" not in data:
                return jsonify({"error": "No content provided"}), 400
                
            new_content = data["content"]
            
            # If the file is .docx, generate a clean .docx file from the HTML content
            if full_path.lower().endswith('.docx'):
                import docx
                from htmldocx import HtmlToDocx
                doc = docx.Document()
                new_parser = HtmlToDocx()
                new_parser.add_html_to_document(new_content, doc)
                os.makedirs(os.path.dirname(full_path), exist_ok=True)
                doc.save(full_path)
            else:
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write(new_content)

        # Update file size in DB
        new_size = os.path.getsize(full_path)
        cursor.execute("UPDATE files SET file_size = %s WHERE id = %s", (new_size, file_id))
        conn.commit()
        conn.close()

        return jsonify({"message": "File updated successfully", "new_size": new_size}), 200

    except Exception as e:
        conn.close()
        return jsonify({"error": f"Failed to save file: {str(e)}"}), 500


@file_bp.route("/archive-contents/<int:file_id>", methods=["GET"])
@require_auth
def list_archive_contents(file_id):
    """
    List the contents of a ZIP archive without extracting.
    Admin only. Returns a flat list of entries with name, size, is_dir.
    """
    if getattr(g, 'role', 'user') != 'admin':
        return jsonify({"error": "Admin access required"}), 403

    from database import get_connection
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM files WHERE id = %s", (file_id,))
    file_record = cursor.fetchone()
    conn.close()

    if not file_record:
        return jsonify({"error": "File not found"}), 404

    file_dict = {cursor.description[i][0]: value for i, value in enumerate(file_record)}
    web_link = file_dict.get("drive_web_link", "")

    if not web_link.startswith("/api/files/serve/"):
        return jsonify({"error": "File is not stored locally"}), 400

    relative_path = web_link.replace("/api/files/serve/", "")
    full_path = os.path.join(LOCAL_STORAGE_DIR, relative_path)

    if not os.path.exists(full_path):
        return jsonify({"error": "Local file not found"}), 404

    file_name_lower = file_dict.get("file_name", "").lower()

    # ZIP files
    if file_name_lower.endswith(".zip"):
        import zipfile
        try:
            with zipfile.ZipFile(full_path, 'r') as zf:
                entries = []
                for info in zf.infolist():
                    entries.append({
                        "name": info.filename,
                        "size": info.file_size,
                        "compressed_size": info.compress_size,
                        "is_dir": info.is_dir(),
                    })
                return jsonify({
                    "archive_type": "zip",
                    "total_entries": len(entries),
                    "entries": entries,
                }), 200
        except zipfile.BadZipFile:
            return jsonify({"error": "File is not a valid ZIP archive"}), 400

    # 7z files (if py7zr available)
    elif file_name_lower.endswith(".7z"):
        try:
            import py7zr
            with py7zr.SevenZipFile(full_path, 'r') as szf:
                entries = []
                for name, bio in szf.getnames():
                    entries.append({
                        "name": name,
                        "size": 0,
                        "compressed_size": 0,
                        "is_dir": name.endswith('/'),
                    })
                return jsonify({
                    "archive_type": "7z",
                    "total_entries": len(entries),
                    "entries": entries,
                }), 200
        except ImportError:
            return jsonify({"error": "7z support not available (py7zr not installed)"}), 400
        except Exception as e:
            return jsonify({"error": f"Failed to read 7z file: {str(e)}"}), 400

    else:
        return jsonify({"error": "Unsupported archive format. Only ZIP is supported."}), 400

