let { invtDB } = require("../../../config/db/connection");



const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const helper = require("../../../helper/helper");
const avgRate = require("../../../helper/utils/avgRate");

const {
	newWeightedAverageRate,
	calculateFGRate,
  } = require("../../../helper/utils/newAvgRate");
  const {
	fgWeightedAverageRate,
  } = require("../../../helper/utils/newFGavgRate");
  const Validator = require("validatorjs");
checkNegativeValue = (value) => {
	return value < 0 ? 0 : value.toFixed(2);
};

function byDate(a, b) {
	let d1 = new Date(moment(a.date, "DD-MM-YYYY HH:mm:ss"));
	let d2 = new Date(moment(b.date, "DD-MM-YYYY HH:mm:ss"));
	return d2 - d1;
}

// router.get("/q3Location", [auth.isAuthorized], async (req, res) => {
// 	try {
// 		let stmt1 = await invtDB.query("SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key", {
// 			replacements: { location_key: "2026023151444723" },
// 			type: invtDB.QueryTypes.SELECT,
// 		});
// 		// string to array
// 		let loc_ids = stmt1[0].locations.split(",");
// 		let locations = [];
// 		for (let i = 0; i < loc_ids.length; i++) {
// 			let stmt2 = await invtDB.query("SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ", {
// 				replacements: { location_defined: loc_ids[i] },
// 				type: invtDB.QueryTypes.SELECT,
// 			});
// 			stmt2.forEach((element) => {
// 				locations.push({ id: element.location_key, text: element.loc_name });
// 			});
// 			if (i == loc_ids.length - 1) {
// 				return res.json({ status: "success", success: true, data: locations });
// 			}
// 		}
// 	} catch (err) {
// 		return res.json({
// 			status: "error",
// 			success: false,
// 			message: "Internal Error<br/>If this condition persists, contact your system administrator",
// 			error: err.stack,
// 		});
// 	}
// });

// router.post("/fetchSKU_logs", [auth.isAuthorized], async (req, res) => {
// 	try {
// 		let data = [];
// 		let IN = '<span class="d-inline-block radius-round p-2 bgc-green"></span>';
// 		let OUT = '<span class="d-inline-block radius-round p-2 bgc-red"></span>';
// 		let NEUTRAL = '<span class="d-inline-block radius-round p-2 bgc-yellow"></span>';
// 		let CANCELLEND = '<span class="d-inline-block radius-round p-2 bgc-grey"></span>';

// 		if (req.body.sku_code == "") {
// 			res.json({
// 				status: "error",
// 				success: false,
// 				message: "Please supply product sku code",
// 			});
// 			return;
// 		}
// 		if (req.body.date && String(req.body.date).trim() !== "") {
// 			const parts = String(req.body.date).trim().split("-");
// 			if (parts.length === 6) {
// 				const startStr = parts.slice(0, 3).join("-");
// 				const endStr = parts.slice(3, 6).join("-");
// 				const startM = moment(startStr, "DD-MM-YYYY");
// 				const endM = moment(endStr, "DD-MM-YYYY");
// 				if (startM.isValid() && endM.isValid()) {
// 					req.body.start_date = startM.format("YYYY-MM-DD");
// 					req.body.end_date = endM.format("YYYY-MM-DD");
// 				}
// 			}
// 		}

// 	 {
// 			let stmt1 = await invtDB.query("SELECT * FROM `products` LEFT JOIN `units` ON `units`.`units_id` = `products`.`p_uom` WHERE `products`.`product_key` = :product_key", {
// 				replacements: { product_key: req.body.sku_code },
// 				type: invtDB.QueryTypes.SELECT,
// 			});

// 			if (stmt1.length > 0) {
// 				// Build WHERE clause with optional location filter
// 				let whereClause = "WHERE (mfg_production_3.mfg_pro_apr_sku = :skucode OR mfg_production_3.fgout_pro_apr_sku = :product_key)";
// 				let replacements = {
// 					skucode: stmt1[0].p_sku,
// 					product_key: req.body.sku_code,
// 				};

// 				// Add location filter if location is provided
// 				// For IN / FGMIN / TRANSFER transactions: check mfg_pro_location_in
// 				// For OUT transactions: check fgout_pro_location_out
// 			if (req.body.location && req.body.location !== "") {
// 					whereClause += " AND ((mfg_production_3.type = 'IN' AND mfg_production_3.mfg_pro_location_in = :location) OR (mfg_production_3.type = 'FGMIN' AND mfg_production_3.mfg_pro_location_in = :location) OR (mfg_production_3.type = 'TRANSFER' AND mfg_production_3.mfg_pro_location_in = :location) OR (mfg_production_3.type = 'OUT' AND mfg_production_3.fgout_pro_location_out = :location AND mfg_production_3.fg_status = 'ACTIVE'))";
// 					replacements.location = req.body.location;
// 				}

// 				const hasDateRange = req.body.start_date && req.body.end_date && String(req.body.start_date).trim() !== "" && String(req.body.end_date).trim() !== "";
// 				if (hasDateRange) {
// 					const date1 = moment(req.body.start_date).format("YYYY-MM-DD");
// 					const date2 = moment(req.body.end_date).format("YYYY-MM-DD");
// 					replacements.date1 = date1;
// 					replacements.date2 = date2;
// 					whereClause += " AND (((mfg_production_3.type IN ('IN', 'FGMIN', 'TRANSFER') AND DATE_FORMAT(mfg_production_3.mfg_pro_apr_fulldate,'%Y-%m-%d') BETWEEN :date1 AND :date2) OR (mfg_production_3.type = 'OUT' AND mfg_production_3.fg_status = 'ACTIVE' AND DATE_FORMAT(mfg_production_3.fgout_pro_apr_date,'%Y-%m-%d') BETWEEN :date1 AND :date2)))";
// 				}

// 				let queryString = `SELECT 
// 						mfg_production_3.fg_out_remark, 
// 						mfg_production_3.mfg_ref_transid_1, 
// 						mfg_production_3.mfg_ref_transid_2, 
// 						mfg_production_3.mfg_pro_apr_transaction, 
// 						mfg_production_3.mfg_pro_FGout_transaction, 
// 						mfg_production_3.type AS transaction_type, 
// 						mfg_production_3.mfg_pro_apr_fulldate AS in_date, 
// 						COALESCE(mfg_production_2.mfg_prod_planing_qty, mfg_production_3.mfg_approve_in_qty) AS in_qty,
// 						mfg_production_3.mfg_pro_location_in,
// 						mfg_production_3.fgout_pro_location_out,
// 						mfg_production_3.fg_out_type,
// 						mfg_production_3.in_fg_rate,
// 						user_inby.user_name AS in_by_user,
// 						user_outby.user_name AS out_by_user,
// 						mfg_production_3.fgout_pro_apr_fulldate AS out_date, 
// 						mfg_production_3.fgout_approve_out_qty AS out_qty,
// 						loc_in.loc_name AS loc_in_name,
// 						loc_out.loc_name AS loc_out_name
// 					FROM mfg_production_3 
// 					LEFT JOIN products ON mfg_production_3.mfg_pro_apr_sku = products.p_sku OR fgout_pro_apr_sku = products.product_key 
// 					LEFT JOIN mfg_production_2 ON mfg_production_3.mfg_ref_transid_2 = mfg_production_2.mfg_transaction AND mfg_production_2.mfg_prod_type = 'C'
// 					LEFT JOIN admin_login AS user_inby ON user_inby.CustID = mfg_production_3.mfg_pro_apr_by 
// 					LEFT JOIN admin_login AS user_outby ON user_outby.CustID = mfg_production_3.fgout_pro_apr_by
// 					LEFT JOIN location_main AS loc_in ON loc_in.location_key = mfg_production_3.mfg_pro_location_in
// 					LEFT JOIN location_main AS loc_out ON loc_out.location_key = mfg_production_3.fgout_pro_location_out
// 					${whereClause}
// 					ORDER BY mfg_production_3.ID DESC`;

// 				let stmt2 = await invtDB.query(queryString, {
// 					replacements: replacements,
// 					type: invtDB.QueryTypes.SELECT,
// 				});

// 				if (stmt2.length > 0) {
// 					let openingQty = 0;
// 					let creditInRange = 0;
// 					let debitInRange = 0;

// 					if (hasDateRange) {
// 						const date1 = moment(req.body.start_date).format("YYYY-MM-DD");
// 						const date2 = moment(req.body.end_date).format("YYYY-MM-DD");

// 						const r5Row = await invtDB.query(
// 							"SELECT COALESCE(SUM(CASE WHEN `type` IN ('IN', 'FGMIN') AND `mfg_pro_apr_sku` = :sku AND DATE_FORMAT(`mfg_pro_apr_fulldate`,'%Y-%m-%d') BETWEEN :date1 AND :date2 THEN `mfg_approve_in_qty` ELSE 0 END),0) totalIN, COALESCE(SUM(CASE WHEN `type` IN ('OUT') AND `fgout_pro_apr_sku` = :product AND DATE_FORMAT(`fgout_pro_apr_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 THEN `fgout_approve_out_qty` ELSE 0 END),0) totalOut, COALESCE(SUM(CASE WHEN `type` IN ('IN', 'FGMIN') AND `mfg_pro_apr_sku` = :sku AND DATE_FORMAT(`mfg_pro_apr_fulldate`,'%Y-%m-%d') < :date1 THEN `mfg_approve_in_qty` ELSE 0 END),0) totalOP_in, COALESCE(SUM(CASE WHEN `type` IN ('OUT') AND `fgout_pro_apr_sku` = :product AND DATE_FORMAT(`fgout_pro_apr_date`,'%Y-%m-%d') < :date1 THEN `fgout_approve_out_qty` ELSE 0 END),0) totalOP_out FROM `mfg_production_3` WHERE `fg_status` = 'ACTIVE'",
// 							{
// 								replacements: { sku: stmt1[0].p_sku, product: req.body.sku_code, date1, date2 },
// 								type: invtDB.QueryTypes.SELECT,
// 							}
// 						);
// 						if (r5Row.length > 0) {
// 							const totalIn = Number(r5Row[0].totalIN) || 0;
// 							const totalOut = Number(r5Row[0].totalOut) || 0;
// 							openingQty = helper.number(Number(r5Row[0].totalOP_in) - Number(r5Row[0].totalOP_out));
// 							creditInRange = totalIn;
// 							debitInRange = totalOut;
// 						}
// 					}

// 					// Get opening data from tbl_sku_average_rate
// 					const openingData = await invtDB.query(
// 						"SELECT average_rate, closing_qty, total_value FROM tbl_sku_average_rate WHERE sku_key = :productKey",
// 						{
// 							replacements: { productKey: req.body.sku_code },
// 							type: invtDB.QueryTypes.SELECT,
// 						}
// 					);

// 					// Get opening qty directly from tbl_sku_average_rate
					
// 					if (!hasDateRange && openingData.length > 0) {
// 						openingQty = openingData[0].closing_qty || 0;
// 					}

// 					// Get last rate from most recent IN or FGMIN transaction
// 					let lastRate = 0;
// 					// Find most recent IN or FGMIN transaction
// 					const inOrFGMINTransactions = stmt2.filter(item => 
// 						(item.transaction_type === "IN" && item.mfg_ref_transid_2) || 
// 						(item.transaction_type === "FGMIN" && item.in_fg_rate)
// 					);

// 					if (inOrFGMINTransactions.length > 0) {
// 						// Get the first one (most recent since stmt2 is ordered by ID DESC)
// 						const lastTransaction = inOrFGMINTransactions[0];

// 						if (lastTransaction.transaction_type === "FGMIN" && lastTransaction.in_fg_rate) {
// 							// For FGMIN, use rate from mfg_production_3.in_fg_rate
// 							lastRate = lastTransaction.in_fg_rate || 0;
// 						} else if (lastTransaction.transaction_type === "IN" && lastTransaction.mfg_ref_transid_2) {
// 							// For IN, fetch rate from mfg_production_2 (only from type 'C' rows)
// 							try {
// 								const lastRateStmt = await invtDB.query(
// 									"SELECT `in_fg_rate` FROM `mfg_production_2` WHERE `mfg_transaction` = :mfg_transaction AND `mfg_prod_type` = 'C' LIMIT 1",
// 									{
// 										replacements: { mfg_transaction: lastTransaction.mfg_ref_transid_2 },
// 										type: invtDB.QueryTypes.SELECT,
// 									}
// 								);
// 								if (lastRateStmt.length > 0 && lastRateStmt[0].in_fg_rate) {
// 									lastRate = lastRateStmt[0].in_fg_rate || 0;
// 								}
// 							} catch (e) {
// 								// Error fetching last rate
// 							}
// 						}
// 					}

// 					if (lastRate === 0 && openingData.length > 0) {
// 						// Fallback to average_rate from tbl_sku_average_rate
// 						lastRate = openingData[0].average_rate || 0;
// 					}

// 					//DEBIT BALANCE
// 					let stmt3 = await invtDB.query("SELECT COALESCE(SUM(`DebitQTY`),0) as `DebitBalance` FROM (SELECT `fgout_approve_out_qty` DebitQTY FROM `mfg_production_3` WHERE `fgout_pro_apr_sku` = :productkey AND type = 'OUT') t", {
// 						replacements: {
// 							productkey: req.body.sku_code,
// 						},
// 						type: invtDB.QueryTypes.SELECT,
// 					});
// 					let debitBal;
// 					let products;
// 					if (stmt3.length > 0) {
// 						debitBal = stmt3[0].DebitBalance || 0;
// 						products = stmt3[0].p_name + " " + stmt1[0].p_name;
// 					} else {
// 						debitBal = 0;
// 						products = "--";
// 					}

// 					//CREDIT BALANCE
// 					let stmt4 = await invtDB.query("SELECT COALESCE(SUM(`mfg_approve_in_qty`),0) AS `totalQTYinTODAY` FROM `mfg_production_3` WHERE `mfg_pro_apr_sku` = :sku AND `type` IN('IN', 'FGMIN')", {
// 						replacements: {
// 							sku: stmt1[0].p_sku,
// 						},
// 						type: invtDB.QueryTypes.SELECT,
// 					});
// 					let creditBal;
// 					if (stmt4.length > 0) {
// 						creditBal = stmt4[0].totalQTYinTODAY || 0;
// 					} else {
// 						creditBal = 0;
// 					}

// 					// Pre-fetch all in_fg_rate from mfg_production_2 for IN transactions (batch fetch for performance)
// 					const inTransactions = stmt2.filter(item => item.transaction_type === "IN" && item.mfg_ref_transid_2);
// 					const mfgTransactionIds = [...new Set(inTransactions.map(item => item.mfg_ref_transid_2))];

// 					// Batch fetch all rates in one query
// 					let mfgRatesMap = new Map();
// 					if (mfgTransactionIds.length > 0) {
// 						// Build IN clause with placeholders
// 						const placeholders = mfgTransactionIds.map((_, index) => `:mfg_no${index}`).join(', ');
// 						const batchReplacements = {};
// 						mfgTransactionIds.forEach((id, index) => {
// 							batchReplacements[`mfg_no${index}`] = id;
// 						});

// 						const batchRateQuery = `
// 							SELECT mfg_transaction, in_fg_rate 
// 							FROM mfg_production_2 
// 							WHERE mfg_transaction IN (${placeholders})
// 							AND mfg_prod_type = 'C'
// 						`;

// 						const rateResults = await invtDB.query(batchRateQuery, {
// 							replacements: batchReplacements,
// 							type: invtDB.QueryTypes.SELECT,
// 						});

// 						// Create map for quick lookup
// 						rateResults.forEach(row => {
// 							if (row.in_fg_rate) {
// 								mfgRatesMap.set(row.mfg_transaction, row.in_fg_rate);
// 							}
// 						});
// 					}

// 					// Process transactions with transaction-wise weighted rate calculation
// 					const transactionPromises = stmt2.map(async (item, index) => {
// 						let transaction_type;
// 						let transaction_type_label;
// 						let transaction_id;
// 						let transaction_qty;
// 						let transaction_qty_in = 0;
// 						let transaction_qty_out = 0;
// 						let transaction_doneby;
// 						let transaction_date;
// 						let qty_in_rate = 0;
// 						let out_rate = 0;
// 						let location_in = "--";
// 						let location_out = "--";
// 						let mode = "--";
// 						let weightedSKURate = 0;

// 						// Get weighted rate at transaction time (transaction-wise based on average)
// 						const txDate = (item.transaction_type == "IN" || item.transaction_type == "FGMIN" || item.transaction_type == "TRANSFER") ? item.in_date : item.out_date;
// 						const txDateFormatted = txDate ? moment(txDate).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss") : moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
// 						const txWeightedRate = await avgRate.getWeightedSKURate(req.body.sku_code, txDateFormatted);

// 						if (item.transaction_type == "IN") {
// 							transaction_type = IN;
// 							transaction_type_label = "IN";
// 							let txnParts = [];
// 							if (item.mfg_ref_transid_1) txnParts.push("PPR TXN: " + item.mfg_ref_transid_1);
// 							if (item.mfg_ref_transid_2) txnParts.push("MFG TXN: " + item.mfg_ref_transid_2);
// 							if (item.mfg_pro_apr_transaction) txnParts.push("FG IN TXN: " + item.mfg_pro_apr_transaction);
// 							transaction_id = txnParts.length > 0 ? txnParts.join("<br/>") : "N/A";
// 							transaction_date = moment(item.in_date).tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm:ss");
// 							transaction_qty = item.in_qty;
// 							transaction_qty_in = item.in_qty || 0; // qty_in from mfg_production_2.mfg_prod_planing_qty (type 'C' only, fallback to mfg_production_3.mfg_approve_in_qty)
// 							transaction_qty_out = 0;
// 							transaction_doneby = item.in_by_user;

// 							// Get stored in_fg_rate from pre-fetched map (calculated during executePPR)
// 							// This rate is already calculated and stored in mfg_production_2.in_fg_rate during executePPR
// 							let calculatedFG_Rate = 0;
// 							if (item.mfg_ref_transid_2 && mfgRatesMap.has(item.mfg_ref_transid_2)) {
// 								calculatedFG_Rate = mfgRatesMap.get(item.mfg_ref_transid_2);
// 							}
// 							// If not found, keep 0 (no fallback to mfg_production_3)

// 							qty_in_rate = calculatedFG_Rate;
// 							out_rate = 0;
// 							location_in = item.loc_in_name || "--";
// 							location_out = "--";
// 							mode = "FGIN";
// 							weightedSKURate = txWeightedRate || 0;
// 						} else if (item.transaction_type == "FGMIN") {
// 							transaction_type = IN;
// 							transaction_type_label = "FGMIN";
// 							transaction_id = item.mfg_pro_apr_transaction ? "FG MIN TXN: " + item.mfg_pro_apr_transaction : "N/A";
// 							transaction_date = moment(item.in_date).tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm:ss");
// 							transaction_qty = item.in_qty;
// 							transaction_qty_in = item.in_qty || 0;
// 							transaction_qty_out = 0;
// 							transaction_doneby = item.in_by_user || "--";
// 							qty_in_rate = item.in_fg_rate || 0;
// 							out_rate = 0;
// 							location_in = item.loc_in_name || "--";
// 							location_out = "--";
// 							mode = "FGMIN";
// 							weightedSKURate = txWeightedRate || 0;
// 						} else if (item.transaction_type == "TRANSFER") {
// 							// FG to FG transfer: show same qty in IN & OUT columns, neutral badge, clear Transfer mode
// 							transaction_type = NEUTRAL;
// 							transaction_type_label = "TRANSFER";
// 							transaction_id = item.mfg_pro_apr_transaction ? "FG TRF TXN: " + item.mfg_pro_apr_transaction : "N/A";
// 							transaction_date = moment(item.in_date).tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm:ss");
// 							transaction_qty = item.in_qty;
// 							// same quantity IN and OUT (movement only)
// 							transaction_qty_in = item.in_qty || 0;
// 							transaction_qty_out = item.in_qty || 0;
// 							transaction_doneby = item.in_by_user || "--";
// 							qty_in_rate = item.in_fg_rate || 0;
// 							out_rate = 0;
// 							// destination location (FG IN)
// 							location_in = item.loc_in_name || "--";
// 							// source location: best-effort from matching OUT row; fallback "--"
// 							const sourceOutRow =
// 								item.mfg_pro_apr_transaction
// 									? stmt2.find(
// 											(r) =>
// 												r.transaction_type === "OUT" &&
// 												r.mfg_pro_FGout_transaction === item.mfg_pro_apr_transaction
// 									  )
// 									: null;
// 							location_out =
// 								(sourceOutRow && sourceOutRow.loc_out_name) ||
// 								item.loc_out_name ||
// 								"--";
// 							mode = "TRANSFER";
// 							weightedSKURate = txWeightedRate || 0;
// 						}
// 						else if (item.transaction_type == "OUT") {
// 							transaction_type = OUT;
// 							transaction_type_label = "OUT";
// 							transaction_id = item.mfg_pro_FGout_transaction ? "FG OUT TXN: " + item.mfg_pro_FGout_transaction : "N/A";
// 							transaction_date = moment(item.out_date).tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm:ss");
// 							transaction_qty = item.out_qty;
// 							transaction_qty_in = 0;
// 							transaction_qty_out = item.out_qty || 0; // qty_out from fgout_approve_out_qty
// 							transaction_doneby = item.out_by_user || "--"; // Use out_by_user for FG OUT transactions (fgout_pro_apr_by)
// 							qty_in_rate = 0;
// 							out_rate = txWeightedRate || 0; // Last weighted rate at transaction time
// 							location_in = "--";
// 							location_out = item.loc_out_name || "--"; // From fgout_pro_location_out
// 							// Map fg_out_type to mode
// 							if (item.fg_out_type === "SL001") {
// 								mode = "SALES";
// 							} else if (item.fg_out_type === "OT001") {
// 								mode = "OTHER";
// 							} else if (item.fg_out_type === "REPL") {
// 								mode = "REPLACEMENT";
// 							} else {
// 								mode = item.fg_out_type || "--";
// 							}
// 							weightedSKURate = txWeightedRate || 0;
// 						} else {
// 							transaction_type = "N/A";
// 							transaction_type_label = "N/A";
// 							transaction_id = "N/A";
// 							transaction_date = "N/A";
// 							transaction_qty = "N/A";
// 							transaction_qty_in = 0;
// 							transaction_qty_out = 0;
// 							transaction_doneby = "N/A";
// 							qty_in_rate = 0;
// 							out_rate = 0;
// 							location_in = "--";
// 							location_out = "--";
// 							mode = "--";
// 							weightedSKURate = 0;
// 						}

// 						return {
// 							serial_no: index + 1,
// 							date: transaction_date,
// 							type: transaction_type,
// 							transaction_type: transaction_type_label,
// 							transaction: transaction_id,
// 							qty_in: transaction_qty_in,
// 							qty_out: transaction_qty_out,
// 							qty_in_rate: qty_in_rate,
// 							out_rate: out_rate,
// 							weightedSKURate: weightedSKURate,
// 							location_in: location_in,
// 							location_out: location_out,
// 							mode: mode,
// 							doneby: transaction_doneby,
// 							remark: item.fg_out_remark || "--",
// 							// Backward compatibility fields
// 							txn: transaction_id,
// 							qty: transaction_qty,
// 							uom: stmt1[0].units_name,
// 						};
// 					});

// 					// Wait for all async operations to complete
// 					const transactionData = await Promise.all(transactionPromises);
// 					data.push(...transactionData);

// 					if (stmt2.length == 0) {
// 						res.json({
// 							status: "error",
// 							success: false,
// 							message: "no any transaction found",
// 						});
// 						return;
// 					} else {
// 						// FG RETURN BALANCE
// 						const fgretunrQty = await invtDB.query("SELECT COALESCE(SUM(`qty_return`),0) as `qty_return` , COALESCE(SUM(`executed_qty`),0) as `executed_qty` FROM fg_return WHERE product_id = :sku_code AND fg_status = 'NG'", {
// 							replacements: {
// 								sku_code: req.body.sku_code,
// 							},
// 							type: invtDB.QueryTypes.SELECT,
// 						});

// 							// When date range: same as r5 — closing = openBal + (totalIn - totalOut)
// 						const closingqty = hasDateRange
// 							? helper.number(Number(openingQty) + creditInRange - debitInRange)
// 							: creditBal - debitBal;


// 						res.json({
// 							status: "success",
// 							success: true,
// 							response: {
// 								data1: {
// 									sku: stmt1[0].p_sku,
// 									uom: stmt1[0].units_name,
// 									product: stmt1[0].p_name.toUpperCase(),
// 									closingqty: closingqty,
// 									pendingfgReturnQty: (fgretunrQty[0].qty_return || 0) - (fgretunrQty[0].executed_qty || 0),
// 									openingqty: openingQty,
// 									lastRate: lastRate,
// 								},
// 								data2: data,
// 							},
// 						});
// 						return;
// 					}
// 				} else {
// 					res.json({
// 						status: "error",
// 						success: false,
// 						message: "couldn't fetch the transaction associated with this product at this location",
// 					});
// 					return;
// 				}
// 			} else {
// 				res.json({
// 					status: "error",
// 					success: false,
// 					message: "couldn't fetch the transaction bcz seems the product does not exist",
// 				});
// 				return;
// 			}
// 		}
// 	} catch (error) {
// 		res.json({
// 			status: "error",
// 			success: false,
// 			message: "Internal Error<br/>If this condition persists, contact your system administrator",
// 			error: error.stack,
// 		});
// 		return;
// 	}
// });

router.get("/location", [auth.isAuthorized], async (req, res) => {
	try {
	  let stmt1 = await invtDB.query(
		"SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
		{
		  replacements: { location_key: "2026023151444723" },
		  type: invtDB.QueryTypes.SELECT,
		},
	  );
	  // string to array
	  let loc_ids = stmt1[0].locations.split(",");
	  let locations = [];
	  for (let i = 0; i < loc_ids.length; i++) {
		let stmt2 = await invtDB.query(
		  "SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
		  {
			replacements: { location_defined: loc_ids[i] },
			type: invtDB.QueryTypes.SELECT,
		  },
		);
  
		stmt2.forEach((element) => {
		  locations.push({ id: element.location_key, text: element.loc_name });
		});
  
		if (i == loc_ids.length - 1) {
		  return res.json({ success: true, status: "success", data: locations });
		}
	  }
	} catch (err) {
		return helper.errorResponse(res, err);
	}
  });

  router.get("/", [auth.isAuthorized], async (req, res) => {
	try {
	  let data = [];
	  let IN = "IN";
	  let OUT = "OUT";
	  let NEUTRAL = "NEUTRAL";
	  let CANCELLEND = "CANCELLEND";
  
	  if (!req.query.sku || req.query.sku == "") {
		res.json({
		  status: "error",
		  message: "Please supply product sku code",
		  success: false,
		});
		return;
	  }
  
	  if (req.query.date && String(req.query.date).trim() !== "") {
		const dates = String(req.query.date)
		  .trim()
		  .match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
		if (dates && dates.length === 2) {
		  const startM = moment(dates[0], "DD-MM-YYYY");
		  const endM = moment(dates[1], "DD-MM-YYYY");
		  if (startM.isValid() && endM.isValid()) {
			req.query.start = startM.format("YYYY-MM-DD");
			req.query.end = endM.format("YYYY-MM-DD");
		  }
		}
	  }
  
	  {
		let stmt1 = await invtDB.query(
		  "SELECT * FROM `products` LEFT JOIN `units` ON `units`.`units_id` = `products`.`p_uom` WHERE `products`.`product_key` = :product_key",
		  {
			replacements: { product_key: req.query.sku },
			type: invtDB.QueryTypes.SELECT,
		  },
		);
		if (stmt1.length > 0) {
		  let whereClause =
			"WHERE (mfg_production_3.mfg_pro_apr_sku = :skucode OR mfg_production_3.fgout_pro_apr_sku = :product_key AND mfg_production_3.fg_status = 'ACTIVE')";
		  let replacements = {
			skucode: stmt1[0].p_sku,
			product_key: req.query.sku,
		  };
  
		  if (req.query.location && req.query.location !== "") {
			whereClause +=
			  " AND ((mfg_production_3.type = 'IN' AND mfg_production_3.mfg_pro_location_in = :location) OR (mfg_production_3.type = 'FGMIN' AND mfg_production_3.mfg_pro_location_in = :location) OR (mfg_production_3.type = 'TRANSFER' AND mfg_production_3.mfg_pro_location_in = :location) OR (mfg_production_3.type = 'OUT' AND mfg_production_3.fgout_pro_location_out = :location AND mfg_production_3.fg_status = 'ACTIVE'))";
			replacements.location = req.query.location;
		  }
  
		  const hasDateRange =
			req.query.start &&
			req.query.end &&
			String(req.query.start).trim() !== "" &&
			String(req.query.end).trim() !== "";
  
		  if (hasDateRange) {
			const date1 = moment(req.query.start).format("YYYY-MM-DD");
			const date2 = moment(req.query.end).format("YYYY-MM-DD");
			replacements.date1 = date1;
			replacements.date2 = date2;
			whereClause +=
			  " AND (((mfg_production_3.type IN ('IN', 'FGMIN', 'TRANSFER') AND DATE_FORMAT(mfg_production_3.mfg_pro_apr_fulldate,'%Y-%m-%d') BETWEEN :date1 AND :date2) OR (mfg_production_3.type = 'OUT' AND mfg_production_3.fg_status = 'ACTIVE' AND DATE_FORMAT(mfg_production_3.fgout_pro_apr_date,'%Y-%m-%d') BETWEEN :date1 AND :date2)))";
		  }
  
		  let queryString = `SELECT
			  mfg_production_3.ID AS m3_id,
			  mfg_production_3.fg_out_remark,
			  mfg_production_3.mfg_ref_transid_1, 
			  mfg_production_3.mfg_ref_transid_2, 
			  mfg_production_3.mfg_pro_apr_transaction, 
			  mfg_production_3.mfg_pro_FGout_transaction, 
			  mfg_production_3.type AS transaction_type, 
			  mfg_production_3.mfg_pro_apr_fulldate AS in_date, 
			  COALESCE(mfg_production_2.mfg_prod_planing_qty, mfg_production_3.mfg_approve_in_qty) AS in_qty,
			  mfg_production_3.mfg_pro_location_in,
			  mfg_production_3.fgout_pro_location_out,
			  mfg_production_3.fg_out_type,
			  mfg_production_3.fg_status AS fg_status,
			  mfg_production_2.fg_status AS mfg2_fg_status,
			  mfg_production_3.in_fg_rate,
			  user_inby.user_name AS in_by_user,
			  user_outby.user_name AS out_by_user,
			  mfg_production_3.fgout_pro_apr_fulldate AS out_date, 
			  mfg_production_3.fgout_approve_out_qty AS out_qty,
			  loc_in.loc_name AS loc_in_name,
			  loc_out.loc_name AS loc_out_name
			FROM mfg_production_3 
			LEFT JOIN products ON mfg_production_3.mfg_pro_apr_sku = products.p_sku OR fgout_pro_apr_sku = products.product_key 
			LEFT JOIN mfg_production_2 ON mfg_production_3.mfg_ref_transid_2 = mfg_production_2.mfg_transaction AND mfg_production_2.mfg_prod_type = 'C'
			LEFT JOIN admin_login AS user_inby ON user_inby.CustID = mfg_production_3.mfg_pro_apr_by 
			LEFT JOIN admin_login AS user_outby ON user_outby.CustID = mfg_production_3.fgout_pro_apr_by
			LEFT JOIN location_main AS loc_in ON loc_in.location_key = mfg_production_3.mfg_pro_location_in
			LEFT JOIN location_main AS loc_out ON loc_out.location_key = mfg_production_3.fgout_pro_location_out
			${whereClause}
			ORDER BY mfg_production_3.ID DESC`;
  
		  let stmt2 = await invtDB.query(queryString, {
			replacements: replacements,
			type: invtDB.QueryTypes.SELECT,
		  });
		  if (stmt2.length > 0) {
			let openingQty = 0;
			let creditInRange = 0;
			let debitInRange = 0;
  
			if (hasDateRange) {
			  const date1 = moment(req.query.start).format("YYYY-MM-DD");
			  const date2 = moment(req.query.end).format("YYYY-MM-DD");
  
			  const r5Row = await invtDB.query(
				"SELECT COALESCE(SUM(CASE WHEN `type` IN ('IN', 'FGMIN') AND `mfg_pro_apr_sku` = :sku AND DATE_FORMAT(`mfg_pro_apr_fulldate`,'%Y-%m-%d') BETWEEN :date1 AND :date2 THEN `mfg_approve_in_qty` ELSE 0 END),0) totalIN, COALESCE(SUM(CASE WHEN `type` IN ('OUT') AND `fg_out_type` != '--' AND `fgout_pro_apr_sku` = :product AND DATE_FORMAT(`fgout_pro_apr_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 THEN `fgout_approve_out_qty` ELSE 0 END),0) totalOut, COALESCE(SUM(CASE WHEN `type` IN ('IN', 'FGMIN') AND `mfg_pro_apr_sku` = :sku AND DATE_FORMAT(`mfg_pro_apr_fulldate`,'%Y-%m-%d') < :date1 THEN `mfg_approve_in_qty` ELSE 0 END),0) totalOP_in, COALESCE(SUM(CASE WHEN `type` IN ('OUT') AND `fg_out_type` != '--' AND `fgout_pro_apr_sku` = :product AND DATE_FORMAT(`fgout_pro_apr_date`,'%Y-%m-%d') < :date1 THEN `fgout_approve_out_qty` ELSE 0 END),0) totalOP_out FROM `mfg_production_3` WHERE `fg_status` = 'ACTIVE'",
				{
				  replacements: {
					sku: stmt1[0].p_sku,
					product: req.query.sku,
					date1,
					date2,
				  },
				  type: invtDB.QueryTypes.SELECT,
				},
			  );
			  if (r5Row.length > 0) {
				const totalIn = Number(r5Row[0].totalIN) || 0;
				const totalOut = Number(r5Row[0].totalOut) || 0;
				openingQty = helper.number(
				  Number(r5Row[0].totalOP_in) - Number(r5Row[0].totalOP_out),
				);
				creditInRange = totalIn;
				debitInRange = totalOut;
			  }
			}
  
			const openingData = await invtDB.query(
			  "SELECT average_rate, closing_qty, total_value FROM tbl_sku_average_rate WHERE sku_key = :productKey",
			  {
				replacements: { productKey: req.query.sku },
				type: invtDB.QueryTypes.SELECT,
			  },
			);
			if (!hasDateRange && openingData.length > 0) {
			  openingQty = openingData[0].closing_qty || 0;
			}
  
			let lastRate = 0;
			const lastInTransaction = stmt2.find(
			  (item) => item.transaction_type === "IN" && item.mfg_ref_transid_2,
			);
			if (lastInTransaction && lastInTransaction.mfg_ref_transid_2) {
			  try {
				const lastRateStmt = await invtDB.query(
				  "SELECT `in_fg_rate` FROM `mfg_production_2` WHERE `mfg_transaction` = :mfg_transaction AND `mfg_prod_type` = 'C' LIMIT 1",
				  {
					replacements: {
					  mfg_transaction: lastInTransaction.mfg_ref_transid_2,
					},
					type: invtDB.QueryTypes.SELECT,
				  },
				);
				if (lastRateStmt.length > 0 && lastRateStmt[0].in_fg_rate) {
				  lastRate = lastRateStmt[0].in_fg_rate || 0;
				}
			  } catch (e) {}
			}
			if (lastRate === 0 && openingData.length > 0) {
			  lastRate = openingData[0].average_rate || 0;
			}
  
			let stmt3 = await invtDB.query(
			  "SELECT COALESCE(SUM(`DebitQTY`),0) as `DebitBalance` FROM (SELECT `fgout_approve_out_qty` DebitQTY FROM `mfg_production_3` WHERE `fgout_pro_apr_sku` = :productkey AND type = 'OUT' AND fg_out_type != '--' AND fg_status = 'ACTIVE') t",
			  {
				replacements: {
				  productkey: req.query.sku,
				},
				type: invtDB.QueryTypes.SELECT,
			  },
			);
  
			let debitBal;
			let products;
			if (stmt3.length > 0) {
			  debitBal = stmt3[0].DebitBalance || 0;
			  products = stmt3[0].p_name + " " + stmt1[0].p_name;
			} else {
			  debitBal = 0;
			  products = "--";
			}
  
			let stmt4 = await invtDB.query(
			  "SELECT COALESCE(SUM(`mfg_approve_in_qty`),0) AS `totalQTYinTODAY` FROM `mfg_production_3` WHERE `mfg_pro_apr_sku` = :sku AND `type` IN('IN', 'FGMIN') AND fg_status = 'ACTIVE'",
			  {
				replacements: { sku: stmt1[0].p_sku },
				type: invtDB.QueryTypes.SELECT,
			  },
			);
			let creditBal;
			if (stmt4.length > 0) {
			  creditBal = stmt4[0].totalQTYinTODAY || 0;
			} else {
			  creditBal = 0;
			}
  
			const inTransactions = stmt2.filter(
			  (item) => item.transaction_type === "IN" && item.mfg_ref_transid_2,
			);
			const mfgTransactionIds = [
			  ...new Set(inTransactions.map((item) => item.mfg_ref_transid_2)),
			];
  
			let mfgRatesMap = new Map();
			if (mfgTransactionIds.length > 0) {
			  const placeholders = mfgTransactionIds
				.map((_, index) => `:mfg_no${index}`)
				.join(", ");
			  const replacements = {};
			  mfgTransactionIds.forEach((id, index) => {
				replacements[`mfg_no${index}`] = id;
			  });
  
			  const batchRateQuery = `
				SELECT mfg_transaction, in_fg_rate 
				FROM mfg_production_2 
				WHERE mfg_transaction IN (${placeholders})
				AND mfg_prod_type = 'C'
			  `;
  
			  const rateResults = await invtDB.query(batchRateQuery, {
				replacements: replacements,
				type: invtDB.QueryTypes.SELECT,
			  });
  
			  rateResults.forEach((row) => {
				if (row.in_fg_rate) {
				  mfgRatesMap.set(row.mfg_transaction, row.in_fg_rate);
				}
			  });
			}
  
			const transactionPromises = stmt2.map(async (item, index) => {
			  let transaction_type;
			  let transaction_type_label;
			  let transaction_id;
			  let transaction_qty;
			  let transaction_qty_in = 0;
			  let transaction_qty_out = 0;
			  let transaction_doneby;
			  let transaction_date;
			  let qty_in_rate = 0;
			  let out_rate = 0;
			  let location_in = "--";
			  let location_out = "--";
			  let mode = "--";
			  let weightedSKURate = 0;
  
			  const txDate =
				item.transaction_type == "IN" ||
				item.transaction_type == "FGMIN" ||
				item.transaction_type == "TRANSFER"
				  ? item.in_date
				  : item.out_date;
			  const txDateFormatted = txDate
				? moment(txDate).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss")
				: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
  
			  if (item.transaction_type == "IN") {
				transaction_type = IN;
				transaction_type_label = "IN";
				let txnParts = [];
				if (item.mfg_ref_transid_1)
				  txnParts.push("PPR TXN: " + item.mfg_ref_transid_1);
				if (item.mfg_ref_transid_2)
				  txnParts.push("MFG TXN: " + item.mfg_ref_transid_2);
				if (item.mfg_pro_apr_transaction)
				  txnParts.push("FG IN TXN: " + item.mfg_pro_apr_transaction);
				transaction_id =
				  txnParts.length > 0 ? txnParts.join("\n") : "N/A";
				transaction_date = moment(item.in_date)
				  .tz("Asia/Kolkata")
				  .format("DD-MM-YYYY HH:mm:ss");
				transaction_qty = item.in_qty;
				transaction_qty_in = item.in_qty || 0;
				transaction_qty_out = 0;
				transaction_doneby = item.in_by_user;

				const calculatedFG_Rate = await calculateFGRate(
				  item.mfg_ref_transid_2,
				  item.in_qty,
				);

				qty_in_rate = calculatedFG_Rate; 
				out_rate = 0;
				location_in = item.loc_in_name || "--";
				location_out = "--";
				mode = "FGIN";
				weightedSKURate =  0;
			  } else if (item.transaction_type == "FGMIN") {
				transaction_type = IN;
				transaction_type_label = "FGMIN";
				transaction_id = item.mfg_pro_apr_transaction
				  ? "FG MIN TXN: " + item.mfg_pro_apr_transaction
				  : "N/A";
				transaction_date = moment(item.in_date)
				  .tz("Asia/Kolkata")
				  .format("DD-MM-YYYY HH:mm:ss");
				transaction_qty = item.in_qty;
				transaction_qty_in = item.in_qty || 0;
				transaction_qty_out = 0;
				transaction_doneby = item.in_by_user || "--";
				qty_in_rate = item.in_fg_rate || 0;
				out_rate = 0;
				location_in = item.loc_in_name || "--";
				location_out = "--";
				mode = "FGMIN";
				weightedSKURate = 0;
			  } else if (item.transaction_type == "TRANSFER") {
				transaction_type = NEUTRAL;
				transaction_type_label = "TRANSFER";
				transaction_id = item.mfg_pro_apr_transaction
				  ? "FG TRF TXN: " + item.mfg_pro_apr_transaction
				  : "N/A";
				transaction_date = moment(item.in_date)
				  .tz("Asia/Kolkata")
				  .format("DD-MM-YYYY HH:mm:ss");
				transaction_qty = item.in_qty;
				transaction_qty_in = item.in_qty || 0;
				transaction_qty_out = item.in_qty || 0;
				transaction_doneby = item.in_by_user || "--";
				qty_in_rate = item.in_fg_rate || 0;
				out_rate = 0;
				location_in = item.loc_in_name || "--";
				const sourceOutRow = item.mfg_pro_apr_transaction
				  ? stmt2.find(
					  (r) =>
						r.transaction_type === "OUT" &&
						r.mfg_pro_FGout_transaction ===
						  item.mfg_pro_apr_transaction,
					)
				  : null;
				location_out =
				  (sourceOutRow && sourceOutRow.loc_out_name) ||
				  item.loc_out_name ||
				  "--";
				mode = "TRANSFER";
				weightedSKURate =  0;
			  } else if (item.transaction_type == "OUT") {
				transaction_type = OUT;
				transaction_type_label = "OUT";
				transaction_id = item.mfg_pro_FGout_transaction
				  ? "FG OUT TXN: " + item.mfg_pro_FGout_transaction
				  : "N/A";
				transaction_date = moment(item.out_date)
				  .tz("Asia/Kolkata")
				  .format("DD-MM-YYYY HH:mm:ss");
				transaction_qty = item.out_qty;
				transaction_qty_in = 0;
				transaction_qty_out = item.out_qty || 0;
				transaction_doneby = item.out_by_user || "--";
				qty_in_rate = 0;
				out_rate =  0;
				location_in = "--";
				location_out = item.loc_out_name || "--";
				if (item.fg_out_type === "SL001") {
				  mode = "SALES";
				} else if (item.fg_out_type === "OT001") {
				  mode = "OTHER";
				} else if (item.fg_out_type === "REPL") {
				  mode = "REPLACEMENT";
				} else {
				  mode = item.fg_out_type || "--";
				}
				weightedSKURate = 0;
			  } else {
				transaction_type = "N/A";
				transaction_type_label = "N/A";
				transaction_id = "N/A";
				transaction_date = "N/A";
				transaction_qty = "N/A";
				transaction_qty_in = 0;
				transaction_qty_out = 0;
				transaction_doneby = "N/A";
				qty_in_rate = 0;
				out_rate = 0;
				location_in = "--";
				location_out = "--";
				mode = "--";
				weightedSKURate = 0;
			  }
  
			  const m3St = String(item.fg_status || "ACTIVE").toUpperCase();
			  const m2St = String(item.mfg2_fg_status || "ACTIVE").toUpperCase();
			  const isCancelledRow =
				m3St !== "ACTIVE" ||
				((item.transaction_type === "IN" ||
				  item.transaction_type === "TRANSFER" ||
				  item.transaction_type === "FGMIN") &&
				  m2St !== "ACTIVE");
			  if (isCancelledRow) {
				transaction_type = CANCELLEND;
				if (transaction_type_label && transaction_type_label !== "N/A") {
				  transaction_type_label = `${transaction_type_label} (CANCELLED)`;
				} else {
				  transaction_type_label = "CANCELLED";
				}
			  }
  
			  return {
				serial_no: index + 1,
				date: transaction_date,
				type: transaction_type,
				transaction_type: transaction_type_label,
				transaction_id: transaction_id,
				qty_in: transaction_qty_in,
				qty_out: transaction_qty_out,
				qty_in_rate: qty_in_rate,
				out_rate: out_rate,
				weightedSKURate: weightedSKURate,
				newWAR: await fgWeightedAverageRate(req.query.sku, txDateFormatted, item.m3_id),
				location_in: location_in,
				location_out: location_out,
				mode: mode,
				doneby: transaction_doneby,
				remark: item.fg_out_remark || "--",
				qty: transaction_qty,
				uom: stmt1[0].units_name,
			  };
			});
  
			const transactionData = await Promise.all(transactionPromises);
			data.push(...transactionData);
  
			if (stmt2.length == 0) {
			  res.json({
				status: "error",
				message: "no any transaction found",
				success: false,
			  });
			  return;
			} else {
			  const fgretunrQty = await invtDB.query(
				"SELECT COALESCE(SUM(`qty_return`),0) as `qty_return` , COALESCE(SUM(`executed_qty`),0) as `executed_qty` FROM fg_return WHERE product_id = :sku_code AND fg_status = 'NG'",
				{
				  replacements: { sku_code: req.query.sku },
				  type: invtDB.QueryTypes.SELECT,
				},
			  );
  
			  const closingqty = hasDateRange
				? helper.number(Number(openingQty) + creditInRange - debitInRange)
				: creditBal - debitBal;
  
			  res.json({
				status: "success",
				success: true,
				response: {
				  data1: {
					sku: stmt1[0].p_sku,
					uom: stmt1[0].units_name,
					product: stmt1[0].p_name.toUpperCase(),
					closingqty: closingqty,
					pendingfgReturnQty:
					  (fgretunrQty[0].qty_return || 0) -
					  (fgretunrQty[0].executed_qty || 0),
					openingqty: openingQty,
					lastRate: lastRate,
				  },
				  data2: data,
				},
			  });
			  return;
			}
		  } else {
			res.json({
			  status: "error",
			  message:
				"couldn't fetch the transaction associated with this product at this location",
			  success: false,
			});
			return;
		  }
		} else {
		  res.json({
			status: "error",
			message:
			  "couldn't fetch the transaction bcz seems the product does not exist",
			success: false,
		  });
		  return;
		}
	  }
	} catch (error) {
	  return helper.errorResponse(res, error);
	}
  });
  
  // Download Breakdown Report
  router.get("/breakdown", async (req, res) => {
	
  });
module.exports = router;
