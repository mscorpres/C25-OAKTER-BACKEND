let { invtDB } = require("../../../config/db/connection");

const Validator = require("validatorjs");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

// router.post("/", [auth.isAuthorized], async (req, res) => {
//   try {
//     const validation = new Validator(req.body, {
//       component: "required",
//       for_location: "required|in:RM,SF,VENDOR",
//       date: "required",
//     });

//     if (validation.fails()) {
//       return res.json({ success: false, message: helper.firstErrorValidatorjs(validation) });
//     }

//     const { component, for_location } = req.body;

//     const given_date = moment(req.body.date, "DD-MM-YYYY").format("YYYY-MM-DD");
//     // Format date with end of day time for weighted average calculation to include all transactions up to that date
//     const given_date_with_time = moment(req.body.date, "DD-MM-YYYY").endOf('day').format("YYYY-MM-DD HH:mm:ss");

//     let location_key = "";

//     if (for_location == "RM") {
//       location_key = "2023112717950595";
//     }
//     if (for_location == "SF") {
//       location_key = "20231127171244714";
//     }
//     if (for_location == "VENDOR") {
//       location_key = "2023112717142196";
//     }

//     const stmt_comp_details = await invtDB.query("SELECT c_part_no , c_name , attribute_code, c_new_part_no, units_name FROM components LEFT JOIN units ON units.units_id = components.c_uom WHERE component_key = :component_key", {
//       replacements: { component_key: component },
//       type: invtDB.QueryTypes.SELECT,
//     });

//     let stmt_get_q4_location = await invtDB.query("SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key", {
//       replacements: { location_key: location_key },
//       type: invtDB.QueryTypes.SELECT,
//     });

//     const stmt_get_all_location = await invtDB.query("SELECT loc_name, location_key, loc_address, assigned_to FROM location_main WHERE location_key IN (:location_defined) AND loc_status = 'ACTIVE' ", {
//       replacements: { location_defined: stmt_get_q4_location[0].locations.split(",") },
//       type: invtDB.QueryTypes.SELECT,
//     });

//     if (stmt_get_all_location.length == 0) {
//       return res.json({ success: false, message: "There is no location!!!" });
//     }

//     let close_data = [];
//     let totalBalance = 0;
//     let total_opening = 0;
//     let query = "";
//     for (let i = 0; i < stmt_get_all_location.length; i++) {
//       query += `SELECT
//         COALESCE(SUM(CASE WHEN trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in = '${stmt_get_all_location[i].location_key}' AND DATE_FORMAT(insert_date, '%Y-%m-%d') < :date THEN qty ELSE 0 END ), 0) AS total_inward,
//         COALESCE(SUM(CASE WHEN trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out = '${stmt_get_all_location[i].location_key}' AND DATE_FORMAT(insert_date, '%Y-%m-%d') < :date THEN qty ELSE 0 END ), 0) AS total_outward,
//         (COALESCE(SUM(CASE WHEN trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in = '${stmt_get_all_location[i].location_key}' AND DATE_FORMAT(insert_date, '%Y-%m-%d') <= :date THEN qty ELSE 0 END ), 0) -
//         COALESCE(SUM(CASE WHEN trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out = '${stmt_get_all_location[i].location_key}' AND DATE_FORMAT(insert_date, '%Y-%m-%d') <= :date THEN qty ELSE 0 END ), 0)) AS closing,
//         '${stmt_get_all_location[i].loc_name}' AS loc_name
//     FROM rm_location
//     WHERE components_id = '${component}';
//     `;
//     }

//     const stmt_get_all_loc_stock = await invtDB.query(query, {
//       replacements: { date: given_date },
//       type: invtDB.QueryTypes.SELECT,
//     });

//     for (let i = 0; i < stmt_get_all_loc_stock.length; i++) {
//       close_data.push({
//         loc_name: stmt_get_all_loc_stock[i][0].loc_name,
//         loc_owner: stmt_get_all_location[i].assigned_to, loc_address: stmt_get_all_location[i].loc_address,
//         opening: helper.number(stmt_get_all_loc_stock[i][0].total_inward - stmt_get_all_loc_stock[i][0].total_outward),
//         closing: helper.number(stmt_get_all_loc_stock[i][0].closing),
//       });
//       (totalBalance += stmt_get_all_loc_stock[i][0].closing), (total_opening += stmt_get_all_loc_stock[i][0].total_inward - stmt_get_all_loc_stock[i][0].total_outward);
//     }

//     let stmt8 = await invtDB.query(
//       "SELECT rm_location.*, ims_rm_audit.*, admin_login.user_name FROM rm_location LEFT JOIN ims_rm_audit ON rm_location.components_id = ims_rm_audit.component_key LEFT JOIN admin_login ON admin_login.CustID = ims_rm_audit.audit_by WHERE rm_location.components_id = :component AND rm_location.trans_type = 'INWARD' AND ims_rm_audit.ID = ( SELECT MAX(ID) FROM ims_rm_audit WHERE component_key = :component ) ORDER BY rm_location.ID DESC LIMIT 1",
//       {
//         replacements: { component: component },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );

//     let last_audit_remark = stmt8.length > 0 ? stmt8[0].audit_remark : "N/A";
//     let last_audit_date = stmt8.length > 0 ? moment(stmt8[0].audit_dt, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss") : "N/A";
//     let last_audit_by = stmt8.length > 0 ? stmt8[0].user_name : "N/A";

//     return res.json({
//       success: true,
//       data: {
//         stock: close_data,
//         total_closing: helper.number(totalBalance),
//         total_opening: helper.number(total_opening),
//         component: {
//           part_code: stmt_comp_details[0].c_part_no + " (" + stmt_comp_details[0].c_new_part_no + ")",
//           name: stmt_comp_details[0].c_name,
//           unit: stmt_comp_details[0].units_name,
//           unique_id: stmt_comp_details[0].attribute_code,
//         },
//         last_audit_remark,
//         last_audit_date,
//         last_audit_by,
//         weightedPurchaseRate: await require("../../../helper/utils/avgRate").getWeightedPurchaseRate(component, given_date_with_time),
//       },
//     });
//   } catch (err) {
//     return res.json({ success: false, message: err.message });
//   }
// });

router.post("/", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      component: "required",
      for_location: "required|in:RM,SF,VENDOR",
      date: "required",
    });

    if (validation.fails()) {
      return res.json({ success: false, status: "error", message: helper.firstErrorValidatorjs(validation) });
    }

    const { component, for_location } = req.body;

    const given_date = moment(req.body.date, "DD-MM-YYYY").endOf('day').format("YYYY-MM-DD HH:mm:ss");

    let location_key = "";

    if (for_location == "RM") {
      location_key = "2023112717950595";
    }
    if (for_location == "SF") {
      location_key = "20231127171244714";
    }
    if (for_location == "VENDOR") {
      location_key = "2023112717142196";
    }

    const stmt_comp_details = await invtDB.query("SELECT c_part_no , c_name , attribute_code, c_new_part_no, units_name FROM components LEFT JOIN units ON units.units_id = components.c_uom WHERE component_key = :component_key", {
      replacements: { component_key: component },
      type: invtDB.QueryTypes.SELECT,
    });

    let stmt_get_q4_location = await invtDB.query("SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key", {
      replacements: { location_key: location_key },
      type: invtDB.QueryTypes.SELECT,
    });

    const stmt_get_all_location = await invtDB.query("SELECT loc_name, location_key, loc_address, assigned_to FROM location_main WHERE location_key IN (:location_defined) AND loc_status = 'ACTIVE' ", {
      replacements: { location_defined: stmt_get_q4_location[0].locations.split(",") },
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt_get_all_location.length == 0) {
      return res.json({ success: false, message: "There is no location!!!", status: "false" });
    }

    let close_data = [];
    let totalBalance = 0;
    let total_opening = 0;

    const stock_query = `SELECT
        COALESCE(SUM(CASE WHEN trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in = :location_key AND DATE_FORMAT(insert_date, '%Y-%m-%d') < :date THEN qty ELSE 0 END ), 0) AS total_inward,
        COALESCE(SUM(CASE WHEN trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out = :location_key AND DATE_FORMAT(insert_date, '%Y-%m-%d') < :date THEN qty ELSE 0 END ), 0) AS total_outward,
        (COALESCE(SUM(CASE WHEN trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in = :location_key AND DATE_FORMAT(insert_date, '%Y-%m-%d') <= :date THEN qty ELSE 0 END ), 0) -
        COALESCE(SUM(CASE WHEN trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out = :location_key AND DATE_FORMAT(insert_date, '%Y-%m-%d') <= :date THEN qty ELSE 0 END ), 0)) AS closing
    FROM rm_location
    WHERE components_id = :component`;

    const stmt_get_all_loc_stock = await Promise.all(
      stmt_get_all_location.map((loc) =>
        invtDB.query(stock_query, {
          replacements: { location_key: loc.location_key, date: given_date, component },
          type: invtDB.QueryTypes.SELECT,
        })
      )
    );

    // Ensure closing/opening stock: no decimals (floor), < 1 or negative → show 0
    const toStockDisplay = (val) => helper.number(Math.max(0, Math.floor(Number(val) || 0)));

    for (let i = 0; i < stmt_get_all_loc_stock.length; i++) {
      const rawOpening = stmt_get_all_loc_stock[i][0].total_inward - stmt_get_all_loc_stock[i][0].total_outward;
      const rawClosing = stmt_get_all_loc_stock[i][0].closing;
      close_data.push({
        loc_name: stmt_get_all_location[i].loc_name,
        loc_owner: stmt_get_all_location[i].assigned_to, loc_address: stmt_get_all_location[i].loc_address,
        opening: toStockDisplay(rawOpening),
        closing: toStockDisplay(rawClosing),
      });
      totalBalance += Math.max(0, Math.floor(Number(rawClosing) || 0));
      total_opening += Math.max(0, Math.floor(Number(rawOpening) || 0));
    }

    let stmt8 = await invtDB.query(
      "SELECT rm_location.*, ims_rm_audit.*, admin_login.user_name FROM rm_location LEFT JOIN ims_rm_audit ON rm_location.components_id = ims_rm_audit.component_key LEFT JOIN admin_login ON admin_login.CustID = ims_rm_audit.audit_by WHERE rm_location.components_id = :component AND rm_location.trans_type = 'INWARD' AND ims_rm_audit.ID = ( SELECT MAX(ID) FROM ims_rm_audit WHERE component_key = :component ) ORDER BY rm_location.ID DESC LIMIT 1",
      {
        replacements: { component: component },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let last_audit_remark = stmt8.length > 0 ? stmt8[0].audit_remark : "N/A";
    let last_audit_date = stmt8.length > 0 ? moment(stmt8[0].audit_dt, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss") : "N/A";
    let last_audit_by = stmt8.length > 0 ? stmt8[0].user_name : "N/A";

    return res.json({
      success: true,
      status: "success",
      data: {
        stock: close_data,
        total_closing: toStockDisplay(totalBalance),
        total_opening: toStockDisplay(total_opening),
        component: {
          part_code: stmt_comp_details[0].c_part_no + " (" + stmt_comp_details[0].c_new_part_no + ")",
          name: stmt_comp_details[0].c_name,
          unit: stmt_comp_details[0].units_name,
          unique_id: stmt_comp_details[0].attribute_code,
        },
        last_audit_remark,
        last_audit_date,
        last_audit_by,
        weightedPurchaseRate: await require("../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(
          component,
          given_date,
        ),
      },
    });
  } catch (err) {
    console.error( err);
    return res.json({ success: false, status: "error", message: err.message });
    // return helper.errorResponse(res, err);
  }
});

module.exports = router