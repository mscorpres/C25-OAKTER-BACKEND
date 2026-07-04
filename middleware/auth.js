const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { invtDB, otherDB } = require("./../config/db/connection");
var jwt = require("jsonwebtoken");
const rsa = require("node-rsa");

function extractRawToken(authHeader) {
  if (!authHeader) return null;
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);
  return authHeader;
}

const MSG_LOGIN_OUT =
  "You have signed out due to some reason, Please login again";
const MSG_AUTH_ERROR =
  "An error occurred while authenticating you, Please login again";
const MSG_SESSION_EXPIRED = "Session has Expired, Please login again";

async function validateLoginTrackToken(decoded, rawToken) {
  const username = decoded.crn_id;

  if (!username) {
    return { ok: false, reason: "AUTH_ERROR" };
  }

  try {
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    const now = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

    await otherDB.query(
      `DELETE FROM tbl_login_track WHERE username = :username AND exp_timestamp < :now`,
      {
        replacements: { username, now },
        type: otherDB.QueryTypes.DELETE,
      },
    );

    const rows = await otherDB.query(
      `SELECT ID, exp_timestamp, token, insert_timestamp 
       FROM tbl_login_track 
       WHERE username = :username
       ORDER BY insert_timestamp ASC, ID ASC`,
      {
        replacements: { username },
        type: otherDB.QueryTypes.SELECT,
      },
    );

    if (!rows.length) {
      return { ok: false, reason: "OUT" };
    }

    const limitRows = await invtDB.query(
      `SELECT max_login_system FROM admin_login WHERE CustID = :id LIMIT 1`,
      { replacements: { id: username }, type: invtDB.QueryTypes.SELECT },
    );

    let maxRows = Number(limitRows[0]?.max_login_system);
    if (!Number.isFinite(maxRows) || maxRows < 1) maxRows = 1;

    if (rows.length > maxRows) {
      const toDelete = rows.slice(0, rows.length - maxRows);

      const idsToDelete = toDelete.map((r) => r.ID);
      await otherDB.query(
        `DELETE FROM tbl_login_track WHERE ID IN (:ids) AND username = :username`,
        {
          replacements: { ids: idsToDelete, username },
          type: otherDB.QueryTypes.DELETE,
        },
      );

      const deletedHashes = new Set(toDelete.map((r) => r.token));
      if (deletedHashes.has(tokenHash)) {
        return { ok: false, reason: "OUT" };
      }
    }

    const survivingRows = rows.slice(
      rows.length > maxRows ? rows.length - maxRows : 0,
    );
    const matched = survivingRows.find((row) => row.token === tokenHash);

    if (!matched) {
      return { ok: false, reason: "AUTH_ERROR" };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "AUTH_ERROR" };
  }
}

module.exports.isAuthorized = function (req, res, next) {
  try {
    const token = req.headers["authorization"];
    const triggerUID = req.headers["x-trigger-uid"];
    req.page_id = req.headers["page_id"];
    req.branch = req.headers["company-branch"];
    req.session = req.headers["session"];

    if (!triggerUID && process.env.STAGE !== "DEV") {
      return res.status(401).json({
        success: false,
        status: "error",
        message: "Identifier not found.\nPlease try again..",
      });
    }

    if (!req.branch || req.branch === "0") {
      return res.status(401).json({
        status: "error",
        success: false,
        message: "company branch not yet selected",
      });
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        status: "error",
        message: "Please login again",
        data: { logout: true },
      });
    }

    const rawToken = extractRawToken(token);

    jwt.verify(
      rawToken,
      process.env.TOKEN_SECRET,
      async function (err, decoded) {
        if (err) {
          const jwtMsg =
            err.name === "TokenExpiredError"
              ? MSG_SESSION_EXPIRED
              : "Token identification mismatched, please login again";

          return res.status(401).json({
            success: false,
            status: "error",
            message: jwtMsg,
            data: { logout: true },
          });
        }

        const track = await validateLoginTrackToken(decoded, rawToken);

        if (!track.ok) {
          const msg =
            track.reason === "OUT"
              ? MSG_LOGIN_OUT
              : track.reason === "EXPIRED"
                ? MSG_SESSION_EXPIRED
                : MSG_AUTH_ERROR;

          return res.status(401).json({
            success: false,
            status: "error",
            message: msg,
            data: { logout: true },
          });
        }

        const stmt1 = await invtDB.query(
          `SELECT 
          COALESCE(al.CustID, '--') AS CustID,
          COALESCE(al.login_status, '--') AS login_status,
          COALESCE(al.account_status, '--') AS account_status,
          COALESCE(al.Attempt, '0') AS Attempt,
          COALESCE(b.ID, '--') AS branch_id,
          COALESCE(b.branch_code, '--') AS branch_code
        FROM (SELECT 1) AS dummy
        LEFT JOIN (
          SELECT CustID, login_status, account_status, Attempt 
          FROM admin_login 
          WHERE CustID = :custId 
          LIMIT 1
        ) al ON 1=1
        LEFT JOIN (
          SELECT ID, branch_code 
          FROM branches 
          WHERE branch_code = :branch 
          LIMIT 1
        ) b ON 1=1`,
          {
            replacements: {
              branch: req.branch,
              custId: decoded.crn_id,
            },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        const row = stmt1?.[0];

        if (!row) {
          return res.json({
            success: false,
            status: "error",
            message: "invalid company branch selected.\nPlease try again...",
            data: { logout: true },
          });
        }

        if (row.CustID === "--") {
          return res.status(401).json({
            success: false,
            status: "error",
            message: "Unauthorized Access.\nPlease login again..",
            data: { logout: true },
          });
        }

        const attempt = Number(row.Attempt) || 0;

        if (row.login_status === "0" || attempt >= 6) {
          return res.status(401).json({
            success: false,
            status: "error",
            message:
              "Your account has been temporarily suspended.\nPlease re-generate your password OR contact your administrator..",
            data: { logout: true },
          });
        }

        if (row.account_status === "0") {
          return res.status(401).json({
            success: false,
            status: "error",
            message:
              "Your account has been permanently suspended.\nPlease contact your administrator..",
            data: { logout: true },
          });
        }

        const stmt2 = await otherDB.query(
          `SELECT company_server, company_status 
         FROM ims_company 
         WHERE company_id = :company_id 
         LIMIT 1`,
          {
            replacements: { company_id: decoded.company_id },
            type: otherDB.QueryTypes.SELECT,
          },
        );

        if (!stmt2[0]) {
          return res.status(401).json({
            success: false,
            status: "error",
            message:
              "An error occurred while authenticating you, Please login again..\nErrorID: 0001A",
            data: { logout: true },
          });
        }

        if (stmt2[0].company_status === "B") {
          return res.status(401).json({
            success: false,
            status: "error",
            message:
              "Your company has been suspended.\nPlease contact your administrator..",
            data: { logout: true },
          });
        }

        if (stmt2[0].company_server === "OFF") {
          return res.status(401).json({
            success: false,
            status: "error",
            message:
              "We're sorry, but our server is currently under maintenance.\nPlease try again later..",
            data: { logout: true },
          });
        }

        if (triggerUID)
          try {
            const existing = await otherDB.query(
              `SELECT trigger_key, trigger_count, insert_by, insert_dt
           FROM tbl_duplichecker
           WHERE trigger_key = :triggerUID
           LIMIT 1`,
              {
                replacements: { triggerUID },
                type: otherDB.QueryTypes.SELECT,
              },
            );

            if (existing.length > 0) {
              const rec = existing[0];
              await otherDB.query(
                `UPDATE tbl_duplichecker SET trigger_count = trigger_count + 1 WHERE trigger_key = :triggerUID`,
                {
                  replacements: { triggerUID },
                  type: otherDB.QueryTypes.UPDATE,
                },
              );
              return res.status(409).json({
                success: false,
                status: "error",
                message:
                  "Duplicate request detected.\nOperation has already been executed.\nYou have tried (" +
                  (rec.trigger_count + 2) +
                  ") times.",
                data: {
                  triggerKey: rec.trigger_key,
                  insertDt: rec.insert_dt,
                },
              });
            }

            await otherDB.query(
              `INSERT INTO tbl_duplichecker (trigger_key, trigger_count, end_call_router, insert_by, insert_dt)
           VALUES (:triggerUID, 0, :route, :insertBy, NOW())`,
              {
                replacements: {
                  triggerUID,
                  route: req.originalUrl,
                  insertBy: row.CustID,
                },
                type: otherDB.QueryTypes.INSERT,
              },
            );
          } catch (dupErr) {
            console.error("tbl_duplichecker error:", dupErr);
          }

        req.logedINUser = row.CustID;
        req.logedINCompany = decoded.company_id;
        req.clickID = triggerUID || decoded.crn_id + ":" + Date.now();

        next();
        return;
      },
    );
  } catch (error) {
    return helper.errorResponse(res, error);
  }
};

// Define the path to your payloads file
const payloadsFilePath = path.join(__dirname, "PAYLOADS.json");

module.exports.checkDuplicacy_db = async function (req, res, next) {
  next();
  return;

  const clientIP = req.headers["x-forwarded-for"]
    ? req.headers["x-forwarded-for"].split(",")[0].trim()
    : req.connection.remoteAddress;

  function generateRequestSignature(data) {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex");
  }

  const requestSignature = generateRequestSignature(req.body);
  const payloadHeadSignature = generateRequestSignature(req.headers);
  const currentTime = Date.now();
  const lifetime = 12 * 60 * 60 * 1000; // 12 hours

  const generalDetails = {
    timestamp: moment(currentTime).format("YYYY-MM-DD HH:mm:ss"),
    requestURL: req.originalUrl,
    requestMethod: req.method,
    statusCode: res.statusCode || 200,
    remoteAddress: req.connection.remoteAddress,
  };

  try {
    const existingSignatures = await otherDB.query(
      "SELECT * FROM prevent_duplicacy WHERE user_ip = :user_ip AND payload_body = :payload_body",
      {
        replacements: {
          user_ip: clientIP,
          payload_body: requestSignature,
        },
        type: otherDB.QueryTypes.SELECT,
      },
    );

    const duplicateEntry = existingSignatures.some(
      (sig) => sig.payload_body === requestSignature,
    );

    if (duplicateEntry) {
      const lastEntryTime = new Date(existingSignatures[0].insert_dt).getTime();
      const timeDiff = Math.floor((currentTime - lastEntryTime) / 1000);

      let timeMessage = "";
      if (timeDiff < 60) {
        timeMessage = `${timeDiff} seconds ago`;
      } else if (timeDiff < 3600) {
        timeMessage = `${Math.floor(timeDiff / 60)} minutes ago`;
      } else {
        const hours = Math.floor(timeDiff / 3600);
        const minutes = Math.floor((timeDiff % 3600) / 60);
        timeMessage = `${hours} hour${hours !== 1 ? "s" : ""} ${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
      }

      let responseMessage;
      if (existingSignatures[0].user_ip !== clientIP) {
        responseMessage = `Duplicate request detected from IP ${existingSignatures[0].user_ip}, last entry was ${timeMessage}.`;
      } else {
        responseMessage = `Duplicate request detected, last entry was ${timeMessage}.`;
      }

      const newTimestamps = existingSignatures[0].checkRetry
        ? existingSignatures[0].checkRetry +
          ", " +
          moment(currentTime).format("YYYY-MM-DD HH:mm:ss")
        : moment(currentTime).format("YYYY-MM-DD HH:mm:ss");

      await otherDB.query(
        "UPDATE prevent_duplicacy SET checkFound = checkFound + 1, checkRetry = :dateTiem WHERE payload_body = :payload_body AND user_ip = :user_ip",
        {
          replacements: {
            payload_body: requestSignature,
            dateTiem: newTimestamps,
            user_ip: clientIP,
          },
          type: otherDB.QueryTypes.UPDATE,
        },
      );

      return res.status(400).json({
        status: "error",
        success: false,
        message: responseMessage,
      });
    }

    const payload_full = JSON.stringify({
      general: generalDetails,
      head: req.headers,
      body: req.body,
    });

    await otherDB.query(
      "INSERT INTO prevent_duplicacy (payload_body, insert_dt, insert_by, user_ip, user_agent, payload_head, lifetime, checkFound, payload_full) VALUES (:payload_body, :insert_dt, :insert_by, :user_ip, :user_agent, :payload_head, :lifetime, :checkFound, :payload_full)",
      {
        replacements: {
          payload_body: requestSignature,
          insert_dt: new Date(currentTime),
          insert_by: req.logedINUser,
          user_ip: clientIP,
          user_agent: req.headers["user-agent"],
          payload_head: payloadHeadSignature,
          lifetime: new Date(currentTime + lifetime),
          checkFound: 0,
          payload_full: payload_full,
        },
        type: otherDB.QueryTypes.INSERT,
      },
    );

    next();
  } catch (error) {
    return helper.errorResponse(res, error);
  }
};

// TALLYSYNC AUTHORIZATION
module.exports.tallysyncAuthorized = function (req, res, next) {
  try {
    var token = req.headers["x-api-key"];

    if (!token || token !== "TESTAPIKEY2025") {
      return res.json({
        success: false,
        message:
          "either you have not provided the API key or the API key has been expired",
        data: {
          logout: true,
        },
      });
    }
    next();
  } catch (error) {
    return helper.errorResponse(res, error);
  }
};

module.exports.ssoAuthorized = function (req, res, next) {
  try {
    var token = req.headers["authorization"];
    req.session = req.headers["session"];

    if (!token) {
      res.status(401).json({
        status: "error",
        success: false,
        message: "token identification mismatched..<br />Please login again..",
      });
      return;
    }
    jwt.verify(
      token,
      `${process.env.TOKEN_SECRET}`,
      async function (err, decoded) {
        if (err) {
          return res.status(401).json({
            status: "error",
            success: false,
            message: "token authentication failed..<br />Please login again...",
          });
        }
        req.logedINUser = decoded.uID;
        req.logedINMobile = decoded.mobile;
        req.logedINEmail = decoded.email;
        req.logedINCompany = decoded.company;
        next();
      },
    );
  } catch (error) {
    return helper.errorResponse(res, error);
  }
};

module.exports.checkModulePermission = async function (req, res, next) {
  try {
    var path = req.path; // e.g., '/getLocationPOInMin'

    let permQuery = await otherDB.query(
      `SELECT mr.module_key, mr.module_name, mr.parent_module_key, bp.enabled
       FROM oakter_ims_other.module_routes mr
       LEFT JOIN oakter_ims_other.branch_permissions bp ON mr.module_key = bp.module_key AND bp.branch_code = :branch
       WHERE :path = mr.route_prefix OR :path LIKE REPLACE(mr.route_prefix, '*', '%')`,
      {
        replacements: { branch: req.branch, path: path },
        type: otherDB.QueryTypes.SELECT,
      },
    );

    if (permQuery.length === 0) {
      next();
      return;
    }

    let module = permQuery[0];

    if (module.enabled === null || module.enabled === 0) {
      return res.json({
        status: "error",
        success: false,
        message:
          "Module '${module.module_name}' is disabled for branch '${req.branch}'",
      });
    }

    if (module.parent_module_key) {
      let parentPerm = await otherDB.query(
        "SELECT enabled FROM oakter_ims_other.branch_permissions WHERE module_key = :parent_module_key AND branch_code = :branch",
        {
          replacements: {
            parent_module_key: module.parent_module_key,
            branch: req.branch,
          },
          type: otherDB.QueryTypes.SELECT,
        },
      );

      if (parentPerm.length === 0 || parentPerm[0].enabled === 0) {
        let parentModule = await otherDB.query(
          "SELECT module_name FROM oakter_ims_other.module_routes WHERE module_key = :parent_module_key",
          {
            replacements: { parent_module_key: module.parent_module_key },
            type: otherDB.QueryTypes.SELECT,
          },
        );
        let parentName =
          parentModule[0]?.module_name || module.parent_module_key;
        return res.json({
          status: "error",
          success: false,
          message:
            "Parent module '${parentName}' is disabled for branch '${req.branch}'",
        });
      }
    }

    next();
  } catch (error) {
    return helper.errorResponse(res, error);
  }
};
