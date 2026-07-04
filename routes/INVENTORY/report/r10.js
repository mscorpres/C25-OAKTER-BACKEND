const express = require("express");
const router = express.Router();

let { invtDB, otherDB } = require("../../../config/db/connection");

const Validator = require("validatorjs");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

checkNegativeValue = (value) => {
	return value < 0 ? 0 : value;
};

// CHECK CURRENT USER
router.get("/getUser", [auth.isAuthorized], async (req, res) => {
	try {
		let db_stmt = await invtDB.query("SELECT * FROM `admin_login` WHERE `CustID` = :user_id", { replacements: { user_id: req.logedINUser }, type: invtDB.QueryTypes.SELECT });
		let final = [];
		if (db_stmt.length > 0) {
			db_stmt.map((item) => {
				final.push({ id: item.CustID, text: item.user_name });

				if (db_stmt.length == final.length) {
					return res.json({ status: "success", success: true, message: "User fetched successfully", data: { final } });
				}
			});
		} else {
			return res.json({ status: "error", success: false, message: "seems an unauthorized user" });
		}
	} catch (err) {
	    return helper.errorResponse(res, err);
	}
});

// FETCH REPORT
router.post("/", [auth.isAuthorized], async (req, res) => {
	try {
		if (req.body.user_id == "") {
			return res.json({ status: "error", success: false, message: "seems an unauthorized user" });
		}
		let db_stmt = await otherDB.query("SELECT * FROM invt_r10 WHERE user_id = :user_id", { replacements: { user_id: req.body.user_id }, type: invtDB.QueryTypes.SELECT });
		if (db_stmt.length > 0) {
			let parts = db_stmt[0].parts;
			let locations = db_stmt[0].locations;
			let locationsArray = locations.split(",");
			let partsArray = parts.split(",");

			if (locationsArray.length == 0 || partsArray.length == 0) {
				return res.json({ status: "error", success: false, message: "no any part code or location selected" });
			}

			let comp_names = [];
			let comp_codes = [];
			let new_partnos = [];
			let loc_names = [];
			let assigned_to = [];

			for (let i = 0; i < locationsArray.length; i++) {
				let loc_stmt = await invtDB.query("SELECT loc_name,assigned_to FROM location_main WHERE  location_key = :location", {
					replacements: { location: locationsArray[i] },
					type: invtDB.QueryTypes.SELECT,
				});
				loc_names.push(loc_stmt[0].loc_name);
				assigned_to.push(loc_stmt[0].assigned_to);
			}

			let myArray = [];
			let count = 1;

			partsArray.forEach(async (part) => {
				let row = {};
				let comp_stmt = await invtDB.query("SELECT c_name, c_part_no , c_new_part_no FROM components WHERE  component_key = :partcode", {
					replacements: { partcode: part },
					type: invtDB.QueryTypes.SELECT,
				});

				let c_name = comp_stmt[0].c_name;
				let c_part = comp_stmt[0].c_part_no;
				comp_names.push(c_name);
				comp_codes.push(c_part);
				new_partnos.push(comp_stmt[0].c_new_part_no)
				locationsArray.forEach(async (location) => {
					let loc_stmt = await invtDB.query("SELECT loc_name FROM location_main WHERE location_key = :location", {
						replacements: { location: location },
						type: invtDB.QueryTypes.SELECT,
					});

					// ALL INWARD
					let stmt6 = await invtDB.query(
						"SELECT COALESCE( SUM( CASE WHEN trans_type IN('INWARD', 'TRANSFER', 'ISSUE', 'JOBWORK', 'REJECTION') AND loc_in = :location THEN qty ELSE 0 END ), 0 ) AS inward, COALESCE( SUM( CASE WHEN trans_type IN( 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER', 'CONSUMPTION' ) AND loc_out = :location THEN qty ELSE 0 END ), 0 ) AS outward FROM rm_location WHERE components_id = :component",
						{
							replacements: { component: part, location: location },
							type: invtDB.QueryTypes.SELECT,
						}
					);
					let inward_all_qty, outward_all_qty;
					if (stmt6.length > 0) {
						inward_all_qty = helper.number(stmt6[0].inward);
						outward_all_qty = helper.number(stmt6[0].outward);
					} else {
						inward_all_qty = 0, outward_all_qty = 0;
					}
					// let stmt6 = await invtDB.query(
					// 	"SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD' OR `trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION' OR `trans_type` = 'TRANSFER') AND `loc_in` = :location",
					// 	{
					// 		replacements: { component: part, location: location },
					// 		type: invtDB.QueryTypes.SELECT,
					// 	}
					// );
					// let inward_all_qty;
					// if (stmt6.length > 0) {
					// 	inward_all_qty = helper.number(stmt6[0].Inward);
					// } else {
					// 	inward_all_qty = 0;
					// }

					// ALL OUTWARD
					// let stmt7 = await invtDB.query(
					// 	"SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'CONSUMPTION' OR `trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION' OR `trans_type` = 'TRANSFER') AND `loc_out` = :location",
					// 	{
					// 		replacements: {
					// 			component: part,
					// 			location: location,
					// 		},
					// 		type: invtDB.QueryTypes.SELECT,
					// 	}
					// );

					// let outward_all_qty;
					// if (stmt7.length > 0) {
					// 	outward_all_qty = helper.number(stmt7[0].Outward);
					// } else {
					// 	outward_all_qty = 0;
					// }

					row[loc_stmt[0].loc_name] = checkNegativeValue(inward_all_qty - outward_all_qty);
					returnResult();
					count++;
				});

				myArray.push({ [c_name]: row });
				if (count != 1) {
					returnResult();
				}
			});

			function returnResult() {
				while (count == partsArray.length * locationsArray.length) {
					return res.json({ status: "success", success: true, message: "Report fetched successfully", data: { head: loc_names, name: assigned_to, data: myArray, parts: comp_names, parts_codes: comp_codes, new_partnos: new_partnos } });
				}
			}
		} else {
			return res.json({ status: "error", success: false, message: "No data found" });
		}
	} catch (err) {
	    return helper.errorResponse(res, err);
	}
});

// Update the location report
router.post("/update", [auth.isAuthorized], async (req, res) => {
	let validation = new Validator(req.body, {
		component_part: "required",
		location: "required",
	});

	if (validation.fails()) {
		return res.json({ status: "error", success: false, message: "something you missing in form field to supply", errors: validation.errors.all() });
	}

	let locations = req.body.location.join(",");
	let parts = req.body.component_part.join(",");

	try {
		let stmt2;
		let stmt1 = await otherDB.query("SELECT * FROM `invt_r10` WHERE `user_id` = :userid", { replacements: { userid: req.logedINUser }, type: otherDB.QueryTypes.SELECT });
		if (stmt1.length > 0) {
			stmt2 = await otherDB.query("UPDATE `invt_r10` SET `parts` = :parts, `locations` = :locs WHERE `user_id` = :userid", {
				replacements: {
					parts: parts,
					locs: locations,
					userid: req.logedINUser,
				},
				type: otherDB.QueryTypes.UPDATE,
			});
		} else {
			stmt2 = await otherDB.query("INSERT INTO `invt_r10` (`parts`, `locations`, `user_id`) VALUES(:parts, :locs, :userid)", {
				replacements: {
					parts: parts,
					locs: locations,
					userid: req.logedINUser,
				},
				type: otherDB.QueryTypes.INSERT,
			});
		}

		if (stmt2.length > 0) {
			return res.json({ status: "success", success: true, message: "Report updated" });
		} else {
			return res.json({ status: "error", success: false, message: "an error occured while updating the report" });
		}
	} catch (err) {
	    return helper.errorResponse(res, err);
	}
});

// GET SELECTED VALUES
router.post("/getSelectedValue", [auth.isAuthorized], async (req, res) => {
	try {
		if (req.body.user_id == "") {
			return res.json({ status: "error", success: false, message: "seems an unauthorized user" });
		}

		let stmt = await otherDB.query("SELECT * FROM `invt_r10` WHERE `user_id` = :user_id", { replacements: { user_id: req.body.user_id }, type: otherDB.QueryTypes.SELECT });
		if (stmt.length > 0) {
			let parts = stmt[0].parts;
			let locations = stmt[0].locations;
			let locationsArray = locations.split(",");
			let partsArray = parts.split(",");

			let part_options = [];
			let loc_options = [];

			let count = 0;

			partsArray.forEach(async (part) => {
				let comp_stmt = await invtDB.query("SELECT `c_name`, `c_part_no` FROM `components` WHERE `component_key` = :partcode", {
					replacements: { partcode: part },
					type: invtDB.QueryTypes.SELECT,
				});

				if (comp_stmt.length > 0) {
					part_options.push({
						id: part,
						text: comp_stmt[0].c_name + " ( " + comp_stmt[0].c_part_no + " )",
					});
				}
				count++;
				sendResult();
			});

			locationsArray.forEach(async (location) => {
				let loc_stmt = await invtDB.query("SELECT `loc_name` FROM `location_main` WHERE  `location_key` = :location", {
					replacements: { location: location },
					type: invtDB.QueryTypes.SELECT,
				});

				if (loc_stmt.length > 0) {
					loc_options.push({
						id: location,
						text: loc_stmt[0].loc_name,
					});
				}
				count++;
				sendResult();
			});

			function sendResult() {
				if (count == partsArray.length + locationsArray.length) {
					return res.json({ status: "success", success: true, message: "Selected values fetched", data: { part_options: part_options, loc_options: loc_options } });
				} else {
					//console.log("ERROR ", count, " == ", partsArray.length * locationsArray.length);
				}
			}
		} else {
			return res.json({ status: "error", success: false, message: "No data found" });
		}
	} catch (err) {
	    return helper.errorResponse(res, err);
	}
});

module.exports = router;
