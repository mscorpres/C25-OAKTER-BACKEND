const express = require("express");
const router = express.Router();

let { invtDB } = require("../../../../config/db/connection");

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
const Validator = require("validatorjs");

// FETCH MIN DETAILS
router.post("/fetchMINData", [auth.isAuthorized], async (req, res) => {
	const validation = new Validator(req.body, {
		transaction: "required",
	});

	if (validation.fails()) {
		return res.json({
			status: "error", success: false,
			success: false,
			message: "Validation failed",
			data: validation.errors.all(),
		});
	}
	try {
		let stmt = await invtDB.query(
			"SELECT `rm_location`.*, `admin_login`.`CustID`,`admin_login`.`user_name`,`admin_login`.`Email_ID`,`admin_login`.`Mobile_No`,`rm_location`.`ID` AS `InID`, `units`.`units_name`, `location_main`.`loc_name`, `components`.`c_name`, `components`.`c_part_no` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `location_main` ON `rm_location`.`loc_in` = `location_main`.`location_key` LEFT JOIN `ven_basic_detail` ON `rm_location`.`in_vendor_name` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `ven_address_detail` ON `rm_location`.`in_vendor_branch` = `ven_address_detail`.`ven_address_id` LEFT JOIN `admin_login` ON `rm_location`.`insert_by` = `admin_login`.`CustID` WHERE `rm_location`.`in_transaction_id` = :transaction AND `rm_location`.`is_auto_cons` = 'N' AND `rm_location`.`trans_type` = 'INWARD' AND `rm_location`.`is_reversed` = 'N' AND `rm_location`.`company_branch` = :branch",
			{
				replacements: {
					transaction: req.body.transaction,
					branch: req.branch,
				},
				type: invtDB.QueryTypes.SELECT,
			}
		);
		if (stmt.length > 0) {
			let data = [],
				serial_no = 1;

			stmt.map(async (item) => {
				let gsttype, gstrate, hsncode;
				if (item.in_gst_type == "L") {
					gsttype = "Local";
				} else if (item.in_gst_type == "I") {
					gsttype = "Interstate";
				} else {
					gsttype = "N/A";
				}

				if (item.in_gst_rate !== "--" && item.in_gst_rate !== "" && item.in_gst_rate !== "0") {
					gstrate = item.in_gst_rate + "%";
				} else {
					gstrate = "N/A";
				}

				if (item.in_hsn_code !== "--") {
					hsncode = item.in_hsn_code;
				} else {
					hsncode = "N/A";
				}

				data.push({
					serial_no: serial_no,
					authentication: Buffer.from(item.InID.toString()).toString("base64"),
					hsncode: hsncode,
					gsttype: gsttype,
					gstrate: gstrate,
					componentKey: item.components_id,
					componentName: item.c_name,
					uom: item.units_name,
					location: item.loc_name,
					invoice_id: item.in_invoice_id == "--" ? item.in_po_invoice_id : item.in_invoice_id,
					partno: item.c_part_no,
					inward_qty: parseInt(item.qty) + parseInt(item.other_qty),
					min_date: moment(item.insert_date).tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm:ss"),
				});
				serial_no++;

				if (stmt.length == data.length) {
					return res.json({
						status: "success", success: true,
						success: true,
						data: data,
						header: {
							insert_by: item.user_name + " (" + item.CustID + ")",
							transaction: item.in_transaction_id,
							insert_by_useremail: item.Email_ID,
							insert_by_usermobile: item.Mobile_No,
						},
					});
				}
			});
		} else {
			return res.json({
				status: "error", success: false,
				success: false,
				message: "No MIN TXN found related to your search. It might be already consumed, cancelled, or VBP initiated.",
			});
		}
	} catch (err) {
	    return helper.errorResponse(res, err);
	}
});

// INSERT REJECTION OUT
router.post("/saveMINReversal", [auth.isAuthorized], async (req, res) => {
	const validation = new Validator(req.body, {
		transaction: "required",
		authentication: "required",
		component: "required",
	});

	if (validation.fails()) {
		return res.json({
			status: "error", success: false,
			success: false,
			message: "Validation failed",
			data: validation.errors.all(),
		});
	}
	let component_length = req.body.component.length;
	for (let i = 0; i < component_length; i++) {
		let itemValidation = new Validator(
			{
				component: req.body.component[i],
				authentication: req.body.authentication[i],
			},
			{
				component: "required",
				authentication: "required",
			}
		);
		if (itemValidation.fails()) {
			return res.json({
				status: "error", success: false,
				success: false,
				message: "Item validation failed",
				data: itemValidation.errors.all(),
			});
		}
	}
	const t = await invtDB.transaction();

	try {
		let insert_dt = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");
		for (let i = 0; i < component_length; i++) {
			let stmt1 = await invtDB.query("SELECT * FROM `rm_location` WHERE `trans_type` ='INWARD' AND `components_id` = :comp_key AND `in_transaction_id` = :in_transaction_id AND `ID` = :key AND `company_branch` = :branch", {
				replacements: {
					branch: req.branch,
					comp_key: req.body.component[i],
					in_transaction_id: req.body.transaction,
					key: Buffer.from(req.body.authentication[i], "base64").toString("ascii"),
				},
				type: invtDB.QueryTypes.SELECT,
			});
			if (stmt1.length > 0) {
				if (stmt1[0].is_reversed == "Y") {
					return res.json({
						status: "error", success: false,
						success: false,
						message: "Transaction cannot be reversed. It seems it's already been done.",
					});
				} else if (stmt1[0].vbp_status == "Y") {
					return res.json({
						status: "error", success: false,
						success: false,
						message: "Transaction cannot be reversed. It seems VBP is already created.",
					});
				} else if (stmt1[0].is_auto_cons == "Y") {
					return res.json({
						status: "error", success: false,
						success: false,
						message: "Transaction cannot be reversed. It seems consumption is already done.",
					});
				} else {
					let stmt2 = await invtDB.query(
						"INSERT INTO `rm_location` (`company_branch`,`trans_type`,`components_id`,`loc_out`,`qty`,`any_remark`,`insert_date`,`insert_by`,`reversal_txn_id`,`in_transaction_id`)VALUES (:branch,:type,:component,:loc_out,:qty,:remark,:indate,:inby,:reversal_txn, :in_transaction_id)",
						{
							replacements: {
								branch: req.branch,
								type: "REVERSE",
								component: req.body.component[i],
								loc_out: stmt1[0].loc_in,
								qty: stmt1[0].qty,
								remark: req.body.remark,
								indate: insert_dt,
								inby: req.logedINUser,
								in_transaction_id: req.body.transaction,
								reversal_txn: "R-" + req.body.transaction,
							},
							type: invtDB.QueryTypes.INSERT,
							transaction: t,
						}
					);

					if (stmt2.length > 0) {
						if (stmt1[0].in_po_transaction_id !== "--") {
							let stmt3 = await invtDB.query("UPDATE `po_purchase_req` SET `po_inward_qty` = po_inward_qty - :outqty AND `po_pending_qty` = po_inward_qty + :inqty WHERE `po_part_no` = :comp_key AND `po_transaction` = :po_transaction", {
								replacements: {
									inqty: stmt1[0].qty,
									outqty: stmt1[0].qty,
									comp_key: req.body.component[i],
									po_transaction: stmt1[0].in_po_transaction_id,
								},
								type: invtDB.QueryTypes.UPDATE,
								transaction: t,
							});
						}

						let stmt4 = await invtDB.query("UPDATE `rm_location` SET `is_reversed` = 'Y' WHERE `components_id` = :comp_key AND `in_transaction_id` = :in_transaction_id AND `ID` = :key", {
							replacements: {
								comp_key: req.body.component[i],
								in_transaction_id: req.body.transaction,
								key: Buffer.from(req.body.authentication[i], "base64").toString("ascii"),
							},
							type: invtDB.QueryTypes.UPDATE,
							transaction: t,
						});

						if (i == component_length - 1) {
							t.commit();
							return res.json({
								status: "success", success: true,
								success: true,
								message: `MIN TXN [${req.body.transaction}] successfully reversed`,
							});
						}
					}
				}
			} else {
				return res.json({
					status: "error", success: false,
					success: false,
					message: "Transaction already reversed or does not exist in our records.",
				});
			}
		}
	} catch (err) {
	    return helper.errorResponse(res, err);
	}
});

module.exports = router;
