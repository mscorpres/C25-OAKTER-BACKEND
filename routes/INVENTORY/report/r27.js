let { invtDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();
const Validator = require("validatorjs");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

//Required Passing Parameters:

//1.  date

checkNegativeValue = (value) => {
	return value < 0 ? -1 * value : value;
};

router.post("/", [auth.isAuthorized], async (req, res) => {
	try {

		const valid = new Validator(req.body, {
			date: "required",
		});

		if (valid.fails()) {
			return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
		}

		const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
		const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
		const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
		const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "months");
		if (durationInMonths > 3) {
			return res.json({
				status: "error", success: false,
				success: false,
				message: "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
			});
		}
		let stmt1 = await invtDB.query("SELECT * FROM `products` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` WHERE products_type = 'semi' ORDER BY `products`.`p_name` ASC", { type: invtDB.QueryTypes.SELECT });

		const data = [];
		stmt1.map(async (item) => {
			let stmt2 = await invtDB.query("SELECT COALESCE(SUM(CASE WHEN `type` IN ('IN') AND `mfg_pro_apr_sku` = :sku AND DATE_FORMAT(`mfg_pro_apr_fulldate`,'%Y-%m-%d') BETWEEN :date1 AND :date2 THEN `mfg_approve_in_qty` ELSE 0 END),0) totalIN, COALESCE(SUM(CASE WHEN `type` IN ('OUT') AND `fgout_pro_apr_sku` = :product AND DATE_FORMAT(`fgout_pro_apr_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 THEN `fgout_approve_out_qty` ELSE 0 END),0) totalOut, COALESCE(SUM(CASE WHEN `type` IN ('IN') AND `mfg_pro_apr_sku` = :sku AND DATE_FORMAT(`mfg_pro_apr_fulldate`,'%Y-%m-%d') < :date1 THEN `mfg_approve_in_qty` ELSE 0 END),0) totalOP_in, COALESCE(SUM(CASE WHEN `type` IN ('OUT') AND `fgout_pro_apr_sku` = :product AND DATE_FORMAT(`fgout_pro_apr_date`,'%Y-%m-%d') < :date1 THEN `fgout_approve_out_qty` ELSE 0 END),0) totalOP_out FROM `mfg_production_3`", {
				replacements: {
					sku: item.p_sku,
					product: item.product_key,
					date1: fromdate,
					date2: todate
				},
				type: invtDB.QueryTypes.SELECT
			})

			let totalOut, totalIn, openBal;
			if (stmt2.length > 0) {
				totalIn = stmt2[0].totalIN;
				totalOut = stmt2[0].totalOut;
				openBal = helper.number(stmt2[0].totalOP_in - stmt2[0].totalOP_out);
			} else {
				totalIn = "0", totalOut = "0", openBal = "0";
			}


			//CLOSING BALANCE
			let closeBal = helper.number(openBal + (totalIn - totalOut));

			//OUT BALANCE
			// let stmt2 = await invtDB.query(
			// 	"SELECT COALESCE(SUM(`DebitQTY`),0) as `DebitBalance` FROM (SELECT `fgout_approve_out_qty` DebitQTY FROM `mfg_production_3` WHERE `fgout_pro_apr_sku` = :product AND DATE_FORMAT(`fgout_pro_apr_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND type = 'OUT') t",
			// 	{
			// 		replacements: {
			// 			product: item.product_key,
			// 			date1: fromdate,
			// 			date2: todate
			// 		},
			// 		type: invtDB.QueryTypes.SELECT,
			// 	}
			// );

			// let debitBal;
			// if (stmt2.length > 0) {
			// 	debitBal = helper.number(stmt2[0].DebitBalance);
			// } else {
			// 	debitBal = "00";
			// }

			//IN BALANCE
			// let stmt3 = await invtDB.query(
			// 	"SELECT COALESCE(SUM(`mfg_approve_in_qty`),0) AS `totalQTYinTODAY` FROM `mfg_production_3` WHERE `mfg_pro_apr_sku` = :sku AND `type` = 'IN' AND DATE_FORMAT(`mfg_pro_apr_fulldate`,'%Y-%m-%d') BETWEEN :date1 AND :date2",
			// 	{
			// 		replacements: {
			// 			sku: item.p_sku,
			// 			date1: fromdate,
			// 			date2: todate
			// 		},
			// 		type: invtDB.QueryTypes.SELECT,
			// 	}
			// );
			// let creditBal;
			// if (stmt3.length > 0) {
			// 	creditBal = helper.number(stmt3[0].totalQTYinTODAY);
			// } else {
			// 	creditBal = "00";
			// }

			//OP BALANCE
			// let stmt4 = await invtDB.query(
			// 	"SELECT COALESCE(SUM(QTY), 0) AS `OpeningBalance` FROM ( SELECT `mfg_approve_in_qty` QTY FROM `mfg_production_3` CR WHERE CR.mfg_pro_apr_sku = :sku AND DATE_FORMAT(CR.mfg_pro_apr_fulldate,'%Y-%m-%d') < :date1 UNION ALL SELECT - fgout_approve_out_qty QTY FROM `mfg_production_3` DR WHERE DR.fgout_pro_apr_sku = :product_key AND DATE_FORMAT(DR.fgout_pro_apr_date,'%Y-%m-%d') < :date1) t",
			// 	{
			// 		replacements: {
			// 			sku: item.p_sku,
			// 			date1: fromdate,
			// 			product_key: item.product_key
			// 		},
			// 		type: invtDB.QueryTypes.SELECT,
			// 	}
			// );

			// let openBal;
			// if (stmt4.length > 0) {
			// 	openBal = helper.number(stmt4[0].OpeningBalance);
			// } else {
			// 	openBal = "00";
			// }


			//REPLENISHMENT QTY
			let replenishment;
			if (closeBal < item.p_min_stock) {
				replenishment = checkNegativeValue(item.p_min_stock - closeBal);
			} else {
				replenishment = "00";
			}


			//EXISTING QTY FROM PRODUCTION_1 [COUNT +]
			// let stmt5 = await invtDB.query("SELECT `prod_product_sku`, COALESCE(SUM(`prod_planned_qty`),0) AS totalPlannedQTY FROM `mfg_production_1` WHERE `prod_product_sku` = :sku", {
			// 	replacements: { sku: item.p_sku },
			// 	type: invtDB.QueryTypes.SELECT,
			// });

			// let existingOrder;
			// if (stmt5.length > 0) {
			// 	existingOrder = helper.number(stmt5[0].totalPlannedQTY);
			// } else {
			// 	existingOrder = "00";
			// }

			//EXISTING QTY FROM PRODUCTION_2 [COUNT -]
			//   let stmt6 = await invtDB.query("SELECT `mfg_sku`,`mfg_prod_planing_qty`,`mfg_send_location`, COALESCE(SUM(`mfg_prod_planing_qty`),0) AS toatlAlreadyAccepted FROM `mfg_production_2` WHERE `mfg_sku` = :sku AND `mfg_prod_type`= 'C'", {
			//     replacements: { sku: item.p_sku },
			//     type: invtDB.QueryTypes.SELECT,
			//   });

			// let existingExecutedOrder;
			// if (stmt6.length > 0) {
			// 	existingExecutedOrder = helper.number(stmt6[0].toatlAlreadyAccepted);
			// } else {
			// 	existingExecutedOrder = "00";
			// }
			// let eqp = existingOrder - existingExecutedOrder;

			let totalRequestQTY = 0;
			let totalAccept4Consumption = 0;

			let stmt_ppr_qty = await invtDB.query("SELECT COALESCE(SUM(`prod_planned_qty`), 0) AS `totalReqPPRQTY` , COALESCE(SUM(`prod_executed_qty`), 0) AS `prod_executed_qty` FROM `mfg_production_1` WHERE `mfg_production_1`.`phase1_status` = 'A' AND  `mfg_production_1`.`prod_branch` = :branch AND `prod_product_sku` = :sku  GROUP BY `prod_product_sku`", {
				replacements: { sku: item.p_sku, branch: req.branch },
				type: invtDB.QueryTypes.SELECT,
			});
			if (stmt_ppr_qty.length > 0) {
				totalRequestQTY = stmt_ppr_qty[0].totalReqPPRQTY;
				totalAccept4Consumption = stmt_ppr_qty[0].prod_executed_qty;
			}
			let eqp = totalRequestQTY - totalAccept4Consumption;

			let fg_type;
			if (item.products_type == "default") {
				fg_type = "FG";
			} else if (item.products_type == "semi") {
				fg_type = "SEMI FG";
			} else {
				fg_type = "N/A";
			}

			data.push({
				totalOB: "--",
				totalClosing: "--",
				totalIn: "--",
				totalOut: "--",
				sku: item.p_sku,
				product: item.p_name,
				openBal: openBal,
				debitBal: totalOut,
				creditBal: totalIn,
				closingBal: closeBal,
				unit: item.units_name,
				replenishment: replenishment,
				minqty: item.p_min_stock,
				batchqty: item.p_batch_qty,
				eqp: eqp,
				fgtype: fg_type,
			});

			if (data.length === stmt1.length) {
				return res.json({
					status: "success", success: true,
					success: true,
					message: "Report fetched successfully",
					data: data,
				});
			}
		});
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

module.exports = router;
