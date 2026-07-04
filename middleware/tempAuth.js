var jwt = require("jsonwebtoken");
module.exports = function (req, res, next) {
  try {
    const token = req.header("Authorization");

    if (!token) {
      return res.json({
        success: false,
        message: "Access denied, token missing",
      });
    }

    jwt.verify(
      token,
      `${process.env.TOKEN_SECRET}`,
      async function (err, decoded) {
        if (err) {
          return res.json({
            status: "error",
            success: false,
            message: "token authentication failed..<br />Please login again...",
          });
        }
        req.code = decoded.code;
        next();
      }
    );
  } catch (error) {
    return helper.errorResponse(res, error);
  }
};
