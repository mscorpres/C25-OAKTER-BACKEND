const express = require("express");
const router = express.Router();

const auth = require("../../../../middleware/ven_auth");
const permission = require("../../../../middleware/permission");
let { invtDB } = require("../../../../config/db/connection");

const XLSX = require("xlsx");

router.get("/minMasterComp", [auth.isAuthorized], async (req, res) => {
    try {
        const stmt = await invtDB.query("SELECT rm_location.* , c_part_no , c_name , components.c_category, attribute_code, c_is_enabled , c_new_part_no , c_specification , units.units_name , all_groups.group_name  ,cost_center_name , cost_center_short_name FROM `rm_location` LEFT JOIN components ON components.component_key = rm_location.components_id LEFT JOIN units ON units.units_id = components.c_uom LEFT JOIN all_groups ON all_groups.group_id = components.c_group LEFT JOIN cost_center ON cost_center.cost_center_key = rm_location.rm_loc_cost_center WHERE `trans_type` = 'INWARD' AND vendor_type = 'v01' AND rm_location.insert_date >= '2023-04-01' ", {
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt.length <= 0) {
            return res.json({ message: "No data found!!!" });
        }

        const data = [];

        if (stmt.length > 0) {

            for (let i = 0; i < stmt.length; i++) {
                data.push({
                    "PART CODE": stmt[i].c_part_no,
                    "NEW PART CODE" : stmt[i].c_new_part_no,
                    "PART NAME": stmt[i].c_name,
                    "CATEGORY": stmt[i].c_category,
                    "PART DESC": stmt[i].c_specification,
                    "UOM": stmt[i].units_name,
                    "MIN NO" : stmt[i].in_transaction_id ,
                    "QTY": stmt[i].qty,
                    "PROJECT NAME" : stmt[i].rm_loc_project_id,
                    "COST CENTER" : `${stmt[i].cost_center_name ?? ""} (${stmt[i].cost_center_short_name ?? ""})`,
                    "MIN DATE" : moment(stmt[i].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
                })
            }
        }

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(workbook, worksheet, "MIN_MASTER_COMP");

        const fileName = "MIN_MASTER_COMP.xlsx";
        const filePath = "./files/excel/";

        XLSX.writeFile(workbook, filePath + fileName);

 

        
            // let to = "somendra.yadav@mscorpres.in";
            let to = "yogesh.garg@mscorpres.in";

            const attachment = [
                {
                    filename: fileName,
                    path: filePath + fileName,
                },
            ];

            helper.sendMail(to, null, "MIN REPORT AFTER 01/04/2023", "Please find the attachment, as report MIN created after 01/04/2023 ", attachment);

            return res.json({ message: "Report generated successfully", status: "success", success: true });


    }
    catch (err) {
        return res.json({ message: "Internal Error!!! If this condition persists, contact your system administrator"});
    }
});

module.exports = router;