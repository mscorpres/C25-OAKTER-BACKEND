const { invtDB, otherDB } = require("./../config/db/connection");
var url = require("url");
var jwt = require("jsonwebtoken");
const { stat } = require("fs/promises");

// Create new Router and Methods wise middleware
function isPermittedMethod(...allowedMethods) {
  return async function (req, res, next) {
    try {
      const user_id = req.logedINUser;
      const routeUrl = req.headers["x-window-url"] || req.originalUrl;

      const permissionRecords = await otherDB.query(
        `SELECT url, method FROM jw_permission WHERE username = :user_id`,
        {
          replacements: { user_id },
          type: otherDB.QueryTypes.SELECT,
        }
      );

      if (permissionRecords.length === 0) return next();

      const isAllowed = permissionRecords.some((record) => {
        const url = record.url.trim();
        const methods = record.method
          .split(",")
          .map((m) => m.trim().toUpperCase())
          .filter(Boolean);

        return (
          url === routeUrl &&
          methods.some((m) => allowedMethods.includes(m))
        );
      });

      if (!isAllowed) {
        return res.json({

          status: "error", success: false,
          message: `You do not have permission to (${allowedMethods.join(
              ", "
            )}) for this route.`,
        });
      }

      next();
    } catch (error) {
        return helper.errorResponse(res, error);
    }
  };
}

module.exports = {
  isPermittedMethod,
};

