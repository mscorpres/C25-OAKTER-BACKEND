const express = require("express");
const router = express.Router();

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
let { invtDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");

// get all location
router.get("/allLocation", [auth.isAuthorized], async (req, res) => {
  try {
    const result = await invtDB.query("SELECT * FROM location_main", {
      type: invtDB.QueryTypes.SELECT,
    });
    return res.json({ status: "success", success: true, data: result });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// Fetch Location And Convert To tree structure
router.post("/fetchLocationTree", [auth.isAuthorized], async (req, res) => {
  try {
    let result = await invtDB.query(
      "SELECT * FROM `location_main` WHERE `company_branch` = :branch",
      {
        replacements: { branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (result.length > 0) {
      tree = (function (data, root) {
        var t = {};
        data.forEach(({ location_key, loc_name, parents_id, loc_status }) => {
          Object.assign((t[location_key] = t[location_key] || {}), {
            label: location_key,
            name: loc_name,
            status: loc_status,
          });
          t[parents_id] = t[parents_id] || {};
          t[parents_id].children = t[parents_id].children || [];
          t[parents_id].children.push(t[location_key]);
        });
        return t[root].children;
      })(result, "--");

      return res.send({ status: "success", success: true, data: tree });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "location either does not exist or is not active.",
      });
    }
  } catch (error) {
    console.log(error);
    return helper.errorResponse(res, error);
  }
});

router.post("/fetchLocation", [auth.isAuthorized], async (req, res) => {
  try {
    let result;

    if (req.body.searchTerm == "" || req.body.searchTerm == undefined) {
      result = await invtDB.query(
        "SELECT location_key,loc_name FROM `location_main` WHERE `company_branch` = :branch LIMIT :limit",
        {
          replacements: {
            limit: 30,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      result = await invtDB.query(
        "SELECT location_key,loc_name FROM `location_main` WHERE (`loc_name` LIKE :search) AND `company_branch` = :branch",
        {
          replacements: {
            search: `%${req.body.searchTerm}%`,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }
    if (result.length > 0) {
      let final = [];

      result.map((item) => {
        final.push({ id: item.location_key, text: item.loc_name });
      });

      if (result.length == final.length) {
        return res.json({ data: final, status: "success", success: true });
      }
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No Data Found",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

router.post("/fetchLocationBranch", async (req, res) => {
  try {
    let result;

    if (req.body.searchTerm == "" || req.body.searchTerm == undefined) {
      result = await invtDB.query(
        "SELECT location_key,loc_name FROM `location_main` WHERE `company_branch` = :branch",
        {
          replacements: {
            branch: req.body.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      result = await invtDB.query(
        "SELECT location_key,loc_name FROM `location_main` WHERE (`loc_name` LIKE :search) AND `company_branch` = :branch",
        {
          replacements: {
            search: `%${req.body.searchTerm}%`,
            branch: req.body.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }
    if (result.length > 0) {
      let final = [];

      result.map((item) => {
        final.push({ id: item.location_key, text: item.loc_name });
      });

      if (result.length == final.length) {
        return res.json({ data: final, status: "success", success: true });
      }
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No Data Found",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// insert new location
router.post("/insertLocation", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    location_name: "required",
    location_address: "required",
    location_under: "required",
    location_type: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  } else {
    const check = await invtDB.query(
      "SELECT * FROM `location_main` WHERE `loc_name` = ? AND `company_branch` = ?",
      {
        replacements: [req.body.location_name, req.branch],
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (check.length > 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Location already exists",
      });
    }
  }

  if (req.logedINUser !== "CRN301718") {
    return res.json({
      code: 500,
      message: { msg: "You are not authorized to add location" },
      status: "error",
    });
  }

  try {
    var new_key = new Date().getTime();
    const result = await invtDB.query(
      "INSERT INTO location_main (`company_branch`,`loc_name` , `parents_id`, `loc_type`, `loc_for`, `loc_address`, `location_key`, `insert_date`, `inserted_by`, `assigned_to`) VALUES (:branch, :loc_name , :parent_id , :loc_type , :loc_for, :loc_address , :location_key , :insert_date , :inserted_by, :assigned_to)",
      {
        replacements: {
          branch: req.branch,
          loc_name: req.body.location_name,
          parent_id: req.body.location_under,
          loc_type: req.body.location_type,
          loc_for: req.body.vendor_loc == "Y" ? "JW" : "INVT",
          loc_address: req.body.location_address,
          location_key: new_key,
          insert_date: moment().format("YYYY-MM-DD HH:mm:ss"),
          inserted_by: req.logedINUser,
          assigned_to: req.body.mapping_user,
        },
        type: invtDB.QueryTypes.INSERT,
      }
    );
    return res.json({
      status: "success",
      success: true,
      message: "Location added",
      data: result,
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// get location by type
router.get("/getLocationByType", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.query, {
    location_type: "required",
  });

  if (validation.passes()) {
    try {
      const result = await invtDB.query(
        "SELECT * FROM location_main WHERE loc_type = ?",
        {
          replacements: [req.query.location_type],
          type: invtDB.QueryTypes.SELECT,
        }
      );
      return res.json({
        status: "success",
        success: true,
        message: "Successfully fetched location by type",
        data: result,
      });
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  } else {
    return res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }
});

router.get("/getAllLoc", [auth.isAuthorized], async (req, res) => {
  try {
    const result = await invtDB.query(
      "SELECT location_key ,loc_name FROM `location_main` WHERE `loc_type` = '1'",
      { type: invtDB.QueryTypes.SELECT }
    );
    return res.json({ status: "success", success: true, data: result });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// ADD NEW LOCATION ALLOTED
router.post("/location_allotted", auth.isAuthorized, async (req, res) => {
  let validation = new Validator(req.body, {
    module_name: "required",
    locations: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  try {
    let locationstr = req.body.locations.toString();

    let stmt = await invtDB.query(
      "SELECT * FROM `location_allotted` WHERE (`for_module` = :module_name)",
      {
        replacements: { module_name: req.body.module_name },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      return res.json({
        status: "error",
        success: false,
        message: "seems like the location is already registered with us",
      });
    } else {
      let insert_stmt = await invtDB.query(
        "INSERT INTO `location_allotted` (`for_module`,`module_desc`,`loc_all_key`,`locations`) VALUES (:module_name,:description,:loc_all_key,:locations)",
        {
          replacements: {
            module_name: req.body.module_name,
            description: req.body.module_description,
            loc_all_key: helper.getUniqueNumber(),
            locations: locationstr,
          },
          type: invtDB.QueryTypes.INSERT,
        }
      );

      if (insert_stmt.length > 0) {
        return res.json({
          status: "success",
          success: true,
          message: "Added Success...",
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "Something went wrong",
        });
      }
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// FETCH LOCATION ALLOTED LIST
router.get("/fetch_loc_all", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query(
      "SELECT `for_module` AS module_name, module_desc AS module_description, loc_all_key FROM `location_allotted`",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      return res.json({ status: "success", success: true, data: stmt });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No data found",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// FETCH LOCATION ALLOTED BY KEY
router.post(
  "/fetch_location_all_update",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(req.body, {
      key: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    try {
      let stmt = await invtDB.query(
        "SELECT * FROM `location_allotted` WHERE `loc_all_key`= :key",
        {
          replacements: { key: req.body.key },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        return res.json({ status: "success", success: true, data: stmt });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "No data found",
        });
      }
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

// UPDATE LOCATION ALLOTTED
router.post(
  "/location_allotted_update",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(req.body, {
      key: "required",
      module_name: "required",
      locations: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    try {
      let locationsstr = req.body.locations.toString();
      let stmt = await invtDB.query(
        "UPDATE `location_allotted` SET `for_module` = :module_name, `module_desc` = :description, `locations` = :locations WHERE `loc_all_key` = :loc_all_key",
        {
          replacements: {
            loc_all_key: req.body.key,
            module_name: req.body.module_name,
            description: req.body.module_description,
            locations: locationsstr,
          },
          type: invtDB.QueryTypes.UPDATE,
        }
      );

      if (stmt.length > 0) {
        return res.json({
          status: "success",
          success: true,
          message: "Update success....",
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "Update fails....",
        });
      }
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

// Fetch Refurbish Location And Convert To tree structure
// router.post("/refurbish/fetchLocationTree", [auth.isAuthorized], async (req, res) => {
//   try {
//     let result = await refbDB.query("SELECT * FROM `location_main` WHERE `company_branch` = :branch", {
//       replacements: { branch: req.branch },
//       type: refbDB.QueryTypes.SELECT,
//     });
//     if (result.length > 0) {
//       tree = (function (data, root) {
//         var t = {};
//         data.forEach(({ location_key, loc_name, parents_id }) => {
//           Object.assign((t[location_key] = t[location_key] || {}), { label: location_key, name: loc_name });
//           t[parents_id] = t[parents_id] || {};
//           t[parents_id].children = t[parents_id].children || [];
//           t[parents_id].children.push(t[location_key]);
//         });
//         return t[root].children;
//       })(result, "--");

//       return res.json({ status: "success", success: true, data: tree });
//     } else {
//       return res.json({ status: "error", success: false, message: "No Data Found" });
//     }
//   } catch (error) {
//       return helper.errorResponse(res, error);
//   }
// });

// INSERT NEW REFURBISH LOCATION
// router.post("/refurbish/insertLocation", [auth.isAuthorized], async (req, res) => {
//   const validation = new Validator(req.body, {
//     location_name: "required",
//     location_address: "required",
//     location_under: "required",
//     location_type: "required",
//   });

//   if (validation.fails()) {
//     return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
//   } else {
//     const check = await refbDB.query("SELECT * FROM `location_main` WHERE `loc_name` = ? AND `company_branch` = ?", { replacements: [req.body.location_name, req.branch], type: refbDB.QueryTypes.SELECT });
//     if (check.length > 0) {
//       return res.json({ status: "error", success: false, message: "Location already exists" });
//     }
//   }

//   try {
//     var new_key = new Date().getTime();
//     const result = await refbDB.query("INSERT INTO location_main (`company_branch`,`loc_name` , `parents_id`, `loc_type`, `loc_for`, `loc_address`, `location_key`, `insert_date`, `inserted_by`) VALUES (:branch, :loc_name , :parent_id , :loc_type , :loc_for, :loc_address , :location_key , :insert_date , :inserted_by)", {
//       replacements: {
//         branch: req.branch,
//         loc_name: req.body.location_name,
//         parent_id: req.body.location_under,
//         loc_type: req.body.location_type,
//         loc_for: req.body.vendor_loc == "Y" ? "JW" : "INVT",
//         loc_address: req.body.location_address,
//         location_key: new_key,
//         insert_date: moment().format("YYYY-MM-DD HH:mm:ss"),
//         inserted_by: req.logedINUser,
//       },
//       type: refbDB.QueryTypes.INSERT,
//     });
//     return res.json({ status: "success", success: true, message: "Location added", data: result });
//   } catch (error) {
//       return helper.errorResponse(res, error);
//   }
// });

// //GET REFURBISH LOCATION
// router.post("/refurbish/fetchLocation", [auth.isAuthorized], async (req, res) => {
//   try {
//     let result;

//     if (req.body.searchTerm == "" || req.body.searchTerm == undefined) {
//       result = await refbDB.query("SELECT location_key,loc_name FROM `location_main` WHERE `company_branch` = :branch LIMIT :limit", {
//         replacements: {
//           limit: 30,
//           branch: req.branch,
//         },
//         type: refbDB.QueryTypes.SELECT,
//       });
//     } else {
//       result = await refbDB.query("SELECT location_key,loc_name FROM `location_main` WHERE (`loc_name` LIKE :search) AND `company_branch` = :branch", {
//         replacements: {
//           search: `%${req.body.searchTerm}%`,
//           branch: req.branch,
//         },
//         type: refbDB.QueryTypes.SELECT,
//       });
//     }
//     if (result.length > 0) {
//       let final = [];

//       result.map((item) => {
//         final.push({ id: item.location_key, text: item.loc_name });
//       });

//       if (result.length == final.length) {
//         return res.json({ data: final, status: "success", success: true });
//       }
//     } else {
//       return res.json({ status: "error", success: false, message: "No Data Found" });
//     }
//   } catch (error) {
//       return helper.errorResponse(res, error);
//   }
// });

// GET LOCTAION STATUS
router.post("/fetchLocationStatus", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      location_key: "required",
    });

    if (valid.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(valid),
      });
    }

    let result = await invtDB.query(
      "SELECT loc_status as status , loc_name as name , location_key  FROM location_main WHERE location_key = :location_key",
      {
        replacements: { location_key: req.body.location_key },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (result.length > 0) {
      return res.json({ status: "success", success: true, data: result });
    } else {
      return res.json({
        status: "error",
        success: false,
        message:
          "Internal Error!!! If this condition persists, contact your system administrator",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// CHANGE LOCATION STATUS
router.put("/changeLocationStatus", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      location_key: "required",
      status: "required",
    });

    if (valid.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(valid),
      });
    }

    let result = await invtDB.query(
      "UPDATE location_main SET loc_status = :status WHERE location_key = :location_key",
      {
        replacements: {
          location_key: req.body.location_key,
          status: req.body.status,
        },
        type: invtDB.QueryTypes.UPDATE,
      }
    );

    if (result.length > 0) {
      return res.json({
        status: "success",
        success: true,
        message: "Status changed successfully",
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message:
          "internal error!!! If this condition persists, contact your system administrator",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// UPDATE LOCATION COST CENTER
router.post("/updatLocationCC", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      location: "required",
      costcenter: "required",
    });

    if (valid.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(valid),
      });
    }

    let result = await invtDB.query(
      "UPDATE location_main SET loc_costcenter = :costcenter WHERE location_key = :location_key",
      {
        replacements: {
          location_key: req.body.location,
          costcenter: req.body.costcenter,
        },
        type: invtDB.QueryTypes.UPDATE,
      }
    );

    if (result.length > 0) {
      return res.json({
        status: "success",
        success: true,
        message: "Cost Center Updated",
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "an error occured while updating cost center",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

module.exports = router;
