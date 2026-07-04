let { invtDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

checkNegativeValue = (value) => {
	return value < 0 ? 0 : value.toFixed(2);
};

function byDate(a, b) {
	let d1 = new Date(moment(a.date, "DD-MM-YYYY HH:mm:ss"));
	let d2 = new Date(moment(b.date, "DD-MM-YYYY HH:mm:ss"));
	return d2 - d1;
}

router.post("/fetchSKU_costing", [auth.isAuthorized], async (req, res) => {
	try {
		let stmt1 = await invtDB.query(
			"SELECT DISTINCT(`bom_quantity`.`subject_under`), `bom_quantity`.`product_sku`, `bom_quantity`.`bom_status`, `products`.`show_in_product_costing` FROM `bom_quantity` LEFT JOIN `products` ON `bom_quantity`.`product_sku` = `products`.`p_sku` WHERE `bom_quantity`.`bom_status` = 'A' AND `products`.`show_in_product_costing` = 'Y' ORDER BY `bom_quantity`.`product_sku` ASC",
			{
				type: invtDB.QueryTypes.SELECT,
			}
		);
		if (stmt1.length > 0) {
			let data = [];
			// for (let i = 0; i < stmt1.length; i++) { }
			stmt1.map(async (item) => {
				let stmt2 = await invtDB.query(
					"SELECT `bom_quantity`.`component_id`, `bom_quantity`.`product_sku`, `bom_quantity`.`qty`, `bom_quantity`.`bom_catergory`, `bom_quantity`.`bom_status`, `products`.`p_sku`, `products`.`m_sku`, `products`.`p_name`, `products`.`jobwok_cost`, `products`.`labour_cost`, `products`.`packing_cost`, `products`.`other_cost`, `components`.`c_type` FROM `bom_quantity` LEFT JOIN `products` ON (`bom_quantity`.`product_sku` = `products`.`p_sku` OR `bom_quantity`.`product_sku` = `products`.`m_sku`) LEFT JOIN `components` ON `bom_quantity`.`component_id` = `components`.`component_key` WHERE `bom_quantity`.`bom_status` = 'A' AND `bom_quantity`.`subject_under` = :subject AND `components`.`c_type` = 'R'",
					{
						replacements: { subject: item.subject_under },
						type: invtDB.QueryTypes.SELECT,
					}
				);
				if (stmt2.length > 0) {
					let bom_mfg_cost = 0,
						primary_mfg_cost = 0,
						other_mfg_cost = 0;

					let product_name,
						product_code,
						jobwok_cost = 0,
						labour_cost = 0,
						packing_cost = 0,
						other_cost = 0;
					for (let i = 0; i < stmt2.length; i++) {
						product_name = stmt2[i].p_name;
						product_code = stmt2[i].p_sku;
						let bom_qty = helper.number(stmt2[i].qty);
						let bom_catergory = stmt2[i].bom_catergory;

						jobwok_cost = helper.number(stmt2[i].jobwok_cost);
						labour_cost = helper.number(stmt2[i].labour_cost);
						packing_cost = helper.number(stmt2[i].packing_cost);
						other_cost = helper.number(stmt2[i].other_cost);

						let stmt3 = await invtDB.query(
							"SELECT `ID`, `in_po_rate` AS `last_cost_rate`, `components_id` FROM `rm_location` WHERE `components_id` = :component AND `trans_type` = 'INWARD' AND (`vendor_type` = 'v01' OR `vendor_type` = 'j01') ORDER BY `ID` DESC LIMIT 1",
							{
								replacements: { component: stmt2[i].component_id },
								type: invtDB.QueryTypes.SELECT,
							}
						);
						if (stmt3.length > 0) {
							for (let k = 0; k < stmt3.length; k++) {
								if (bom_catergory == "P") {
									bom_mfg_cost += helper.number(stmt3[k].last_cost_rate) * bom_qty;
								}

								if (bom_catergory == "PCK") {
									primary_mfg_cost += helper.number(stmt3[k].last_cost_rate) * bom_qty;
								}

								if (bom_catergory == "O") {
									other_mfg_cost += helper.number(stmt3[k].last_cost_rate) * bom_qty;
								}
							}
						}
					}

					data.push({
						product_sku: product_code,
						product_name: product_name,
						bom_mfg_cost: helper.number(bom_mfg_cost),
						pri_mfg_cost: helper.number(primary_mfg_cost),
						other_mfg_cost: helper.number(other_mfg_cost),
						jobwork_cost: helper.number(jobwok_cost),
						labour_cost: labour_cost,
						packing_cost: packing_cost,
						other_cost: other_cost,
						total_cost: Math.round(helper.number(bom_mfg_cost) + helper.number(primary_mfg_cost) + helper.number(other_mfg_cost) + labour_cost + packing_cost + other_cost),
					});
				}

				if (stmt1.length == data.length) {
					return res.json({ status: "success", success: true, code: "200", response: { data } });
				}
			});
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

module.exports = router;
