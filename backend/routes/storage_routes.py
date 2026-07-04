"""
Storage routes — quota management, usage tracking, plan upgrades.
"""

from flask import Blueprint, request, jsonify, g

from middleware import require_auth, require_admin
from models import (
    get_storage_quota, get_all_storage_quotas, upgrade_storage,
    create_storage_quota, update_storage_used, create_notification,
)

storage_bp = Blueprint("storage", __name__)

# Plan definitions
STORAGE_PLANS = {
    "free":       {"name": "Free",       "quota_gb": 1024,  "quota_bytes": 1099511627776},
    "basic":      {"name": "Basic",      "quota_gb": 2048,  "quota_bytes": 2199023255552},
    "pro":        {"name": "Pro",        "quota_gb": 5120,  "quota_bytes": 5497558138880},
    "enterprise": {"name": "Enterprise", "quota_gb": 10240, "quota_bytes": 10995116277760},
}


# ═══════════════════════════════════════════════════════════
# CLIENT STORAGE
# ═══════════════════════════════════════════════════════════

@storage_bp.route("/api/storage/quota", methods=["GET"])
@require_auth
def my_storage():
    """Get current user's storage quota and usage."""
    quota = get_storage_quota(g.user_id)
    if not quota:
        # Auto-create if missing
        quota = create_storage_quota(g.user_id)

    # Recalculate actual usage
    update_storage_used(g.user_id)
    quota = get_storage_quota(g.user_id)

    return jsonify({"quota": quota, "plans": STORAGE_PLANS}), 200


# ═══════════════════════════════════════════════════════════
# ADMIN STORAGE MANAGEMENT
# ═══════════════════════════════════════════════════════════

@storage_bp.route("/api/admin/storage/quotas", methods=["GET"])
@require_auth
@require_admin
def list_quotas():
    """Get storage quotas for all users."""
    quotas = get_all_storage_quotas()
    return jsonify({"quotas": quotas, "plans": STORAGE_PLANS}), 200


@storage_bp.route("/api/admin/storage/user/<int:user_id>/upgrade", methods=["PUT"])
@require_auth
@require_admin
def upgrade_user_storage(user_id):
    """Upgrade a user's storage plan."""
    data = request.get_json()
    if not data or not data.get("plan"):
        return jsonify({"error": "plan is required"}), 400

    plan_name = data["plan"]
    if plan_name not in STORAGE_PLANS:
        return jsonify({"error": f"Invalid plan. Choose from: {', '.join(STORAGE_PLANS.keys())}"}), 400

    plan = STORAGE_PLANS[plan_name]
    success = upgrade_storage(user_id, plan_name, plan["quota_bytes"])

    if not success:
        # Maybe quota doesn't exist yet, create it
        create_storage_quota(user_id, plan["quota_bytes"], plan_name)
        success = True

    # Notify user
    try:
        create_notification(
            user_id=user_id,
            notif_type="storage_upgraded",
            title="Storage Plan Upgraded",
            message=f"Your storage has been upgraded to {plan['name']} ({plan['quota_gb']} GB).",
        )
    except Exception as e:
        print(f"[Notify] Failed to notify about storage upgrade: {e}")

    return jsonify({
        "message": f"Storage upgraded to {plan['name']} plan ({plan['quota_gb']} GB)",
        "plan": plan,
    }), 200
