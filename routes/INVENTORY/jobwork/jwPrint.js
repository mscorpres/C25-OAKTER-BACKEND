const express = require("express");
const router = express.Router();

let { invtDB, otherDB } = require("../../../config/db/connection");


const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");
const html_to_pdf = require("html-pdf-node");

checkIfZero = (value) => {
	value = value > 0 ? value : 0;
	return value;
};

// PRINT JW PO
router.post("/printPO", [auth.isAuthorized], async (req, res) => {
	try {
		const jw_id = req.body.transaction;
		let stmt = await invtDB.query("SELECT * FROM `jw_purchase_req` WHERE `jw_jw_transaction` = :transaction_id LIMIT 1", {
			replacements: { transaction_id: jw_id },
			type: invtDB.QueryTypes.SELECT,
		});

		if (stmt.length > 0) {
			let billing_address_id = stmt[0].jw_po_billing_add_id;
			let billing_address = stmt[0].jw_po_billing_addr;

			let vendor_branch_code = stmt[0].jw_po_ven_add_id;
			let party_address = stmt[0].jw_po_vendor_address;

			let quotation = stmt[0].jw_quotation_detail;
			let payment_terms = stmt[0].jw_payment_terms;
			let termscondition = stmt[0].jw_terms_condition;

			let jw_transaction_id = stmt[0].jw_jw_transaction;
			let jw_reg_date = moment(stmt[0].jw_po_full_date, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY");

			let dispatch_from = stmt[0].jw_po_ship_id;
			let dispatch_from_addr = stmt[0].jw_po_dispatch_addr;
			let dispatch_from_pin_code = stmt[0].jw_po_ship_pincode;

			let gst_rate = stmt[0].jw_po_gstrate;
			let cgst = stmt[0].jw_po_cgst;
			let sgst = stmt[0].jw_po_sgst;
			let igst = stmt[0].jw_po_igst;

			let party_state;
			let party_gstin;

			let stmt_bill_add = await invtDB.query("SELECT * FROM `billing_address` LEFT JOIN `state_code` ON `billing_address`.`billing_state` = `state_code`.`state_code` WHERE `billing_address`.`billing_code` = :code", {
				replacements: { code: billing_address_id },
				type: invtDB.QueryTypes.SELECT,
			});

			if (stmt_bill_add.length > 0) {
				let billing_company = stmt_bill_add[0].billing_company;
				let billing_address_1 = stmt_bill_add[0].billing_address;
				let billing_gstid = stmt_bill_add[0].billing_gstno;
				let billing_panno = stmt_bill_add[0].billing_pan;
				let billing_cin = stmt_bill_add[0].billing_cin;
				let billing_state_code = stmt_bill_add[0].billing_state;
				let billing_state_name = stmt_bill_add[0].state_name;

				if (billing_address == null || billing_address == "") {
					billing_address = billing_address_1;
				}

				let stmt_dispach = await invtDB.query("SELECT * FROM `shipment_address` WHERE `shipment_code` = :shipment_id", {
					replacements: { shipment_id: dispatch_from },
					type: invtDB.QueryTypes.SELECT,
				});
				if (stmt_dispach.length > 0) {
					let dispatch_from_company = stmt_dispach[0].shipment_company;
					let dispatch_from_company_gst_id = stmt_dispach[0].shipment_gstin;
					let dispatch_state_name = stmt_dispach[0].shipment_state + " (" + stmt_dispach[0].shipment_state_code + ")";
					let dispatch_from_pin_code = stmt_dispach[0].shipment_pincode;

					if (dispatch_from_addr == null || dispatch_from_addr == "") {
						dispatch_from_addr = stmt_dispach[0].shipment_address;
					}

					if (party_address == null || party_address == "") {
						let stmt_ven_addr = await invtDB.query("SELECT * FROM `ven_address_detail` LEFT JOIN `state_code` ON `ven_address_detail`.`ven_state` = `state_code`.`state_code` WHERE `ven_address_detail`.`ven_address_id` = :shipment_id", {
							replacements: { shipment_id: vendor_branch_code },
							type: invtDB.QueryTypes.SELECT,
						});

						if (stmt_ven_addr.length > 0) {
							party_address = stmt_ven_addr[0].ven_address_line;
							party_state = stmt_ven_addr[0].state_name + " (" + stmt_ven_addr[0].state_code + ")";
							party_gstin = stmt_ven_addr[0].ven_add_gst;
						} else {
							party_address = "N/A";
							party_state = "N/A";
							party_gstin = "N/A";
						}
					}

					let stmt_ven_add_detail = await invtDB.query("SELECT * FROM `ven_address_detail` LEFT JOIN `ven_basic_detail` ON `ven_address_detail`.`ven_id` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `state_code` ON `ven_address_detail`.`ven_state` = `state_code`.`state_code` WHERE `ven_address_detail`.`ven_address_id` = :shipment_id", {
						replacements: { shipment_id: vendor_branch_code },
						type: invtDB.QueryTypes.SELECT,
					});

					if (stmt_ven_add_detail.length > 0) {
						dispatch_to_vendor_name = stmt_ven_add_detail[0].ven_name;
						party_state = stmt_ven_add_detail[0].state_name + " (" + stmt_ven_add_detail[0].state_code + ")";
						party_gstin = stmt_ven_add_detail[0].ven_add_gst;
					} else {
						party_state = "N/A";
						party_gstin = "N/A";
					}
				}

				let stmt = await invtDB.query(
					"SELECT *, jw_purchase_req.ID AS myID FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` OR `jw_purchase_req`.`jw_po_sku` = `products`.`m_sku` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` WHERE `jw_purchase_req`.`jw_jw_transaction` = :transaction_id ORDER BY jw_purchase_req.ID ASC",
					{
						replacements: { transaction_id: jw_id },
						type: invtDB.QueryTypes.SELECT,
					}
				);

				if (stmt.length > 0) {
					let table_row = "";
					let sr = 0;
					let sum_of_qty = 0;
					let sum_of_amount = 0;
					for (let i = 0; i < stmt.length; i++) {
						sum_of_qty += helper.numebr(stmt[i].jw_po_order_qty);
						sum_of_amount = helper.numebr(stmt[i].jw_po_order_qty) * helper.numebr(stmt[i].jw_po_order_rate) + helper.numebr(sum_of_amount);

						if (stmt[i].jw_hsncode == "") {
							let stmt_hsn = await invtDB.query("SELECT `p_hsncode` FROM `products` WHERE `component_key` = :key", {
								replacements: { key: stmt[i].jw_po_sku },
								type: invtDB.QueryTypes.SELECT,
							});

							if (stmt_hsn.length > 0) {
								hsn_code = stmt_hsn[0].p_hsncode;
							} else {
								hsn_code = "N/A";
							}
						} else {
							hsn_code = stmt[i].jw_hsncode;
						}

						table_row += `
							<tr>
								<td width="5%" align="left" valign="middle" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">${sr}</td>
								<td align="left" valign="middle" colspan="4" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">${stmt[i].p_name}</td>
								<td align="left" valign="middle" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">'${stmt[i].p_sku}</td>
								<td align="left" valign="middle" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">${stmt[i].jw_po_order_qty}</td>
								<td align="left" valign="middle" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">${stmt[i].jw_po_order_rate}</td>
								<td align="left" valign="middle" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">${stmt[i].units_name}</td>
								<td align="right" valign="middle" colspan="2" style="font-size: 10px; border-top: 0px; border-bottom: 0px; border-right: 1px solid #000000;">'.(${stmt[i].jw_po_order_qty * stmt[i].jw_po_order_rate}).'</td>
							</tr>
						`;
						sr++;
					}
				}
			} else {
				return res.json({ status: "error", success: false, message: "Billing Address not found" });
			}
		} else {
			return res.json({ status: "error", success: false, message: "No any transaction found" });
		}
	} catch (err) {
	    return helper.errorResponse(res, err);
	}
});

// PRINT JW ISSUE RM
router.post("/print_jw_rm_issue", [auth.isAuthorized], async (req, res) => {
	try {
		let validation = new Validator(req.body, {
			transaction: "required",
		});

		if (validation.fails()) {
			res.json({ status: "error", success: false, message: "something you missing in form field to supply", data: validation.errors.all() });
		}

		let { refid, transaction } = req.body;

		let file = { url: `${process.env.API_URL}/helper/PRINT/PHP/JW/JWissueItem.php?transaction=${transaction}` };

		let options = { format: "A4" };
		await html_to_pdf
			.generatePdf(file, options)
			.then((pdfBuffer) => {
				let filename = "JWrmIssue" + transaction + ".pdf";

				// res.setHeader("Content-disposition", 'inline; filename="vbt.pdf"');
				// res.setHeader("Content-type", "application/pdf");
				// res.send(pdfBuffer);

				return res.json({ status: "success", success: true, message: "file generated successfully...", data: { buffer: pdfBuffer, filename: filename } });
			})
			.catch((err) => {
				return res.json({ status: "error", success: false, message: "error while generating file..."});
			});
	} catch (err) {
	    return helper.errorResponse(res, err);
	}
});

module.exports = router;
