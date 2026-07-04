const express = require("express");
const router = express.Router();

const multer = require("multer");
const path = require("path");

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
let { invtDB, otherDB, invtOakterDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");
const XLSX = require("xlsx");
const fs = require("fs");

const getBomCatSyr = (cat) => {
  if (cat == "P") {
    return "PART";
  } else if (cat == "O") {
    return "OTHER";
  } else if (cat == "PCK") {
    return "PACKING";
  } else if (cat == "PCB") {
    return "PCB";
  } else {
    return "NA";
  }
};

// GET All FGBOM HTML
router.post("/fetchBOMtypeWise", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.body.wise;

  const validation = new Validator(req.body, {
    wise: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
    });
  }

  try {
    let result = [];
    if (searchBy == "FG") {
      result = await invtDB.query(
        "SELECT * FROM bom_recipe WHERE bom_recipe_type = 'default'",
        {
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (searchBy == "SFG") {
      result = await invtDB.query(
        "SELECT * FROM bom_recipe WHERE bom_recipe_type = 'semi'",
        {
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "select valid filter method",
      });
    }

    if (result.length > 0) {
      let finalResult = [];

      for (let i = 0; i < result.length; i++) {
        finalResult.push({
          subject_name: result[i].subject_name,
          bom_product_sku: result[i].bom_product_sku,
          subject_id: result[i].subject_id,
        });
      }

      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: finalResult,
      });
    }
    return res.json({
      status: "error",
      success: false,
      message: "no data found",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Get All FGBOM REACT
router.get("/fgBom", [auth.isAuthorized], async (req, res) => {
  try {
    const result = await invtDB.query(
      "SELECT * FROM bom_recipe WHERE bom_recipe_type = 'default' AND bom_status = 'ENABLE'",
      { type: invtDB.QueryTypes.SELECT }
    );

    if (result.length > 0) {
      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: result,
      });
    }
    return res.json({
      status: "error",
      success: false,
      message: "no data found",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET All Semifgbom
router.get("/semiFgBom", [auth.isAuthorized], async (req, res) => {
  try {
    const result = await invtDB.query(
      "SELECT * FROM bom_recipe WHERE bom_recipe_type = 'semi' AND bom_status = 'ENABLE'",
      { type: invtDB.QueryTypes.SELECT }
    );

    if (result.length > 0) {
      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: result,
      });
    }
    return res.json({
      status: "error",
      success: false,
      message: "no data found",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Get Bom Components by BOM ID
router.post("/bomComponents", [auth.isAuthorized], async (req, res) => {
  try {
    const validator = new Validator(req.body, {
      subject_id: "required",
    });

    if (validator.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "subject not selected",
        data: validator.errors.all(),
      });
    }
    const subject_id = req.body.subject_id;

    const result = await invtDB.query(
      "SELECT bom_quantity.qty,components.c_part_no,components.c_name,units.units_name FROM bom_quantity LEFT JOIN components ON components.component_key = bom_quantity.component_id LEFT JOIN units ON units.units_id = components.c_uom WHERE bom_quantity.subject_under = :subject_id",
      {
        replacements: { subject_id: subject_id },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (result.length > 0) {
      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: result,
      });
    }
    return res.json({
      status: "error",
      success: false,
      message: "no data found",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Insert New BOM
router.post("/insert", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    bom_recipe_type: "required",
    bom_subject: "required",
    sku: "required",
    bom_level: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something is missing in the form fields"
    });
  }

  const { bom_recipe_type, bom_subject, bom_level, mapped_sfg, sku, bom_components, bom_project } = req.body;

  // Check BOM type
  if (bom_recipe_type === "0" || bom_recipe_type === "--") {
    return res.json({
      status: "error",
      success: false,
      message: "Supply the BOM type",
    });
  }

  // Check components
  if (!bom_components || !bom_components.component_key || bom_components.component_key.length === 0) {
    return res.json({
      status: "error",
      success: false,
      message: "Add at least one component",
    });
  }

  // Check for duplicate components
  const duplicates = bom_components.component_key.filter((item, index, arr) => arr.indexOf(item) !== index);
  if (duplicates.length > 0) {
    return res.json({
      status: "error",
      success: false,
      message: "Duplicate component(s) detected",
    });
  }

  // Determine BOM type string
  const bom_type = bom_recipe_type === "Y" ? "semi" : "default";

  // SFG mapping validation
  let mappedSFGrm_key = "--";
  if (bom_type === "semi") {
    if (!mapped_sfg) {
      return res.json({
        status: "error",
        success: false,
        message: "Map RM for SFG Inwarding",
      });
    }
    const checkSFGrm = await invtDB.query(
      "SELECT component_key FROM components WHERE c_is_enabled = 'Y' AND c_type = 'R' AND component_key = :partcode",
      { replacements: { partcode: mapped_sfg }, type: invtDB.QueryTypes.SELECT }
    );
    if (checkSFGrm.length === 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Part code is not valid or disabled for further transaction",
      });
    }
    mappedSFGrm_key = checkSFGrm[0].component_key;
  }

  // Check if BOM already exists
  const existingBOM = await invtDB.query(
    "SELECT * FROM bom_recipe WHERE subject_name = :subject AND bom_product_sku = :skucode",
    { replacements: { subject: bom_subject, skucode: sku }, type: invtDB.QueryTypes.SELECT }
  );
  if (existingBOM.length > 0) {
    return res.json({
      status: "error",
      success: false,
      message: "Recipe of BOM is already registered",
    });
  }

  const t1 = await invtDB.transaction();
  const t2 = await invtOakterDB.transaction();

  try {
    const new_subject_key = helper.getUniqueNumber();
    const insertDate = moment().format("YYYY-MM-DD HH:mm:ss");

    const insertBOMSQL = `
      INSERT INTO bom_recipe 
      (bom_project, sfg_mapped_rm, bom_recipe_type, subject_name, bom_level, subject_id, insert_date, inserted_by, bom_product_sku)
      VALUES (:bom_project, :sfg, :type, :subject, :level, :subject_id, :insert_date, :insert_by, :sku)
    `;

    const insertBOMPayload = {
      bom_project: bom_project || "",
      sfg: mappedSFGrm_key,
      type: bom_type,
      subject: bom_subject,
      level: bom_level,
      subject_id: new_subject_key,
      insert_date: insertDate,
      insert_by: req.logedINUser,
      sku,
    };

    await Promise.all([
      invtDB.query(insertBOMSQL, { replacements: insertBOMPayload, transaction: t1, type: invtDB.QueryTypes.INSERT }),
      invtOakterDB.query(insertBOMSQL, { replacements: insertBOMPayload, transaction: t2, type: invtOakterDB.QueryTypes.INSERT }),
    ]);

    const insertQtySQL = `
      INSERT INTO bom_quantity 
      (bom_quantity_type, subject_under, product_sku, component_id, qty, insert_date, inserted_by)
      VALUES (:type, :subject, :sku, :component, :qty, :insert_date, :insert_by)
    `;

    for (let i = 0; i < bom_components.component_key.length; i++) {
      const componentKey = bom_components.component_key[i];
      const qty = bom_components.qty[i];

      const attrCheck = await invtDB.query(
        "SELECT * FROM components WHERE attribute_code = '--' AND c_attr_category != 'O' AND component_key = :component",
        { replacements: { component: componentKey }, type: invtDB.QueryTypes.SELECT, transaction: t1 }
      );
      if (attrCheck.length > 0) {
        await Promise.all([t1.rollback(), t2.rollback()]);
        return res.json({
          status: "error",
          success: false,
          message: `Part Code [${attrCheck[0].c_part_no}] is not mapped to any uID`,
        });
      }

      const qtyPayload = {
        type: bom_type,
        subject: new_subject_key,
        sku,
        component: componentKey,
        qty,
        insert_date: insertDate,
        insert_by: req.logedINUser,
      };

      await Promise.all([
        invtDB.query(insertQtySQL, { replacements: qtyPayload, transaction: t1, type: invtDB.QueryTypes.INSERT }),
        invtOakterDB.query(insertQtySQL, { replacements: qtyPayload, transaction: t2, type: invtOakterDB.QueryTypes.INSERT }),
      ]);
    }

    await Promise.all([t1.commit(), t2.commit()]);

    return res.json({
      status: "success",
      success: true,
      message: "BOM created successfully",
    });
  } catch (err) {
    console.error(err);

    await Promise.all([t1.rollback(), t2.rollback()]);
    return helper.errorResponse(res, err);
  }
});


// Fetch Product In BOM
router.post("/fetchProductInBom", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    subject_id: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
    });
  }

  try {
    let stmt = await invtDB.query(
      "SELECT * FROM bom_recipe LEFT JOIN products ON bom_recipe.bom_product_sku = products.p_sku  OR bom_recipe.bom_product_sku = products.m_sku WHERE bom_recipe.subject_id = :subjectid",
      {
        replacements: { subjectid: req.body.subject_id },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let data = {
        sku: stmt[0].p_sku,
        product: stmt[0].p_name,
        subject: stmt[0].subject_name,
        subjectid: stmt[0].subject_id,
        project: stmt[0].bom_project,
      };
      if (stmt[0].bom_recipe_type == "semi") {
        let comp_stmt = await invtDB.query(
          "SELECT c_part_no, c_name FROM components WHERE component_key = :component",
          {
            replacements: { component: stmt[0].sfg_mapped_rm },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (comp_stmt.length > 0) {
          data.sfg_inward_rm_code = comp_stmt[0].c_part_no;
          data.sfg_inward_rm_name = comp_stmt[0].c_name;
        }
      }
      return res.json({ status: "success", success: true, data: data });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "no BOM found for this SKU",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Fetch Component For Update
router.post(
  "/fetchComponentsInBomForUpdate",
  [auth.isAuthorized],
  async (req, res) => {
    const validation = new Validator(req.body, {
      subject_id: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
      });
    }

    try {
      let stmt1 = await invtDB.query(
        "SELECT bom_quantity.* , components.*, units.units_name , ven_basic_detail.ven_name , bom_recipe.bom_level  FROM bom_quantity LEFT JOIN components ON bom_quantity.component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = bom_quantity.bom_comp_vendor LEFT JOIN bom_recipe ON bom_quantity.subject_under = bom_recipe.subject_id WHERE bom_quantity.subject_under = :subject AND components.c_type = 'R' ORDER BY components.c_name ASC",
        {
          replacements: { subject: req.body.subject_id },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt1.length > 0) {
        let result = [];
        for (let i = 0; i < stmt1.length; i++) {
          // let stmt2 = await invtDB.query(
          //   "SELECT e1.component_key AS emerged_component_key, e1.c_name AS emerged_component_name, e1.c_part_no AS emerged_part FROM alternative_components LEFT JOIN components AS e1 ON e1.component_key = alternative_components.alt_daughter_component WHERE alternative_components.alt_mother_component = :parent AND alternative_components.alt_subject = :subject AND alternative_components.alt_type = 'emerged'",
          //   {
          //     replacements: {
          //       parent: stmt1[i].component_key,
          //       subject: req.body.subject_id,
          //     },
          //     type: invtDB.QueryTypes.SELECT,
          //   }
          // );
          // let emerged_part, emerged_component_name, emerged_component_key;
          // if (stmt2.length > 0) {
          //   emerged_part = stmt2[0].emerged_part;
          //   emerged_component_name = stmt2[0].emerged_component_name;
          //   emerged_component_key = stmt2[0].emerged_component_key;
          // } else {
          //   emerged_part = "--";
          //   emerged_component_name = "--";
          //   emerged_component_key = "--";
          // }

          result.push({
            priority: stmt1[i].priority,
            level: stmt1[i].bom_level,

            // emerged_partcode: emerged_part,
            // emerged_component_name: emerged_component_name,
            // emerged_component_key: emerged_component_key,

            requiredQty: stmt1[i].qty,
            bomstatus: stmt1[i].bom_status,
            category: stmt1[i].bom_catergory,
            compKey: stmt1[i].component_id,
            component: stmt1[i].c_name,
            partcode: stmt1[i].c_part_no,
            componentdesc: stmt1[i].c_specification,
            unit: stmt1[i].units_name,

            process: stmt1[i].bom_process,
            smt_mi_loc: stmt1[i].bom_smt_mi_loc,
            comp_source: stmt1[i].bom_comp_source,

            vendor: {
              value: stmt1[i].bom_comp_vendor,
              label: stmt1[i].ven_name ?? "NA",
            },
          });
        }

        return res.json({
          status: "success",
          success: true,
          message: "Data fetched successfully",
          data: result,
        });
      } else {
        return res.json({
          message: "unable to fetch any BOM associated to your request",
          status: "error",
          success: false,
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// Fetch component for mapping
router.get(
  "/fetchMapComponent/:partcode",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      const valid = new Validator(req.body, {
        partcode: "required",
      });
      if (valid.fails()) {
        return res.json({
          message: "something you missing in form field to supply",
          data: valid.errors.all(),
          status: "error",
          success: false,
        });
      }

      const partcode = req.params.partcode;

      const result = await invtDB.query(
        "SELECT c_name FROM components WHERE c_is_enabled = 'Y' AND c_type = 'R' AND c_part_no = :partcode",
        {
          replacements: { partcode: partcode },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (result.length > 0) {
        return res.json({
          status: "success",
          success: true,
          message: "Data fetched successfully",
          data: result,
        });
      }

      return res.json({
        status: "error",
        success: false,
        message: "part code is not valid or disabled for further transaction..",
      });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);
// Check Component
router.post("/checkComponent", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      comp_key: "required",
    });

    if (valid.fails()) {
      return res.json({
        message: "send component key !!!",
        data: valid.errors.all(),
        status: "error",
        success: false,
      });
    }

    const comp_key = req.body.comp_key;

    const result = await invtDB.query(
      "SELECT * FROM components LEFT JOIN units ON components.c_uom = units.units_id WHERE  components.component_key = :key AND components.c_type = 'R' AND components.c_is_enabled = 'Y'",
      {
        replacements: { key: comp_key },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (result.length > 0) {
      let data = {
        name: result[0].c_name,
        unit: result[0].units_name,
        key: result[0].component_key,
        identity: result[0].ID,
      };
      return res.json({ status: "success", success: true, data: data });
    }
    return res.json({
      status: "error",
      success: false,
      message: "part code is not valid or disabled for further transaction..",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// UPDATE BOM
router.post("/updateBomComponent", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    subject_id: "required",
    status: "required|not_in:0",
    category: "required|not_in:0",
    component_id: "required",
    qty: "required|min:1|not_in:0",
    sku: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something is missing in the form field",
      data: validation.errors.all(),
    });
  }

  const t1 = await invtDB.transaction();
  const t2 = await invtOakterDB.transaction(); // Assuming dual DB updates

  try {
    // Check if component exists in BOM
    let existingComponent = await invtDB.query(
      "SELECT * FROM bom_quantity WHERE component_id = :component AND subject_under = :subject",
      {
        replacements: {
          component: req.body.component_id,
          subject: req.body.subject_id,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    // Fetch component details
    let componentDetails = await invtDB.query(
      "SELECT * FROM components WHERE component_key = :component AND c_type = 'R'",
      {
        replacements: { component: req.body.component_id },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (!componentDetails.length || componentDetails[0].c_is_enabled === "N") {
      if (!t1.finished) await t1.rollback();
      if (!t2.finished) await t2.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Component is disabled or not found for further transaction",
      });
    }

    const componentData = {
      qty: req.body.qty,
      category: req.body.category,
      status: req.body.status,
      date: moment().format("YYYY-MM-DD HH:mm:ss"),
      by: req.logedINUser,
      component: req.body.component_id,
      subject: req.body.subject_id,
      priority: req.body.priority ?? null,
      process: req.body.process ?? "--",
      smt_mi_loc: req.body.smt_mi_loc ?? "--",
      comp_source: req.body.comp_source ?? "--",
      vendor: req.body.vendor ?? "--",
      sku: req.body.sku,
    };

    if (existingComponent.length > 0) {
      // If status is ALT, check alternative components
      if (req.body.status === "ALT") {
        let altComp = await invtDB.query(
          "SELECT * FROM alternative_components WHERE alt_mother_component = :component AND alt_subject = :subject AND alt_type = 'default'",
          {
            replacements: { component: req.body.component_id, subject: req.body.subject_id },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (!altComp.length) {
          if (!t1.finished) await t1.rollback();
          if (!t2.finished) await t2.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "No alternative components found for this component",
          });
        }
      }

      // Update existing BOM component in both DBs
      const updateSQL = `
        UPDATE bom_quantity SET qty= :qty, bom_catergory= :category, bom_status= :status, update_date= :date, updated_by= :by,
        priority= :priority, bom_process= :process, bom_smt_mi_loc= :smt_mi_loc, bom_comp_source= :comp_source, bom_comp_vendor= :vendor
        WHERE component_id= :component AND subject_under= :subject
      `;

      await Promise.all([
        invtDB.query(updateSQL, { replacements: componentData, type: invtDB.QueryTypes.UPDATE, transaction: t1 }),
        invtOakterDB.query(updateSQL, { replacements: componentData, type: invtOakterDB.QueryTypes.UPDATE, transaction: t2 }),
      ]);

      await Promise.all([t1.commit(), t2.commit()]);

      return res.json({
        status: "success",
        success: true,
        message: "BOM updated successfully",
        data: {
          component_name: componentDetails[0].c_name,
          component_key: componentDetails[0].component_key,
          component_part: componentDetails[0].c_part_no,
          subject: req.body.subject_id,
        },
      });
    } else {
      // Insert new BOM component in both DBs
      const insertSQL = `
        INSERT INTO bom_quantity
        (subject_under, product_sku, bom_catergory, bom_status, component_id, qty, insert_date, inserted_by, bom_process, bom_smt_mi_loc, bom_comp_source, bom_comp_vendor)
        VALUES (:subject, :sku, :category, :status, :component, :qty, :date, :by, :process, :smt_mi_loc, :comp_source, :vendor)
      `;

      await Promise.all([
        invtDB.query(insertSQL, { replacements: componentData, type: invtDB.QueryTypes.INSERT, transaction: t1 }),
        invtOakterDB.query(insertSQL, { replacements: componentData, type: invtOakterDB.QueryTypes.INSERT, transaction: t2 }),
      ]);

      await Promise.all([t1.commit(), t2.commit()]);

      return res.json({
        status: "success",
        success: true,
        message: "Component added successfully",
        data: {
          component_name: componentDetails[0].c_name,
          component_key: componentDetails[0].component_key,
          component_part: componentDetails[0].c_part_no,
          subject: req.body.subject_id,
        },
      });
    }
  } catch (err) {
    if (!t1.finished) await t1.rollback();
    if (!t2.finished) await t2.rollback();

    console.error("Error in /updateBomComponent:", err);
    return helper.errorResponse(res, err);
  }
});



// UPDATE SEMI FG BOM (update_sfgInward_rm)
router.post("/update_sfgInward_rm", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    subject: "required",
    sku: "required",
    sfgrm: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
    });
  }

  try {
    let stmt = await invtDB.query(
      "SELECT * FROM products WHERE p_sku = :skucode OR m_sku = :skucode",
      {
        replacements: { skucode: req.body.sku },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length == 0) {
      return res.json({
        status: "success",
        success: true,
        message: "supply the valid SKU",
      });
    }

    product_sku = stmt[0].p_sku;
    product_msku = stmt[0].m_sku;

    let stmt1 = await invtDB.query(
      "SELECT bom_recipe_type FROM bom_recipe WHERE subject_id = :subjectcode",
      {
        replacements: { subjectcode: req.body.subject },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt1.length == 0) {
      return res.json({
        status: "success",
        success: true,
        message: "BOM is not valid for operation",
      });
    }

    if (stmt1[0].bom_recipe_type == "semi" && req.body.sfgrm != "--") {
      let stmt2 = await invtDB.query(
        "SELECT component_key FROM components WHERE c_is_enabled = 'Y' AND c_type = 'R' AND c_part_no = :partcode",
        {
          replacements: { partcode: req.body.sfgrm },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt2.length == 0) {
        return res.json({
          status: "error",
          success: false,
          message: "component is not valid",
        });
      }
      const component_key = stmt2[0].component_key;

      let update_stmt = await invtDB.query(
        "UPDATE bom_recipe SET sfg_mapped_rm = :sfgrm WHERE subject_id = :subjectcode AND (bom_product_sku = :skucode OR bom_product_sku = :mskucode) AND bom_recipe_type = :bomtype",
        {
          replacements: {
            sfgrm: component_key,
            subjectcode: req.body.subject,
            skucode: product_sku,
            mskucode: product_msku,
            bomtype: "semi",
          },
          type: invtDB.QueryTypes.UPDATE,
        }
      );
      if (update_stmt.length > 0) {
        return res.json({
          status: "success",
          success: true,
          message: "part code mapping successfully done..",
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message:
            "updation failed due to some reasons, contact system administrator for further support..",
        });
      }
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "something went wrong",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Get alternative components
router.post(
  "/getAlternativeComponents",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let stmt;
      if (
        (req.body.searchTerm == "",
        req.body.searchTerm == undefined,
        req.body.searchTerm == null)
      ) {
        stmt = await invtDB.query(
          "SELECT * FROM bom_quantity LEFT JOIN components ON bom_quantity.component_id = components.component_key WHERE bom_quantity.subject_under = :subject AND components.c_type = 'R' AND components.component_key != :current_component ORDER BY components.c_name ASC LIMIT :limit",
          {
            replacements: {
              subject: req.body.subject,
              current_component: req.body.current_component,
              limit: 50,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      } else {
        stmt = await invtDB.query(
          "SELECT * FROM bom_quantity LEFT JOIN components ON bom_quantity.component_id = components.component_key WHERE bom_quantity.subject_under = :subject AND components.c_type = 'R' AND components.component_key != :current_component AND components.c_part_no LIKE :name OR components.c_name LIKE :name LIMIT :limit",
          {
            replacements: {
              subject: req.body.subject,
              current_component: req.body.current_component,
              name: "%" + req.body.searchTerm + "%",
              limit: 50,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      }

      let data = [];
      if (stmt.length > 0) {
        for (let i = 0; i < stmt.length; i++) {
          data.push({
            id: stmt[i].component_id,
            text: stmt[i].c_name + " ( " + stmt[i].c_part_no + " )",
          });
        }

        return res.json({
          message: "success",
          status: "success",
          success: true,
          data: data,
        });
      }

      return res.json({
        message: "no alternative component found",
        status: "error",
        success: false,
      });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// FETCH ALL ALTERNATIVE COMPONENTS
router.post(
  "/getAllAlternativeComponents",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let stmt = await invtDB.query(
        "SELECT * FROM alternative_components LEFT JOIN components ON alternative_components.alt_daughter_component = components.component_key WHERE alternative_components.alt_mother_component = :component AND alternative_components.alt_product_sku = :sku AND alternative_components.alt_subject = :subject AND alternative_components.alt_type = 'default'",
        {
          replacements: {
            component: req.body.parent_component,
            sku: req.body.product_id,
            subject: req.body.subjectid,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let result = [];
      if (stmt.length > 0) {
        for (let i = 0; i < stmt.length; i++) {
          result.push({
            component_name: stmt[i].c_name + " ( " + stmt[i].c_part_no + " )",
            product_sku: req.body.product_id,
            subject: req.body.subjectid,
            parent_component: req.body.parent_component,
            child_component: stmt[i].alt_daughter_component,
            refid: stmt[i].alt_ref_id,
          });
        }
        return res.json({
          status: "success",
          success: true,
          message: "Data fetched successfully",
          data: result,
        });
      }
      return res.json({
        message: "couldn't fetch the mapped details",
        status: "error",
        success: false,
      });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// ADD NEW COMPONENT IN BOM
router.post("/addNewAltComponent", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    subject_id: "required",
    parent_component: "required",
    child_component: "required",
    product_id: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
    });
  }

  let subject_id = req.body.subject_id;
  let parent_component = req.body.parent_component;
  let child_component = req.body.child_component;
  let product_id = req.body.product_id;

  if (parent_component == child_component) {
    return res.json({
      status: "error",
      success: false,
      message: "You can not choose the same component together",
    });
  }

  try {
    let stmt001 = await invtDB.query(
      "SELECT * FROM products WHERE p_sku = :sku",
      {
        replacements: { sku: product_id },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt001.length > 0) {
      let stmt002 = await invtDB.query(
        "SELECT * FROM bom_recipe WHERE subject_id = :subject",
        {
          replacements: { subject: subject_id },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt002.length > 0) {
        let stmt003 = await invtDB.query(
          "SELECT * FROM components WHERE component_key = :parent_component",
          {
            replacements: { parent_component: parent_component },
          }
        );

        if (stmt003.length > 0) {
          let stmt004 = await invtDB.query(
            "SELECT * FROM components WHERE component_key = :child_component",
            {
              replacements: { child_component: child_component },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (stmt004.length > 0) {
            let stmt005 = await invtDB.query(
              "SELECT * FROM alternative_components WHERE alt_mother_component = :parent_component AND alt_daughter_component = :child_component AND alt_product_sku = :sku AND alt_subject = :subject AND alt_type = 'default'",
              {
                replacements: {
                  parent_component: parent_component,
                  child_component: child_component,
                  sku: product_id,
                  subject: subject_id,
                },
                type: invtDB.QueryTypes.SELECT,
              }
            );

            if (stmt005.length > 0) {
              return res.json({
                status: "error",
                success: false,
                message: "mapping failed bcz it's already mapped...",
              });
            } else {
              let stmt006 = await invtDB.query(
                "INSERT INTO alternative_components (alt_mother_component,alt_daughter_component,alt_product_sku,alt_subject,alt_insert_by,alt_insert_date,alt_ref_id,alt_type) VALUES(:parent_component, :child_component, :sku, :subject, :insertby, :insertdate, :ref,'default')",
                {
                  replacements: {
                    parent_component: parent_component,
                    child_component: child_component,
                    sku: product_id,
                    subject: subject_id,
                    insertby: req.logedINUser,
                    insertdate: moment().format("YYYY-MM-DD HH:mm:ss"),
                    ref: helper.getUniqueNumber(),
                  },
                }
              );

              return res.json({
                status: "success",
                success: true,
                message: "component mapped...",
              });
            }
          } else {
            return res.json({
              status: "success",
              success: true,
              message: "mapping failed...",
            });
          }
        } else {
          return res.json({
            status: "success",
            success: true,
            message: "mapping failed...",
          });
        }
      } else {
        return res.json({
          status: "success",
          success: true,
          message: "mapping failed...",
        });
      }
    } else {
      return res.json({
        status: "success",
        success: true,
        message: "mapping failed...",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Remove Alt Component
router.post("/removeAltComponent", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    child_component: "required",
    parent_component: "required",
    product: "required",
    subject: "required",
    refid: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
    });
  }

  const transaction = await invtDB.transaction();

  try {
    let stmt1 = await invtDB.query(
      "SELECT * FROM products WHERE p_sku = :product",
      {
        replacements: { product: req.body.product },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt1.length > 0) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM components WHERE component_key = :component",
        {
          replacements: { component: req.body.child_component },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt2.length > 0) {
        let stmt3 = await invtDB.query(
          "SELECT * FROM bom_quantity WHERE subject_under = :subject",
          {
            replacements: { subject: req.body.subject },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt3.length > 0) {
          let stmt4 = await invtDB.query(
            "DELETE FROM alternative_components WHERE alt_mother_component = :parent_component AND alt_product_sku = :product AND alt_subject = :subject AND alt_ref_id = :refid AND alt_daughter_component = :child_component AND alt_type = 'default'",
            {
              replacements: {
                parent_component: req.body.parent_component,
                product: req.body.product,
                refid: req.body.refid,
                subject: req.body.subject,
                child_component: req.body.child_component,
              },
              type: invtDB.QueryTypes.DELETE,
              transaction: transaction,
            }
          );

          let stmt5 = await invtDB.query(
            "SELECT * FROM alternative_components WHERE alt_mother_component = :parent_component AND alt_product_sku = :product AND alt_subject = :subject AND alt_type = 'default'",
            {
              replacements: {
                parent_component: req.body.parent_component,
                product: req.body.product,
                subject: req.body.subject,
              },
            }
          );
          if (stmt5.length > 0) {
            await transaction.commit();
            return res.json({
              status: "success",
              success: true,
              message: "alternative component has been deleted..",
            });
          } else {
            let stmt6 = await invtDB.query(
              "UPDATE bom_quantity SET bom_status = :status WHERE subject_under = :subject AND product_sku = :product AND component_id = :component AND bom_status = :currectstatus",
              {
                replacements: {
                  subject: req.body.subject,
                  product: req.body.product,
                  component: req.body.parent_component,
                  status: "I",
                  currectstatus: "ALT",
                },
              }
            );
            if (stmt6.length > 0) {
              await transaction.commit();
              return res.json({
                status: "success",
                success: true,
                message: "alternative component has been deleted...",
              });
            } else {
              await transaction.rollback();
              return res.json({
                status: "error",
                success: false,
                message: "unable to delete the component",
              });
            }
          }
        } else {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "unable to perform the action 2",
          });
        }
      } else {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "unable to perform the action 1",
        });
      }
    } else {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "unable to perform the action",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH BOM DOCS FILES
router.post("/fetchBomDocsFiles", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query(
      "SELECT * FROM bom_recipe_files LEFT JOIN admin_login ON admin_login.CustID = bom_recipe_files.brf_insert_by WHERE bom_recipe_files.brf_subject_id = :subject AND bom_recipe_files.brf_product_sku = :sku AND bom_recipe_files.brf_status = 'S' ORDER BY bom_recipe_files.ID DESC",
      {
        replacements: { subject: req.body.subject_id, sku: req.body.sku },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let result = [];

      for (let i = 0; i < stmt.length; i++) {
        result.push({
          doc_name: stmt[i].brf_doc_name.replace(),
          doc_url:
            req.protocol +
            "://" +
            "api.mscorpres.net" +
            "/uploads/bomdocs/" +
            stmt[i].brf_doc,
          doc_id: stmt[i].brf_attach_id,
          uploaded_date: moment(stmt[i].brf_insert_date)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY hh:mm:ss A"),
          uploaded_by: stmt[i].user_name,
        });
      }

      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: result,
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "no any attachment(s) found with BOM recipe",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

var storage = multer.diskStorage({
  destination: "uploads/bomdocs",
  filename: function (req, file, cb) {
    cb(
      null,
      "imsSemifg__docBom" +
        helper.getUniqueNumber() +
        helper.randomNumber(100, 999) +
        path.extname(file.originalname)
    );
  },
});
var upload = multer({ storage: storage });
router.post(
  "/uploadDocs",
  [auth.isAuthorized, upload.array("files")],
  async (req, res) => {
    try {
      let filesLenth = req.files.length;

      if (filesLenth <= 0) {
        return res.json({
          message: "somthing went wrong",
          status: "error",
          success: false,
        });
      }

      let files = [];
      if (filesLenth > 0) {
        for (let i = 0; i < filesLenth; i++) {
          files.push(req.files[i].filename);
        }
      }
      // array to string
      files = files.toString();

      let stmt = await invtDB.query(
        "INSERT INTO bom_recipe_files (brf_subject_id,brf_product_sku,brf_doc_name,brf_doc,brf_insert_by,brf_attach_id,brf_insert_date) VALUES(:subject,:sku,:docname,:file,:insertby,:attach_id,:date)",
        {
          replacements: {
            subject: req.body.subject,
            sku: req.body.sku,
            docname: req.body.doc_name,
            file: files,
            insertby: req.logedINUser,
            attach_id: helper.getUniqueNumber(),
            date: moment().format("YYYY-MM-DD HH:mm:ss"),
          },
          type: invtDB.QueryTypes.INSERT,
        }
      );

      return res.json({ data: files, status: "success", success: true });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// FETCH BOM WITH LOCATION
router.post("/fetchBomMapLocation", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query(
      "SELECT bom_recipe.subject_name , bom_recipe.console_sku , location_main.loc_name , products.p_name , products.p_sku FROM bom_recipe LEFT JOIN products ON bom_recipe.bom_product_sku = products.p_sku LEFT JOIN location_main ON bom_recipe.bom_loc_from = location_main.location_key",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        final.push({
          bom: stmt[i].subject_name,
          console_sku: stmt[i].console_sku,
          sku: stmt[i].p_sku,
          sku_name: stmt[i].p_name,
          location: stmt[i].loc_name ?? "N/A",
        });
      }
      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No BOM found!!!",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// MAP BOM LOACTION (LOCATION MAP)
router.post("/mapBomFromLocation", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      sku: "required",
      bom: "required",
      location: "required",
    });

    if (valid.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: valid.errors.all(),
      });
    }

    let stmt = await invtDB.query(
      "UPDATE bom_recipe SET bom_loc_from = :location WHERE bom_product_sku = :sku AND subject_id = :bom",
      {
        replacements: {
          sku: req.body.sku,
          bom: req.body.bom,
          location: req.body.location,
        },
        type: invtDB.QueryTypes.UPDATE,
      }
    );

    if (stmt.length > 0) {
      return res.json({
        status: "success",
        success: true,
        message: "Location Mapped!!!",
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "Something went wrong!!!",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// BOM TREE VIEW MAPPER
router.post("/bomExcelDownload", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      subject_id: "required",
    });

    if (valid.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: valid.errors.all(),
      });
    }

    async function getChidBom(sku) {
      let child_comps = [];
      let stmt_child = await invtDB.query(
        "SELECT bom_quantity.* , components.c_name, components.c_part_no , components.c_specification , units.units_name , ven_basic_detail.ven_name  FROM bom_quantity LEFT JOIN components ON bom_quantity.component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = bom_quantity.bom_comp_vendor WHERE bom_quantity.product_sku = :product_sku AND components.c_type = 'R' AND components.c_is_enabled = 'Y' AND bom_quantity.bom_status = 'A' ORDER BY components.c_name ASC",
        {
          replacements: { product_sku: sku },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt_child.length > 0) {
        let stmt_bom = await invtDB.query(
          "SELECT * FROM bom_recipe WHERE subject_id = :subject_id LIMIT 1",
          {
            replacements: { subject_id: stmt_child[0].subject_under },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        childBoms.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
        childBoms.push([
          "",
          "BOM",
          `${stmt_bom[0].subject_name}`,
          "SKU",
          `${stmt_bom[0].bom_product_sku}`,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]);
        childBoms.push([
          "SKU",
          "PART CODE",
          "PART NAME",
          "PART SPEC",
          "UNIT",
          "QTY",
          "CATEGORY",
          "PROCESS",
          "SMT/MI LOC",
          "SOURCE",
          "VENDOR CODE",
          "VENDOR",
        ]);

        for (let i = 0; i < stmt_child.length; i++) {
          childBoms.push([
            stmt_child[i].product_sku,
            stmt_child[i].c_part_no,
            stmt_child[i].c_name,
            stmt_child[i].c_specification,
            stmt_child[i].units_name,
            stmt_child[i].qty,
            getBomCatSyr(stmt_child[i].bom_catergory),
            stmt_child[i].bom_process,
            stmt_child[i].bom_smt_mi_loc,
            stmt_child[i].bom_comp_source,
            stmt_child[i].bom_comp_vendor,
            stmt_child[i].ven_name ?? "N/A",
          ]);

          if (stmt.length - 1 != i) {
            child_comps.push(stmt_child[i].c_part_no);
          }
          if (stmt_child.length - 1 == i) {
            for (let j = 0; j < child_comps.length; j++) {
              await getChidBom(child_comps[j]);
            }
          }
        }
      }
    }
    let final_data = [];
    let childBoms = [];

    let stmt = await invtDB.query(
      "SELECT bom_quantity.* , components.c_name, components.c_part_no , components.c_specification , units.units_name , ven_basic_detail.ven_name  FROM bom_quantity LEFT JOIN components ON bom_quantity.component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = bom_quantity.bom_comp_vendor WHERE bom_quantity.subject_under = :subject AND components.c_type = 'R' AND components.c_is_enabled = 'Y' AND bom_quantity.bom_status = 'A' ORDER BY components.c_name ASC",
      {
        replacements: { subject: req.body.subject_id },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let stmt_bom = await invtDB.query(
        "SELECT bom_recipe.*, products.p_name FROM bom_recipe LEFT JOIN products ON bom_recipe.bom_product_sku = products.p_sku WHERE subject_id = :subject_id",
        {
          replacements: { subject_id: stmt[0].subject_under },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      final_data.push([
        "",
        `SKU:- ${stmt_bom[0].bom_product_sku}\n[${stmt_bom[0].p_name}] \nBOM:- ${stmt_bom[0].subject_name}`,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
      final_data.push([
        "",
        "BOM",
        `${stmt_bom[0].subject_name}`,
        "SKU",
        `${stmt_bom[0].bom_product_sku}`,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
      final_data.push([
        "SKU",
        "PART CODE",
        "PART NAME",
        "PART SPEC",
        "UNIT",
        "QTY",
        "CATEGORY",
        "PROCESS",
        "SMT/MI LOC",
        "SOURCE",
        "VENDOR CODE",
        "VENDOR",
      ]);

      for (let i = 0; i < stmt.length; i++) {
        final_data.push([
          stmt[i].product_sku,
          stmt[i].c_part_no,
          stmt[i].c_name,
          stmt[i].c_specification,
          stmt[i].units_name,
          stmt[i].qty,
          getBomCatSyr(stmt[i].bom_catergory),
          stmt[i].bom_process,
          stmt[i].bom_smt_mi_loc,
          stmt[i].bom_comp_source,
          stmt[i].bom_comp_vendor,
          stmt[i].ven_name ?? "N/A",
        ]);
        await getChidBom(stmt[i].c_part_no);
      }

      data = [...final_data, ...childBoms];

      // SAVE TO SHEET
      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const filename = helper.getUniqueNumber() + ".xlsx";
      const filePath = "./files/excel/BOM" + filename;
      XLSX.writeFile(wb, filePath);

      let buffer = fs.readFileSync(filePath);
      return res.json({
        status: "success",
        success: true,
        message: "file generated successfully...",
        data: { buffer: buffer, filename: filename },
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// IMPORT BOM WITH EXCEL
const bom_data = multer.diskStorage({
  destination: (req, file, callBack) => {
    callBack(null, "./files/excel/");
  },
  filename: (req, file, callBack) => {
    callBack(
      null,
      file.fieldname + "-" + Date.now() + path.extname(file.originalname)
    );
  },
});
const bomUpload = multer({
  storage: bom_data,
});
router.post(
  "/insertBOMthroughExcel",
  [auth.isAuthorized, bomUpload.single("excelFile")],
  async (req, res) => {
    if (req.file == undefined) {
      return res.json({
        message: "Please select file!!!",
        status: "error",
        success: false,
      });
    }

    const excelFilePath = req.file;
    const workbook = XLSX.readFile(excelFilePath.path);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const excelData = XLSX.utils.sheet_to_json(worksheet);

    const validation = new Validator(req.body, {
      bom_recipe_type: "required",
      bom_subject: "required",
      sku: "required",
      bom_level: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
      });
    }

    const bom_recipe_type = req.body.bom_recipe_type;
    const bom_recipe_name = req.body.bom_subject;
    const mappedSFGrm = req.body.mapped_sfg;
    const sku = req.body.sku;
    const bom_level = req.body.bom_level;

    if (bom_recipe_type == "0" || bom_recipe_type == "--") {
      return res.json({
        status: "error",
        success: false,
        message: "supply the BOM type",
      });
    }

    let bom_type;
    if (bom_recipe_type == "Y") {
      bom_type = "semi";
    } else {
      bom_type = "default";
    }

    if (
      (bom_recipe_type == "Y" && mappedSFGrm == "") ||
      mappedSFGrm == null ||
      mappedSFGrm == undefined
    ) {
      return res.json({
        message: "map RM for SFG Inwarding..",
        status: "error",
        success: false,
      });
    }

    const components = excelData
      .map((item, index) => {
        return { PARTCODE: item.PARTCODE, ROW: index + 1 };
      })
      .reverse();
    const comp_length = components.length;

    // CHECK DUBLICATE COMPONENT
    if (comp_length > 0) {
      const PARTCODES = components.map((item) => item.PARTCODE);
      const toFindDuplicates = (arry) =>
        arry.filter(({ PARTCODE }, index) =>
          PARTCODES.includes(PARTCODE, index + 1)
        );
      const duplicateElementa = toFindDuplicates(components).reverse();
      if (duplicateElementa.length > 0) {
        return res.json({
          message: "dublicate component",
          data: duplicateElementa,
          status: "error",
          success: false,
        });
      }
    } else {
      return res.json({
        message: "add atleast one component..",
        status: "error",
        success: false,
      });
    }
    // END CHECK DUBLICATE COMPONENT

    let mappedSFGrm_key = "--";
    if (bom_recipe_type == "Y" && mappedSFGrm != "") {
      const checkSFGrm = await invtDB.query(
        "SELECT * FROM `components` WHERE `component_key` = :component_key",
        {
          replacements: { component_key: mappedSFGrm },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (checkSFGrm.length > 0) {
        mappedSFGrm_key = mappedSFGrm;
      } else {
        return res.json({
          message: "Component not found!!!",
          status: "error",
          success: false,
        });
      }
    }

    const check_bom = await invtDB.query(
      "SELECT * FROM `bom_recipe` WHERE `subject_name` = :subject AND `bom_product_sku` = :skucode",
      {
        replacements: { subject: bom_recipe_name, skucode: sku },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (check_bom.length > 0) {
      return res.json({
        status: "error",
        success: false,
        message: "recipe of BOM is already registered with us...",
      });
    }

    const transaction = await invtDB.transaction();

    try {
      const new_subject_key = helper.getUniqueNumber();

      let stmt = await invtDB.query(
        "INSERT INTO `bom_recipe` (`sfg_mapped_rm`,`bom_recipe_type`,`subject_name`, `bom_level`, `subject_id`,`insert_date`,`inserted_by`,`bom_product_sku`) VALUES (:mappedsfgrm, :typeof,:subject,:level,:key,:insertdate,:by,:sku)",
        {
          replacements: {
            mappedsfgrm: mappedSFGrm_key,
            typeof: bom_type,
            subject: bom_recipe_name,
            level: bom_level,
            key: new_subject_key,
            insertdate: moment().format("YYYY-MM-DD HH:mm:ss"),
            by: req.logedINUser,
            sku: sku,
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: transaction,
        }
      );

      let insert_dt = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");
      for (let i = 0; i < excelData.length; i++) {
        const row = excelData[i];

        if (!row.PARTCODE) {
          await transaction.rollback();
          return res.json({
            message: "Please fill Part code at ${i + 1} row data!!!",
            status: "error",
            success: false,
          });
        }

        let component_key;
        const result = await invtDB.query(
          "SELECT component_key FROM components WHERE c_is_enabled = 'Y' AND c_type = 'R' AND c_part_no = :partcode",
          {
            replacements: { partcode: row.PARTCODE },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (result.length > 0) {
          component_key = result[0].component_key;
        } else {
          await transaction.rollback();
          return res.json({
            message:
              "Part code (${row.PARTCODE}) is not valid or disabled for further transaction..",
            status: "error",
            success: false,
          });
        }

        let stmt1 = await invtDB.query(
          "INSERT INTO bom_quantity (bom_quantity_type, subject_under, product_sku, component_id, qty, priority, bom_catergory, bom_status, bom_process, bom_smt_mi_loc, bom_comp_source, bom_comp_vendor , inserted_by ,	insert_date ) VALUES (:typeof,:subject,:sku,:component,:qty,:priority,:bom_catergory,:bom_status,:bom_process, :bom_smt_mi_loc,:bom_comp_source,:bom_vendor , :inserBy , :insertDate )",
          {
            replacements: {
              typeof: bom_recipe_type,
              subject: new_subject_key,
              sku: sku,
              component: component_key,
              qty: row.QTY,
              priority: row.PRIORITY,
              bom_catergory: row.CATEGORY,
              bom_status: row.STATUS,
              bom_process: row.PROCESS,
              bom_vendor: row.VENDOR,
              bom_comp_source: row.COMP_SOURCE,
              bom_smt_mi_loc: row.SMY_MI_LOC,
              inserBy: req.logedINUser,
              insertDate: insert_dt,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );
      }
      await transaction.commit();
      return res.json({
        message: "BOM created successfully",
        status: "success",
        success: true,
      });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// SHOW UPLOAD BOM DATA
router.post(
  "/showExcelBomData",
  [auth.isAuthorized, bomUpload.single("excelFile")],
  async (req, res) => {
    if (req.file == undefined) {
      return res.json({
        message: "Please select file!!!",
        status: "error",
        success: false,
      });
    }

    const excelFilePath = req.file;
    const workbook = XLSX.readFile(excelFilePath.path);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const excelData = XLSX.utils.sheet_to_json(worksheet);

    const validation = new Validator(req.body, {
      bom_recipe_type: "required",
      bom_subject: "required",
      sku: "required",
      bom_level: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
      });
    }

    const bom_recipe_type = req.body.bom_recipe_type;
    const bom_recipe_name = req.body.bom_subject;
    const mappedSFGrm = req.body.mapped_sfg;
    const sku = req.body.sku;
    const bom_level = req.body.bom_level;

    if (bom_recipe_type == "0" || bom_recipe_type == "--") {
      return res.json({
        status: "error",
        success: false,
        message: "supply the BOM type",
      });
    }

    let bom_type;
    if (bom_recipe_type == "Y") {
      bom_type = "semi";
    } else {
      bom_type = "default";
    }

    if (
      (bom_recipe_type == "Y" && mappedSFGrm == "") ||
      mappedSFGrm == null ||
      mappedSFGrm == undefined
    ) {
      return res.json({
        message: "map RM for SFG Inwarding..",
        status: "error",
        success: false,
      });
    }

    const components = excelData
      .map((item, index) => {
        return { PARTCODE: item.PARTCODE, ROW: index + 1 };
      })
      .reverse();
    const comp_length = components.length;

    // CHECK DUBLICATE COMPONENT
    if (comp_length > 0) {
      const PARTCODES = components.map((item) => item.PARTCODE);
      const toFindDuplicates = (arry) =>
        arry.filter(({ PARTCODE }, index) =>
          PARTCODES.includes(PARTCODE, index + 1)
        );
      const duplicateElementa = toFindDuplicates(components).reverse();
      if (duplicateElementa.length > 0) {
        return res.json({
          message: "dublicate component",
          data: duplicateElementa,
          status: "error",
          success: false,
        });
      }
    } else {
      return res.json({
        message: "add atleast one component..",
        status: "error",
        success: false,
      });
    }
    // END CHECK DUBLICATE COMPONENT

    let mappedSFGrm_key = "--";
    if (bom_recipe_type == "Y" && mappedSFGrm != "") {
      const checkSFGrm = await invtDB.query(
        "SELECT * FROM `components` WHERE `component_key` = :component_key",
        {
          replacements: { component_key: mappedSFGrm },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (checkSFGrm.length > 0) {
        mappedSFGrm_key = mappedSFGrm;
      } else {
        return res.json({
          message: "Component not found!!!",
          status: "error",
          success: false,
        });
      }
    }

    const check_bom = await invtDB.query(
      "SELECT * FROM `bom_recipe` WHERE `subject_name` = :subject AND `bom_product_sku` = :skucode",
      {
        replacements: { subject: bom_recipe_name, skucode: sku },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (check_bom.length > 0) {
      return res.json({
        status: "error",
        success: false,
        message: "recipe of BOM is already registered with us...",
      });
    }

    try {
      for (let i = 0; i < excelData.length; i++) {
        const row = excelData[i];

        if (!row.PARTCODE) {
          return res.json({
            message: "Please fill Part code at ${i + 1} row data!!!",
            status: "error",
            success: false,
          });
        }

        const result = await invtDB.query(
          "SELECT component_key FROM components WHERE c_is_enabled = 'Y' AND c_type = 'R' AND c_part_no = :partcode",
          {
            replacements: { partcode: row.PARTCODE },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (result.length > 0) {
        } else {
          return res.json({
            message:
              "Part code (${row.PARTCODE}) is not valid or disabled for further transaction..",
            status: "error",
            success: false,
          });
        }
      }
      return res.json({ data: excelData, status: "success", success: true });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

//Update Bom Status
router.post("/updateBOMStatus", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    subject_id: "required",
    status: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  const { subject_id, status } = req.body;

  const t1 = await invtDB.transaction();
  const t2 = await invtOakterDB.transaction();

  try {
    // Check if BOM exists first
    const checkBOM = await invtDB.query(
      "SELECT * FROM `bom_recipe` WHERE `subject_id` = :subject_id",
      {
        replacements: { subject_id },
        type: invtDB.QueryTypes.SELECT,
        transaction: t1,
      }
    );

    if (checkBOM.length === 0) {
      await Promise.all([t1.rollback(), t2.rollback()]);
      return res.json({
        status: "error",
        success: false,
        message: "BOM not found",
      });
    }

    // Update BOM status in both databases
    const updateSQL = "UPDATE `bom_recipe` SET `bom_status` = :status WHERE `subject_id` = :subject_id";

    const [result1, result2] = await Promise.all([
      invtDB.query(updateSQL, {
        replacements: { status, subject_id },
        transaction: t1,
      }),
      invtOakterDB.query(updateSQL, {
        replacements: { status, subject_id },
        transaction: t2,
      }),
    ]);

    // Check if update actually affected rows
    // For raw UPDATE queries, result structure is [results, metadata] where metadata contains affectedRows
    const affectedRows1 = result1[1]?.affectedRows ?? (typeof result1[1] === 'number' ? result1[1] : 0);
    const affectedRows2 = result2[1]?.affectedRows ?? (typeof result2[1] === 'number' ? result2[1] : 0);

    if (affectedRows1 === 0 && affectedRows2 === 0) {
      await Promise.all([t1.rollback(), t2.rollback()]);
      return res.json({
        status: "error",
        success: false,
        message: "No rows were updated. BOM status may already be set to this value or BOM not found in one of the databases.",
      });
    }

    await Promise.all([t1.commit(), t2.commit()]);

    return res.json({
      message: "BOM status updated successfully",
      status: "success",
      success: true,
    });

  } catch (err) {
    console.log(err);
    await Promise.all([t1.rollback(), t2.rollback()]);
    return helper.errorResponse(res, err);
  }
});



//Fetch the data bom draft
router.get("/getDraftBOMs", [auth.isAuthorized], async (req, res) => {
  try {
    const draftBOMs = await invtDB.query(
      "SELECT * FROM `bom_recipe` WHERE `bom_status` = 'DISABLE'",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (draftBOMs.length > 0) {
      let finalResult = [];

      for (let i = 0; i < draftBOMs.length; i++) {
        finalResult.push({
          subject_name: draftBOMs[i].subject_name,
          bom_product_sku: draftBOMs[i].bom_product_sku,
          subject_id: draftBOMs[i].subject_id,
        });
      }
      return res.json({ status: "success", success: true, data: finalResult });
    }

    return res.json({
      message: "data Not Found!!!",
      status: "error",
      success: false,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// BOM COMPONENTDETAILS
router.post(
  "/fetchBomComponentDetails",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(req.body, {
      subject: "required",
      component: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: validation.errors.all(),
      });
    }

    try {
      const stmt = await invtDB.query(
        "SELECT bom_quantity.*, components.c_part_no , components.c_name , components.component_key FROM bom_quantity LEFT JOIN components ON bom_quantity.component_id = components.component_key WHERE subject_under = :subject AND component_id = :component",
        {
          replacements: {
            subject: req.body.subject,
            component: req.body.component,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        let bom_catergory = { id: "0", text: "N/A" };
        if (stmt[0].bom_catergory == "P") {
          bom_catergory = { id: "P", text: "PART" };
        }
        if (stmt[0].bom_catergory == "O") {
          bom_catergory = { id: "O", text: "OTHER" };
        }
        if (stmt[0].bom_catergory == "PCK") {
          bom_catergory = { id: "PCK", text: "PACKAGING" };
        }
        if (stmt[0].bom_catergory == "'PCB") {
          bom_catergory = { id: "'PCB", text: "PCB" };
        }

        let status = { id: "0", text: "N/A" };
        if (stmt[0].bom_status == "A") {
          status = { id: "A", text: "ACTIVE" };
        }
        if (stmt[0].bom_status == "I") {
          status = { id: "I", text: "INACTIVE" };
        }
        if (stmt[0].bom_status == "ALT") {
          status = { id: "ALT", text: "ALTERNATIVE" };
        }

        // ALL INWARD
        let stmt6 = await invtDB.query(
          "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER')",
          {
            replacements: { component: stmt[0].component_key },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let inward_all_qty = 0;
        if (stmt6.length > 0) {
          inward_all_qty = helper.number(stmt6[0].Inward);
        }

        // ALL OUTWARD
        let stmt7 = await invtDB.query(
          "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') ",
          {
            replacements: { component: stmt[0].component_key },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let outward_all_qty = 0;
        if (stmt7.length > 0) {
          outward_all_qty = helper.number(stmt7[0].Outward);
        }

        let stmt0 = await invtDB.query(
          "SELECT COALESCE( SUM(`po_order_qty`), 0 ) `totalReq_Qty`, COALESCE( SUM(`po_inward_qty`), 0 ) `Inward` FROM `po_purchase_req` WHERE `po_part_no` = :component AND `po_pending_qty` != 0",
          {
            replacements: { component: stmt[0].component_key },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let order = 0;
        let inward = 0;
        if (stmt0.length > 0) {
          order = stmt0[0].totalReq_Qty;
          inward = stmt0[0].Inward;
        } else {
          order = 0;
          inward = 0;
        }

        const data = {
          part_code: stmt[0].c_part_no,
          part_name: stmt[0].c_name,
          bom_qty: stmt[0].qty,
          bom_catergory: bom_catergory,
          bom_status: status,
          popendingqty: helper.number(order - inward),
          branchstock: Number(inward_all_qty) - Number(outward_all_qty),
          rqd_qty: 0,
        };

        return res.json({ status: "success", success: true, data: data });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "Component not found in BOM",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// TEMP BOM
router.get("/fetchApprover", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      bom: "required",
    });

    let fetchApprovers;

    if (validation.fails()) {
      fetchApprovers = await invtDB.query(
        `
        SELECT * 
        FROM temp_approvers 
        WHERE line = :line AND module = :module AND action = :action
      `,
        {
          replacements: {
            line: "0",
            module: "BOM",
            action: "CREATE",
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      // If validation succeeds, select with MAX(bomUpdateStage)
      fetchApprovers = await invtDB.query(
        `
        SELECT * 
        FROM temp_approvers 
        WHERE line = :line AND module = :module AND action = :action 
        AND bomUpdateStage = (SELECT MAX(bomUpdateStage) FROM temp_approvers WHERE line = :line AND module = :module AND action = :action)
      `,
        {
          replacements: {
            line: "0",
            module: "BOM",
            action: "CREATE",
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    let result = [];

    // Loop through each approver and fetch details from admin_login
    for (let i = 0; i < fetchApprovers.length; i++) {
      const userDetails = await invtDB.query(
        `
        SELECT user_name, Email_ID 
        FROM admin_login 
        WHERE CustID = :userID
      `,
        {
          replacements: {
            userID: fetchApprovers[i].userID,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      result.push({
        crnID: fetchApprovers[i].userID,
        name: userDetails[0]?.user_name || "Unknown",
        email: userDetails[0]?.Email_ID || "Unknown",
        stage: +fetchApprovers[i].stage.split("").splice(1).join(""),
      });
    }

    // Send successful response with fetched data
    return res.json({
      success: true,
      data: result,
      status: "success",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

var BomStorage = multer.diskStorage({
  destination: (req, file, callback) => {
    const uploadPath = `./uploads/bomdocs`;

    callback(null, uploadPath);
  },
  filename: (req, file, callback) => {
    callback(
      null,
      "DOC" +
        "-" +
        helper.getUniqueNumber() +
        helper.randomNumber(100, 999) +
        path.extname(file.originalname)
    );
  },
});

var bomDocsUpload = multer({ storage: BomStorage }).fields([
  { name: "documents", maxCount: 4 },
]);

//bom for temp product
router.post(
  "/tempProduct",
  [auth.isAuthorized],
  bomDocsUpload,
  async (req, res) => {
    let transaction = await invtDB.transaction();
    let otherTransaction = await otherDB.transaction();
    try {
      const validation = new Validator(req.body, {
        name: "required",
        sku: "required",
        description: "required",
        components: "required",
        version: "required",
        approvalMetrics: "required",
      });

      if (validation.fails()) {
        await transaction.rollback();
        await otherTransaction.rollback();
        return res.json({
          success: false,
          message: helper.firstErrorValidatorjs(validation),
          status: "error",
        });
      }

      let version = req.body.version;

      const checkProduct = await invtDB.query(
        "SELECT * FROM temp_product_master WHERE product_sku = :product_sku AND isActive = 'true'",
        {
          replacements: { product_sku: req.body.sku },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (checkProduct.length == 0) {
        return res.json({
          success: false,
          status: "error",
          message: "Product either not found or not approved yet",
        });
      }

      const fetchBom = await invtDB.query(
        "SELECT * FROM temp_bom WHERE productSku = :productSku",
        {
          replacements: { productSku: req.body.sku },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (fetchBom.length > 0) {
        if (
          fetchBom[fetchBom.length - 1].isRejected != "true" &&
          fetchBom[fetchBom.length - 1].isActive != "true" &&
          fetchBom[fetchBom.length - 1].isDraft != "true"
        ) {
          return res.json({
            success: false,
            status: "error",
            message:
              "Previous BOM of this product should be rejected or approved to create new version",
          });
        }

        if (fetchBom[fetchBom.length - 1].insertedBy != req.logedINUser) {
          return res.json({
            success: false,
            status: "error",
            message: "You are not allowed to create new version",
          });
        }

        if (fetchBom[fetchBom.length - 1].isDraft == "true") {
          const deleteBom = await invtDB.query(
            "DELETE FROM `temp_bom` WHERE `bomID` = :bomID",
            {
              replacements: { bomID: fetchBom[fetchBom.length - 1].bomID },
              type: invtDB.QueryTypes.DELETE,
            }
          );

          const deleteBomComponent = await invtDB.query(
            "DELETE FROM `temp_bom_recipe` WHERE `bomID` = :bomID",
            {
              replacements: { bomID: fetchBom[fetchBom.length - 1].bomID },
              type: invtDB.QueryTypes.DELETE,
            }
          );

          const deleteApprovers = await invtDB.query(
            "DELETE FROM temp_approvers WHERE transactionID = :transactionID",
            {
              replacements: {
                transactionID: fetchBom[fetchBom.length - 1].bomID,
              },
              type: invtDB.QueryTypes.DELETE,
            }
          );
        }
      }

      const bomID = helper.getUniqueNumber();
      let documents = "";

      if (req.files?.documents?.length > 0) {
        for (let i = 0; i < req.files?.documents?.length; i++) {
          const file = req.files?.documents[i];
          documents += file.filename + ",";
        }
      }

      const insertBom = await invtDB.query(
        "INSERT INTO temp_bom (name , description , bomID , productSku , insertedBy , insertedAt , bomStage , version , attachments , isDraft) VALUES (:name , :description , :bomID , :productSku , :insertedBy , :insertedAt , :bomStage , :version , :attachments , 'false')",
        {
          replacements: {
            name: req.body.name,
            description: req.body.description,
            bomID: bomID,
            productSku: req.body.sku,
            insertedBy: req.logedINUser,
            insertedAt: moment().format("YYYY-MM-DD HH:mm:ss"),
            bomStage: "0",
            version: version,
            attachments: documents,
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: transaction,
        }
      );

      const components = JSON.parse(req.body.components);

      if (components.length <= 0) {
        await transaction.rollback();
        await otherTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Kindly add at least one component",
        });
      }

      const componentValidation = new Validator(components, {
        "components.*.component": "required",
        "components.*.qty": "required",
        "components.*.location": "required",
        "components.*.type": "required",
      });

      if (componentValidation.fails()) {
        await transaction.rollback();
        await otherTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: helper.firstErrorValidatorjs(componentValidation),
        });
      }

      for (let i = 0; i < components.length; i++) {
        const fetchComp = await invtDB.query(
          "SELECT components.* , rm_categories.rm_cat_name AS categoryName FROM `components` LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category WHERE component_key = :componentKey",
          {
            replacements: { componentKey: components[i].component },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (fetchComp.length <= 0) {
          await transaction.rollback();
          await otherTransaction.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "Component not found-" + components[i].component,
          });
        }

        if (
          (fetchComp[0].manufacturing_code == null ||
            fetchComp[0].manufacturing_code == "") &&
          fetchComp[0].categoryName != "Other"
        ) {
          return res.json({
            success: false,
            status: "error",
            message: `Component (${fetchComp[0].c_part_no}) does not have manufacturing code, please update it in components master.`,
          });
        }

        if (
          components[i].substitute != null &&
          components[i].substitute != "" &&
          components[i].substitute != undefined
        ) {
          const fetchCompSub = await invtDB.query(
            "SELECT * FROM components WHERE component_key = :componentKey",
            {
              replacements: { componentKey: components[i].substitute },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (fetchCompSub.length <= 0) {
            await transaction.rollback();
            await otherTransaction.rollback();
            return res.json({
              success: false,
              status: "error",
              message: "Substitute component not found",
            });
          }
        }

        const componentID = helper.getUniqueNumber();

        const insertComp = await invtDB.query(
          "INSERT INTO temp_bom_recipe (componentKey , bomID , qty , remarks , type , substitute , status , insertedAt , insertedBy , componentID , vendor , location ) VALUES (:componentKey , :bomID , :qty , :remarks , :type , :substitute , :status , :insertedAt , :insertedBy , :componentID , :vendor , :location)",
          {
            replacements: {
              componentKey: components[i].component,
              bomID: bomID,
              qty: components[i].qty,
              remarks: components[i].remarks ?? "",
              type: components[i].type,
              substitute: components[i].substitute ?? "",
              status: components[i].status,
              insertedAt: moment().format("YYYY-MM-DD HH:mm:ss"),
              insertedBy: req.logedINUser,
              componentID: componentID,
              vendor: components[i].vendor ?? "",
              location: components[i].location,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );

        if (insertComp.length <= 0) {
          await transaction.rollback();
          await otherTransaction.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "Error while creating BOM",
          });
        }
      }

      let approvalMetrics = JSON.parse(req.body.approvalMetrics);
      let approvalNumber = 0;

      for (let i = 0; i < approvalMetrics.length; i++) {
        let approvers = approvalMetrics[i].approvers;

        for (let j = 0; j < approvers.length; j++) {
          const userID = approvers[j].user.value; // Extract user value

          const insertApprovers = await invtDB.query(
            "INSERT INTO temp_approvers (userID , stage , line , approvalNumber , module , transactionID , action) VALUES(:userID , :stage , :line , :approvalNumber , :module , :transactionID , :action)",
            {
              replacements: {
                userID: userID,
                stage: approvalMetrics[i].stage,
                line: approvers[j].line,
                approvalNumber: ++approvalNumber,
                module: "BOM",
                transactionID: bomID,
                action: "CREATE",
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: transaction,
            }
          );
        }
      }

      const fetchApproverEmail = await invtDB.query(
        "SELECT * FROM admin_login WHERE CustID = :userID",
        {
          replacements: { userID: approvalMetrics[0].approvers[0].user.value }, // Extract user value
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (fetchApproverEmail.length <= 0) {
        return res.json({
          success: false,
          status: "error",
          message: "Approver not found",
        });
      }

      const mailReferenceID = helper.getUniqueNumber();

      const emailMessage = `
      <p>New BOM has been created for the following product:</p>
      <p><strong>BOM Name:</strong> ${req.body.name}</p>
      <p><strong>Product Name:</strong> ${checkProduct[0].product_name}</p>
      <p><strong>SKU:</strong> ${checkProduct[0].product_sku}</p>
      <p><strong>Description:</strong> ${req.body.description}</p>
      <p><strong>Version:</strong> ${version}</p>
      <p>Please review and approve the BOM at your earliest convenience.</p>
    `;

      const insertMail = await otherDB.query(
        "INSERT INTO mails_log (referenceID , status , mail_to , subject , message , sent_dt) VALUES(:referenceID , :status , :mail_to , :subject , :message , :sent_dt)",
        {
          replacements: {
            referenceID: mailReferenceID,
            status: "success",
            success: true,
            mail_to: fetchApproverEmail[0].Email_ID,
            subject: "Approval for new BOM",
            message: emailMessage,
            sent_dt: moment(new Date())
              .tz("Asia/Kolkata")
              .format("YYYY-MM-DD HH:mm:ss"),
          },
          type: otherDB.QueryTypes.INSERT,
          transaction: otherTransaction,
        }
      );

      const sendEmail = await helper.sendMail(
        fetchApproverEmail[0].Email_ID,
        null,
        "Approval for new BOM",
        emailMessage
      );

      await transaction.commit();
      await otherTransaction.commit();
      return res.json({
        success: true,
        status: "success",
        message: "BOM created and sent for approval",
      });
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

// Update Temp BOM
router.post(
  "/tempProduct/update/:bomID",
  [auth.isAuthorized],
  bomDocsUpload,
  async (req, res) => {
    let transaction = await invtDB.transaction();
    let otherTransaction = await otherDB.transaction();
    try {
      const validation = new Validator(req.body, {
        name: "required",
        sku: "required",
        description: "required",
        components: "required",
        approvalMetrics: "required",
      });

      if (validation.fails()) {
        await transaction.rollback();
        await otherTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: helper.firstErrorValidatorjs(validation),
        });
      }

      let version = req.body.version;
      const checkProduct = await invtDB.query(
        "SELECT * FROM temp_product_master WHERE product_sku = :product_sku AND isActive = 'true'",
        {
          replacements: { product_sku: req.body.sku },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (checkProduct.length == 0) {
        return res.json({
          success: false,
          status: "error",
          message: "Product either not found or not approved yet",
        });
      }

      const fetchBom = await invtDB.query(
        "SELECT * FROM temp_bom WHERE bomID = :bomID",
        {
          replacements: { bomID: req.params.bomID },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (fetchBom.length == 0) {
        return res.json({
          success: false,
          status: "error",
          message: "BOM not found",
        });
      }

      if (
        fetchBom[fetchBom.length - 1].isActive == "true" &&
        fetchBom[fetchBom.length - 1].isDraft == "true"
      ) {
        return res.json({
          success: false,
          status: "error",
          message:
            "Previous BOM of this product should be rejected or approved to create new version",
        });
      }

      if (fetchBom[fetchBom.length - 1].insertedBy != req.logedINUser) {
        return res.json({
          success: false,
          status: "error",
          message: "You are not allowed to create new version",
        });
      }

      if (fetchBom[fetchBom.length - 1].isDraft == "true") {
        const deleteBom = await invtDB.query(
          "DELETE FROM `temp_bom` WHERE `bomID` = :bomID",
          {
            replacements: { bomID: fetchBom[fetchBom.length - 1].bomID },
            type: invtDB.QueryTypes.DELETE,
          }
        );

        const deleteBomComponent = await invtDB.query(
          "DELETE FROM `temp_bom_recipe` WHERE `bomID` = :bomID",
          {
            replacements: { bomID: fetchBom[fetchBom.length - 1].bomID },
            type: invtDB.QueryTypes.DELETE,
          }
        );

        const deleteApprovers = await invtDB.query(
          "DELETE FROM temp_approvers WHERE transactionID = :transactionID",
          {
            replacements: {
              transactionID: fetchBom[fetchBom.length - 1].bomID,
            },
            type: invtDB.QueryTypes.DELETE,
          }
        );
      }

      // UPDATE BOM
      let documents = "";
      if (req.files?.documents?.length > 0) {
        for (let i = 0; i < req.files?.documents?.length; i++) {
          const file = req.files?.documents[i];
          documents += file.filename + ",";
        }
      }
      const updateBom = await invtDB.query(
        "UPDATE temp_bom SET name = :name, description = :description, version = :version, attachments = :attachments, isRejected = 'false', attachments = :attachments WHERE bomID = :bomID",
        {
          replacements: {
            name: req.body.name,
            description: req.body.description,
            version: fetchBom[0].version,
            bomID: req.params.bomID,
            attachments: documents,
          },
          type: invtDB.QueryTypes.UPDATE,
        }
      );

      const components = JSON.parse(req.body.components);

      if (components.length <= 0) {
        await transaction.rollback();
        await otherTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Kindly add at least one component",
        });
      }

      const componentValidation = new Validator(components, {
        "components.*.component": "required",
        "components.*.qty": "required",
        "components.*.location": "required",
        "components.*.type": "required",
      });

      if (componentValidation.fails()) {
        await transaction.rollback();
        await otherTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: helper.firstErrorValidatorjs(componentValidation),
        });
      }

      for (let i = 0; i < components.length; i++) {
        const fetchComp = await invtDB.query(
          "SELECT components.* , rm_categories.rm_cat_name AS categoryName FROM `components` LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category WHERE component_key = :componentKey",
          {
            replacements: { componentKey: components[i].component },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (fetchComp.length <= 0) {
          await transaction.rollback();
          await otherTransaction.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "Component not found-" + components[i].component,
          });
        }

        const fetchExistingComponent = await invtDB.query(
          "SELECT * FROM temp_bom_recipe WHERE bomID = :bomID AND componentKey = :componentKey",
          {
            replacements: {
              bomID: req.params.bomID,
              componentKey: components[i].component,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (fetchExistingComponent.length > 0) {
          // If component exists, UPDATE
          const updateComp = await invtDB.query(
            "UPDATE temp_bom_recipe SET qty = :qty, remarks = :remarks, type = :type, substitute = :substitute, status = :status, vendor = :vendor, location = :location WHERE bomID = :bomID AND componentKey = :componentKey",
            {
              replacements: {
                qty: components[i].qty,
                remarks: components[i].remarks ?? "",
                type: components[i].type,
                substitute: components[i].substitute ?? "",
                status: components[i].status,
                vendor: components[i].vendor ?? "",
                location: components[i].location,
                bomID: req.params.bomID,
                componentKey: components[i].component,
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: transaction,
            }
          );
        } else {
          // If component doesn't exist, INSERT
          const componentID = helper.getUniqueNumber();
          const insertComp = await invtDB.query(
            "INSERT INTO temp_bom_recipe (componentKey, bomID, qty, remarks, type, substitute, status, insertedAt, insertedBy, componentID, vendor, location) VALUES (:componentKey, :bomID, :qty, :remarks, :type, :substitute, :status, :insertedAt, :insertedBy, :componentID, :vendor, :location)",
            {
              replacements: {
                componentKey: components[i].component,
                bomID: req.params.bomID,
                qty: components[i].qty,
                remarks: components[i].remarks ?? "",
                type: components[i].type,
                substitute: components[i].substitute ?? "",
                status: components[i].status,
                insertedAt: moment().format("YYYY-MM-DD HH:mm:ss"),
                insertedBy: req.logedINUser,
                componentID: fetchComp[0].componentID ?? componentID,
                vendor: components[i].vendor ?? "",
                location: components[i].location,
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: transaction,
            }
          );

          if (insertComp.length <= 0) {
            await transaction.rollback();
            await otherTransaction.rollback();
            return res.json({
              success: false,
              status: "error",
              message: "Error while creating BOM",
            });
          }
        }
      }

      let approvalMetrics = JSON.parse(req.body.approvalMetrics);
      let approvalNumber = 0;

      for (let i = 0; i < approvalMetrics.length; i++) {
        let approvers = approvalMetrics[i].approvers;

        for (let j = 0; j < approvers.length; j++) {
          const userID = approvers[j].user.value; // Extract user value

          const insertApprovers = await invtDB.query(
            "INSERT INTO temp_approvers (userID , stage , line , approvalNumber , module , transactionID , action) VALUES(:userID , :stage , :line , :approvalNumber , :module , :transactionID , :action)",
            {
              replacements: {
                userID: userID,
                stage: approvalMetrics[i].stage,
                line: approvers[j].line,
                approvalNumber: ++approvalNumber,
                module: "BOM",
                transactionID: req.params.bomID,
                action: "CREATE",
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: transaction,
            }
          );
        }
      }

      const fetchApproverEmail = await invtDB.query(
        "SELECT * FROM admin_login WHERE CustID = :userID",
        {
          replacements: { userID: approvalMetrics[0].approvers[0].user.value }, // Extract user value
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (fetchApproverEmail.length <= 0) {
        return res.json({
          success: false,
          status: "error",
          message: "Approver not found",
        });
      }

      const mailReferenceID = helper.getUniqueNumber();
      const emailMessage = `
      <p>BOM has been updated for the following product:</p>
      <p><strong>BOM Name:</strong> ${req.body.name}</p>
      <p><strong>Product Name:</strong> ${checkProduct[0].product_name}</p>
      <p><strong>SKU:</strong> ${checkProduct[0].product_sku}</p>
      <p><strong>Description:</strong> ${req.body.description}</p>
      <p><strong>Version:</strong> ${version}</p>
      <p>Please review and approve the BOM at your earliest convenience.</p>
    `;

      const insertMail = await otherDB.query(
        "INSERT INTO mails_log (referenceID , status , mail_to , subject , message , sent_dt) VALUES(:referenceID , :status , :mail_to , :subject , :message , :sent_dt)",
        {
          replacements: {
            referenceID: mailReferenceID,
            status: "success",
            success: true,
            mail_to: fetchApproverEmail[0].Email_ID,
            subject: "Approval for new BOM",
            message: emailMessage,
            sent_dt: moment(new Date())
              .tz("Asia/Kolkata")
              .format("YYYY-MM-DD HH:mm:ss"),
          },
          type: otherDB.QueryTypes.INSERT,
          transaction: otherTransaction,
        }
      );

      const sendEmail = await helper.sendMail(
        fetchApproverEmail[0].Email_ID,
        null,
        "Approval for new BOM",
        emailMessage
      );

      await transaction.commit();
      await otherTransaction.commit();
      return res.json({
        success: true,
        status: "success",
        message: "BOM created and sent for approval",
      });
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

// version 2 [15-07-2022] // Created by Shiv
// Requirement: Fetch BOM details according to product and version code

router.get("/checkExisting", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      sku: "required",
      version: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    const fetchBom = await invtDB.query(
      "SELECT temp_bom.*, (SELECT version FROM temp_bom WHERE productSku = :productSku ORDER BY ID DESC LIMIT 1) AS latest_version FROM temp_bom WHERE productSku = :productSku AND version = :version ORDER BY ID DESC LIMIT 1",
      {
        replacements: {
          productSku: req.query.sku,
          version: req.query.version,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let result = [];

    if (fetchBom.length <= 0) {
      return res.json({
        success: true,
        data: null,
      });
    } else if (
      fetchBom[0].isActive == "false" &&
      fetchBom[0].isRejected == "false" &&
      fetchBom[0].isDraft == "false"
    ) {
      return res.json({
        success: true,
        data: {
          data: "statusPending",
          code: 417,
        },
        message:
          "Kindly Approve that Previous Version of this BOM to create a new one",
      });
    } else if (
      fetchBom[0].isRejected == "true" &&
      fetchBom[0].insertedBy !== req.logedINUser
    ) {
      return res.json({
        success: false,
        code: "NTVALID",
        message: "You have permission to edit this BOM",
      });
    }

    for (let i = 0; i < fetchBom.length; i++) {
      const fetch = await invtDB.query(
        "SELECT * FROM temp_bom_recipe WHERE bomID = :bomID",
        {
          replacements: { bomID: fetchBom[i].bomID },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let componentResult = [];

      if (fetch.length > 0) {
        for (let j = 0; j < fetch.length; j++) {
          const component = await invtDB.query(
            "SELECT components.c_part_no, components.c_name, components.attribute_code, components.manufacturing_code, rm_categories.rm_cat_name FROM components LEFT JOIN rm_categories ON components.c_attr_category = rm_categories.rm_cat_key WHERE components.component_key = :component_key",
            {
              replacements: {
                component_key: fetch[j].componentKey,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (component.length == 0) {
            return res.json({
              success: false,
              data: result,
              message: "Components not found in master",
            });
          }
          let substitute;

          if (
            fetch[j].substitute != null &&
            fetch[j].substitute != "" &&
            fetch[j].substitute != undefined
          ) {
            substitute = await invtDB.query(
              "SELECT * FROM components WHERE component_key = :component_key",
              {
                replacements: {
                  component_key: fetch[j].substitute,
                },
                type: invtDB.QueryTypes.SELECT,
              }
            );
          }

          const fetchVendor = await invtDB.query(
            "SELECT * FROM ven_basic_detail WHERE ven_register_id = :ven_register_id",
            {
              replacements: {
                ven_register_id: fetch[j].vendor,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (fetchVendor.length > 0) {
            fetch[j].vendor = fetchVendor[0].ven_name;
          }

          componentResult.push({
            component: {
              text: component[0].c_name,
              value: fetch[j].componentKey,
              partCode: component[0].c_part_no,
              manufacturingCode: component[0].manufacturing_code,
              category: component[0].rm_cat_name,
            },
            quantity: fetch[j].qty,
            remarks: fetch[j].remarks,
            type: fetch[j].type,
            category: fetch[j].c_category,
            substituteOf: fetch[j].substitute
              ? {
                  text: substitute[0].c_name,
                  value: fetch[j].substitute,
                  partCode: substitute[0].c_part_no,
                }
              : null,
            status: fetch[j].status,
            createdAt: moment(fetch[j].insertedAt).format("DD-MM-YYYY"),
            vendor: fetch[j].vendor ?? "--",
            location: fetch[j].location ?? "--",
            componentUniqueID: component[0].attribute_code ?? "--",
          });
        }
      } else {
        return res.json({
          success: false,
          status: "error",
          message: "no BOM found with this version",
        });
      }

      const documents = fetchBom[i].attachments?.split(",");

      const fetchProduct = await invtDB.query(
        "SELECT * FROM temp_product_master WHERE product_sku = :product_sku",
        {
          replacements: {
            product_sku: fetchBom[i].productSku,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (fetchProduct.length <= 0) {
        return res.json({
          success: false,
          status: "error",
          message: "Product not found",
        });
      }

      result.push({
        isRejected: fetchBom[0].isRejected,
        name: fetchBom[i].name,
        description: fetchBom[i].description,
        sku: {
          text:
            fetchProduct[0].product_sku + "-" + fetchProduct[0].product_name,
          value: fetchProduct[0].product_sku,
        },
        selectedversion: fetchBom[i].version,
        latestVersion: fetchBom[i].latest_version,
        bomID: fetchBom[i].bomID,
        components: componentResult,
        documents:
          documents?.length > 0
            ? documents
                .filter((value) => value !== "")
                .map((item) => {
                  return {
                    url: `${process.env.API_URL}/uploads/bomdocs/` + item,
                    fileName: item,
                  };
                })
            : [],
        isDraft: fetchBom[i].isDraft === "true",
      });
    }

    return res.json({
      success: true,
      data: result,
      status: "success",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//fetch bom
router.get("/fetch", [auth.isAuthorized], async (req, res) => {
  try {
    const fetchBom = await invtDB.query(
      "SELECT temp_bom.*, temp_product_master.product_name FROM temp_bom LEFT JOIN temp_product_master  ON temp_product_master.product_sku = temp_bom.productSku WHERE temp_bom.isDraft = 'false'",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let result = [];

    if (fetchBom.length <= 0) {
      return res.json({
        success: true,
        data: result,
        status: "success",
      });
    }

    for (let i = 0; i < fetchBom.length; i++) {
      let bomStage = Number(fetchBom[i].bomStage) + 1;

      const fetchApprover = await invtDB.query(
        "SELECT userID , adminTable.Email_ID , adminTable.user_name FROM temp_approvers LEFT JOIN admin_login AS adminTable ON adminTable.CustID = temp_approvers.userID WHERE approvalNumber = :approvalNumber AND module = :module AND action = :action AND transactionID = :transactionID",
        {
          replacements: {
            approvalNumber: bomStage,
            module: "BOM",
            action: "CREATE",
            transactionID: fetchBom[i].bomID,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      const documents = fetchBom[i].attachments?.split(",");

      result.push({
        name: fetchBom[i].name,
        description: fetchBom[i].description,
        bomID: fetchBom[i].bomID,
        sku: fetchBom[i].productSku,
        productName: fetchBom[i].product_name,
        createdAt: moment(fetchBom[i].insertedAt).format("DD-MM-YYYY"),
        currentApprover: fetchApprover[0]?.user_name ?? null,
        version: fetchBom[i].version,
        status: (() => {
          if (
            fetchBom[i].isActive == "false" &&
            fetchBom[i].isRejected == "false"
          ) {
            return "PENDING";
          } else if (
            fetchBom[i].isActive == "true" &&
            fetchBom[i].isRejected == "false"
          ) {
            return "CLOSED";
          } else if (
            fetchBom[i].isActive == "false" &&
            fetchBom[i].isRejected == "true"
          ) {
            return "REJECTED";
          }
          return null;
        })(),
        version: fetchBom[i].version,
        documents:
          documents?.length > 0
            ? documents
                .filter((value) => value !== "")
                .map((item) => {
                  return {
                    url: `${process.env.API_URL}/uploads/bomdocs/` + item,
                    fileName: item,
                  };
                })
            : [],
      });
    }

    return res.json({
      success: true,
      data: result,
      status: "success",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//fetch bom components
router.get("/fetch/:bomID", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.params, {
      bomID: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    const fetch = await invtDB.query(
      "SELECT * FROM temp_bom_recipe WHERE bomID = :bomID",
      {
        replacements: {
          bomID: req.params.bomID,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let result = [];

    if (fetch.length <= 0) {
      return res.json({
        success: false,
        status: "error",
        message: "Components not found",
      });
    }

    for (let i = 0; i < fetch.length; i++) {
      const component = await invtDB.query(
        "SELECT * FROM components WHERE component_key = :component_key",
        {
          replacements: {
            component_key: fetch[i].componentKey,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (component.length == 0) {
        return res.json({
          success: false,
          status: "success",
          message: "Components not found in master",
        });
      }

      let substitute;

      if (
        fetch[i].substitute != null &&
        fetch[i].substitute != "" &&
        fetch[i].substitute != undefined
      ) {
        substitute = await invtDB.query(
          "SELECT * FROM components WHERE component_key = :component_key",
          {
            replacements: {
              component_key: fetch[i].substitute,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      }

      const fetchVendor = await invtDB.query(
        "SELECT * FROM ven_basic_detail WHERE ven_register_id = :ven_register_id",
        {
          replacements: {
            ven_register_id: fetch[i].vendor,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (fetchVendor.length > 0) {
        fetch[i].vendor = fetchVendor[0].ven_name;
      }

      result.push({
        component: {
          text: component[0].c_name,
          value: fetch[i].componentID,
          partCode: component[0].c_part_no,
        },
        quantity: fetch[i].qty,
        remarks: fetch[i].remarks,
        type: fetch[i].type,
        substituteOf: fetch[i].substitute
          ? {
              text: substitute[0].c_name,
              value: fetch[i].substitute,
              partCode: substitute[0].c_part_no,
            }
          : null,
        status: fetch[i].status,
        createdAt: moment(fetch[i].insertedAt).format("DD-MM-YYYY"),
        vendor: fetch[i].vendor ?? "--",
        location: fetch[i].location ?? "--",
        componentUniqueID: component[0].attribute_code ?? "--",
      });
    }

    return res.json({
      success: true,
      data: result,
      status: "success",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// FETCH Rejection API
router.get("/fetchRejection", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      bomID: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    const fetchRejection = await invtDB.query(
      ` SELECT * FROM  temp_rnd_activity WHERE ref_id = :bomID ORDER BY ID DESC`,
      {
        replacements: {
          bomID: req.query.bomID,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (fetchRejection.length > 0) {
      const formattedData = await Promise.all(
        fetchRejection.map(async (row) => {
          const description = JSON.parse(row.description);
          const formattedDescription = await Promise.all(
            description.map(async (item) => {
              const userResult = await invtDB.query(
                "SELECT user_name FROM admin_login WHERE CustID = :userId",
                {
                  replacements: { userId: item.userId },
                  type: invtDB.QueryTypes.SELECT,
                }
              );

              const userName =
                userResult.length > 0 ? userResult[0].user_name : null;

              return {
                stage: item.stage,
                status:
                  item.status == "pending"
                    ? "STOPPED"
                    : item.status == "false"
                    ? "Rejected"
                    : "Approved",
                userId: item.userId,
                userName: userName,
                line: item.line,
                remark: item.remark,
                remarkDt: moment(item.remarkDt, "YYYY-MM-DD HH:mm:ss").format(
                  "DD-MM-YYYY HH:mm:ss"
                ),
              };
            })
          );

          return {
            insert_dt: moment(row.insert_dt, "YYYY-MM-DD HH:mm:ss").format(
              "DD-MM-YYYY HH:mm:ss"
            ),
            description: formattedDescription,
            CustID: row.CustID,
            CustName: row.user_name,
          };
        })
      );

      return res.json({
        success: true,
        data: formattedData,
      });
    } else {
      return res.json({
        success: false,
        message: "No logs found",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//approval for temp bom
router.patch(
  "/approve/temp/:stage/:line",
  [auth.isAuthorized],
  async (req, res) => {
    let transaction = await invtDB.transaction();
    let otherTransaction = await otherDB.transaction();
    try {
      const paramValidation = new Validator(req.params, {
        stage: "required|in:L1,L2,L3",
        line: "required",
      });
      if (paramValidation.fails()) {
        await transaction.rollback();
        await otherTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: helper.firstErrorValidatorjs(paramValidation),
        });
      }

      const validation = new Validator(req.body, {
        bomID: "required",
        status: "required",
        remarks: "required",
      });

      if (validation.fails()) {
        await transaction.rollback();
        await otherTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: helper.firstErrorValidatorjs(validation),
        });
      }

      const checkValidUser = await invtDB.query(
        "SELECT * FROM temp_approvers WHERE userID = :userID AND stage = :stage AND module = :module AND action = :action AND line = :line AND transactionID = :transactionID",
        {
          replacements: {
            userID: req.logedINUser,
            stage: req.params.stage,
            module: "BOM",
            action: "CREATE",
            line: req.params.line,
            transactionID: req.body.bomID,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (checkValidUser.length <= 0) {
        await transaction.rollback();
        await otherTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "You are not authorized to perform this action",
        });
      }

      let isRejected = "false";

      if (req.body.status === false) {
        isRejected = "true";
      }

      const fetchBom = await invtDB.query(
        "SELECT * FROM temp_bom WHERE bomID = :bomID",
        {
          replacements: {
            bomID: req.body.bomID,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (fetchBom.length <= 0) {
        await transaction.rollback();
        await otherTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "BOM not found",
        });
      }

      if (fetchBom[0].isRejected === "true") {
        await transaction.rollback();
        await otherTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "This BOM has already been rejected.",
        });
      }

      // add logic if already approved or already reject return error
      if (+fetchBom[0].bomStage + 1 != checkValidUser[0].approvalNumber) {
        await transaction.rollback();
        await otherTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "BOM already approved",
        });
      }

      const updateBom = await invtDB.query(
        "UPDATE temp_bom SET bomStage = :status, isRejected = :isRejected WHERE bomID = :bomID",
        {
          replacements: {
            status:
              req.body.status === true ? +checkValidUser[0].approvalNumber : 0,
            isRejected: isRejected,
            bomID: req.body.bomID,
          },
          type: invtDB.QueryTypes.UPDATE,
          transaction: transaction,
        }
      );

      const updateRemarks = await invtDB.query(
        "INSERT INTO temp_bom_remarks (transactionID , userID , remarks , userApprovalNumber , insertedAt , insertBy, stage, status) VALUES (:transactionID , :userID , :remarks , :userApprovalNumber , :insertedAt , :insertBy, :stage, :status)",
        {
          replacements: {
            transactionID: req.body.bomID,
            userID: req.logedINUser,
            remarks: req.body.remarks,
            userApprovalNumber: checkValidUser[0].approvalNumber,
            insertedAt: moment().format("YYYY-MM-DD HH:mm:ss"),
            insertBy: req.logedINUser,
            stage: fetchBom[0].bomStage,
            status: req.body.status,
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: transaction,
        }
      );

      if (updateRemarks.length <= 0) {
        await transaction.rollback();
        await otherTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Error while updating remarks",
        });
      }

      if (isRejected == "false") {
        const fetchNextApprover = await invtDB.query(
          "SELECT * FROM temp_approvers WHERE transactionID = :transactionID AND approvalNumber = :approvalNumber AND module = :module AND action = :action",
          {
            replacements: {
              transactionID: req.body.bomID,
              approvalNumber: +checkValidUser[0].approvalNumber + 1,
              module: "BOM",
              action: "CREATE",
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (fetchNextApprover.length > 0) {
          const fetchNextApproverEmail = await invtDB.query(
            "SELECT * FROM admin_login WHERE CustID = :userID",
            {
              replacements: { userID: fetchNextApprover[0].userID },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          const mailReferenceID = helper.getUniqueNumber();
          const emailBody = `
          <h2>BOM Approval Notification</h2>
          <p>Dear ${fetchNextApproverEmail[0].Name || "User"},</p>
          <p>BOM has been <strong>Approved</strong>. Below are the details:</p>
          <table border="1" cellpadding="5" cellspacing="0">
          <tr>
            <th>BOM Name</th>
            <td>${fetchBom[0].name}</td>
          </tr>
          <tr>
            <th>Product SKU</th>
            <td>${fetchBom[0].productSku}</td>
          </tr>
          <tr>
            <th>Version</th>
            <td>${fetchBom[0].version}</td>
          </tr>
          <tr>
            <th>Approval Stage</th>
            <td>${req.params.stage}</td>
          </tr>
          <tr>
            <th>Remarks</th>
            <td>${req.body.remarks}</td>
          </tr>
          <tr>
            <th>Approval Date</th>
            <td>${moment().format("YYYY-MM-DD HH:mm")}</td>
          </tr>
          </table>
          <p>Please review the remarks and make necessary adjustments.</p>
        `;
          const insertMail = await otherDB.query(
            "INSERT INTO mails_log (referenceID , status , mail_to , subject , message , sent_dt) VALUES( :referenceID , :status , :mail_to , :subject , :message , :sent_dt)",
            {
              replacements: {
                referenceID: mailReferenceID,
                status: "success",
                success: true,
                mail_to: fetchNextApproverEmail[0].Email_ID,
                subject: "BOM Approved",
                message: emailBody,
                sent_dt: moment(new Date())
                  .tz("Asia/Kolkata")
                  .format("YYYY-MM-DD HH:mm:ss"),
              },
              type: otherDB.QueryTypes.INSERT,
              transaction: otherTransaction,
            }
          );

          const sendEmail = await helper.sendMail(
            fetchNextApproverEmail[0].Email_ID,
            null,
            "BOM Approved",
            emailBody
          );
        } else {
          const updateBom = await invtDB.query(
            "UPDATE temp_bom SET isActive = :isActive WHERE bomID = :bomID",
            {
              replacements: {
                isActive: "true",
                bomID: req.body.bomID,
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: transaction,
            }
          );
        }
      } else {
        const fetchMaker = await invtDB.query(
          "SELECT * FROM admin_login WHERE CustID = :userID",
          {
            replacements: { userID: fetchBom[0].insertedBy },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        const mailReferenceID = helper.getUniqueNumber();
        const emailBody = `
          <h2>BOM Rejection Notification</h2>
          <p>Dear ${fetchMaker[0].Name || "User"},</p>
          <p>BOM has been <strong>Rejected</strong>. Below are the details:</p>
          <table border="1" cellpadding="5" cellspacing="0">
          <tr>
            <th>BOM Name</th>
            <td>${fetchBom[0].name}</td>
          </tr>
          <tr>
            <th>Product SKU</th>
            <td>${fetchBom[0].productSku}</td>
          </tr>
          <tr>
            <th>Version</th>
            <td>${fetchBom[0].version}</td>
          </tr>
          <tr>
            <th>Rejection Stage</th>
            <td>${req.params.stage}</td>
          </tr>
          <tr>
            <th>Remarks</th>
            <td>${req.body.remarks}</td>
          </tr>
          <tr>
            <th>Rejection Date</th>
            <td>${moment().format("YYYY-MM-DD HH:mm")}</td>
          </tr>
          </table>
          <p>Please review the remarks and make necessary adjustments.</p>
        `;

        const insertMail = await otherDB.query(
          "INSERT INTO mails_log (referenceID , status , mail_to , subject , message , sent_dt) VALUES( :referenceID , :status , :mail_to , :subject , :message , :sent_dt)",
          {
            replacements: {
              referenceID: mailReferenceID,
              status: "success",
              success: true,
              mail_to: fetchMaker[0].Email_ID,
              subject: "BOM Rejected",
              message: emailBody,
              sent_dt: moment(new Date())
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD HH:mm:ss"),
            },
            type: otherDB.QueryTypes.INSERT,
            transaction: otherTransaction,
          }
        );

        const sendEmail = await helper.sendMail(
          fetchMaker[0].Email_ID,
          null,
          "BOM Rejected",
          emailBody
        );

        const fetchApproversLog = await invtDB.query(
          `SELECT temp_approvers.transactionID, 
                temp_approvers.stage, 
                temp_approvers.userID, 
                temp_approvers.line, 
                temp_bom_remarks.remarks, 
                temp_bom_remarks.insertedAt AS remarkDt 
          FROM temp_approvers 
          LEFT JOIN temp_bom_remarks 
          ON temp_bom_remarks.userApprovalNumber = temp_approvers.approvalNumber 
          AND temp_approvers.transactionID = temp_bom_remarks.transactionID 
          WHERE temp_approvers.transactionID = :transactionID 
          AND temp_approvers.module = 'BOM'`,
          {
            replacements: { transactionID: req.body.bomID },
            type: invtDB.QueryTypes.SELECT,
            transaction: transaction,
          }
        );

        if (fetchApproversLog.length > 0) {
          let logData = fetchApproversLog.map((approver, index) => {
            let status = "pending";

            if (approver.stage === req.body.stage) {
              status = req.body.status;
            } else if (
              index < fetchApproversLog.length - 1 &&
              fetchApproversLog[index + 1].stage === req.body.stage
            ) {
              status = true;
            }

            return {
              transactionID: approver.transactionID,
              stage: approver.stage,
              userId: approver.userID,
              line: approver.line,
              remark: approver.remarks || "",
              remarkDt: approver.remarkDt || "",
              status: status,
            };
          });

          const logDescription = JSON.stringify(logData);

          const insertLog = await invtDB.query(
            "INSERT INTO temp_rnd_activity (type, insert_dt, description, ref_id, insert_id) VALUES (:type, :insert_dt, :description, :ref_id, :insert_id)",
            {
              replacements: {
                type: "UPDATE BOM",
                insert_dt: moment().format("YYYY-MM-DD HH:mm:ss"),
                description: logDescription,
                ref_id: req.body.bomID,
                insert_id: req.logedINUser,
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: transaction,
            }
          );

          await invtDB.query(
            "DELETE FROM temp_bom_remarks WHERE transactionID = :transactionID",
            {
              replacements: {
                transactionID: req.body.bomID,
              },
              type: invtDB.QueryTypes.DELETE,
              transaction: transaction,
            }
          );

          await invtDB.query(
            "DELETE FROM temp_approvers WHERE transactionID = :transactionID AND module = :module",
            {
              replacements: {
                transactionID: req.body.bomID,
                module: "BOM",
              },
              type: invtDB.QueryTypes.DELETE,
              transaction: transaction,
            }
          );
        }
      }

      await transaction.commit();
      await otherTransaction.commit();
      return res.json({
        success: true,
        data: {
          type: req.body.status === true,
        },
        message:
          req.body.status === true
            ? "BOM approved successfully"
            : "BOM rejected successfully",
      });
    } catch (error) {
      console.log(error);
      return helper.errorResponse(res, error);
    }
  }
);

//fetch logs of Bom
async function transformData(data, approvalStage) {
  const result = [];
  const stagesMap = {};

  data.forEach((item) => {
    const {
      stage,
      line,
      userID,
      remarks,
      insertedAt,
      approverName,
      Email_ID,
      approvalNumber,
    } = item;
    if (!stagesMap[stage]) {
      stagesMap[stage] = {
        stage: stage,
        approvers: [],
      };
      result.push(stagesMap[stage]);
    }

    let currentApprover = false;

    if (approvalStage == approvalNumber) {
      currentApprover = true;
    }

    stagesMap[stage].approvers.push({
      line: parseInt(line),
      user: userID,
      remarks: remarks,
      remarksDate: insertedAt
        ? moment(insertedAt).format("DD-MM-YYYY hh:mm:ss")
        : null,
      approverName: approverName,
      Email_ID: Email_ID,
      approvalNumber: approvalNumber,
      currentApprover: currentApprover,
    });
  });

  return result;
}

router.get("/logs", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      bomID: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    const fetchLogs = await invtDB.query(
      "SELECT * FROM temp_bom WHERE bomID = :bomID",
      {
        replacements: {
          bomID: req.query.bomID,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (fetchLogs.length <= 0) {
      return res.json({
        success: false,
        status: "error",
        message: "BOM not found",
      });
    }

    const fetchUser = await invtDB.query(
      "SELECT user_name AS user FROM admin_login WHERE CustID = :user_id",
      {
        replacements: {
          user_id: fetchLogs[0].insertedBy,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (fetchUser.length <= 0) {
      return res.json({
        success: false,
        status: "error",
        message: "User not found",
      });
    }

    let result = [];

    const fetchApprover = await invtDB.query(
      "SELECT temp_approvers.userID , temp_approvers.stage , line , approvalNumber , adminTable.Email_ID , adminTable.user_name AS approverName , adminTable.department , adminTable.designation , remarksTable.remarks , remarksTable.insertedAt FROM temp_approvers LEFT JOIN admin_login AS adminTable ON adminTable.CustID = temp_approvers.userID LEFT JOIN temp_bom_remarks AS remarksTable ON remarksTable.transactionID = temp_approvers.transactionID AND remarksTable.userID = temp_approvers.userID AND remarksTable.userApprovalNumber = temp_approvers.approvalNumber WHERE module = :module AND action = :action AND temp_approvers.transactionID = :transactionID",
      {
        replacements: {
          module: "BOM",
          action: "CREATE",
          transactionID: req.query.bomID,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (fetchApprover.length <= 0) {
      return res.json({
        success: false,
        status: "error",
        message: "Approver not found",
      });
    }

    return res.json({
      success: true,
      data: {
        logs: await transformData(fetchApprover, +fetchLogs[0].bomStage + 1),
        details: {
          stage: +fetchLogs[0].bomStage + 1,
          createdBy: fetchUser[0].user,
          createdOn: moment(fetchLogs[0].insertDate).format(
            "DD-MM-YYYY hh:mm:ss"
          ),
          isRejected: fetchLogs[0].isRejected === "true",
        },
      },
      status: "success",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

var BomDocumentStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "files/excel/");
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});

var uploadDocument = multer({ storage: BomDocumentStorage });

//read bom file
router.post(
  "/getData",
  [auth.isAuthorized],
  uploadDocument.single("file"),
  async (req, res) => {
    try {
      const validation = new Validator(req, {
        file: "required",
      });

      if (validation.fails()) {
        return res.json({
          success: false,
          status: "error",
          message: helper.firstErrorValidatorjs(validation),
        });
      }

      const workbook = XLSX.readFile("files/excel/" + req.file.filename);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];

      const excelData = XLSX.utils.sheet_to_json(worksheet);

      if (excelData.length <= 0) {
        return res.json({
          success: false,
          status: "error",
          message: "File is empty",
        });
      }

      let result = [];

      for (let i = 0; i < excelData.length; i++) {
        // Validate Part No exists and is not empty
        if (
          !excelData[i]["Part No"] ||
          typeof excelData[i]["Part No"] !== "string" ||
          excelData[i]["Part No"].trim() === ""
        ) {
          return res.json({
            success: false,
            status: "error",
            message: `Part No is missing or invalid in row ${
              i + 1
            } of the Excel file.`,
          });
        }

        const fetchComponent = await invtDB.query(
          "SELECT components.*, rm_categories.rm_cat_name AS categoryName FROM `components` LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category WHERE `c_part_no` = :key AND `c_is_enabled` = 'Y'",
          {
            replacements: { key: excelData[i]["Part No"].trim() },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (fetchComponent.length <= 0) {
          return res.json({
            success: false,
            status: "error",
            message: `Part code (${excelData[i]["Part No"]}) is not valid or disabled for further transaction.`,
          });
        }

        let fetchSubstitute = [];
        if (
          excelData[i]["Type"] === "alternate" &&
          excelData[i]["Alternate of Part No"]
        ) {
          fetchSubstitute = await invtDB.query(
            "SELECT * FROM `components` WHERE `c_part_no` = :key AND `c_is_enabled` = 'Y'",
            {
              replacements: {
                key: excelData[i]["Alternate of Part No"].trim(),
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (fetchSubstitute.length <= 0) {
            return res.json({
              success: false,
              status: "error",
              message: `Alternate Part code (${excelData[i]["Alternate of Part No"]}) is not valid or disabled for further transaction.`,
            });
          }
        }

        let fetchVendor = [];
        if (excelData[i]["Vendor"]) {
          fetchVendor = await invtDB.query(
            "SELECT * FROM ven_basic_detail WHERE ven_register_id = :ven_register_id",
            {
              replacements: { ven_register_id: excelData[i]["Vendor"].trim() },
              type: invtDB.QueryTypes.SELECT,
            }
          );
        }

        result.push({
          partCode: {
            text: `${fetchComponent[0].c_name} - ${fetchComponent[0].c_part_no}`,
            value: fetchComponent[0].component_key,
            code: fetchComponent[0].c_part_no,
          },
          type: excelData[i]["Type"],
          alternateOfPartCode:
            excelData[i]["Type"] === "alternate" && fetchSubstitute.length > 0
              ? {
                  text: `${fetchSubstitute[0].c_name} - ${fetchSubstitute[0].c_part_no}`,
                  value: fetchSubstitute[0].component_key,
                }
              : null,
          vendor:
            fetchVendor.length > 0
              ? {
                  text: `${fetchVendor[0].ven_name} - ${fetchVendor[0].ven_register_id}`,
                  value: fetchVendor[0].ven_register_id,
                }
              : {
                  text: "--",
                  value: "NOT DECIDED",
                },
          make: excelData[i]["Make"] ?? "--",
          mpn: excelData[i]["MPN"] ?? "--",
          quantity: excelData[i]["Scale"] ?? "--",
          location: excelData[i]["Location"] ?? "--",
          remarks: excelData[i]["Remark"] ? excelData[i]["Remark"] : null,
          mfgCode:
            fetchSubstitute.length > 0
              ? fetchSubstitute[0].manufacturing_code ?? "--"
              : "--",
          compCategory: {
            text: fetchComponent[0].categoryName,
            value: fetchComponent[0].c_attr_category,
          },
          isSMT: fetchComponent[0].categoryName === "Other" ? false : true,
        });
      }

      return res.json({
        success: true,
        data: result,
        status: "success",
      });
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

//get bom sample file
router.get("/sampleFile", [auth.isAuthorized], async (req, res) => {
  try {
    const fetchComponents = await invtDB.query(
      "SELECT c_part_no AS 'Part No' , c_name AS 'Part Name' , manufacturing_code AS 'Manufacturing Code' , rm_categories.rm_cat_name AS 'Category' FROM components LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category WHERE c_is_enabled = 'Y'",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    const fetchVendors = await invtDB.query(
      "SELECT ven_register_id AS 'Vendor Code' , ven_name AS 'Vendor Name' FROM ven_basic_detail",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    const file = XLSX.readFile("./uploads/bomdocs/sampleBomFile.xlsx");

    const seetData = XLSX.utils.sheet_to_json(file.Sheets[file.SheetNames[0]]);
    const seet2data = XLSX.utils.sheet_to_json(file.Sheets[file.SheetNames[1]]);

    // console.table(seetData);
    // console.table(seet2data);

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      file.Sheets[file.SheetNames[1]],
      "Main Sheet"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      file.Sheets[file.SheetNames[0]],
      "Sample Sheet"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(fetchComponents),
      "Components"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(fetchVendors),
      "Vendors"
    );

    const fileName = "BOMSampleFile" + helper.getUniqueNumber() + ".xlsx";

    XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

    XLSX.writeFile(workbook, "./files/excel/" + fileName);
    return res.json({
      success: true,
      data: {
        fileName: fileName,
        url: `${process.env.API_URL}/files/excel/` + fileName,
      },
      status: "success",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//download excel for temp bom
router.get("/download/temp", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();
  try {
    const validation = new Validator(req.query, {
      bomID: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    const fetchBom = await invtDB.query(
      "SELECT * FROM temp_bom WHERE bomID = :bomID ",
      {
        type: invtDB.QueryTypes.SELECT,
        replacements: { bomID: req.query.bomID },
      }
    );

    if (fetchBom.length <= 0) {
      return res.json({
        success: true,
        status: "error",
        message: "No BOM found",
      });
    }

    let bomResult = [];
    let componentResult = [];

    for (let i = 0; i < fetchBom.length; i++) {
      const fetch = await invtDB.query(
        "SELECT * FROM temp_bom_recipe WHERE bomID = :bomID",
        {
          replacements: { bomID: fetchBom[i].bomID },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (fetch.length > 0) {
        for (let j = 0; j < fetch.length; j++) {
          const component = await invtDB.query(
            "SELECT * FROM components WHERE component_key = :component_key",
            {
              replacements: {
                component_key: fetch[j].componentKey,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let substitute;

          if (
            fetch[j].substitute != null &&
            fetch[j].substitute != "" &&
            fetch[j].substitute != undefined
          ) {
            substitute = await invtDB.query(
              "SELECT * FROM components WHERE component_key = :component_key",
              {
                replacements: {
                  component_key: fetch[j].substitute,
                },
                type: invtDB.QueryTypes.SELECT,
              }
            );
          }

          const fetchVendor = await invtDB.query(
            "SELECT * FROM ven_basic_detail WHERE ven_register_id = :ven_register_id",
            {
              replacements: {
                ven_register_id: fetch[j].vendor,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (fetchVendor.length > 0) {
            fetch[j].vendor = fetchVendor[0].ven_name;
          }

          componentResult.push({
            "S No": j + 1,
            "PART CODE": component[0].c_part_no,
            "COMPONENT NAME": component[0].c_name,
            "COMPONENT ATTRIBUTE CODE": component[0].attribute_code ?? "--",
            TYPE: fetch[j].type,
            LOCATION: fetch[j].location ?? "--",
            QUANTITY: fetch[j].qty,
            "SUBSTITUTE'S PART CODE": fetch[j].substitute
              ? substitute[0].c_part_no
              : null,
            "SUSTITUTE OF": fetch[j].substitute ? substitute[0].c_name : null,
            REMARK: fetch[j].remarks,
            "BOM ID": fetch[j].bomID,
            VENDOR: fetch[j].vendor ?? "--",
            STATUS: fetch[j].status,
          });
        }
      }

      bomResult.push({
        "BOM ID": fetchBom[i].bomID,
        NAME: fetchBom[i].name,
        DESCRIPTION: fetchBom[i].description,
        "PRODUCT SKU": fetchBom[i].productSku,
        VERSION: fetchBom[i].version,
        "BOM CURRENT STAGE": Number(fetchBom[i].bomStage) + 1,
        "IS REJECTED": fetchBom[i].isRejected,
      });
    }

    const filename = "tempBom" + helper.getUniqueNumber() + ".xlsx";

    const bomSheet = XLSX.utils.json_to_sheet(bomResult);
    const componentSheet = XLSX.utils.json_to_sheet(componentResult);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, bomSheet, "BOM");
    XLSX.utils.book_append_sheet(workbook, componentSheet, "Components");
    XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    XLSX.writeFile(workbook, "./uploads/bomdocs/" + filename);

    return res.json({
      success: true,
      data: {
        filename: filename,
        url: `${process.env.API_URL}/uploads/bomdocs/` + filename,
      },
      status: "success",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// Download attached file
// Function to format file sizes
const formatFileSize = (size) => {
  if (size < 1024) return `${size} Bytes`;
  else if (size < 1048576) return `${(size / 1024).toFixed(2)} KB`;
  else if (size < 1073741824) return `${(size / 1048576).toFixed(2)} MB`;
  return `${(size / 1073741824).toFixed(2)} GB`;
};
router.get("/view/attachment/:bomID", async (req, res) => {
  try {
    const { bomID } = req.params;

    const validation = new Validator({ bomID }, { bomID: "required" });
    if (validation.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: "BOM ID is required.",
      });
    }

    const result = await invtDB.query(
      "SELECT attachments FROM temp_bom WHERE bomID = :bomID",
      { replacements: { bomID }, type: invtDB.QueryTypes.SELECT }
    );

    if (result.length === 0) {
      return res.json({
        success: false,
        status: "error",
        message: "No attachments found for the specified BOM ID.",
      });
    }

    const attachments = result[0].attachments
      .split(",")
      .map((filename) => filename.trim())
      .filter((filename) => filename); // Filter out any empty strings

    const documentFolder = path.resolve(
      __dirname,
      "../../../../uploads/bomdocs"
    );

    const groupedAttachments = {
      documents: attachments
        .map((filename) => {
          const filePath = path.join(documentFolder, filename);
          if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            return {
              fileName: filename,
              filePath: `${process.env.API_URL}/uploads/bomdocs/${filename}`,
              fileSize: formatFileSize(stats.size),
            };
          }
          return null;
        })
        .filter(Boolean),
    };

    return res.json({
      success: true,
      data: groupedAttachments,
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

module.exports = router;
