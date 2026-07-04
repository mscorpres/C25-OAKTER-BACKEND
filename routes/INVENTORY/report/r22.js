let { invtDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");
//Required Passing Parameters:


//1. skucode
//2. date

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
    if (req.body.date == "") {
      return res.json({ status: "error", success: false, message: "Please supply date" });
    }
    if (req.body.skucode == "") {
      return res.json({ status: "error", success: false, message: "Please supply product" });
    }

    let stmt2 = await invtDB.query("SELECT * FROM bom_recipe WHERE bom_product_sku = :product_sku", {
      replacements: { product_sku: req.body.skucode },
      type: invtDB.QueryTypes.SELECT,
    });
    if (stmt2.length > 0) {
      let stmt3 = await invtDB.query("SELECT * FROM  bom_quantity LEFT JOIN  components  ON  bom_quantity.component_id   =  components.component_key  LEFT JOIN units ON components.c_uom = units.units_id WHERE  bom_quantity.subject_under  = :subject ORDER BY   components.c_part_no ASC", {
        replacements: { subject: req.body.subject },
        type: invtDB.QueryTypes.SELECT,
      });

      const get_all_loc = await invtDB.query(
        "SELECT location_key FROM location_main WHERE company_branch = :company_branch", {
        replacements: { company_branch: req.branch },
        type: invtDB.QueryTypes.SELECT
      }
      );

      let locations = [];
      if (get_all_loc.length == 0) {
        return res.json({ status: "error", success: false, message: "Please supply company branch" });
      }

      for (let i = 0; i < get_all_loc.length; i++) {
        locations.push(get_all_loc[i].location_key);
      }


      // console.log(locations);

      // return;

      const data = [];
      count = 0;
      stmt3.map(async (item) => {
        let bom_status;
        if (item.bom_status == "A") {
          bom_status = "ACTIVE";
        } else if (item.bom_status == "ALT") {
          bom_status = "ALTERNATIVE";
        } else {
          bom_status = "INACTIVE";
        }

        let bom_catergory = "N/A";
        if (item.bom_catergory == "P") {
          bom_catergory = "PART";
        } else if (item.bom_catergory == "O") {
          bom_catergory = "OTHER";
        } else if (item.bom_catergory == "PCK") {
          bom_catergory = "PACKING";
        }

        let stmt4 = await invtDB.query(
          "SELECT (SELECT COALESCE(SUM(qty+other_qty), 0) AS Inward FROM rm_location WHERE components_id = :component AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') = :date AND trans_type IN ('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')) as inward, (SELECT COALESCE(SUM(qty+other_qty), 0) AS Outward FROM rm_location WHERE components_id = :component AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') = :date AND trans_type IN ('CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')) as outward, (SELECT COALESCE(SUM(QTY), 0) AS OpeningBalance FROM ( SELECT qty QTY FROM rm_location CR WHERE CR.components_id = :component AND CR.loc_in IN (:location) AND DATE_FORMAT(CR.insert_date, '%Y-%m-%d') < :date AND CR.trans_type IN ('INWARD','TRANSFER','ISSUE') UNION ALL SELECT - COALESCE(SUM(qty + other_qty), 0) QTY FROM rm_location DR WHERE DR.components_id = :component AND DR.loc_out IN (:location) AND DATE_FORMAT(DR.insert_date, '%Y-%m-%d') < :date AND DR.trans_type IN ('ISSUE','REJECTION','JOBWORK','TRANSFER')) t) as OpeningBalance FROM DUAL",
          {
            replacements: {
              component: item.component_key,
              location: locations,
              date: moment(req.body.date, "DD-MM-YYYY").format("YYYY-MM-DD"),
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let inward_all_qty = 0, outward_all_qty = 0, opening_qty = 0;
        if (stmt4.length > 0) {
          inward_all_qty = stmt4[0].inward;
          outward_all_qty = stmt4[0].outward;
          opening_qty = stmt4[0].OpeningBalance;
          // opening_qty = stmt4[0].inbefore - stmt4[0].outbefore;
        }


        //FETCH ALTERNATIVE PART CODES
        let alt_component_part = [];
        let alt_component_name = [];
        let stmt7 = await invtDB.query("SELECT * FROM alternative_components WHERE alt_mother_component = :component AND alt_subject = :subject AND alt_product_sku = :product AND alt_type = 'default'", {
          replacements: {
            component: item.component_key,
            subject: req.body.subject,
            product: req.body.skucode,
          },
          type: invtDB.QueryTypes.SELECT,
        });
        if (stmt7.length > 0) {
          if (item.bom_status == "ALT") {
            let stmt8 = await invtDB.query("SELECT * FROM components WHERE component_key = :component", {
              replacements: {
                component: stmt7[0].alt_daughter_component,
              },
              type: invtDB.QueryTypes.SELECT,
            });
            if (stmt8.length > 0) {
              alt_component_part.push(stmt8[0].c_part_no);
              alt_component_name.push(stmt8[0].c_name);
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

        if (alt_component_part.length == 0) {
          alt_component_part = "--";
          alt_component_name = "--";
        } else {
          alt_component_part = alt_component_part.join(", ");
          alt_component_name = alt_component_name.join(", ");
        }

        data.push({
          serial_no: count + 1,
          partno: item.c_part_no,
          new_partno: item.c_new_part_no,
          components: item.c_name,
          openBal: helper.number(opening_qty),
          creditBal: helper.number(inward_all_qty),
          debitBal: helper.number(outward_all_qty),
          closingBal: helper.number(opening_qty) + helper.number(inward_all_qty) - helper.number(outward_all_qty),
          uom: item.units_name,
          category: bom_catergory,
          status: bom_status,
          bomalt_part: alt_component_part,
          bomalt_name: alt_component_name,
          bomqty: item.qty,
        });
        count++;

        if (data.length == stmt3.length) {
          data.sort(byDate);
          return res.json({ status: "success", success: true, message: "Report fetched successfully", data: data });
        }
      });
    } else {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "no any recipes found for the product sku code, that you supplied..",
      });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

router.post("/fetchLocationDetail", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    location_key: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "Please select valid location" });
  }

  try {
    let stmt1 = await invtDB.query("SELECT loc_address FROM location_main WHERE location_key = :location", {
      replacements: { location: req.body.location_key },
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt1.length == 0) {
      return res.json({ status: "error", success: false, message: "Please select valid location" });
    } else {
      return res.json({ status: "success", success: true, message: "Location fetched successfully", data: stmt1[0].loc_address });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});
module.exports = router;
