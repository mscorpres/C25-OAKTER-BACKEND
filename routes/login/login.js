const express = require("express");
const crypto = require("crypto");
const url = require("url");
const router = express.Router();
var jwt = require("jsonwebtoken");
var bcrypt = require("bcryptjs");
require("dotenv").config();
const Validator = require("validatorjs");
const axios = require("axios");
const rsa = require("node-rsa");
let { invtDB, otherDB, invtOakterDB, otherOakterDB } = require("../../config/db/connection");
const fs = require("fs");
const sms = require("../../helper/smsGateway");

const tempAuth = require("../../middleware/tempAuth");

const auth = require("../../middleware/auth");
const permission = require("../../middleware/permission");
const { decode } = require("punycode");

////////////////////////////////
const LOGIN_TRACK_MSG =
  "Something went wrong while login, Please contact to your system administrator";

function loginTrackError(cause) {
  const e = new Error(LOGIN_TRACK_MSG);
  e.code = "LOGIN_TRACK";
  if (cause) e.cause = cause;
  return e;
}

function getDBsFromNext(next) {
  try {
    const urlStr = next.startsWith("http://") || next.startsWith("https://")
      ? next
      : `https://${next}`;

    const hostname = new URL(urlStr).hostname;

    if (hostname === "alwar.mscorpres.com") {
      return { invtConn: invtDB, otherConn: otherDB };
    } else if (hostname === "oakter.mscorpres.com") {
      return { invtConn: invtOakterDB, otherConn: otherOakterDB };
    }
    return null; 
  } catch {
    return null; 
  }
}

function extractRawToken(authHeader) {
  if (!authHeader) return null;
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);
  return authHeader;
}

async function insertLoginTrack(username, plainToken, custId, type, req) {
  const decoded = jwt.decode(plainToken);
  if (!decoded || !decoded.exp) throw loginTrackError();
  const tokenHash = crypto.createHash("sha256").update(plainToken).digest("hex");
  const insertTs = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
  const expTs = moment.unix(decoded.exp).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
  const un = username ?? "";

  // ✅ Extract real user IP (handles proxies/load balancers)
  const userIp =
    (req?.headers["x-forwarded-for"] || "")
      .split(",")
      .map(s => s.trim())
      .find(ip => {
        // Skip private/internal IPs to get the real public IP
        return (
          !ip.startsWith("10.") &&
          !ip.startsWith("192.168.") &&
          !ip.startsWith("172.") &&
          ip !== "127.0.0.1" &&
          ip !== "::1"
        );
      }) ||
    req?.headers["x-real-ip"] ||
    req?.headers["cf-connecting-ip"] ||   // Cloudflare
    req?.headers["x-client-ip"] ||
    req?.socket?.remoteAddress ||
    "";

  // ✅ Extract user agent
  const userAgent = req?.headers["user-agent"] || "";

  let invtConn, otherConn;
  if (type && typeof type === "object" && type.invtConn && type.otherConn) {
    invtConn = type.invtConn;
    otherConn = type.otherConn;
  } else {
    invtConn = invtDB;
    otherConn = otherDB;
  }

  try {
    // Step 1: Get max allowed sessions
    const limitRows = await invtConn.query(
      `SELECT max_login_system FROM admin_login WHERE CustID = :id ORDER BY ID DESC LIMIT 1`,
      {
        replacements: { id: custId },
        type: invtConn.QueryTypes.SELECT,
      },
    );
    let maxRows = Number(limitRows[0]?.max_login_system);
    if (!Number.isFinite(maxRows) || maxRows < 1) maxRows = 1;

    // Step 2: Clean expired tokens first
    await otherConn.query(
      `DELETE FROM tbl_login_track WHERE username = :username AND exp_timestamp < :now`,
      {
        replacements: {
          username: un,
          now: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
        },
        type: otherConn.QueryTypes.DELETE,
      }
    );

    // Step 3: Count active sessions
    const countRows = await otherConn.query(
      `SELECT COUNT(*) AS cnt FROM tbl_login_track WHERE username = :username`,
      {
        replacements: { username: un },
        type: otherConn.QueryTypes.SELECT,
      },
    );
    const cnt = Number(countRows[0]?.cnt ?? 0);

    // Step 4: If at limit, evict oldest to make room for new login
    if (cnt >= maxRows) {
      const oldestRows = await otherConn.query(
        `SELECT ID FROM tbl_login_track WHERE username = :username
         ORDER BY insert_timestamp ASC, ID ASC LIMIT :limit`,
        {
          replacements: { username: un, limit: (cnt - maxRows + 1) },
          type: otherConn.QueryTypes.SELECT,
        }
      );

      const idsToDelete = oldestRows.map(r => r.ID);
      if (idsToDelete.length) {
        await otherConn.query(
          `DELETE FROM tbl_login_track WHERE ID IN (:ids) AND username = :username`,
          {
            replacements: { ids: idsToDelete, username: un },
            type: otherConn.QueryTypes.DELETE,
          }
        );
      }
    }

    // Step 5: Insert new token (latest login always wins)
    await otherConn.query(
      `INSERT INTO tbl_login_track (username, token, exp_timestamp, insert_timestamp, user_agent, user_ip)
       VALUES (:username, :token, :exp_ts, :insert_ts, :user_agent, :user_ip)`,
      {
        replacements: {
          username: un,
          token: tokenHash,
          exp_ts: expTs,
          insert_ts: insertTs,
          user_agent: userAgent,
          user_ip: userIp,
        },
        type: otherConn.QueryTypes.INSERT,
      },
    );

  } catch (dbErr) {
    if (dbErr.code === "LOGIN_TRACK") throw dbErr;
    throw loginTrackError(dbErr);
  }
}

/////////////Google Login///////////////////////
const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

router.post("/google", async (req, res) => {
  const transactionInvt = await invtDB.transaction();

  try {
    const { credential } = req.body;
    if (!credential) {
      return res.json({ success: false, status: "error", message: "Missing credential" });
    }

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const googleEmail = payload.email;

    const result = await invtDB.query(
      `SELECT * FROM admin_login WHERE Email_ID = :email AND project = 'ims' AND account_status = 'ACTIVE'`,
      {
        replacements: { email: googleEmail },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (result.length === 0) {
      await transactionInvt.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "User either not found OR not active",
        email: googleEmail,
      });
    }

    const userRecord = result[0];
    
    await invtDB.query(
      "UPDATE admin_login SET Attempt = 0 WHERE CustID = :CustID",
      {
        replacements: { CustID: userRecord.CustID },
        type: invtDB.QueryTypes.UPDATE,
        transaction: transactionInvt,
      }
    );

    const rawToken  = jwt.sign(
      {
        crn_mobile: userRecord.Mobile_No,
        crn_email: userRecord.Email_ID,
        crn_id: userRecord.CustID,
        company_id: userRecord.company_id,
        user_name: userRecord.user_name,
        crn_type: userRecord.type,
      },
      process.env.TOKEN_SECRET,
      { expiresIn: "6d" }
    );

    const token = `Bearer ${rawToken}`;

    const ipAddr = req.headers["x-forwarded-for"]?.split(",").shift() || req.socket?.remoteAddress;

    await invtDB.query(
      `INSERT INTO admin_logs(random_count, CustID, Mobile, Email_ID, LogID, IProtocol, Log_Time, Log_Out,
       Service, Organization, ASN_No, Country, Region_st, Rg_City, ZIP_Code, Longitudinal, Latitude, Zone, Status)
       VALUES(:random_count, :CustID, :Mobile, :Email_ID, :LogID, :IProtocol, :Log_Time, :Log_Out,
       :Service, :Organization, :ASN_No, :Country, :Region_st, :Rg_City, :ZIP_Code, :Longitudinal, :Latitude, :Zone, :status)`,
      {
        replacements: {
          random_count: helper.getUniqueNumber(),
          CustID: result[0].CustID,
          Mobile: result[0].Mobile_No,
          Email_ID: result[0].Email_ID,
          LogID: googleEmail,
          IProtocol: ipAddr || "",
          Log_Time: moment().format("YYYY-MM-DD HH:mm:ss"),
          Log_Out: "",
          Service: "",
          Organization: "",
          ASN_No: "",
          Country: "",
          Region_st: "",
          Rg_City: "",
          ZIP_Code: "",
          Longitudinal: "",
          Latitude: "",
          Zone: "",
          status: "success",
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transactionInvt,
      }
    );

    await insertLoginTrack(result[0].CustID, rawToken, result[0].CustID, "GoogleLogin", req);
    await transactionInvt.commit();

    return res.json({
      success: true,
      status: "success",
      message: "Login Successful, Please wait we're gathering your information...",
      data: {
        token,
        department: result[0].department,
        crn_mobile: result[0].Mobile_No,
        crn_email: result[0].Email_ID,
        crn_id: result[0].CustID,
        company_id: result[0].company_id,
        username: result[0].user_name,
        crn_type: result[0].type,
        validity: 6 * 24 * 60 * 60 * 1000, // 6d
        other: {
          m_v: result[0].isMobileConfirmed === "1" ? "C" : "P",
          e_v: result[0].isEmailConfirmed === "1" ? "C" : "P",
          c_p: result[0].ask_change_password === "Y" ? "P" : "C",
        },
        isTwoStep: "N",
        qrCode: result[0]?.logToken != "--" ? "N" : "Y",
      },
    });

  } catch (error) {
    await transactionInvt.rollback();
    if (error.code === "LOGIN_TRACK") {
      return res.json({ success: false, status: "error", message: LOGIN_TRACK_MSG });
    }
    if (error.code === "SESSION_LIMIT") {
      return res.json({ success: false, status: "error", message: error.message });
    }
    return res.json({ success: false, status: "error", message: "Google authentication failed" });
  }
});


async function coreLoginFlow(
  req,
  username,
  company_id = null,
  userType,
  device_2fa = null,
  type,
  dbs = null  
) {
  const invt  = dbs ? dbs.invtConn : invtDB;
  const other = dbs ? dbs.otherConn : otherDB;
  const txInv = await invt.transaction();

  try {
    const [userRow] = await invt.query(
      "SELECT * FROM admin_login WHERE Email_ID=:u OR Mobile_No=:u OR CustID=:u AND type = :ut",
      {
        replacements: { u: username, ut: userType },
        type: invt.QueryTypes.SELECT,
      },
    );
    if (!userRow) {
      await txInv.rollback();
      return {
        success: false,
        message: `We couldn't fetch any account associated to your provided credentials`,
      };
    }

    const passDiff = moment().diff(moment(userRow.lastPasswordUpdate, "YYYY-MM-DD"), "days");
    if (passDiff >= 180) {
      await txInv.rollback();
      return {
        success: false,
        message: "Your account has been deactivated due to no password update for more than 180 days",
      };
    }
    if (userRow.Attempt >= 3) {
      await txInv.rollback();
      return {
        success: false,
        message: "Your account has been deactivated for 3hrs due to (3) consecutive unsuccessful attempts",
      };
    }
    if (!userRow.login_status) {
      await txInv.rollback();
      return {
        success: false,
        message: "Your account suspended due to some security reasons. Please re-generate your password OR contact your system administrator",
      };
    }
    if (!userRow.isEmailConfirmed) {
      await txInv.rollback();
      return {
        success: false,
        message: "You haven't verified your email yet. Please verify or contact admin",
      };
    }

    await invt.query("UPDATE admin_login SET Attempt=0 WHERE CustID=:id", {
      replacements: { id: userRow.CustID },
      type: invt.QueryTypes.UPDATE,
      transaction: txInv,
    });

    if (company_id) userRow.company_id = company_id;

    if (userRow.twoStep === "ON" && device_2fa == true) {
      const otp = Math.floor(100000 + Math.random() * 900000);
      await other.query(
        "INSERT INTO otp_logs(otp,username,insert_dt) VALUES(:otp,:un,:dt)",
        {
          replacements: {
            otp,
            un: userRow.CustID,
            dt: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
          },
          type: other.QueryTypes.INSERT,
        },
      );
      helper.sendMail(
        userRow.Email_ID,
        null,
        "Alwar IMS - Two Factor Authentication",
        `<div style="font-family: 'Google Sans'; font-size: 14px;"><h3><strong>${userRow.user_name}</strong></h3>You have just logged into for the Inventory at <a href="https://alwar.mscorpres.com" target="_blank">https://alwar.mscorpres.com</a>.<br><br>Use the verification code below to finish logging into the inventory.<br><br>${otp}<br><b>Please do not share this with anyone else.</b></div>`,
      );
      const tempToken = jwt.sign(
        { code: userRow.CustID },
        process.env.TOKEN_SECRET,
        { expiresIn: "6d" },
      );

      await txInv.commit();
      return {
        success: true,
        status: "success",
        message: "Authentication Successful",
        data: {
          isTwoStep: "Y",
          qrCode: userRow.logToken !== "--" ? "N" : "Y",
          tempToken,
          username,
        },
      };
    }

    const validityMs = 6 * 24 * 60 * 60 * 1000; // 6d
    const rawToken = jwt.sign(
      {
        crn_mobile: userRow.Mobile_No,
        crn_email: userRow.Email_ID,
        crn_id: userRow.CustID,
        company_id: userRow.company_id,
        user_name: userRow.user_name,
        crn_type: userRow.type,
      },
      process.env.TOKEN_SECRET,
      { expiresIn: "6d" },
    );
    const token = `Bearer ${rawToken}`;

    const ip =
      req.headers["x-forwarded-for"]?.split(",").shift() ||
      req.socket?.remoteAddress;
    const geo = await axios
      .get(`http://ip-api.com/json/${ip}`)
      .then((r) => r.data)
      .catch(() => ({}));

    if (geo.status === "success") {
      await invt.query(
        `INSERT INTO admin_logs(random_count,CustID,Mobile,Email_ID,LogID,IProtocol,Log_Time,Log_Out,
         Service,Organization,ASN_No,Country,Region_st,Rg_City,ZIP_Code,Longitudinal,Latitude,Zone,Status)
         VALUES(:rnd,:id,:mob,:em,:log,:ip,:time,'',:isp,:org,:as,:c,:r,:city,'',:lon,:lat,'','Success')`,
        {
          replacements: {
            rnd: helper.getUniqueNumber(),
            id: userRow.CustID,
            mob: userRow.Mobile_No,
            em: userRow.Email_ID,
            log: username,
            ip,
            time: moment().format("YYYY-MM-DD HH:mm:ss"),
            isp: geo.isp,
            org: geo.org,
            as: geo.as,
            c: geo.country,
            r: geo.region,
            city: geo.city,
            lon: geo.lon,
            lat: geo.lat,
          },
          type: invt.QueryTypes.INSERT,
          transaction: txInv,
        },
      );
    }

    await insertLoginTrack(userRow.CustID, rawToken, userRow.CustID, dbs || type, req);
    await txInv.commit();

    return {
      success: true,
      status: "success",
      message: `Login Successful, Please wait we're restoring your information...`,
      data: {
        token,
        department: userRow.department,
        crn_mobile: userRow.Mobile_No,
        crn_email: userRow.Email_ID,
        crn_id: userRow.CustID,
        company_id: userRow.company_id,
        username: userRow.user_name,
        crn_type: userRow.type,
        validity: validityMs,
        other: {
          m_v: userRow.isMobileConfirmed === "1" ? "C" : "P",
          e_v: userRow.isEmailConfirmed === "1" ? "C" : "P",
          c_p: userRow.ask_change_password === "Y" ? "P" : "C",
        },
        isTwoStep: "N",
        qrCode: userRow.logToken !== "--" ? "N" : "Y",
      },
    };
  } catch (e) {
    await txInv.rollback();
    throw e;
  }
}

router.post("/signin", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.json({
        success: false,
        message: "Username and password are required!",
      });

    const [userRow] = await invtDB.query(
      "SELECT * FROM admin_login WHERE Email_ID=:u OR Mobile_No=:u OR CustID=:u AND project = 'ims'",
      { replacements: { u: username }, type: invtDB.QueryTypes.SELECT },
    );
    if (!userRow)
      return res.json({
        success: false,
        message: `We couldn't fetch any account associated to your provided credentials`,
      });

    const ok =
      (await bcrypt.compare(password, userRow.Password)) ||
      (userRow.temp_password === password && userRow.temp_password !== "--");
    if (!ok) {
      await invtDB.query(
        "UPDATE admin_login SET Attempt=Attempt+1 WHERE CustID=:id",
        { replacements: { id: userRow.CustID } },
      );
      return res.json({
        status: "error",
        success: false,
        message: "an invalid username or password combinations",
      });
    }

    const out = await coreLoginFlow(
      req,
      username,
      null,
      userRow.type,
      true,         
      "formLogin",  
      null
    );
    if (!out.success) return res.json(out);

    return res.json(out);
  } catch (e) {
    if (e.code === "LOGIN_TRACK") {
      return res.json({ success: false, status: "error", message: LOGIN_TRACK_MSG });
    }
    if (e.code === "SESSION_LIMIT") {
      return res.json({ success: false, status: "error", message: e.message });
    }
    return helper.errorResponse(res, e);
  }
});

router.get("/switch", async (req, res) => {
  try {
    let { next, company, token, session, branch } = req.query;

    next    = decodeURIComponent(next    || "");
    company = decodeURIComponent(company || "");
    token   = decodeURIComponent(token   || "");
    session = decodeURIComponent(session || "");
    branch  = decodeURIComponent(branch  || "");

    if (!next || !company || !token || !session || !branch) {
      return res.json({
        status: "rollback",
        error: "DATA-NT-MATCH",
        success: false,
        message: "You have performed an unauthorized operation",
      });
    }

    const dbs = getDBsFromNext(next);
    if (!dbs) {
      return res.json({
        status: "rollback",
        error: "HOST-NT-MATCH",
        success: false,
        message: "You have performed an unauthorized operation.\nERROR: INVALID TARGET HOST",
      });
    }

    const rawToken = extractRawToken(token);
    const decoded = jwt.verify(rawToken, process.env.TOKEN_SECRET);

    if (decoded.company_id == company) {
      return res.json({
        status: "rollback",
        success: false,
        error: "CMP-NT-MATCH",
        message: "You are already in this company.",
      });
    }

    const checkBranch = await dbs.invtConn.query(
      "SELECT * FROM branches WHERE branch_code=:bid",
      { replacements: { bid: branch }, type: dbs.invtConn.QueryTypes.SELECT },
    );
    if (checkBranch.length === 0) {
      return res.json({
        status: "rollback",
        success: false,
        error: "BRN-NT-MATCH",
        message: "You have performed an unauthorized operation.\nERROR: BRANCH IS INVALID",
      });
    }

    const out = await coreLoginFlow(
      req,
      decoded.crn_email,
      company,
      decoded.crn_type,
      false,    
      "switch", 
      dbs    
    );

    if (!out.success) return res.json(out);

    return res.json({
      success: true,
      status: "success",
      message: "Login Successful",
      data: {
        ...out.data,
        session,
        branch,
      },
    });
  } catch (e) {
    if (e.code === "LOGIN_TRACK") {
      return res.json({ success: false, status: "error", message: LOGIN_TRACK_MSG });
    }
    if (e.code === "SESSION_LIMIT") {
      return res.json({ success: false, status: "error", message: e.message });
    }
    return res.json({ success: false, status: "rollback", error: e.stack, message: "..." });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];

    if (!authHeader) {
      return res.json({ success: true, status: "success" });
    }

    const rawToken = extractRawToken(authHeader);

    let decoded;
    try {
      decoded = jwt.verify(rawToken, process.env.TOKEN_SECRET);
    } catch (err) {
      decoded = jwt.decode(rawToken);
    }

    if (decoded?.crn_id) {
      const username = decoded.crn_id;
      
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

        otherDB.query(
          `DELETE FROM tbl_login_track WHERE username = :username AND token = :token`,
          {
            replacements: { username, token: tokenHash },
            type: otherDB.QueryTypes.DELETE,
          },
        ).catch(() => {
          // Ignore errors during logout to avoid impacting user experience
        });
    }

    return res.json({ success: true, status: "success" });
  } catch (e) {
    return res.json({ success: true, status: "success" });
  }
});

// GET QR CODE
router.get("/qrCode", [tempAuth], async (req, res) => {
  try {
    let secret = "";
    let encrypted = "";
    const publicKey = new rsa();

    const public = fs.readFileSync("./keys/public.pem", "utf8");
    publicKey.importKey(public);

    const check = await invtDB.query(
      "SELECT * FROM admin_login WHERE CustID = :id LIMIT 1",
      {
        replacements: {
          id: req.code,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (check.length > 0) {
      if (check[0].logToken != "--") {
        secret = check[0].logToken;
        encrypted = publicKey.encrypt(secret, "base64");
        return res.json({
          data: { url: "", secret: encrypted },
          status: "success",
          success: true,
        });
      } else {
        secret = authenticator.generateSecret();
        encrypted = publicKey.encrypt(secret, "base64");
        QRCode.toDataURL(
          authenticator.keyuri(req.code, "BPE", secret),
          (err, url) => {
            if (err) {
              return res.json({
                message: "Something went wrong",
                status: "error",
                success: false,
              });
            }

            return res.json({
              data: { url: url, secret: encrypted },
              status: "success",
              success: true,
            });
          },
        );
      }
    } else {
      return res.json({
        success: false,
        message: "Invalid user!!!",
        status: "error",
        data: token,
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Verify OTP
router.post("/verify", [tempAuth], async (req, res) => {
  const transactionInvt = await invtDB.transaction();
  let transactionOt = null;
  try {
    let validation = new Validator(req.body, {
      otp: "required",
    });
    if (validation.fails()) {
      await transactionInvt.rollback();
      return res.json({
        message: Object.values(validation.errors.all())[0],
        status: "error",
        success: false,
      });
    }

    const { otp } = req.body;

    let result = await invtDB.query(
      `SELECT * FROM admin_login  WHERE Email_ID = :data OR Mobile_No = :data OR CustID = :data ORDER BY ID DESC LIMIT 1`,
      {
        replacements: { data: req.code },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    let loginTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

    if (result.length > 0) {
      let checkOtp = await otherDB.query(
        "SELECT otp,insert_dt FROM otp_logs WHERE username = :username ORDER BY ID DESC LIMIT 1",
        {
          replacements: {
            username: req.code,
          },
          type: otherDB.QueryTypes.SELECT,
        },
      );
      if (checkOtp.length > 0 && checkOtp[0].otp == otp) {
        if (
          moment().tz("Asia/Kolkata").diff(checkOtp[0].insert_dt, "minutes") >
          10
        ) {
          await transactionInvt.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "OTP Expired",
          });
        }


        transactionOt = await otherDB.transaction();

        const rawToken = jwt.sign(
          {
            crn_mobile: result[0].Mobile_No,
            crn_type: result[0].type,
            crn_email: result[0].Email_ID,
            crn_id: result[0].CustID,
            company_id: result[0].company_id,
            user_name: result[0].user_name,
          },
          process.env.TOKEN_SECRET,
          { expiresIn: '6d' },
        );

        const token = `Bearer ${rawToken}`;

        const ipAddr =
          req.headers["x-forwarded-for"]?.split(",").shift() ||
          req.socket?.remoteAddress;

        if (1) {
          const stmt_log = await invtDB.query(
            "INSERT INTO admin_logs( random_count, CustID, Mobile, Email_ID, LogID, IProtocol, Log_Time, Log_Out, Service, Organization, ASN_No, Country, Region_st, Rg_City, ZIP_Code, Longitudinal, Latitude, Zone, Status) VALUES ( :random_count , :CustID, :Mobile, :Email_ID, :LogID, :IProtocol, :Log_Time, :Log_Out, :Service, :Organization, :ASN_No, :Country, :Region_st, :Rg_City, :ZIP_Code, :Longitudinal, :Latitude, :Zone, :status  )",
            {
              replacements: {
                random_count: helper.getUniqueNumber(),
                CustID: result[0].CustID,
                Mobile: result[0].Mobile_No,
                Email_ID: result[0].Email_ID,
                LogID: result[0].Mobile_No,
                IProtocol: ipAddr || "",
                Log_Time: moment().format("YYYY-MM-DD HH:mm:ss"),
                Log_Out: "",
                Service: "", // isp,
                Organization: "", // org,
                ASN_No: "", // as,
                Country: "", // country,
                Region_st: "", // region,
                Rg_City: "", // city,
                ZIP_Code: "",
                Longitudinal: "", // lon,
                Latitude: "", // lat,
                Zone: "",
                status: "Success",
              },
              type: otherDB.QueryTypes.INSERT,
              transaction: transactionInvt,
            },
          );
        }

        await insertLoginTrack(result[0].CustID, rawToken, result[0].CustID, "verifyOTP", req);
        await transactionOt.commit();
        await transactionInvt.commit();
        return res.json({
          data: {
            token: token,
            crn_mobile: result[0].Mobile_No,
            crn_email: result[0].Email_ID,
            crn_id: result[0].CustID,
            company_id: result[0].company_id,
            username: result[0].user_name,
            crn_type: result[0].type,
            validity: '6d',
            roleName: result[0].role_name,
            other: {
              m_v: result[0].isMobileConfirmed == "1" ? true : false,
              e_v: result[0].isEmailConfirmed == "1" ? true : false,
              c_p: result[0].ask_change_password == "Y" ? false : true,
            },
          },
          message:
            "Login Successful, Please wait we'r restoring your information...",
          status: "success",
          success: true,
        });
      } else {
        await transactionInvt.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "Invalid OTP",
        });
      }
    } else {
      await transactionInvt.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Invalid Credentials",
      });
    }
  } catch (err) {
    try { await transactionInvt.rollback(); } catch (_) {}
    if (transactionOt) {
      try { await transactionOt.rollback(); } catch (_) {}
    }
    if (err.code === "LOGIN_TRACK") {
      return res.json({ success: false, status: "error", message: LOGIN_TRACK_MSG });
    }
    if (err.code === "SESSION_LIMIT") {
      return res.json({ success: false, status: "error", message: err.message });
    }
    return helper.errorResponse(res, err);
  }
});

//////////////////////////////////

// NEW USER REGISTRATION
router.post("/register", [auth.isAuthorized], async (req, res) => {
  if (req.body.username == "") {
    return res.json({
      status: "error",
      success: false,
      message: "user fullname is required..",
    });
  }
  if (req.body.mobile == "") {
    return res.json({
      status: "error",
      success: false,
      message: "user mobile number is required..",
    });
  }
  if (
    req.body.mobile.toString().length < 10 ||
    req.body.mobile.toString().length > 10
  ) {
    return res.json({
      status: "error",
      success: false,
      message:
        "user mobile number would be in 10 digit without leading with 0 or country code (91) or any speacial characters",
    });
  }
  if (!/^[6-9][0-9]{9}$/.test(req.body.mobile)) {
    return res.json({
      status: "error",
      success: false,
      message: "user mobile number is not valid or fit on the pattern..",
    });
  }
  if (req.body.email == "") {
    return res.json({
      status: "error",
      success: false,
      message: "user e-mail address is required..",
    });
  }
  if (
    !/^([a-zA-Z0-9_\.\-])+\@(([a-zA-Z0-9\-])+\.)+([a-zA-Z0-9]{2,4})+$/.test(
      req.body.email,
    )
  ) {
    return res.json({
      status: "error",
      success: false,
      message: "user e-mail address is not valid or fit on the pattern..",
    });
  }
  if (req.body.password == "") {
    return res.json({
      status: "error",
      success: false,
      message: "user temporary password is required..",
    });
  }
  if (
    !/^(?=.*\d)(?=.*[!@#$%^&*])(?=.*[a-z])(?=.*[A-Z]).{8,}$/.test(
      req.body.password,
    )
  ) {
    return res.json({
      status: "error",
      success: false,
      message:
        "user temporary password is not valid or fit on the pattern (must 8 char min length with 1 UPPERCASE, 1 lowercase, 1 special char [!@#$%^&*])",
    });
  }
  if (req.body.asktochange !== "on" && req.body.asktochange !== "off") {
    return res.json({
      status: "error",
      success: false,
      message:
        "what would the password status after user success login (force to change OR not ?)",
    });
  }

  if (
    req.body.verification !== "1" &&
    req.body.verification !== "0" &&
    req.body.verification !== "M" &&
    req.body.verification !== "E"
  ) {
    return res.json({
      status: "error",
      success: false,
      message:
        "what would the user verification status (mobile or email or both ?)",
    });
  }

  const t = await invtDB.transaction();

  try {
    let mobile_status, email_status, password_status;
    if (req.body.verification === "1") {
      mobile_status = "1";
      email_status = "1";
    } else if (req.body.verification === "0") {
      mobile_status = "0";
      email_status = "0";
    } else if (req.body.verification === "M") {
      mobile_status = "1";
      email_status = "0";
    } else if (req.body.verification === "E") {
      mobile_status = "0";
      email_status = "1";
    } else {
      return res.json({
        status: "error",
        success: false,
        message:
          "something happend wrong while selecting verification status (mobile or email or both ?)",
      });
    }

    if (req.body.asktochange === "on") {
      password_status = "Y";
    } else {
      password_status = "N";
    }

    let stmt1 = await invtDB.query(
      "SELECT * FROM `admin_login` WHERE `Mobile_No` = :mobile",
      {
        replacements: { mobile: req.body.mobile },
        type: invtDB.QueryTypes.SELECT,
      },
    );
    if (stmt1.length > 0) {
      t.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "user mobile number already exist..",
      });
    } else {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `admin_login` WHERE `Email_ID` = :email",
        {
          replacements: { email: req.body.email },
          type: invtDB.QueryTypes.SELECT,
        },
      );
      if (stmt2.length > 0) {
        t.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "user e-mail address already exist..",
        });
      } else {
        // GENERATE USER ID
        var newUserID =
          "CRN" + req.body.mobile.substr(req.body.mobile.length - 7);
        let stmt3 = await invtDB.query(
          "SELECT * FROM `admin_login` WHERE `CustID` = :custid",
          {
            replacements: { custid: newUserID },
            type: invtDB.QueryTypes.SELECT,
          },
        );
        if (stmt3.length > 0) {
          t.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "alloting new user-id already exist.. (Opinion: use different mobile number)",
          });
        } else {
          let stmt4 = await invtDB.query(
            "INSERT INTO `admin_login` (`user_name`, `Mobile_No`, `Email_ID`, `Password`, `temp_password`, `ask_change_password`, `isMobileConfirmed`, `isEmailConfirmed`, `CustID`, `reg_date`, `login_status`, project  , vendor_id) VALUES (:fullname, :mobile, :email, :password, :temppassword, :askToChangePassword, :mobileVerified, :emailVerified, :custid, :regdate, :status, :project , :vendor)",
            {
              replacements: {
                fullname: req.body.username,
                mobile: req.body.mobile,
                email: req.body.email,
                password: await bcrypt.hash(req.body.password, 10),
                temppassword: req.body.password,
                askToChangePassword: password_status,
                mobileVerified: mobile_status,
                emailVerified: email_status,
                custid: newUserID,
                regdate: moment().format("dddd Do of MMMM YYYY hh:mm:ss A"),
                status: "0", // 1 = active, 0 = inactive
                project: req.body.project,
                vendor: req.body.vendor,
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: t,
            },
          );
          if (stmt4.length > 0) {
            sms.AccountCreated(
              "91" + req.body.mobile,
              "growthX",
              req.body.username,
              req.body.email,
              req.body.password,
              "https://oakter.mscorpres.com",
            );
            t.commit();
            return res.json({
              status: "success",
              success: true,
              message:
                "user registration completed..\nalloting UserID: " +
                newUserID +
                " & credentials has been sent through Mobile/E-mail as well..",
            });
          } else {
            t.rollback();
            return res.json({
              status: "error",
              success: false,
              message:
                "an error occured while creating new user, pls contact to developer...",
            });
          }
        }
      }
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// FETCH THE USER FOR APPROVAL PENDING
router.post("/signup/fetch", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query(
      "SELECT `user_name`,`Mobile_No`,`Email_ID`,`login_status`,`CustID`,`reg_date`, `project` FROM `admin_login` WHERE login_status = '0' AND company_id = '--' ORDER BY `user_name` ASC",
      {
        type: invtDB.QueryTypes.SELECT,
      },
    );
    if (stmt.length > 0) {
      let finalResult = [];
      stmt.forEach(async (element) => {
        finalResult.push({
          username: element.user_name,
          custID: element.CustID,
          email: element.Email_ID,
          mobile: element.Mobile_No,
          regDtTm: element.reg_date,
          type: element.project == "vendor" ? "Vendor" : "User",
        });
      });
      if (finalResult.length == stmt.length) {
        return res.json({
          status: "success",
          success: true,
          data: finalResult,
        });
      }
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "no any user data found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// NEW SINGUP BY USER
router.post("/singup/new", async (req, res) => {
  if (req.body.username == "") {
    return res.json({
      status: "error",
      success: false,
      message: "user fullname is required..",
    });
  }
  if (req.body.mobile == "") {
    return res.json({
      status: "error",
      success: false,
      message: "user mobile number is required..",
    });
  }
  if (
    req.body.mobile.toString().length < 10 ||
    req.body.mobile.toString().length > 10
  ) {
    return res.json({
      status: "error",
      success: false,
      message:
        "user mobile number would be in 10 digit without leading with 0 or country code (91) or any speacial characters",
    });
  }
  if (!/^[6-9][0-9]{9}$/.test(req.body.mobile)) {
    return res.json({
      status: "error",
      success: false,
      message: "user mobile number is not valid or fit on the pattern..",
    });
  }
  if (req.body.email == "") {
    return res.json({
      status: "error",
      success: false,
      message: "user e-mail address is required..",
    });
  }
  if (
    !/^([a-zA-Z0-9_\.\-])+\@(([a-zA-Z0-9\-])+\.)+([a-zA-Z0-9]{2,4})+$/.test(
      req.body.email,
    )
  ) {
    return res.json({
      status: "error",
      success: false,
      message: "user e-mail address is not valid or fit on the pattern..",
    });
  }
  if (req.body.password == "") {
    return res.json({
      status: "error",
      success: false,
      message: "user temporary password is required..",
    });
  }
  if (
    !/^(?=.*\d)(?=.*[!@#$%^&*])(?=.*[a-z])(?=.*[A-Z]).{8,}$/.test(
      req.body.password,
    )
  ) {
    return res.json({
      status: "error",
      success: false,
      message:
        "user temporary password is not valid or fit on the pattern (must 8 char min length with 1 UPPERCASE, 1 lowercase, 1 special char [!@#$%^&*])",
    });
  }

  const t = await invtDB.transaction();

  try {
    let stmt1 = await invtDB.query(
      "SELECT * FROM `admin_login` WHERE `Mobile_No` = :mobile",
      {
        replacements: { mobile: req.body.mobile },
        type: invtDB.QueryTypes.SELECT,
      },
    );
    if (stmt1.length > 0) {
      t.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "user mobile number already exist..",
      });
    } else {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `admin_login` WHERE `Email_ID` = :email",
        {
          replacements: { email: req.body.email },
          type: invtDB.QueryTypes.SELECT,
        },
      );
      if (stmt2.length > 0) {
        t.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "user e-mail address already exist..",
        });
      } else {
        // GENERATE USER ID
        var newUserID =
          "CRN" + req.body.mobile.substr(req.body.mobile.length - 7);
        let stmt3 = await invtDB.query(
          "SELECT * FROM `admin_login` WHERE `CustID` = :custid",
          {
            replacements: { custid: newUserID },
            type: invtDB.QueryTypes.SELECT,
          },
        );
        if (stmt3.length > 0) {
          t.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "alloting new user-id already exist.. (Opinion: use different mobile number)",
          });
        } else {
          let stmt4 = await invtDB.query(
            "INSERT INTO `admin_login` (`user_name`, `Mobile_No`, `Email_ID`, `Password`, `temp_password`, `ask_change_password`, `CustID`, `reg_date`, project  , vendor_id) VALUES (:fullname, :mobile, :email, :password, :temppassword, :askToChangePassword, :custid, :regdate, :project , :vendor)",
            {
              replacements: {
                fullname: req.body.username,
                mobile: req.body.mobile,
                email: req.body.email,
                password: await bcrypt.hash(req.body.password, 10),
                temppassword: req.body.password,
                askToChangePassword: "--",
                custid: newUserID,
                regdate: moment().format("dddd Do of MMMM YYYY hh:mm:ss A"),
                project: "--",
                vendor: "--",
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: t,
            },
          );
          if (stmt4.length > 0) {
            t.commit();
            return res.json({
              status: "success",
              success: true,
              message:
                "Registration Completed..\nYou will receive the account activation confirmation shortly after internal verification",
            });
          } else {
            t.rollback();
            return res.json({
              status: "error",
              success: false,
              message:
                "an error occured while creating new user, pls contact to developer...",
            });
          }
        }
      }
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// APPROVE NEW SINGUP BY ADMIN
router.post("/signup/approve/:crnID", [auth.isAuthorized], async (req, res) => {
  // VALIDATION
  if (req.params.crnID == "") {
    return res.json({
      status: "error",
      success: false,
      message: "new registration required parameter missing",
    });
  }
  if (req.body.username == "") {
    return res.json({
      status: "error",
      success: false,
      message: "user fullname is required..",
    });
  }
  if (req.body.mobile == "") {
    return res.json({
      status: "error",
      success: false,
      message: "user mobile number is required..",
    });
  }
  if (
    req.body.mobile.toString().length < 10 ||
    req.body.mobile.toString().length > 10
  ) {
    return res.json({
      status: "error",
      success: false,
      message:
        "user mobile number would be in 10 digit without leading with 0 or country code (91) or any speacial characters",
    });
  }
  if (!/^[6-9][0-9]{9}$/.test(req.body.mobile)) {
    return res.json({
      status: "error",
      success: false,
      message: "user mobile number is not valid or fit on the pattern..",
    });
  }
  if (req.body.email == "") {
    return res.json({
      status: "error",
      success: false,
      message: "user e-mail address is required..",
    });
  }
  if (
    !/^([a-zA-Z0-9_\.\-])+\@(([a-zA-Z0-9\-])+\.)+([a-zA-Z0-9]{2,4})+$/.test(
      req.body.email,
    )
  ) {
    return res.json({
      status: "error",
      success: false,
      message: "user e-mail address is not valid or fit on the pattern..",
    });
  }

  if (
    req.body.verification !== "1" &&
    req.body.verification !== "0" &&
    req.body.verification !== "M" &&
    req.body.verification !== "E"
  ) {
    return res.json({
      status: "error",
      success: false,
      message:
        "what would the user verification status (mobile or email or both ?)",
    });
  }

  const t = await invtDB.transaction();

  try {
    let mobile_status, email_status;
    if (req.body.verification === "1") {
      mobile_status = "1";
      email_status = "1";
    } else if (req.body.verification === "0") {
      mobile_status = "0";
      email_status = "0";
    } else if (req.body.verification === "M") {
      mobile_status = "1";
      email_status = "0";
    } else if (req.body.verification === "E") {
      mobile_status = "0";
      email_status = "1";
    } else {
      return res.json({
        status: "error",
        success: false,
        message:
          "something happend wrong while selecting verification status (mobile or email or both ?)",
      });
    }

    let stmt1 = await invtDB.query(
      "SELECT * FROM `admin_login` WHERE `Mobile_No` = :mobile AND CustID != :crn",
      {
        replacements: { mobile: req.body.mobile, crn: req.params.crnID },
        type: invtDB.QueryTypes.SELECT,
      },
    );
    if (stmt1.length > 0) {
      t.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "user mobile number already exist..",
      });
    } else {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `admin_login` WHERE `Email_ID` = :email AND CustID != :crn",
        {
          replacements: { email: req.body.email, crn: req.params.crnID },
          type: invtDB.QueryTypes.SELECT,
        },
      );
      if (stmt2.length > 0) {
        t.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "user e-mail address already exist..",
        });
      } else {
        // UPDATE QUERY
        let stmt4 = await invtDB.query(
          "UPDATE admin_login SET company_id = :company, user_name = :fullname, Mobile_No = :mobile, Email_ID = :email, isMobileConfirmed = :mobileVerified, isEmailConfirmed = :emailVerified, CustID = :custid, reg_date =:regdate, login_status = '1', project = :project , vendor_id = :vendor WHERE CustID = :custid",
          {
            replacements: {
              company: "COM0001",
              fullname: req.body.username,
              mobile: req.body.mobile,
              email: req.body.email,
              mobileVerified: mobile_status,
              emailVerified: email_status,
              custid: req.params.crnID,
              regdate: moment(new Date())
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD HH:mm:ss"),
              project: req.body.project,
              vendor: req.body.vendor,
            },
          },
        );
        let stmt5 = await otherDB.query(
          "SELECT * FROM `ims_company` WHERE `company_id` = :company_id",
          {
            replacements: { company_id: "COM0001" },
            type: otherDB.QueryTypes.SELECT,
          },
        );
        if (stmt5.length > 0) {
          if (stmt4.length > 0) {
            t.commit();
            return res.json({
              status: "success",
              success: true,
              message:
                "User registration completed..\nCredentials has been sent through Mobile/E-mail",
            });
          } else {
            t.rollback();
            return res.json({
              status: "error",
              success: false,
              message:
                "an error occured while creating new user, pls contact to developer...",
            });
          }
        } else {
          t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "company not exist for registration",
          });
        }
      }
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// REJECT NEW SINGUP BY USER
router.delete(
  "/signup/reject/:crnID",
  [auth.isAuthorized],
  async (req, res) => {
    // VALIDATION
    if (
      req.params.crnID == "" ||
      req.params.crnID == undefined ||
      req.params.crnID == null
    ) {
      return res.json({
        status: "error",
        success: false,
        message: "user rejection required parameter missing",
      });
    }

    try {
      let stmt0 = await invtDB.query(
        "DELETE FROM `admin_login` WHERE `CustID` = :custid AND login_status = '0'",
        {
          replacements: { custid: req.params.crnID },
          type: invtDB.QueryTypes.DELETE,
        },
      );
      return res.json({
        status: "success",
        success: true,
        message: "User Registration rejected",
      });
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  },
);

// LOGOUT
router.post("/signout", async (req, res) => {
  try {
    const transactionOt = await otherDB.transaction();

    if (
      req.body.rate.toString() !== "P" &&
      req.body.rate.toString() !== "G" &&
      req.body.rate.toString() !== "E"
    ) {
      transactionOt.rollback();
      res.json({
        status: "error",
        success: false,
        message:
          "given experience rate was not valid, please reload the page and try again..",
      });
      return;
    }

    let saveRate = await otherDB.query(
      "INSERT INTO `ims_logout_feedback` (`user_id`, `rate`, `insert_dt`) VALUES (:username, :rate, :insert_date)",
      {
        replacements: {
          username: req.body.customer,
          rate: req.body.rate.toString(),
          insert_date: moment().format("YYYY-MM-DD HH:mm:ss"),
        },
        type: otherDB.QueryTypes.INSERT,
        transaction: transactionOt,
      },
    );

    if (saveRate.length > 0) {
      transactionOt.commit();
      res.json({
        message:
          "Logout Successful, Please wait we'r redirecting you out of the IMS door ...",
        status: "success",
        success: true,
      });
      return;
    } else {
      transactionOt.rollback();
      res.json({
        status: "error",
        success: false,
        message: "an error occured while saving your experience rate",
      });
      return;
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

router.post("/vendor/signin", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.json({
        status: "error",
        success: false,
        message: "Username and password are required!",
      });
    }

    const [userRow] = await invtDB.query(
      `SELECT * FROM admin_login 
       WHERE (Email_ID = :data OR Mobile_No = :data OR CustID = :data) 
       AND project = 'vendor'`,
      { replacements: { data: username }, type: invtDB.QueryTypes.SELECT },
    );

    if (!userRow) {
      return res.json({
        status: "error",
        success: false,
        message: "We couldn't fetch any account associated to your provided credentials",
      });
    }

    if (userRow.project !== "vendor" || userRow.vendor_id === "--") {
      return res.json({
        status: "error",
        success: false,
        message: "We couldn't fetch any account associated to your provided credentials",
      });
    }

    // Password check
    const ok =
      (await bcrypt.compare(password, userRow.Password)) ||
      (userRow.temp_password === password && userRow.temp_password !== "--");

    if (!ok) {
      await invtDB.query(
        "UPDATE admin_login SET Attempt=Attempt+1 WHERE CustID=:id",
        { replacements: { id: userRow.CustID } },
      );
      return res.json({
        status: "error",
        success: false,
        message: "an invalid username or password combinations",
      });
    }

    if (userRow.login_status == 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Your account suspended due to some security reasons.\nPlease re-generate your password OR contact your system administrator.",
      });
    }
    if (userRow.Attempt >= 6) {
      return res.json({
        status: "error",
        success: false,
        message: "Your account has been deactivated for 3hrs due to (6) consecutive unsuccessful attempts",
      });
    }
    if (userRow.isEmailConfirmed == 0) {
      return res.json({
        status: "error",
        success: false,
        message: "You haven't verified your email yet. Please verify or contact administrator.",
      });
    }

    await invtDB.query(
      "UPDATE admin_login SET Attempt=0 WHERE CustID=:id",
      { replacements: { id: userRow.CustID } },
    );

    const rawToken = jwt.sign(
      {
        crn_mobile: userRow.Mobile_No,
        crn_email: userRow.Email_ID,
        crn_id: userRow.CustID,
        company_id: userRow.company_id,
        user_name: userRow.user_name,
        vendor: userRow.vendor_id,
        crn_type: userRow.type,
      },
      process.env.TOKEN_SECRET,
      { expiresIn: "6d" },
    );
    
    const token = `Bearer ${rawToken}`;

    
    await insertLoginTrack(userRow.CustID, rawToken, userRow.CustID, "vendorLogin", req);

    return res.json({
      success: true,
      status: "success",
      message: "Login Successful, Please wait we're gathering your information...",
      data: {
        token,
        vendor: userRow.vendor_id,
        crn_mobile: userRow.Mobile_No,
        crn_email: userRow.Email_ID,
        crn_id: userRow.CustID,
        company_id: userRow.company_id,
        username: userRow.user_name,
        crn_type: userRow.type,
        other: {
          m_v: userRow.isMobileConfirmed === "1" ? "C" : "P",
          e_v: userRow.isEmailConfirmed === "1" ? "C" : "P",
          c_p: userRow.ask_change_password === "Y" ? "P" : "C",
        },
      },
    });

  } catch (e) {
    if (e.code === "LOGIN_TRACK") {
      return res.json({ success: false, status: "error", message: LOGIN_TRACK_MSG });
    }
    if (e.code === "SESSION_LIMIT") {
      return res.json({ success: false, status: "error", message: e.message });
    }
    return helper.errorResponse(res, e);
  }
});

router.post("/redirectVendor", [auth.isAuthorized], async (req, res) => {
  try {
    const validator = new Validator(req.body, {
      currentPassword: "required",
      vendorCode: "required",
    });

    if (validator.fails()) {
      return res
        .status(403)
        .send(Object.values(validator.errors.all())[0].join());
    }

    const fetchUser = await invtDB.query(
      "SELECT * FROM admin_login WHERE CustID = :user_id",
      {
        replacements: { user_id: req.logedINUser },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (fetchUser.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "user not found",
      });
    }

    const userpassword_hash = await bcrypt.compare(
      req.body.currentPassword,
      fetchUser[0].Password,
    );
    if (!userpassword_hash) {
      return res.json({
        status: "error",
        success: false,
        message: "wrong password",
      });
    }

    const rawToken = jwt.sign(
      {
        crn_mobile: fetchUser[0].Mobile_No,
        crn_email: fetchUser[0].Email_ID,
        crn_id: fetchUser[0].CustID,
        company_id: fetchUser[0].company_id,
        user_name: fetchUser[0].user_name,
        vendor: req.body.vendorCode,
      },
      process.env.TOKEN_SECRET,
      { expiresIn: "6d" },
    );

    const token = `Bearer ${rawToken}`;

    return res.json({ token });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

router.post("/forgot_password", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();
  try {
    if (req.body.username == "") {
      transaction.rollback();
      return res.json({
        success: false,
        message: "Username is required..",
        data: null,
      });
    }

    if (req.body.new_password == "") {
      transaction.rollback();
      return res.json({
        success: false,
        message: "Password is required..",
        data: null,
      });
    }

    if (
      !/^(?=.*\d)(?=.*[!@#$%^&*])(?=.*[a-z])(?=.*[A-Z]).{8,}$/.test(
        req.body.new_password,
      )
    ) {
      return res.json({
        success: false,
        message:
          "user password is not valid or fit on the pattern (must 8 char min length with 1 UPPERCASE, 1 lowercase, 1 special char [!@#$%^&*])",
        data: null,
      });
    }

    let result = await invtDB.query(
      "SELECT * FROM `admin_login` WHERE `Email_ID` = :data OR `Mobile_No` = :data OR `CustID` = :data",
      {
        replacements: { data: req.body.username },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (result.length === 0) {
      transaction.rollback();
      return res.json({
        success: false,
        message:
          "We could not fetch any account associated to your provided credentials",
        data: null,
      });
    }
    if (result[0].login_status == "0") {
      transaction.rollback();
      return res.json({
        success: false,
        message:
          "Your account suspended due to some security reasons.\nPlease contact to your system administrator",
        data: null,
      });
    }

    let update_pass = await invtDB.query(
      "UPDATE `admin_login` SET `Password` = :password, `temp_password` = :temp_password, `update_date` = :upadte_dt WHERE `Email_ID` = :data OR `Mobile_No` = :data OR `CustID` = :data",
      {
        replacements: {
          data: req.body.username,
          password: await bcrypt.hash(req.body.new_password, 10),
          temp_password: req.body.new_password,
          upadte_dt: moment().format("dddd Do of MMMM YYYY hh:mm:ss A"),
        },
        type: invtDB.QueryTypes.UPDATE,
      },
    );

    if (update_pass.length === 0) {
      transaction.rollback();
      return res.json({
        success: false,
        message: "Error while updating password",
        data: null,
      });
    }

    transaction.commit();
    return res.json({
      success: true,
      message: "Password reset successfully",
      data: null,
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//SSO Authentication
// router.get("/IMS", [auth.ssoAuthorized], async (req, res) => {
//   try {
//     let stmt = await invtDB.query(
//       "SELECT * FROM `admin_login` WHERE `Email_ID` = :data OR `Mobile_No` = :data OR `CustID` = :data",
//       {
//         replacements: { data: req.logedINUser },
//         type: invtDB.QueryTypes.SELECT,
//       },
//     );
//     if (stmt.length === 0) {
//       return res.json({
//         success: false,
//         message:
//           "We couldn&#39;t fetch any account associated to your provided credentials",
//         data: null,
//       });
//     }
//     if (stmt[0].login_status == 0) {
//       res.json({
//         success: false,
//         message:
//           "Your account suspended due to some security reasons.\nPlease re-generate your password OR contact to your system administrator",
//         data: null,
//       });
//       return;
//     } else if (stmt[0].Attempt >= 6) {
//       res.json({
//         success: false,
//         message:
//           "Your account has been deactivated for 3hrs due to (6) consecutive unsuccessful attempts",
//         data: null,
//       });
//       return;
//     } else {
//       const ipAddr =
//         req.headers["x-forwarded-for"]?.split(",").shift() ||
//         req.socket?.remoteAddress;
//       let response = await axios.get(`http://ip-api.com/json/${ipAddr}`);

//       const { country, region, city, lat, lon, isp, org, as } = response.data;

//       const token = jwt.sign(
//         {
//           crn_mobile: req.logedINMobile,
//           crn_email: req.logedINEmail,
//           crn_id: req.logedINUser,
//           company_id: req.logedINCompany,
//           user_name: stmt[0].user_name,
//         },
//         process.env.TOKEN_SECRET,
//         { expiresIn: "1d" },
//       );

//       await insertLoginTrack(stmt[0].CustID, token, stmt[0].CustID);

//       await invtDB.query(
//         "INSERT INTO admin_logs( random_count, CustID, Mobile, Email_ID, LogID, IProtocol, Log_Time, Log_Out, Service, Organization, ASN_No, Country, Region_st, Rg_City, Longitudinal, Latitude, Status) VALUES ( :random_count , :CustID, :Mobile, :Email_ID, :LogID, :IProtocol, :Log_Time, :Log_Out, :Service, :Organization, :ASN_No, :Country, :Region_st, :Rg_City, :Longitudinal, :Latitude, :status  )",
//         {
//           replacements: {
//             random_count: helper.getUniqueNumber(),
//             CustID: req.logedINUser,
//             Mobile: req.logedINMobile,
//             Email_ID: req.logedINEmail,
//             LogID: req.logedINUser,
//             IProtocol: ipAddr,
//             Log_Time: moment().format("YYYY-MM-DD HH:mm:ss"),
//             Log_Out: "",
//             Service: isp ?? "--",
//             Organization: org ?? "--",
//             ASN_No: as ?? "--",
//             Country: country ?? "--",
//             Region_st: region ?? "--",
//             Rg_City: city ?? "--",
//             Longitudinal: lon ?? "--",
//             Latitude: lat ?? "--",
//             status: "success",
//           },
//           type: invtDB.QueryTypes.INSERT,
//         },
//       );

//       res.json({
//         data: {
//           token: token,
//           url: "https://alwar.mscorpres.com/",
//           profile: {
//             photo: "--",
//             displayName: stmt[0].user_name,
//           },
//           department: stmt[0].department,
//           crn_id: req.logedINUser,
//           // settings: await get_setings(),
//           crn_type: stmt[0].type,
//         },
//         message:
//           "Login Successful, Please wait we'r gathering your information...",
//         success: true,
//       });
//     }
//   } catch (err) {
//     if (err.code === "LOGIN_TRACK") {
//       return res.json({
//         success: false,
//         message: LOGIN_TRACK_MSG,
//         data: null,
//       });
//     }
//     return res.json({
//       success: false,
//       message: "Internal Error Pls contact your developer",
//       data: null,
//       error: err.stack,
//     });
//   }
// });

//send otp on email
router.get("/sendOtp", async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      email: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: helper.firstErrorValidatorjs(validation),
        data: null,
      });
    }

    const fetchUser = await invtDB.query(
      "SELECT * FROM admin_login WHERE Email_ID = :email AND login_status = '1'",
      {
        replacements: { email: req.query.email },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (fetchUser.length <= 0) {
      return res.json({
        success: false,
        message: "User either suspended or not exist with this credentials",
        data: null,
      });
    }

    const currentTime = moment().format("YYYY-MM-DD HH:mm:ss");

    if (
      fetchUser[0].email_otp_time != "" &&
      fetchUser[0].email_otp_time != null
    ) {
      const checkDifference = moment(currentTime).diff(
        moment(fetchUser[0].email_otp_time),
        "minutes",
      );

      if (checkDifference < 10) {
        const sendMail = await helper.sendMail(
          req.query.email,
          null,
          "OTP for update password",
          `Hi ${fetchUser[0].user_name} <br/> <br/> Your OTP for update password is ${fetchUser[0].email_otp}. Otp is valid for 10 minutes.`,
        );

        return res.json({
          success: true,
          message: "Otp shared on email",
          data: null,
        });
      }
    }

    const otp = Math.floor(100000 + Math.random() * 900000);

    const updateUser = await invtDB.query(
      "UPDATE admin_login SET email_otp = :otp , email_otp_time = :time WHERE Email_ID = :email",
      {
        replacements: {
          otp: otp,
          email: req.query.email,
          time: moment().format("YYYY-MM-DD HH:mm:ss"),
        },
        type: invtDB.QueryTypes.UPDATE,
      },
    );

    if (updateUser.length <= 0) {
      return res.json({
        success: false,
        message: "Error while sending otp",
        data: null,
      });
    }

    const sendMail = await helper.sendMail(
      req.query.email,
      null,
      "OTP for update password",
      `Hi ${fetchUser[0].user_name} <br/> <br/> Your OTP for update password is ${otp}. Otp is valid for 10 minutes.`,
    );

    return res.json({
      success: true,
      message: "Please check your email for OTP",
      data: null,
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//verify otp

router.get("/verifyOtp", async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      email: "required",
      otp: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: helper.firstErrorValidatorjs(validation),
        data: null,
      });
    }

    const fetchUser = await invtDB.query(
      "SELECT * FROM admin_login WHERE Email_ID = :email AND login_status = '1'",
      {
        replacements: { email: req.query.email },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (fetchUser.length <= 0) {
      return res.json({
        success: false,
        message: "User either suspended or not exist with this credentials",
        data: null,
      });
    }

    if (fetchUser[0].email_otp != req.query.otp) {
      return res.json({
        success: false,
        message: "Invalid otp",
        data: null,
      });
    }

    const currentTime = moment().format("YYYY-MM-DD HH:mm:ss");

    if (
      fetchUser[0].email_otp_time != "" &&
      fetchUser[0].email_otp_time != null
    ) {
      const checkDifference = moment(currentTime).diff(
        moment(fetchUser[0].email_otp_time),
        "minutes",
      );

      if (checkDifference >= 10) {
        return res.json({
          success: false,
          message: "Otp expired",
          data: null,
        });
      }
    }

    const updateUser = await invtDB.query(
      "UPDATE admin_login SET email_otp = :otp , email_otp_time = :time , is_otp_verified = 'true' WHERE Email_ID = :email",
      {
        replacements: {
          otp: null,
          email: req.query.email,
          time: null,
        },
        type: invtDB.QueryTypes.UPDATE,
      },
    );

    if (updateUser.length <= 0) {
      return res.json({
        success: false,
        message: "Error while verifying otp",
        data: null,
      });
    }

    return res.json({
      success: true,
      message: "Otp verified successfully",
      data: null,
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//update password

router.patch("/updatePassword", async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      email: "required",
      password:
        "required|regex:^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@#$_])[A-Za-z\\d@#$_]{8,16}$",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: helper.firstErrorValidatorjs(validation),
        data: null,
      });
    }

    const fetchUser = await invtDB.query(
      "SELECT * FROM admin_login WHERE Email_ID = :email AND login_status = '1'",
      {
        replacements: { email: req.body.email },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (fetchUser.length <= 0) {
      return res.json({
        success: false,
        message: "User either suspended or not exist with this credentials",
        data: null,
      });
    }

    if (fetchUser[0].is_otp_verified != "true") {
      return res.json({
        success: false,
        message: "Please verify otp first",
        data: null,
      });
    }

    const updateUser = await invtDB.query(
      "UPDATE admin_login SET Password = :password , is_otp_verified = 'false', Attempt = 0 WHERE Email_ID = :email",
      {
        replacements: {
          password: await bcrypt.hash(req.body.password, 10),
          email: req.body.email,
        },
        type: invtDB.QueryTypes.UPDATE,
      },
    );

    if (updateUser.length <= 0) {
      return res.json({
        success: false,
        message: "Error while updating password",
        data: null,
      });
    }

    return res.json({
      success: true,
      message: "Password updated successfully",
      data: null,
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

module.exports = router;
