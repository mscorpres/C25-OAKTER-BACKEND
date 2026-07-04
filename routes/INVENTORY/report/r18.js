let { invtDB, otherDB } = require("../../../config/db/connection");

const { encode, decode } = require("html-entities");

const express = require("express");
const router = express.Router();

const Validator = require("validatorjs");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

function byLocation(a, b) {
  return a.locations.localeCompare(b.locations, "en", { numeric: true });
}

router.post("/", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      for_location: "required",
      date: "required",
    });

    if (validation.fails()) {
      return res.json({ status: "error", success: false, message: validation.errors.all() });
    }

    let alloted_key = "";
    if (req.body.for_location == "SF") {
      alloted_key = 202391291831908;
    }
    if (req.body.for_location == "RM") {
      alloted_key = 202391291853593;
    }

    const stmt_sf_location = await invtDB.query("SELECT locations FROM location_allotted WHERE loc_all_key = :module", {
      replacements: { module: alloted_key },
      type: invtDB.QueryTypes.SELECT,
    });

    const stmt_get_location_name = await invtDB.query("SELECT loc_name,assigned_to from location_main WHERE location_key IN (:location)", {
      replacements: { location: stmt_sf_location[0].locations.split(",") },
      type: invtDB.QueryTypes.SELECT,
    });

    // console.log(stmt_get_location_name);
    const header = [];
    for (let i = 0; i < stmt_get_location_name.length; i++) {
      header.push(stmt_get_location_name[i].loc_name + "\n" + stmt_get_location_name[i].assigned_to);
    }

    let stmt = await otherDB.query(
      `SELECT c2.part, c2.locations, c1.c_name , c1.c_new_part_no FROM ${global.ims_db_name}.components c1 JOIN ${global.other_db_name}.invt_r18 c2 ON c1.c_part_no = c2.part WHERE c2.in_date = :date AND c2.for_location = :for_location GROUP BY c2.part`,
      {
        replacements: {
          date: moment(req.body.date, "DD-MM-YYYY").format("YYYY-MM-DD"),
          for_location: req.body.for_location,
        },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let data = [];

      for (let i = 0; i < stmt.length; i++) {
        let new_data = {};
        header.forEach((item, index) => {
          new_data[item] = JSON.parse(stmt[i].locations)[item];
        });

        data.push({
          part: stmt[i].part,
          component: decode(stmt[i].c_name),
          new_part: decode(stmt[i].c_new_part_no),
          locations: JSON.stringify(new_data),
        });
      }

      return res.json({ status: "success", success: true, message: "Report fetched successfully", data: data });
    } else {
      return res.json({ status: "error", success: false, message: "Data not found" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

router.post("/generate", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      date: "required",
      for_location: "required",
    });

    if (validation.fails()) {
      report_date = moment().subtract(1, "day").format("YYYY-MM-DD");
    } else {
      report_date = moment(req.body.date, "DD-MM-YYYY").format("YYYY-MM-DD");
    }

    let alloted_key = "";

    const loc_valid = new Validator(req.query, {
      for_location: "required",
    });

    let for_location = "";
    if (loc_valid.passes()) {
      if (req.query.for_location == "SF") {
        alloted_key = 202391291831908;
        for_location = "SF";
      }
      if (req.query.for_location == "RM") {
        alloted_key = 202391291853593;
        for_location = "RM";
      }
    } else {
      if (req.body.for_location == "SF") {
        alloted_key = 202391291831908;
        for_location = "SF";
      }
      if (req.body.for_location == "RM") {
        alloted_key = 202391291853593;
        for_location = "RM";
      }
    }

    const getgeneratedpartcodes = await invtDB.query(`SELECT part FROM ${global.other_db_name}.invt_r18 WHERE in_date = :report_date AND for_location = :for_location`, {
      replacements: {
        for_location: for_location,
        report_date: report_date,
      },
      type: invtDB.QueryTypes.SELECT,
    });

    // console.log(getgeneratedpartcodes);

    let stmt_all_comp = "";
    if (getgeneratedpartcodes.length > 0) {
      const generatedPartCodes = getgeneratedpartcodes.map((part) => part.part);

      stmt_all_comp = await invtDB.query(
        "SELECT c_part_no, component_key, c_new_part_no FROM components WHERE c_type != 'S' AND c_is_enabled = 'Y' AND c_part_no NOT IN (:part) ORDER BY components.ID ASC ",
        {
          replacements: {
            part: generatedPartCodes,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt_all_comp = await invtDB.query("SELECT c_part_no, component_key, c_new_part_no FROM components WHERE c_type != 'S' AND c_is_enabled = 'Y' ORDER BY components.ID ASC ", {
        type: invtDB.QueryTypes.SELECT,
      });
    }

    //  stmt_all_comp = await invtDB.query("SELECT c_part_no, component_key, c_new_part_no FROM components WHERE c_type != 'S' AND c_is_enabled = 'Y' AND c_part_no NOT IN (SELECT part FROM mscorpre_ims_other.invt_r18 WHERE in_date = :report_date AND for_location = :for_location ) ORDER BY components.ID ASC ", {
    //   replacements: {
    //     for_location: for_location,
    //     report_date: report_date
    //   },
    //   type: invtDB.QueryTypes.SELECT,
    // });

    //console.log(stmt_all_comp);

    if (stmt_all_comp.length == 0) {
      return res.json({ status: "error", success: false, message: "Data not found" });
    }

    let locations = await invtDB.query("SELECT locations FROM location_allotted WHERE loc_all_key = :alloted_key ", {
      replacements: { alloted_key: alloted_key },
      type: invtDB.QueryTypes.SELECT,
    });

    let locations_arr = locations[0].locations.split(",");

    const comp_length = stmt_all_comp.length;
    const loc_length = locations_arr.length;

    // Get All Location Name

    let stmt_loc_name = await invtDB.query("SELECT loc_name,assigned_to ,location_key FROM location_main WHERE location_key IN (:location_key) ", {
      replacements: { location_key: locations_arr },
      type: invtDB.QueryTypes.SELECT,
    });

    for (j = 0; j < comp_length; j++) {
      let row = stmt_all_comp[j];
      let close_data = {};
      let totalBalance = 0;

      let stmt_check = await otherDB.query("SELECT * FROM `invt_r18` WHERE part = :part AND for_location = :for_location AND in_date = :in_date", {
        replacements: {
          part: row.c_part_no,
          for_location: for_location,
          in_date: report_date,
        },
        type: otherDB.QueryTypes.SELECT,
      });

      if (stmt_check.length > 0) {
        // continue;

        return res.json({ status: "error", success: false, message: "Data already exists" });
      }

      let query = "";
      for (let i = 0; i < loc_length; i++) {
        query += `SELECT COALESCE(SUM(CASE WHEN trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in = ${stmt_loc_name[i].location_key} THEN qty ELSE 0 END ), 0) - COALESCE(SUM(CASE WHEN trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out = ${stmt_loc_name[i].location_key} THEN qty ELSE 0 END ), 0) AS closing , '${stmt_loc_name[i].loc_name}' AS loc_name , '${stmt_loc_name[i].assigned_to}' AS assigned_to  FROM rm_location WHERE (DATE_FORMAT(insert_date,'%Y-%m-%d') <= '${report_date}') AND components_id = ${row.component_key} ; `;
      }

      let stmt6 = await invtDB.query(query, {
        type: invtDB.QueryTypes.SELECT,
      });

      totalBalance = 0;
      for (let i = 0; i < stmt6.length; i++) {
        close_data[stmt6[i][0].loc_name + "\n" + stmt6[i][0].assigned_to] = stmt6[i][0].closing;
        totalBalance += stmt6[i][0].closing;
      }

      let stmt_insert = await otherDB.query(
        "INSERT INTO `invt_r18` (`part`, for_location , `locations`, `in_date`, `component_key`, `total_balance`,log_insert_dt, log_insert_by) VALUES (:part, :for_location , :locations, :date, :component_key, :totalbalance, :log_in, :log_by)",
        {
          replacements: {
            part: row.c_part_no,
            for_location: for_location,
            locations: JSON.stringify(close_data),
            date: report_date,
            component_key: row.component_key,
            totalbalance: totalBalance.toFixed(2),
            log_in: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
            log_by: req?.logedINUser ?? "--",
          },
          type: otherDB.QueryTypes.INSERT,
        }
      );
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

module.exports = router;
