const express = require("express");
const router = express.Router();

let { invtDB } = require("../../../config/db/connection");
const auth = require("../../../middleware/auth");
const Validator = require("validatorjs");

const CANCELLATION_APPROVER_EMAIL = "aman.mandal@mscorpres.in";
const { decode } = require("html-entities");
const newAvgRate = require("../../../helper/utils/newAvgRate");

const VENDOR_TYPES = { v01: "Vendor", j01: "JWI", s01: "SortIn", r01: "RejIn", p01: "ProdIn" };

async function getLocationName(locationKey) {
  if (!locationKey || locationKey === "--") return "--";
  try {
    const r = await invtDB.query(
      "SELECT loc_name FROM location_main WHERE location_key = :k LIMIT 1",
      { replacements: { k: locationKey }, type: invtDB.QueryTypes.SELECT }
    );
    return r.length ? decode(r[0].loc_name) : "--";
  } catch { return "--"; }
}

async function getVendorDetails(vendorId) {
  if (!vendorId || vendorId === "--") return { name: "--", code: "--" };
  try {
    const r = await invtDB.query(
      "SELECT ven_name, ven_register_id FROM ven_basic_detail WHERE ven_register_id = :v LIMIT 1",
      { replacements: { v: vendorId }, type: invtDB.QueryTypes.SELECT }
    );
    return r.length ? { name: r[0].ven_name, code: r[0].ven_register_id } : { name: "--", code: "--" };
  } catch { return { name: "--", code: "--" }; }
}

function getTransactionDetails(item) {
  const type = item.trans_type;
  if (type === "INWARD") return { mode: "MIN", label: "INWARD", qty_in: item.qty, qty_out: 0, transaction_id: item.in_transaction_id !== "--" ? item.in_transaction_id : (item.transfer_transaction_id ?? "--") };
  if (type === "ISSUE") return { mode: "ISSUE", label: "ISSUE", qty_in: 0, qty_out: item.qty, transaction_id: item.out_transaction_id ?? "NA" };
  if (type === "CONSUMPTION" && item.in_module === "--") return { mode: "CONSUMP", label: "CONSUMPTION", qty_in: 0, qty_out: item.qty, transaction_id: item.mfg_ppr_trans_id_2 !== "--" ? item.mfg_ppr_trans_id_2 : (item.jw_transaction_id ?? "--") };
  if (type === "CONSUMPTION" && item.in_module === "PART-CONV") return { mode: "CONVRSN", label: "CONVERSION", qty_in: 0, qty_out: item.qty, transaction_id: item.out_transaction_id !== "--" ? item.out_transaction_id : (item.transfer_transaction_id ?? "--") };
  if (type === "SFG-CONSUMPTION") return { mode: "CONSUMP", label: "CONSUMPTION", qty_in: 0, qty_out: item.qty, transaction_id: item.jw_transaction_id ?? "NA" };
  if (type === "JOBWORK") return { mode: "JOBWORK", label: "JOBWORK", qty_in: item.qty, qty_out: item.qty, transaction_id: item.jw_transaction_id ?? "NA" };
  if (type === "TRANSFER") return { mode: "TRANSFER", label: "TRANSFER", qty_in: item.qty, qty_out: item.qty, transaction_id: item.transfer_transaction_id ?? "--" };
  if (type === "REJECTION") return { mode: "REJECTION", label: "REJECTION", qty_in: 0, qty_out: item.qty, transaction_id: item.rej_transaction_id !== "--" ? item.rej_transaction_id : (item.transfer_transaction_id ?? "NA") };
  if (type === "CANCELLED") {
    const ids = [item.in_transaction_id, item.out_transaction_id, item.transfer_transaction_id, item.rej_transaction_id, item.jw_transaction_id, item.mfg_ppr_trans_id_2];
    return { mode: "CANCELLED", label: "CANCELLED", qty_in: item.qty, qty_out: item.qty, transaction_id: ids.find(id => id && id !== "--") || "NA" };
  }
  return { mode: "N/A", label: "N/A", qty_in: "N/A", qty_out: "N/A", transaction_id: "--" };
}

// ─── GET TRANSACTION DETAIL BY rm_location ID (Q1 format) ───────────────────
router.get("/transactionDetail", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.query, {
    rmLocationId: "required|integer",
  });

  if (validation.fails()) {
    return res.json({ code: 500, status: "error", message: validation.errors.errors });
  }

  try {
    const { rmLocationId } = req.query;
    const branch = req.branch;

    const rows = await invtDB.query(
      `SELECT
          rm_location.ID                AS rm_id,
          rm_location.*,
          rm_location.insert_date       AS inward_date,
          components.c_name,
          components.c_part_no,
          components.c_new_part_no,
          admin_login.user_name
       FROM rm_location
       LEFT JOIN components  ON rm_location.components_id = components.component_key
       LEFT JOIN admin_login ON rm_location.insert_by     = admin_login.CustID
       WHERE rm_location.ID = :rmLocationId
         AND rm_location.company_branch = :branch
       LIMIT 1`,
      {
        replacements: { rmLocationId, branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (!rows.length) {
      return res.json({
        code: 404,
        status: "error",
        message: { msg: "Transaction row not found" },
      });
    }

    const item = rows[0];
    const txn = getTransactionDetails(item);

    const [location_in, location_out, vendorDetails, weightedPurchaseRate] = await Promise.all([
      getLocationName(item.loc_in),
      getLocationName(item.loc_out),
      getVendorDetails(item.in_vendor_name),
      newAvgRate.newWeightedAverageRate(
        item.components_id,
        moment(item.inward_date).format("YYYY-MM-DD HH:mm:ss"),
        item.rm_id
      ),
    ]);

    let out_rate = 0;
    if (txn.label === "CONSUMPTION" || txn.label === "ISSUE") out_rate = weightedPurchaseRate;
    if (txn.label === "JOBWORK") out_rate = item.in_po_rate * item.exchange_rate;

    // Check if a PENDING cancellation request exists for this row
    const cancelReq = await invtDB.query(
      `SELECT id, status, request_date FROM tbl_cancellation_requests
        WHERE rm_location_id = :rmLocationId
        ORDER BY request_date DESC LIMIT 1`,
      { replacements: { rmLocationId }, type: invtDB.QueryTypes.SELECT }
    );

    return res.json({
      code: 200,
      status: "success",
      data: {
        transactionID: txn.transaction_id,
        rmLocationId: item.rm_id,
        partNo: item.c_part_no,
        partName: item.c_name,
        newPartNo: item.c_new_part_no,

        vendorType: VENDOR_TYPES[item.vendor_type] || "--",
        vendorName: vendorDetails.name,
        vendorCode: vendorDetails.code,

        qtyIn: helper.number(txn.qty_in),
        qtyOut: helper.number(txn.qty_out),

        rate: item.final_rate !== "0" ? item.final_rate : item.in_po_rate,
        weightedPurchaseRate,
        outRate: out_rate,

        transactionBy: item.user_name ? item.user_name.toString().split(" ")[0].toUpperCase() : "N/A",

        transactionType: txn.label,
        transactionMode: txn.mode,
        transactionDate: moment(item.inward_date, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"),

        locationIn: location_in,
        locationOut: location_out,

        inModule: item.in_module,
        isReversed: item.is_reversed,
        anyRemark: item.any_remark,

        cancellationRequest: cancelReq.length ? cancelReq[0] : null,
      },
    });
  } catch (err) {
    return res.json({
      code: 500,
      status: "error",
      message: { msg: "Internal Error<br/>If this condition persists, contact your system administrator" },
      errors: err.stack,
    });
  }
});

// Derive the display transaction number from a rm_location row
// (same logic as Q1's getTransactionDetails)
function resolveTransactionNo(row) {
  const t = row.trans_type;
  if (t === "INWARD") return row.in_transaction_id !== "--" ? row.in_transaction_id : row.transfer_transaction_id;
  if (t === "ISSUE") return row.out_transaction_id !== "--" ? row.out_transaction_id : "--";
  if (t === "TRANSFER") return row.transfer_transaction_id !== "--" ? row.transfer_transaction_id : "--";
  if (t === "CONSUMPTION") return row.out_transaction_id !== "--" ? row.out_transaction_id : (row.jw_transaction_id !== "--" ? row.jw_transaction_id : (row.mfg_ppr_trans_id_2 || "--")); 
  if (t === "SFG-CONSUMPTION") return row.jw_transaction_id !== "--" ? row.jw_transaction_id : "--";
  if (t === "JOBWORK") return row.jw_transaction_id !== "--" ? row.jw_transaction_id : "--";
  if (t === "REJECTION") return row.rej_transaction_id !== "--" ? row.rej_transaction_id : (row.transfer_transaction_id || "--");
  const ids = [row.in_transaction_id, row.out_transaction_id, row.transfer_transaction_id, row.jw_transaction_id, row.rej_transaction_id, row.mfg_ppr_trans_id_2];
  return ids.find(id => id && id !== "--") || "--";
}

// ─── RAISE CANCELLATION REQUEST ──────────────────────────────────────────────
// Frontend sends: rmLocationId (ID from rm_location row in Q1), reason
router.post("/raise", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    rmLocationId: "required|integer",
    reason: "required|string",
  });

  if (validation.fails()) {
    return res.json({ code: 500, status: "error", message: validation.errors.errors });
  }

  try {
    const { rmLocationId, reason, ccEmail } = req.body;
    const toEmail = CANCELLATION_APPROVER_EMAIL;
    const requestBy = req.logedINUser;
    const branch = req.branch;
    const company = req.logedINCompany;

    // 1. Fetch the rm_location row by primary key
    const txnRows = await invtDB.query(
      `SELECT ID, in_module, trans_type, is_reversed,
              in_transaction_id, out_transaction_id, transfer_transaction_id,
              jw_transaction_id, rej_transaction_id, company_branch
         FROM rm_location
        WHERE ID = :rmLocationId
          AND company_branch = :branch
        LIMIT 1`,
      {
        replacements: { rmLocationId, branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (!txnRows.length) {
      return res.json({
        code: 404,
        status: "error",
        message: { msg: "Transaction row not found in records for this branch" },
      });
    }

    const txn = txnRows[0];

    if (txn.is_reversed === "Y") {
      return res.json({
        code: 400,
        status: "error",
        message: { msg: "This transaction is already reversed/cancelled" },
      });
    }

    // 2. Block duplicate PENDING request for same rm_location row
    const dupCheck = await invtDB.query(
      `SELECT id FROM tbl_cancellation_requests
        WHERE rm_location_id = :rmLocationId
          AND status = 'PENDING'
        LIMIT 1`,
      {
        replacements: { rmLocationId },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (dupCheck.length) {
      return res.json({
        code: 400,
        status: "error",
        message: { msg: `A cancellation request for this transaction is already PENDING (Request ID #${dupCheck[0].id})` },
      });
    }

    // 3. Resolve display values from the row
    const transaction_type = txn.in_module;
    const trans_type = txn.trans_type;
    const transaction_no = resolveTransactionNo(txn);

    // 4. Get requester email
    const userRow = await invtDB.query(
      `SELECT Email_ID, user_name FROM admin_login WHERE CustID = :custId LIMIT 1`,
      { replacements: { custId: requestBy }, type: invtDB.QueryTypes.SELECT }
    );
    const requestByEmail = userRow[0]?.Email_ID || null;
    const requestByName = userRow[0]?.user_name || requestBy;

    // 5. Insert request
    const [, meta] = await invtDB.query(
      `INSERT INTO tbl_cancellation_requests
         (rm_location_id, transaction_type, transaction_no, trans_type,
          reason, request_by, request_by_email,
          to_email, cc_email, status, branch, company, request_date)
       VALUES
         (:rmLocationId, :transaction_type, :transaction_no, :trans_type,
          :reason, :requestBy, :requestByEmail,
          :toEmail, :ccEmail, 'PENDING', :branch, :company, NOW())`,
      {
        replacements: {
          rmLocationId,
          transaction_type,
          transaction_no,
          trans_type,
          reason,
          requestBy,
          requestByEmail,
          toEmail,
          ccEmail: ccEmail || null,
          branch,
          company,
        },
        type: invtDB.QueryTypes.INSERT,
      }
    );

    const requestId = meta;

    // 6. Email to approver
    const emailHtml = buildEmail_Raised({
      requestId, transaction_type, trans_type,
      transaction_no, reason, requestByName, requestByEmail, branch,
    });

    const mailResult = await helper.sendMail(
      toEmail,
      ccEmail || null,
      `[Action Required] Cancellation Request #${requestId} – ${transaction_type} | ${transaction_no}`,
      emailHtml
    );

    return res.json({
      code: 200,
      status: "success",
      message: { msg: "Cancellation request raised successfully" },
      data: {
        requestId,
        transaction_type,
        trans_type,
        transaction_no,
        mailStatus: mailResult.code === 200 ? "sent" : "failed",
      },
    });
  } catch (err) {
    return res.json({
      code: 500,
      status: "error",
      message: { msg: "Internal Error<br/>If this condition persists, contact your system administrator" },
      errors: err.stack,
    });
  }
});


const CANCEL_WINDOW_DAYS = 15;

function assertRowsCancellable(rows) {
  for (const row of rows) {
    if (moment(row.insert_date).isBefore(moment().subtract(CANCEL_WINDOW_DAYS, "days"), "day")) {
      throw { userMessage: `You can't cancel MIN after ${CANCEL_WINDOW_DAYS} days` };
    }
    if (row.vbp_status === "Y") {
      throw {
        userMessage:
          "You can't cancel MIN because this component is already used in VBP (Vendor Bill Posting). Please contact finance department.",
      };
    }
  }
}

router.post("/cancelMIN", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.query, {
    rmLocationId: "required",
    requestType: "required|in:APPROVED,REJECTED",
  });

  if (validation.fails()) {
    return res.json({ code: 500, message: validation.errors.all(), status: "error" });
  }

  if (req.query.requestType === "REJECTED" && !req.body.remarks) {
    return res.json({ code: 422, success: false, message: "remarks is required to reject a request", status: "error" });
  }

  const t = await invtDB.transaction();

  try {
    // Lock the row so a concurrent approve/reject on the same rmLocationId can't race past this check.
    const stmt_check_0 = await invtDB.query(
      `SELECT * FROM tbl_cancellation_requests
       WHERE rm_location_id = :rmLocationId AND status = 'PENDING'
       FOR UPDATE`,
      {
        replacements: { rmLocationId: req.query.rmLocationId },
        type: invtDB.QueryTypes.SELECT,
        transaction: t,
      }
    );

    if (!stmt_check_0 || stmt_check_0.length === 0) {
      await t.rollback();
      return res.json({ code: 404, success: false, message: "No pending cancellation request found", status: "error" });
    }

    const cancellationRequest = stmt_check_0[0];
    const transactionNo = cancellationRequest.transaction_no;
    const transType = cancellationRequest.trans_type;
    const updatedate = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

    // ── REJECTED branch ───────────────────────────────────────────────────────
    if (req.query.requestType === "REJECTED") {
      await invtDB.query(
        `UPDATE tbl_cancellation_requests
         SET status = 'REJECTED', remarks = :remarks, updated_by = :updateby, updated_date = :updatedate
         WHERE rm_location_id = :rmLocationId AND status = 'PENDING'`,
        {
          replacements: {
            remarks: req.body.remarks,
            updateby: req.logedINUser,
            updatedate,
            rmLocationId: req.query.rmLocationId,
          },
          type: invtDB.QueryTypes.UPDATE,
          transaction: t,
        }
      );

      await t.commit();
      return res.json({ code: 200, success: true, message: "MIN Cancellation Rejected", status: "success" });
    }

    // if (req.query.requestType !== "APPROVED") {
    //   await t.rollback();
    //   return res.json({ code: 400, success: false, message: "Invalid request type", status: "error" });
    // }

    // ── APPROVED: branch on trans_type stored in the cancellation request ────
    if (transType === "TRANSFER") {
      const transferRows = await invtDB.query(
        `SELECT * FROM rm_location
         WHERE transfer_transaction_id = :transactionId AND trans_type = 'TRANSFER'`,
        {
          replacements: { transactionId: transactionNo },
          type: invtDB.QueryTypes.SELECT,
          transaction: t,
        }
      );

      if (!transferRows || transferRows.length === 0) {
        await t.rollback();
        return res.json({ code: 404, success: false, message: "TRANSFER transaction not found", status: "error" });
      }

      assertRowsCancellable(transferRows);

      await invtDB.query(
        `UPDATE rm_location
         SET trans_type = 'CANCELLED', update_by = :updateby, update_date = :updatedate
         WHERE transfer_transaction_id = :transactionId AND trans_type = 'TRANSFER'`,
        {
          replacements: { transactionId: transactionNo, updateby: req.logedINUser, updatedate },
          type: invtDB.QueryTypes.UPDATE,
          transaction: t,
        }
      );
    } else if (transType === "CONSUMPTION") {

      const [stmt_mfg] = await invtDB.query(
        `SELECT * FROM mfg_production_2 WHERE mfg_transaction = :transactionId`,
        {
          replacements: { transactionId: transactionNo },
          type: invtDB.QueryTypes.SELECT,
          transaction: t,
        }
      );

      if (!stmt_mfg) {
        await t.rollback();
        return res.json({ status: "error", code: 404, message: { msg: "Transaction not found" } });
      }

      if (stmt_mfg.mfg_prod_type === "A") {
        await t.rollback();
        return res.json({
          status: "error",
          code: 404,
          message: { msg: "Cannot cancel this transaction. This transaction is already FG Inward, first cancel FG inward then cancel this transaction" },
        });
      }

      if (stmt_mfg.mfg_prod_type === "C" && stmt_mfg.mfg_ref_id !== null) {
        await invtDB.query(
          `UPDATE mfg_production_2 SET fg_status = 'CANCELLED' WHERE mfg_prod_type = 'C' AND mfg_transaction = :transactionId`,
          { replacements: { transactionId: transactionNo }, type: invtDB.QueryTypes.UPDATE, transaction: t }
        );

        await invtDB.query(
          `UPDATE mfg_production_1 SET prod_executed_qty = prod_executed_qty - :qty WHERE prod_transaction = :pprID`,
          {
            replacements: { qty: stmt_mfg.mfg_prod_planing_qty, pprID: stmt_mfg.mfg_ref_id },
            type: invtDB.QueryTypes.UPDATE,
            transaction: t,
          }
        );

        await invtDB.query(
          `UPDATE rm_location SET trans_type = 'CANCELLED' WHERE mfg_ppr_trans_id_2 = :transactionId AND mfg_ppr_trans_id_1 = :pprID`,
          {
            replacements: { transactionId: transactionNo, pprID: stmt_mfg.mfg_ref_id },
            type: invtDB.QueryTypes.UPDATE,
            transaction: t,
          }
        );
      } else {
        await t.rollback();
        return res.json({
          status: "error",
          code: 422,
          message: { msg: `Unsupported mfg_prod_type '${stmt_mfg.mfg_prod_type}' for cancellation` },
        });
      }
    } else {
      // ── INWARD BRANCH (IN-PO / IN-WO / IN-JWI) ──────────────────────────────
      const inwardRows = await invtDB.query(
        `SELECT * FROM rm_location
         WHERE (in_transaction_id = :transactionId OR in_jw_transaction_id = :transactionId) AND trans_type = 'INWARD'`,
        {
          replacements: { transactionId: transactionNo },
          type: invtDB.QueryTypes.SELECT,
          transaction: t,
        }
      );

      if (!inwardRows || inwardRows.length === 0) {
        await t.rollback();
        return res.json({ code: 404, success: false, message: "INWARD transaction not found", status: "error" });
      }

      assertRowsCancellable(inwardRows);

      for (const row of inwardRows) {
        if (row.in_po_transaction_id && row.in_po_transaction_id !== "--" && row.in_module === "IN-PO") {
          const [qtySum] = await invtDB.query(
            `SELECT COALESCE(SUM(qty), 0) AS total_inward_qty
             FROM rm_location
             WHERE components_id = :component AND in_transaction_id = :transactionId AND trans_type = 'INWARD'`,
            {
              replacements: { transactionId: transactionNo, component: row.components_id },
              type: invtDB.QueryTypes.SELECT,
              transaction: t,
            }
          );

          const remaining_inward_qty = qtySum
            ? Math.max(0, helper.number(qtySum.total_inward_qty) - helper.number(row.qty))
            : 0;

          await invtDB.query(
            `UPDATE po_purchase_req
             SET po_inward_qty = :remaining_inward_qty,
                 po_pending_qty = po_order_qty - :remaining_inward_qty
             WHERE po_transaction = :po_txn AND po_part_no = :component`,
            {
              replacements: { remaining_inward_qty, po_txn: row.in_po_transaction_id, component: row.components_id },
              type: invtDB.QueryTypes.UPDATE,
              transaction: t,
            }
          );
        } else if (row.wo_transaction_id && row.wo_transaction_id !== "--" && row.in_module === "IN-WO") {
          await invtDB.query(
            `UPDATE rm_location
             SET trans_type = 'CANCELLED', update_by = :updateby, update_date = :updatedate
             WHERE in_transaction_id = :transactionId AND trans_type = 'INWARD'`,
            {
              replacements: { transactionId: transactionNo, updateby: req.logedINUser, updatedate },
              type: invtDB.QueryTypes.UPDATE,
              transaction: t,
            }
          );

          await invtDB.query(
            `UPDATE wo_material_received SET wo_insert_type='CANCELLED' WHERE wo_m_transaction_id = :transactionId`,
            { replacements: { transactionId: transactionNo }, type: invtDB.QueryTypes.UPDATE, transaction: t }
          );
        } else if (row.in_jw_transaction_id) {
          const [jw_stmt] = await invtDB.query(
            `SELECT jw_po_sku FROM jw_purchase_req WHERE jw_jw_transaction = :jw_txn`,
            { replacements: { jw_txn: row.in_jw_transaction_id }, type: invtDB.QueryTypes.SELECT, transaction: t }
          );

          if (!jw_stmt) {
            return res.json({ code: 500, success: false, message: "JW transaction not found", status: "error" });
          }

          await invtDB.query(
            `UPDATE jw_purchase_req
             SET jw_po_issue_qty = jw_po_issue_qty - :qty
             WHERE jw_jw_transaction = :jw_txn AND jw_po_sku = :poSku`,
            {
              replacements: { qty: helper.number(row.qty), jw_txn: row.in_jw_transaction_id, poSku: jw_stmt.jw_po_sku },
              type: invtDB.QueryTypes.UPDATE,
              transaction: t,
            }
          );

          await invtDB.query(
            `UPDATE rm_location
             SET trans_type = 'CANCELLED', update_by = :updateby, update_date = :updatedate
             WHERE in_jw_transaction_id = :transactionId`,
            {
              replacements: { transactionId: transactionNo, updateby: req.logedINUser, updatedate },
              type: invtDB.QueryTypes.UPDATE,
              transaction: t,
            }
          );

          await invtDB.query(
            `UPDATE rm_location
             SET trans_type = 'CANCELLED', update_by = :updateby, update_date = :updatedate
             WHERE jw_transaction_id = :transactionId AND trans_type = 'SFG-CONSUMPTION'`,
            {
              replacements: { transactionId: transactionNo, updateby: req.logedINUser, updatedate },
              type: invtDB.QueryTypes.UPDATE,
              transaction: t,
            }
          );
        }
      }

      await invtDB.query(
        `UPDATE rm_location
         SET trans_type = 'CANCELLED', update_by = :updateby, update_date = :updatedate
         WHERE in_transaction_id = :transactionId AND trans_type = 'INWARD'`,
        {
          replacements: { transactionId: transactionNo, updateby: req.logedINUser, updatedate },
          type: invtDB.QueryTypes.UPDATE,
          transaction: t,
        }
      );

      await invtDB.query(
        `UPDATE rm_location
         SET trans_type = 'CANCELLED', update_by = :updateby, update_date = :updatedate
         WHERE in_transaction_id = :transactionId AND trans_type = 'ISSUE' AND is_auto_cons = 'Y'`,
        {
          replacements: { transactionId: transactionNo, updateby: req.logedINUser, updatedate },
          type: invtDB.QueryTypes.UPDATE,
          transaction: t,
        }
      );
    }

    await invtDB.query(
      `UPDATE tbl_cancellation_requests
       SET status = 'APPROVED', updated_by = :updateby, updated_date = :updatedate
       WHERE rm_location_id = :rmLocationId AND status = 'PENDING'`,
      {
        replacements: { updateby: req.logedINUser, updatedate, rmLocationId: req.query.rmLocationId },
        type: invtDB.QueryTypes.UPDATE,
        transaction: t,
      }
    );

    await t.commit();
    return res.json({ code: 200, success: true, message: "MIN Cancel Successfully", status: "success" });
  } catch (error) {
    await t.rollback();
    logger.error("cancelMIN failed", { error, rmLocationId: req.query.rmLocationId }); // server-side only

    if (error && error.userMessage) {
      return res.json({ code: 422, success: false, message: error.userMessage, status: "error" });
    }

    return res.json({
      code: 500,
      success: false,
      message: "Internal Error!!! If this condition persists, contact your system administrator",
      status: "error",
    });
  }
});

// ─── APPROVE / REJECT CANCELLATION REQUEST ────────────────────────────────────
// router.post("/cancelMIN", [auth.isAuthorized], async (req, res) => {
//   const validation = new Validator(req.query, {
//     rmLocationId: "required",
//     requestType: "required|in:APPROVED,REJECTED",
//   });

//   if (validation.fails()) {
//     return res.json({ code: 500, message: validation.errors.all(), status: "error" });
//   }

//   const t = await invtDB.transaction();

//   try {
//     const stmt_check_0 = await invtDB.query(
//       `SELECT * FROM tbl_cancellation_requests
//        WHERE rm_location_id = :rmLocationId AND status = 'PENDING'`,
//       {
//         replacements: { rmLocationId: req.query.rmLocationId },
//         type: invtDB.QueryTypes.SELECT,
//         transaction: t,
//       }
//     );

//     if (!stmt_check_0 || stmt_check_0.length === 0) {
//       await t.rollback();
//       return res.json({ code: 404, success: false, message: "No pending cancellation request found", status: "error" });
//     }

//     const cancellationRequest = stmt_check_0[0];
//     const transactionNo = cancellationRequest.transaction_no;
//     const transType = cancellationRequest.trans_type;
//     const transactionType = cancellationRequest.transaction_type;
//     const updatedate = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

//     // ── REJECTED branch ───────────────────────────────────────────────────────
//     if (req.query.requestType === "REJECTED") {
//       await invtDB.query(
//         `UPDATE tbl_cancellation_requests
//          SET status = 'REJECTED', remarks = :remarks, updated_by = :updateby, updated_date = :updatedate
//          WHERE rm_location_id = :rmLocationId AND status = 'PENDING'`,
//         {
//           replacements: {
//             remarks: req.body.remarks,
//             updateby: req.logedINUser,
//             updatedate,
//             rmLocationId: req.query.rmLocationId,
//           },
//           type: invtDB.QueryTypes.UPDATE,
//           transaction: t,
//         }
//       );

//       await t.commit();
//       return res.json({ code: 200, success: true, message: "MIN Cancellation Rejected", status: "success" });

//     } else if (req.query.requestType === "APPROVED") {

//       // ── Branch on trans_type stored in the cancellation request ──────────────
//       if (transType === "TRANSFER") {
//         // ── TRANSFER BRANCH ────────────────────────────────────────────────────

//         const transferRows = await invtDB.query(
//           `SELECT * FROM rm_location
//            WHERE transfer_transaction_id = :transactionId AND trans_type = 'TRANSFER'`,
//           {
//             replacements: { transactionId: transactionNo },
//             type: invtDB.QueryTypes.SELECT,
//             transaction: t,
//           }
//         );

//         if (!transferRows || transferRows.length === 0) {
//           await t.rollback();
//           return res.json({ code: 404, success: false, message: "TRANSFER transaction not found", status: "error" });
//         }

//         // Validate before making any changes
//         for (const row of transferRows) {
//           if (moment(row.insert_date).isBefore(moment().subtract(15, "days"), "day")) {
//             await t.rollback();
//             return res.json({ success: false, message: "You can't cancel MIN after 15 days", status: "error" });
//           }
//           if (row.vbp_status === "Y") {
//             await t.rollback();
//             return res.json({
//               success: false,
//               message: "You can't cancel MIN because this component is already used in VBP (Vendor Bill Posting). Please contact finance department.",
//               status: "error",
//             });
//           }
//         }

//         await invtDB.query(
//           `UPDATE rm_location
//            SET trans_type = 'CANCELLED', update_by = :updateby, update_date = :updatedate
//            WHERE transfer_transaction_id = :transactionId AND trans_type = 'TRANSFER'`,
//           {
//             replacements: { transactionId: transactionNo, updateby: req.logedINUser, updatedate },
//             type: invtDB.QueryTypes.UPDATE,
//             transaction: t,
//           }
//         );

//       }


//       else {
//         // ── INWARD BRANCH (IN-PO / IN-JWI) ────────────────────────────────────

//         const inwardRows = await invtDB.query(
//           `SELECT * FROM rm_location
//            WHERE (in_transaction_id = :transactionId OR in_jw_transaction_id = :transactionId) AND trans_type = 'INWARD'`,
//           {
//             replacements: { transactionId: transactionNo },
//             type: invtDB.QueryTypes.SELECT,
//             transaction: t,
//           }
//         );

//         console.log(transactionNo, "---transactionNo");

//         // console.log(inwardRows, "---inward");

//         // console.log(inwardRows, "---inward");
//         if (!inwardRows || inwardRows.length === 0) {
//           await t.rollback();
//           return res.json({ code: 404, success: false, message: "INWARD transaction not found", status: "error" });
//         }

//         // Validate all rows before making any changes
//         for (const row of inwardRows) {
//           if (moment(row.insert_date).isBefore(moment().subtract(15, "days"), "day")) {
//             await t.rollback();
//             return res.json({ success: false, message: "You can't cancel MIN after 15 days", status: "error" });
//           }
//           if (row.vbp_status === "Y") {
//             await t.rollback();
//             return res.json({
//               success: false,
//               message: "You can't cancel MIN because this component is already used in VBP (Vendor Bill Posting). Please contact finance department.",
//               status: "error",
//             });
//           }
//         }

//         // Apply reversal changes per row
//         for (const row of inwardRows) {
//           if (row.in_po_transaction_id && row.in_po_transaction_id !== "--" && row.in_module === "IN-PO") {
//             // ── PO sub-branch ──
//             const [qtySum] = await invtDB.query(
//               `SELECT COALESCE(SUM(qty), 0) AS total_inward_qty
//                FROM rm_location
//                WHERE components_id = :component AND in_transaction_id = :transactionId AND trans_type = 'INWARD'`,
//               {
//                 replacements: { transactionId: transactionNo, component: row.components_id },
//                 type: invtDB.QueryTypes.SELECT,
//                 transaction: t,
//               }
//             );

//             const remaining_inward_qty = qtySum
//               ? helper.number(qtySum.total_inward_qty) - helper.number(row.qty)
//               : 0;

//             await invtDB.query(
//               `UPDATE po_purchase_req
//                SET po_inward_qty = :remaining_inward_qty,
//                    po_pending_qty = po_order_qty - :remaining_inward_qty
//                WHERE po_transaction = :po_txn AND po_part_no = :component`,
//               {
//                 replacements: { remaining_inward_qty, po_txn: row.in_po_transaction_id, component: row.components_id },
//                 type: invtDB.QueryTypes.UPDATE,
//                 transaction: t,
//               }
//             );

//           }

//           else if (row.wo_transaction_id && row.wo_transaction_id !== "--" && row.in_module === "IN-WO") {
//             await invtDB.query(
//               `UPDATE rm_location
//                 SET trans_type = 'CANCELLED', update_by = :updateby, update_date = :updatedate
//                 WHERE in_transaction_id = :transactionId AND trans_type = 'INWARD'`,
//               {
//                 replacements: { transactionId: transactionNo, updateby: req.logedINUser, updatedate },
//                 type: invtDB.QueryTypes.UPDATE,
//                 transaction: t,
//               }
//             )

//             await invtDB.query(
//               `UPDATE wo_material_received SET wo_insert_type='CANCELLED' WHERE wo_m_transaction_id = :transactionId`,
//               {
//                 replacements: { transactionId: transactionNo },
//                 type: invtDB.QueryTypes.UPDATE,
//                 transaction: t,
//               }
//             )
//           }


//           else if (row.in_jw_transaction_id) {
//             // ── JWI sub-branch ──
//             const [jw_stmt] = await invtDB.query(
//               `SELECT jw_po_sku FROM jw_purchase_req WHERE jw_jw_transaction = :jw_txn`,
//               {
//                 replacements: { jw_txn: row.in_jw_transaction_id },
//                 type: invtDB.QueryTypes.SELECT,
//                 transaction: t,
//               }
//             );

//             console.log("jw_stmt", jw_stmt);

//             await invtDB.query(
//               `UPDATE jw_purchase_req
//                SET jw_po_issue_qty = jw_po_issue_qty - :qty
//                WHERE jw_jw_transaction = :jw_txn AND jw_po_sku = :poSku`,
//               {
//                 replacements: { qty: helper.number(row.qty), jw_txn: row.in_jw_transaction_id, poSku: jw_stmt.jw_po_sku },
//                 type: invtDB.QueryTypes.UPDATE,
//                 transaction: t,
//               }
//             );

//             await invtDB.query(
//               `UPDATE rm_location
//                SET trans_type = 'CANCELLED', update_by = :updateby, update_date = :updatedate
//                WHERE in_jw_transaction_id = :transactionId`,
//               {
//                 replacements: { transactionId: transactionNo, updateby: req.logedINUser, updatedate },
//                 type: invtDB.QueryTypes.UPDATE,
//                 transaction: t,
//               }
//             );

//             // Cancel SFG-CONSUMPTION rows tied to this JWI inward
//             await invtDB.query(
//               `UPDATE rm_location
//                SET trans_type = 'CANCELLED', update_by = :updateby, update_date = :updatedate
//                WHERE jw_transaction_id = :transactionId AND trans_type = 'SFG-CONSUMPTION'`,
//               {
//                 replacements: { transactionId: transactionNo, updateby: req.logedINUser, updatedate },
//                 type: invtDB.QueryTypes.UPDATE,
//                 transaction: t,
//               }
//             );
//           }
//         }

//         // Cancel the INWARD rows themselves
//         await invtDB.query(
//           `UPDATE rm_location
//            SET trans_type = 'CANCELLED', update_by = :updateby, update_date = :updatedate
//            WHERE in_transaction_id = :transactionId AND trans_type = 'INWARD'`,
//           {
//             replacements: { transactionId: transactionNo, updateby: req.logedINUser, updatedate },
//             type: invtDB.QueryTypes.UPDATE,
//             transaction: t,
//           }
//         );

//         // Cancel any auto-consumed ISSUE rows
//         await invtDB.query(
//           `UPDATE rm_location
//            SET trans_type = 'CANCELLED', update_by = :updateby, update_date = :updatedate
//            WHERE in_transaction_id = :transactionId AND trans_type = 'ISSUE' AND is_auto_cons = 'Y'`,
//           {
//             replacements: { transactionId: transactionNo, updateby: req.logedINUser, updatedate },
//             type: invtDB.QueryTypes.UPDATE,
//             transaction: t,
//           }
//         );
//       }

//       // Mark the cancellation request itself as APPROVED
//       await invtDB.query(
//         `UPDATE tbl_cancellation_requests
//          SET status = 'APPROVED', updated_by = :updateby, updated_date = :updatedate
//          WHERE rm_location_id = :rmLocationId AND status = 'PENDING'`,
//         {
//           replacements: {
//             updateby: req.logedINUser,
//             updatedate,
//             rmLocationId: req.query.rmLocationId,
//           },
//           type: invtDB.QueryTypes.UPDATE,
//           transaction: t,
//         }
//       );

//       await t.commit();
//       return res.json({ code: 200, success: true, message: "MIN Cancel Successfully", status: "success" });

//     } else {
//       await t.rollback();
//       return res.json({ code: 400, success: false, message: "Invalid request type", status: "error" });
//     }

//   } catch (error) {
//     console.log(error);
//     await t.rollback();
//     return res.json({
//       code: 500,
//       success: false,
//       message: "Internal Error!!! If this condition persists, contact your system administrator",
//       status: "error",
//       error: error.stack,
//     });
//   }
// });





// ─── UPDATE STATUS (APPROVE / REJECT) ────────────────────────────────────────
router.post("/updateStatus", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    requestId: "required|integer",
    status: "required|in:APPROVED,REJECTED",
    remarks: "required|string",
  });

  if (validation.fails()) {
    return res.json({ code: 500, status: "error", message: validation.errors.errors });
  }

  try {
    const { requestId, status, remarks } = req.body;
    const updatedBy = req.logedINUser;

    const existing = await invtDB.query(
      `SELECT * FROM tbl_cancellation_requests WHERE id = :requestId LIMIT 1`,
      { replacements: { requestId }, type: invtDB.QueryTypes.SELECT }
    );

    if (!existing.length) {
      return res.json({ code: 404, status: "error", message: { msg: "Cancellation request not found" } });
    }

    if (existing[0].status !== "PENDING") {
      return res.json({
        code: 400,
        status: "error",
        message: { msg: `Request is already ${existing[0].status}. No further update allowed.` },
      });
    }

    await invtDB.query(
      `UPDATE tbl_cancellation_requests
          SET status = :status, remarks = :remarks,
              updated_by = :updatedBy, updated_date = NOW()
        WHERE id = :requestId`,
      {
        replacements: { status, remarks, updatedBy, requestId },
        type: invtDB.QueryTypes.UPDATE,
      }
    );

    const r = existing[0];

    const notifyEmail = r.request_by_email || r.to_email;
    const emailHtml = buildEmail_StatusUpdate({ r, requestId, status, remarks, updatedBy });

    await helper.sendMail(
      notifyEmail,
      null,
      `[Cancellation ${status}] #${requestId} – ${r.transaction_type} | ${r.transaction_no}`,
      emailHtml
    );

    return res.json({
      code: 200,
      status: "success",
      message: { msg: `Cancellation request ${status} successfully` },
    });
  } catch (err) {
    return res.json({
      code: 500,
      status: "error",
      message: { msg: "Internal Error<br/>If this condition persists, contact your system administrator" },
      errors: err.stack,
    });
  }
});

// ─── LIST REQUESTS ────────────────────────────────────────────────────────────
router.get("/list", [auth.isAuthorized], async (req, res) => {
  try {
    const { status, transactionType, transType, fromDate, toDate } = req.query;
    const branch = req.branch;
    const company = req.logedINCompany;

    let where = `WHERE cr.branch = :branch AND cr.company = :company`;
    const replacements = { branch, company };

    if (status) {
      where += ` AND cr.status = :status`;
      replacements.status = status;
    }
    if (transactionType) {
      where += ` AND cr.transaction_type = :transactionType`;
      replacements.transactionType = transactionType;
    }
    if (transType) {
      where += ` AND cr.trans_type = :transType`;
      replacements.transType = transType;
    }
    if (fromDate) {
      where += ` AND DATE(cr.request_date) >= :fromDate`;
      replacements.fromDate = fromDate;
    }
    if (toDate) {
      where += ` AND DATE(cr.request_date) <= :toDate`;
      replacements.toDate = toDate;
    }

    const rows = await invtDB.query(
      `SELECT
          cr.id,
          cr.rm_location_id,
          cr.transaction_type,
          cr.transaction_no,
          cr.trans_type,
          cr.reason,
          al.user_name AS request_by,
          cr.request_by_email,
          cr.status,
          cr.remarks,
          cr.updated_by,
          cr.request_date,
          cr.updated_date,
          cr.branch
       FROM tbl_cancellation_requests cr
       LEFT JOIN admin_login al ON al.CustID = cr.request_by
       ${where}
       ORDER BY cr.request_date DESC`,
      { replacements, type: invtDB.QueryTypes.SELECT }
    );

    return res.json({ code: 200, status: "success", data: rows });
  } catch (err) {
    return res.json({
      code: 500,
      status: "error",
      message: { msg: "Internal Error<br/>If this condition persists, contact your system administrator" },
      errors: err.stack,
    });
  }
});

// ─── EMAIL TEMPLATES ──────────────────────────────────────────────────────────
function buildEmail_Raised({ requestId, transaction_type, trans_type, transaction_no, reason, requestByName, requestByEmail, branch }) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;border:1px solid #ddd;border-radius:8px;overflow:hidden;">
    <div style="background:#c0392b;padding:18px 24px;">
      <h2 style="color:#fff;margin:0;">&#9888; Cancellation Request Raised</h2>
    </div>
    <div style="padding:24px;">
      <p>Dear Team,</p>
      <p>A cancellation request has been raised. Please log in to the IMS portal to <strong>Approve</strong> or <strong>Reject</strong> it.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:14px;">
        <tr style="background:#f5f5f5;"><td style="padding:9px 14px;font-weight:bold;width:42%;">Request ID</td><td style="padding:9px 14px;">#${requestId}</td></tr>
        <tr><td style="padding:9px 14px;font-weight:bold;">Module</td><td style="padding:9px 14px;">${transaction_type}</td></tr>
        <tr style="background:#f5f5f5;"><td style="padding:9px 14px;font-weight:bold;">Transaction Type</td><td style="padding:9px 14px;">${trans_type}</td></tr>
        <tr><td style="padding:9px 14px;font-weight:bold;">Transaction No.</td><td style="padding:9px 14px;"><strong>${transaction_no}</strong></td></tr>
        <tr style="background:#f5f5f5;"><td style="padding:9px 14px;font-weight:bold;">Reason</td><td style="padding:9px 14px;">${reason}</td></tr>
        <tr><td style="padding:9px 14px;font-weight:bold;">Requested By</td><td style="padding:9px 14px;">${requestByName}${requestByEmail ? ` (${requestByEmail})` : ""}</td></tr>
        <tr style="background:#f5f5f5;"><td style="padding:9px 14px;font-weight:bold;">Branch</td><td style="padding:9px 14px;">${branch}</td></tr>
        <tr><td style="padding:9px 14px;font-weight:bold;">Status</td><td style="padding:9px 14px;color:#e67e22;font-weight:bold;">PENDING</td></tr>
      </table>
    </div>
    <div style="background:#f0f0f0;padding:12px 24px;font-size:12px;color:#888;">
      Automated message from IMS – MsCorpres Automation. Do not reply to this email.
    </div>
  </div>`;
}

function buildEmail_StatusUpdate({ r, requestId, status, remarks, updatedBy }) {
  const color = status === "APPROVED" ? "#27ae60" : "#c0392b";
  const icon = status === "APPROVED" ? "&#10003;" : "&#10007;";
  return `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;border:1px solid #ddd;border-radius:8px;overflow:hidden;">
    <div style="background:${color};padding:18px 24px;">
      <h2 style="color:#fff;margin:0;">${icon} Cancellation Request ${status}</h2>
    </div>
    <div style="padding:24px;">
      <p>Dear ${r.request_by},</p>
      <p>Your cancellation request has been <strong>${status}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:14px;">
        <tr style="background:#f5f5f5;"><td style="padding:9px 14px;font-weight:bold;width:42%;">Request ID</td><td style="padding:9px 14px;">#${requestId}</td></tr>
        <tr><td style="padding:9px 14px;font-weight:bold;">Module</td><td style="padding:9px 14px;">${r.transaction_type}</td></tr>
        <tr style="background:#f5f5f5;"><td style="padding:9px 14px;font-weight:bold;">Transaction Type</td><td style="padding:9px 14px;">${r.trans_type}</td></tr>
        <tr><td style="padding:9px 14px;font-weight:bold;">Transaction No.</td><td style="padding:9px 14px;"><strong>${r.transaction_no}</strong></td></tr>
        <tr style="background:#f5f5f5;"><td style="padding:9px 14px;font-weight:bold;">Status</td><td style="padding:9px 14px;color:${color};font-weight:bold;">${status}</td></tr>
        <tr><td style="padding:9px 14px;font-weight:bold;">Remarks</td><td style="padding:9px 14px;">${remarks}</td></tr>
        <tr style="background:#f5f5f5;"><td style="padding:9px 14px;font-weight:bold;">Action By</td><td style="padding:9px 14px;">${updatedBy}</td></tr>
      </table>
      ${status === "APPROVED"
      ? `<p style="margin-top:16px;color:#555;font-size:13px;">The transaction is approved for cancellation. Please proceed with the reversal in the IMS portal.</p>`
      : `<p style="margin-top:16px;color:#555;font-size:13px;">Your request was rejected. Please contact the approver for more details.</p>`}
    </div>
    <div style="background:#f0f0f0;padding:12px 24px;font-size:12px;color:#888;">
      Automated message from IMS – MsCorpres Automation. Do not reply to this email.
    </div>
  </div>`;
}

module.exports = router;
