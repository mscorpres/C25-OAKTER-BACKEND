const express = require("express");
const router = express.Router();

let { invtDB, otherDB } = require("../../../config/db/connection");


const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");



router.post("/fetchWoOption", [auth.isAuthorized], async (req, res) => {
    try {
        let stmt;
        if (
            req.body.searchTerm == undefined ||
            req.body.searchTerm == null ||
            req.body.searchTerm == ""
        ) {
            stmt = await invtDB.query(
                "SELECT `wo_transaction` FROM `wo_purchase_req`",
                { type: invtDB.QueryTypes.SELECT }
            );
        } else {
            stmt = await invtDB.query(
                "SELECT `wo_transaction` FROM `wo_purchase_req` WHERE `wo_transaction` LIKE :woid",
                {
                    replacements: { woid: `%${req.body.searchTerm}%` },
                    type: invtDB.QueryTypes.SELECT,
                }
            );
        }

        if (stmt.length > 0) {
            const final = stmt.map((item) => ({
                id: item.wo_transaction,
                text: item.wo_transaction,
            }));
            return res.json({ success: true, status: "success", data: final });
        } else {
            return res.json({ success: false, status: "error", message:"no data found" });
        }
    } catch (error) {
        return res.status(500).json({ success: false, status: "error", error: error.stack });
    }
});


router.post("/fetchWoSupplementaryData",[auth.isAuthorized], async (req, res) => {

    try {
        if (!req.body.woid) {
            return res.status(400).json({
                success:false,
                status: "error",
                message: "woid is required",
            });
        }

        const stmt = await invtDB.query(
            `SELECT * FROM wo_purchase_req WHERE wo_transaction = :woid`,
            {
                replacements: { woid: req.body.woid },
                type: invtDB.QueryTypes.SELECT,
            }
        );

        if (stmt.length <= 0) {
            return res.json({
                code: 500,
                status: "error",
                message: "Invalid work order ID",
            });
        }

        if (stmt[0].wo_bom_recipe != "CREATED") {
            return res.json({
                code: 500,
                status: "error",
                message:  "we didn't found any recipe against of this Work Order, Please create the recipe first to update the same",
            });
        }
        let stmt_header = await invtDB.query(
            "SELECT * FROM wo_purchase_req LEFT JOIN products ON wo_purchase_req.wo_sku = products.product_key LEFT JOIN units ON products.p_uom = units.units_id LEFT JOIN bom_recipe ON wo_purchase_req.wo_subject_id = bom_recipe.subject_id LEFT JOIN admin_login ON wo_purchase_req.wo_insert_by = admin_login.CustID LEFT JOIN " +
            tally_db_name +
            ".client_basic_detail ON wo_purchase_req.wo_client_id = client_basic_detail.code WHERE wo_purchase_req.wo_transaction LIKE CONCAT('%', :woid, '%') ORDER BY wo_purchase_req.wo_insert_date DESC",
            {
                replacements: { woid: req.body.woid },
                type: invtDB.QueryTypes.SELECT,
            }
        );


        // console.log("header----", stmt_header);

        let headers;

        if (stmt_header.length > 0) {
            headers = {
                date: moment(stmt_header[0].wo_insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
                woid: stmt_header[0].wo_transaction,
                wo_sku_transaction: stmt_header[0].wo_sku_transaction,
                client: stmt_header[0].name,
                clientcode: stmt_header[0].wo_client_id,
                skucode: stmt_header[0].p_sku,
                skuname: stmt_header[0].p_name,
                sku: stmt_header[0].wo_sku,
                bom_id: stmt_header[0].wo_subject_id,
                bom_name: stmt_header[0].subject_name,
                requiredqty: stmt_header[0].wo_order_qty + " / " + stmt_header[0].wo_issue_qty,
                bom_recipe: stmt_header[0].wo_bom_recipe,
                wo_status: stmt_header[0].wo_status,
                created_by: stmt_header[0].user_name,
            };
        }

        const bomId = stmt[0].wo_subject_id;

        const stmt_bom_comp = await invtDB.query(
            `SELECT 
          womr.ID as rowID,
          womr.wo_m_bom_qty,
          womr.wo_bom_alt_part,
          womr.wo_bom_part_status,
          components.c_name,
          components.c_part_no,
          components.component_key,
          units.units_name
       FROM wo_material_received womr
       LEFT JOIN components 
          ON womr.wo_m_component = components.component_key
       LEFT JOIN units 
          ON components.c_uom = units.units_id
       LEFT JOIN wo_purchase_req 
          ON womr.wo_m_work_id = wo_purchase_req.wo_transaction
       WHERE womr.wo_m_bom = :bomId
       AND components.c_type = 'R'
       AND components.c_is_enabled = 'Y'
       ORDER BY components.c_name ASC`,
            {
                replacements: { bomId: bomId },
                type: invtDB.QueryTypes.SELECT,
            }
        );

       const result = await Promise.all(
    stmt_bom_comp.map(async (item) => {
        let part_alt = [{ alt_component_part: "N/A", alt_component_name: "N/A", alt_component_key: "N/A" }];

        if (
            item.wo_bom_part_status === "ALT" &&     // ✅ check status here
            item.wo_bom_alt_part &&
            item.wo_bom_alt_part !== "--"             // ✅ guard against "--"
        ) {
            const altPartKeys = item.wo_bom_alt_part  // ✅ split the actual key(s) here
                .split(",")
                .map((p) => p.trim())
                .filter(Boolean);

            if (altPartKeys.length > 0) {
                const altResults = await invtDB.query(
                    `SELECT c_part_no, c_name, component_key
                     FROM components
                     WHERE component_key IN (:altPartKeys)`,
                    {
                        replacements: { altPartKeys },
                        type: invtDB.QueryTypes.SELECT,
                    }
                );

                if (altResults.length > 0) {
                    part_alt = altResults.map((alt) => ({
                        alt_component_part: alt.c_part_no,
                        alt_component_key: alt.component_key,
                        alt_component_name: alt.c_name,
                    }));
                }
            }
        }

        return {
            row_id: Buffer.from(item.rowID.toString()).toString("base64"),
            component_key: item.component_key,
            component_name: item.c_name,
            component_part: item.c_part_no,
            recipe_qty: item.wo_m_bom_qty,
            component_uom: item.units_name,
            part_status: item.wo_bom_part_status,
            part_alt: part_alt,
        };
    })
);
        return res.json({
            success: true,
            status: "success",
            message: "data fetched successfully",
            headers: headers,
            data: result,
        });
    } catch (error) {
        console.log(error);

        return res.status(500).json({
            success: false,
            status: "error",
            error: error.stack,
        });
    }
});


router.post("/updateWORecipe",  [auth.isAuthorized], async (req, res) => {
    const transaction = await invtDB.transaction();
    try {
        let validation = new Validator(req.body, {
            original_po: "required",
        });

        if (validation.fails()) {
            return res.json({
                success: false,
                status: "error",
                message: validation.errors.errors,
            });
        }

        const row_lenth = req.body.row.length;

        // helper to get alt components for a given row/component
        const getAltComponents = (rowId, compKey) => {
            const alt = req.body.alternate_components?.find(
                (item) => item.row_id === rowId && item.component_key === compKey
            );
            return alt?.alt_components || [];
        };

        let stmt = await invtDB.query(
            "SELECT * FROM `wo_material_received` WHERE `wo_m_work_id` = :woid",
            {
                replacements: { woid: req.body.original_po },
                type: invtDB.QueryTypes.SELECT,
            }
        );

        if (stmt.length > 0) {
            let sku_code = stmt[0].wo_m_sku;
            let wo_transaction_id = stmt[0].wo_m_work_id;
            let bom_recipe_id = stmt[0].wo_m_bom;

            for (let i = 0; i < row_lenth; i++) {
                let valid = new Validator(
                    {
                        qty: req.body.qty[i],
                        part: req.body.part[i],
                        row: req.body.row[i],
                    },
                    {
                        qty: "required",
                        part: "required",
                        row: "required",
                    }
                );
                if (valid.fails()) {
                    await transaction.rollback();
                    return res.json({
                       success: false,
                        status: "error",
                        message: valid.errors.all(),
                    });
                }

                if (req.body.qty[i] <= 0) {
                    await transaction.rollback();
                    return res.json({
                        success: false,
                        status: "error",
                        message: "PO recipe Qty should be greater than zero/0",
                    });
                }

                const component_key = req.body.part[i];
                const encoded_row_id = req.body.row[i];
                // Fix: Only decode if encoded_row_id is not 0 to avoid TypeError
                const decoded_row_id = encoded_row_id == 0 ? 0 : Buffer.from(encoded_row_id, "base64").toString("ascii");
                const alt_components = getAltComponents(encoded_row_id, component_key);
                const alt_part_str = alt_components.length > 0 ? alt_components.join(",") : "--";
                const part_status = alt_components.length > 0 ? "ALT" : "ACTIVE";

                if (encoded_row_id == 0) {
                    // INSERT
                    let stmt_check_comp = await invtDB.query(
                        "SELECT * FROM `components` WHERE `component_key` = :component",
                        {
                            replacements: { component: component_key },
                            type: invtDB.QueryTypes.SELECT,
                        }
                    );

                    if (stmt_check_comp.length > 0) {
                        let stmt_dup_comp = await invtDB.query(
                            "SELECT * FROM `wo_material_received` WHERE `wo_m_component` = :component AND `wo_m_work_id` = :woid",
                            {
                                replacements: {
                                    component: component_key,
                                    woid: req.body.original_po,
                                },
                                type: invtDB.QueryTypes.SELECT,
                            }
                        );

                        if (stmt_dup_comp.length > 0) {
                            await transaction.rollback();
                            return res.json({
                                success: false,
                                status: "error",
                                message:  "You have already saved the part in the recipe and again you are trying to add the same.",
                            });
                        } else {
                            const stmt_insert = await invtDB.query(
                                "INSERT INTO `wo_material_received`(`company_branch`,`wo_m_sku`,`wo_m_component`,`wo_m_bom_qty`,`wo_m_work_id`,`wo_m_sku_trans_id`,`wo_m_insert_dt`,`wo_m_insert_by`,`wo_m_bom`,`wo_bom_alt_part`,`wo_bom_part_status`) VALUES (:branch,:sku, :part, :qty, :wo_trans, :sku_trans, :insert_dt, :insert_by, :create_trans , :alt_parts, :status)",
                                {
                                    replacements: {
                                        branch: req.branch,
                                        sku: sku_code,
                                        part: component_key,
                                        qty: req.body.qty[i],
                                        wo_trans: wo_transaction_id,
                                        sku_trans: wo_transaction_id,
                                        insert_dt: moment(new Date())
                                            .tz("Asia/Kolkata")
                                            .format("YYYY-MM-DD HH:mm:ss"),
                                        
                                        insert_by: req.logedINUser,
                                        create_trans: bom_recipe_id,
                                        rate: "0", // replace with real rate if needed
                                        alt_parts: alt_part_str,
                                        status: part_status,
                                    },
                                    type: invtDB.QueryTypes.INSERT,
                                    transaction: transaction,
                                }
                            );


                            if (stmt_insert.length <= 0) {
                                await transaction.rollback();
                                return res.json({
                                    code: 500,
                                    status: "error",
                                    message: "Error while inserting PO",
                                });
                            }
                        }
                    } else {
                        await transaction.rollback();
                        return res.json({
                            success: false,
                            status: "error",
                            message:  "Component not valid. Please reload and contact system administrator.",
                        });
                    }
                } else {
                    // UPDATE
                    let stmt_check_comp = await invtDB.query(
                        "SELECT * FROM `components` WHERE `component_key` = :component",
                        {
                            replacements: { component: component_key },
                            type: invtDB.QueryTypes.SELECT,
                        }
                    );

                    if (stmt_check_comp.length > 0) {
                        let stmt_update = await invtDB.query(
                            "UPDATE `wo_material_received` SET `wo_m_bom_qty` = :qty, `wo_m_insert_dt` = :insert_dt, `wo_m_insert_by` = :insert_by, `wo_m_bom` = :create_trans, `wo_bom_alt_part` = :alt_parts, `wo_bom_part_status` = :status WHERE `ID` = :row AND `wo_m_work_id` = :woid AND `wo_m_component` = :part",
                            {
                                replacements: {
                                    qty: req.body.qty[i],
                                    insert_dt: moment(new Date())
                                        .tz("Asia/Kolkata")
                                        .format("YYYY-MM-DD HH:mm:ss"),
                                      insert_by: req.logedINUser,
                                    create_trans: bom_recipe_id,
                                    row: decoded_row_id,
                                    woid: wo_transaction_id,
                                    part: component_key,
                                    alt_parts: alt_part_str,
                                    status: part_status,
                                },
                                type: invtDB.QueryTypes.UPDATE,
                                transaction: transaction,
                            }
                        );

                        if (stmt_update.length <= 0) {
                            await transaction.rollback();
                            return res.json({
                                success: false,
                                status: "error",
                                message: "Error while updating PO",
                            });
                        }
                    } else {
                        await transaction.rollback();
                        return res.json({
                            success: false,
                            status: "error",
                            message: "Component not valid. Please reload and contact system administrator.",
                        });
                    }
                }
            }

            await transaction.commit();
            return res.json({
                success: true,
                status: "success",
                message: "PO updated successfully...",
            });
        } else {
            await transaction.rollback();
            return res.json({
                success: false,
                status: "error",
                message: "Work Order transaction ID is not valid",
            });
        }
    } catch (error) {
        console.log(error);
        await transaction.rollback();
        return res.status(500).json({
            success: false,
            status: "error",
            message: "Internal Error<br/>If this condition persists, contact your system administrator",
            error: error.stack,
        });
    }
});



module.exports = router;