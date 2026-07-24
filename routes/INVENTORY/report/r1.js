let { invtDB } = require("../../../config/db/connection");

const { encode, decode } = require("html-entities");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


//Required Passing Parameters:

//1.  product
//2.  subject
//3.  date

checkNegativeValue = (value) => {
  return value < 0 ? 0 : value;
};

function byPart(a, b) {
  return a.partno.localeCompare(b.partno, "en", { numeric: true });
}

// router.post("/", [auth.isAuthorized], async (req, res) => {
//   try {
//     const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
//     const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
//     const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

//     const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
//       moment(date[0], "DD-MM-YYYY"),
//       "months"
//     );
//     if (durationInMonths > 3) {
//       return res.json({
//         status: "error", success: false,
//         success: false,
//         message: "On the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only.",
//       });
//     }

//     if (req.body.date == "") {
//       return res.json({
//         status: "error", success: false,
//         success: false,
//         message: "Please supply date.",
//       });
//     }
//     if (req.body.product == "") {
//       return res.json({
//         status: "error", success: false,
//         success: false,
//         message: "Please supply product.",
//       });
//     }
//     if (req.body.subject == "0") {
//       return res.json({
//         status: "error", success: false,
//         success: false,
//         message: "Please supply product BOM [Bill Of Material].",
//       });
//     }

//     let location_key = "";
//     // A21 R1 store LOCATION
//     if (req.branch == "BRALWR36") {
//       location_key = "202381510340465";
//     }
//     // B29 R1 store LOCATION
//     if (req.branch == "BRMSC029") {
//       location_key = "2023815103533746";
//     }

//     // BRANCH R1 store STOCK LOCATION
//     let stmt_get_a21 = await invtDB.query(
//       "SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key",
//       {
//         replacements: { location_key: location_key },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );

//     let all_branch__location = [];
//     if (stmt_get_a21.length > 0) {
//       for (let loc_i = 0; loc_i < stmt_get_a21.length; loc_i++) {
//         all_branch__location = stmt_get_a21[loc_i].locations.split(",");
//       }
//     } else {
//       return res.json({
//         status: "error", success: false,
//         success: false,
//         message: "Branch Location Not Found, contact administrator.",
//       });
//     }
//     // END

//     let stmt1 = await invtDB.query(
//       "SELECT * FROM bom_quantity LEFT JOIN components ON bom_quantity.component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id LEFT JOIN products ON (bom_quantity.product_sku = products.p_sku OR bom_quantity.product_sku = products.m_sku) WHERE bom_quantity.subject_under = :subject AND `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' GROUP BY `bom_quantity`.`component_id` ORDER BY `components`.`c_part_no` ASC",
//       {
//         replacements: { subject: req.body.subject },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );
//     const data = [];
//     stmt1.map(async (item) => {
//       let stmt3 = await invtDB.query(
//         "SELECT (SELECT COALESCE(SUM(qty+other_qty), 0) AS inward FROM rm_location WHERE components_id = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) AS inward, (SELECT COALESCE(SUM(qty+other_qty), 0) AS outward FROM rm_location WHERE components_id = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) outward ,(SELECT COALESCE(SUM(qty+other_qty), 0) AS inbefor FROM rm_location WHERE components_id = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') < :date1 ) AS inbefor ,  (SELECT COALESCE(SUM(qty+other_qty), 0) AS outward FROM rm_location WHERE components_id = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') < :date1) AS outbefore FROM DUAL",
//         {
//           replacements: {
//             component: item.component_key,
//             date1: fromdate,
//             date2: todate,
//             location: all_branch__location,
//           },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );

//       let inward_all_qty, outward_all_qty, opening_qty;
//       if (stmt3.length > 0) {
//         inward_all_qty = stmt3[0].inward;
//         outward_all_qty = stmt3[0].outward;
//         opening_qty = stmt3[0].inbefor - stmt3[0].outbefore;
//       } else {
//         (inward_all_qty = 0), (outward_all_qty = 0), (opening_qty = 0);
//       }

//       //CLOSING QUANTITY
//       let closing_qty = checkNegativeValue(
//         opening_qty + inward_all_qty - outward_all_qty
//       );

//       //REPLENISHMENT QUANTITY
//       let replenish_qty;
//       if (closing_qty < item.c_min_stock) {
//         replenish_qty = item.c_min_stock - closing_qty;
//       } else {
//         replenish_qty = "0";
//       }

//       //IN-TRANSIT
//       let stmt5 = await invtDB.query(
//         "SELECT COALESCE(SUM(`po_order_qty`), 0) AS `totalPO_order`, po_transaction FROM `po_purchase_req` WHERE `po_part_no` = :component GROUP BY `po_transaction`",
//         {
//           replacements: { component: item.component_key },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );
//       if (stmt5.length > 0) {
//         po_order_qty = stmt5[0].totalPO_order;
//         po_transaction = stmt5[0].po_transaction;
//       } else {
//         po_order_qty = 0;
//         po_transaction = "--";
//       }

//       //LAST COMPONENT PURCHASE RATE
//       let last_costing = 0,
//         currency_name = "--";
//       let stmt6 = await invtDB.query(
//         "SELECT rl.`ID`, COALESCE(SUM(rl.`in_po_rate`), 0) AS `last_cost_rate`, rl.`components_id`, rl.`exchange_rate`, ic.`currency_notes` FROM `rm_location` rl LEFT JOIN `ims_currency` ic ON ic.`currency_id` = rl.`currency_type` WHERE rl.`components_id` = :component AND rl.`trans_type` = 'INWARD' AND rl.`ID` = ( SELECT MAX(`ID`) FROM `rm_location` WHERE `components_id` = :component AND `trans_type` = 'INWARD' AND `vendor_type` = 'v01' )",
//         {
//           replacements: { component: item.component_key },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );
//       if (stmt6.length > 0) {
//         last_costing = stmt6[0].last_cost_rate;
//         currency_name = stmt6[0].currency_notes;
//       } else {
//         last_costing = 0;
//         currency_name = "--";
//       }

//       //TOTAL ROWS
//       let stmt7 = await invtDB.query(
//         "SELECT COUNT(`ID`) AS `COUNT` FROM `bom_quantity` WHERE `subject_under` = :subject",
//         {
//           replacements: { subject: req.body.subject },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );

//       //FETCH ALTERNATIVE PART CODES
//       let alt_component_part = [];
//       let alt_component_name = [];
//       let stmt8 = await invtDB.query(
//         "SELECT * FROM `alternative_components` WHERE `alt_mother_component` = :component AND `alt_subject` = :subject AND `alt_product_sku` = :product AND `alt_type` = 'default'",
//         {
//           replacements: {
//             component: item.component_key,
//             subject: req.body.subject,
//             product: item.p_sku,
//           },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );
//       if (stmt8.length > 0) {
//         if (item.bom_status == "ALT") {
//           let stmt9 = await invtDB.query(
//             "SELECT * FROM `components` WHERE `component_key` = :component",
//             {
//               replacements: { component: stmt8[0].alt_daughter_component },
//               type: invtDB.QueryTypes.SELECT,
//             }
//           );
//           if (stmt9.length > 0) {
//             alt_component_part.push(stmt9[0].c_part_no);
//             alt_component_name.push(decode(stmt9[0].c_name));
//           } else {
//             alt_component_part.push("--");
//             alt_component_name.push("--");
//           }
//         } else {
//           alt_component_part = ["N/A"];
//           alt_component_name = ["N/A"];
//         }
//       } else {
//         alt_component_part = ["N/A"];
//         alt_component_name = ["N/A"];
//       }

//       // console.log(
//       //   "ALTERNATIVE PARTS: ",
//       //   alt_component_part,
//       //   alt_component_name
//       // );

//       if (alt_component_name.length == 0) {
//         alt_component_part = "--";
//         alt_component_name = "--";
//       }

//       let transitQTY;
//       let stmt10 = await invtDB.query(
//         "SELECT po_part_no, SUM(po_order_qty - po_inward_qty) AS transit_qty FROM po_purchase_req WHERE po_part_no = :component AND NOT (po_status = 'C' AND po_inward_qty = 0) AND (po_status = 'A' AND po_order_qty != po_inward_qty OR po_status = 'C') GROUP BY po_part_no",
//         {
//           replacements: { component: item.component_key },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );
//       transitQTY = transitQTY = stmt10.length > 0 ? stmt10[0].transit_qty : 0;

//       let bom_status;
//       if (item.bom_status == "A") {
//         bom_status =
//           '<span style="color: #2db71c; font-weight: 600;">ACTIVE</span>';
//       } else if (item.bom_status == "ALT") {
//         bom_status =
//           '<span style="color: #ff9800; font-weight: 600;">ALTERNATIVE</span>';
//       } else {
//         bom_status =
//           '<span style="color: #e53935; font-weight: 600;">INACTIVE</span>';
//       }

//       let com_status;
//       if (item.c_is_enabled == "N") {
//         com_status =
//           '<span style="color: #2db71c; font-weight: 600;">ENABLED</span>';
//       } else if (item.c_is_enabled == "Y") {
//         com_status =
//           '<span style="color: #e53935; font-weight: 600;">DISABLED</span>';
//       } else {
//         com_status =
//           '<span style="color: #ff9800; font-weight: 600;">N/A</span>';
//       }

//       let bom_category;
//       if (item.bom_catergory == "P") {
//         bom_category = "PART";
//       } else if (item.bom_catergory == "O") {
//         bom_category = "OTHER";
//       } else if (item.bom_catergory == "PCB") {
//         bom_category = "PCB";
//       } else if (item.bom_catergory == "PCK") {
//         bom_category = "PACKING";
//       } else {
//         bom_category = "N/A";
//       }

//       let weightedPurchaseRate =
//         await require("../../../helper/utils/avgRate").getWeightedPurchaseRate(
//           item.component_key,
//           moment(stmt3[0].inward_date).format("YYYY-MM-DD HH:mm:ss")
//         );

//       data.push({
//         totalOB: "-",
//         totalClosingh: "-",
//         totalIn: "--",
//         totalOut: "--",
//         bom_status: bom_status,
//         sku: item.p_sku,
//         product: item.p_name,
//         components: decode(item.c_name),
//         units_name: item.units_name,
//         bomqty: item.qty,
//         partno: item.c_part_no,
//         new_partno: item.c_new_part_no,
//         com_status: com_status,
//         bom_category: bom_category,
//         image: "IMG",
//         weightedPurchaseRate: weightedPurchaseRate,
//         //minstock: item.c_min_stock,
//         maxstock: item.c_max_stock,
//         minorder: item.c_min_order_qty,
//         leadtime: item.c_lead_time,
//         transit_in: transitQTY,
//         lastrate: last_costing,
//         currency: currency_name,
//         bomalt_part: alt_component_part,
//         bomalt_name: alt_component_name,
//         inward: inward_all_qty,
//         outward: outward_all_qty,
//         opening: opening_qty,
//         closing: closing_qty,
//         //replenish: replenish_qty,
//       });

//       if (data.length === stmt1.length) {
//         data.sort(byPart);

//         return res.json({
//           status: "success", success: true,
//           success: true,
//           data: data,
//         });
//       }
//     });
//   } catch (error) {
//       return helper.errorResponse(res, error);
//   }
// });

router.post("/", [auth.isAuthorized], async (req, res) => {
  try {
    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
      moment(date[0], "DD-MM-YYYY"),
      "months"
    );
    if (durationInMonths > 3) {
      return res.json({
        status: "error",
        message:
          "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
          success: false,
      });
    }

    if (req.body.date == "") {
      return res.json({
        status: "error",
        message: "Please supply date",
        success: false
      });
    }
    if (req.body.product == "") {
      return res.json({
        status: "error",
        message: "Please supply product",
        success: false
      });
    }
    if (req.body.subject == "0") {
      return res.json({
        status: "error",
        message: "Please supply product BOM [Bill Of Material]",
        success: false
      });
    }

    let location_key = "";
    
    // C25 R1 store LOCATION
    if (req.branch == "BROAKTRC25") {
      location_key = "202381510340465";
    }
    

    

    // BRANCH R1 store STOCK LOCATION
    let stmt_get_a21 = await invtDB.query(
      "SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key",
      {
        replacements: { location_key: location_key },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let all_branch__location = [];
    if (stmt_get_a21.length > 0) {
      for (let loc_i = 0; loc_i < stmt_get_a21.length; loc_i++) {
        all_branch__location = stmt_get_a21[loc_i].locations.split(",");
      }
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "Branch Location Not Found, contact to administrator",
      });
    }
    // END

    let stmt1 = await invtDB.query(
      "SELECT * FROM bom_quantity LEFT JOIN components ON bom_quantity.component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id LEFT JOIN products ON (bom_quantity.product_sku = products.p_sku OR bom_quantity.product_sku = products.m_sku) WHERE bom_quantity.subject_under = :subject AND `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' GROUP BY `bom_quantity`.`component_id` ORDER BY `components`.`c_part_no` ASC",
      {
        replacements: { subject: req.body.subject },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    const data = [];
    stmt1.map(async (item) => {
      let stmt3 = await invtDB.query(
        "SELECT (SELECT COALESCE(SUM(qty+other_qty), 0) AS inward FROM rm_location WHERE components_id = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) AS inward, (SELECT COALESCE(SUM(qty+other_qty), 0) AS outward FROM rm_location WHERE components_id = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) outward ,(SELECT COALESCE(SUM(qty+other_qty), 0) AS inbefor FROM rm_location WHERE components_id = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') < :date1 ) AS inbefor ,  (SELECT COALESCE(SUM(qty+other_qty), 0) AS outward FROM rm_location WHERE components_id = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') < :date1) AS outbefore FROM DUAL",
        {
          replacements: {
            component: item.component_key,
            date1: fromdate,
            date2: todate,
            location: all_branch__location,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let inward_all_qty, outward_all_qty, opening_qty;
      if (stmt3.length > 0) {
        inward_all_qty = stmt3[0].inward;
        outward_all_qty = stmt3[0].outward;
        opening_qty = stmt3[0].inbefor - stmt3[0].outbefore;
      } else {
        (inward_all_qty = 0), (outward_all_qty = 0), (opening_qty = 0);
      }

      //CLOSING QUANTITY
      let closing_qty = checkNegativeValue(
        opening_qty + inward_all_qty - outward_all_qty
      );

      //REPLENISHMENT QUANTITY
      let replenish_qty;
      if (closing_qty < item.c_min_stock) {
        replenish_qty = item.c_min_stock - closing_qty;
      } else {
        replenish_qty = "0";
      }

      //IN-TRANSIT
      let stmt5 = await invtDB.query(
        "SELECT COALESCE(SUM(`po_order_qty`), 0) AS `totalPO_order`, po_transaction FROM `po_purchase_req` WHERE `po_part_no` = :component GROUP BY `po_transaction`",
        {
          replacements: { component: item.component_key },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt5.length > 0) {
        po_order_qty = stmt5[0].totalPO_order;
        po_transaction = stmt5[0].po_transaction;
      } else {
        po_order_qty = 0;
        po_transaction = "--";
      }

      //LAST COMPONENT PURCHASE RATE
      let last_costing = 0,
        currency_name = "--",
        w_avr_rate = 0;

      const [stmt6, stmtWAR] = await Promise.all([
        invtDB.query(
          "SELECT rl.`ID`, COALESCE(SUM(rl.`in_po_rate`), 0) AS `last_cost_rate`, rl.`components_id`, rl.`exchange_rate`, ic.`currency_notes` FROM `rm_location` rl LEFT JOIN `ims_currency` ic ON ic.`currency_id` = rl.`currency_type` WHERE rl.`components_id` = :component AND rl.`trans_type` = 'INWARD' AND rl.`ID` = ( SELECT MAX(`ID`) FROM `rm_location` WHERE `components_id` = :component AND `trans_type` = 'INWARD' AND `vendor_type` IN ('v01', 'j01') )",
          {
            replacements: { component: item.component_key },
            type: invtDB.QueryTypes.SELECT,
          },
        ),
        
        require("../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(
          item.component_key,
          todate,
        ),
      ]);

      if (stmt6.length > 0) {
        last_costing = stmt6[0].last_cost_rate;
        currency_name = stmt6[0].currency_notes;
      } else {
        last_costing = 0;
        currency_name = "--";
      }

      w_avr_rate = stmtWAR || 0;

      //TOTAL ROWS
      let stmt7 = await invtDB.query(
        "SELECT COUNT(`ID`) AS `COUNT` FROM `bom_quantity` WHERE `subject_under` = :subject",
        {
          replacements: { subject: req.body.subject },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      //FETCH ALTERNATIVE PART CODES
      let alt_component_part = [];
      let alt_component_name = [];
      let stmt8 = await invtDB.query(
        "SELECT * FROM `alternative_components` WHERE `alt_mother_component` = :component AND `alt_subject` = :subject AND `alt_product_sku` = :product AND `alt_type` = 'default'",
        {
          replacements: {
            component: item.component_key,
            subject: req.body.subject,
            product: item.p_sku,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt8.length > 0) {
        if (item.bom_status == "ALT") {
          let stmt9 = await invtDB.query(
            "SELECT * FROM `components` WHERE `component_key` = :component",
            {
              replacements: { component: stmt8[0].alt_daughter_component },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (stmt9.length > 0) {
            alt_component_part.push(stmt9[0].c_part_no);
            alt_component_name.push(decode(stmt9[0].c_name));
          } else {
            alt_component_part.push("--");
            alt_component_name.push("--");
          }
        } else {
          alt_component_part = ["N/A"];
          alt_component_name = ["N/A"];
        }
      } else {
        alt_component_part = ["N/A"];
        alt_component_name = ["N/A"];
      }
      console.log(
        "ALTERNATIVE PARTS: ",
        alt_component_part,
        alt_component_name
      );

      if (alt_component_name.length == 0) {
        alt_component_part = "--";
        alt_component_name = "--";
      }

      let transitQTY;
      let stmt10 = await invtDB.query(
        "SELECT po_part_no, SUM(po_order_qty - po_inward_qty) AS transit_qty FROM po_purchase_req WHERE po_part_no = :component AND NOT (po_status = 'C' AND po_inward_qty = 0) AND (po_status = 'A' AND po_order_qty != po_inward_qty OR po_status = 'C') GROUP BY po_part_no",
        {
          replacements: { component: item.component_key },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      transitQTY = transitQTY = stmt10.length > 0 ? stmt10[0].transit_qty : 0;

      let bom_status;
      if (item.bom_status == "A") {
        bom_status =
          '<span style="color: #2db71c; font-weight: 600;">ACTIVE</span>';
      } else if (item.bom_status == "ALT") {
        bom_status =
          '<span style="color: #ff9800; font-weight: 600;">ALTERNATIVE</span>';
      } else {
        bom_status =
          '<span style="color: #e53935; font-weight: 600;">INACTIVE</span>';
      }

      let com_status;
      if (item.c_is_enabled == "N") {
        com_status =
          '<span style="color: #2db71c; font-weight: 600;">ENABLED</span>';
      } else if (item.c_is_enabled == "Y") {
        com_status =
          '<span style="color: #e53935; font-weight: 600;">DISABLED</span>';
      } else {
        com_status =
          '<span style="color: #ff9800; font-weight: 600;">N/A</span>';
      }

      let bom_category;
      if (item.bom_catergory == "P") {
        bom_category = "PART";
      } else if (item.bom_catergory == "O") {
        bom_category = "OTHER";
      } else if (item.bom_catergory == "PCB") {
        bom_category = "PCB";
      } else if (item.bom_catergory == "PCK") {
        bom_category = "PACKING";
      } else {
        bom_category = "N/A";
      }

      let weightedPurchaseRate =
        await require("../../../helper/utils/avgRate").getWeightedPurchaseRate(
          item.component_key,
          moment(stmt3[0].inward_date).format("YYYY-MM-DD HH:mm:ss")
        );

      data.push({
        totalOB: "-",
        totalClosingh: "-",
        totalIn: "--",
        totalOut: "--",
        bom_status: bom_status,
        sku: item.p_sku,
        product: item.p_name,
        components: decode(item.c_name),
        units_name: item.units_name,
        bomqty: item.qty,
        partno: item.c_part_no,
        new_partno: item.c_new_part_no,
        com_status: com_status,
        bom_category: bom_category,
        image: "IMG",
        weightedPurchaseRate: weightedPurchaseRate,
        maxstock: item.c_max_stock,
        minorder: item.c_min_order_qty,
        leadtime: item.c_lead_time,
        transit_in: transitQTY,
        lastrate: last_costing,
        currency: currency_name,
        bomalt_part: alt_component_part,
        bomalt_name: alt_component_name,
        inward: inward_all_qty,
        outward: outward_all_qty,
        opening: opening_qty,
        closing: closing_qty,
      });

      if (data.length === stmt1.length) {
        data.sort(byPart);

        res.json({
          status: "success",
          success: true,
          data: data,
        });
        return;
      }
    });
  } catch (error) {
    console.error("Error in /INVENTORY/report/r1.js:", error);
    return helper.errorResponse(res, err);
  }
});

module.exports = router;
