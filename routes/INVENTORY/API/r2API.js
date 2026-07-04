const express = require("express");
const router = express.Router();

const { encode, decode } = require("html-entities");

let { invtDB, otherDB } = require("../../../config/db/connection");

const validateApiToken = async (req, res, next) => {
    const authHeader = req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            code: 401,
            message: "No token provided",
            status: "error",
        });
    }

    const token = authHeader.replace("Bearer ", "");
    try {
        const currentTime = moment.tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
        const tokenRecord = await otherDB.query(
            `SELECT *, 
                  expires_at AS expires_at_raw 
           FROM tbl_api_tokens 
           WHERE token = :token 
             AND expires_at > :currentTime`,
            {
                replacements: { token, currentTime },
                type: otherDB.QueryTypes.SELECT,
            }
        );

        if (!tokenRecord.length) {
            return res.status(401).json({
                code: 401,
                message: "Invalid OR the token has been expired",
                status: "error",
            });
        }

        req.client_code = tokenRecord[0].client_code;
        next();
    } catch (error) {
        console.error("Error validating API token:", error);
        return res.status(401).json({
            code: 401,
            message: "Unauthorized Access, CASE SENSITIVE",
            status: "error",
        });
    }
};

router.get("/fetch/po", [validateApiToken], async (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({
      status: "error",
      success: false,
      message: "date required. Example: 21-11-2025 OR 01-01-2024 - 31-01-2024",
    });
  }

  let fromdate, todate;
  const dates = date.match(/\d{2}-\d{2}-\d{4}/g);

  if (!dates || dates.length < 1) {
    return res.status(400).json({
      status: "error",
      success: false,
      message: "Invalid date format",
    });
  }

  const fromMoment = moment(dates[0], "DD-MM-YYYY", true);
  const toMoment = dates[1]
    ? moment(dates[1], "DD-MM-YYYY", true)
    : fromMoment.clone();

  if (!fromMoment.isValid() || !toMoment.isValid()) {
    return res.status(400).json({
      status: "error",
      success: false,
      message: "Invalid date value",
    });
  }

  // 🔴 MAX 14 DAYS CHECK
  const diffDays = toMoment.diff(fromMoment, "days");

  if (diffDays < 0) {
    return res.status(400).json({
      status: "error",
      success: false,
      message: "To date cannot be before From date",
    });
  }

  if (diffDays > 13) {
    return res.status(400).json({
      status: "error",
      code: 400,
      message: "Maximum allowed date range is 14 days",
    });
  }

  fromdate = fromMoment.format("YYYY-MM-DD");
  todate = toMoment.format("YYYY-MM-DD");

  try {
    // Pending PO requests
    const rows = await invtDB.query(
      `SELECT 
          p.*, 
          b.branch_name,
          u.units_name,
          c.c_name,
          c.c_part_no,
          c.c_new_part_no,
          COALESCE(SUM(p.po_order_qty),0) totalReq_Qty,
          COALESCE(SUM(p.po_inward_qty),0) Inward,
          (SELECT user_name FROM admin_login WHERE CustID = p.po_raise_by) request_by,
          (SELECT user_name FROM admin_login WHERE CustID = p.po_approve_by) approved_by
       FROM po_purchase_req p
       LEFT JOIN components c ON p.po_part_no = c.component_key
       LEFT JOIN units u ON u.units_id = c.c_uom
       LEFT JOIN branches b ON b.branch_code = p.company_branch
       WHERE p.po_status IN ('A')
       AND DATE(p.po_full_date) BETWEEN :fromdate AND :todate
       GROUP BY p.po_transaction
       ORDER BY p.ID DESC`,
      {
        replacements: { fromdate, todate },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (rows.length == 0) {
      return res.json({
        status: "error",
        success: false,
        message: "No data found",
      });
    }

    const data = rows
      .filter((r) => r.totalReq_Qty > r.Inward)
      .map((r) => ({
        branch: r.branch_name,
        component_name: decode(r.c_name),
        unit_name: r.units_name,
        part_no: r.c_part_no,
        new_partno: r.c_new_part_no,
        reg_date: moment(r.po_full_date)
          .tz("Asia/Kolkata")
          .format("DD-MM-YYYY"),
        ordered_qty: r.po_order_qty,
        ordered_pending: r.po_pending_qty,
        ordered_inward: r.po_inward_qty,
        vendor_name: r.po_vendor_name,
        vendor_code: r.po_vendor_reg_id,
        due_date: r.po_duedate || "--",
        po_order_id: r.po_transaction,
        po_rate: r.po_order_rate,
        po_project: r.po_project_name,
        po_status: r.po_status,
        po_raise_by: r.request_by,
        po_approve_by: r.approved_by,
      }));

    return res.json({
      status: "success",
      success: true,
      data: data,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "error",
      success: false,
      message: "an internal error occured, Please try after some time.",
    });
  }
});

module.exports = router;
