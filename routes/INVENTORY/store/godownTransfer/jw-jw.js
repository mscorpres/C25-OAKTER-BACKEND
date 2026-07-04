const express = require("express");
const router = express.Router();


let { invtDB } = require("../../../../config/db/connection");
const auth = require("../../../../middleware/auth");
const Validator = require("validatorjs");

async function getJwStockByComponentKeys({ jw, vendor, componentKeys }) {
  const stockRows = await invtDB.query(
    `
    SELECT
      c_name,
      component_key,
      c_part_no,
      units_name,

      COALESCE(SUM(CASE
        WHEN trans_mode = 'default'
         AND trans_type = 'JOBWORK'
         AND vendor_type = 'j01'
         AND jw_transaction_id = :jw
        THEN qty + other_qty ELSE 0 END), 0) AS total_issued_rm,

      COALESCE(SUM(CASE
        WHEN trans_mode = 'return'
         AND trans_type = 'INWARD'
         AND in_vendor_name = :vendor
         AND in_jw_transaction_id = :jw
        THEN qty + other_qty ELSE 0 END), 0) AS total_returned_rm,

      COALESCE(SUM(CASE
        WHEN trans_mode = 'default'
         AND trans_type = 'SFG-CONSUMPTION'
         AND jw_transaction_id = :jw
        THEN qty + other_qty ELSE 0 END), 0) AS total_consumption,

      COALESCE(SUM(CASE
        WHEN trans_mode = 'default'
         AND trans_type = 'TRANSFER'
         AND in_vendor_name = :vendor
         AND jw_transaction_id = :jw
        THEN qty + other_qty ELSE 0 END), 0) AS total_transferred

    FROM rm_location
    LEFT JOIN components ON rm_location.components_id = components.component_key
    LEFT JOIN units ON components.c_uom = units.units_id
    WHERE components_id IN (:componentKeys)
    GROUP BY components_id
    `,
    {
      replacements: { jw, vendor, componentKeys },
      type: invtDB.QueryTypes.SELECT,
    }
  );

  return stockRows.map((r) => {
    const consumption = Math.min(
      r.total_consumption,
      r.total_issued_rm - r.total_returned_rm
    );

    const pending =
      r.total_issued_rm -
      consumption -
      r.total_returned_rm -
      r.total_transferred;

    return {
      component_key: r.component_key,
      component_name: r.c_name,
      part_no: r.c_part_no,
      uom: r.units_name,
      pending_with_jw: Number(pending.toFixed(2)),
    };
  });
}

// Retrive all the JW PO associated with a JW Vendor
router.get("/jw-jw/po/:vendor", [auth.isAuthorized], async (req, res) => {
  let { vendor } = req.params;
  let { search, limit } = req.query;

  let validation = new Validator(req.params, {
    vendor: "required",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      message: helper.firstErrorValidatorjs(validation),
      status: "error",
    });
  }

  // ✅ DEFAULT LIMIT = 15
  limit = limit ? Number(limit) : 15;

  // ✅ SEARCH CONDITION (MIN 3 CHARACTERS)
  let searchCondition = "";
  let replacements = { vendor, limit };

  if (search && search.length >= 3) {
    searchCondition = "AND jw_jw_transaction LIKE :search";
    replacements.search = `%${search}%`;
  }

  try {
    const result = await invtDB.query(
      `SELECT jw_jw_transaction, jw_po_full_date 
       FROM jw_purchase_req 
       WHERE jw_po_vendor_reg_id = :vendor 
       AND jw_po_status = 'A'
       ${searchCondition}
       ORDER BY jw_po_full_date DESC
       LIMIT :limit`,
      {
        replacements,
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let final = result.map((row) => ({
      jobworkID: row.jw_jw_transaction,
      createdDate: row.jw_po_full_date,
    }));

    return res.json({
      success: true,
      status: "success",
      data: final,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Get available stock in specific JW location
router.get("/jw-jw/stock", [auth.isAuthorized], async (req, res) => {
  try {
    const { part, jw, vendor } = req.query;

    if (!jw || !vendor || !part) {
      return res.json({
        success: false,
        status: "error",
        message: "some required parameters are missing",
      });
    }

    const partList = (Array.isArray(part) ? part : [part]).map((p) => p.trim());

    const likeClauses = partList
      .map((_, i) => `c_part_no LIKE :p${i}`)
      .join(" OR ");
    const replacements = { jw };
    partList.forEach((p, i) => {
      replacements[`p${i}`] = p;
    });

    const found = await invtDB.query(
      `SELECT component_key, c_part_no
         FROM components
        WHERE ${likeClauses}`,
      {
        replacements,
        type: invtDB.QueryTypes.SELECT,
      }
    );

    const unknown = partList.filter(
      (p) => !found.some((f) => f.c_part_no.toLowerCase() === p.toLowerCase())
    );
    if (unknown.length) {
      return res.json({
        success: false,
        status: "error",
        message: `Invalid part(s): ${unknown.join(", ")}`,
      });
    }

    const componentKeys = found.map((f) => f.component_key);
    const data = await getJwStockByComponentKeys({
      jw,
      vendor,
      componentKeys,
    });

    return res.json({
      success: true,
      status: "success",
      data,
    });
  } catch (err) {
    console.error(err);
    return helper.errorResponse(res, err);
  }
});

// Initiate transfer froWm JW to another JW location
router.post("/jw-jw/transfer", [auth.isAuthorized], async (req, res) => {
  const { vendor, jw, component, from, to, qty, remark } = req.body;

  const validation = new Validator(req.body, {
    component: "required|array",
    qty: "required|array",
    from: "required",
    to: "required",
    vendor: "required",
    jw: "required",
    remark: "string",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      status: "error",
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  if (component.length !== qty.length) {
    return res.json({
      success: false,
      status: "error",
      message: "Component and quantity count mismatch",
    });
  }

  if (from === to) {
    return res.json({
      success: false,
      status: "error",
      message: "From and To locations cannot be same",
    });
  }

  if (remark && remark.trim().length > 100) {
    return res.json({
      success: false,
      status: "error",
      message: "Remarks should not exceed 100 characters",
    });
  }

  for (let i = 0; i < qty.length; i++) {
    const q = Number(qty[i]);
    if (isNaN(q) || q <= 0) {
      return res.json({
        success: false,
        status: "error",
        message: `Invalid quantity at index ${i + 1}`,
      });
    }
  }

  const seen = new Set();
  for (let i = 0; i < component.length; i++) {
    if (seen.has(component[i])) {
      return res.json({
        success: false,
        status: "error",
        message: `Duplicate component found at index ${i + 1}`,
      });
    }
    seen.add(component[i]);
  }

  const t = await invtDB.transaction();

  try {
    const stockData = await getJwStockByComponentKeys({
      jw,
      vendor,
      componentKeys: component,
      transaction: t,
    });

    for (let i = 0; i < component.length; i++) {
      const stock = stockData.find((s) => s.component_key === component[i]);

      if (!stock) {
        throw new Error(`Invalid component at index ${i + 1}`);
      }

      if (Number(qty[i]) > stock.pending_with_jw) {
        throw new Error(
          `Insufficient stock for ${stock.part_no} (index ${i + 1})`
        );
      }
    }

    const stmt = await invtDB.query(
      "SELECT * FROM ims_numbering WHERE for_number='GODOWN_TRANSFER' FOR UPDATE",
      { type: invtDB.QueryTypes.SELECT, transaction: t }
    );

    let transactionID;
    let suffix;

    if (stmt.length) {
      suffix = Number(stmt[0].suffix) + 1;
      suffix = suffix.toString().padStart(stmt[0].number_length_limit, "0");

      transactionID = `${stmt[0].prefix}/${stmt[0].session}/${suffix}`;

      await invtDB.query(
        "UPDATE ims_numbering SET suffix=:suffix WHERE id=:id",
        {
          replacements: { suffix, id: stmt[0].id },
          transaction: t,
        }
      );
    } else {
      const y = new Date().getFullYear() % 100;
      transactionID = `IGA/${y}-${y + 1}/0001`;
    }

    /* ---------------- BULK INSERT ---------------- */
    const insertDate = moment().format("YYYY-MM-DD HH:mm:ss");

    const bulkValues = component.map((comp, i) => [
      req.branch,
      "IN-TRN",
      "default",
      "TRANSFER",
      comp,
      from,
      to,
      qty[i],
      vendor,
      jw,
      remark || null,
      insertDate,
      req.logedINUser,
      transactionID,
    ]);

    await invtDB.query(
      `
      INSERT INTO rm_location (
        company_branch,
        in_module,
        trans_mode,
        trans_type,
        components_id,
        loc_out,
        loc_in,
        qty,
        in_vendor_name,
        jw_transaction_id,
        any_remark,
        insert_date,
        insert_by,
        transfer_transaction_id
      ) VALUES ?
      `,
      {
        replacements: [bulkValues],
        transaction: t,
      }
    );

    await t.commit();

    return res.json({
      success: true,
      status: "success",
      message: "JW to JW transfer completed successfully",
      data: {
        transactionID: transactionID,
      },
    });
  } catch (err) {
    await t.rollback();
    console.error(err);
    return helper.errorResponse(res, err);
  }
});

// Retrive all the JW PO associated with a JW Vendor
router.get("/jw-jw/tranfer/view", [auth.isAuthorized], async (req, res) => {
  let { search, limit, vendor, from, to } = req.query;

  limit = limit ? Number(limit) : 15;

  let where = "WHERE 1=1";
  let replacements = { limit };

  /* ---------------- SEARCH BY TRANSACTION ---------------- */
  if (search && search.length >= 3) {
    where += " AND rm_location.jw_jw_transaction LIKE :search";
    replacements.search = `%${search}%`;
  }

  /* ---------------- FILTER BY VENDOR CODE ---------------- */
  if (vendor) {
    where += " AND rm_location.in_vendor_name = :vendor_code";
    replacements.vendor_code = vendor;
  }

  /* ---------------- DATE RANGE FILTER ---------------- */
  if (from && to) {
    where +=
      " AND DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') BETWEEN :from_date AND :to_date";
    replacements.from_date = from;
    replacements.to_date = to;
  } else if (from) {
    where +=
      " AND DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') >= :from_date";
    replacements.from_date = from;
  } else if (to) {
    where +=
      " AND DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') <= :to_date";
    replacements.to_date = to;
  }

  try {
    const stmt = await invtDB.query(
      `
        SELECT * FROM rm_location LEFT JOIN components ON rm_location.components_id = components.component_key
        LEFT JOIN units ON components.c_uom = units.units_id LEFT JOIN admin_login ON rm_location.insert_by = admin_login.CustID LEFT JOIN location_main ON rm_location.loc_in = location_main.location_key ${where} ORDER BY rm_location.ID DESC LIMIT :limit
        `,
      {
        replacements,
        type: invtDB.QueryTypes.SELECT,
      }
    );

    const result = [];

    for (let i = 0; i < stmt.length; i++) {
      const item = stmt[i];
      result.push({
        txnDate: moment(item.insert_date)
          .tz("Asia/Kolkata")
          .format("DD-MM-YYYY"),
        partCode: item.part_no,
        partName: item.c_name,
        uom: item.units_name,
        outLocation: item.loc_out,
        inLocation: item.loc_in,
        qty: item.qty,
        transactionID: item.transfer_transaction_id,
        by: item.user_name,
      });
    }

    return res.json({
      success: true,
      status: "success",
      data: result,
    });
  } catch (err) {
    console.error(err);
    return helper.errorResponse(res, err);
  }
});

module.exports = router;
