let { invtDB, tallyDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();

const Validator = require("validatorjs");
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

router.post("/update_transaction_data", [auth.isAuthorized], async (req, res) => {
  try {
    const stockData = await invtDB.query("SELECT DISTINCT loc_out FROM rm_location", {
      type: invtDB.QueryTypes.SELECT,
    });

    await invtDB.query(`
    UPDATE rm_location AS rcs
    INNER JOIN location_main AS lm ON rcs.loc_out = lm.location_key
    SET rcs.parent_locout = lm.parents_id
    WHERE lm.loc_status = 'active'
      `);

    return res.json({
      status: "success", success: true,

      message: "Parent loc_out updated successfully",
    });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

router.post("/get_closing_stock", [auth.isAuthorized], async (req, res) => {
  try {
      const validation = new Validator(req.body, {
          date: "required",
          for_location: "required",
      });

      if (validation.fails()) {
          return res.json({ message: "Something is missing in the form field", data: validation.errors.all(), status: "error", success: false });
      }

      const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      const alloted_key = req.body.for_location === "SF" ? 202012173850 : req.body.for_location === "RM" ? 202012172232 : null;

      if (!alloted_key) {
          return res.json({ status: "error", success: false, message: "Invalid location" });
      }

      const stmt_all_comp = await invtDB.query(`
          SELECT
              c.c_part_no,
              c.component_key,
              COALESCE(SUM(CASE WHEN cs.trans_type IN ('INWARD', 'TRANSFER', 'ISSUE', 'JOBWORK', 'REJECTION') AND cs.parent_locin = :location AND DATE_FORMAT(cs.insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 THEN cs.qty ELSE 0 END), 0) AS inward,
              COALESCE(SUM(CASE WHEN cs.trans_type IN ('CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND cs.parent_locout = :location AND DATE_FORMAT(cs.insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 THEN cs.qty ELSE 0 END), 0) AS outward,
              COALESCE(SUM(CASE WHEN cs.trans_type IN ('INWARD', 'TRANSFER', 'ISSUE', 'JOBWORK', 'REJECTION') AND cs.parent_locin = :location AND DATE_FORMAT(cs.insert_date, '%Y-%m-%d') < :date1 THEN cs.qty ELSE 0 END), 0) AS totalOB_in,
              COALESCE(SUM(CASE WHEN cs.trans_type IN ('CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND cs.parent_locout = :location AND DATE_FORMAT(cs.insert_date, '%Y-%m-%d') < :date1 THEN cs.qty ELSE 0 END), 0) AS totalOB_out
          FROM
              components c
          LEFT JOIN
              rm_location cs ON c.component_key = cs.components_id
          WHERE
              c.c_type != 'S' AND c.c_is_enabled = 'Y'
          GROUP BY
              c.component_key
          ORDER BY
              c.ID ASC LIMIT 100`,
          {
              replacements: {
                  location: alloted_key,
                  date1: fromdate,
                  date2: todate
              },
              type: invtDB.QueryTypes.SELECT,
          });

      const data = stmt_all_comp.map(row => {
          const { inward, outward, totalOB_in, totalOB_out } = row;
          const inward_all_qty = helper.number(inward || 0);
          const outward_all_qty = helper.number(outward || 0);
          const opening_balance = helper.number((totalOB_in || 0) - (totalOB_out || 0));
          const closing_balance = helper.number(opening_balance + (inward_all_qty - outward_all_qty));

          return {
              component: row.c_part_no,
              totalOpeningbalance: opening_balance,
              totalIn: inward_all_qty,
              totalOut: outward_all_qty,
              totalClosingbalance: closing_balance,
          };
      });

      return res.json({
          status: "success", success: true,
          code: "200",
          response: { data },
      });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

//GET CLOSING STOCK 2
router.post("/get_closing_stock1", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      date: "required",
    });

    if (validation.fails()) {
      return res.json({ message: "Something is missing in the form field", data: validation.errors.all(), status: "error", success: false });
    }

    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdate = moment(date[0], "DD-MM-YYYY").toDate();
    const todate = moment(date[1], "DD-MM-YYYY").toDate();

    const result = [];

    for (let currentDate = new Date(fromdate); currentDate <= todate; currentDate.setDate(currentDate.getDate() + 1)) {
      const formattedDate = moment(currentDate).format("YYYY-MM-DD");

      const closing_stock = await invtDB.query(
        `SELECT 
           part_code,
           component_key,
           total_opening,
           total_in,
           total_out,
           total_closing
         FROM 
           closing_stock
         WHERE 
           DATE_FORMAT(insert_dt, '%Y-%m-%d') = :current_date
         `,
        {
          replacements: {
            current_date: formattedDate,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      result.push({
        [formattedDate]: closing_stock.map(stock => ({
          component: stock.part_code,
          opening_balance: stock.total_opening,
          inward: stock.total_in,
          outward: stock.total_out,
          closing_balance: stock.total_closing
        }))
      });
    }

    return res.json({
      status: "success", success: true,

      message: "Closing stock fetched successfully.",
      data: result,
    });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});


router.post("/save_closing_stock", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      date: "required",
    });

    if (validation.fails()) {
      return res.json({ message: "Something is missing in the form field", data: validation.errors.all(), status: "error", success: false });
    }

    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdate = moment(date[0], "DD-MM-YYYY").toDate();
    const todate = moment(date[1], "DD-MM-YYYY").toDate();

    const stmt_all_comp = await invtDB.query("SELECT `c_part_no`, `component_key` FROM `components` WHERE `c_type` != 'S' AND `c_is_enabled` = 'Y'", {
      type: invtDB.QueryTypes.SELECT,
    });
      
    if (stmt_all_comp.length === 0) {
      return res.json({ status: "error", success: false, message: "Data not found" });
    }

    const locations = ["202012172232", "202012173850"]; 

    for (let currentDate = new Date(fromdate); currentDate <= todate; currentDate.setDate(currentDate.getDate() + 1)) {
      const formattedDate = moment(currentDate).format("YYYY-MM-DD");

      for (let j = 0; j < locations.length; j++) {
        const location = locations[j];
        const stmt = await invtDB.query(
          `SELECT 
            components_id,
            COALESCE(SUM(CASE WHEN trans_type IN ('INWARD','ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND parent_locin = :location AND DATE_FORMAT(insert_date, '%Y-%m-%d') = :date THEN qty ELSE 0 END), 0) AS inward,
            COALESCE(SUM(CASE WHEN trans_type IN ('CONSUMPTION','ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND parent_locout = :location AND DATE_FORMAT(insert_date, '%Y-%m-%d') = :date THEN qty ELSE 0 END), 0) AS outward,
            COALESCE(SUM(CASE WHEN trans_type IN ('INWARD','ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND parent_locin = :location AND DATE_FORMAT(insert_date, '%Y-%m-%d') < :date THEN qty ELSE 0 END), 0) AS totalOB_in,
            COALESCE(SUM(CASE WHEN trans_type IN ('CONSUMPTION','ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND parent_locout = :location AND DATE_FORMAT(insert_date, '%Y-%m-%d') < :date THEN qty ELSE 0 END), 0) AS totalOB_out
          FROM rm_location 
          WHERE components_id IN (SELECT component_key FROM components)
          GROUP BY components_id`,
          {
            replacements: {
              date: formattedDate,
              location: location,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        for (let i = 0; i < stmt.length; i++) {
          const row = stmt[i];
          const component_key = row.components_id;
          const inward_all_qty = helper.number(row.inward);
          const outward_all_qty = helper.number(row.outward);
          const opening_balance = helper.number(row.totalOB_in - row.totalOB_out);
          const closing_balance = helper.number(opening_balance + (inward_all_qty - outward_all_qty));
          
          let parent_location;
          if (location === "202012172232") {
            parent_location = "RM";
          } else if (location === "202012173850") {
            parent_location = "SF";
          }

          // Get part_no. from components_id 
          const part_no = await invtDB.query("SELECT c_part_no FROM components WHERE component_key = :component_id ORDER BY ID ASC", {
            replacements: {
              component_id: component_key
            },
            type: invtDB.QueryTypes.SELECT
          });

          const part = part_no[0].c_part_no;

          await invtDB.query(
            `INSERT INTO closing_stock (part_code, component_key, location, total_opening, total_in, total_out, total_closing, insert_dt, insert_by)
            VALUES (:part_code, :component_key, :location, :opening, :inward, :outward, :closing, :date, :user)`,
            {
              replacements: {
                part_code: part,
                component_key: component_key,
                location: parent_location,
                opening: opening_balance,
                inward: inward_all_qty,
                outward: outward_all_qty,
                closing: closing_balance,
                date: formattedDate,
                user: req.logedINUser,
              },
              type: invtDB.QueryTypes.INSERT,
            }
          );
        }
      }
    }
  
    return res.json({
      status: "success", success: true,
      code: "200",
      message: "closing stock inserted",
    });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});



//SAVE CLOSING STOCK 2
router.post("/update_closing_stock", [auth.isAuthorized], async (req, res) => {
  try {

  // UPDATE CLOSING STOCK
    let check = await invtDB.query("SELECT insert_date, components_id FROM rm_closing_stock WHERE qty_update = 'YES'", {
      type: invtDB.QueryTypes.SELECT,
    });

    if (check.length > 0) {

     for (let i=0; i<check.length; i++){

      const fromdate = check[i].insert_date;
      
      const todate = new Date();
      
      for (let currentDate = new Date(fromdate); currentDate <= todate; currentDate.setDate(currentDate.getDate() + 1)) {
        const formattedDate = moment(currentDate).format("YYYY-MM-DD");

      //calculate quantity
      let stmt6 = await invtDB.query(
        `SELECT COALESCE(SUM(CASE WHEN trans_type IN ('INWARD', 'TRANSFER', 'ISSUE', 'JOBWORK', 'REJECTION') AND DATE_FORMAT(insert_date, '%Y-%m-%d') = :date THEN qty ELSE 0 END), 0) AS inward,
                 COALESCE(SUM(CASE WHEN trans_type IN ('CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND DATE_FORMAT(insert_date, '%Y-%m-%d') = :date THEN qty ELSE 0 END), 0) AS outward,
                 COALESCE(SUM(CASE WHEN trans_type IN ('INWARD', 'TRANSFER', 'ISSUE', 'JOBWORK', 'REJECTION') AND DATE_FORMAT(insert_date, '%Y-%m-%d') < :date THEN qty ELSE 0 END), 0) AS totalOB_in,
                 COALESCE(SUM(CASE WHEN trans_type IN ('CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND DATE_FORMAT(insert_date, '%Y-%m-%d') < :date THEN qty ELSE 0 END), 0) AS totalOB_out
          FROM rm_closing_stock WHERE components_id = :component ` 
        ,
        {
          replacements: {
            component: check[i].components_id,
            date: formattedDate,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      const inward_qty = helper.number(stmt6[0].inward || 0);
      const outward_qty = helper.number(stmt6[0].outward || 0);
      const opening_qty = helper.number((stmt6[0].totalOB_in || 0) - (stmt6[0].totalOB_out || 0));
      const closing_qty = helper.number(opening_qty + (inward_qty - outward_qty));

      await invtDB.query("UPDATE closing_stock SET total_opening = :opening, total_in = :inward, total_out = :outward, total_closing = :closing WHERE component_key = :component AND insert_dt = :date", {
        replacements: {
          component: check[i].components_id,
          date: formattedDate,
          opening: opening_qty,
          inward: inward_qty,
          outward: outward_qty,
          closing: closing_qty,
        },
        type: invtDB.QueryTypes.UPDATE,
      });
    }
  }
  //END UPDATE CLOSING STOCK

    return res.json({
      status: "success", success: true,
      code: "200",
      message: "closing stock updated",
    });
  } 
}
  catch (error) {
      return helper.errorResponse(res, error);
  }
});


// Get closing stock of all components
router.post("/save_closing_stock_cif", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      date: "required",
    });

    if (validation.fails()) {
      return res.json({ status: "error", success: false, message: "Something is missing in the form field" });
    }

    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    const stmt_all_comp = await invtDB.query("SELECT `c_part_no`, `component_key` FROM `components` WHERE `c_type` != 'S' AND `c_is_enabled` = 'Y'", {
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt_all_comp.length === 0) {
      return res.json({ status: "error", success: false, message: "Data not found" });
    }

    const promises = [];

    const data = [];
      promises.push(
        (async () => {
          const stmt = await invtDB.query(
            `SELECT 
              components_id,
              COALESCE(SUM(CASE WHEN trans_type = 'INWARD' AND in_module IN ('--','IN-PO','IN-MIN') AND vendor_type = 'v01' AND (DATE_FORMAT(insert_date, '%Y-%m-%d') BETWEEN :datefrom AND :dateto) THEN qty ELSE 0 END), 0) AS inward,
              COALESCE(SUM(CASE WHEN trans_type IN ('CONSUMPTION','REJECTION','JOBWORK') AND (DATE_FORMAT(insert_date, '%Y-%m-%d') BETWEEN :datefrom AND :dateto) THEN qty ELSE 0 END), 0) AS outward,
			  COALESCE(SUM(CASE WHEN trans_type = 'ISSUE' AND loc_in IN ('20210921120435', '20211028124102', '20220715174205', '1690460862638') AND (DATE_FORMAT(insert_date, '%Y-%m-%d') BETWEEN :datefrom AND :dateto) THEN qty ELSE 0 END), 0) AS consumption,
              COALESCE(SUM(CASE WHEN trans_type = 'INWARD' AND in_module IN ('--','IN-MIN','IN-JWI') AND vendor_type IN ('p01','j01') AND (DATE_FORMAT(insert_date, '%Y-%m-%d') BETWEEN :datefrom AND :dateto) THEN qty ELSE 0 END), 0) AS otherinward,
              COALESCE(SUM(CASE WHEN trans_type = 'INWARD' AND in_module IN ('--','IN-PO','IN-MIN') AND vendor_type = 'v01' AND DATE_FORMAT(insert_date, '%Y-%m-%d') < :datefrom THEN qty ELSE 0 END), 0) AS totalOB_in,
              COALESCE(SUM(CASE WHEN trans_type IN ('CONSUMPTION','REJECTION','JOBWORK') AND DATE_FORMAT(insert_date, '%Y-%m-%d') < :datefrom THEN qty ELSE 0 END), 0) AS totalOB_out,
			  COALESCE(SUM(CASE WHEN trans_type = 'ISSUE' AND loc_in IN ('20210921120435', '20211028124102', '20220715174205', '1690460862638') AND DATE_FORMAT(insert_date, '%Y-%m-%d') < :datefrom THEN qty ELSE 0 END), 0) AS OB_consumption,
              COALESCE(SUM(CASE WHEN trans_type = 'INWARD' AND in_module IN ('--','IN-MIN','IN-JWI') AND vendor_type IN ('p01','j01') AND DATE_FORMAT(insert_date, '%Y-%m-%d') < :datefrom THEN qty ELSE 0 END), 0) AS OB_otherinward
            FROM rm_location rm
            WHERE components_id IN (SELECT component_key FROM components)
            GROUP BY components_id`,
            {
              replacements: {
                datefrom: fromdate,
                dateto: todate,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          const queries = stmt.map(async (row) => {
            const component_key = row.components_id;
            const inward_all_qty = helper.number(row.inward);
            const outward_all_qty = helper.number(row.outward) + helper.number(row.consumption);
            const otherinward_all_qty = helper.number(row.otherinward);
            const opening_balance = helper.number(row.totalOB_in - (row.totalOB_out + row.OB_consumption) + row.OB_otherinward);
            const closing_balance = helper.number(opening_balance + (inward_all_qty - (outward_all_qty)) + otherinward_all_qty);

            const part_no = await invtDB.query("SELECT c_part_no, c_name, c_new_part_no FROM components WHERE component_key = :component_id ORDER BY ID ASC", {
              replacements: {
                component_id: component_key
              },
              type: invtDB.QueryTypes.SELECT
            });

            const part_code = part_no[0].c_part_no;
            const part_name = part_no[0].c_name;
			const sec_part_code = part_no[0].c_new_part_no;

            const getVbtStock = await tallyDB.query("SELECT COALESCE(SUM(vbt_inqty), 0) AS vbt_inqty FROM tally_vbt WHERE part_code = :partCode AND (DATE_FORMAT(effective_date, '%Y-%m-%d') BETWEEN :datefrom AND :dateto) AND vbt_type != 'VBT06' AND vbt_debit_key = '--' GROUP BY part_code", {
              replacements: {
                partCode: component_key,
                datefrom: fromdate,
                dateto: todate,
              },
              type: tallyDB.QueryTypes.SELECT
            });
  
            const getDNStock = await tallyDB.query("SELECT COALESCE(SUM(vbt_inqty), 0) AS dnQty FROM tally_vbt WHERE part_code = :partCode AND (DATE_FORMAT(effective_date, '%Y-%m-%d') BETWEEN :datefrom AND :dateto) AND vbt_type != 'VBT06' AND vbt_debit_key != '--' GROUP BY part_code", {
              replacements: {
                partCode: component_key,
                datefrom: fromdate,
                dateto: todate,
              },
              type: tallyDB.QueryTypes.SELECT
            });

            data.push ({
              part_code: part_code,
			  sec_part_code: sec_part_code,
              part_name: part_name,
              part_key: component_key,
              total_opening: opening_balance,
              total_in: inward_all_qty,
              other_in: otherinward_all_qty,
              total_out: outward_all_qty,
              total_closing: closing_balance,
              vbt: (getVbtStock[0]?.vbt_inqty ?? 0) - (getDNStock[0]?.dnQty ?? 0),
              //dn: getDNStock[0]?.dnQty ?? 0
            });
          });
          await Promise.all(queries);
        })()
      );

    await Promise.all(promises);

    return res.json({
      status: "success", success: true,
      data: data,
    });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});


module.exports = router;
