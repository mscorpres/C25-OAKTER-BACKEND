let { invtDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

//Required Passing Parameters:

//1.  skucode
//2.  subject
//3.  date

checkNegativeValue = (value) => {
	return value < 0 ? 0 : value;
};

convertNegativetoPositive = (value) => {
	return value < 0 ? -1 * value : value;
};
router.post("/", [auth.isAuthorized], async (req, res) => {
	try {
		if (req.body.date == "") {
			return res.json({
				status: "error", success: false,
				success: false,
				message: "Please supply date",
			});
		} else if (req.body.product == "") {
			return res.json({
				status: "error", success: false,
				success: false,
				message: "Please supply product name",
			});
		} else if (req.body.subject == "") {
			return res.json({
				status: "error", success: false,
				success: false,
				message: "Please supply produt BOM [bill of materials]",
			});
		}
		let stmt1 = await invtDB.query("SELECT COALESCE(SUM(`prod_planned_qty`),0) `totalPPRQTY`, (SELECT COALESCE(SUM(`mfg_prod_planing_qty`),0) FROM `mfg_production_2` WHERE `mfg_prod_type` = 'C' AND `mfg_sku` = :sku) totalConsumpQTY FROM `mfg_production_1` WHERE `prod_product_sku` = :sku", {
			replacements: {
				sku: req.body.skucode
			},
			type: invtDB.QueryTypes.SELECT,
		});
		let totalPPRQTYnotMade, totalPPRQTYMade;
		if (stmt1.length > 0) {
			totalPPRQTYnotMade = stmt1[0].totalPPRQTY;
			totalPPRQTYMade = stmt1[0].totalConsumpQTY;
		}
		//TOTAL PPR QTY

		// let stmt1 = await invtDB.query("SELECT COALESCE(SUM(`prod_planned_qty`),0) AS `totalPPRQTY` FROM `mfg_production_1` WHERE `prod_product_sku` = :sku", {
		// 	replacements: {
		// 		sku: req.body.skucode
		// 	},
		// 	type: invtDB.QueryTypes.SELECT,
		// });

		// let totalPPRQTYnotMade;
		// if (stmt1.length > 0) {
		// 	totalPPRQTYnotMade = stmt1[0].totalPPRQTY;
		// }

		//TOTAL PPR QTY MADE
		// let stmt2 = await invtDB.query("SELECT COALESCE(SUM(`mfg_prod_planing_qty`),0) AS `totalConsumpQTY` FROM `mfg_production_2` WHERE mfg_sku = :sku AND `mfg_prod_type` = 'C'", {
		// 	replacements: {
		// 		sku: req.body.skucode
		// 	},
		// 	type: invtDB.QueryTypes.SELECT,
		// });
		// let totalPPRQTYMade;
		// if (stmt2.length > 0) {
		// 	totalPPRQTYMade = stmt2[0].totalConsumpQTY;
		// }

		let stmt3 = await invtDB.query(
			"SELECT * FROM bom_quantity LEFT JOIN components ON bom_quantity.component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id LEFT JOIN products ON bom_quantity.product_sku = products.p_sku WHERE `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND bom_quantity.subject_under = :subject AND `bom_quantity`.`bom_status` = :status GROUP BY `bom_quantity`.`component_id` ORDER BY `components`.`c_part_no` ASC",
			{
				replacements: {
					subject: req.body.subject,
					status: "A", //Active
				},
				type: invtDB.QueryTypes.SELECT,
			}
		);
		const data = [];
		stmt3.map(async (item) => {
			let stmt4 = await invtDB.query("SELECT COALESCE(SUM( CASE WHEN trans_type IN ( 'INWARD' ) THEN qty ELSE 0 END ), 0) AS inward, COALESCE(SUM( CASE WHEN trans_type IN ( 'ISSUE','JOBWORK', 'REJECTION' ) THEN qty ELSE 0 END ), 0) AS outward, (SELECT COALESCE(SUM( CASE WHEN trans_type IN ( 'INWARD' ) THEN qty ELSE 0 END ), 0) FROM rm_location WHERE DATE_FORMAT(insert_date, '%Y-%m-%d') < :date AND components_id = :component ) inbefore, (SELECT COALESCE(SUM( CASE WHEN trans_type IN ('ISSUE', 'JOBWORK', 'REJECTION' ) THEN qty ELSE 0 END ), 0) FROM rm_location WHERE DATE_FORMAT(insert_date, '%Y-%m-%d') < :date AND components_id = :component ) outbefore FROM rm_location WHERE DATE_FORMAT(insert_date, '%Y-%m-%d') = :date AND components_id = :component",
				{
					replacements: {
						component: item.component_key,
						date: moment(req.body.date, "DD-MM-YYYY").format("YYYY-MM-DD")
					},
					type: invtDB.QueryTypes.SELECT,
				}
			);
			let inward_all_qty, outward_all_qty, opening_qty;
			if (stmt4.length > 0) {
				inward_all_qty = stmt4[0].inward;
				outward_all_qty = stmt4[0].outward;
				opening_qty = (stmt4[0].inbefore - stmt4[0].outbefore);
			} else {
				inward_all_qty = "00", outward_all_qty = "00", opening_qty = "00";
			}


			//CLOSING BALANCE
			let closingBal = helper.number(opening_qty + (inward_all_qty - outward_all_qty));

			// ALL INWARD
			// let stmt4 = await invtDB.query(
			// 	"SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') = :date AND (`trans_type` = 'INWARD') AND (`trans_type` != 'CANCELLED')",
			// 	{
			// 		replacements: {
			// 			component: item.component_key,
			// 			date: moment(req.body.date, "DD-MM-YYYY").format("YYYY-MM-DD")
			// 		},
			// 		type: invtDB.QueryTypes.SELECT,
			// 	}
			// );

			// let inward_all_qty;
			// if (stmt4.length > 0) {
			// 	inward_all_qty = parseInt(stmt4[0].Inward);
			// } else {
			// 	inward_all_qty = "00";
			// }

			// ALL OUTWARD
			// let stmt5 = await invtDB.query(
			// 	"SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') = :date AND (`trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION') AND (`trans_type` != 'CANCELLED')",
			// 	{
			// 		replacements: {
			// 			component: item.component_key,
			// 			date: moment(req.body.date, "DD-MM-YYYY").format("YYYY-MM-DD")
			// 		},
			// 		type: invtDB.QueryTypes.SELECT,
			// 	}
			// );

			// let outward_all_qty;
			// if (stmt5.length > 0) {
			// 	outward_all_qty = parseInt(stmt5[0].Outward);
			// } else {
			// 	outward_all_qty = "00";
			// }

			// OPENING BALANCE
			// let stmt6 = await invtDB.query(
			// 	"SELECT COALESCE(SUM(QTY), 0) AS `OpeningBalance` FROM ( SELECT `qty` QTY FROM `rm_location` CR WHERE CR.components_id = :component AND DATE_FORMAT(CR.insert_date, '%Y-%m-%d') < :date AND (CR.`trans_type` = 'INWARD') AND (CR.`trans_type` != 'CANCELLED') UNION ALL SELECT - COALESCE(SUM(`qty` + `other_qty`), 0) QTY FROM `rm_location` DR WHERE DR.components_id = :component AND DATE_FORMAT(DR.insert_date, '%Y-%m-%d') < :date AND (DR.`trans_type` = 'ISSUE' OR DR.`trans_type` = 'REJECTION' OR DR.`trans_type` = 'JOBWORK') AND (DR.`trans_type` != 'CANCELLED')) t",
			// 	{
			// 		replacements: {
			// 			component: item.component_key,
			// 			date: moment(req.body.date, "DD-MM-YYYY").format("YYYY-MM-DD")
			// 		},
			// 		type: invtDB.QueryTypes.SELECT,
			// 	}
			// );

			// let opening_qty;
			// if (stmt6.length > 0) {
			// 	opening_qty = parseInt(stmt6[0].OpeningBalance);
			// } else {
			// 	opening_qty = "00";
			// }


			//REPLENISHMENT
			let replenish;
			let replenishment_PPR_A = convertNegativetoPositive(totalPPRQTYMade - totalPPRQTYnotMade) * item.qty;
			replenishment_PPR_B = replenishment_PPR_A - closingBal;
			if (replenishment_PPR_B > 0) {
				replenish = replenishment_PPR_B;
			} else {
				replenish = "NO NEED";
			}

			let bom_status;
			if (item.bom_status == "A") {
				bom_status = '<span style="color: #2db71c; font-weight: 600;">ACTIVE</span>';
			} else if (item.bom_status == "ALT") {
				bom_status = '<span style="color: #ff9800; font-weight: 600;">ALTERNATIVE</span>';
			} else {
				bom_status = '<span style="color: #e53935; font-weight: 600;">INACTIVE</span>';
			}

			let stmt7 = await invtDB.query("SELECT COUNT(`ID`) AS `COUNT` FROM `bom_quantity` WHERE `subject_under` = :subject", {
				replacements: { subject: req.body.subject },
				type: invtDB.QueryTypes.SELECT,
			});
			let count_bom = stmt7[0].COUNT;

			data.push({
				totalOB: "--",
				totalClosingh: "--",
				totalIn: "--",
				totalOut: "--",
				part_name: item.c_name,
				closingBal: checkNegativeValue(closingBal),
				unit_name: item.units_name,
				bomqty: item.qty,
				part_no: item.c_part_no,
				new_partno: item.c_new_part_no,
				bomstatus: bom_status,
				replenish: replenish,
				epq: replenishment_PPR_A,
				rptBOM: count_bom,
			});

			if (data.length === stmt3.length) {
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
