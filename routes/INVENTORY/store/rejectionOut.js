const express = require("express");
const router = express.Router();

let { invtDB } = require("../../../config/db/connection");


const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

// FETCH MIN DETAILS
router.post("/fetchMINData", [auth.isAuthorized], async (req, res) => {
	const validation = new Validator(req.body, {
		min_transaction: "required",
	});

	if (validation.fails()) {
		return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
	}
	try {
		let stmt1 = await invtDB.query(
			"SELECT *, `rm_location`.`ID` AS `InID` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `location_main` ON `rm_location`.`loc_in` = `location_main`.`location_key` LEFT JOIN `ven_basic_detail` ON `rm_location`.`in_vendor_name` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `ven_address_detail` ON `rm_location`.`in_vendor_branch` = `ven_address_detail`.`ven_address_id` LEFT JOIN `admin_login` ON `rm_location`.`insert_by` = `admin_login`.`CustID` WHERE `rm_location`.`in_transaction_id` = :transaction AND `rm_location`.`trans_type` = 'INWARD' AND `rm_location`.`company_branch` = :branch",
			{
				replacements: {
					transaction: req.body.min_transaction,
					branch: req.branch,
				},
				type: invtDB.QueryTypes.SELECT,
			}
		);
		if (stmt1.length > 0) {
			let data = [],
				serial_no = 1;

			stmt1.map(async (item) => {
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

				let vendorname, vendoraddress;
				let stmt2 = await invtDB.query("SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendorid", { replacements: { vendorid: item.in_vendor_name }, type: invtDB.QueryTypes.SELECT });
				if (stmt2.length > 0) {
					vendorname = stmt2[0].ven_name;
				} else {
					vendorname = "N/A";
				}
				if (item.in_vendor_addr !== "--" && item.in_vendor_addr !== "") {
					vendoraddress = item.in_vendor_addr;
				} else {
					vendoraddress = "N/A";
				}

				// OUTWARD
				let stmt3 = await invtDB.query(
					"SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `total_outward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` != 'CANCELLED' AND `trans_type` = 'REJECTION' AND `in_transaction_id` = :min_txn) AND `company_branch` = :branch",
					{
						replacements: { component: item.components_id, min_txn: item.in_transaction_id, branch: req.branch },
						type: invtDB.QueryTypes.SELECT,
					}
				);

				let totalOut;
				if (stmt3.length > 0) {
					totalOut = stmt3[0].total_outward;
				} else {
					totalOut = 0;
				}

				data.push({
					serial_no: serial_no,
					hsncode: hsncode,
					gsttype: gsttype,
					gstrate: gstrate,
					componentKey: item.components_id,
					componentName: item.c_name,
					uom: item.units_name,
					locationKey: item.location_key,
					location: item.loc_name,
					po_transaction_id: item.in_po_transaction_id,
					po_invoice_id: item.in_po_invoice_id,
					material_in_invoice_id: item.in_invoice_id,
					remark: item.any_remark,
					partno: item.c_part_no,
					inward_qty: parseInt(item.qty) + parseInt(item.other_qty),
					rejected_qty: totalOut,
					min_date: moment(item.insert_date).tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm:ss"),
				});
				serial_no++;

				if (stmt1.length == data.length) {
					return res.json({ status: "success", success: true, message: "", data: data, header: { vendorname: vendorname, vendorbranch: item.in_vendor_branch, vendoraddress: vendoraddress, insert_by: item.user_name, transaction: item.in_transaction_id } });
				}
			});
		} else {
			return res.json({ status: "error", success: false, message: "no any MIN found to related your post request" });
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

// INSERT REJECTION OUT
router.post("/saveRejection", [auth.isAuthorized], async (req, res) => {
	const validation = new Validator(req.body, {
		min_transaction: "required",
	});

	if (validation.fails()) {
		return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
	}

	let component_length = req.body.component.length;
	for (let i = 0; i < component_length; i++) {
		let itemValidation = new Validator(
			{
				component: req.body.component[i],
				qty: req.body.qty[i],
				loc_to: req.body.loc_to[i],
			},
			{
				component: "required",
				qty: "required|min:1",
				loc_to: "required",
			}
		);
		if (itemValidation.fails()) {
			return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(itemValidation) });
		}
	}

	const t = await invtDB.transaction();

	try {
		let stmt = await invtDB.query("SELECT `rej_transaction_id` FROM `rm_location` WHERE `rej_transaction_id` != '--' GROUP BY `rej_transaction_id` ORDER BY `ID` DESC LIMIT 1", {
			type: invtDB.QueryTypes.SELECT,
		});
		let transactionCode;

		if (stmt.length > 0) {
			transactionCode = stmt[0].rej_transaction_id;
			let strings = transactionCode.replace(/[0-9]/g, "");
			let digits = (parseInt(transactionCode.replace(/[^0-9]/g, "")) + 1).toString();
			if (digits.length < 3) digits = ("000" + digits).substr(-3);
			transactionCode = strings + digits;
		} else {
			transactionCode = "REJ001";
		}

		let insert_dt = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");
		
		for (let i = 0; i < component_length; i++) {
			if (helper.number(req.body.qty[i]) > 0) {
				if (req.body.loc_to[i] == "0") {
					t.rollback();
					return res.json({ status: "error", success: false, message: "rejection out from location not getting" });
				}
				let stmt1 = await invtDB.query("SELECT * FROM `rm_location` WHERE `components_id` = :component AND `in_transaction_id` = :min_txn AND `trans_type` = 'INWARD' AND `company_branch` = :branch", {
					replacements: { component: req.body.component[i], min_txn: req.body.min_transaction, branch: req.branch },
					type: invtDB.QueryTypes.SELECT,
				});
				if (stmt1.length > 0) {
					let stmt2 = await invtDB.query(
						"SELECT *, COALESCE(SUM(`qty`+`other_qty`), 0) AS `totalCreditYet` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`. `component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `rm_location`.`components_id` = :component AND `rm_location`.`in_transaction_id` = :transaction AND `rm_location`.`trans_type` = 'INWARD' AND `rm_location`.`company_branch` = :branch",
						{ replacements: { component: req.body.component[i], transaction: req.body.min_transaction, branch: req.branch }, type: invtDB.QueryTypes.SELECT }
					);
					if (stmt2.length > 0) {
						if (stmt2[0] >= req.body.qty[i]) {
							// OUTWARD
							let stmt3 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `total_outward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` != 'CANCELLED') AND `loc_out` = :location AND `company_branch` = :branch", {
								replacements: { component: req.body.component[i], location: stmt1[0].loc_in, branch: req.branch },
								type: invtDB.QueryTypes.SELECT,
							});

							let totalOut;
							if (stmt3.length > 0) {
								totalOut = stmt3[0].total_outward;
							} else {
								totalOut = 0;
							}

							//INWARD
							let stmt4 = await invtDB.query("SELECT *, COALESCE(SUM(`qty`+`other_qty`), 0) as `total_inward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` != 'CANCELLED') AND `loc_in` = :location AND `company_branch` = :branch", {
								replacements: { component: req.body.component[i], location: stmt1[0].loc_in },
								type: invtDB.QueryTypes.SELECT,
							});

							let totalIn;
							if (stmt4.length > 0) {
								totalIn = stmt4[0].total_inward;
							} else {
								totalIn = 0;
							}

							if (parseInt(totalIn) - parseInt(totalOut) >= parseInt(req.body.qty[i])) {
								let stmt5 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `totalREJYet` FROM `rm_location` WHERE `components_id` = :component AND `in_transaction_id` = :transaction AND (`trans_type` = 'REJECTION') AND `company_branch` = :branch", {
									replacements: { component: req.body.component[i], transaction: req.body.min_transaction, branch: req.branch },
									type: invtDB.QueryTypes.SELECT,
								});
								if (stmt5.length > 0) {
									if (totalIn - stmt5[0].totalREJYet >= req.body.qty[i]) {
										let stmt6 = await invtDB.query(
											"INSERT INTO `rm_location` (`company_branch`,`loc_in`,`loc_out`,`rejection_any_remark`,`trans_type`,`components_id`,`qty`,`insert_by`,`insert_date`,`rej_transaction_id`,`in_transaction_id`,`in_hsn_code`,`in_gst_type`,`in_gst_rate`)VALUES (:branch,:loc_in,:loc_out,:remark,'REJECTION',:component,:qty,:insert_by,:insert_date,:rej_transaction,:in_transaction,:hsncode,:gsttype,:gstrate)",
											{
												replacements: {
													branch: req.branch,
													loc_in: req.body.loc_to[i],
													loc_out: stmt1[0].loc_in,
													remark: req.body.remark == "" ? "--" : req.body.remark,
													component: req.body.component[i],
													qty: req.body.qty[i],
													insert_by: req.logedINUser,
													insert_date: insert_dt,
													rej_transaction: transactionCode,
													in_transaction: req.body.min_transaction,
													hsncode: stmt2[0].in_hsn_code,
													gsttype: stmt2[0].in_gst_type,
													gstrate: stmt2[0].in_gst_rate,
												},
												type: invtDB.QueryTypes.INSERT,
												transaction: t,
											}
										);

										if (i == component_length - 1) {
											await t.commit();
											return res.json({ status: "success", success: true, message: "Rejection Complted: Txn ID #" + transactionCode, data: {} });
										} else {
											t.rollback();
											return res.json({ status: "error", success: false, message: "request declined: due to some technical issue, contact to system administrator" });
										}
									} else {
										t.rollback();
										return res.json({
											status: "error", success: false,
											success: false,
											message:
												"You have already rejected " +
												stmt[0].totalREJYet +
												" " +
												stmt5[0].units_name.toUpperCase() +
												" against of the same transaction and component you have supplied, OR rejection " +
												req.body.qty[i] +
												" should be less than or equal to " +
												(totalIn - stmt5[0].totalREJYet) +
												" " +
												stmt5[0].units_name.toUpperCase(),
										});
									}
								} else {
									t.rollback();
									return res.json({ status: "error", success: false, message: "qty is not available against of the transaction for rejection" });
								}
							} else {
								t.rollback();
								return res.json({ status: "error", success: false, message: parseInt(totalIn) - parseInt(totalOut) + " Not enough quantity available in the location" });
							}
						} else {
							t.rollback();
							return res.json({ status: "error", success: false, message: "rejection should be less material inward qty" });
						}
					} else {
						t.rollback();
						return res.json({ status: "error", success: false, message: "an error occured while executing your rejection request (2)" });
					}
				} else {
					t.rollback();
					return res.json({ status: "error", success: false, message: "getting some misconfiguration issue's while executing your request for rejection" });
				}
			}
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

// FETCH Alloted Location
router.post("/fetchAllotedLocation", async (req, res) => {
	try {
		let stmt = await invtDB.query("SELECT * FROM `location_allotted` WHERE  `loc_all_key` = :location_key", {
			replacements: { location_key: "20220212164228" },
			type: invtDB.QueryTypes.SELECT,
		});

		if (stmt.length > 0) {
			let loc_alloted = stmt[0].locations.split(",");

			let result = [];
			for (let i = 0; i < loc_alloted.length; i++) {
				let stmt2 = await invtDB.query("SELECT `location_key`,`loc_name` FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ", {
					replacements: { location_defined: loc_alloted[i] },
					type: invtDB.QueryTypes.SELECT,
				});

				if (stmt2.length > 0) {
					result.push({ id: stmt2[0].location_key, text: stmt2[0].loc_name });
				}

				if (i == loc_alloted.length - 1) {
					return res.json({ status: "success", success: true, message: "", data: result });
				}
			}
		} else {
			return res.json({ status: "error", success: false, message: "location not alloted" });
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

module.exports = router;
