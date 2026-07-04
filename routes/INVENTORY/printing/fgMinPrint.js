let { invtDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();


const htmlToPdf = require("html-pdf-node");
const fs = require("fs");
const path = require("path");
const Validator = require("validatorjs");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const minHtml = require("./minHtml");


router.post("/getFGMinsTransaction", async (req, res) => {
    try {
        const limit = 50;
        const searchTerm = req.body.searchTerm;

        let stmt;

        if (!searchTerm) {
            // 🔹 Initial load (latest FGMIN)
            stmt = await invtDB.query(
                `
        SELECT DISTINCT
          mfg_pro_apr_transaction AS transaction_id
        FROM mfg_production_3
        WHERE
          type = 'FGMIN'
          AND mfg_pro_apr_transaction IS NOT NULL
          AND mfg_pro_apr_transaction != '--'
        ORDER BY mfg_pro_apr_fulldate DESC
        LIMIT :limit
        `,
                {
                    replacements: { limit },
                    type: invtDB.QueryTypes.SELECT,
                }
            );
        } else {
            // 🔹 Search (transaction / vendor)
            stmt = await invtDB.query(
                `
        SELECT DISTINCT
          mfg_pro_apr_transaction AS transaction_id
        FROM mfg_production_3
        WHERE
          type = 'FGMIN'
          AND mfg_pro_apr_transaction IS NOT NULL
          AND mfg_pro_apr_transaction != '--'
          AND (
            mfg_pro_apr_transaction LIKE :search
            OR in_vendor_name LIKE :search
          )
        ORDER BY mfg_pro_apr_fulldate DESC
        LIMIT :limit
        `,
                {
                    replacements: {
                        search: `%${searchTerm}%`,
                        limit,
                    },
                    type: invtDB.QueryTypes.SELECT,
                }
            );
        }

        if (!stmt || stmt.length === 0) {
            return res.json({
                success: false,
                message: "No results found",
                data: [],
            });
        }

        // 🔹 Dropdown-friendly response
        const result = stmt.map(item => ({
            id: item.transaction_id,
            text: item.transaction_id,
        }));

        return res.json({
            success: true,
            message: "Data fetched successfully",
            data: result,
        });

    } catch (err) {
        console.error("FGMIN TRANSACTION SEARCH ERROR:", err);
        return res.json({
        success: false,
            status: "error",
            message: "Internal Error<br/>If this condition persists, contact your system administrator",
            error: err.stack,
        });
    }
});


router.post("/printFGMin", async (req, res) => {
    let validation = new Validator(req.body, {
        transaction: "required",
    });

    if (validation.fails()) {
        return res.json({
            success: false,
            message: { msg: "something you missing in form field to supply" },
            status: "error"
        });
    }

    try {
        let stmt = await invtDB.query(
            `SELECT mp.*, mp.mfg_pro_apr_fulldate AS material_in_date, mp.mfg_approve_in_qty AS qty, mp.in_fg_rate AS rate, mp.fg_gst_rate AS gst_rate, mp.fg_cgst AS cgst, mp.fg_sgst AS sgst, mp.fg_igst AS igst, mp.fg_gst_type AS gst_type, mp.fg_hsn_code AS hsn_code, mp.fg_out_remark AS remark, mp.exchange_rate AS exchange_rate, mp.currency_type AS currency_type, p.p_name, p.p_sku, units.units_name AS p_unit, al.user_name, al.Email_ID, lm.loc_name, b.branch_name, ic.currency_symbol, ic.currency_notes, ven_basic_detail.ven_register_id AS vendor_id, ven_basic_detail.ven_name AS vendor_name, vaddr.ven_add_gst AS vendor_gst, vaddr.ven_address AS vendor_address, vaddr.ven_city AS vendor_city, vaddr.ven_state AS vendor_state, vaddr.ven_pincode AS vendor_pincode, project_master.project_name AS project_name, project_master.project_description AS project_description, cost_center.cost_center_name AS cost_center_name, cost_center.cost_center_key AS cost_center_code FROM mfg_production_3 mp 
            LEFT JOIN ven_basic_detail 
                ON mp.in_vendor_name = ven_basic_detail.ven_register_id 
            LEFT JOIN ven_address_detail vaddr ON vaddr.ven_id = ven_basic_detail.ven_register_id 
                AND ( (mp.in_vendor_branch IS NOT NULL AND mp.in_vendor_branch != '' AND mp.in_vendor_branch != '--' AND vaddr.ven_address_id = mp.in_vendor_branch) 
                      OR ((mp.in_vendor_branch IS NULL OR mp.in_vendor_branch = '' OR mp.in_vendor_branch = '--') AND vaddr.ven_address_id = (SELECT MIN(v2.ven_address_id) FROM ven_address_detail v2 WHERE v2.ven_id = ven_basic_detail.ven_register_id)) )
            LEFT JOIN products p 
                ON mp.mfg_pro_apr_sku = p.p_sku 
            LEFT JOIN admin_login al  
                ON mp.mfg_pro_apr_by = al.CustID 
            LEFT JOIN cost_center 
                ON cost_center.cost_center_key = mp.mfg_cost_center 
            LEFT JOIN project_master 
                ON project_master.project_name = mp.mfg_project_id
            LEFT JOIN location_main lm  
                ON mp.mfg_pro_location_in = lm.location_key  
                AND lm.loc_status = 'ACTIVE' 
            LEFT JOIN branches b 
                ON mp.company_branch = b.branch_code 
            LEFT JOIN ims_currency ic 
                ON mp.currency_type = ic.currency_id 
            LEFT JOIN units
                ON p.p_uom = units.units_id
            WHERE mp.mfg_pro_apr_transaction = :transaction 
                AND mp.type = 'FGMIN' 
            ORDER BY mp.mfg_pro_apr_fulldate ASC`,
            {
                replacements: { transaction: req.body.transaction },
                type: invtDB.QueryTypes.SELECT,
            }
        );

        if (stmt.length === 0) {
            return res.json({
                success: false,
                message: { msg: "No FG/SFG MIN Found for this transaction" },
                status: "error"
            });
        }

        const header = stmt[0];

        // VENDOR DETAILS — from joins
        const vendor_name = header.vendor_name || "--";
        const vendor_id = header.vendor_id || "--";
        const vendor_gst = header.vendor_gst || "--";
        const vendor_address = header.vendor_address || "--";
        const vendor_city = header.vendor_city || "--";
        const vendor_state = header.vendor_state || "--";
        const vendor_pincode = header.vendor_pincode || "--";

        // PROJECT & COST CENTER
        const project_name = header.project_description && header.project_name
            ? `${header.project_description} ${header.project_name}`
            : "--";
        const cost_center_name = header.cost_center_name || "--";

        // 12 columns to match minHtml: # | PART | ITEM/DESC | UOM | QTY | AMT | Custom Duty | Freight | GST % | TAX AMT | TOTAL AMT | IN LOCATION
        let items_data = "";
        let count = 0;
        let sum_taxable = 0;
        let sum_tax_amt = 0;
        let sum_total = 0;
        let totalQTY = 0;
        const curr_sym = header.currency_symbol && header.currency_symbol !== "--" ? header.currency_symbol : "₹";

        for (let i = 0; i < stmt.length; i++) {
            const item = stmt[i];

            const qty = Number(item.qty) || 0;
            const rate = Number(item.rate) || 0;
            const gst_rate_pct = Number(item.gst_rate) || 0;   // GST % (e.g. 18)
            const exchange = Number(item.exchange_rate) || 1;

            const taxable_value = qty * rate * exchange;
            // Tax from GST % only — fg_cgst/fg_sgst/fg_igst may be stored as amounts, not rates
            const taxAmt = (taxable_value * gst_rate_pct) / 100;
            const total_row = taxable_value + taxAmt;

            const hsn_code = item.hsn_code && item.hsn_code !== "--" ? item.hsn_code : "N/A";
            const remark_txt = item.remark && item.remark !== "--" ? `<br/><i>remark: ${item.remark}</i>` : "";
            const loc_name = item.loc_name || "N/A";
            const rateDisplay = (rate * exchange).toFixed(2);
            const amtDisplay = curr_sym === "₹" ? "₹" + taxable_value.toFixed(2) : taxable_value.toFixed(2);
            const totalDisplay = curr_sym === "₹" ? "₹" + total_row.toFixed(2) : total_row.toFixed(2);

            items_data += `<tr>
                    <td>${count + 1}</td>
                    <td>${item.p_sku || "--"}</td>
                    <td>${item.p_name || "--"}<br/><b><i>HSN: ${hsn_code}</i></b>${remark_txt}</td>
                    <td>${item.p_unit || "--"}</td>
                    <td>${qty} @ ${rateDisplay}</td>
                    <td>${amtDisplay}</td>
                    <td>--</td>
                    <td>--</td>
                    <td>${gst_rate_pct} %</td>
                    <td>${taxAmt.toFixed(2)}</td>
                    <td>${totalDisplay}</td>
                    <td>${loc_name}</td>
                </tr>`;

            count++;
            sum_taxable += taxable_value;
            sum_tax_amt += taxAmt;
            sum_total += total_row;
            totalQTY += qty;
        }

        // Same data shape as minPrint for minHtml template (supplier address, vendor, columns, totals)
        const data = {
            min_txn_id: header.mfg_pro_apr_transaction,
            inward_date: moment(header.material_in_date, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY hh:mm A") + " IST",

            delivery_address: vendor_address !== "--" ? `${vendor_address}, ${vendor_city}, ${vendor_state} - ${vendor_pincode}` : "--",
            delivery_gst: vendor_gst || "--",

            branch: header.branch_name || "--",

            vendor_name: vendor_name,
            vendor_address: vendor_address || "N/A",
            vendor_city: vendor_city || "N/A",
            vendor_state: vendor_state || "N/A",
            vendor_pincode: vendor_pincode || "N/A",
            vendor_gst: vendor_gst || "N/A",
            vendor_id: vendor_id,

            material_in_invno: header.in_fg_invoice_id || "--",
            material_in_type_label: "JW/PO Number :",
            material_in_jwpono: "NOT AVAILABLE",

            cost_center_label: cost_center_name !== "--" ? "Cost Center :" : "",
            cost_center_value: cost_center_name !== "--" ? cost_center_name : "",

            project_name: project_name || "N/A",

            invoice_id: header.in_fg_invoice_id || "--",
            acknowledgement_id: header.ackwlg_irn != null ? header.ackwlg_irn : "--",

            min_done_by: header.user_name || "--",

            totalQTY: totalQTY,
            sum_norm_amt: curr_sym === "₹" ? "₹ " + sum_taxable.toFixed() : sum_taxable.toFixed(),
            sum_tax_amt: sum_tax_amt.toFixed(2),
            sum_total_amt: curr_sym === "₹" ? "₹ " + sum_total.toFixed(2) : sum_total.toFixed(2),
        };

        // Use same template as MIN print (minHtml) — exact format, columns, supplier address
        let html = minHtml.minHtml(data, items_data, "");

        let pdfBuffer;

        try {
            pdfBuffer = await htmlToPdf.generatePdf(
                { content: html },
                {
                    format: "A4",
                    margin: {
                        top: "10mm",
                        bottom: "10mm",
                    },
                }
            );
        } catch (pdfErr) {
            // console.error("PDF generation failed:", pdfErr);

            return res.status(500).json({
                success: false,
                status: "error",
                message: "PDF generation failed",
                error: pdfErr.message,
            });
        }

        // Ensure buffer type
        const finalBuffer = Buffer.isBuffer(pdfBuffer)
            ? pdfBuffer
            : Buffer.from(pdfBuffer);

        const baseName = `${header.mfg_pro_apr_transaction.replace(/\//g, "_")}`;


        // Success response
        return res.json({
            status: "success",
            success: true,
            message: "PDF generated & saved successfully",
            data: {
                filename: `${baseName}.pdf`,
                size: finalBuffer.length,
                buffer: finalBuffer,
            },
        });

    } catch (err) {
        return helper.errorResponse(res, err);
    }
});



module.exports = router;

