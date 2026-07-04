const express = require("express");
const router = express.Router();
const { invtDB } = require("../../config/db/connection");
const auth = require("../../middleware/auth");

/* ---------------- GET CONSUMPTION ITEMS ---------------- */
async function getConsumptionItems(mfg_id) {
    const stmt0 = await invtDB.query(
        `SELECT mp1.prod_bom_subject 
         FROM mfg_production_2 mp2 
         LEFT JOIN mfg_production_1 mp1 ON mp1.prod_transaction = mp2.mfg_ref_id 
         WHERE mp2.mfg_transaction = :id 
         LIMIT 1`,
        {
            replacements: { id: mfg_id },
            type: invtDB.QueryTypes.SELECT
        }
    );

    const bom_subject = stmt0.length ? stmt0[0].prod_bom_subject : 0;

    const stmt1 = await invtDB.query(
        `SELECT rm_location.*, components.c_part_no, components.c_name, 
                components.components_type, components.c_uom,
                units.units_name, location_main.loc_name,
                (SELECT bom_quantity.qty 
                 FROM bom_quantity 
                 WHERE bom_quantity.component_id = components.component_key 
                 AND bom_quantity.subject_under = :bom_sub) AS bom_qty
         FROM rm_location
         LEFT JOIN components ON rm_location.components_id = components.component_key
         LEFT JOIN units ON components.c_uom = units.units_id
         LEFT JOIN location_main ON rm_location.loc_out = location_main.location_key
         WHERE rm_location.mfg_ppr_trans_id_2 = :id`,
        {
            replacements: { id: mfg_id, bom_sub: bom_subject },
            type: invtDB.QueryTypes.SELECT
        }
    );

    const list = [];

    for (const item of stmt1) {
        const weightedRate = await require("../../helper/utils/avgRate")
            .getWeightedPurchaseRate(
                item.components_id,
                moment(item.insert_date).format("YYYY-MM-DD HH:mm:ss")
            );

        const consumed = Number(item.qty) + Number(item.other_qty);

        list.push({
            componentName: item.c_name,
            componentPart: item.c_part_no,
            qtyConsumed: consumed,
            bomQty: item.bom_qty || "--",
            UOM: item.units_name,
            locationFrom: item.loc_name,
            comment: item.any_remark || "-",
            type: item.components_type === "semi" ? "SR" : "RM",
            weightedPurchaseRate: weightedRate,
            weightedTotalCost: (consumed * weightedRate)
        });
    }

    return list;
}

/* ---------------- MAIN REPORT API ---------------- */
router.get("/manufacturing", auth.tallysyncAuthorized, async (req, res) => {
    try {
        const { fromdate, todate } = req.query;

        /* ----- Parse Date Range from Query Params ----- */
        let dateRange = null;

        if (fromdate && todate) {
            const from = moment(fromdate, "DD-MM-YYYY", true);
            const to = moment(todate, "DD-MM-YYYY", true);

            if (!from.isValid() || !to.isValid()) {
                return res.json({
                    status: "error", success: false,
                    message: "Invalid date format. Use DD-MM-YYYY"
                });
            }

            dateRange = { from, to };
        } else {
            return res.json({
                status: "error", success: false,
                message: "fromdate and todate query parameters are required"
            });
        }

        /* ----- Build Main Query ----- */
        let query = `
            SELECT mp2.*, p.p_name, p.p_hsncode, p.p_description, units.units_name, location_main.loc_name AS fg_loc,
                   al.user_name
            FROM mfg_production_2 mp2
            LEFT JOIN products p ON p.p_sku = mp2.mfg_sku
            LEFT JOIN units ON units.units_id = p.p_uom
            LEFT JOIN location_main ON location_main.location_key = mp2.mfg_con_location
            LEFT JOIN admin_login al ON al.CustID = mp2.mfg_approved_by
            WHERE mp2.mfg_prod_type IN ('C')`;

        const replacements = {};

        if (dateRange) {
            query += ` AND DATE(mp2.mfg_full_date) BETWEEN :d1 AND :d2`;
            replacements.d1 = dateRange.from.format("YYYY-MM-DD");
            replacements.d2 = dateRange.to.format("YYYY-MM-DD");
        }

        const stmt = await invtDB.query(query, {
            replacements,
            type: invtDB.QueryTypes.SELECT,
        });

        if (!stmt.length) {
            return res.json({
                status: "error", success: false,
                message: "Data not found"
            });
        }

        /* ----- MAIN JSON RESPONSE BUILD ----- */
        let totalConsumption = 0;

        const mfgList = [];

        for (const item of stmt) {

            const consumption = await getConsumptionItems(item.mfg_transaction);

            const mfgObj = {
                transaction: item.mfg_transaction,
                date: moment(item.mfg_full_date).format("DD-MM-YYYY HH:mm:ss"),
                productSKU: item.mfg_sku,
                productName: item.p_name,
                hsnCode: item.p_hsncode,
                description: item.p_description,
                plannedQty: item.mfg_prod_planing_qty,
                UOM: item.units_name,
                locationTo: item.fg_loc,
                prodType: item.products_type === "semi" ? "SEMI" : "FG",
                remark: item.mfg_comment || "-",
                consumptions: consumption
            };

            totalConsumption += consumption.length;

            mfgList.push(mfgObj);
        }

        /* ----- Final Response ----- */
        return res.json({
            status: "success", success: true,
            header: {
                date: `${dateRange.from.format("DD-MM-YYYY")} to ${dateRange.to.format("DD-MM-YYYY")}`,
                totalMfg: mfgList.length,
                totalConsumption,
                companyGSTIN: "09AAHCR1005Q1Z4", // Oakter GSTIN
                voucherType: "--", // will be added later
                voucherSubType: "--" // will be added later
            },
            mfg: mfgList
        });

    } catch (err) {
        return helper.errorResponse(res, err);
    }
});

module.exports = router;
