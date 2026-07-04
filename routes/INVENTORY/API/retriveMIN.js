const express = require("express");
const router = express.Router();
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");

let { invtDB, otherDB } = require("../../../config/db/connection");

// Endpoint to generate or refresh API token
router.post("/auth/token", async (req, res) => {
  try {
    const { client_code, password } = req.body;
    if (!client_code || !password) {
      return res.json({
        code: 400,
        message: "Client code and password are required",
        status: "error", success: false,
      });
    }

    // Validate password
    if (client_code !== "Oakter" || password !== "%_t{u733[XcX") {
      return res.json({
        code: 401,
        message:
          "you have provided the unauthorized client code and password - [CASE SENSITIVE]",
        status: "error", success: false,
      });
    }

    // Generate JWT
    const token = jwt.sign({ client_code }, process.env.TOKEN_SECRET, {
      expiresIn: "24h",
    });
    const expiresAt = moment().add(24, "hours").format("YYYY-MM-DD HH:mm:ss");

    await otherDB.query(
      `INSERT INTO tbl_api_tokens (client_code, token, expires_at)
         VALUES (:client_code, :token, :expiresAt)
         ON DUPLICATE KEY UPDATE 
           token = :token, 
           expires_at = :expiresAt, 
           created_at = CURRENT_TIMESTAMP`,
      {
        replacements: { client_code, token, expiresAt },
        type: otherDB.QueryTypes.INSERT,
      }
    );

    return res.json({

      data: {
        token,
        expires_at: moment(expiresAt).format("DD-MM-YYYY HH:mm:ss"),
      },
    });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// Middleware to validate API token
const validateApiToken = async (req, res, next) => {
  const authHeader = req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.json({
      code: 401,
      message: "No token provided",
      status: "error", success: false,
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
      return res.json({
        code: 401,
        message: "Invalid OR the token has been expired",
        status: "error", success: false,
      });
    }

    req.client_code = tokenRecord[0].client_code;
    next();
  } catch (error) {
    return res.status(401).json({
      code: 401,
      message: "Unauthorized Access, CASE SENSITIVE",
      status: "error",
    });
  }
};

// Utility function to validate and parse dates
const validateAndParseDates = (from, to) => {
  if (!from || !to) {
    throw new Error("Missing date range");
  }
  const fromDate = moment(from, "DD-MM-YYYY HH:mm:ss", true);
  const toDate = moment(to, "DD-MM-YYYY HH:mm:ss", true);
  if (!fromDate.isValid() || !toDate.isValid()) {
    throw new Error("Invalid date and time format. Use DD-MM-YYYY HH:mm:ss");
  }
  if (fromDate.isAfter(toDate)) {
    throw new Error("From date cannot be later than to date");
  }
  // Validate time range: minimum 30 minutes, maximum 1 hour
  const durationMinutes = toDate.diff(fromDate, "minutes", true);
  if (durationMinutes < 30 || durationMinutes > 60) {
    throw new Error("Time range must be between 30 minutes to 1 hour");
  }
  return {
    fromDate,
    toDate,
    sqlFrom: fromDate.format("YYYY-MM-DD HH:mm:ss"),
    sqlTo: toDate.format("YYYY-MM-DD HH:mm:ss"),
  };
};

const logApiRequest = async (reqRefId, from, to, status, insertTimestamp) => {
  const logResult = await otherDB.query(
    `INSERT INTO tbl_api_logs (req_ref_id, from_timestamp, to_timestamp, server_status, insert_timestamp)
     VALUES (:reqRefId, :from, :to, :serverStatus, :insertTimestamp)`,
    {
      replacements: {
        reqRefId,
        from,
        to,
        serverStatus: status,
        insertTimestamp,
      },
      type: otherDB.QueryTypes.INSERT,
    }
  );
  return logResult[0]; // Return log ID
};

const checkDuplicateRequest = async (from, to) => {
  const existingLog = await otherDB.query(
    `SELECT ID, ref_ack_id, from_timestamp, to_timestamp 
     FROM tbl_api_logs 
     WHERE server_status = 200
       AND :from <= to_timestamp 
       AND :to >= from_timestamp`,
    {
      replacements: { from, to },
      type: otherDB.QueryTypes.SELECT,
    }
  );
  return existingLog.length > 0 ? existingLog[0] : null;
};

router.post("/fetch/min/:request", [validateApiToken], async (req, res) => {
  const reqRefId = uuidv4();
  const insertTimestamp = moment().format("YYYY-MM-DD HH:mm:ss");
  let logId = null;

  try {
    const { request } = req.params;
    const { from, to } = req.body;

    // Validate and parse dates
    const { sqlFrom, sqlTo } = validateAndParseDates(from, to);

    // Check for overlapping request
    const existingLog = await checkDuplicateRequest(sqlFrom, sqlTo);
    if (existingLog) {
      const existingFrom = moment(existingLog.from_timestamp).format(
        "DD-MM-YYYY HH:mm:ss"
      );
      const existingTo = moment(existingLog.to_timestamp).format(
        "DD-MM-YYYY HH:mm:ss"
      );
      const nextAvailableTime = moment(existingLog.to_timestamp)
        .add(1, "second")
        .format("DD-MM-YYYY HH:mm:ss");
      return res.json({
        code: 403,
        status: "error", success: false,
        message: `Data for an overlapping time range has already been fetched from ${existingFrom} to ${existingTo}.\nPlease select a time range starting after ${nextAvailableTime} onward.`,
        previous_reqAck_no: existingLog.ref_ack_id || "N/A",
      });
    }

    // Log the request
    logId = await logApiRequest(reqRefId, sqlFrom, sqlTo, 100, insertTimestamp);

    // Main query
    const results = await invtDB.query(
      `SELECT rm.*, 
                rm.insert_date,
                cc.cost_center_name,
                cc.cost_center_short_name,
                c.c_name,
                c.c_part_no,
                c.c_uom,
                u.units_name,
                lm.location_key,
                al.CustID
         FROM rm_location rm
         LEFT JOIN components c ON rm.components_id = c.component_key
         LEFT JOIN units u ON c.c_uom = u.units_id
         LEFT JOIN location_main lm ON rm.loc_in = lm.location_key
         LEFT JOIN admin_login al ON rm.insert_by = al.CustID
         LEFT JOIN cost_center cc ON cc.cost_center_key = rm.rm_loc_cost_center
         WHERE c.c_type = 'R'
           AND c.c_is_enabled = 'Y'
           AND rm.insert_date BETWEEN :from AND :to
           AND rm.trans_type = 'INWARD'
           AND rm.in_module != 'PART-CONV'
         ORDER BY rm.insert_date DESC`,
      {
        replacements: { from: sqlFrom, to: sqlTo },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (!results.length) {
      await otherDB.query(
        `UPDATE tbl_api_logs SET server_status = :serverStatus WHERE ID = :logId`,
        {
          replacements: { serverStatus: 404, logId },
          type: otherDB.QueryTypes.UPDATE,
        }
      );
      return res.json({
        code: 404,
        message: "No data found",
        status: "error", success: false,
      });
    }

    // Fetch vendor names
    const vendorIds = [...new Set(results.map((r) => r.in_vendor_name))];
    const vendorQuery = await invtDB.query(
      `SELECT ven_register_id, ven_name 
         FROM ven_basic_detail 
         WHERE ven_register_id IN (:vendors)`,
      {
        replacements: { vendors: vendorIds },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    const vendorMap = new Map(
      vendorQuery.map((v) => [v.ven_register_id, v.ven_name])
    );

    // Process results
    const finalResult = results.map((element) => {
      const inQty = Number(element.qty) + Number(element.other_qty);      

      return {
        minDt: moment(element.insert_date).format("DD-MM-YYYY HH:mm:ss"),
        invoiceDate: moment(element.in_wo_invoice_date).format(
          "DD-MM-YYYY HH:mm:ss"
        ),
        partName: element.c_name,
        partCode: element.c_part_no,
        inRate: element.in_po_rate,
        inQty: inQty,
        uom: element.units_name,
        vendorName: vendorMap.get(element.in_vendor_name) || "N/A",
        invoiceNumber: element.in_wo_invoice_no || "N/A",
        minID: element.in_transaction_id,
        hsnCode:
          element.in_hsn_code && element.in_hsn_code !== "--"
            ? element.in_hsn_code
            : "--",
      };
    });

    // Generate ref_ack_id for successful response
    const refAckId = uuidv4();

    // Update log with success status and ref_ack_id
    await otherDB.query(
      `UPDATE tbl_api_logs 
         SET server_status = :serverStatus, ref_ack_id = :refAckId 
         WHERE ID = :logId`,
      {
        replacements: { serverStatus: 200, refAckId, logId },
        type: otherDB.QueryTypes.UPDATE,
      }
    );

    return res.json({ data: finalResult, ref_ack_id: refAckId });
  } catch (error) {
    console.error("Error in fetch MIN:", error);
    if (logId) {
      await otherDB.query(
        `UPDATE tbl_api_logs SET server_status = :serverStatus WHERE ID = :logId`,
        {
          replacements: { serverStatus: 500, logId },
          type: otherDB.QueryTypes.UPDATE,
        }
      );
    }
    const statusCode =
      error.message.includes("Invalid date") ||
      error.message.includes("Missing date") ||
      error.message.includes("From date cannot") ||
      error.message.includes("Time range cannot")
        ? 400
        : 500;
    return res.status(statusCode).json({
      code: statusCode,
      message: error.message || "Internal server error",
      status: "error",
    });
  }
});

module.exports = router;
