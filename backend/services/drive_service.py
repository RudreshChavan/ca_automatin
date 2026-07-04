"""
Google Drive API service
DISABLED: The platform now strictly uses Local Storage for file management.
"""

def is_available() -> bool:
    return False

def create_folder(name: str, parent_id: str = None) -> str:
    return None

def upload_file(filepath: str, filename: str, mime_type: str, parent_folder_id: str = None) -> tuple:
    return None, None

def delete_file(drive_file_id: str) -> bool:
    return False

def grant_edit_access(drive_file_id: str, email: str) -> bool:
    return False
