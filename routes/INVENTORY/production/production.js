const express = require("express");
const router = express.Router();


let { invtDB } = require("../../../config/db/connection");
const multer = require("multer");
const xlsx = require("xlsx");
const path = require("path");
const fs = require("fs");
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


const Validator = require("validatorjs");

const storageWoBomBulk = multer.diskStorage({
  destination: "tmp",
  filename: function (req, file, cb) {
    cb(null, "WOBOM" + Date.now() + Math.floor(Math.random() * 900 + 100) + path.extname(file.originalname));
  },
});
const uploadWoBomBulk = multer({ storage: storageWoBomBulk });

router.post("/fetchLocationForWitoutBom", [auth.isAuthorized], async (req, res) => {
  let stmt1 = await invtDB.query("SELECT locations FROM `location_allotted` WHERE  `loc_all_key` = :location_key", {
    replacements: { location_key: "20220212161608" },
    type: invtDB.QueryTypes.SELECT,
  });

  // string to array
  let loc_ids = stmt1[0].locations.split(",");
  let locations = [];
  for (let i = 0; i < loc_ids.length; i++) {
    let stmt2 = await invtDB.query("SELECT location_key,loc_name FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ", {
      replacements: { location_defined: loc_ids[i] },
      type: invtDB.QueryTypes.SELECT,
    });

    stmt2.forEach((element) => {
      locations.push({ id: element.location_key, text: element.loc_name });
    });

    if (i == loc_ids.length - 1) {
      return res.json({ status: "success", success: true, data: locations });
    }
  }
});

router.post("/fetchLocationDetail", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    location_key: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "Please select valid location." });
  }

  try {
    let stmt1 = await invtDB.query("SELECT `loc_address` FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE'", {
      replacements: { location: req.body.location_key },
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt1.length == 0) {
      return res.json({ status: "error", success: false, message: "Please select valid location." });
    } else {
      return res.json({ status: "success", success: true, data: stmt1[0].loc_address });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// Get Product Details
router.post("/fetchProductDetails", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    component: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "Please select valid component." });
  }

  try {
    let stmt1 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `totalCreditComponent` FROM rm_location WHERE components_id = :component AND (`trans_type` = 'INWARD' OR `trans_type` = 'TRANSFER')", {
      replacements: { component: req.body.component },
      type: invtDB.QueryTypes.SELECT,
    });

    let credit;
    if (stmt1.length > 0) {
      credit = helper.number(stmt1[0].totalCreditComponent);
    } else {
      credit = 0;
    }

    let stmt2 = await invtDB.query("SELECT COALESCE(SUM(`qty` + `other_qty`), 0) AS `totalDebitComponent` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` != 'CONSUMPTION' AND `trans_type` != 'INWARD' AND `trans_type` != 'CANCELLED')", {
      replacements: { component: req.body.component },
      type: invtDB.QueryTypes.SELECT,
    });

    let debit;
    if (stmt2.length > 0) {
      debit = helper.number(stmt2[0].totalDebitComponent);
    } else {
      debit = 0;
    }

    let stmt3 = await invtDB.query("SELECT * FROM `components` LEFT JOIN `units`ON `components`.`c_uom` = `units`.`units_id` WHERE `components`.`component_key` = :key AND `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y'", {
      replacements: { key: req.body.component },
      type: invtDB.QueryTypes.SELECT,
    });
    let data = [];
    if (stmt3.length > 0) {
      data.push({
        name: stmt3[0].c_name,
        unit: stmt3[0].units_name,
        leftQTY: helper.number(credit - debit),
        key: stmt3[0].component_key,
        identity: stmt3[0].ID,
      });

      let validation = new Validator(data[0], {
        name: "required",
        unit: "required",
        identity: "required",
      });

      if (validation.fails()) {
        return res.json({ status: "error", success: false, message: "We couldn't recognize the part." });
      } else {
        return res.json({ status: "success", success: true, data: data, message: "Success." });
      }
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// create without bom
router.post("/createWithoutBom", [auth.isAuthorized, auth.checkDuplicacy_db], async (req, res) => {
  let validation = new Validator(req.body, {
    location: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "Something you missing in form field to supply.", data: validation.errors.all() });
  }

  const toFindDublicates = (arry) => arry.filter((item, index) => arry.indexOf(item) !== index);
  const dubliEle = toFindDublicates(req.body.component);
  if (dubliEle.length > 0) {
    return res.json({ status: "error", success: false, message: "You have entered the same component twice in a single request." });
  }

  const t = await invtDB.transaction();

  try {
    let stmt1 = await invtDB.query("SELECT `ID` FROM `material_request` ORDER BY `ID` DESC LIMIT 1", {
      type: invtDB.QueryTypes.SELECT,
    });

    let transactionID = helper.getUniqueNumber();
    if (stmt1.length == 0) {
      transactionID += 1;
    }
    if (stmt1.length > 0) {
      transactionID += stmt1[0].ID + 1;
    }

    let component_length = req.body.component.length;
    for (let i = 0; i < component_length; i++) {
      if (helper.number(req.body.qty[i]) > 0) {
        let item_validation = new Validator({ component: req.body.component[i] }, { component: "required" });
        if (item_validation.fails()) {
          await t.rollback();
          return res.json({ status: "error", success: false, message: `Select component on line number: ${i + 1}` });
        }

        let pic_loc_validation = new Validator({ pic_loc: req.body.pic_loc[i] }, { pic_loc: "required" });
        if (pic_loc_validation.fails()) {
          await t.rollback();
          return res.json({ status: "error", success: false, message: `Select pick location on line number: ${i + 1}` });
        }

        let qty_validation = new Validator({ qty: parseInt(req.body.qty[i]) }, { qty: "required" });
        if (qty_validation.fails()) {
          await t.rollback();
          return res.json({ status: "error", success: false, message: `Quantity should not be less than zero on line number: ${i + 1}` });
        }

        // RM DB VALIDATON
        let stmt2 = await invtDB.query("SELECT * FROM `components` WHERE `component_key` = :component_key", {
          replacements: { component_key: req.body.component[i] },
          type: invtDB.QueryTypes.SELECT,
        });

        if (stmt2.length > 0) {
          if (stmt2[0].c_is_enabled == "N") {
            await t.rollback();
            return res.json({ status: "error", success: false, message: "Component partcode [" + stmt2[0].c_part_no + "] - [" + stmt2[0].c_name + "] cannot be executed because it has been disabled for transaction." });
          } else if (stmt2[0].c_type == "S") {
            await t.rollback();
            return res.json({ status: "error", success: false, message: "Component partcode [" + stmt2[0].c_part_no + "] - [" + stmt2[0].c_name + "] cannot be executed because it is a service component." });
          }
        }
        //End component database validation

        let stmt3 = await invtDB.query("INSERT INTO `material_request` (`company_branch`,`transaction_type`,`comment`,`components_key`,`req_debit`,`req_remark`,`insert_date`,`inserted_by`,`transaction_id`,`location_id`,`insert_full_date`)VALUES (:branch,:credittype,:comment,:component,:debit,:remark,:insertdate,:by,:key,:location,:fulldate)", {
          replacements: {
            branch: req.branch,
            credittype: "O",
            comment: req.body.comment,
            component: req.body.component[i],
            debit: req.body.qty[i],
            remark: req.body.remark[i],
            insertdate: moment().format("YYYY-MM-DD HH:mm:ss"),
            by: req.logedINUser,
            key: transactionID,
            location: req.body.location,
            fulldate: moment().format("YYYY-MM-DD HH:mm:ss"),
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: t,
        });
      }
    } // ENd Loop
    await t.commit();
    return res.json({ status: "success", success: true, message: "Material Request Sent with: Ref ID #" + transactionID });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// Fetch product details in bomrequest
router.post("/getProductDetail", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    p_key: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "Something you missing in form field to supply.", data: validation.errors.all() });
  }

  try {
    let stmt1 = await invtDB.query("SELECT * FROM `products` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` WHERE `product_key` = :p_key", {
      replacements: { p_key: req.body.p_key },
      type: invtDB.QueryTypes.SELECT,
    });

    let data = [];
    if (stmt1.length > 0) {
      let stmt2 = await invtDB.query("SELECT * FROM `bom_recipe` WHERE (`bom_product_sku` = :product1 OR `bom_product_sku` = :product2) AND bom_status = 'ENABLE'", {
        replacements: { product1: stmt1[0].p_sku, product2: stmt1[0].m_sku },
        type: invtDB.QueryTypes.SELECT,
      });

      stmt2.map((item) => {
        data.push({ id: item.subject_id, text: item.subject_name });

        if (stmt2.length == data.length) {

          return res.json({ status: "success", success: true, message: "Success.", data: { sku: stmt1[0].p_sku, productname: stmt1[0].p_name, productuom: stmt1[0].units_name }, boms: data });
        }
      });
    } else {
      return res.json({ status: "error", success: false, message: "No data found." });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});


// Fetch Component In WithBom
router.post("/FetchComponentWithBom", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(
    {
      bom: req.body.bom,
      mfgQty: parseInt(req.body.mfgQty),
      shiftLocation: req.body.shiftLocation,
      pic_loc: req.body.pic_loc
    },
    {
      bom: "required|not_in:0",
      mfgQty: "required|min:1",
      pic_loc: "required",
      shiftLocation: "required",
    }
  );

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "Something you missing in form field to supply.", data: validation.errors.all() });
  }

  try {
    let stmt = await invtDB.query(
      "SELECT * FROM bom_recipe LEFT JOIN bom_quantity ON bom_recipe.subject_id = bom_quantity.subject_under LEFT JOIN components ON bom_quantity.component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE bom_quantity.bom_status = 'A' AND bom_recipe.subject_id = :bom AND components.c_type = 'R' AND components.c_is_enabled = 'Y' AND bom_recipe.bom_status = 'ENABLE' GROUP BY components.component_key ORDER BY components.c_name ASC",
      {
        replacements: { bom: req.body.bom },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let data = [];

      // let location_key = "";
      // // A21 SF LOCATION
      // if (req.branch == "BRALWR36") {
      //   location_key = "202382013116805";
      // }
      // // B29 SF LOCATION
      // if (req.branch == "BRMSC029") {
      //   location_key = "202382013138194";
      // }

      // // SHOP FLOOR LOCATION
      // let stmt_get_sf21 = await invtDB.query("SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key", {
      //   replacements: { location_key: location_key },
      //   type: invtDB.QueryTypes.SELECT,
      // });

      // let sf21_locations = [];
      // if (stmt_get_sf21.length > 0) {
      //   for (let loc_i = 0; loc_i < stmt_get_sf21.length; loc_i++) {
      //     sf21_locations = stmt_get_sf21[loc_i].locations.split(",");
      //   }
      // } else {
      //   return res.json({ status: "error", success: false, message: "Branch Location Not Found, contact to administrator" });
      // }
      for (let i = 0; i < stmt.length; i++) {
        let stmt1 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `totalCreditComponent` FROM rm_location WHERE components_id = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_in` = :pic_loc", {
          replacements: { component: stmt[i].component_key, pic_loc: req.body.pic_loc },
          type: invtDB.QueryTypes.SELECT,
        });
        let credit;
        if (stmt1.length > 0) {
          credit = stmt1[0].totalCreditComponent;
        } else {
          credit = 0;
        }

        let stmt2 = await invtDB.query("SELECT COALESCE(SUM(`qty` + `other_qty`), 0) AS `totalDebitComponent` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_out` = :pic_loc", {
          replacements: { component: stmt[i].component_key, pic_loc: req.body.pic_loc },
          type: invtDB.QueryTypes.SELECT,
        });

        let debit;
        if (stmt2.length > 0) {
          debit = stmt2[0].totalDebitComponent;
        } else {
          debit = 0;
        }

        let stmt_sf_stock = await invtDB.query(
          "SELECT COALESCE( SUM( CASE WHEN trans_type IN('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND loc_in = :shiftLocation THEN qty ELSE 0 END ), 0 ) AS sf_inward , COALESCE( SUM( CASE WHEN trans_type IN( 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER', 'CONSUMPTION' ) AND loc_out = :shiftLocation THEN qty ELSE 0 END ), 0 ) AS sf_outward FROM rm_location WHERE components_id = :component ",
          {
            replacements: {
              shiftLocation: req.body.shiftLocation,
              component: stmt[i].component_key,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        //

        let sf_qty = 0;
        if (stmt_sf_stock.length > 0) {
          sf_qty = stmt_sf_stock[0].sf_inward - stmt_sf_stock[0].sf_outward;
        }

        data.push({
          key: stmt[i].component_key,
          name: stmt[i].c_name,
          partcode: stmt[i].c_part_no,
          qty: stmt[i].qty,
          unit: stmt[i].units_name,
          type: stmt[i].bom_catergory,
          mfgQTY: req.body.mfgQty,
          leftQty: helper.number(credit) - helper.number(debit),
          sfQty: Number(sf_qty).toFixed(2),
          // sfControlQty: stmt[i].sf_ctrl_qty,
          // is_ctrl: stmt[i].sf_ctrl,
        });
      }
      return res.json({ status: "success", success: true, data: data });
    } else {
      return res.json({ status: "error", success: false, message: "BOM / COMPONENT may be disabled!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// Create Matrial Request WithBom
router.post("/CreateMatrialRequestWithBom", [auth.isAuthorized, auth.checkDuplicacy_db], async (req, res) => {
  let validation = new Validator(req.body, {
    product: "required|not_in:0",
    bom: "required|not_in:0",
    mfgqty: "required|min:1|integer",
    location: "required",
    pic_loc: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "Something you missing in form field to supply.", data: validation.errors.all() });
  }

  let component_length = req.body.component.length;
  let qty_length = req.body.qty.length;

  if (component_length != qty_length) {
    return res.json({ status: "error", success: false, message: "Component and quantity length do not match." });
  }

  let qty_check = 0;

  for (let i = 0; i < component_length; i++) {
    let comp_validation = new Validator(
      {
        component: req.body.component[i],
      },
      {
        component: "required",
      }
    );

    if (comp_validation.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(comp_validation) });
    }

    let qty_validation = new Validator(
      {
        qty: parseInt(req.body.qty[i]),
      },
      {
        qty: "required|min:1|integer",
      }
    );

    if (qty_validation.passes()) {
      qty_check++;
    }
  }

  if (qty_check == 0) {
    return res.json({ status: "error", success: false, message: "At least one component requires a valid value for quantity." });
  }

  const t = await invtDB.transaction();

  try {
    let stmt2 = await invtDB.query("SELECT `ID` FROM `material_request` ORDER BY `ID` DESC LIMIT 1", {
      type: invtDB.QueryTypes.SELECT,
    });

    let transactionID = helper.getUniqueNumber();
    if (stmt2.length == 0) {
      transactionID += 1;
    }
    if (stmt2.length > 0) {
      transactionID += stmt2[0].ID + 1;
    }

    let comment = req.body.comment ? req.body.comment : "--";

    // SHOP FLOOR LOCATION
    // let stmt_get_sf21 = await invtDB.query("SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key", {
    //   replacements: { location_key: "20235231231574" },
    //   type: invtDB.QueryTypes.SELECT,
    // });

    // let sf21_locations = [];
    // if (stmt_get_sf21.length > 0) {
    //   for (let loc_i = 0; loc_i < stmt_get_sf21.length; loc_i++) {
    //     sf21_locations = stmt_get_sf21[loc_i].locations.split(",");
    //   }
    // } else {
    //   return res.json({ status: "error", success: false, message: "Branch Location Not Found, contact administrator." });
    // }

    for (let i = 0; i < component_length; i++) {
      if (helper.number(req.body.qty[i]) > 0) {
        let comp_stmt = await invtDB.query("SELECT * FROM `components` WHERE `component_key` = :component_key", {
          replacements: { component_key: req.body.component[i] },
          type: invtDB.QueryTypes.SELECT,
        });

        if (comp_stmt.length == 0) {
          await t.rollback();
          return res.json({ status: "error", success: false, message: "an invalid component found" });
        }
        if (comp_stmt[0].c_is_enabled == "N") {
          await t.rollback();
          return res.json({ status: "error", success: false, message: "component part [" + comp_stmt[0].c_part_no + "] - [" + comp_stmt[0].c_name + "] can not be execute bcz it has been disabled for transaction" });
        }
        if (comp_stmt[0].c_type == "S") {
          await t.rollback();
          return res.json({ status: "error", success: false, message: "component part [" + comp_stmt[0].c_part_no + "] - [" + comp_stmt[0].c_name + "] can not be execute bcz it is a service component" });
        }

        // CHECK SF CONTROL
        // if (comp_stmt[0].sf_ctrl == "Y") {
        //   if (comp_stmt[0].sf_ctrl_qty > req.body.qty[i]) {
        //     await t.rollback();
        //     return res.json({ status: "error", success: false, message: "component part [${comp_stmt[0].c_part_no}] can not be execute bcz Request qty (${req.body.qty[i]}) > SF control qty (${comp_stmt[0].sf_ctrl_qty}) " });
        //   }

        //   let stmt_sf_stock = await invtDB.query(
        //     "SELECT COALESCE( SUM( CASE WHEN trans_type IN('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND loc_in IN (:sf21_locations) THEN qty ELSE 0 END ), 0 ) AS sf_inward , COALESCE( SUM( CASE WHEN trans_type IN( 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER', 'CONSUMPTION' ) AND loc_out IN (:sf21_locations) THEN qty ELSE 0 END ), 0 ) AS sf_outward FROM rm_location WHERE components_id = :component ",
        //     {
        //       replacements: {
        //         sf21_locations: sf21_locations,
        //         component: req.body.component[i],
        //       },
        //       type: invtDB.QueryTypes.SELECT,
        //     }
        //   );
        //   //

        //   let sf_qty = 0;
        //   if (stmt_sf_stock.length > 0) {
        //     sf_qty = stmt_sf_stock[0].sf_inward - stmt_sf_stock[0].sf_outward;
        //   }

        //   if (sf_qty > comp_stmt[0].sf_ctrl_qty) {
        //     await t.rollback();
        //     return res.json({ status: "error", success: false, message: "component part [${comp_stmt[0].c_part_no}] can not be execute bcz SF qty (${sf_qty}) > SF control qty (${comp_stmt[0].sf_ctrl_qty})" });
        //   }
        // }

        let stmt = await invtDB.query("INSERT INTO `material_request` (`company_branch`,`transaction_type`,`product`,`comment`,`bom`,`mfgqty`,`components_key`,`req_debit`,`req_remark`,`insert_date`,`inserted_by`,`transaction_id`,`location_id`,`insert_full_date`)VALUES (:branch,:credittype,:product,:comment,:bom,:mfgqty,:comp_key,:debit,:remark,:insertdate,:by,:key,:location,:fulldate)", {
          replacements: {
            branch: req.branch,
            credittype: "O",
            product: req.body.product,
            comment: comment,
            bom: req.body.bom,
            mfgqty: req.body.mfgqty,
            comp_key: req.body.component[i],
            debit: req.body.qty[i],
            remark: req.body.remark[i],
            insertdate: moment().format("YYYY-MM-DD HH:mm:ss"),
            by: req.logedINUser,
            key: transactionID,
            location: req.body.location,
            fulldate: moment().format("YYYY-MM-DD HH:mm:ss"),
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: t,
        });
      }

      if (i == component_length - 1) {
        await t.commit();
        return res.json({ status: "success", success: true, message: "Material Request Sent: Ref ID #" + transactionID });
      }
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});


// STEP 1 — Upload & validate Excel (returns enriched rows, no DB insert)
// Excel columns: PART_CODE | PICK_LOCATION | ORDER_QTY | REMARK
router.post("/createWithoutBomBulk/upload", [ uploadWoBomBulk.single("file")], async (req, res) => {
  try {
    const expectedColumns = ["PART_CODE", "PICK_LOCATION", "ORDER_QTY", "REMARK"];

    if (!req.file || !req.file.path) {
      return res.status(400).json({
        success:false,
        status: "error",
        message: "No file uploaded. Please upload an Excel file.",
      });
    }

    const filePath = req.file.path;
    const workbook = xlsx.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    const headers = [];
    const range = xlsx.utils.decode_range(worksheet["!ref"]);
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = xlsx.utils.encode_cell({ r: 0, c: col });
      const cell = worksheet[cellAddress];
      headers.push(cell ? cell.v : null);
    }

    const mismatches = headers
      .map((header, index) => {
        if (header?.trim().toUpperCase() !== expectedColumns[index].toUpperCase()) {
          return { column: `Column ${String.fromCharCode(65 + index)}`, actual: header, expected: expectedColumns[index] };
        }
        return null;
      })
      .filter(Boolean);

    if (mismatches.length > 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ success:false, status: "error", message:"Excel column validation failed.", mismatches });
    }

    const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
    const data = rows.slice(1).filter((r) => r && r.length > 0 && r[0]);

    if (data.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ success:false, status: "error", message:"No data rows found in Excel." });
    }

    for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex];
      const rowNumber = rowIndex + 2;

      const qty = Number(row[2]);
      if (isNaN(qty) || qty <= 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          success:false,
          status: "error",
          message: `Excel column validation failed\nORDER_QTY must be a positive number at row number [${rowNumber}]`,
        });
      }

      const remark = row[3];
      if (remark && String(remark).length > 100) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          success:false,
          status: "error",
          message:`Excel column validation failed\nREMARK must be less than 100 characters at row number [${rowNumber}]`,
        });
      }

      // Resolve PICK_LOCATION by loc_name
      const pickLocation = row[1];
      const locationData = await invtDB.query(
        "SELECT `loc_name`, `location_key` FROM `location_main` WHERE `loc_name` = :location AND `loc_status` = 'ACTIVE'",
        { replacements: { location: pickLocation }, type: invtDB.QueryTypes.SELECT }
      );

      if (!locationData || locationData.length === 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          success:false,
          status: "error",
          message:`Excel column validation failed\nPICK_LOCATION '${pickLocation}' does not exist in database at row number [${rowNumber}]`,
        });
      }

      row[1] = { text: locationData[0].loc_name, value: locationData[0].location_key };

      // Resolve PART_CODE by c_part_no
      const partCode = row[0];
      const partCodeData = await invtDB.query(
        "SELECT `c_name`, `component_key`, `c_part_no`, `c_is_enabled` FROM `components` WHERE `c_part_no` = :partcode AND `c_type` = 'R'",
        { replacements: { partcode: partCode }, type: invtDB.QueryTypes.SELECT }
      );

      if (!partCodeData || partCodeData.length === 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          success:false,
          status: "error",
          message:`Excel column validation failed\nPART_CODE '${partCode}' does not exist in database at row number [${rowNumber}]`,
        });
      }

      if (partCodeData[0].c_is_enabled === "N") {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          success:false,
          status: "error",
          message:`Excel column validation failed\nPART_CODE '${partCode}' is disabled at row number [${rowNumber}]`,
        });
      }

      row[0] = { name: partCodeData[0].c_name, key: partCodeData[0].component_key, partNo: partCodeData[0].c_part_no };
    }

    fs.unlinkSync(filePath);

    const transformedHeaders = headers.map((header) =>
      header.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
    );

    return res.json({
      success:true,
      status: "success",
      message: "Excel file validated successfully.",
      data: { headers: transformedHeaders, rows: data },
    });
  } catch (error) {
    if (req.file && req.file.path) fs.unlinkSync(req.file.path);
    return res.status(500).json({
      success:false,
      status: "error",
      message: "Internal Error! If this persists, contact your system administrator.",
      error: error.stack,
    });
  }
});

// STEP 2 — Save validated rows into material_request
// Body: location, comment, rows[] (array from upload response)
router.post("/createWithoutBomBulk/save", [auth.isAuthorized, auth.checkDuplicacy_db], async (req, res) => {
  let validation = new Validator(req.body, { location: "required" });
  if (validation.fails()) {
    return res.json({ success:false, status: "error", message:"location is required" });
  }

  const rows = req.body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.json({ success:false, status: "error", message:"No rows to save. Please upload Excel first."});
  }

  const t = await invtDB.transaction();
  try {
    const stmt1 = await invtDB.query("SELECT `ID` FROM `material_request` ORDER BY `ID` DESC LIMIT 1", {
      type: invtDB.QueryTypes.SELECT,
    });

    let transactionID = helper.getUniqueNumber();
    transactionID += (stmt1.length > 0 ? stmt1[0].ID : 0) + 1;

    for (const row of rows) {
      const componentKey = row[0]?.key;
      const pickLocKey = row[1]?.value;
      const qty = Number(row[2]);
      const remark = row[3] || "";

      if (!componentKey || !pickLocKey || qty <= 0) {
        await t.rollback();
        return res.json({ success:false, status: "error", message:"Invalid row data. Please re-upload Excel." });
      }

      await invtDB.query(
        "INSERT INTO `material_request` (`company_branch`,`transaction_type`,`comment`,`components_key`,`req_debit`,`req_remark`,`insert_date`,`inserted_by`,`transaction_id`,`location_id`,`insert_full_date`,`pic_loc`) VALUES (:branch,'O',:comment,:component,:debit,:remark,:insertdate,:by,:key,:location,:fulldate,:pic_loc)",
        {
          replacements: {
            branch: req.branch,
            comment: req.body.comment || "",
            component: componentKey,
            debit: qty,
            remark: remark,
            insertdate: moment().format("YYYY-MM-DD HH:mm:ss"),
            by: req.logedINUser,
            key: transactionID,
            location: req.body.location,
            fulldate: moment().format("YYYY-MM-DD HH:mm:ss"),
            pic_loc: pickLocKey,
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: t,
        }
      );
    }

    await t.commit();
    return res.json({
      success:true,
      status: "success",
      message: `${rows.length} item(s) submitted. Material Request Ref ID #${transactionID}`,
    });
  } catch (err) {
    await t.rollback();
    return res.json({
      success:false,
      status: "error",
      message: "internally something happened wrong, contact to administrator",
      error: err.stack,
    });
  }
});

module.exports = router;
