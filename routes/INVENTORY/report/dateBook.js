const express = require("express");
const router = express.Router();

const { invtDB } = require("../../../config/db/connection");
const Validator = require("validatorjs");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

router.post("/", [auth.isAuthorized], async (req, res) => {
    const validation = new Validator(req.body, {
        data: "required",
    });

    if (validation.fails()) {
        return res.json({ message:  helper.firstErrorValidatorjs(validation) , status: "error", success: false });
    }

    try {

        const date = req.body.data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
        const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
        const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

        if(date1 == "Invalid date" || date2 == "Invalid date"){
            return res.json({ message: "Invalid date", status: "error", success: false });
        }

        let totalCounts = await invtDB.query(
            `SELECT
        COUNT(DISTINCT CASE WHEN trans_type = 'INWARD' THEN in_transaction_id ELSE NULL END) AS totalMIN,
        COUNT(DISTINCT CASE WHEN trans_type = 'INWARD' AND in_module = 'IN-PO' THEN in_transaction_id ELSE NULL END) AS poMIN,
        COUNT(DISTINCT CASE WHEN trans_type = 'INWARD' AND in_module = 'IN-JWI' THEN in_transaction_id ELSE NULL END) AS jwMIN,
        COUNT(DISTINCT CASE WHEN trans_type = 'INWARD' AND in_module = 'IN-MIN' THEN in_transaction_id ELSE NULL END) AS normalMIN,
        COUNT(DISTINCT CASE WHEN trans_type = 'REJECTION' THEN rej_transaction_id ELSE NULL END) AS Rejection,
        COUNT(DISTINCT CASE WHEN trans_type = 'CONSUMPTION' THEN mfg_ppr_trans_id_2 ELSE NULL END) AS Consumption,
        COUNT(DISTINCT CASE WHEN trans_type = 'JOBWORK' THEN jw_challan_id ELSE NULL END) AS JWchallan,
        (SELECT COUNT(DISTINCT po_transaction) FROM po_purchase_req WHERE DATE_FORMAT(po_full_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS totalPO,
        (SELECT COUNT(*) FROM jw_purchase_req WHERE DATE_FORMAT(jw_po_full_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS totalJW_PO,
        (SELECT COUNT(DISTINCT mfg_transaction) FROM mfg_production_2 WHERE DATE_FORMAT(mfg_full_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS totalMFG,
        (SELECT COUNT(*) FROM mfg_production_3 WHERE type = 'IN' AND DATE_FORMAT(mfgphase2_insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS totalFGin,
        (SELECT COUNT(DISTINCT mfg_pro_FGout_transaction) FROM mfg_production_3 WHERE type = 'OUT' AND DATE_FORMAT(fgout_pro_apr_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS totalFGout,
        (SELECT COUNT(*) FROM ims_gatepass WHERE gp_type = 'RGP' AND DATE_FORMAT(gp_insert_dt, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS totalRGP,
        (SELECT COUNT(*) FROM ims_gatepass WHERE gp_type = 'NRGP' AND DATE_FORMAT(gp_insert_dt, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS totalNRGP,
        (SELECT COUNT(DISTINCT dc_transaction) FROM ims_dc_challan WHERE (STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(dc_log,'$[0].insert_date')), '%Y-%m-%d') BETWEEN :date1 AND :date2) AND company_branch = :branch) AS totalRGP_DCchallan
        FROM rm_location
        WHERE DATE_FORMAT(insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch
      `,
            {
              replacements: { date1: date1, date2: date2, branch: req.branch },
              type: invtDB.QueryTypes.SELECT,
            }
          );

        if(totalCounts.length){
            return res.json({ status: "success", success: true, message: totalCounts });
        }

    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator"});
    }


})

module.exports = router