const { invtDB } = require("../../../config/db/connection");
const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validation = require("validatorjs");
const xlsx = require("xlsx");
const fs = require("fs");

router.get("/", [auth.isAuthorized], async (req, res) => {
    try {
        const validation = new Validation(req.query, {
            wise: "required|in:A",
            data: "required"
        });
        if (validation.fails()) {
            return res.json({
                success: false,
                message: helper.firstErrorValidatorjs(validation),
                data: null,
                error: null
            });
        }

        const searcBy = req.query.wise;
        const searchValue = req.query.data;

        let stmt = [];

        if (searcBy == "A") {
            const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
            const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
            const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

            stmt = await invtDB.query("SELECT *, branches.branch_name, COALESCE(SUM(jw_purchase_req.jw_po_order_qty),0) totalReq_Qty FROM jw_purchase_req LEFT JOIN products ON jw_purchase_req.jw_po_sku = products.product_key LEFT JOIN units ON products.p_uom = units.units_id LEFT JOIN admin_login ON jw_purchase_req.jw_po_insert_by = admin_login.CustID LEFT JOIN cost_center ON jw_purchase_req.jw_cost_center = cost_center.cost_center_key LEFT JOIN branches ON jw_purchase_req.company_branch = branches.branch_code LEFT JOIN ven_basic_detail ON jw_purchase_req.jw_po_vendor_reg_id = ven_basic_detail.ven_register_id WHERE products.is_enabled = 'Y' AND DATE_FORMAT(jw_purchase_req.jw_po_full_date , '%Y-%m-%d') BETWEEN :date1 AND :date2 GROUP BY jw_purchase_req.jw_po_sku , jw_purchase_req.jw_jw_transaction ORDER BY jw_purchase_req.ID DESC", {
                replacements: { date1: fromdate, date2: todate },
                type: invtDB.QueryTypes.SELECT
            });

            if (stmt.length > 0) {
                let data = [];

                for (let i = 0; i < stmt.length; i++) {
                    let duedate;

                    if (stmt[i].jw_po_duedate == "") {
                        duedate = "";
                    } else {
                        duedate = stmt[i].jw_po_duedate
                    }

                    let cost_center;
                    if (stmt[i].jw_cost_center != "--" && stmt[i].jw_cost_center != null && stmt[i].jw_cost_center != "") {
                        cost_center = stmt[i].cost_center_name + " (" + stmt[i].cost_center_short_name + ")";
                    } else {
                        cost_center = "N/A";
                    }

                    data.push({
                        branch: stmt[i].branch_name,
                        component_name: stmt[i].p_name,
                        unit_name: stmt[i].units_name,
                        part_no: stmt[i].p_sku,
                        reg_date: moment(stmt[i].jw_po_full_date).tz("Asia/Kolkata").format("DD-MM-YYYY"),
                        reg_by: stmt[i].user_name,
                        ordered_qty: stmt[i].jw_po_order_qty,
                        ordered_pending: stmt[i].jw_po_order_qty - stmt[i].jw_po_issue_qty, // stmt[i].jw_ven_sfg_inward
                        vendor_name: stmt[i].ven_name,
                        vendor_code: stmt[i].jw_po_vendor_reg_id,
                        due_date: duedate,
                        po_order_id: stmt[i].jw_jw_transaction,
                        po_rate: stmt[i].jw_po_order_rate,
                        po_cost_center: cost_center,
                        po_project: stmt[i].jw_project_name,
                        po_status: stmt[i].jw_po_status == "A" ? "Approved" : stmt[i].jw_po_status == "C" ? "Closed" : "Pending",
                    })
                }

                //now add data in excel sheet

                //let workbook = xlsx.utils.book_new();

                //let worksheet = xlsx.utils.json_to_sheet(data);

                //xlsx.utils.book_append_sheet(workbook, worksheet, "Sheet1");

                //xlsx.writeFile(workbook, "jwReport.xlsx");

                //let result = fs.readFileSync("jwReport.xlsx");

                // console.log("result", result);

                // fs.unlinkSync("jwReport.xlsx");

                return res.json({
                    success: true,
                    status: "success",
                    data: data
                })
            } else {
                return res.json({
                    success: false,
                    message: "No data found for this search",
                    status: "error",
                })
            }
        } else {
            return res.json({
                success: false,
                message: "Invalid search wise",
                status: "error",
            });
        }

    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

module.exports = router