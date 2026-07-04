let { invtDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

router.get("/", [auth.isAuthorized], async (req, res) => {

    try {
        const stmt = await invtDB.query("SELECT loc_in_t.loc_name as in_loc , (SELECT CONCAT(cost_center_name , '(' , cost_center_short_name , ')') FROM cost_center WHERE cost_center_key =loc_in_t.loc_costcenter) as in_cost , loc_out_t.loc_name as out_loc , (SELECT CONCAT(cost_center_name , '(' , cost_center_short_name , ')') FROM cost_center WHERE cost_center_key =loc_out_t.loc_costcenter) as out_cost , c_part_no , c_name , c_new_part_no , units.units_name , rm_location.qty , rm_location.transfer_transaction_id FROM rm_location LEFT JOIN location_main loc_in_t ON loc_in_t.location_key = rm_location.loc_in LEFT JOIN location_main loc_out_t ON loc_out_t.location_key = rm_location.loc_out LEFT JOIN components ON components.component_key = rm_location.components_id LEFT JOIN units ON units.units_id = components.c_uom WHERE rm_location.ID IN( SELECT rm_location.ID FROM rm_location LEFT JOIN location_main loc_in_t ON loc_in_t.location_key = rm_location.loc_in LEFT JOIN location_main loc_out_t ON loc_out_t.location_key = rm_location.loc_out WHERE rm_location.trans_type = 'TRANSFER' ) AND (loc_in_t.loc_costcenter = loc_out_t.loc_costcenter AND (loc_in_t.loc_costcenter = '--' AND loc_out_t.loc_costcenter = '--') )", {
            type: invtDB.QueryTypes.SELECT,
        });

        if (stmt.length <= 0) {
            return res.json({ message: "No data found", status: "error", success: false });
        }

        const data = [];

        for (let i = 0; i < stmt.length; i++) {
            data.push({
                part_code: stmt[i].c_part_no ?? "",
                part_name: stmt[i].c_name ?? "",
                new_part_code: stmt[i].c_new_part_no ?? "",
                uom: stmt[i].units_name ?? "",
                qty: stmt[i].qty ?? "",
                in_location: stmt[i].in_loc ?? "",
                in_cost_center: stmt[i].in_cost ?? "",
                out_location: stmt[i].out_loc ?? "",
                out_cost_center: stmt[i].out_cost ?? "",
                transfer_transaction: stmt[i].transfer_transaction_id ?? "",
            })
        }
        return res.json({ status: "success", success: true, data: data });

    }
    catch (e) {
        return helper.errorResponse(res, e);
    }

})

module.exports = router;