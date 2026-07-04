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

router.get("/fetch/min", [validateApiToken], async (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({
      status: "error",
      success: false,
      message: "date required. Example: 21-11-2025",
    });
  }

  const dateMatch = date.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!dateMatch) {
    return res.status(400).json({
      status: "error",
      success: false,
      message: "Invalid date format (DD-MM-YYYY)",
    });
  }

  const reportDate = moment(date, "DD-MM-YYYY").format("YYYY-MM-DD");

  try {
    const rows = await invtDB.query(
      `SELECT *, rm_location.insert_date, cost_center.cost_center_name, cost_center.cost_center_short_name 
       FROM rm_location 
       LEFT JOIN components ON rm_location.components_id = components.component_key 
       LEFT JOIN units ON components.c_uom = units.units_id 
       LEFT JOIN location_main ON rm_location.loc_in = location_main.location_key 
       LEFT JOIN admin_login ON rm_location.insert_by = admin_login.CustID 
       LEFT JOIN cost_center ON cost_center.cost_center_key = rm_location.rm_loc_cost_center 
       WHERE components.c_type IN ('R', 'S') 
       AND components.c_is_enabled = 'Y' 
       AND DATE_FORMAT(rm_location.insert_date,'%Y-%m-%d') = :date 
       AND rm_location.trans_type = 'INWARD' 
       AND rm_location.in_module != 'PART-CONV' 
       ORDER BY rm_location.insert_date DESC`,
      {
        replacements: { date: reportDate },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (!rows.length) {
      return res.json({
        status: "error",
        success: false,
        message: "No data found",
      });
    }

    const txnIds = [...new Set(rows.map((r) => r.in_transaction_id).filter(Boolean))];
    const vendorIds = [...new Set(rows.map((r) => r.in_vendor_name).filter(v => v && v !== "--"))];
    const poIds = [...new Set(rows.map((r) => r.in_po_transaction_id).filter(p => p && p !== "--"))];

    let invoiceSet = new Set();
    if (txnIds.length) {
      const invoices = await invtDB.query(
        `SELECT min_min_id FROM ims_min_invoices WHERE min_min_id IN (:txnIds)`,
        { replacements: { txnIds }, type: invtDB.QueryTypes.SELECT }
      );
      invoiceSet = new Set(invoices.map((i) => i.min_min_id));
    }

    let vendorMap = {};
    if (vendorIds.length) {
      const vendors = await invtDB.query(
        `SELECT ven_register_id, ven_name 
         FROM ven_basic_detail 
         WHERE ven_register_id IN (:vendorIds)`,
        { replacements: { vendorIds }, type: invtDB.QueryTypes.SELECT }
      );

      vendors.forEach((v) => (vendorMap[v.ven_register_id] = v.ven_name));
    }

    let poMap = {};
    if (poIds.length) {
      const poProjects = await invtDB.query(
        `SELECT po_transaction, po_project_name 
         FROM po_purchase_req 
         WHERE po_transaction IN (:poIds)`,
        { replacements: { poIds }, type: invtDB.QueryTypes.SELECT }
      );

      poProjects.forEach((p) => (poMap[p.po_transaction] = p.po_project_name));
    }

    const data = rows.map((r) => {
      const inQty = Number(r.qty) + Number(r.other_qty);

      let vendorType = "N/A";
      if (r.vendor_type === "v01") vendorType = "Vendor";
      else if (r.vendor_type === "j01") vendorType = "JWI";
      else if (r.vendor_type === "s01") vendorType = "SortIn";
      else if (r.vendor_type === "r01") vendorType = "RejIn";
      else if (r.vendor_type === "p01") vendorType = "ProdReturn";

      const costCenter =
        r.rm_loc_cost_center === "--"
          ? "N/A"
          : r.cost_center_name
            ? `${r.cost_center_name} (${r.cost_center_short_name})`
            : "N/A";

      return {
        inDate: moment(r.insert_date).format("DD-MM-YYYY HH:mm:ss"),
        docDate: r.in_wo_invoice_date
          ? moment(r.in_wo_invoice_date).format("DD-MM-YYYY")
          : "N/A",
        componet: decode(r.c_name),
        partCode: r.c_part_no,
        newPart: r.c_new_part_no,
        hsnCode: r.in_hsn_code && r.in_hsn_code !== "--" ? r.in_hsn_code : "--",
        vendorType,
        inLocation: r.loc_name,
        rate: r.in_po_rate,
        currency:
          r.currency_type === "--" ||
            r.currency_type === "" ||
            r.currency_type === "364907247"
            ? "INR"
            : "USD",
        qty: inQty,
        uom: r.units_name,
        vendorName: vendorMap[r.in_vendor_name] || "N/A",
        poNumber: r.in_po_transaction_id || "N/A",
        invNumber:
          r.in_po_invoice_id !== "--"
            ? r.in_po_invoice_id
            : r.in_invoice_id || "N/A",
        transactionID: r.in_transaction_id,
        issueBy: r.user_name,
        remark: r.any_remark || "--",
        project: poMap[r.in_po_transaction_id] || "N/A",
        cc: costCenter,
        invoiceStatus: invoiceSet.has(r.in_transaction_id),
        mst_mfgCode: r.manufacturing_code,
        mnl_mfgCode: r.manual_mfg_code,
      };
    });

    return res.json({
      status: "success",
      success: true,
      data,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "error",
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
