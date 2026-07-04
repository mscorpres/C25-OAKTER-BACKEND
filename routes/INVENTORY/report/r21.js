let { otherDB } = require("../../../config/db/connection");
const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

router.get("/", [auth.isAuthorized], async (req, res) => {
    try {
        let fetchR21 = await otherDB.query(`SELECT c2.part, c2.locations, c2.in_date AS closingDate , c1.c_name AS componentName FROM ${global.ims_db_name}.components c1 JOIN ${global.other_db_name}.invt_r20 c2 ON c1.c_part_no = c2.part GROUP BY c2.part`, {
            type: otherDB.QueryTypes.SELECT,
        });

        if (fetchR21.length <= 0) {
            return res.json({ status: "error", success: false, message: "no data found" });
        } else {
            let data = [];
            for (let i = 0; i < fetchR21.length; i++) {
                data.push({
                    part: fetchR21[i].part,
                    component: fetchR21[i].componentName,
                    locations: fetchR21[i].locations
                })
            }
            return res.json({
                status: "success", success: true,
                success: true,
                message: "Report fetched successfully",
                data: data,
                closingDate: moment(fetchR21[0].closingDate).format("DD-MM-YYYY")
            });
        }

    } catch (error) {
        return helper.errorResponse(res, error);
    }
});

module.exports = router;