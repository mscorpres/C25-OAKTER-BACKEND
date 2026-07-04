var jwt = require("jsonwebtoken");

module.exports.isAuthorized = function (req, res, next) {

    var token = req.headers["authorization"];
    req.page_id = req.headers["page_id"];
    req.branch = req.headers["company-branch"];

    if (!token) {
        res.status(401).json({
            success: false,
            status: "error",
            message: "token identification mismatched..<br />Please login again..",
        });
        return;
    }
    jwt.verify(token, `${process.env.TOKEN_SECRET}`, function (err, decoded) {
        if (err) {
            res.status(401).json({
                status: "error",
                success: false,
                message: "token authentication failed..<br />Please login again...",
            });
            return;
        }
        
        req.logedINUser = decoded.crn_id;
        req.logedINCompany = decoded.company_id;
        req.logedINVendor = decoded.vendor;
        next();
    });
};
