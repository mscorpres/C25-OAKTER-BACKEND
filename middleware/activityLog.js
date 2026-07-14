const cron = require("node-cron");
const { otherDB } = require("../config/db/connection");

const { v4: uuidv4 } = require("uuid");

// Only mutating requests are logged — GET/HEAD/OPTIONS traffic (reports, dropdowns,
// CORS preflights) would flood the table without adding any audit value.
const LOGGED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Middleware to log activity directly to database.
module.exports = function (req, res, next) {
  if (!LOGGED_METHODS.has(req.method)) {
    return next();
  }

  const startTime = Date.now();
  const logId = uuidv4();
  
  const clientIP = req.headers["x-forwarded-for"] 
    ? req.headers["x-forwarded-for"].split(",")[0].trim() 
    : req.connection.remoteAddress || req.ip || "unknown";
  
  const requestBody = req.body || {};
  const originalUrl = req.originalUrl || req.url;
  const method = req.method;
  const userAgent = req.headers["user-agent"] || "unknown";
  
  const originalSend = res.send;
  const originalJson = res.json;
  
  let responseBody = null;
  
  res.send = function (body) {
    responseBody = body;
    return originalSend.call(this, body);
  };
  
  res.json = function (body) {
    responseBody = body;
    return originalJson.call(this, body);
  };
  
  res.on("finish", async () => {
    try {
      const responseTime = Date.now() - startTime;
      const status = res.statusCode;
      const timestamp = moment().format("YYYY-MM-DD HH:mm:ss");
      
      // Get user ID from request (captured after auth middleware has run)
      const userId = req.logedINUser || null;
      
      // Helper function to safely stringify response body
      const stringifyResponseBody = (body) => {
        if (!body) return null;
        if (typeof body === "string") return body;
        if (Buffer.isBuffer(body)) return body.toString("utf8");
        try {
          return JSON.stringify(body);
        } catch (e) {
          return String(body);
        }
      };
      
      // Insert directly into database using INSERT IGNORE (handles duplicates efficiently)
      await otherDB.query(
        `INSERT IGNORE INTO req_activity_log 
         (ip, log_id, method, path, status, timestamp, responseTime, userAgent, userid, requestBody, responseBody) 
         VALUES (:ip, :logId, :method, :path, :status, :timestamp, :responseTime, :userAgent, :userid, :requestBody, :responseBody)`,
        {
          replacements: {
            ip: clientIP,
            logId: logId,
            method: method,
            path: originalUrl,
            status: status,
            timestamp: timestamp,
            responseTime: responseTime,
            userAgent: userAgent,
            userid: userId,
            requestBody: JSON.stringify(requestBody),
            responseBody: stringifyResponseBody(responseBody),
          },
          type: otherDB.QueryTypes.INSERT,
        }
      );
    } catch (error) {
      // Log error but don't break the request flow
      console.error("Error saving activity log:", error.message);
    }
  });
  
  next();
};

// Function to delete logs older than 90 days
async function deleteOldLogs() {
  try {
    const cutoffDate = moment().tz("Asia/Kolkata").subtract(90, 'days').format('YYYY-MM-DD HH:mm:ss');
    const result = await otherDB.query(
      "DELETE FROM req_activity_log WHERE timestamp < :cutoffDate",
      {
        replacements: {
          cutoffDate: cutoffDate,
        },
      }
    );
    console.log(`Deleted activity logs older than 90 days (cutoff: ${cutoffDate})`);
  } catch (error) {
    console.error("Error deleting old activity logs:", error.message);
  }
}

// Delete logs older than 90 days - runs daily at 2 AM
cron.schedule("0 2 * * *", deleteOldLogs);
