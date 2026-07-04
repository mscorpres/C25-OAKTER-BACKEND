const express = require("express");
const router = express.Router();

let { invtDB, otherDB } = require("../../../config/db/connection");

const validateApiToken = async (req, res, next) => {
    const authHeader = req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "No token provided",
            status: "error",
        });
    }

    const token = authHeader.replace("Bearer ", "");
    try {
        const currentTime = moment.tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
        const tokenRecord = await otherDB.query(
            `SELECT *, 
                    expires_at AS expires_at_raw 
             FROM tbl_api_tokens 
             WHERE token = :token 
               AND expires_at > :currentTime`,
            {
                replacements: { token, currentTime },
                type: otherDB.QueryTypes.SELECT,
            }
        );

        if (!tokenRecord.length) {
            return res.status(401).json({
                success: false,
                message: "Invalid OR the token has been expired",
                status: "error",
            });
        }

        next();
    } catch (error) {
        console.error("Error validating API token:", error);
        return res.status(401).json({
            success: false,
            message: "Unauthorized Access, CASE SENSITIVE",
            status: "error",
        });
    }
};

// GET BOM DETAILS of SFG
router.get("/view/sfg/bom", [validateApiToken], async (req, res) => {
    if (!req.query.sku || req.query.sku.trim() === "") {
        return res.status(400).json({
            success: false,
            message: "sku is defined in the request",
            status: "error"
        });
    }
    try {
        const sku = req.query.sku;

        const result = await invtDB.query(
            `SELECT 
                bom_quantity.subject_under,
                bom_recipe.subject_name,
                bom_quantity.qty,
                components.c_part_no,
                components.c_name,
                units.units_name,
                products.p_name
            FROM bom_quantity
            LEFT JOIN bom_recipe ON bom_recipe.subject_id = bom_quantity.subject_under
            LEFT JOIN components ON components.component_key = bom_quantity.component_id
            LEFT JOIN units ON units.units_id = components.c_uom
            LEFT JOIN products ON products.p_sku = bom_recipe.bom_product_sku
            WHERE bom_quantity.product_sku = :sku AND bom_recipe.bom_status = 'ENABLE'`,
            {
                replacements: { sku: sku },
                type: invtDB.QueryTypes.SELECT,
            }
        );
        if (!result.length) {
            return res.json({
                success: false,
                message: "no data found",
                status: "error"
            });
        }
        const bomMap = {};

        result.forEach(row => {
            if (!bomMap[row.subject_under]) {
                bomMap[row.subject_under] = {
                    bomName: row.subject_name,
                    items: []
                };
            }

            bomMap[row.subject_under].items.push({
                name: row.c_name,
                part: row.c_part_no,
                qty: row.qty,
                unit: row.units_name
            });
        });

        const response = {
            sku : sku,
            productName: result[0].p_name,
            bom: Object.values(bomMap)
        };

        return res.json({
            success: true,
            status: "success",
            data: response
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            status: "error",
            success: false,
            message: "Internal server error",
        });
    }
});

module.exports = router;
