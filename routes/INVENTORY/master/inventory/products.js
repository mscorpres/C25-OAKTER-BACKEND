const express = require("express");
const router = express.Router();

const multer = require("multer");
const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
let { invtDB, otherDB, invtOakterDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");
const fs = require("fs");
const path = require("path");

var storage = multer.diskStorage({
  destination: "./uploads/productImage",
  filename: function (req, file, cb) {
    cb(
      null,
      "SKU" +
        helper.getUniqueNumber() +
        helper.randomNumber(100, 999) +
        path.extname(file.originalname)
    );
  },
});
var upload = multer({
  storage: storage,
  limits: { fileSize: 5242880 },
  fileFilter: function (_req, file, cb) {
    // Allowed ext
    const filetypes = /jpeg|jpg|png|gif/;
    // Check ext
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    // Check mime
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb("Error: Images Only!");
    }
  },
});

// Get All Products Default
router.get("/", [auth.isAuthorized], async (req, res) => {
  try {
    const result = await invtDB.query(
      "SELECT p_name,p_sku,units_name,product_key FROM products  LEFT JOIN units ON units.units_id = products.p_uom WHERE products.products_type = 'default' ",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (result.length > 0) {
      return res.json({
        success: true,
        message: "Successfully fetched all products",
        data: result,
      });
    } else {
      return res.json({
        message: "No Data Found",
        success: false,
        status: "error",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Get All Products Semi
router.get("/semiProducts", [auth.isAuthorized], async (req, res) => {
  try {
    const result = await invtDB.query(
      "SELECT `p_name`,`p_sku`,`product_key`,`units_name` FROM `products`  LEFT JOIN `units` ON units.units_id = products.p_uom WHERE products.products_type = 'semi' ",
      { type: invtDB.QueryTypes.SELECT }
    );

    if (result.length > 0) {
      return res.json({ success: true, data: result, status: "success" });
    } else {
      return res.json({
        message:
          "Internal Error!!! If this condition persists, contact your system administrator",
        success: false,
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Get Products By Sku
router.get("/bySku", [auth.isAuthorized], async (req, res) => {
  const valid = new Validator(req.query, {
    sku: "required",
  });

  if (valid.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Validation error",
    });
  }

  try {
    const result = await invtDB.query(
      "SELECT p_name,p_sku, product_key FROM `products` WHERE `p_sku` = :sku",
      { replacements: { sku: req.query.sku }, type: invtDB.QueryTypes.SELECT }
    );
    if (result.length > 0) {
      return res.json({
        status: "success",
        success: true,
        data: {
          productKey: result[0].product_key,
          productName: result[0].p_name, 
          productSKU: result[0].p_sku,
        },
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "Product not found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Insert New Product
router.post("/insertProduct", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    p_name: "required",
    p_sku: "required",
    units_id: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
    });
  }

  const p_name = helper.trimString(req.body.p_name);
  const p_sku = helper.trimString(req.body.p_sku);
  const p_uom = req.body.units_id;
  const p_type = "default";

  const strvalid = helper.strCharValid(p_name);
  if (strvalid !== true) {
    return res.json({ success: false, message: strvalid });
  }

  let tx1, tx2;

  try {
    [tx1, tx2] = await Promise.all([
      invtDB.transaction(),
      invtOakterDB.transaction(),
    ]);

    let check_stmt = await invtDB.query(
      "SELECT 1 FROM products WHERE p_sku = :p_sku LIMIT 1",
      {
        replacements: { p_sku },
        type: invtDB.QueryTypes.SELECT,
        transaction: tx1,
      }
    );

    if (check_stmt.length > 0) {
      await Promise.all([tx1.rollback(), tx2.rollback()]);
      return res.json({
        success: false,
        message: "FG Product already exists",
      });
    }

    let name_check = await invtDB.query(
      "SELECT 1 FROM products WHERE p_name = :p_name LIMIT 1",
      {
        replacements: { p_name },
        type: invtDB.QueryTypes.SELECT,
        transaction: tx1,
      }
    );

    if (name_check.length > 0) {
      await Promise.all([tx1.rollback(), tx2.rollback()]);
      return res.json({
        success: false,
        status: "error",
        message: "Product name already exists",
      });
    }

    const product_key = helper.getUniqueNumber();
    const insert_date = moment().format("YYYY-MM-DD HH:mm:ss");

    const sql = `
      INSERT INTO products 
      (p_name, p_sku, p_uom, products_type, inserted_by, insert_date, product_key)
      VALUES (:p_name, :p_sku, :p_uom, :products_type, :inserted_by, :insert_date, :product_key)
    `;

    const payload = {
      p_name: p_name,
      p_sku: p_sku,
      p_uom: p_uom,
      products_type: p_type,
      inserted_by: req.logedINUser,
      insert_date: insert_date,
      product_key: product_key,
    };

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
      success: true,
      status: "success",
      message: "successfully added new FG product",
    });
  } catch (err) {
    if (tx1) await tx1.rollback();
    if (tx2) await tx2.rollback();

    return helper.errorResponse(res, err);
  }
});


// Insert New Semi Product
router.post("/insertSemi", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    p_name: "required",
    p_sku: "required",
    units_id: "required",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      status: "error",
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
    });
  }

  const p_name = helper.trimString(req.body.p_name);
  const p_sku = helper.trimString(req.body.p_sku);
  const p_uom = req.body.units_id;
  const p_type = "semi";

  let tx1, tx2;

  try {
    [tx1, tx2] = await Promise.all([
      invtDB.transaction(),
      invtOakterDB.transaction(),
    ]);

    let check_stmt = await invtDB.query(
      "SELECT 1 FROM products WHERE p_sku = :p_sku LIMIT 1",
      {
        replacements: { p_sku },
        type: invtDB.QueryTypes.SELECT,
        transaction: tx1,
      }
    );

    if (check_stmt.length > 0) {
      await Promise.all([tx1.rollback(), tx2.rollback()]);
      return res.json({
        success: false,
        status: "error",
        message: "SFG Product already exists",
      });
    }

    let name_check = await invtDB.query(
      "SELECT 1 FROM products WHERE p_name = :p_name LIMIT 1",
      {
        replacements: { p_name },
        type: invtDB.QueryTypes.SELECT,
        transaction: tx1,
      }
    );

    if (name_check.length > 0) {
      await Promise.all([tx1.rollback(), tx2.rollback()]);
      return res.json({
        success: false,
        status: "error",
        message: "Product name already exists",
      });
    }

    const product_key = helper.getUniqueNumber();
    const insert_date = moment().format("YYYY-MM-DD HH:mm:ss");

    const sql = `
      INSERT INTO products 
      (p_name, p_sku, p_uom, products_type, product_key, inserted_by, insert_date)
      VALUES (:p_name, :p_sku, :p_uom, :products_type, :product_key, :inserted_by, :insert_date)
    `;

    const payload = {
      p_name: p_name,
      p_sku: p_sku,
      p_uom: p_uom,
      products_type: p_type,
      product_key: product_key,
      inserted_by: req.logedINUser,
      insert_date: insert_date,
    };

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
      success: true,
      status: "success",
      message: "successfully added new SFG product",
    });
  } catch (err) {
    if (tx1) await tx1.rollback();
    if (tx2) await tx2.rollback();

    return helper.errorResponse(res, err);
  }
});


// Get Product For Update
router.post("/getProductForUpdate", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    product_key: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
    });
  }

  let stmt = await invtDB.query(
    "SELECT * FROM `products` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` WHERE `product_key` = :key",
    {
      replacements: { key: req.body.product_key },
      type: invtDB.QueryTypes.SELECT,
    }
  );
  let data = [];
  if (stmt.length > 0) {
    for (let i = 0; i < stmt.length; i++) {
      element = stmt[i];
      let stmt_bomcostiong = await invtDB.query(
        "SELECT DISTINCT `subject_under`, `product_sku`, `bom_status` FROM `bom_quantity` WHERE `product_sku` = :sku ORDER BY `product_sku` ASC",
        {
          replacements: { sku: element.p_sku },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let bom_mfg_cost;
      let primary_mfg_cost;
      let other_mfg_cost;
      let labour_cost;
      let secondary_packing_cost;
      let other_cost;
      if (stmt_bomcostiong.length > 0) {
        for (let j = 0; j < stmt_bomcostiong.length; j++) {
          let value00 = stmt_bomcostiong[j];
          bom_mfg_cost = 0;
          primary_mfg_cost = 0;
          other_mfg_cost = 0;
          let stmt1 = await invtDB.query(
            "SELECT `bom_quantity`.`component_id`, `bom_quantity`.`product_sku`, `bom_quantity`.`qty`, `bom_quantity`.`bom_catergory`, `bom_quantity`.`bom_status`, `components`.`c_type` AND `components`.`c_is_enabled` = 'Y' FROM `bom_quantity` LEFT JOIN `components` ON `bom_quantity`.`component_id` = `components`.`component_key` WHERE `bom_quantity`.`bom_status` = 'A' AND `bom_quantity`.`subject_under` = :subject AND `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y'",
            {
              replacements: { subject: value00.subject_under },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (stmt1.length > 0) {
            stmt1.map(async (value1) => {
              bomQty = value1.qty;
              jobwok_cost = value1.jobwok_cost;
              labour_cost = value1.labour_cost;
              secondary_packing_cost = value1.packing_cost;
              other_cost = value1.other_cost;
              bomCategory = value1.bom_catergory;
            });
          }
        }
      }

      product_type_name =
        element.products_type == "semi"
          ? "semi"
          : element.products_type == "default"
          ? "default"
          : "0";

      enabled_status_name =
        element.is_enabled == "Y" ? "Y" : element.is_enabled == "N" ? "N" : "0";

      tax_type_name =
        element.p_tax_type == "REG"
          ? "REG"
          : element.p_tax_type == "EXE"
          ? "EXE"
          : "0";

      gst_rate_name =
        element.p_gst_rate_tax == "05"
          ? "05"
          : element.p_gst_rate_tax == "12"
          ? "12"
          : element.p_gst_rate_tax == "18"
          ? "18"
          : element.p_gst_rate_tax == "28"
          ? "28"
          : "0";

      data.push({
        pKey: element.product_key,
        sku: element.p_sku,
        productname: element.p_name,
        uomname: element.units_name,
        uomid: element.units_id,
        productcategory: element.p_category,
        mrp: "0",
        producttype_name: product_type_name,
        costprice:
          parseFloat(bom_mfg_cost) +
          parseFloat(primary_mfg_cost) +
          parseFloat(other_mfg_cost) +
          parseFloat(labour_cost) +
          parseFloat(secondary_packing_cost) +
          parseFloat(other_cost),
        enablestatus_name: enabled_status_name,
        tax_type_name: tax_type_name,
        gstrate_name: gst_rate_name,
        hsncode: element.p_hsncode,
        brand: element.p_brand,
        ean: element.p_ean,
        weight: element.p_weight,
        vweight: element.p_v_weight,
        height: element.p_height,
        width: element.p_width,
        url: element.p_product_url,
        loc: element.p_default_stock_loc,
        laboutcost: element.labour_cost,
        packingcost: element.packing_cost,
        othercost: element.other_cost,
        jobworkcost: element.jobwok_cost,
        minstock: element.p_min_stock,
        minrmstock: element.p_min_rmstock,
        batchstock: element.p_batch_qty,
        description: element.p_description,
      });
    } 
    
    return res.json({ data: data, success: true, status: "success" });
  } else {
    return res.json({
      message: "seems like the product is not vaild",
      status: "error",
      success: false,
    });
  }
});

// UPDATE PRODUCT
router.post("/updateProduct", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    producttKey: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something is missing in the request",
    });
  }

  let tx1, tx2;

  try {
    [tx1, tx2] = await Promise.all([
      invtDB.transaction(),
      invtOakterDB.transaction(),
    ]);

    const products = await invtDB.query(
      "SELECT 1 FROM products WHERE product_key = :product AND products_type = 'default' LIMIT 1",
      {
        replacements: { product: req.body.producttKey },
        type: invtDB.QueryTypes.SELECT,
        transaction: tx1,
      }
    );

    if (products.length === 0) {
      await tx1.rollback();
      await tx2.rollback();
      return res.json({
        message: "Product not found or invalid",
        status: "error",
        success: false,
      });
    }

    const updateSQL = `
      UPDATE products 
      SET 
        p_name = :pname,
        p_hsncode = :hsn,
        jobwok_cost = :jobwork,
        labour_cost = :labcost,
        packing_cost = :packcost,
        other_cost = :othercost,
        p_min_stock = :minstock,
        p_batch_qty = :batchstock,
        p_category = :category,
        p_mrp = :mrp,
        p_brand = :brand,
        p_ean = :ean,
        p_weight = :weight,
        p_v_weight = :vweight,
        p_height = :height,
        p_width = :width,
        p_min_rmstock = :rmminstock,
        products_type = :producttype,
        is_enabled = :status,
        p_tax_type = :gsttype,
        p_gst_rate_tax = :gstrate,
        p_default_stock_loc = :location,
        p_description = :description,
        p_uom = :uom
      WHERE product_key = :key
    `;

    const payload = {
      pname: req.body.product_name,
      hsn: req.body.hsn,
      jobwork: req.body.jobworkcost,
      labcost: req.body.labourcost,
      packcost: req.body.packingcost,
      othercost: req.body.othercost,
      minstock: req.body.minstock,
      batchstock: req.body.batchstock,
      category: req.body.category,
      mrp: req.body.mrp,
      brand: req.body.brand,
      ean: req.body.ean,
      weight: req.body.weight,
      vweight: req.body.vweight,
      height: req.body.height,
      width: req.body.width,
      rmminstock: req.body.minstockrm,
      producttype: req.body.producttype,
      status: req.body.isenabled,
      gsttype: req.body.gsttype,
      gstrate: req.body.gstrate,
      location: req.body.location,
      description: req.body.description,
      uom: req.body.uom,
      key: req.body.producttKey,
    };

    const [stmt1, stmt2] = await Promise.all([
      invtDB.query(updateSQL, { replacements: payload, type: invtDB.QueryTypes.UPDATE, transaction: tx1 }),
      invtOakterDB.query(updateSQL, { replacements: payload, type: invtOakterDB.QueryTypes.UPDATE, transaction: tx2 }),
    ]);

    await Promise.all([tx1.commit(), tx2.commit()]);

    return res.json({
      message: "Product updated successfully",
      success: true,
      status: "success",
    });

  } catch (err) {
    if (tx1) await tx1.rollback();
    if (tx2) await tx2.rollback();
    return helper.errorResponse(res, err);
  }
});


// UPDATE SEMI PRODUCT
router.post("/updateSemiProduct", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    producttKey: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something is missing in form field to supply",
    });
  }

  let tx1, tx2;

  try {
    [tx1, tx2] = await Promise.all([
      invtDB.transaction(),
      invtOakterDB.transaction(),
    ]);

    const product = await invtDB.query(
      "SELECT 1 FROM products WHERE product_key = :product AND products_type = 'semi' LIMIT 1",
      {
        replacements: { product: req.body.producttKey },
        type: invtDB.QueryTypes.SELECT,
        transaction: tx1,
      }
    );

    if (product.length === 0) {
      await tx1.rollback();
      await tx2.rollback();
      return res.json({
        status: "error",
        message: "Product not valid or no longer exists",
        success: false,
      });
    }

    const updateSQL = `
      UPDATE products 
      SET 
        p_name = :pname,
        p_hsncode = :sac,
        p_description = :description,
        p_category = :category,
        p_uom = :uom,
        p_gst_rate_tax = :gstrate,
        p_tax_type = :gsttype,
        is_enabled = :status
      WHERE product_key = :key
    `;

    const payload = {
      pname: req.body.product_name,
      sac: req.body.sac,
      description: req.body.description,
      category: req.body.category ?? "--",
      key: req.body.producttKey,
      uom: req.body.uom,
      status: req.body.isenabled ?? "N",
      gstrate: req.body.gstrate ?? "--",
      gsttype: req.body.gsttype ?? "--",
    };

    const [stmt1, stmt2] = await Promise.all([
      invtDB.query(updateSQL, { replacements: payload, type: invtDB.QueryTypes.UPDATE, transaction: tx1 }),
      invtOakterDB.query(updateSQL, { replacements: payload, type: invtOakterDB.QueryTypes.UPDATE, transaction: tx2 }),
    ]);

    await Promise.all([tx1.commit(), tx2.commit()]);

    return res.json({
      status: "success",
      success: true,
      message: "Semi product updated successfully",
    });
  } catch (err) {
    if (tx1) await tx1.rollback();
    if (tx2) await tx2.rollback();

    return helper.errorResponse(res, err);
  }
});


// DELETE PRODUCT IMAGE
router.post("/ProductDelete", [auth.isAuthorized], async (req, res) => {
  const transaction = await otherDB.transaction();
  try {
    let stmt = await otherDB.query(
      "SELECT * FROM `rm_sku_images` WHERE `img_attach_id` = :img_attach_id AND rm_sku_key = :rm_sku_key",
      {
        replacements: {
          img_attach_id: req.body.image,
          rm_sku_key: req.body.product,
        },
        type: otherDB.QueryTypes.SELECT,
        transaction: transaction,
      }
    );

    if (stmt.length > 0) {
      fs.unlink("./uploads/productImage/" + stmt[0].img_url, (err) => {
        if (err) {
          return res.json({
            success: false,
            status: "error",
            message: "an error occured while performing the operation ",
          });
        }
      });
      let stmt2 = await otherDB.query(
        "DELETE FROM `rm_sku_images` WHERE `img_attach_id` = :img_attach_id AND `rm_sku_key` = :rm_sku_key ",
        {
          replacements: {
            img_attach_id: req.body.image,
            rm_sku_key: req.body.product,
          },
          type: otherDB.QueryTypes.DELETE,
          transaction: transaction,
        }
      );
    }
    await transaction.commit();
    return res.json({
      success: true,
      message: "Image deleted..",
      status: "success",
    });
  } catch (e) {
    return helper.errorResponse(res, e);
  }
});

// FETCH PRODUCT IMAGES
router.post("/fetchImageProduct", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await otherDB.query(
      `SELECT invt.user_name, other.* FROM ${global.ims_db_name}.admin_login as invt INNER JOIN ${global.other_db_name}.rm_sku_images as other ON invt.CustID = other.insert_by WHERE other.rm_sku_key = :key ORDER BY other.ID DESC`,
      {
        replacements: { key: req.body.product },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let result = [];

      for (let i = 0; i < stmt.length; i++) {
        result.push({
          image_name: stmt[i].img_caption,
          image_url:
            "https://media.mscorpres.co.in/oakterIms/uploades/ProductIms/" +
            stmt[i].img_url,
          image_id: stmt[i].img_attach_id,
          uploaded_date: moment(stmt[i].insert_date)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY hh:mm:ss A"),
          uploaded_by: stmt[i].user_name,
        });
      }
      return res.json({ data: result, status: "success", success: true });
    } else {
      return res.json({
        success: false,
        message: "no any image(s) found with product",
        status: "error",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// UPLAOD PRODUCT IMAGE
router.post(
  "/upload_product_img",
  [auth.isAuthorized, upload.array("files")],
  async (req, res) => {
    const transaction = await otherDB.transaction();
    try {
      let filesLenth = req.files.length;

      if (filesLenth <= 0) {
        return res.json({
          message: "add some attachment",
          success: false,
          status: "error",
        });
      }

      for (let i = 0; i < filesLenth; i++) {
        let stmt = await otherDB.query(
          "INSERT INTO `rm_sku_images` (`img_url`, `img_attach_id`, `img_caption`, `rm_sku_key`,`insert_date`,`insert_by`) VALUES( :img_url, :img_attach_id, :img_caption, :rm_sku_key , :insert_date, :insert_by)",
          {
            replacements: {
              img_url: req.files[i].filename,
              img_attach_id: helper.getUniqueNumber(),
              img_caption: req.body.caption,
              rm_sku_key: req.body.product,
              insert_date: moment().format("YYYY-MM-DD HH:mm:ss"),
              insert_by: req.logedINUser,
            },
            type: otherDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );

        if (stmt.length <= 0) {
          await transaction.rollback();
          return res.json({
            success: false,
            message: "Something Wrong! Please Try Again",
            status: "error",
          });
        }
      }

      //
      // const formData = new FormData();
      // for (let i = 0; i < filesLenth; i++) {
      //   const fileStream = fs.createReadStream("./uploads/productImage/" + req.files[i].filename);
      //   formData.append("files[]", fileStream);
      // }
      // const response = await axios.post("https://media.mscorpres.co.in/oakterIms/uploades/productUpload.php", formData, {
      //   headers: {
      //     "Content-Type": "multipart/form-data",
      //   },
      // });
      // if (response.data.code == 500) {
      //   throw new Error(response.data.message);
      // }
      //

      await transaction.commit();
      return res.json({
        success: true,
        message: "Image attched successfully",
        status: "success",
      });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// Fetch Product Data
router.post("/fetchProductData", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      product_key: "required",
    });

    if (valid.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "Validation error",
        data: valid.errors.all(),
      });
    }

    let stmt = await invtDB.query(
      "SELECT * FROM `products` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` WHERE `products`.`product_key` = :key",
      {
        replacements: { key: req.body.product_key },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let final = {
        product_name: stmt[0].p_name,
        product_sku: stmt[0].p_sku,
        unit: stmt[0].units_name,
        hsn: stmt[0].p_hsncode,
        gstrate: stmt[0].p_gst_rate_tax,
        rate: "",
      };

      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: final,
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "Product not found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// TEMP 26-09-2024 - MS0014
var storage1 = multer.diskStorage({
  destination: (req, file, callBack) => {
    const uploadPath = `./uploads/productImage`;

    if (file.fieldname == "images") {
      callBack(null, uploadPath);
    } else if (file.fieldname == "documents") {
      callBack(null, uploadPath);
    }
  },
  filename: function (req, file, callBack) {
    if (file.fieldname == "images") {
      callBack(
        null,
        "SKU" +
          helper.getUniqueNumber() +
          helper.randomNumber(100, 999) +
          path.extname(file.originalname)
      );
    } else if (file.fieldname == "documents") {
      callBack(
        null,
        "DOC" +
          helper.getUniqueNumber() +
          helper.randomNumber(100, 999) +
          path.extname(file.originalname)
      );
    }
  },
});
var upload1 = multer({
  storage: storage1,
}).fields([
  { name: "images", maxCount: 4 },
  { name: "documents", maxCount: 4 },
]);

router.post("/create/temp", [auth.isAuthorized], upload1, async (req, res) => {
  const invtTransaction = await invtDB.transaction();
  const otherTransaction = await otherDB.transaction();
  try {
    const validation = new Validator(req.body, {
      name: "required",
      description: "required",
    });

    if (validation.fails()) {
      await invtTransaction.rollback();
      return res.json({
        success: false,
        status: "error",
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    const fetchProduct = await invtDB.query(
      "SELECT count(ID) as count FROM temp_product_master",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let skuCode = Number(fetchProduct[0].count) + 1;
    skuCode = "RDSFG" + skuCode.toString().padStart(3, "0");

    const productKey = helper.getUniqueNumber();
    let images = "",
      documents = "";

    // Handling images
    if (req.files?.images?.length > 0) {
      for (let file of req.files?.images) {
        images += file.filename + ",";
      }
    }

    // Handling documents
    if (req.files?.documents?.length > 0) {
      for (let file of req.files?.documents) {
        documents += file.filename + ",";
      }
    }

    // Insert the product
    const insertProduct = await invtDB.query(
      "INSERT INTO temp_product_master (product_name, product_sku, product_uom, product_desc, product_key, product_images, product_docs, insert_by, inserted_at, project_code, cost_center, isActive) VALUES (:name, :sku, :unit, :description, :product_key, :images, :documents, :insert_by, :inserted_at, :project_code, :cost_center, :isActive)",
      {
        replacements: {
          name: req.body.name,
          sku: skuCode,
          unit: req.body.unit ?? "202012174615",
          description: req.body.description,
          product_key: productKey,
          images,
          documents,
          insert_by: req.logedINUser,
          inserted_at: moment().format("YYYY-MM-DD HH:mm:ss"),
          project_code: req.body.projectCode ?? "",
          cost_center: req.body.costCenter ?? "",
          isActive: "false",
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: invtTransaction,
      }
    );

    if (insertProduct.length <= 0) {
      await invtTransaction.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "Error while creating product",
      });
    }

    // Fetch approvers
    const fetchApprover = await invtDB.query(
      "SELECT userID, adminTable.Email_ID, stage FROM temp_approvers LEFT JOIN admin_login AS adminTable ON adminTable.CustID = temp_approvers.userID WHERE module = :module AND action = :action",
      {
        replacements: { module: "PRODUCT", action: "CREATE" },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (fetchApprover.length <= 0) {
      await invtTransaction.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "Approver not found",
      });
    }

    // Prepare the list of users and emails to send
    const approvers = fetchApprover
      .filter((data) => data.stage === "L1")[0]
      .userID.split(",")
      .map((id) => id.trim());
    let emailsToSend = [];

    for (let approverID of approvers) {
      const approverData = await invtDB.query(
        "SELECT Email_ID FROM admin_login WHERE CustID = :approverID",
        {
          replacements: { approverID },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (approverData.length > 0) {
        emailsToSend.push(approverData[0].Email_ID);
      }
    }

    // Send email to each approver
    for (let i = 0; i < approvers.length; i++) {
      const otherEmailsToSend = emailsToSend.filter(
        (email, index) => index !== i
      );

      const personalizedMessage = `
				<p>Hello ${emailsToSend[i]},</p>

				<p>This email has been sent to YOU and ${otherEmailsToSend.join(", ")}.</p> 
				<p>Please review the newly created product and provide your approval.</p>

				<p><strong>New Product Name:</strong> ${req.body.name}<br>
				<strong>SKU Code:</strong> ${skuCode}</p>

				<p>Best regards,<br>
				IMS Team</p>
			`;

      const mailReferenceID = helper.getUniqueNumber();

      // Insert mail log
      const insertMail = await otherDB.query(
        "INSERT INTO mails_log (referenceID, status, mail_to, subject, message, sent_dt) VALUES(:referenceID, :status, :mail_to, :subject, :message, :sent_dt)",
        {
          replacements: {
            referenceID: mailReferenceID,
            status: "success",
            success: true,
            mail_to: emailsToSend[i],
            subject: "Approval for new product",
            message: personalizedMessage,
            sent_dt: moment(new Date())
              .tz("Asia/Kolkata")
              .format("YYYY-MM-DD HH:mm:ss"),
          },
          type: otherDB.QueryTypes.INSERT,
          transaction: otherTransaction,
        }
      );

      // const sendEmail = await helper.sendMail(emailsToSend[i], null, "Approval for new product", personalizedMessage, null);
    }

    await invtTransaction.commit();
    await otherTransaction.commit();

    return res.json({
      success: true,
      status: "success",
      message: "Product Created and email sent for approval",
    });
  } catch (error) {
    if (invtTransaction) await invtTransaction.rollback();
    if (otherTransaction) await otherTransaction.rollback();

    console.log(error);
    return helper.errorResponse(res, error);
  }
});

//fetch data for product update

router.get("/fethProductUpdate/:id", [auth.isAuthorized], async (req, res) => {
  try {
    const fetchProduct = await invtDB.query(
      "SELECT * FROM temp_product_master WHERE product_key = :product_key",
      {
        replacements: { product_key: req.params.id },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (fetchProduct.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Product not found",
      });
    }

    const costCenters = await invtDB.query(
      "SELECT cost_center_name, cost_center_key FROM cost_center WHERE cost_center_key = :cost_center_key",
      {
        replacements: { cost_center_key: fetchProduct[0].cost_center },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    const project = await invtDB.query(
      "SELECT project_name, project_description FROM project_master WHERE project_name = :project_name",
      {
        replacements: { project_name: fetchProduct[0].project_code },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    const projectCode =
      project.length > 0
        ? {
            text: project[0].project_description,
            value: project[0].project_name,
          }
        : { text: "Unknown", value: null };

    const costCenter =
      costCenters.length > 0
        ? {
            text: costCenters[0].cost_center_name,
            value: costCenters[0].cost_center_key,
          }
        : { text: "Unknown", value: null };

    let results = [];
    for (let i = 0; i < fetchProduct.length; i++) {
      const product = fetchProduct[i];
      results.push({
        productname: product.product_name,
        productsku: product.product_sku,
        productuom: product.product_uom,
        productdesc: product.product_desc,
        productkey: product.product_key,
        productimages: product.product_images,
        productdocs: product.product_docs,
        insertby: product.insert_by,
        insertedat: product.inserted_at,
        project: projectCode,
        costcenter: costCenter,
        isActive: product.isActive,
      });
    }

    return res.json({
      status: "success",
      success: true,
      message: "Data fetched successfully",
      data: results,
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//update product
router.put(
  "/update/temp/:productKey",
  [auth.isAuthorized],
  upload1,
  async (req, res) => {
    const invtTransaction = await invtDB.transaction();
    const otherTransaction = await otherDB.transaction();
    try {
      const validation = new Validator(req.body, {
        name: "required",
        description: "required",
      });

      if (validation.fails()) {
        await invtTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: helper.firstErrorValidatorjs(validation),
        });
      }

      const { productKey } = req.params;
      const { name, description, unit, projectCode, costCenter, isActive } =
        req.body;

      // Fetch the existing product
      const existingProduct = await invtDB.query(
        "SELECT * FROM temp_product_master WHERE product_key = :productKey",
        {
          replacements: { productKey },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (existingProduct.length === 0) {
        await invtTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Product not found",
        });
      }

      let skuCode = existingProduct[0].product_sku;
      let images = existingProduct[0].product_images,
        documents = existingProduct[0].product_docs;

      if (req.files?.images?.length > 0) {
        images = "";
        for (let file of req.files?.images) {
          images += file.filename + ",";
        }
      }

      if (req.files?.documents?.length > 0) {
        documents = "";
        for (let file of req.files?.documents) {
          documents += file.filename + ",";
        }
      }

      const updateProduct = await invtDB.query(
        `UPDATE temp_product_master
      SET 
        product_name = :name,
        product_sku = :sku,
        product_uom = :unit,
        product_desc = :description,
        product_images = :images,
        product_docs = :documents,
        project_code = :project_code,
        cost_center = :cost_center,
        isActive = :isActive,
        updated_at = :updated_at
      WHERE product_key = :product_key`,
        {
          replacements: {
            name,
            sku: skuCode,
            unit: unit ?? "202012174615",
            description,
            images,
            documents,
            project_code: projectCode ?? "",
            cost_center: costCenter ?? "",
            isActive: isActive ?? "false",
            updated_at: moment().format("YYYY-MM-DD HH:mm:ss"),
            product_key: productKey,
          },
          type: invtDB.QueryTypes.UPDATE,
          transaction: invtTransaction,
        }
      );

      if (updateProduct[0] <= 0) {
        await invtTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Error while updating product",
        });
      }

      // Fetch approvers
      const fetchApprover = await invtDB.query(
        "SELECT userID, adminTable.Email_ID, stage FROM temp_approvers LEFT JOIN admin_login AS adminTable ON adminTable.CustID = temp_approvers.userID WHERE module = :module AND action = :action",
        {
          replacements: { module: "PRODUCT", action: "UPDATE" },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (fetchApprover.length <= 0) {
        await invtTransaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Approver not found",
        });
      }

      const approvers = fetchApprover
        .filter((data) => data.stage === "L1")[0]
        .userID.split(",")
        .map((id) => id.trim());
      let emailsToSend = [];
      
      for (let approverID of approvers) {
        const approverData = await invtDB.query(
          "SELECT Email_ID FROM admin_login WHERE CustID = :approverID",
          {
            replacements: { approverID },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (approverData.length > 0) {
          emailsToSend.push(approverData[0].Email_ID);
        }
      }

      // Send email to each approver
      for (let i = 0; i < approvers.length; i++) {
        const otherEmailsToSend = emailsToSend.filter(
          (email, index) => index !== i
        );

        const personalizedMessage = `
        <p>Hello ${emailsToSend[i]},</p>

        <p>This email has been sent to YOU and ${otherEmailsToSend.join(
          ", "
        )}.</p> 
        <p>Please review the updated product and provide your approval.</p>

        <p><strong>Updated Product Name:</strong> ${name}<br>
        <strong>SKU Code:</strong> ${skuCode}</p>

        <p>Best regards,<br>
        IMS Team</p>
      `;

        const mailReferenceID = helper.getUniqueNumber();

        // Insert mail log
        const insertMail = await otherDB.query(
          "INSERT INTO mails_log (referenceID, status, mail_to, subject, message, sent_dt) VALUES(:referenceID, :status, :mail_to, :subject, :message, :sent_dt)",
          {
            replacements: {
              referenceID: mailReferenceID,
              status: "success",
              success: true,
              mail_to: emailsToSend[i],
              subject: "Approval for updated product",
              message: personalizedMessage,
              sent_dt: moment(new Date())
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD HH:mm:ss"),
            },
            type: otherDB.QueryTypes.INSERT,
            transaction: otherTransaction,
          }
        );
      }

      await invtTransaction.commit();
      await otherTransaction.commit();

      return res.json({
        success: true,
        status: "success",
        message: "Product updated and email sent for approval",
      });
    } catch (error) {
      console.log(error);
      if (invtTransaction) await invtTransaction.rollback();
      if (otherTransaction) await otherTransaction.rollback();
      return helper.errorResponse(res, error);
    }
  }
);

//fetch all temp products
router.get("/fetch/temp", [auth.isAuthorized], async (req, res) => {
  try {
    const fetchProducts = await invtDB.query(
      "SELECT * FROM temp_product_master",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let results = [];

    if (fetchProducts.length > 0) {
      for (let i = 0; i < fetchProducts.length; i++) {
        const uom = await invtDB.query(
          "SELECT units_name FROM units WHERE units_id = :units_id",
          {
            replacements: {
              units_id: fetchProducts[i].product_uom,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (uom.length <= 0) {
          return res.json({
            success: false,
            status: "error",
            message: "UOM not found",
          });
        }

        const images = fetchProducts[i].product_images.split(",");
        const documents = fetchProducts[i].product_docs.split(",");

        // console.log("fetchProducts[i].isActive", fetchProducts[i]);

        const fetchUser = await invtDB.query(
          "SELECT * FROM admin_login WHERE CustID = :user_id",
          {
            replacements: {
              user_id: fetchProducts[i].insert_by,
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

        let fetchProduct = [];
        let fetchCostCenter = [];

        if (
          fetchProducts[i].project_code != "" ||
          fetchProducts[i].project_code != null ||
          fetchProducts[i].project_code != undefined
        ) {
          fetchProduct = await invtDB.query(
            "SELECT * FROM project_master WHERE project_name = :projectCode",
            {
              replacements: {
                projectCode: fetchProducts[i].project_code,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
        }

        if (
          fetchProducts[i].cost_center != "" ||
          fetchProducts[i].cost_center != null ||
          fetchProducts[i].cost_center != undefined
        ) {
          fetchCostCenter = await invtDB.query(
            "SELECT * FROM cost_center WHERE cost_center_key = :costCenter",
            {
              replacements: {
                costCenter: fetchProducts[i].cost_center,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
        }

        results.push({
          name: fetchProducts[i].product_name ?? "",
          sku: fetchProducts[i].product_sku ?? "",
          description: fetchProducts[i].product_desc ?? "",
          unit: uom[0].units_name ?? "",
          images:
            images.length > 0
              ? images
                  .filter((value) => value !== "")
                  .map((item) => {
                    return {
                      url:
                        `${process.env.API_URL}/uploads/productImage/` + item,
                      fileName: item,
                    };
                  })
              : [],
          documents:
            documents.length > 0
              ? documents
                  .filter((value) => value !== "")
                  .map((item) => {
                    return {
                      url:
                        `${process.env.API_URL}/uploads/productImage/` + item,
                      fileName: item,
                    };
                  })
              : [],
          status:
            fetchProducts[i].isActive === "true"
              ? "APR"
              : fetchProducts[i].isRejected === "true"
              ? "REJ"
              : "PEN",
          productKey: fetchProducts[i].product_key,
          createdBy: fetchUser[0].user_name,
          createdAt: moment(fetchProducts[i].inserted_at).format("DD-MMM-YYYY"),
          projectCode:
            fetchProduct.length > 0
              ? {
                  text: `${fetchProduct[0].project_description}`,
                  value: fetchProduct[0].project_name,
                }
              : "",
          costCenter:
            fetchCostCenter.length > 0
              ? {
                  text: `${fetchCostCenter[0].cost_center_name} - ${fetchCostCenter[0].cost_center_short_name}`,
                  value: fetchCostCenter[0].cost_center_key,
                }
              : "",
        });
      }
    }

    return res.json({
      success: true,
      status: "success",
      data: results,
      newSkuCode:
        "RDSFG" +
        (Number(fetchProducts.length) + 1).toString().padStart(3, "0"),
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// Attchment list
// Function to format file sizes
const formatFileSize = (size) => {
  if (size < 1024) return `${size} Bytes`;
  else if (size < 1048576) return `${(size / 1024).toFixed(2)} KB`;
  else if (size < 1073741824) return `${(size / 1048576).toFixed(2)} MB`;
  return `${(size / 1073741824).toFixed(2)} GB`;
};

router.get(
  "/view/attachment/:productKey",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      const { productKey } = req.params;

      const validation = new Validator(
        { productKey },
        {
          productKey: "required",
        }
      );

      if (validation.fails()) {
        return res.json({
          success: false,
          status: "error",
          message: helper.firstErrorValidatorjs(validation),
        });
      }

      const fetchAttachments = await invtDB.query(
        "SELECT product_images, product_docs FROM temp_product_master WHERE product_key = :productKey",
        {
          replacements: { productKey },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (fetchAttachments.length === 0) {
        return res.json({
          success: false,
          status: "error",
          message: "No attachments found for the specified selection",
        });
      }

      const { product_images, product_docs } = fetchAttachments[0];

      const groupedAttachments = {
        images: [],
        documents: [],
      };

      const addAttachment = (filename, folder) => {
        const trimmedFilename = filename.trim();
        const filePath = path.join(
          __dirname,
          `./../../../../uploads/${folder}/`,
          trimmedFilename
        );

        if (trimmedFilename && fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          return {
            fileName: trimmedFilename,
            filePath: `${process.env.API_URL}/uploads/${folder}/${trimmedFilename}`,
            fileSize: formatFileSize(stats.size),
          };
        }
        return null;
      };

      // Process images
      if (product_images) {
        const imageFiles = product_images.split(",");
        groupedAttachments.images = imageFiles
          .map((filename) => addAttachment(filename, "productImage"))
          .filter((obj) => obj !== null); // Filter out null objects
      }

      // Process documents
      if (product_docs) {
        const docFiles = product_docs.split(",");
        groupedAttachments.documents = docFiles
          .map((filename) => addAttachment(filename, "productImage"))
          .filter((obj) => obj !== null); // Filter out null objects
      }

      return res.json({
        success: true,
        status: "success",
        data: groupedAttachments,
      });
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

//check logs of product approval
router.get("/fetch/logs", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      productKey: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    const fetchLogs = await invtDB.query(
      "SELECT * FROM temp_product_master WHERE product_key = :productKey",
      {
        replacements: {
          productKey: req.query.productKey,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (fetchLogs.length <= 0) {
      return res.json({
        success: false,
        status: "error",
        message: "Product not found",
      });
    }

    let result = [];

    const fetchApprover = await invtDB.query(
      "SELECT userID , stage , adminTable.Email_ID , adminTable.user_name AS approverName FROM temp_approvers LEFT JOIN admin_login AS adminTable ON adminTable.CustID = temp_approvers.userID WHERE module = :module AND action = :action",
      {
        replacements: { module: "PRODUCT", action: "CREATE" },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (fetchApprover.length <= 0) {
      await transaction.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "Approver not found",
      });
    }

    for (let i = 0; i < fetchLogs.length; i++) {
      const fetchUser = await invtDB.query(
        "SELECT * FROM admin_login WHERE CustID = :user_id",
        {
          replacements: {
            user_id: fetchLogs[i].insert_by,
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

      // Handling stage1 approver names
      const stage1ApproverIDs = fetchApprover
        .filter((approver) => approver.stage == "L1")[0]
        .userID.split(", ");

      const stage1Approvers = await Promise.all(
        stage1ApproverIDs.map(async (id) => {
          const approver = await invtDB.query(
            "SELECT user_name FROM admin_login WHERE CustID = :user_id",
            {
              replacements: {
                user_id: id.trim(),
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          return approver.length > 0 ? approver[0].user_name : null;
        })
      );

      result.push({
        productName: fetchLogs[i].product_name,
        createdBy: fetchUser[0].user_name,
        createdDate: moment(fetchLogs[i].inserted_at)
          .tz("Asia/Kolkata")
          .format("DD-MM-YYYY hh:mm:ss"),
        status:
          fetchLogs[i].isActive == "true"
            ? 1
            : fetchLogs[i].isRejected == "true"
            ? 1
            : 0,
        currentStatus:
          fetchLogs[i].isActive == "true"
            ? "APPROVED"
            : fetchLogs[i].isRejected == "true"
            ? "REJECTED"
            : "PENDING",
        stage1Approver: stage1Approvers
          .filter((name) => name !== null)
          .join(", "),
        stage1Remarks: fetchLogs[i].stage1Remark ?? null,
        stage1ApprovalDate: fetchLogs[i].stage1Date
          ? moment(fetchLogs[i].stage1Date)
              .tz("Asia/Kolkata")
              .format("DD-MM-YYYY hh:mm:ss")
          : null,
        approver1CRN: stage1ApproverIDs.join(", "),
      });
    }

    return res.json({
      success: true,
      data: result[0],
      status: "success",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

router.patch("/approve/temp/:stage", [auth.isAuthorized], async (req, res) => {
  let transaction = await invtDB.transaction();
  let otherTransaction = await otherDB.transaction();

  try {
    // Validate params
    const paramValidation = new Validator(req.params, {
      stage: "required|in:L1",
    });

    if (paramValidation.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: helper.firstErrorValidatorjs(paramValidation),
      });
    }

    // Validate body
    const validation = new Validator(req.body, {
      productKey: "required",
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

    // Check if the logged-in user is authorized (from comma-separated list of userIDs)
    const checkValidUser = await invtDB.query(
      "SELECT * FROM temp_approvers WHERE FIND_IN_SET(:userID, REPLACE(userID, ' ', '')) AND module = :module AND action = :action",
      {
        replacements: {
          userID: req.logedINUser,
          module: "PRODUCT",
          action: "CREATE",
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (checkValidUser.length <= 0) {
      await transaction.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "You are not authorized to perform this action",
      });
    }

    // Determine if the product is being rejected
    let isRejected = req.body.status === false ? "true" : "false";

    if (req.params.stage == "L1") {
      // Fetch product from the database
      const fetchProduct = await invtDB.query(
        "SELECT * FROM temp_product_master WHERE product_key = :productKey",
        {
          replacements: { productKey: req.body.productKey },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (fetchProduct.length <= 0) {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Product not found",
        });
      }

      if (fetchProduct[0].isRejected == "true") {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Product already rejected",
        });
      } else if (fetchProduct[0].isActive == "true") {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Product already approved",
        });
      }

      // Update the product status and set `isActive` to true if approved
      const updateProduct = await invtDB.query(
        `UPDATE temp_product_master 
                 SET product_status = :status, isRejected = :isRejected, stage1Remark = :remarks, 
                     stage1Date = :stage1Date, isActive = :isActive 
                 WHERE product_key = :productKey`,
        {
          replacements: {
            status: req.body.status === true ? "1" : "0",
            isRejected: isRejected,
            remarks: req.body.remarks,
            productKey: req.body.productKey,
            stage1Date: moment().format("YYYY-MM-DD HH:mm:ss"),
            isActive: req.body.status === true ? "true" : "false",
          },
          type: invtDB.QueryTypes.UPDATE,
          transaction: transaction,
        }
      );

      if (updateProduct.length <= 0) {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Error while updating product",
        });
      }

      const productSKU = fetchProduct[0].product_sku;
      const productName = fetchProduct[0].product_name;
      const fetchApprover = await invtDB.query(
        "SELECT temp_approvers.userID, adminTable.Email_ID FROM temp_approvers LEFT JOIN admin_login AS adminTable ON FIND_IN_SET(adminTable.CustID, REPLACE(temp_approvers.userID, ' ', '')) WHERE module = :module AND action = :action",
        {
          replacements: { module: "PRODUCT", action: "CREATE" },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (fetchApprover.length <= 0) {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Approver not found",
        });
      }

      // Extract the emails from the query result
      const emailList = fetchApprover.map((approver) => approver.Email_ID);

      // Set the first email as the main recipient and the second as CC (if available)
      const mainRecipient = emailList[0];
      const ccRecipient = emailList[1] || null; // Use second email for CC, if it exists

      const mailReferenceID = helper.getUniqueNumber();
      const approvalStatus = req.body.status === true ? "Approved" : "Rejected";
      const emailSubject = `Product ${approvalStatus}: ${productName} (SKU: ${productSKU})`;

      const emailMessage = `
                    <h3>Product Status Update</h3>
                    <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%;">
                        <thead>
                            <tr>
                                <th style="text-align: left;">Product</th>
                                <th style="text-align: left;">SKU</th>
                                <th style="text-align: left;">Status</th>
                                <th style="text-align: left;">Remark</th>
                                <th style="text-align: left;">Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>${productName}</td>
                                <td>${productSKU}</td>
                                <td>${approvalStatus}</td>
                                <td>${req.body.remarks || "None"}</td>
                                <td>${moment().format(
                                  "YYYY-MM-DD HH:mm:ss"
                                )}</td>
                            </tr>
                        </tbody>
                    </table>
                `;

      const insertMail = await otherDB.query(
        "INSERT INTO mails_log (referenceID, status, mail_to, subject, message, sent_dt) VALUES (:referenceID, :status, :mail_to, :subject, :message, :sent_dt)",
        {
          replacements: {
            referenceID: mailReferenceID,
            status: "success",
            success: true,
            mail_to: fetchApprover[0].Email_ID,
            subject: emailSubject,
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
        mainRecipient,
        ccRecipient || undefined,
        emailSubject,
        emailMessage
      );

      await transaction.commit();
      return res.json({
        success: true,
        status: "success",
        message:
          req.body.status === true ? "Product Approved" : "Product Rejected",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//search api for temp products
router.get("/search/temp", [auth.isAuthorized], async (req, res) => {
  try {
    if (req.query.search.length > 2) {
      const fetchProducts = await invtDB.query(
        `SELECT product_name , product_sku , product_key FROM temp_product_master WHERE (product_name LIKE '%${req.query.search}%' OR product_sku LIKE '%${req.query.search}%') AND isActive = 'true'`,
        {
          type: invtDB.QueryTypes.SELECT,
        }
      );
      return res.json({
        success: true,
        data:
          fetchProducts.length > 0
            ? fetchProducts.map((item) => {
                return {
                  text: item.product_sku + " - " + item.product_name,
                  value: item.product_sku,
                };
              })
            : [],
        status: "success",
      });
    } else {
      const fetchProducts = await invtDB.query(
        `SELECT product_name , product_sku , product_key FROM temp_product_master WHERE isActive = 'true' LIMIT 10`,
        {
          type: invtDB.QueryTypes.SELECT,
        }
      );
      return res.json({
        success: true,
        data: fetchProducts.map((item) => {
          return {
            text: item.product_sku + " - " + item.product_name,
            value: item.product_sku,
          };
        }),
        status: "success",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//fetch rejected temp products
router.get("/fetch/rejected/temp", [auth.isAuthorized], async (req, res) => {
  try {
    const fetchProducts = await invtDB.query(
      "SELECT * FROM temp_product_master WHERE isRejected = 'true'",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let results = [];

    if (fetchProducts.length > 0) {
      for (let i = 0; i < fetchProducts.length; i++) {
        const uom = await invtDB.query(
          "SELECT units_name FROM units WHERE units_id = :units_id ",
          {
            replacements: {
              units_id: fetchProducts[i].product_uom,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        const images = fetchProducts[i].product_images.split(",");
        const documents = fetchProducts[i].product_docs.split(",");

        results.push({
          name: fetchProducts[i].product_name,
          sku: fetchProducts[i].product_sku,
          description: fetchProducts[i].product_desc,
          unit: uom[0].units_name,
          images:
            images.length > 0
              ? images
                  .filter((value) => value !== "")
                  .map((item) => {
                    return {
                      url:
                        `${process.env.API_URL}/uploads/productImage/` + item,
                      fileName: item,
                    };
                  })
              : [],
          documents:
            documents.length > 0
              ? documents
                  .filter((value) => value !== "")
                  .map((item) => {
                    return {
                      url:
                        `${process.env.API_URL}/uploads/productImage/` + item,
                      fileName: item,
                    };
                  })
              : [],
          status:
            fetchProducts[i].isActive === "true"
              ? "APR"
              : fetchProducts[i].isRejected === "true"
              ? "REJ"
              : "PEN",
          stage1Remarks: fetchProducts[i].stage1Remark ?? "",
          stage2Remarks: fetchProducts[i].stage2Remark ?? "",
          productKey: fetchProducts[i].product_key,
        });
      }
    }

    return res.json({
      success: true,
      data: results,
      status: "success",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});
module.exports = router;
