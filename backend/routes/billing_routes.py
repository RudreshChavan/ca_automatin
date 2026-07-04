"""
Billing routes — service charges, client billing, revenue tracking.
Admin routes for CA billing dashboard; client route for viewing bills.
"""

from flask import Blueprint, request, jsonify, g

from middleware import require_auth, require_admin
from models import (
    create_billing_service, get_user_billing, get_billing_overview,
    get_monthly_revenue, update_billing_status,
    get_payment_summary, create_notification,
)

billing_bp = Blueprint("billing", __name__)


# ═══════════════════════════════════════════════════════════
# ADMIN BILLING MANAGEMENT
# ═══════════════════════════════════════════════════════════

@billing_bp.route("/api/admin/billing/service", methods=["POST"])
@require_auth
@require_admin
def add_service_charge():
    """Add a service charge for a client."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body is required"}), 400

    user_id = data.get("user_id")
    service_name = (data.get("service_name") or "").strip()
    amount = data.get("amount")

    if not user_id or not service_name or not amount:
        return jsonify({"error": "user_id, service_name, and amount are required"}), 400

    try:
        amount = float(amount)
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid amount"}), 400

    service = create_billing_service(
        user_id=user_id,
        service_name=service_name,
        amount=amount,
        billing_period=(data.get("billing_period") or "").strip() or None,
        notes=(data.get("notes") or "").strip() or None,
    )

    # Notify client
    try:
        create_notification(
            user_id=user_id,
            notif_type="billing_charge",
            title="New Service Charge",
            message=f"A charge of ₹{amount:,.2f} for '{service_name}' has been added to your billing.",
            related_id=service["id"],
        )
    except Exception as e:
        print(f"[Notify] Failed to notify client about billing: {e}")

    return jsonify({"message": "Service charge added", "service": service}), 201


@billing_bp.route("/api/admin/billing/overview", methods=["GET"])
@require_auth
@require_admin
def billing_overview():
    """Get client-wise billing overview."""
    overview = get_billing_overview()
    return jsonify({"overview": overview}), 200


@billing_bp.route("/api/admin/billing/revenue", methods=["GET"])
@require_auth
@require_admin
def monthly_revenue():
    """Get monthly revenue tracking."""
    revenue = get_monthly_revenue()
    return jsonify({"revenue": revenue}), 200


@billing_bp.route("/api/admin/billing/user/<int:user_id>", methods=["GET"])
@require_auth
@require_admin
def admin_user_billing(user_id):
    """Get billing details for a specific client."""
    billing = get_user_billing(user_id)
    return jsonify({"billing": billing}), 200


@billing_bp.route("/api/admin/billing/service/<int:billing_id>/status", methods=["PUT"])
@require_auth
@require_admin
def change_billing_status(billing_id):
    """Update billing service status (pending → paid, etc.)."""
    data = request.get_json()
    if not data or not data.get("status"):
        return jsonify({"error": "status is required"}), 400

    status = data["status"]
    if status not in ("pending", "paid", "cancelled"):
        return jsonify({"error": "Invalid status"}), 400

    success = update_billing_status(
        billing_id=billing_id,
        status=status,
        payment_id=data.get("payment_id"),
    )

    if not success:
        return jsonify({"error": "Billing service not found"}), 404

    return jsonify({"message": f"Billing status updated to {status}"}), 200


@billing_bp.route("/api/admin/billing-dashboard", methods=["GET"])
@require_auth
@require_admin
def billing_dashboard():
    """Aggregate billing dashboard data."""
    overview = get_billing_overview()
    revenue = get_monthly_revenue()
    payment_summary = get_payment_summary()

    # Calculate totals
    total_billed = sum(c["total_billed"] for c in overview)
    total_collected = sum(c["total_paid"] for c in overview)
    total_outstanding = sum(c["total_pending"] for c in overview)

    return jsonify({
        "total_billed": total_billed,
        "total_collected": total_collected,
        "total_outstanding": total_outstanding,
        "this_month_received": payment_summary["this_month"],
        "client_overview": overview,
        "monthly_revenue": revenue,
        "payment_summary": payment_summary,
    }), 200


# ═══════════════════════════════════════════════════════════
# CLIENT BILLING VIEW
# ═══════════════════════════════════════════════════════════

@billing_bp.route("/api/billing/my", methods=["GET"])
@require_auth
def my_billing():
    """Get current user's billing services."""
    billing = get_user_billing(g.user_id)
    return jsonify({"billing": billing}), 200
