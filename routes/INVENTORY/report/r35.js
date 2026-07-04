const { invtDB, tallyDB } = require("../../../config/db/connection");
const express = require("express");
const router = express.Router();
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

router.post("/get", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      sku: "required",
      bom: "required",
      date: "required",
    });

    if (valid.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(valid),
      });
    }

    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

    if (!date) {
      return res.json({
        status: "error",
        success: false,
        message: "Please select valid date",
      });
    }

    const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
    const diffDays = moment(date[1], "DD-MM-YYYY").diff(
      moment(date[0], "DD-MM-YYYY"),
      "days"
    );

    let curryear = moment(fromdate).format("YYYY");

    if (moment(fromdate).diff(moment(`${curryear}-04-01`), "days") < 0) {
      return res.json({
        status: "error",
        success: false,
        message: `We can provide you data only from ${curryear}-04-01`,
      });
    }

    // if (diffDays > 90) {
    //     return res.json({ status: "error", success: false, message: "We can provide you 90 days OR (3 months) data only" });
    // }

    let allCompdata = [];

    const getComponents = await invtDB.query(
      "SELECT bom_quantity.*, components.c_part_no , components.c_name , components.c_new_part_no FROM bom_quantity LEFT JOIN components ON bom_quantity.component_id = components.component_key WHERE subject_under = :bom AND product_sku = :sku AND components.c_type = 'R' AND components.c_is_enabled = 'Y' AND bom_quantity.bom_status = 'A'",
      {
        replacements: { bom: req.body.bom, sku: req.body.sku },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (getComponents.length == 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Data not found",
      });
    }

    // async function getChildData(sku) {
    //   let stmt_child = await invtDB.query(
    //     "SELECT bom_quantity.*, components.c_part_no , components.c_name , components.c_new_part_no  FROM bom_quantity LEFT JOIN components ON bom_quantity.component_id = components.component_key WHERE bom_quantity.product_sku IN (:product_sku) AND components.c_type = 'R' AND components.c_is_enabled = 'Y' AND bom_quantity.bom_status = 'A' ORDER BY components.c_name ASC",
    //     {
    //       replacements: { product_sku: sku },
    //       type: invtDB.QueryTypes.SELECT,
    //     }
    //   );

    //   return stmt_child;
    // }

    allCompdata = getComponents;
    // let sfg = getComponents.map((item) => {
    //   return item.c_part_no;
    // });

    // let childData = await getChildData(sfg);
    // allCompdata = getComponents.concat(childData);

    // const allSkusData = allCompdata.map((item) => {
    //   return item.product_sku;
    // });

    // let tempArrData = [];
    // allCompdata.map((item) => {
    //   if (!allSkusData.includes(item.c_new_part_no)) {
    //     tempArrData.push(item);
    //   }
    // });
    // allCompdata = tempArrData;

    // GET LOCATION FOR STOCK
    // SF AND RM FROM Q5
    const getLocations = await invtDB.query(
      "SELECT * FROM location_allotted WHERE loc_all_key IN ('2023112717950595','20231127171244714')",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (getLocations.length == 0) {
      return res.json({
        status: "error",
        success: false,
        message: "SF AND RM location not found",
      });
    }

    // console.log(getLocations);
    let sfAndRmlocations = [];
    let rmLocations = [];
    for (let i = 0; i < getLocations.length; i++) {
      // RM LOCATION
      if (getLocations[i].loc_all_key == "2023112717950595") {
        rmLocations = getLocations[i].locations.split(",");
      }
      const tempArr = getLocations[i].locations.split(",");
      sfAndRmlocations = sfAndRmlocations.concat(tempArr);
    }
    // console.log(sfAndRmlocations);

    // GET SF TO REJ LOCATION
    // REJ LOCATION
    const getRejLocations = await invtDB.query(
      "SELECT * FROM location_allotted WHERE loc_all_key IN ('202451718657579')",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (getRejLocations.length == 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Rej location not found",
      });
    }

    let rejLocations = [];

    for (let i = 0; i < getRejLocations.length; i++) {
      const tempArr = getRejLocations[i].locations.split(",");
      rejLocations = rejLocations.concat(tempArr);
    }
    // END REJ LOCATION
    // SF TO REJ LOCATION SF LOCATION
    const getSflocationsOfsfToRej = await invtDB.query(
      "SELECT * FROM location_allotted WHERE loc_all_key IN ('20220212173214')",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (getSflocationsOfsfToRej.length == 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Sf to rej location not found",
      });
    }

    let sfToRejLocations = [];

    for (let i = 0; i < getSflocationsOfsfToRej.length; i++) {
      const tempArr = getSflocationsOfsfToRej[i].locations.split(",");
      sfToRejLocations = sfToRejLocations.concat(tempArr);
    }
    // END SF LOCATION SF TO REJ LOCATION
    // END SF TO REJ LOCATION

    // CONJ LOCATION
    const getConjLocations = await invtDB.query(
      "SELECT * FROM location_allotted WHERE loc_all_key IN ('202451512128708')",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (getConjLocations.length == 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Conj location not found",
      });
    }

    let conjLocations = [];

    for (let i = 0; i < getConjLocations.length; i++) {
      const tempArr = getConjLocations[i].locations.split(",");
      conjLocations = conjLocations.concat(tempArr);
    }
    // END CONJ LOCATION

    let data = [];

    let promiseArr = allCompdata.map(async (comp) => {
      //for (let i = 0; i < allCompdata.length; i++) {
      // console.log(getComponents[i]);

      // GET OPENING STOCK
      let INWARD = 0;
      let OPENING = 0;
      let OUTWARD = 0;
      let CLOSING = 0;
      let LASTIN = 0;
      let LASTOUT = 0;
      // SELECT (SELECT COALESCE(SUM(qty+other_qty), 0) AS inward FROM rm_location WHERE components_id = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) AS inward, (SELECT COALESCE(SUM(qty+other_qty), 0) AS outward FROM rm_location WHERE components_id = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) outward ,(SELECT COALESCE(SUM(qty+other_qty), 0) AS inbefor FROM rm_location WHERE components_id = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') < :date1 ) AS inbefor ,  (SELECT COALESCE(SUM(qty+other_qty), 0) AS outward FROM rm_location WHERE components_id = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') < :date1) AS outbefore FROM DUAL
      let countStock = await invtDB.query(
        "SELECT (SELECT COALESCE(SUM(qty+other_qty), 0) AS inward FROM rm_location WHERE components_id = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) AS inward, (SELECT COALESCE(SUM(qty+other_qty), 0) AS outward FROM rm_location WHERE components_id = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) outward ,(SELECT COALESCE(SUM(qty+other_qty), 0) AS inbefor FROM rm_location WHERE components_id = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') < :date1 ) AS inbefor ,  (SELECT COALESCE(SUM(qty+other_qty), 0) AS outward FROM rm_location WHERE components_id = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') < :date1) AS outbefore FROM DUAL",
        {
          replacements: {
            component: comp.component_id,
            date1: fromdate,
            date2: todate,
            location: sfAndRmlocations,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (countStock.length > 0) {
        INWARD = helper.number(countStock[0].inward);
        OUTWARD = helper.number(countStock[0].outward);
        OPENING = helper.number(
          countStock[0].inbefor - countStock[0].outbefore
        );
      }

      //   GET TOTAL INWARD
      const inwardStmt = await tallyDB.query(
        ` SELECT (SELECT COALESCE(SUM(vbt_bill_qty),0) as inward FROM tally_vbt WHERE part_code = :component AND DATE_FORMAT(effective_date,"%Y-%m-%d") BETWEEN :date1 AND :date2 AND vbt_status = '--' ) AS inward , (SELECT COALESCE(SUM(vbt_bill_qty),0) as debit FROM tally_vbt WHERE part_code = :component AND DATE_FORMAT(effective_date,"%Y-%m-%d") BETWEEN :date1 AND :date2 AND vbt_status = 'DE' ) AS debit FROM DUAL `,
        {
          replacements: {
            component: comp.component_id,
            date1: fromdate,
            date2: todate,
          },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      let CREDIT = 0;
      if (inwardStmt.length > 0) {
        CREDIT =
          helper.number(inwardStmt[0].inward) -
          helper.number(inwardStmt[0].debit);
        // CREDIT = helper.number(inwardStmt[0].inward) + "-" + helper.number(inwardStmt[0].debit);
      }

      // GET TOTAL CONSUMPTION QTY
      const consumptionStmt = await invtDB.query(
        "SELECT COALESCE(SUM(qty),0) as qty , COALESCE(SUM(mfg_bom_qty),0) as mfg FROM rm_location WHERE components_id = :component AND trans_type IN ('CONSUMPTION') AND DATE_FORMAT(insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND in_module != 'PART-CONV' ",
        {
          replacements: {
            component: comp.component_id,
            bom: req.body.bom,
            date1: fromdate,
            date2: todate,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let consumpQty = 0;
      if (consumptionStmt.length > 0) {
        // consumpQty = helper.number(consumptionStmt[0].qty) * helper.number(consumptionStmt[0].mfg);
        consumpQty = helper.number(consumptionStmt[0].qty);
      }

      //   TOTAL REJECTIONS
      const rejectionStmt = await invtDB.query(
        `SELECT COALESCE(SUM(qty),0) as qty FROM rm_location WHERE components_id = :component AND trans_type IN ('TRANSFER','REJECTION') AND DATE_FORMAT(insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND loc_in IN (:rejlocation) AND loc_out IN (:sflocation) `,
        {
          replacements: {
            component: comp.component_id,
            date1: fromdate,
            date2: todate,
            sflocation: sfToRejLocations,
            rejlocation: rejLocations,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      //   TOTAL CONSUMPTION
      //   console.log(rejectionStmt);

      //   RM SALES AND CONSUMPTION

      const rmToConStmt = await invtDB.query(
        `SELECT COALESCE(SUM(qty),0) as qty FROM rm_location WHERE components_id = :component AND trans_type IN ('ISSUE') AND DATE_FORMAT(insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND loc_in IN (:conjLocations) AND loc_out IN (:rmLocations) `,
        {
          replacements: {
            component: comp.component_id,
            date1: fromdate,
            date2: todate,
            conjLocations: conjLocations,
            rmLocations: rmLocations,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let rmToCon = 0;
      if (rmToConStmt.length > 0) {
        rmToCon = helper.number(rmToConStmt[0].qty);
      }
      // END RM SALES AND CONSUMPTION

      // ///////////////////////
      // JW CONSUMPTION
      // let stmt_total_consump = await invtDB.query(
      //   `SELECT COALESCE(SUM(qty+other_qty),0 ) AS total_consumption FROM rm_location WHERE jw_transaction_id != '--' AND components_id = :component_id AND trans_type = 'SFG-CONSUMPTION' AND DATE_FORMAT(insert_date,"%Y-%m-%d") BETWEEN :date1 AND :date2 `,
      //   {
      //     replacements: { component_id: comp.component_id, date1: fromdate, date2: todate },
      //     type: invtDB.QueryTypes.SELECT,
      //   }
      // );
      // let total_consumption_value = 0;
      // if (stmt_total_consump.length > 0) {
      //   total_consumption_value = stmt_total_consump[0].total_consumption;
      // }

      // let stmt_total_iss = await invtDB.query(
      //   `SELECT COALESCE(SUM(qty+other_qty), 0) AS total_issued_rm FROM rm_location WHERE jw_transaction_id != '--' AND components_id = :component_id AND trans_type = 'JOBWORK' AND DATE_FORMAT(insert_date,"%Y-%m-%d") BETWEEN :date1 AND :date2 `,
      //   {
      //     replacements: { component_id: comp.component_id, date1: fromdate, date2: todate },
      //     type: invtDB.QueryTypes.SELECT,
      //   }
      // );
      // let total_issue_qty = 0;
      // if (stmt_total_iss.length > 0) {
      //   total_issue_qty = stmt_total_iss[0].total_issued_rm;
      // }

      // let stmt_total_ret = await invtDB.query(
      //   "SELECT COALESCE(SUM(qty+other_qty),0 ) AS total_returned_rm FROM rm_location WHERE trans_type = 'INWARD' AND in_jw_transaction_id != '--' AND components_id = :component_id AND trans_mode = 'return' AND DATE_FORMAT(insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 ",
      //   {
      //     replacements: { component_id: comp.component_id, date1: fromdate, date2: todate },
      //     type: invtDB.QueryTypes.SELECT,
      //   }
      // );
      // let total_rm_return_qty = 0;
      // if (stmt_total_ret.length > 0) {
      //   total_rm_return_qty = stmt_total_ret[0].total_returned_rm;
      // }

      // let jwCons = total_consumption_value;
      // let jwCons = helper.number(total_consumption_value > total_issue_qty - total_rm_return_qty ? total_issue_qty - total_rm_return_qty : total_consumption_value);

      // const jwConStmt = await invtDB.query(
      //   `SELECT COALESCE(SUM(qty+other_qty),0 ) AS total_consumption FROM rm_location WHERE in_module = 'IN-JWI' AND trans_type = 'INWARD' AND components_id = :component_id AND DATE_FORMAT(insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 `,
      //   {
      //     replacements: { component_id: comp.component_id, date1: fromdate, date2: todate },
      //     type: invtDB.QueryTypes.SELECT,
      //   }
      // );

      // let jwCons = jwConStmt[0].total_consumption;

      // console.log(total_consumption_value, total_issue_qty - total_rm_return_qty, "--------------------------------");

      // M3

      const jwConStmt = await invtDB.query(
        "SELECT COALESCE(SUM(jw_ven_in_qty),0 ) AS total_consumption FROM jw_ven_location WHERE (DATE_FORMAT(`jw_ven_insert_dt`,'%Y-%m-%d') BETWEEN :data1 AND :data2) AND jw_ven_txn_type = 'RM-CONSUMPTION' AND jw_ven_location.jw_ven_rm = :component_id ",
        {
          replacements: {
            component_id: comp.component_id,
            data1: fromdate,
            data2: todate,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let jwCons = jwConStmt[0].total_consumption;

      // END M3

      // END JW CONSUMPTION
      // //////////////

      // -------------------------------------------
      // JW STOCK
      let jworderQty = await invtDB.query(
        "SELECT ( SELECT COALESCE(SUM(jw_ven_in_qty), 0) AS inward FROM jw_ven_location WHERE jw_ven_txn_type = 'RM-INWARD' AND jw_ven_rm = :comp AND DATE_FORMAT(`jw_ven_insert_dt`,'%Y-%m-%d') BETWEEN :date1 AND :date2 ) as inward , ( SELECT COALESCE(SUM(jw_ven_in_qty), 0) AS outward FROM jw_ven_location WHERE jw_ven_txn_type = 'RM-CONSUMPTION' AND jw_ven_rm = :comp AND DATE_FORMAT(`jw_ven_insert_dt`,'%Y-%m-%d') BETWEEN :date1 AND :date2 ) as outward, (SELECT COALESCE(SUM(jw_ven_in_qty), 0) AS inward FROM jw_ven_location WHERE jw_ven_txn_type = 'RM-INWARD' AND jw_ven_rm = :comp AND DATE_FORMAT(`jw_ven_insert_dt`,'%Y-%m-%d') < :date1 ) - (SELECT COALESCE(SUM(jw_ven_in_qty), 0) AS outward FROM jw_ven_location WHERE jw_ven_txn_type = 'RM-CONSUMPTION' AND jw_ven_rm = :comp AND DATE_FORMAT(`jw_ven_insert_dt`,'%Y-%m-%d') < :date1) AS opening FROM DUAL",
        {
          replacements: {
            comp: comp.component_id,
            date1: fromdate,
            date2: todate,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let jwStock =
        helper.number(jworderQty[0].opening) +
        jworderQty[0].inward -
        jworderQty[0].outward;
      // END JW STOCK
      // --------------------------------------------

      let closingStock = helper.number(
        helper.number(OPENING) +
          helper.number(jworderQty[0].opening) +
          helper.number(CREDIT) -
          (helper.number(consumpQty) +
            helper.number(rejectionStmt[0].qty) +
            helper.number(rmToCon) +
            helper.number(jwCons) +
            helper.number(jwStock))
      );
      let currentStock = helper.number(OPENING + INWARD - OUTWARD);

      // Production return min
      let prod_rtn_min = await invtDB.query(
        `SELECT COALESCE(SUM(qty+other_qty),0 ) AS prod_rtn FROM rm_location WHERE vendor_type ='p01' AND in_module IN ('IN-MIN','IN-FGRETURN' ) AND trans_type = 'INWARD' AND components_id = :component AND DATE_FORMAT(insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2`,
        {
          replacements: {
            component: comp.component_id,
            date1: fromdate,
            date2: todate,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      // Part Conversion
      let part_conversion = await invtDB.query(
        `SELECT COALESCE(SUM(qty+other_qty),0 ) AS part_conversion FROM rm_location WHERE in_module = 'PART-CONV' AND trans_type = 'INWARD' AND components_id = :component AND DATE_FORMAT(insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 `,
        {
          replacements: {
            component: comp.component_id,
            date1: fromdate,
            date2: todate,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      return res.json({
        status: "success",
        success: true,
        data: {
          component: comp.c_part_no,
          name: comp.c_name,
          new_part_no: comp.c_new_part_no,
          opening: OPENING + helper.number(jworderQty[0].opening),
          inward: CREDIT,
          consumptionQty: consumpQty,
          totalRejections: helper.number(rejectionStmt[0].qty),
          rmCons: rmToCon,
          jwCons: jwCons,
          jwStock: jwStock,
          closingStock: closingStock,
          currentStock: currentStock,
          diffrence: closingStock - currentStock,
          prod_rtn_min: prod_rtn_min[0].prod_rtn,
          part_conversion: part_conversion[0].part_conversion,
        },
      });
      //}
    });

    data = await Promise.all(promiseArr);

    return res.json({ status: "success", success: true, data: data });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

module.exports = router;
