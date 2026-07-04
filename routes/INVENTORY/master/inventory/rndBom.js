const express = require("express");
const router = express.Router();

const multer = require("multer");

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
let { invtDB, otherDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");
const fs = require("fs");
const path = require("path");

// GET PRODUCT LIST
router.get("/search/product", [auth.isAuthorized], async (req, res) => {
  try {
    let fetchProducts = [];
    if (req.query.search.length > 2) {
      fetchProducts = await invtDB.query(
        `SELECT product_name , product_sku , product_key FROM temp_product_master WHERE (product_name LIKE '%${req.query.search}%' OR product_sku LIKE '%${req.query.search}%') AND isActive = 'true'`,
        {
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else {
      fetchProducts = await invtDB.query(
        `SELECT product_name , product_sku , product_key FROM temp_product_master WHERE isActive = 'true' LIMIT 10`,
        {
          type: invtDB.QueryTypes.SELECT,
        },
      );
    }
    return res.json({
      success: true,
      data: fetchProducts.map((item) => {
        return {
          text: item.product_sku + " - " + item.product_name,
          value: item.product_key,
        };
      }),
      status: "success",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// CHECK VALID PRODUCT TO CREATE BOM
router.get("/validProduct/:id", auth.isAuthorized, async (req, res) => {
  try {
    // Check if the product exists
    const checkProduct = await invtDB.query(
      "SELECT * FROM temp_product_master WHERE product_key = :product_key AND isActive = 'true'",
      {
        replacements: { product_key: req.params.id },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (checkProduct.length <= 0) {
      return res.json({ message: "Product not found", success: false });
    }

    // Check BOM in main table
    let checkBom = await invtDB.query(
      `SELECT 
        tbl_rnd_bom_header.*, 
        temp_product_master.product_name, temp_product_master.product_sku
        FROM tbl_rnd_bom_header
      LEFT JOIN temp_product_master ON temp_product_master.product_key = tbl_rnd_bom_header.bom_product
      WHERE bom_product = :product_key 
      ORDER BY ID DESC 
      LIMIT 1`,
      {
        replacements: { product_key: req.params.id },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    let isDraft = false;

    // If no BOM found in main table, check in draft table
    if (checkBom.length === 0) {
      checkBom = await invtDB.query(
        `SELECT 
          draft_rnd_bom_header.*, 
          temp_product_master.product_name, temp_product_master.product_sku
        FROM draft_rnd_bom_header
        LEFT JOIN temp_product_master ON temp_product_master.product_key = draft_rnd_bom_header.bom_product
        WHERE bom_product = :product_key 
        ORDER BY ID DESC 
        LIMIT 1`,
        {
          replacements: { product_key: req.params.id },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (checkBom.length === 0) {
        return res.json({
          status: "success",
          success: true,
          message: "Data fetched successfully",
          data: { version: "1.0" },
        });
      }

      isDraft = true;
    }

    const bomData = checkBom[0];

    if (bomData.bom_insert_by !== req.logedINUser) {
      return res.json({
        message: "You are not authorized to create or edit this BOM",
        success: false,
      });
    }

    if (bomData.bom_status === "PENDING") {
      return res.json({ message: "BOM is in transit", success: false });
    }

    const bomHeaderDetails = {
      bomKey: bomData.bom_key,
      bomProduct: {
        id: bomData.bom_product,
        text: `(${bomData.product_sku}) ${bomData.product_name}`,
      },
      bomName: bomData.bom_name,
      bomRefNo: bomData.bom_ref_no,
      bomRef: bomData.bom_user_version,
      bomRemark: bomData.bom_reamrk,
      bomVersion: bomData.bom_version,
      bomDoc: bomData.bom_doc,
    };

    // Fetch BOM components from the correct table
    const componentsQuery = isDraft
      ? `SELECT 
            tbl_draft_rnd_bom_items.*, 
            altComp.c_part_no AS altCompPartNo, altComp.c_name AS altCompName,
            components.c_part_no , components.c_name , components.attribute_code, components.manufacturing_code, rm_categories.rm_cat_name , ven_name
        FROM tbl_draft_rnd_bom_items
        LEFT JOIN components ON components.component_key = tbl_draft_rnd_bom_items.bom_item
        LEFT JOIN components altComp ON altComp.component_key = tbl_draft_rnd_bom_items.bom_item_alt_of
        LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category
        LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = tbl_draft_rnd_bom_items.bom_item_vendor
        WHERE bom_key = :bom`
      : `SELECT 
            tbl_rnd_bom_items.*, 
            altComp.c_part_no AS altCompPartNo, altComp.c_name AS altCompName,
            components.c_part_no , components.c_name , components.attribute_code, components.manufacturing_code, rm_categories.rm_cat_name , ven_name
            FROM tbl_rnd_bom_items
            LEFT JOIN components ON components.component_key = tbl_rnd_bom_items.bom_item
            LEFT JOIN components altComp ON altComp.component_key = tbl_rnd_bom_items.bom_item_alt_of
            LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category
            LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = tbl_rnd_bom_items.bom_item_vendor
        WHERE bom_key = :bom`;

    const components = await invtDB.query(componentsQuery, {
      replacements: { bom: bomData.bom_key },
      type: invtDB.QueryTypes.SELECT,
    });

    const compData = components.map((data) => ({
      key: data.bom_item,
      partno: data.c_part_no,
      name: data.c_name,
      make: data.bom_comp_make,
      mpn: data.bom_comp_mpn,
      type: data.bom_comp_type,
      altPartNo: data.altCompPartNo,
      altName: data.altCompName,
      altCompKey: data.bom_item_alt_of,
      placement: data.bom_item_placement,
      quantity: data.bom_item_qty,
      status: data.bom_item_status,
      attributeCode: data.attribute_code,
      manufacturingCode: data.manufacturing_code,
      catType: data.rm_cat_name,
      vendor: { code: data.bom_item_vendor, name: data.ven_name },
      remark: data.bom_item_remark,
    }));

    return res.json({
      status: "success",
      success: true,
      message: "Data fetched successfully",
      data: { bomHeaderDetails, components: compData },
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

const BomStorage = multer.diskStorage({
  destination: (req, file, callback) => {
    const uploadPath = `./temp`;

    callback(null, uploadPath);
  },
  filename: (req, file, callback) => {
    callback(
      null,
      "DOC" +
        "-" +
        helper.getUniqueNumber() +
        helper.randomNumber(100, 999) +
        path.extname(file.originalname),
    );
  },
});
const bomDocsUpload = multer({ storage: BomStorage }).fields([
  { name: "documents", maxCount: 4 },
]);
// UPLOAD DOCS
router.post(
  "/uploadDocs",
  [auth.isAuthorized, bomDocsUpload],
  async (req, res) => {
    try {
      let filesLenth = req.files?.documents?.length || 0;

      if (filesLenth <= 0) {
        return res.json({
          success: false,
          message: "Please upload at least one file",
        });
      }

      let files = [];
      if (filesLenth > 0) {
        for (let i = 0; i < filesLenth; i++) {
          files.push(req.files.documents[i].filename);
        }
      }
      // array to string
      res.json({ success: true, data: files });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  },
);

// CREATE BOM
router.post("/creatBom", [auth.isAuthorized], async (req, res) => {
  const validator = new Validator(req.body, {
    product: "required",
    bomName: "required",
    brn: "required",
    bomRef: "required",
    componets: "required|array",
    approvers: "required|array",
  });

  if (validator.fails()) {
    return res.status(500).send({
      status: false,
      message: helper.firstErrorValidatorjs(validator),
    });
  }

  //   if (req.body.brn != "1.0") {
  //     const validParentid = new Validator(req.body, {
  //       oldbomId: "required",
  //     });
  //     if (validParentid.fails()) {
  //       return res.status(500).send({ status: false, message: helper.firstErrorValidatorjs(validParentid) });
  //     }
  //   }

  for (let i = 0; i < req.body.componets.length; i++) {
    const validatComp = new Validator(req.body.componets[i], {
      component: "required",
      quantity: "required",
      type: "required|in:main,alternate",
      placement: "required",
      make: "required",
      mpn: "required",
    });

    if (validatComp.fails()) {
      return res.status(500).send({
        status: false,
        message: helper.firstErrorValidatorjs(validatComp),
      });
    }
  }

  //   VALIDATE ALTERNATE
  for (let i = 0; i < req.body.componets.length; i++) {
    if (req.body.componets[i].type == "alternate") {
      const valid = new Validator(req.body.componets[i], {
        altComp: "required",
      });
      if (valid.fails()) {
        return res.status(500).send({
          status: false,
          message: helper.firstErrorValidatorjs(valid),
        });
      }

      if (req.body.componets[i].component == req.body.componets[i].altComp) {
        return res.status(500).send({
          status: false,
          message: "Main component and Alternate component can't be same",
        });
      }

      // CHECK ALTERNATE OF COMPONENT EXISTS IN COMPONENT
      if (
        !req.body.componets.find(
          (comp) => comp.component == req.body.componets[i].altComp,
        )
      ) {
        return res.status(500).send({
          status: false,
          success: false,
          message: "Alternate component not found in main component list",
        });
      }
    }
  }

  //   VALIDATE APPROVER
  if (req.body.approvers.length !== 3) {
    return res.status(500).send({
      status: false,
      success: false,
      message: "Approver Line should be 3",
    });
  }

  for (let i = 0; i < req.body.approvers.length; i++) {
    if (Array.isArray(req.body.approvers[i]) == false) {
      return res.status(500).send({
        status: false,
        message: `Approver Line ${i + 1} should be array`,
      });
    }
    if (req.body.approvers[i].length < 1) {
      return res.status(500).send({
        status: false,
        message: `Approver Line ${i + 1} should have at least one approver `,
      });
    }

    for (let j = 0; j < req.body.approvers[i].length; j++) {
      // APPROVER SHOULD ARRAY TYPE

      if (!req.body.approvers[i][j]) {
        return res
          .status(500)
          .send({ status: false, message: "Approver can't be empty" });
      }
    }
  }

  // CHECK APPROVER
  let allApproversId = [];

  for (let i = 0; i < req.body.approvers.length; i++) {
    for (let j = 0; j < req.body.approvers[i].length; j++) {
      allApproversId.push(req.body.approvers[i][j]);
    }
  }
  allApproversId = [...new Set(allApproversId)];
  const checkApprover = await invtDB.query(
    "SELECT * FROM admin_login WHERE CustID IN (:userID)",
    {
      replacements: { userID: allApproversId },
      type: invtDB.QueryTypes.SELECT,
    },
  );
  if (checkApprover.length != allApproversId.length) {
    return res.json({ success: false, message: "Approver not found" });
  }

  const transaction = await invtDB.transaction();

  try {
    // CHECH PRODUCT
    const checkProduct = await invtDB.query(
      "SELECT * FROM temp_product_master WHERE product_key = :product_key AND isActive = 'true'",
      {
        replacements: { product_key: req.body.product },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (checkProduct.length == 0) {
      await transaction.rollback();
      return res.json({
        success: false,
        message: "Product either not found or not approved yet",
      });
    }

    // CHECH BOM
    const checkBom = await invtDB.query(
      "SELECT * FROM tbl_rnd_bom_header WHERE bom_product = :product_key ORDER BY ID ASC",
      {
        replacements: { product_key: req.body.product },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (checkBom.length > 0) {
      // IF LAST BOM IS NOT CLOSED
      if (checkBom[checkBom.length - 1].bom_status != "CLOSED") {
        await transaction.rollback();
        return res.json({ success: false, message: "Last BOM is in transit" });
      }

      // IF LAST BOM CREATER IS NOT THE CURRENT USER
      if (checkBom[checkBom.length - 1].bom_insert_by != req.logedINUser) {
        await transaction.rollback();
        return res.json({
          success: false,
          message: "You are not authorized to create this BOM",
        });
      }
    }

    // CHECK BOM REF NO (VERSION)
    const checkBomRef = await invtDB.query(
      "SELECT * FROM tbl_rnd_bom_header WHERE bom_product = :product_key AND bom_ref_no = :bom_ref_no",
      {
        replacements: {
          bom_ref_no: req.body.brn,
          product_key: req.body.product,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (checkBomRef.length > 0) {
      await transaction.rollback();
      return res.json({ success: false, message: "BOM REF NO already exist" });
    }

    const bomKey = helper.getUniqueNumber();
    const inserBy = req.logedINUser;
    const insertDt = moment().format("YYYY-MM-DD HH:mm:ss");

    // CREATE BOM
    await invtDB.query(
      "INSERT INTO tbl_rnd_bom_header( bom_key, bom_parent_key, bom_product, bom_name, bom_ref_no, bom_user_version, bom_reamrk, bom_doc, bom_insert_by, bom_insert_dt) VALUES ( :bom_key, :bom_parent_key, :bom_product, :bom_name, :bom_ref_no, :bom_user_version, :bom_reamrk, :bom_doc, :bom_insert_by, :bom_insert_dt )",
      {
        replacements: {
          bom_key: bomKey,
          bom_parent_key: checkBom.length > 0 ? checkBom[0].bom_key : null,
          bom_product: req.body.product,
          bom_name: req.body.bomName,
          bom_ref_no: req.body.brn,
          bom_user_version: req.body.bomRef,
          bom_reamrk: req.body.bomRemark ?? "--",
          bom_doc: req.body?.bomDoc?.join(",") ?? null,
          bom_insert_by: inserBy,
          bom_insert_dt: insertDt,
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      },
    );

    const draftOrder = await invtDB.query(
      "SELECT * FROM draft_rnd_bom_header WHERE bom_product = :product_key AND bom_status = 'DRAFT'",
      {
        replacements: { product_key: req.body.product },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (draftOrder.length > 0) {
      await invtDB.query(
        "DELETE FROM draft_rnd_bom_header WHERE bom_product = :product_key AND bom_status = 'DRAFT'",
        {
          replacements: { product_key: req.body.product },
          type: invtDB.QueryTypes.DELETE,
          transaction: transaction,
        },
      );
      await invtDB.query(
        "DELETE FROM tbl_draft_rnd_bom_items WHERE bom_key = :bom_key",
        {
          replacements: { bom_key: draftOrder[0].bom_key },
          type: invtDB.QueryTypes.DELETE,
          transaction: transaction,
        },
      );
    }

    // CREATE BOM ITEM
    for (let i = 0; i < req.body.componets.length; i++) {
      // CHECK COMPONENT
      const checkComp = await invtDB.query(
        "SELECT components.* , rm_categories.rm_cat_name AS categoryName FROM `components` LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category WHERE component_key = :componentKey",
        {
          replacements: { componentKey: req.body.componets[i].component },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (checkComp.length == 0) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "Component not found",
        });
      }

      if (
        (checkComp[0].manufacturing_code == null ||
          checkComp[0].manufacturing_code == "") &&
        checkComp[0].categoryName != "Other"
      ) {
        return res.json({
          status: "error",
          success: false,
          message: `Component (${checkComp[0].c_part_no}) does not have manufacturing code, please update it in components master.`,
        });
      }

      if (req.body.componets[i].type == "alternate") {
        const valid = new Validator(req.body.componets[i], {
          altComp: "required",
        });
        if (valid.fails()) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: helper.firstErrorValidatorjs(valid),
          });
        }

        const checkAlt = await invtDB.query(
          "SELECT components.* , rm_categories.rm_cat_name AS categoryName FROM `components` LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category WHERE component_key = :componentKey",
          {
            replacements: {
              componentKey: req.body.componets[i].altComp,
            },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (checkAlt.length == 0) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Component not found",
          });
        }

        if (
          (checkAlt[0].manufacturing_code == null ||
            checkAlt[0].manufacturing_code == "") &&
          checkAlt[0].categoryName != "Other"
        ) {
          return res.json({
            status: "error",
            success: false,
            message: `Component (${checkAlt[0].c_part_no}) does not have manufacturing code, please update it in components master.`,
          });
        }
      }

      await invtDB.query(
        "INSERT INTO tbl_rnd_bom_items(bom_key, bom_item, bom_comp_type, bom_comp_make, bom_comp_mpn, bom_item_qty, bom_item_vendor, bom_item_placement, bom_item_remark, insert_by, insert_date, bom_item_alt_of) VALUES ( :bom_key, :bom_item, :bom_comp_type, :make, :mpn, :bom_item_qty, :bom_item_vendor, :bom_item_placement, :bom_item_remark, :insert_by, :insert_date, :bom_item_alt_of )",
        {
          replacements: {
            bom_key: bomKey,
            bom_item: req.body.componets[i].component,
            bom_comp_type: req.body.componets[i].type,
            make: req.body.componets[i].make ?? "--",
            mpn: req.body.componets[i].mpn ?? "--",
            bom_item_qty: req.body.componets[i].quantity,
            bom_item_vendor: req.body.componets[i].vendor ?? null,
            bom_item_placement: req.body.componets[i].placement,
            bom_item_remark: req.body.componets[i].remark ?? "--",
            insert_by: inserBy,
            insert_date: insertDt,
            bom_item_alt_of:
              req.body.componets[i].type == "alternate"
                ? req.body.componets[i].altComp
                : null,
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: transaction,
        },
      );
    }

    // CREATE APPROVERS
    for (let i = 0; i < req.body.approvers.length; i++) {
      for (let j = 0; j < req.body.approvers[i].length; j++) {
        const checkApprover = await invtDB.query(
          "SELECT * FROM admin_login WHERE CustID = :userID",
          {
            replacements: { userID: req.body.approvers[i][j] },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (checkApprover.length == 0) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: `Approver not found (in Line ${i + 1}, Stage ${j + 1})`,
          });
        }

        await invtDB.query(
          "INSERT INTO tbl_rnd_bom_approver( bom_key, line_no, stage_no, aprover) VALUES ( :bom_key, :line_no, :stage_no, :aprover)",
          {
            replacements: {
              bom_key: bomKey,
              line_no: i + 1,
              stage_no: j + 1,
              aprover: req.body.approvers[i][j],
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }
    }

    // SAVE LOG
    await invtDB.query(
      "INSERT INTO tbl_rnd_bom_log(module, refNo, ref_reamark , log_remark, insert_by, insert_dt) VALUES (:module, :refNo, :ref_reamark, :log_remark, :insert_by, :insert_dt)",
      {
        replacements: {
          module:
            checkBom.length > 0 ? "NEW VERSION BOM CREATED" : "NEW BOM CREATED",
          refNo: bomKey,
          ref_reamark:
            checkBom.length > 0 ? "NEW VERSION BOM CREATED" : "NEW BOM CREATED",
          log_remark: req.body.bomRemark ?? "--",
          insert_by: inserBy,
          insert_dt: insertDt,
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      },
    );

    // FOR MAIL
    const firstApprovarmailStmt = await invtDB.query(
      "SELECT * FROM admin_login WHERE CustID = :userID",
      {
        replacements: { userID: req.body.approvers[0][0] },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (firstApprovarmailStmt.length > 0) {
      const firstApprovarmail = firstApprovarmailStmt[0].Email_ID;
      const firstApprovarname = firstApprovarmailStmt[0].user_name;

      const emailMessage = `
      <p>New BOM has been created for the following product:</p>
      <p><strong>BOM Name:</strong> ${req.body.bomName}</p>
      <p><strong>Product Name:</strong> ${checkProduct[0].product_name}</p>
      <p><strong>SKU:</strong> ${checkProduct[0].product_sku}</p>
      <p><strong>Description:</strong> ${req.body.bomRemark ?? "--"}</p>
      <p><strong>Version:</strong> ${req.body.brn}</p>
      <p>Please review and approve the BOM at your earliest convenience.</p>
    `;

      if (process.env.STAGE == "DEV") {
        await helper.sendMail(
          "somendra.yadav@mscorpres.in",
          null,
          "Approval for new BOM",
          emailMessage,
        );
      } else {
        await helper.sendMail(
          firstApprovarmail,
          null,
          "Approval for new BOM",
          emailMessage,
        );
      }
    } else {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "No Approver found",
      });
    }

    if (req.body.bomDoc) {
      for (let i = 0; i < req.body.bomDoc.length; i++) {
        fs.renameSync(
          "./temp/" + req.body.bomDoc[i],
          "./uploads/bomdocs/" + req.body.bomDoc[i],
        );
      }
    }

    await transaction.commit();
    // transaction.rollback();

    return res.json({
      status: "success",
      success: true,
      message: "BOM created successfully",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//CREATE BOM AS DRAFT
router.post("/createDraftBom", [auth.isAuthorized], async (req, res) => {
  const validator = new Validator(req.body, {
    product: "required",
    bomName: "required",
    brn: "required",
    bomRef: "required",
    componets: "required|array",
    approvers: "required|array",
  });

  if (validator.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validator),
    });
  }

  for (let i = 0; i < req.body.componets.length; i++) {
    const validatComp = new Validator(req.body.componets[i], {
      component: "required",
      quantity: "required",
      type: "required|in:main,alternate",
      placement: "required",
      make: "required",
      mpn: "required",
    });

    if (validatComp.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(validatComp),
      });
    }
  }

  const transaction = await invtDB.transaction();

  try {
    // CHECH PRODUCT
    const checkProduct = await invtDB.query(
      "SELECT * FROM temp_product_master WHERE product_key = :product_key AND isActive = 'true'",
      {
        replacements: { product_key: req.body.product },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (checkProduct.length == 0) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Product either not found or not approved yet",
      });
    }
    // CHECH BOM
    const checkBom = await invtDB.query(
      "SELECT * FROM draft_rnd_bom_header WHERE bom_product = :product_key ORDER BY ID ASC",
      {
        replacements: { product_key: req.body.product },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (checkBom.length > 0) {
      if (checkBom[0].bom_product == req.body.product) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "BOM Draft already exist",
        });
      }
    }

    const bomKey = helper.getUniqueNumber();
    const inserBy = req.logedINUser;
    const insertDt = moment().format("YYYY-MM-DD HH:mm:ss");

    // CREATE BOM
    await invtDB.query(
      "INSERT INTO draft_rnd_bom_header( bom_key, bom_parent_key, bom_product, bom_name, bom_status, bom_ref_no, bom_user_version, bom_reamrk, bom_doc, bom_insert_by, bom_insert_dt) VALUES ( :bom_key, :bom_parent_key, :bom_product, :bom_name, :bom_status, :bom_ref_no, :bom_user_version, :bom_reamrk, :bom_doc, :bom_insert_by, :bom_insert_dt )",
      {
        replacements: {
          bom_key: bomKey,
          bom_parent_key: checkBom.length > 0 ? checkBom[0].bom_key : null,
          bom_product: req.body.product,
          bom_name: req.body.bomName,
          bom_status: "DRAFT",
          bom_ref_no: req.body.brn,
          bom_user_version: req.body.bomRef,
          bom_reamrk: req.body.bomRemark ?? "--",
          bom_doc: req.body?.bomDoc?.join(",") ?? null,
          bom_insert_by: inserBy,
          bom_insert_dt: insertDt,
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      },
    );

    // CREATE BOM ITEM
    for (let i = 0; i < req.body.componets.length; i++) {
      // CHECK COMPONENT
      const checkComp = await invtDB.query(
        "SELECT components.* , rm_categories.rm_cat_name AS categoryName FROM `components` LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category WHERE component_key = :componentKey",
        {
          replacements: { componentKey: req.body.componets[i].component },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (checkComp.length == 0) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "Component not found",
        });
      }

      if (
        (checkComp[0].manufacturing_code == null ||
          checkComp[0].manufacturing_code == "") &&
        checkComp[0].categoryName != "Other"
      ) {
        return res.json({
          success: false,
          status: "error",
          message: `Component (${checkComp[0].c_part_no}) does not have manufacturing code, please update it in components master.`,
        });
      }

      if (req.body.componets[i].type == "alternate") {
        const valid = new Validator(req.body.componets[i], {
          altComp: "required",
        });
        if (valid.fails()) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: helper.firstErrorValidatorjs(valid),
          });
        }

        const checkAlt = await invtDB.query(
          "SELECT components.* , rm_categories.rm_cat_name AS categoryName FROM `components` LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category WHERE component_key = :componentKey",
          {
            replacements: {
              componentKey: req.body.componets[i].altComp,
            },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (checkAlt.length == 0) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Component not found",
          });
        }

        if (
          (checkAlt[0].manufacturing_code == null ||
            checkAlt[0].manufacturing_code == "") &&
          checkAlt[0].categoryName != "Other"
        ) {
          return res.json({
            success: false,
            status: "error",
            message: `Component (${checkAlt[0].c_part_no}) does not have manufacturing code, please update it in components master.`,
          });
        }
      }

      await invtDB.query(
        "INSERT INTO tbl_draft_rnd_bom_items(bom_key, bom_item, bom_comp_type,bom_comp_make,bom_comp_mpn,  bom_item_qty, bom_item_vendor, bom_item_placement, bom_item_remark, insert_by, insert_date, bom_item_alt_of) VALUES ( :bom_key, :bom_item, :bom_comp_type,:make, :mpn , :bom_item_qty, :bom_item_vendor, :bom_item_placement, :bom_item_remark, :insert_by, :insert_date, :bom_item_alt_of )",
        {
          replacements: {
            bom_key: bomKey,
            bom_item: req.body.componets[i].component,
            bom_comp_type: req.body.componets[i].type,
            make: req.body.componets[i].make ?? "--",
            mpn: req.body.componets[i].mpn ?? "--",
            bom_item_qty: req.body.componets[i].quantity,
            bom_item_vendor: req.body.componets[i].vendor ?? null,
            bom_item_placement: req.body.componets[i].placement,
            bom_item_remark: req.body.componets[i].remark ?? "--",
            insert_by: inserBy,
            insert_date: insertDt,
            bom_item_alt_of:
              req.body.componets[i].type == "alternate"
                ? req.body.componets[i].altComp
                : null,
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: transaction,
        },
      );
    }

    if (req.body.bomDoc) {
      for (let i = 0; i < req.body.bomDoc.length; i++) {
        fs.renameSync(
          "./temp/" + req.body.bomDoc[i],
          "./uploads/bomdocs/" + req.body.bomDoc[i],
        );
      }
    }

    await transaction.commit();
    // transaction.rollback();

    return res.json({
      status: "success",
      success: true,
      message: "DRAFT BOM Saved Successfully",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});
router.get("/draftAttachment/:bomID", async (req, res) => {
  try {
    const bom = await invtDB.query(
      "SELECT * FROM draft_rnd_bom_header WHERE bom_key = :bom",
      {
        replacements: {
          bom: req.params.bomID,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (bom.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "BOM not found",
      });
    }

    let attachment = bom[0].bom_doc?.split(",") || [];

    if (attachment.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Attachment not found",
      });
    }

    attachment = attachment.map((data) => {
      return {
        fileName: data,
        filePath: process.env.API_URL + "/uploads/bomdocs/" + data,
        fileSize: helper.fileSize(
          fs.statSync("./uploads/bomdocs/" + data).size,
        ),
      };
    });

    return res.json({
      status: "success",
      success: true,
      message: "Attachment found",
      data: attachment,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//fetch dat fro update draft
router.get("/draftBomDetails/:bom", async (req, res) => {
  try {
    const components = await invtDB.query(
      `SELECT 
          tbl_draft_rnd_bom_items.*, 
          altComp.c_part_no AS altCompPartNo, 
          altComp.c_name AS altCompName,
          components.c_part_no, 
          components.c_name, 
          components.attribute_code, 
          components.manufacturing_code, 
          rm_categories.rm_cat_name, 
          ven_name
        FROM tbl_draft_rnd_bom_items
        LEFT JOIN components ON components.component_key = tbl_draft_rnd_bom_items.bom_item
        LEFT JOIN components altComp ON altComp.component_key = tbl_draft_rnd_bom_items.bom_item_alt_of
        LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category
        LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = tbl_draft_rnd_bom_items.bom_item_vendor
        WHERE bom_key = :bom`,
      {
        replacements: { bom: req.params.bom },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    const compData = components.map((data) => {
      return {
        key: data.bom_item,
        partno: data.c_part_no,
        name: data.c_name,
        make: data.bom_comp_make,
        mpn: data.bom_comp_mpn,
        type: data.bom_comp_type,
        altPartNo: data.altCompPartNo,
        altName: data.altCompName,
        placement: data.bom_item_placement,
        quantity: data.bom_item_qty,
        status: null, // Note: tbl_draft_rnd_bom_items doesn't have bom_item_status
        attributeCode: data.attribute_code,
        manufacturingCode: data.manufacturing_code,
        catType: data.rm_cat_name,
        vendor: data.bom_item_vendor
          ? `${data.bom_item_vendor} - ${data.ven_name}`
          : null,
        remark: data.bom_item_remark,
      };
    });

    const details = {}; // Keeping details object but empty since no approver-related info

    const resData = {
      components: compData,
      details: details,
    };

    return res.json({
      status: "success",
      success: true,
      message: "Data fetched successfully",
      data: resData,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//FETCH DRAFT BOM LIST
router.get("/bomDraftList", [auth.isAuthorized], async (req, res) => {
  try {
    const draftBomList = await invtDB.query(
      `SELECT 
          draft_rnd_bom_header.*,
          temp_product_master.product_name,
          temp_product_master.product_sku,
          admin_login.user_name

      FROM draft_rnd_bom_header
      LEFT JOIN temp_product_master ON temp_product_master.product_key = draft_rnd_bom_header.bom_product
      LEFT JOIN admin_login ON admin_login.CustID = draft_rnd_bom_header.bom_insert_by
      WHERE draft_rnd_bom_header.bom_status = 'DRAFT' 
      ORDER BY ID DESC`,
      {
        type: invtDB.QueryTypes.SELECT,
      },
    );

    const data = draftBomList.map((data) => ({
      key: data.bom_key,
      product_key: data.bom_product,
      product_name: data.product_name,
      product_sku: data.product_sku,
      version: data.bom_ref_no,
      bomRef: data.bom_user_version,
      status: data.bom_status,
      createby: data.user_name,
      createDate: moment(data.bom_insert_dt, "YYYY-MM-DD").format("DD-MM-YYYY"),
    }));

    return res.json({
      status: "success",
      success: true,
      message: "Data fetched successfully",
      data: data,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//update draft bom
router.post("/updateDraftBom", [auth.isAuthorized], async (req, res) => {
  const validator = new Validator(req.body, {
    bomKey: "required",
    product: "required",
    bomName: "required",
    brn: "required",
    bomRef: "required",
    componets: "required|array",
    approvers: "required|array",
  });

  if (validator.fails()) {
    return res.status(400).send({
      status: false,
      message: helper.firstErrorValidatorjs(validator),
    });
  }

  for (let i = 0; i < req.body.componets.length; i++) {
    const validatComp = new Validator(req.body.componets[i], {
      component: "required",
      quantity: "required",
      type: "required|in:main,alternate",
      placement: "required",
      make: "required",
      mpn: "required",
    });

    if (validatComp.fails()) {
      return res.status(400).send({
        status: false,
        message: helper.firstErrorValidatorjs(validatComp),
      });
    }
  }

  const transaction = await invtDB.transaction();

  try {
    // CHECK PRODUCT
    const checkProduct = await invtDB.query(
      "SELECT * FROM temp_product_master WHERE product_key = :product_key AND isActive = 'true'",
      {
        replacements: { product_key: req.body.product },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (checkProduct.length === 0) {
      await transaction.rollback();
      return res.json({
        success: false,
        message: "Product either not found or not approved yet",
      });
    }

    // CHECK IF BOM EXISTS AND IS DRAFT
    const checkBom = await invtDB.query(
      "SELECT * FROM draft_rnd_bom_header WHERE bom_key = :bom_key AND bom_status = 'DRAFT'",
      {
        replacements: { bom_key: req.body.bomKey },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (checkBom.length === 0) {
      await transaction.rollback();
      return res.json({
        success: false,
        message: "Draft BOM not found or not in DRAFT status",
      });
    }

    const updatedBy = req.logedINUser;
    const updateDt = moment().format("YYYY-MM-DD HH:mm:ss");

    let existingBomDocs = checkBom[0].bom_doc
      ? checkBom[0].bom_doc.split(",")
      : [];
    let newBomDocs = req.body.bomDoc || [];
    let updatedBomDocs = [...existingBomDocs];

    newBomDocs.forEach((doc) => {
      if (!updatedBomDocs.includes(doc)) {
        updatedBomDocs.push(doc);
      }
    });

    await invtDB.query(
      `UPDATE draft_rnd_bom_header 
       SET bom_product = :bom_product,
           bom_name = :bom_name,
           bom_ref_no = :bom_ref_no,
           bom_user_version = :bom_user_version,
           bom_reamrk = :bom_reamrk,
           bom_doc = :bom_doc,
           bom_update_by = :bom_update_by,
           bom_update_dt = :bom_update_dt
       WHERE bom_key = :bom_key`,
      {
        replacements: {
          bom_key: req.body.bomKey,
          bom_product: req.body.product,
          bom_name: req.body.bomName,
          bom_ref_no: req.body.brn,
          bom_user_version: req.body.bomRef,
          bom_reamrk: req.body.bomRemark ?? checkBom[0].bom_reamrk,
          bom_doc: updatedBomDocs.join(","),
          bom_update_by: updatedBy,
          bom_update_dt: updateDt,
        },
        type: invtDB.QueryTypes.UPDATE,
        transaction: transaction,
      },
    );

    for (let i = 0; i < req.body.componets.length; i++) {
      const comp = req.body.componets[i];

      const existingItem = await invtDB.query(
        `SELECT * FROM tbl_draft_rnd_bom_items 
         WHERE bom_key = :bom_key AND bom_item = :bom_item LIMIT 1`,
        {
          replacements: {
            bom_key: req.body.bomKey,
            bom_item: comp.component,
          },
          type: invtDB.QueryTypes.SELECT,
          transaction: transaction,
        },
      );

      // Validate component details
      const checkComp = await invtDB.query(
        `SELECT components.*, rm_categories.rm_cat_name AS categoryName 
         FROM components 
         LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category 
         WHERE component_key = :componentKey`,
        {
          replacements: { componentKey: comp.component },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (checkComp.length === 0) {
        await transaction.rollback();
        return res.json({ success: false, message: "Component not found" });
      }

      if (
        (checkComp[0].manufacturing_code == null ||
          checkComp[0].manufacturing_code === "") &&
        checkComp[0].categoryName !== "Other"
      ) {
        await transaction.rollback();
        return res.json({
          success: false,
          message: `Component (${checkComp[0].c_part_no}) does not have manufacturing code, please update it in components master.`,
        });
      }

      if (comp.type === "alternate") {
        const valid = new Validator(comp, {
          altComp: "required",
        });
        if (valid.fails()) {
          await transaction.rollback();
          return res.status(400).send({
            status: false,
            message: helper.firstErrorValidatorjs(valid),
          });
        }

        const checkAlt = await invtDB.query(
          `SELECT components.*, rm_categories.rm_cat_name AS categoryName 
           FROM components 
           LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category 
           WHERE component_key = :componentKey`,
          {
            replacements: { componentKey: comp.altComp },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (checkAlt.length === 0) {
          await transaction.rollback();
          return res.json({
            success: false,
            message: "Alternate component not found",
          });
        }
      }

      if (existingItem.length > 0) {
        // UPDATE existing BOM item
        await invtDB.query(
          `UPDATE tbl_draft_rnd_bom_items 
           SET bom_comp_type = :bom_comp_type,
               bom_comp_make = :make,
               bom_comp_mpn = :mpn,
               bom_item_qty = :bom_item_qty,
               bom_item_vendor = :bom_item_vendor,
               bom_item_placement = :bom_item_placement,
               bom_item_remark = :bom_item_remark,
               insert_by = :insert_by,
               insert_date = :insert_date,
               bom_item_alt_of = :bom_item_alt_of
           WHERE bom_key = :bom_key AND bom_item = :bom_item`,
          {
            replacements: {
              bom_key: req.body.bomKey,
              bom_item: comp.component,
              bom_comp_type: comp.type,
              make: comp.make ?? "--",
              mpn: comp.mpn ?? "--",
              bom_item_qty: comp.quantity,
              bom_item_vendor: comp.vendor ?? null,
              bom_item_placement: comp.placement,
              bom_item_remark: comp.remark ?? "--",
              insert_by: updatedBy,
              insert_date: updateDt,
              bom_item_alt_of: comp.type === "alternate" ? comp.altComp : null,
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction: transaction,
          },
        );
      } else {
        // INSERT new BOM item
        await invtDB.query(
          `INSERT INTO tbl_draft_rnd_bom_items 
           (bom_key, bom_item, bom_comp_type, bom_comp_make, bom_comp_mpn, bom_item_qty, bom_item_vendor, bom_item_placement, bom_item_remark, insert_by, insert_date, bom_item_alt_of) 
           VALUES (:bom_key, :bom_item, :bom_comp_type, :make, :mpn, :bom_item_qty, :bom_item_vendor, :bom_item_placement, :bom_item_remark, :insert_by, :insert_date, :bom_item_alt_of)`,
          {
            replacements: {
              bom_key: req.body.bomKey,
              bom_item: comp.component,
              bom_comp_type: comp.type,
              make: comp.make ?? "--",
              mpn: comp.mpn ?? "--",
              bom_item_qty: comp.quantity,
              bom_item_vendor: comp.vendor ?? null,
              bom_item_placement: comp.placement,
              bom_item_remark: comp.remark ?? "--",
              insert_by: updatedBy,
              insert_date: updateDt,
              bom_item_alt_of: comp.type === "alternate" ? comp.altComp : null,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }
    }

    if (req.body.bomDoc) {
      for (let i = 0; i < req.body.bomDoc.length; i++) {
        const doc = req.body.bomDoc[i];

        if (!existingBomDocs.includes(doc)) {
          fs.renameSync("./temp/" + doc, "./uploads/bomdocs/" + doc);
        }
      }
    }

    await transaction.commit();
    return res.json({
      success: true,
      message: "Draft BOM updated successfully",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

router.post("/", [auth.isAuthorized], async (req, res) => {
  const validator = new Validator(req.body, {
    product: "required",
    bomName: "required",
    brn: "required",
    bomRef: "required",
    componets: "required|array",
    approvers: "required|array",
  });

  if (validator.fails()) {
    return res.status(500).send({
      status: false,
      message: helper.firstErrorValidatorjs(validator),
    });
  }

  //   if (req.body.brn != "1.0") {
  //     const validParentid = new Validator(req.body, {
  //       oldbomId: "required",
  //     });
  //     if (validParentid.fails()) {
  //       return res.status(500).send({ status: false, message: helper.firstErrorValidatorjs(validParentid) });
  //     }
  //   }

  for (let i = 0; i < req.body.componets.length; i++) {
    const validatComp = new Validator(req.body.componets[i], {
      component: "required",
      quantity: "required",
      type: "required|in:main,alternate",
      placement: "required",
    });

    if (validatComp.fails()) {
      return res.status(500).send({
        status: false,
        message: helper.firstErrorValidatorjs(validatComp),
      });
    }
  }

  //   VALIDATE ALTERNATE
  for (let i = 0; i < req.body.componets.length; i++) {
    if (req.body.componets[i].type == "alternate") {
      const valid = new Validator(req.body.componets[i], {
        altComp: "required",
      });
      if (valid.fails()) {
        return res.status(500).send({
          status: false,
          message: helper.firstErrorValidatorjs(valid),
        });
      }

      if (req.body.componets[i].component == req.body.componets[i].altComp) {
        return res.status(500).send({
          status: false,
          message: "Main component and Alternate component can't be same",
        });
      }

      // CHECK ALTERNATE OF COMPONENT EXISTS IN COMPONENT
      if (
        !req.body.componets.find(
          (comp) => comp.component == req.body.componets[i].altComp,
        )
      ) {
        return res.status(500).send({
          status: false,
          message: "Alternate component not found in main component list",
        });
      }
    }
  }

  //   VALIDATE APPROVER
  if (req.body.approvers.length !== 3) {
    return res
      .status(500)
      .send({ status: false, message: "Approver Line should be 3" });
  }

  for (let i = 0; i < req.body.approvers.length; i++) {
    if (Array.isArray(req.body.approvers[i]) == false) {
      return res.status(500).send({
        status: false,
        message: `Approver Line ${i + 1} should be array`,
      });
    }
    if (req.body.approvers[i].length < 1) {
      return res.status(500).send({
        status: false,
        message: `Approver Line ${i + 1} should have at least one approver `,
      });
    }

    for (let j = 0; j < req.body.approvers[i].length; j++) {
      // APPROVER SHOULD ARRAY TYPE

      if (!req.body.approvers[i][j]) {
        return res
          .status(500)
          .send({ status: false, message: "Approver can't be empty" });
      }
    }
  }

  // CHECK APPROVER
  let allApproversId = [];

  for (let i = 0; i < req.body.approvers.length; i++) {
    for (let j = 0; j < req.body.approvers[i].length; j++) {
      allApproversId.push(req.body.approvers[i][j]);
    }
  }
  allApproversId = [...new Set(allApproversId)];
  const checkApprover = await invtDB.query(
    "SELECT * FROM admin_login WHERE CustID IN (:userID)",
    {
      replacements: { userID: allApproversId },
      type: invtDB.QueryTypes.SELECT,
    },
  );
  if (checkApprover.length != allApproversId.length) {
    return res.json({
      status: "error",
      success: false,
      message: "Approver not found",
    });
  }

  const transaction = await invtDB.transaction();

  try {
    // CHECH PRODUCT
    const checkProduct = await invtDB.query(
      "SELECT * FROM temp_product_master WHERE product_key = :product_key AND isActive = 'true'",
      {
        replacements: { product_key: req.body.product },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (checkProduct.length == 0) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Product either not found or not approved yet",
      });
    }

    // CHECH BOM
    const checkBom = await invtDB.query(
      "SELECT * FROM tbl_rnd_bom_header WHERE bom_product = :product_key ORDER BY ID ASC",
      {
        replacements: { product_key: req.body.product },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (checkBom.length > 0) {
      // IF LAST BOM IS NOT CLOSED
      if (checkBom[checkBom.length - 1].bom_status != "CLOSED") {
        await transaction.rollback();
        return res.json({ success: false, message: "Last BOM is in transit" });
      }

      // IF LAST BOM CREATER IS NOT THE CURRENT USER
      if (checkBom[checkBom.length - 1].bom_insert_by != req.logedINUser) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "You are not authorized to create this BOM",
        });
      }
    }

    // CHECK BOM REF NO (VERSION)
    const checkBomRef = await invtDB.query(
      "SELECT * FROM tbl_rnd_bom_header WHERE bom_product = :product_key AND bom_ref_no = :bom_ref_no",
      {
        replacements: {
          bom_ref_no: req.body.brn,
          product_key: req.body.product,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (checkBomRef.length > 0) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "BOM REF NO already exist",
      });
    }

    const bomKey = helper.getUniqueNumber();
    const inserBy = req.logedINUser;
    const insertDt = moment().format("YYYY-MM-DD HH:mm:ss");

    // CREATE BOM
    await invtDB.query(
      "INSERT INTO tbl_rnd_bom_header( bom_key, bom_parent_key, bom_product, bom_name, bom_ref_no, bom_user_version, bom_reamrk, bom_doc, bom_insert_by, bom_insert_dt) VALUES ( :bom_key, :bom_parent_key, :bom_product, :bom_name, :bom_ref_no, :bom_user_version, :bom_reamrk, :bom_doc, :bom_insert_by, :bom_insert_dt )",
      {
        replacements: {
          bom_key: bomKey,
          bom_parent_key: checkBom.length > 0 ? checkBom[0].bom_key : null,
          bom_product: req.body.product,
          bom_name: req.body.bomName,
          bom_ref_no: req.body.brn,
          bom_user_version: req.body.bomRef,
          bom_reamrk: req.body.bomRemark ?? "--",
          bom_doc: req.body?.bomDoc?.join(",") ?? null,
          bom_insert_by: inserBy,
          bom_insert_dt: insertDt,
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      },
    );

    // CREATE BOM ITEM
    for (let i = 0; i < req.body.componets.length; i++) {
      // CHECK COMPONENT
      const checkComp = await invtDB.query(
        "SELECT components.* , rm_categories.rm_cat_name AS categoryName FROM `components` LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category WHERE component_key = :componentKey",
        {
          replacements: { componentKey: req.body.componets[i].component },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (checkComp.length == 0) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "Component not found",
        });
      }

      if (
        (checkComp[0].manufacturing_code == null ||
          checkComp[0].manufacturing_code == "") &&
        checkComp[0].categoryName != "Other"
      ) {
        return res.json({
          status: "error",
          success: false,
          message: `Component (${checkComp[0].c_part_no}) does not have manufacturing code, please update it in components master.`,
        });
      }

      if (req.body.componets[i].type == "alternate") {
        const valid = new Validator(req.body.componets[i], {
          altComp: "required",
        });
        if (valid.fails()) {
          await transaction.rollback();
          return res.status(500).send({
            status: false,
            message: helper.firstErrorValidatorjs(valid),
          });
        }

        const checkAlt = await invtDB.query(
          "SELECT components.* , rm_categories.rm_cat_name AS categoryName FROM `components` LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category WHERE component_key = :componentKey",
          {
            replacements: {
              componentKey: req.body.componets[i].altComp,
            },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (checkAlt.length == 0) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Component not found",
          });
        }

        if (
          (checkAlt[0].manufacturing_code == null ||
            checkAlt[0].manufacturing_code == "") &&
          checkAlt[0].categoryName != "Other"
        ) {
          return res.json({
            status: "error",
            success: false,
            message: `Component (${checkAlt[0].c_part_no}) does not have manufacturing code, please update it in components master.`,
          });
        }
      }

      await invtDB.query(
        "INSERT INTO tbl_rnd_bom_items(bom_key, bom_item, bom_comp_type, bom_item_qty, bom_item_vendor, bom_item_mpn, bom_item_placement, bom_item_remark, insert_by, insert_date, bom_item_alt_of) VALUES ( :bom_key, :bom_item, :bom_comp_type, :bom_item_qty, :bom_item_vendor, :bom_item_mpn, :bom_item_placement, :bom_item_remark, :insert_by, :insert_date, :bom_item_alt_of )",
        {
          replacements: {
            bom_key: bomKey,
            bom_item: req.body.componets[i].component,
            bom_comp_type: req.body.componets[i].type,
            bom_item_qty: req.body.componets[i].quantity,
            bom_item_vendor: req.body.componets[i].vendor ?? null,
            bom_item_mpn: req.body.componets[i].mpn,
            bom_item_placement: req.body.componets[i].placement,
            bom_item_remark: req.body.componets[i].remark ?? "--",
            insert_by: inserBy,
            insert_date: insertDt,
            bom_item_alt_of:
              req.body.componets[i].type == "alternate"
                ? req.body.componets[i].altComp
                : null,
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: transaction,
        },
      );
    }

    // CREATE APPROVERS
    for (let i = 0; i < req.body.approvers.length; i++) {
      for (let j = 0; j < req.body.approvers[i].length; j++) {
        const checkApprover = await invtDB.query(
          "SELECT * FROM admin_login WHERE CustID = :userID",
          {
            replacements: { userID: req.body.approvers[i][j] },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (checkApprover.length == 0) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: `Approver not found (in Line ${i + 1}, Stage ${j + 1})`,
          });
        }

        await invtDB.query(
          "INSERT INTO tbl_rnd_bom_approver( bom_key, line_no, stage_no, aprover) VALUES ( :bom_key, :line_no, :stage_no, :aprover)",
          {
            replacements: {
              bom_key: bomKey,
              line_no: i + 1,
              stage_no: j + 1,
              aprover: req.body.approvers[i][j],
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }
    }

    // SAVE LOG
    await invtDB.query(
      "INSERT INTO tbl_rnd_bom_log(module, refNo, ref_reamark , log_remark, insert_by, insert_dt) VALUES (:module, :refNo, :ref_reamark, :log_remark, :insert_by, :insert_dt)",
      {
        replacements: {
          module:
            checkBom.length > 0 ? "NEW VERSION BOM CREATED" : "NEW BOM CREATED",
          refNo: bomKey,
          ref_reamark:
            checkBom.length > 0 ? "NEW VERSION BOM CREATED" : "NEW BOM CREATED",
          log_remark: req.body.bomRemark ?? "--",
          insert_by: inserBy,
          insert_dt: insertDt,
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      },
    );

    // FOR MAIL
    const firstApprovarmailStmt = await invtDB.query(
      "SELECT * FROM admin_login WHERE CustID = :userID",
      {
        replacements: { userID: req.body.approvers[0][0] },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (firstApprovarmailStmt.length > 0) {
      const firstApprovarmail = firstApprovarmailStmt[0].Email_ID;
      const firstApprovarname = firstApprovarmailStmt[0].user_name;

      const emailMessage = `
      <p>New BOM has been created for the following product:</p>
      <p><strong>BOM Name:</strong> ${req.body.bomName}</p>
      <p><strong>Product Name:</strong> ${checkProduct[0].product_name}</p>
      <p><strong>SKU:</strong> ${checkProduct[0].product_sku}</p>
      <p><strong>Description:</strong> ${req.body.bomRemark ?? "--"}</p>
      <p><strong>Version:</strong> ${req.body.brn}</p>
      <p>Please review and approve the BOM at your earliest convenience.</p>
    `;

      if (process.env.STAGE == "DEV") {
        await helper.sendMail(
          "somendra.yadav@mscorpres.in",
          null,
          "Approval for new BOM",
          emailMessage,
        );
      } else {
        await helper.sendMail(
          firstApprovarmail,
          null,
          "Approval for new BOM",
          emailMessage,
        );
      }
    } else {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "No Approver found",
      });
    }

    if (req.body.bomDoc) {
      for (let i = 0; i < req.body.bomDoc.length; i++) {
        fs.renameSync(
          "./temp/" + req.body.bomDoc[i],
          "./uploads/bomdocs/" + req.body.bomDoc[i],
        );
      }
    }

    await transaction.commit();
    // transaction.rollback();

    return res.json({
      status: "success",
      success: true,
      message: "BOM created successfully",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH BOM LIST
router.get("/bomList", [auth.isAuthorized], async (req, res) => {
  try {
    const bomList = await invtDB.query(
      `SELECT 
          tbl_rnd_bom_header.* ,
          temp_product_master.product_name , temp_product_master.product_sku , admin_login.user_name,

          (
            SELECT admin_login.user_name
          FROM tbl_rnd_bom_approver 
          LEFT JOIN admin_login ON admin_login.CustID = tbl_rnd_bom_approver.aprover
          WHERE bom_key = tbl_rnd_bom_header.bom_key AND status = "Pending"
          ORDER BY line_no ASC, stage_no ASC LIMIT 1
          ) AS current_approver

          FROM tbl_rnd_bom_header
          LEFT JOIN temp_product_master ON temp_product_master.product_key  = tbl_rnd_bom_header.bom_product
          LEFT JOIN admin_login ON admin_login.CustID = tbl_rnd_bom_header.bom_insert_by
          WHERE tbl_rnd_bom_header.bom_status <> 'DRAFT'
          ORDER BY ID DESC`,
      {
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (bomList.length == 0) {
      return res.json({
        status: "error",
        success: false,
        message: "No BOM found",
      });
    }

    const data = bomList.map((data) => {
      return {
        key: data.bom_key,
        product_key: data.bom_product,
        product_name: data.product_name,
        product_sku: data.product_sku,
        version: data.bom_ref_no,
        bomRef: data.bom_user_version,
        currentApprover: data.current_approver,
        status: data.bom_status,
        createby: data.user_name,
        createDate: moment(data.bom_insert_dt, "YYYY-MM-DD").format(
          "DD-MM-YYYY",
        ),
      };
    });

    return res.json({
      status: "success",
      success: true,
      message: "Data fetched successfully",
      data: data,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH BOM DETAILS
router.get("/bomDetails/:bom", async (req, res) => {
  try {
    const components = await invtDB.query(
      `SELECT 
          tbl_rnd_bom_items.*, 
          altComp.c_part_no AS altCompPartNo, altComp.c_name AS altCompName,
          components.c_part_no , components.c_name , components.attribute_code, components.manufacturing_code, rm_categories.rm_cat_name , 	ven_name
          FROM tbl_rnd_bom_items
          LEFT JOIN components ON components.component_key = tbl_rnd_bom_items.bom_item
          LEFT JOIN components altComp ON altComp.component_key = tbl_rnd_bom_items.bom_item_alt_of
          LEFT JOIN rm_categories ON rm_categories.rm_cat_key = components.c_attr_category
          LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = tbl_rnd_bom_items.bom_item_vendor
          WHERE bom_key = :bom`,
      {
        replacements: { bom: req.params.bom },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    const compData = components.map((data) => {
      return {
        key: data.bom_item,
        partno: data.c_part_no,
        name: data.c_name,
        make: data.bom_comp_make,
        mpn: data.bom_comp_mpn,
        type: data.bom_comp_type,
        altPartNo: data.altCompPartNo,
        altName: data.altCompName,
        placement: data.bom_item_placement,
        quantity: data.bom_item_qty,
        status: data.bom_item_status,
        attributeCode: data.attribute_code,
        manufacturingCode: data.manufacturing_code,
        catType: data.rm_cat_name,
        vendor: data.bom_item_vendor + " - " + data.ven_name,
        mpn: data.bom_item_mpn,
        remark: data.bom_item_remark,
      };
    });

    const approverStmt = await invtDB.query(
      `SELECT tbl_rnd_bom_approver.*, admin_login.user_name AS approver_name, admin_login.Email_ID AS approver_email
        FROM tbl_rnd_bom_approver 
        LEFT JOIN admin_login ON admin_login.CustID = tbl_rnd_bom_approver.aprover
        WHERE bom_key = :bom`,
      {
        replacements: { bom: req.params.bom },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    const approverdata = approverStmt.map((data) => {
      return {
        lineLable: "L" + data.line_no,
        line: data.line_no,
        stageLable: "S" + data.stage_no,
        stage: data.stage_no,
        approver: data.aprover,
        email: data.approver_email,
        name: data.approver_name,
        status: data.status,
        updateTime:
          data.status !== "Pending"
            ? moment(data.update_dt, "YYYY-MM-DD HH:mm:ss").format(
                "DD-MM-YYYY HH:mm:ss",
              )
            : null,
        remark: data.remark,
      };
    });

    const details = {};
    // FIRST PENDING STAGE
    const firstPending = approverdata.filter(
      (data) => data.status === "Pending",
    );
    const firstPendingStage = firstPending.sort(
      (a, b) =>
        Number(a.line_no) - Number(b.line_no) ||
        Number(a.stage_no) - Number(b.stage_no),
    )[0];

    details.currentLine = firstPendingStage?.line || null;
    details.currentStage = firstPendingStage?.stage || null;
    details.currentApprover = firstPendingStage?.approver || null;

    details.isRejected = approverdata.some(
      (data) => data.status === "Rejected",
    );

    const approvers = approverdata.map((item) => {
      if (
        item.line == details.currentLine &&
        item.stage == details.currentStage
      ) {
        item.currentApprover = true;
      } else {
        item.currentApprover = false;
      }
      return item;
    });

    const resData = {
      components: compData,
      approvers: approvers,
      details: details,
    };

    return res.json({
      status: "success",
      success: true,
      message: "Data fetched successfully",
      data: resData,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//UPDATE STATUS OF BOM BY APPROVER
router.put("/updateBOMStatus", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    bom: "required",
    line: "required|numeric|min:1",
    stage: "required|numeric|min:1",
    status: "required|in:Approved,Rejected",
    remark: "required",
  });

  if (validation.fails()) {
    return res.status(500).send({
      status: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  const transaction = await invtDB.transaction();

  try {
    const CheckBom = await invtDB.query(
      `SELECT 
        tbl_rnd_bom_header.*, 
        temp_product_master.product_name , temp_product_master.product_sku 
        FROM tbl_rnd_bom_header
        LEFT JOIN temp_product_master ON temp_product_master.product_key  = tbl_rnd_bom_header.bom_product
        WHERE bom_key = :bom`,
      {
        replacements: { bom: req.body.bom },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (CheckBom.length == 0) {
      await transaction.rollback();
      return res.json({ success: false, message: "BOM not found!!!" });
    }

    const getApprover = await invtDB.query(
      "SELECT * FROM tbl_rnd_bom_approver WHERE bom_key = :bom ",
      {
        replacements: { bom: req.body.bom },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (getApprover.length == 0) {
      await transaction.rollback();
      return res.json({
        success: false,
        message: "Approver list not found!!!",
      });
    }

    if (req.body.line > 1 || req.body.stage > 1) {
      // CHECK LAST STAGE IS APPROVED OR NOT
      let lastStage;
      if (req.body.stage > 1) {
        lastStage = getApprover.find(
          (app) =>
            app.line_no == req.body.line && app.stage_no == req.body.stage - 1,
        );
      } else {
        const previousline = getApprover.filter(
          (app) => app.line_no == req.body.line - 1,
        );
        if (previousline.length > 0) {
          previousline.sort((a, b) => Number(b.stage_no) - Number(a.stage_no));
          lastStage = previousline[0];
        }
      }

      if (!lastStage) {
        await transaction.rollback();
        return res.json({ success: false, message: "Stage not found!!!" });
      }

      if (lastStage.status == "Pending") {
        await transaction.rollback();
        return res.json({
          success: false,
          message: "Previous stage is not approved!!!",
        });
      }

      if (lastStage.status == "Rejected") {
        await transaction.rollback();
        return res.json({
          success: false,
          message: "Previous stage is rejected!!!",
        });
      }
    }
    // FOR FIRST STAGE
    const currentStage = getApprover.find(
      (app) => app.line_no == req.body.line && app.stage_no == req.body.stage,
    );
    // USER CAN APPROVE
    if (currentStage.aprover !== req.logedINUser) {
      await transaction.rollback();
      return res.json({
        success: false,
        message: "You are not authorized to approve this BOM",
      });
    }

    if (currentStage.status !== "Pending") {
      await transaction.rollback();
      return res.json({
        success: false,
        message: "This stage is already approved or rejected",
      });
    }

    const updateStatus = await invtDB.query(
      "UPDATE tbl_rnd_bom_approver SET status = :status, update_dt = :update_dt, remark = :remark WHERE bom_key = :bom AND line_no = :line AND stage_no = :stage",
      {
        replacements: {
          bom: req.body.bom,
          line: req.body.line,
          stage: req.body.stage,
          status: req.body.status,
          remark: req.body.remark,
          update_dt: moment().format("YYYY-MM-DD HH:mm:ss"),
        },
        type: invtDB.QueryTypes.UPDATE,
        transaction: transaction,
      },
    );

    if (updateStatus[1]) {
      // IF IT IS REJECTED
      if (req.body.status == "Rejected") {
        const updateBomstatusStmt = await invtDB.query(
          "UPDATE tbl_rnd_bom_header SET bom_status = :status WHERE bom_key = :bom",
          {
            replacements: {
              bom: req.body.bom,
              status: "REJECTED",
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction: transaction,
          },
        );
      } else {
        // CHECK IF IT IS LAST STAGE
        const lastLine = Math.max(
          ...getApprover.map((app) => Number(app.line_no)),
        );
        const lastStage = Math.max(
          ...getApprover.map((app) => Number(app.stage_no)),
        );

        if (req.body.line == lastLine && req.body.stage == lastStage) {
          const updateBomstatusStmt = await invtDB.query(
            "UPDATE tbl_rnd_bom_header SET bom_status = :status WHERE bom_key = :bom",
            {
              replacements: {
                bom: req.body.bom,
                status: "CLOSED",
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: transaction,
            },
          );
        }
      }

      const insertLog = await invtDB.query(
        "INSERT INTO tbl_rnd_bom_log (module, refNo, ref_reamark, log_remark, insert_by, insert_dt) VALUES (:module, :refNo, :ref_reamark, log_remark, :insert_by, :insert_dt)",
        {
          replacements: {
            module: "BOM STATUS UPDATED",
            refNo: req.body.bom,
            ref_reamark: `STATUS:- ${req.body.status} Line:- ${req.body.line} Stage:- ${req.body.stage}`,
            log_remark: req.body.remark,
            insert_by: req.logedINUser,
            insert_dt: moment().format("YYYY-MM-DD HH:mm:ss"),
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: transaction,
        },
      );

      //   NEXT APPROVER

      // Function to find the next stage
      function findNextStage(currentLine, currentStage, data) {
        // Filter records for the same line_no
        const sameLineRecords = data.filter(
          (item) => item.line_no === currentLine,
        );

        // Find the next stage with stage_no greater than the currentStage
        const nextStage = sameLineRecords
          .filter((item) => item.stage_no > currentStage)
          .sort((a, b) => a.stage_no - b.stage_no)[0]; // Sort by stage_no and take the first one

        return nextStage || null; // Return null if no next stage exists
      }

      const nextStage = findNextStage(
        req.body.line,
        req.body.stage,
        getApprover,
      );

      if (nextStage) {
        const emailMessage = `
            <p>New BOM has been created for the following product:</p>
            <p><strong>BOM Name:</strong> ${CheckBom[0].bom_name}</p>
            <p><strong>Product Name:</strong> ${CheckBom[0].product_name}</p>
            <p><strong>SKU:</strong> ${CheckBom[0].product_sku}</p>
            <p><strong>Description:</strong> ${
              CheckBom[0].bom_remark ?? "--"
            }</p>
            <p><strong>Version:</strong> ${CheckBom[0].bom_ref_no}</p>
            <p><strong>Approval Stage:</strong> L${nextStage.line_no} S${
              nextStage.stage_no
            }</p>
            <p>Please review and approve the BOM at your earliest convenience.</p>
      `;

        const userEmail = await invtDB.query(
          "SELECT * FROM admin_login WHERE CustID = :userID",
          {
            replacements: { userID: nextStage.aprover },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (userEmail.length <= 0) {
          await transaction.rollback();
          return res.json({ success: false, message: "Approver not found" });
        }

        await helper.sendMail(
          userEmail[0].email,
          null,
          "Approval for new BOM (REF:-" + req.body.bom + ")",
          emailMessage,
        );
      }

      await transaction.commit();
      return res.json({
        success: true,
        message: "Status updated successfully",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET ATTACHMENT
router.get("/attachment/:bomID", async (req, res) => {
  try {
    const bom = await invtDB.query(
      "SELECT * FROM tbl_rnd_bom_header WHERE bom_key = :bom",
      {
        replacements: {
          bom: req.params.bomID,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (bom.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "BOM not found",
      });
    }

    let attachment = bom[0].bom_doc?.split(",") || [];

    if (attachment.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Attachment not found",
      });
    }

    attachment = attachment.map((data) => {
      return {
        fileName: data,
        filePath: process.env.API_URL + "/uploads/bomdocs/" + data,
        fileSize: helper.fileSize(
          fs.statSync("./uploads/bomdocs/" + data).size,
        ),
      };
    });

    return res.json({
      status: "success",
      success: true,
      message: "Attachment found",
      data: attachment,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET LOG
router.get("/log/:bomID", async (req, res) => {
  try {
    let log = [];
    const bom = await invtDB.query(
      "SELECT tbl_rnd_bom_header.* FROM tbl_rnd_bom_header WHERE bom_key = :bom OR bom_parent_key = :bom",
      {
        replacements: {
          bom: req.params.bomID,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (bom.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "BOM not found",
      });
    }
    let allBoms = [req.params.bomID];

    if (bom[0].bom_ref_no != "1.0") {
      const getAllOldVersion = await invtDB.query(
        "SELECT bom_key FROM tbl_rnd_bom_header WHERE bom_key = :bomParent OR bom_parent_key = :bomParent",
        {
          replacements: { bomParent: bom[0].bom_parent_key },
          type: invtDB.QueryTypes.SELECT,
        },
      );
      allBoms = [...allBoms, ...getAllOldVersion.map((item) => item.bom_key)];
    }

    const activityLog = await invtDB.query(
      `SELECT tbl_rnd_bom_log.* , admin_login.user_name, 
        (SELECT bom_ref_no FROM tbl_rnd_bom_header WHERE bom_key = tbl_rnd_bom_log.refNo) AS bom_ref_no
        FROM tbl_rnd_bom_log
        LEFT JOIN admin_login ON admin_login.CustID = tbl_rnd_bom_log.insert_by
        WHERE refNo IN (:bom) ORDER BY ID ASC`,
      {
        replacements: {
          bom: allBoms,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    log = activityLog.map((data) => {
      return {
        label: data.module,
        activityPersion: data.user_name,
        time: moment(data.insert_dt, "YYYY-MM-DD HH:mm:ss").format(
          "DD-MM-YYYY hh:mm:ss",
        ),
        summery: data.ref_reamark,
        remark: data.log_remark,
        version: data.bom_ref_no,
      };
    });

    return res.json({ status: "success", success: true, data: log });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

module.exports = router;
