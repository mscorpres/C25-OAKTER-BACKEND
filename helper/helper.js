require("dotenv").config();

const nodemailer = require("nodemailer");
const fs = require("fs");
const { otherDB, invtDB } = require("../config/db/connection");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const axios = require("axios");
const { validate } = require("deep-email-validator");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE,
  auth: {
    user: process.env.SMTP_USERID,
    pass: process.env.SMTP_USERPASS,
  },
});

// exports.dateFormatDMY = function (date) {
//   return date.getDate() + "-" + date.getMonth() + "-" + date.getFullYear();
// };

// exports.dateFormatDMYHIS = function (date) {
//   return (
//     date.getDate() +
//     "-" +
//     date.getMonth() +
//     "-" +
//     date.getFullYear() +
//     " " +
//     date.getHours() +
//     ":" +
//     date.getMinutes() +
//     ":" +
//     date.getSeconds()
//   );
// };

// exports.dateFormat = function (date) {
//   return date.getMonth() + "/" + date.getDate() + "/" + date.getFullYear();
// };

exports.getShortDate = function (date) {
  return (
    date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate()
  );
};

exports.daeFormat = function (date) {
  return (
    date.getFullYear() +
    "-" +
    (date.getMonth() + 1) +
    "-" +
    date.getDate() +
    " " +
    date.getHours() +
    ":" +
    date.getMinutes() +
    ":" +
    date.getSeconds()
  );
};

exports.getOs = function (req) {
  var ua = req.headers["user-agent"],
    $ = {};

  if (/mobile/i.test(ua)) $.Mobile = true;

  if (/like Mac OS X/.test(ua)) {
    $.iOS = /CPU( iPhone)? OS ([0-9\._]+) like Mac OS X/
      .exec(ua)[2]
      .replace(/_/g, ".");
    $.iPhone = /iPhone/.test(ua);
    $.iPad = /iPad/.test(ua);
  }

  if (/Android/.test(ua)) $.Android = /Android ([0-9\.]+)[\);]/.exec(ua)[1];

  if (/webOS\//.test(ua)) $.webOS = /webOS\/([0-9\.]+)[\);]/.exec(ua)[1];

  if (/(Intel|PPC) Mac OS X/.test(ua))
    $.Mac =
      /(Intel|PPC) Mac OS X ?([0-9\._]*)[\)\;]/
        .exec(ua)[2]
        .replace(/_/g, ".") || true;

  if (/Windows NT/.test(ua))
    $.Windows = /Windows NT ([0-9\._]+)[\);]/.exec(ua)[1];

  return $;
};

exports.getIp = function (req) {
  return req.headers["x-forwarded-for"] || req.connection.remoteAddress;
};

exports.getBrowser = function (req) {
  var ua = req.headers["user-agent"],
    $ = {};

  if (/MSIE|Trident/.test(ua)) $.name = "Internet Explorer";
  else if (/Firefox/.test(ua)) $.name = "Firefox";
  else if (/Chrome/.test(ua)) $.name = "Chrome";
  else if (/Safari/.test(ua)) $.name = "Safari";
  else if (/Opera/.test(ua)) $.name = "Opera";
  else if (/OPR/.test(ua)) $.name = "Opera";
  else if (/Edge/.test(ua)) $.name = "Edge";
  else if (/Yandex/.test(ua)) $.name = "Yandex";
  else if (/Konqueror/.test(ua)) $.name = "Konqueror";
  else if (/CriOS/.test(ua)) $.name = "Chrome";
  else if (/rv:11/.test(ua)) $.name = "IE";
  else $.name = "Unknown";

  if (/Trident/.test(ua)) $.version = /rv:([0-9\.]+)/.exec(ua)[1];
  else if (/MSIE/.test(ua)) $.version = /MSIE ([0-9\.]+)/.exec(ua)[1];
  else if (/Firefox/.test(ua)) $.version = /Firefox\/([0-9\.]+)/.exec(ua)[1];
  else if (/Chrome/.test(ua)) $.version = /Chrome\/([0-9\.]+)/.exec(ua)[1];
  else if (/OPR/.test(ua)) $.version = /OPR\/([0-9\.]+)/.exec(ua)[1];
  else if (/Yandex/.test(ua)) $.version = /Yandex\/([0-9\.]+)/.exec(ua)[1];
  else if (/Konqueror/.test(ua))
    $.version = /Konqueror\/([0-9\.]+)/.exec(ua)[1];
  else if (/Safari/.test(ua)) $.version = /Version\/([0-9\.]+)/.exec(ua)[1];
  else if (/CriOS/.test(ua)) $.version = /CriOS\/([0-9\.]+)/.exec(ua)[1];
  else if (/Edge/.test(ua)) $.version = /Edge\/([0-9\.]+)/.exec(ua)[1];
  else $.version = "Unknown";

  if ($.name == "IE") {
    $.version = $.version.split(".")[0];
  }

  return $;
};

// random number generator
exports.randomNumber = function (min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// get unique number from date
exports.getUniqueNumber = function () {
  let date = new Date();
  return `${date.getFullYear()}${date.getMonth()}${date.getDate()}${date.getHours()}${date.getMinutes()}${date.getSeconds()}${date.getMilliseconds()}`;
};

//FILE SIZE [27-08-2022]
exports.fileSize = function (bytes, decimalPoint) {
  if (bytes == 0) return "0 Bytes";
  var k = 1000,
    dm = decimalPoint || 2,
    sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"],
    i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
};

// GST CALCULATION HELPER
exports.gstCalculation = (rate, val, type) => {
  let data = {
    cgst: "0",
    sgst: "0",
    igst: "0",
  };
  if (isNaN(rate) && isNaN(val)) {
    return 0;
  }

  if (type == "0") {
    return data;
  }

  if (typeof type === "string" && type.length > 0) {
    if (type === "L") {
      data.cgst = data.sgst = ((rate * val) / 100 / 2).toFixed(2);
      data.igst = "0";
      return data;
    } else if (type === "I") {
      data.cgst = data.sgst = "0";
      data.igst = ((rate * val) / 100).toFixed(2);
      return data;
    } else {
      return 0;
    }
  }
  return data;
};

// 15-07-2022
exports.sendMail = async function (
  to,
  cc = null,
  subject,
  message,
  attachments = null
) {
  let mail_res;

  mail_res = await transporter
    .sendMail({
      from: process.env.SMTP_USERNAME + process.env.SMTP_USERID,
      to: to,
      cc: cc,
      subject: subject,
      html: message,
      attachments: attachments,
    })
    .then((info) => {
      return {
        code: 200,
        messageId: info.messageId,
      };
    })
    .catch((err) => {
      return {
        code: 500,
        error: err,
      };
    });
  return mail_res;
};

// 17-07-2022
exports.preg_match = function (regex, str) {
  return new RegExp(regex).test(str);
};

// 18-07-2022
exports.truncateWithEllipse = function (text, max) {
  return text.substr(0, max - 1) + (text.length > max ? "..." : "");
};

exports.random_color = function () {
  let letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
};

exports.amount_to_word = function (amountInDigits) {
  var th = ["", "Thousand", "Million", "Billion", "Trillion"];
  var dg = [
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
  ];
  var tn = [
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  var tw = [
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];
  function toWords(s) {
    s = s.toString();
    s = s.replace(/[\, ]/g, "");
    if (s != parseFloat(s)) return "not a number";
    var x = s.indexOf(".");
    if (x == -1) x = s.length;
    if (x > 15) return "too big";
    var n = s.split("");
    var str = "";
    var sk = 0;
    for (var i = 0; i < x; i++) {
      if ((x - i) % 3 == 2) {
        if (n[i] == "1") {
          str += tn[Number(n[i + 1])] + " ";
          i++;
          sk = 1;
        } else if (n[i] != 0) {
          str += tw[n[i] - 2] + " ";
          sk = 1;
        }
      } else if (n[i] != 0) {
        str += dg[n[i]] + " ";
        if ((x - i) % 3 == 0) str += "Hundred ";
        sk = 1;
      }
      if ((x - i) % 3 == 1) {
        if (sk) str += th[(x - i - 1) / 3] + " ";
        sk = 0;
      }
    }
    if (x != s.length) {
      var y = s.length;
      str += "Point ";
      for (var i = x + 1; i < y; i++) str += dg[n[i]] + " ";
    }
    return str.replace(/\s+/g, " ");
  }

  return toWords(amountInDigits);
};

exports.saveLogs = async function (db, message, req, transaction) {
  let result = await db
    .query(
      "INSERT INTO `ims_invt_loggers` ( `logger_key`, `insert_date`, `insert_by`, `message`) VALUES (:log_key, :insert_key, :insert_by, :message)",
      {
        replacements: {
          log_key: exports.getUniqueNumber(),
          insert_key: new Date(),
          insert_by: req.logedINUser,
          message: message,
        },
        transaction: transaction,
        type: db.QueryTypes.INSERT,
      }
    )
    .then(function (result) {
      if (result.length > 0) {
        return true;
      } else {
        throw "Insertion Of Loggers is failed";
      }
    })
    .catch(function (err) {
      console.log("Error in save log ", err);
      return false;
    });
  return result;
};

// 18-09-2022
// exports.mxValidation = async function (email) {
// 	dns.resolve(email.split("@")[1], "MX", function (err, addresses) {
// 		if (err) {
// 			//res.json({ code: 500, message: `e-mail address '${email}' not exists, seems this is a disposal e-mail`, status: "error" });
// 			return false;
// 		} else if (addresses && addresses.length > 0) {
// 			return true;
// 		}
// 	});
// };

// 20-09-2022
exports.number = function (number) {
  if (number == Math.floor(number)) {
    return Number(number);
  } else {
    return Number(Number(number).toFixed(4).replace(/\.00$/, ""));
  }
};

exports.strCharValid = function (str) {
  const arr = ["'", "`", ":"];
  for (let i = 0; i < arr.length; i++) {
    if (str.indexOf(arr[i]) >= 0) {
      return `character that you have mentioned as [ ${arr[i]} ] not accepted`;
    }
  }
  return true;
};

exports.getCurrentTime = () => {
  return moment(new Date()).tz("Asia/Kolkata").format("HH:mm:ss");
};
exports.getCurrentDate = () => {
  return moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD");
};

exports.getIcon = (filename) => {
  let icon = "file";
  let ext = filename.split(".").pop();
  if (ext == "pdf") {
    icon = "file-pdf";
  } else if (ext == "jpg" || ext == "jpeg" || ext == "png") {
    icon = "file-image";
  } else if (ext == "csv" || ext == "xlsx") {
    icon = "file-excel";
  } else if (ext == "zip" || ext == "rar") {
    icon = "file-archive";
  }
  return icon;
};

// May 26 2023
const zeroPad = (num, pad = 1) => {
  return String(num).padStart(pad, "0");
};

exports.transaction = (code) => {
  const parts = code.split("/");
  // pop the last part off of parts and convert to a number
  const last = parseInt(parts.pop(), 10); // 3
  // return the parts joined with '/'
  // e.g. zeroPad(3 + 1, 4) -> '0004'
  return [...parts, zeroPad(last + 1, 4)].join("/");
};

exports.slugify = function (str) {
  str = str.replace(/^\s+|\s+$/g, ""); // trim leading/trailing white space
  str = str.toLowerCase(); // convert string to lowercase
  str = str
    .replace(/[^a-z0-9 -]/g, "") // remove any non-alphanumeric characters
    .replace(/\s+/g, "-") // replace spaces with hyphens
    .replace(/-+/g, "-"); // remove consecutive hyphens
  return str;
};

exports.reversalSlug = function (thisID) {
  return thisID.replace(/-/g, " ").replace(/\b[a-z]/g, function () {
    return arguments[0].toUpperCase();
  });
};

exports.checkPermission = async (module_id, user_id) => {
  const stmt_check = await otherDB.query(
    "SELECT * FROM user_permission WHERE user_id = :user_id AND module_id = :module_id",
    {
      replacements: { user_id: user_id, module_id: module_id },
      type: otherDB.QueryTypes.SELECT,
    }
  );
  if (stmt_check.length > 0) {
    return true;
  } else {
    return false;
  }
};

exports.firstErrorValidatorjs = (obj) => {
  return Object.values(obj.errors.all())[0][0];
};

exports.financial_year = function () {
  let date = new Date();
  let year = date.getFullYear();
  let month = date.getMonth();
  if (month < 3) {
    year = year - 1;
  }
  return `${year}-${(year + 1).toString().substr(-2)}`;
};

exports.calculateTotalWorkHrs = (startTime, endTime, OtTime) => {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const [otHour, otMinute] = OtTime.split(":").map(Number);

  const start = new Date(0, 0, 0, startHour, startMinute);
  const end = new Date(0, 0, 0, endHour, endMinute);
  const overtime = new Date(0, 0, 0, otHour, otMinute);

  let diff = end.getTime() - start.getTime();
  if (diff < 0) {
    diff += 24 * 60 * 60 * 1000;
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  let totalHours = hours + minutes / 60;

  // Remove the lunch hour subtraction
  // totalHours -= 1;

  totalHours += overtime.getHours() + overtime.getMinutes() / 60; // Add overtime

  // Calculate total time in minutes
  const totalMinutes = Math.floor(totalHours * 60);

  return {
    hrs: Math.floor(totalHours),
    min: Math.round((totalHours - Math.floor(totalHours)) * 60),
    totalTimeInMinutes: totalMinutes,
    days: moment
      .duration(totalMinutes, "minutes")
      .format("DD[d], HH[h]:mm[m]:ss[s]", { trim: false }),
  };
};

exports.getUniqueTxnID = function () {
  return uuidv4();
};

// remove extra spaces from the string
exports.trimString = function (str) {
  return str.replace(/\s+/g, " ").trim();
};

function trimObjectP(obj) {
  if (typeof obj === "string") {
    return obj.trimEnd().trimStart();
  } else if (Array.isArray(obj)) {
    return obj.map(trimObjectP);
  } else if (typeof obj === "object" && obj !== null) {
    for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
        obj[key] = trimObjectP(obj[key]);
      }
    }
  }
  return obj;
}
exports.trimObjectValueStartEnd = (obj) => {
  return trimObjectP(obj);
};

exports.saveComponentInwardData = async function (body, txnId, insertDt) {
  try {
    const data = [];
    const itemLength = body.component?.length || 0;

    for (let i = 0; i < itemLength; i++) {
      let partCodeName = "";
      let partname = "";
      if (body.component[i]) {
        const componentResult = await invtDB.query(
          "SELECT c_part_no,c_name FROM `components` WHERE `component_key` = :partCode LIMIT 1",
          {
            replacements: { partCode: body.component[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        partCodeName =
          componentResult.length > 0 ? componentResult[0].c_part_no : "";
        partname = componentResult.length > 0 ? componentResult[0].c_name : "";
      }

      data.push({
        PARTCode: partCodeName,
        PARTCodeName: partname,
        VendorName: body.vendortype === "p01" ? "--" : body.vendor || "--",
        InvoiceDate: moment(body.invoice_date?.[0] || insertDt).format(
          "YYYY/MM/DD HH:mm:ss"
        ),
        MinNumber: txnId,
        UNIT: isNaN(parseInt(body.qty?.[i])) ? 0 : parseInt(body.qty[i]),
        Rate: isNaN(parseFloat(body.rate?.[i])) ? 0 : parseFloat(body.rate[i]),
        MINDate: moment(insertDt).format("YYYY/MM/DD HH:mm:ss"),
      });
    }

    const payload = {
      Data: data,
    };

    // Send POST request
    const response = await axios.post(
      "http://dev.oakter.co:84/Oakter/Report/SaveComponentInwardData",
      payload,
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    if (response.data.OverAllStatus === "PASS") {
      return {
        status: "PASS",
        message: "External API call successful",
        details: response.data.Status,
      };
    } else {
      return {
        status: "FAIL",
        message: `External API call failed: ${response.data.Status.join(", ")}`,
        details: response.data.Status,
      };
    }
  } catch (error) {
    return {
      status: "ERROR",
      message: `Failed to call external API: ${error.message}`,
    };
  }
};

exports.errorResponse = function (res, error) {
  const errorId = Math.floor(
    1000000000 + Math.random() * 9000000000
  ).toString();

  const timestamp = moment().format("YYYY-MM-DD HH:mm:ss");

  const clientIP =
    res.req?.ip || res.req?.connection?.remoteAddress || "unknown";

  const sanitizeMessage = (msg) => {
    if (typeof msg !== "string") return String(msg);
    return msg.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
  };

  const errorLogEntry = {
    errorId,
    timestamp,
    ip: clientIP,
    method: res.req?.method || "unknown",
    url: res.req?.originalUrl || "unknown",
    userAgent: res.req?.get("User-Agent") || "unknown",
    error: {
      name: sanitizeMessage(error.name || "Unknown Error"),
      message: sanitizeMessage(error.message || "Unknown error occurred"),
      stack: sanitizeMessage(error.stack || "No stack trace"),
      code: error.code || null,
      status: error.status || error.statusCode || 500,
    },
    request: {
      body: res.req?.body || {},
      query: res.req?.query || {},
      params: res.req?.params || {},
    },
  };

  const logDir = path.join(__dirname, "../logs");
  const logFile = path.join(logDir, "error.json");

  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    let logs = [];

    if (fs.existsSync(logFile)) {
      const fileData = fs.readFileSync(logFile, "utf8");
      logs = fileData ? JSON.parse(fileData) : [];
    }

    logs.push(errorLogEntry);

    fs.writeFileSync(
      logFile,
      JSON.stringify(logs, null, 2),
      "utf8"
    );
  } catch (fileErr) {
    console.error("Failed to write error log:", fileErr);
  }

  return res.json({
    type: "INTERNAL_ERROR",
    success: false,
    status: "error",
    message:
      "An unexpected error occurred, our technician will resolve this shortly.",
    report: {
      errorId,
      timestamp,
    },
  });
};

exports.genTransaction = async function (forNumber, transaction) {
  const rows = await invtDB.query(
    `
    SELECT ID, prefix, session, suffix, number_length_limit
    FROM ims_numbering
    WHERE for_number = :forNumber
    FOR UPDATE
    `,
    {
      replacements: { forNumber },
      type: invtDB.QueryTypes.SELECT,
      transaction,
    }
  );

  if (!rows.length) {
    throw new Error(`Numbering not found for ${forNumber}`);
  }

  let { ID, prefix, session, suffix, number_length_limit } = rows[0];

  // ✅ Financial Year Logic (1st April Reset)
  const today = new Date();
  const month = today.getMonth() + 1;
  const year = today.getFullYear() % 100;

  let newSession;
  let resetRequired = false;

  if (month >= 4) {
    newSession = `${year}-${year + 1}`;
  } else {
    newSession = `${year - 1}-${year}`;
  }

  if (session !== newSession) {
    resetRequired = true;
  }

  // ✅ Reset on FY change
  if (resetRequired) {
    await invtDB.query(
      `
      UPDATE ims_numbering
      SET suffix = 0, session = :newSession
      WHERE id = :id
      `,
      {
        replacements: { id: ID, newSession },
        type: invtDB.QueryTypes.UPDATE,
        transaction,
      }
    );
  }

  // ✅ ATOMIC INCREMENT (ZERO DUPLICATE, ZERO SKIP)
  await invtDB.query(
    `
    UPDATE ims_numbering
    SET suffix = LAST_INSERT_ID(suffix + 1)
    WHERE for_number = :forNumber
    `,
    {
      replacements: { forNumber },
      type: invtDB.QueryTypes.UPDATE,
      transaction,
    }
  );

  // ✅ CORRECT WAY TO READ LAST_INSERT_ID
  const result = await invtDB.query(`SELECT LAST_INSERT_ID() AS new_suffix`, {
    type: invtDB.QueryTypes.SELECT,
    transaction,
  });

  const row = result[0];

  const paddedSuffix = row.new_suffix
    .toString()
    .padStart(parseInt(number_length_limit), "0");

  return `${prefix}/${newSession}/${paddedSuffix}`;
};

// Whatsapp
const WHATSAPP_API_URL = `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`;

exports.sendWhatsappTextMessage = async function (to, text) {
  await axios.post(
    WHATSAPP_API_URL,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
};

async function checkDisify(email) {
  try {
    const { data } = await axios.get(
      `https://www.disify.com/api/email/${encodeURIComponent(email)}`,
      { timeout: 5000 },
    );
    return data.disposable === true ? false : null;
  } catch (e) {
    console.warn("Disify failed:", e.message);
    return null;
  }
}

exports.validateEmail = async function (email_address) {
  const disifyResult = await checkDisify(email_address);
  if (disifyResult === false) {
    return { valid: false, reason: "Temporary emails are not allowed." };
  }

  const sender =
    process.env.SMTP_USERID ||
    process.env.SMTP_USERNAME ||
    "noreply@localhost";

  const result = await validate({
    email: email_address,
    sender,
    validateRegex: true,
    validateMx: true,
    validateTypo: true,
    validateDisposable: true,
    validateSMTP: true,
  });

  if (!result.valid) {
    const reason = result.reason;

    if (reason === "regex")
      return { valid: false, reason: "Invalid email format." };
    if (reason === "typo") {
      const suggestion = result.validators?.typo?.suggestion;
      return {
        valid: false,
        reason: suggestion
          ? `Did you mean ${suggestion}?`
          : "Email domain may contain a typo.",
      };
    }
    if (reason === "disposable")
      return { valid: false, reason: "Temporary emails are not allowed." };
    if (reason === "mx")
      return { valid: false, reason: "Email domain does not exist." };
    if (reason === "smtp")
      return { valid: false, reason: "Email address does not exist." };

    return { valid: false, reason: "Invalid email address." };
  }

  return { valid: true };
};

exports.sendMediaWhatsapp = async function (to, fileName, link) {
  const data = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: {
      link,
      filename: fileName,
    },
  };

  await axios.post(WHATSAPP_API_URL, data, {
    headers: {
      Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
};

// Get GSTIN Details --- START
let cachedToken = null;

async function fetchToken() {
  const { data } = await axios.post(
    `${process.env.FYN_API_URL}/api/authenticate`,
    '',
    {
      headers: {
        accept: 'application/json',
        clientId: process.env.FYN_CLIENT_ID,
        clientSecret: process.env.FYN_CLIENT_SECRET,
      },
      timeout: 5000,
    }
  );

  cachedToken = data.data.accessToken;
  return cachedToken;
}

async function getToken() {
  return cachedToken || await fetchToken();
}

async function callGstApi(gstin, token) {
  const { data } = await axios.get(
    `${process.env.FYN_API_URL}/api/gst/search-taxpayer/TP/${gstin}`,
    {
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      timeout: 5000,
    }
  );

  return data;

}

exports.gstInfo = async function (gstin) {

  function formatPayload(payload) {
    return {
      ...payload,
      pan: payload.gstin?.substring(2, 12) ?? null,
    };
  }

  try {
    const token = await getToken();
    const data = await callGstApi(gstin, token);
    const payload = data.data ?? data;

    if (payload.error || payload.status_cd === '0') {
      return { success: false, status: "error", message: payload.error?.message ?? 'Invalid GSTIN' };
    }

    return { success: true, status: 'success', data: formatPayload(payload) };

  } catch (err) {
    const status = err.response?.status;

    if (status === 401 || status === 403) {
      try {
        cachedToken = null;
        const freshToken = await fetchToken();
        const data = await callGstApi(gstin, freshToken);
        const payload = data.data ?? data;

        if (payload.error || payload.status_cd === '0') {
          return { success: false, status: "error", message: payload.error?.message ?? 'Invalid GSTIN' };
        }

        return { success: true, status: 'success', data: formatPayload(payload) };

      } catch (retryErr) {
        return { success: false, status: "error", message: 'an error occurred while retrieving information from NIC\nERROR : [001]' };
      }
    }

    return { success: false, status: "error", message: 'an error occurred while retrieving information from NIC\nERROR : [002]' };
  }
};
// Get GSTIN Details --- END

// Date Formatting --- START
exports.dateFormat = function (date, currentFormat, newFormat) {
  if (!date) return "--";

  return moment(date, currentFormat).format(newFormat);
};
// Date Formatting --- END


exports.generateTxnSession = function () {
  const d = new Date();

  const month = d.getMonth();
  let startYear;

  if (month >= 3) {
    // April to December
    startYear = d.getFullYear();
  } else {
    // Jan to March
    startYear = d.getFullYear() - 1;
  }

  const endYear = startYear + 1;

  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
}