const express = require("express");
const router = express.Router();

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
let { invtDB, invtOakterDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");

router.get("/", [auth.isAuthorized], async (req, res) => {
  try {
    const result = await invtDB.query("SELECT * FROM `units`", { type: invtDB.QueryTypes.SELECT });

    if (result.length > 0) {
      return res.json({ status: "success", success: true, message: "", data: result });
    } else {
      return res.json({ status: "error", success: false, message: "No Uom Found!!!" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

router.post("/insert", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    uom: "required",
    description: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  let tx1, tx2;

  try {
    [tx1, tx2] = await Promise.all([
      invtDB.transaction(),
      invtOakterDB.transaction(),
    ]);

    const exists = await invtDB.query(
      "SELECT 1 FROM units WHERE units_name = :uom LIMIT 1",
      {
        replacements: { uom: req.body.uom },
        type: invtDB.QueryTypes.SELECT,
        transaction: tx1,
      }
    );

    if (exists.length > 0) {
      await Promise.all([tx1.rollback(), tx2.rollback()]);
      return res.json({
        status: "error",
        success: false,
        message: "UOM already exists",
      });
    }

    const new_key = helper.getUniqueNumber();
    const insertDate = moment().format("YYYY-MM-DD HH:mm:ss");

    const payload = {
      uom: req.body.uom,
      description: req.body.description,
      unitId: new_key,
      insertDate: insertDate,
      userId: req.logedINUser,
    };

    const sql = `
      INSERT INTO units 
      (units_name, units_details, units_id, insert_date, inserted_by)
      VALUES (:uom, :description, :unitId, :insertDate, :userId)
    `;

    await Promise.all([
      invtDB.query(sql, {
        replacements: payload,
        type: invtDB.QueryTypes.INSERT,
        transaction: tx1,
      }),

      invtOakterDB.query(sql, {
        replacements: payload,
        type: invtOakterDB.QueryTypes.INSERT,
        transaction: tx2,
      }),
    ]);

    await Promise.all([tx1.commit(), tx2.commit()]);

    return res.json({
      status: "success",
      success: true,
      message: "UOM added successfully in both databases",
    });
  } catch (error) {
    if (tx1) await tx1.rollback();
    if (tx2) await tx2.rollback();

    return helper.errorResponse(res, error);
  }
});


// UOM FETCH For SELECT 2
router.post("/uomSelect2", [auth.isAuthorized], async (req, res) => {
  try {
    const result = await invtDB.query("SELECT units_id, units_name FROM units", { type: invtDB.QueryTypes.SELECT });

    if (result.length > 0) {
      const length = result.length;
      const data = [];

      for (let i = 0; i < length; i++) {
        data.push({ id: result[i].units_id, text: result[i].units_name });
      }
      return res.json({ status: "success", success: true, message: "", data: data });
    } else {
      return res.json({ status: "error", success: false, message: "No Uom Found!!!" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// get all refurbish uoms
// router.get("/refurbish/", [auth.isAuthorized], async (req, res) => {
//   try {
//     const result = await refbDB.query("SELECT * FROM `units`", { type: refbDB.QueryTypes.SELECT });

//     if (result.length > 0) {
//       return res.json({ status: "success", success: true, message: "", data: result });
//     } else {
//       return res.json({ status: "error", success: false, message: "No Uom Found!!!" });
//     }
//   } catch (error) {
//       return helper.errorResponse(res, error);
//   }
// });

// add new refurbish uom
// router.post("/refurbish/insert", [auth.isAuthorized], async (req, res) => {
//   const validation = new Validator(req.body, {
//     uom: "required",
//     description: "required",
//   });

//   if (validation.fails()) {
//     return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
//   }

//   try {
//     const check_stmt = await refbDB.query("SELECT * FROM `units` WHERE `units_name` = ?", { replacements: [req.body.uom], type: refbDB.QueryTypes.SELECT });

//     if (check_stmt.length > 0) {
//       return res.json({ status: "error", success: false, message: "UOM already exists" });
//     } else {
//       var new_key = helper.getUniqueNumber();

//       const result = await refbDB.query("INSERT INTO `units` (`units_name`, `units_details`, `units_id`, `insert_date`, `inserted_by`) VALUES (?, ? ,?, ?, ?)", {
//         replacements: [req.body.uom, req.body.description, new_key, moment(new Date()).format("YYYY-MM-DD HH:mm:ss"), req.logedINUser],
//         type: refbDB.QueryTypes.INSERT,
//       });

//       if (result.length > 0) {
//         return res.json({ status: "success", success: true, message: "UOM added successfully", data: {} });
//       } else {
//         return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator" });
//       }
//     }
//   } catch (error) {
//       return helper.errorResponse(res, error);
//   }
// });

// // UOM FETCH For SELECT 2
// router.post("/refurbish/uomSelect2", [auth.isAuthorized], async (req, res) => {
//   try {
//     const result = await refbDB.query("SELECT units_id, units_name FROM units", { type: refbDB.QueryTypes.SELECT });

//     if (result.length > 0) {
//       const length = result.length;
//       const data = [];

//       for (let i = 0; i < length; i++) {
//         data.push({ id: result[i].units_id, text: result[i].units_name });
//       }
//       return res.json({ status: "success", success: true, message: "", data: data });
//     } else {
//       return res.json({ status: "error", success: false, message: "No Uom Found!!!" });
//     }
//   } catch (error) {
//       return helper.errorResponse(res, error);
//   }
// });
module.exports = router;
