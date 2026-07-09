let { invtDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

const Validator = require("validatorjs");
//Required Passing Parameters:

//1. location
//2. skucode
//3. date

checkNegativeValue = (value) => {
  return value < 0 ? 0 : value;
};

function byDate(a, b) {
  let d1 = new Date(moment(a.reg_date, "DD-MM-YYYY"));
  let d2 = new Date(moment(b.reg_date, "DD-MM-YYYY"));
  return d2 - d1;
}

router.post("/", [auth.isAuthorized], async (req, res) => {
  try {
    const { date, skucode, location, subject } = req.body;

    if (!date) {
      return res.json({
        success: false,
        status: "error",
        message: "Please supply date",
      });
    }

    if (!skucode) {
      return res.json({
        success: false,
        status: "error",
        message: "Please supply product",
      });
    }

    if (!location) {
      return res.json({
        success: false,
        status: "error",
        message: "Please supply location",
      });
    }

    if (!subject) {
      return res.json({
        success: false,
        status: "error",
        message: "Please supply subject",
      });
    }

    const formattedDate = moment(date, "DD-MM-YYYY").format("YYYY-MM-DD");
    const { newWeightedAverageRate, CUTOFF_DATE } = require("../../../helper/utils/newAvgRate");
    const isAfterCutoff =
      new Date(formattedDate).getTime() > new Date(CUTOFF_DATE).getTime();

    const [stmt1, stmt2] = await Promise.all([
      invtDB.query(
        `SELECT * 
         FROM location_main 
         WHERE location_key = :location`,
        {
          replacements: { location },
          type: invtDB.QueryTypes.SELECT,
        },
      ),

      invtDB.query(
        `SELECT * 
         FROM bom_recipe 
         WHERE bom_product_sku = :product_sku`,
        {
          replacements: { product_sku: skucode },
          type: invtDB.QueryTypes.SELECT,
        },
      ),
    ]);

    if (!stmt2.length) {
      return res.json({
        success: false,
        status: "error",
        message: "no any recipes found for the product sku code, that you supplied..",
      });
    }

    const stmt3 = await invtDB.query(
      `SELECT *
       FROM bom_quantity
       LEFT JOIN components
         ON bom_quantity.component_id = components.component_key
       LEFT JOIN units
         ON components.c_uom = units.units_id
       WHERE bom_quantity.subject_under = :subject
       ORDER BY components.c_part_no ASC`,
      {
        replacements: { subject },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    const data = await Promise.all(
      stmt3.map(async (item, index) => {
        try {
          const [stmt4, stmt7] = await Promise.all([
            invtDB.query(
              `SELECT
                (
                  SELECT COALESCE(SUM(qty + other_qty), 0)
                  FROM rm_location
                  WHERE components_id = :component
                    AND loc_in = :location
                    AND DATE(insert_date) = :date
                    AND trans_type IN (
                      'INWARD',
                      'ISSUE',
                      'JOBWORK',
                      'REJECTION',
                      'TRANSFER'
                    )
                ) AS inward,

                (
                  SELECT COALESCE(SUM(qty + other_qty), 0)
                  FROM rm_location
                  WHERE components_id = :component
                    AND loc_out = :location
                    AND DATE(insert_date) = :date
                    AND trans_type IN (
                      'CONSUMPTION',
                      'ISSUE',
                      'JOBWORK',
                      'REJECTION',
                      'TRANSFER'
                    )
                ) AS outward,

                (
                  (
                    SELECT COALESCE(SUM(qty), 0)
                    FROM rm_location
                    WHERE components_id = :component
                      AND loc_in = :location
                      AND DATE(insert_date) < :date
                      AND trans_type IN (
                        'INWARD',
                        'TRANSFER',
                        'ISSUE'
                      )
                  )
                  -
                  (
                    SELECT COALESCE(SUM(qty + other_qty), 0)
                    FROM rm_location
                    WHERE components_id = :component
                      AND loc_out = :location
                      AND DATE(insert_date) < :date
                      AND trans_type IN (
                        'CONSUMPTION',
                        'ISSUE',
                        'REJECTION',
                        'JOBWORK',
                        'TRANSFER'
                      )
                  )
                ) AS OpeningBalance`,
              {
                replacements: {
                  component: item.component_key,
                  location,
                  date: formattedDate,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            ),

            invtDB.query(
              `SELECT *
               FROM alternative_components
               WHERE alt_mother_component = :component
                 AND alt_subject = :subject
                 AND alt_product_sku = :product
                 AND alt_type = 'default'`,
              {
                replacements: {
                  component: item.component_key,
                  subject,
                  product: skucode,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            ),
          ]);

          let weightedPurchaseRate = 0;
          if (isAfterCutoff) {
            const lastTxn = await invtDB.query(
              `SELECT ID, insert_date
               FROM rm_location
               WHERE components_id = :component
                 AND DATE(insert_date) <= :date
                 AND trans_type NOT IN ('CANCELLED', 'REJECTION', 'MIN_PENDING', 'REVERSE')
               ORDER BY insert_date DESC, ID DESC
               LIMIT 1`,
              {
                replacements: {
                  component: item.component_key,
                  date: formattedDate,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            );

            if (lastTxn.length > 0) {
              weightedPurchaseRate = await newWeightedAverageRate(
                item.component_key,
                lastTxn[0].insert_date,
                lastTxn[0].ID,
              );
            }
          } else {
            const rateRow = await invtDB.query(
              `SELECT w_avr_rate
               FROM rm_location
               WHERE components_id = :component_id
                 AND trans_type IN ('INWARD', 'TRANSFER')
                 AND in_module != 'IN-WO'
                 AND DATE(insert_date) <= :date
               ORDER BY ID DESC
               LIMIT 1`,
              {
                replacements: {
                  component_id: item.component_key,
                  date: formattedDate,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            );
            weightedPurchaseRate = parseFloat(rateRow?.[0]?.w_avr_rate) || 0;
          }

          const inward_all_qty = helper.number(stmt4?.[0]?.inward || 0);

          const outward_all_qty = helper.number(stmt4?.[0]?.outward || 0);

          const opening_qty = helper.number(stmt4?.[0]?.OpeningBalance || 0);

          let alt_component_part = ["N/A"];
          let alt_component_name = ["N/A"];

          if (stmt7.length > 0 && item.bom_status === "ALT") {
            const stmt8 = await invtDB.query(
              `SELECT *
               FROM components
               WHERE component_key = :component`,
              {
                replacements: {
                  component: stmt7[0].alt_daughter_component,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            );

            if (stmt8.length > 0) {
              alt_component_part = [stmt8[0].c_part_no];
              alt_component_name = [stmt8[0].c_name];
            }
          }

          const bom_status = item.bom_status === "A" ? "ACTIVE" : item.bom_status === "ALT" ? "ALTERNATIVE" : "INACTIVE";

          const bom_catergory = item.bom_catergory === "P" ? "PART" : item.bom_catergory === "O" ? "OTHER" : item.bom_catergory === "PCK" ? "PACKING" : item.bom_catergory === "PCB" ? "PCB" : "N/A";

          return {
            serial_no: index + 1,
            partno: item.c_part_no,
            new_partno: item.c_new_part_no,
            components: item.c_name,
            openBal: opening_qty,
            creditBal: inward_all_qty,
            debitBal: outward_all_qty,
            closingBal: opening_qty + inward_all_qty - outward_all_qty,
            uom: item.units_name,
            category: bom_catergory,
            status: bom_status,
            bomalt_part: alt_component_part.join(", "),
            bomalt_name: alt_component_name.join(", "),
            bomqty: item.qty,
            weightedPurchaseRate: (Number(weightedPurchaseRate) || 0).toFixed(10),
          };
        } catch (err) {
          console.error("Component Query Error:", item.component_key, err);
          throw err;
        }
      }),
    );

    data.sort(byDate);

    return res.json({
      success: true,
      status: "success",
      data: data
    });
  } catch (error) {
    console.error("API ERROR:", error);
    return helper.errorResponse(res, error);
  }
});

router.post("/fetchLocationDetail", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    location_key: "required",
  });

  if (validation.fails()) {
    return res.json({
      success:false,
      status: "error",
      message: "Please select valid location",
    });
  }

  try {
    let stmt1 = await invtDB.query("SELECT loc_address FROM `location_main` WHERE `location_key` = :location", {
      replacements: { location: req.body.location_key },
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt1.length == 0) {
      return res.json({
        success: false,
        status: "error",
        message: "Please select valid location",
      });
    } else {
      return res.json({
        success: true,
        status: "success",
        data: stmt1[0].loc_address,
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});
module.exports = router;
