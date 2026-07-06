const express = require("express");
const router = express.Router();

let {
  invtDB,
  otherDB,
  tallyDB,
  invtOakterDB,
} = require("../../../config/db/connection");

const { encode, decode } = require("html-entities");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const path = require("path");
const fs = require("fs");

const Validator = require("validatorjs");

// get vendor list by name or code
router.post("/vendorList", [auth.isAuthorized], (req, res) => {
  const data = req.body.search;
  const validation = new Validator(req.body, {
    search: "required",
  });

  if (validation.fails()) {
    res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.errors[0],
    });
    return;
  }

  if (validation.passes()) {
    invtDB
      .query(
        "SELECT * FROM `ven_basic_detail` WHERE (`ven_name` like :name OR `ven_short_name` LIKE :name OR `ven_pan_no` LIKE :name OR `ven_register_id` LIKE :name) AND `status` = 'A' ORDER BY `ven_name`",
        {
          replacements: { name: `%${data}%` },
          type: invtDB.QueryTypes.SELECT,
        }
      )
      .then((result) => {
        let final = [];

        result.map((item) => {
          final.push({
            id: item.ven_register_id,
            text: "(" + item.ven_register_id + ") " + item.ven_name,
          });
        });

        if (result.length == final.length) {
          return res.json({
            success: true,
            data: final,
            status: "success",
            success: true,
          });
        }
      })
      .catch((err) => {
        return helper.errorResponse(res, err);
      });
  }
});

// get vendor branch list by name or code
router.post("/vendorBranchList", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    vendorcode: "required",
  });

  if (validation.fails()) {
    res.json({
      message: validation.errors.errors[0],
      status: "error",
      success: false,
    });
    return;
  }

  if (validation.passes()) {
    invtDB
      .query("SELECT * FROM `ven_address_detail` WHERE `ven_id` = :vendor", {
        replacements: { vendor: req.body.vendorcode },
        type: invtDB.QueryTypes.SELECT,
      })
      .then((result) => {
        let final = [];

        result.map((item) => {
          final.push({ id: item.ven_address_id, text: item.ven_add_label });
        });

        if (result.length == final.length) {
          res.json({ data: final, success: true, message: "" });
          return;
        }
      })
      .catch((err) => {
        return helper.errorResponse(res, err);
      });
  }
});

// get vendor address by vendor id and vendorAddress id
router.post("/vendorAddress", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    vendorcode: "required",
    branchcode: "required",
  });

  if (validation.fails()) {
    res.json({
      message: validation.errors.errors[0],
      status: "error",
      success: false,
    });
    return;
  }

  if (validation.passes()) {
    invtDB
      .query(
        "SELECT ven_address_detail.*, ven_basic_detail.ven_einvoice_status, ven_basic_detail.ven_einvoice_date FROM `ven_address_detail` LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = ven_address_detail.ven_id  WHERE ven_address_detail.`ven_address_id` = :branchcode AND ven_address_detail.`ven_id` = :vendorcode",
        {
          replacements: {
            vendorcode: req.body.vendorcode,
            branchcode: req.body.branchcode,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      )
      .then((result) => {
        if (result.length > 0) {
          res.json({
            message: "Data Found",
            data: {
              address: result[0].ven_address,
              gstid: result[0].ven_add_gst.toUpperCase(),
              state: result[0].ven_state,
              country: "INDIA",
              einvoice_status: result[0].ven_einvoice_status,
            },
            success: true,
            status: "success",
          });
          return;
        } else {
          res.json({
            message: "No Data Found",
            success: false,
            status: "error",
          });
          return;
        }
      })
      .catch((err) => {
        return helper.errorResponse(res, err);
      });
  }
});

// search component by name or code
router.post("/componentList", [auth.isAuthorized], (req, res) => {
  const data = req.body.search;
  const validation = new Validator(req.body, {
    search: "required",
  });

  if (validation.fails()) {
    res.json({
      message: validation.errors.errors[0],
      status: "error",
      success: false,
    });
    return;
  }

  if (validation.passes()) {
    invtDB
      .query(
        "SELECT * FROM `products` WHERE `p_name` like :name OR `p_sku` LIKE :name OR `m_sku` LIKE :name AND `m_sku` != '--' ORDER BY `p_name`",
        {
          replacements: { name: `%${data}%` },
          type: invtDB.QueryTypes.SELECT,
        }
      )
      .then((result) => {
        if (result.length > 0) {
          res.json({ message: "success", data: result });
        }
      })
      .catch((err) => {
        return helper.errorResponse(res, err);
      });
  }
});

// all billing address list
router.post("/billingAddressList", [auth.isAuthorized], async (req, res) => {
  try {
    const limit = 10;
    let stmt;
    if (req.body.search) {
      stmt = await invtDB.query(
        "SELECT * FROM `billing_address` WHERE `billing_status` = 'Y' AND `use_for` = 'COMPANY' AND (`billing_company` like :name OR `billing_gstno` LIKE :name OR `billing_address` LIKE :name) ORDER BY `billing_company` LIMIT :limit",
        {
          replacements: { name: `%${req.body.search}%`, limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT * FROM `billing_address` WHERE `billing_status` = 'Y' AND `use_for` = 'COMPANY' ORDER BY `billing_company` ASC LIMIT :limit",
        {
          replacements: { limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];

    stmt.map((item) => {
      final.push({ id: item.billing_code, text: item.billing_lable });

      if (stmt.length == final.length) {
        res.json({
          message: "success",
          data: final,
          status: "success",
          success: true,
        });
        return;
      }
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// billing address by code
router.post("/billingAddress", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    billing_code: "required",
  });

  if (validation.fails()) {
    res.json({
      message: validation.errors.errors[0],
      status: "error",
      success: false,
    });
    return;
  }

  if (validation.passes()) {
    invtDB
      .query(
        "SELECT * FROM `billing_address` WHERE `billing_status` = 'Y' AND `billing_code` = :billing_code",
        {
          replacements: { billing_code: req.body.billing_code },
          type: invtDB.QueryTypes.SELECT,
        }
      )
      .then((result) => {
        if (result.length > 0) {
          res.json({
            message: "Billing Address Found",
            data: {
              statecode: result[0].billing_state,
              company: result[0].billing_company,
              address: result[0].billing_address,
              gstin: result[0].billing_gstno,
              cin: result[0].billing_cin,
              pan: result[0].billing_pan,
            },
            status: "success",
            success: true,
          });
        } else {
          res.json({
            message: "No Data Found",
            success: false,
            status: "error",
          });
        }
      })
      .catch((err) => {
        res.json({
          message:
            "Internal Error<br/>If this condition persists, contact your system administrator",
        });
        return;
      });
  }
});

// all shipping address list
router.post("/shipingAddressList", [auth.isAuthorized], async (req, res) => {
  try {
    const limit = 10;
    let stmt;
    if (req.body.search) {
      stmt = await invtDB.query(
        "SELECT * FROM `shipment_address` WHERE `shipment_status` = 'Y' AND `use_for` = 'COMPANY' AND (`shipment_company` like :name OR `shipment_gstin` LIKE :name OR `shipment_address` LIKE :name) ORDER BY `shipment_company` LIMIT :limit",
        {
          replacements: { name: `%${req.body.search}%`, limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT * FROM `shipment_address` WHERE `shipment_status` = 'Y' AND `use_for` = 'COMPANY' ORDER BY `shipment_company` ASC LIMIT :limit",
        {
          replacements: { limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];

    stmt.map((item) => {
      final.push({ id: item.shipment_code, text: item.shipment_label });

      if (stmt.length == final.length) {
        res.json({
          message: "success",
          data: final,
          status: "success",
          success: true,
        });
        return;
      }
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// shipping address by code
router.post("/shippingAddress", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    shipping_code: "required",
  });

  if (validation.fails()) {
    res.json({
      message: validation.errors.errors[0],
      status: "error",
      success: false,
    });
    return;
  }

  if (validation.passes()) {
    invtDB
      .query(
        "SELECT * FROM `shipment_address` WHERE `shipment_status` = 'Y' AND `shipment_code` = :shipping_code",
        {
          replacements: { shipping_code: req.body.shipping_code },
          type: invtDB.QueryTypes.SELECT,
        }
      )
      .then((result) => {
        if (result.length > 0)
          res.json({
            message: "success",
            data: {
              statecode: result[0].shipment_state_code,
              company: result[0].shipment_company,
              address: result[0].shipment_address,
              gstin: result[0].shipment_gstin,
              pan: result[0].shipment_pan,
              pincode: result[0].shipment_pincode,
            },
            status: "success",
            success: true,
          });
        else res.json({ message: "No Data Found" });
      })
      .catch((err) => {
        return helper.errorResponse(res, err);
      });
  }
});

// all shipping address list
router.post("/dispatchAddressList", [auth.isAuthorized], async (req, res) => {
  try {
    const limit = 10;
    let stmt;
    if (req.body.search) {
      stmt = await invtDB.query(
        "SELECT * FROM `dispatch_address` WHERE `dispatch_status` = 'Y' AND (`dispatch_company` like :name OR `dispatch_gstin` LIKE :name) ORDER BY `dispatch_company` LIMIT :limit",
        {
          replacements: { name: `%${req.body.search}%`, limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT * FROM `dispatch_address` WHERE `dispatch_status` = 'Y' ORDER BY `dispatch_company` ASC LIMIT :limit",
        {
          replacements: { limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];

    for (let i = 0; i < stmt.length; i++) {
      let item = stmt[i];
      final.push({ key: item.dispatch_code, label: item.dispatch_label });
    }

    return res.json({
      success: true,
      data: final,
      status: "success",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// shipping address by code
router.post("/dispatchAddress", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    dispatch_code: "required",
  });

  if (validation.fails()) {
    res.json({
      message: validation.errors.errors[0],
      status: "error",
      success: false,
    });
    return;
  }

  if (validation.passes()) {
    invtDB
      .query(
        "SELECT * FROM `dispatch_address` WHERE `dispatch_status` = 'Y' AND `dispatch_code` = :dispatch_code",
        {
          replacements: { dispatch_code: req.body.dispatch_code },
          type: invtDB.QueryTypes.SELECT,
        }
      )
      .then((result) => {
        if (result.length > 0)
          res.json({
            data: {
              company: result[0].dispatch_company,
              address: result[0].dispatch_address,
              gstin: result[0].dispatch_gstin,
              pan: result[0].dispatch_pan,
              pincode: result[0].dispatch_pincode,
            },
            success: true,
            status: "success",
          });
        else res.json({ message: "No Data Found", success: false, status: "error" });
      })
      .catch((err) => {
        return helper.errorResponse(res, err);
      });
  }
});

// GET MIS Departments
router.post("/misDepartment", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    search: "required",
  });

  if (validation.fails()) {
    return res.json({
      message: helper.firstErrorValidatorjs(validation),
      success: false,
    });
  }

  try {
    const result = await invtDB.query(
      "SELECT * FROM `master_prod_dprt` WHERE `dprt_name` LIKE :name  ORDER BY dprt_name",
      {
        replacements: { name: `%${req.body.search}%` },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (result.length > 0) {
      const final = result.map((item) => ({
        id: item.prod_dprt_key,
        text: item.dprt_name,
      }));

      return res.json({ data: final, status: "success", success: true });
    } else {
      return res.json({
        message: "No Data Found",
        status: "error",
        success: false,
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// get component by name and no
// router.post(
//   "/getComponentByNameAndNo",
//   [auth.isAuthorized],
//   async (req, res) => {
//     try {
//       const validation = new Validator(req.body, {
//         search: "required",
//       });

//       if (validation.fails()) {
//         return res.json({
//           message: helper.firstErrorValidatorjs(validation),
//           success: false,
//           status: "error",
//         });
//       }

//       let { search, limit } = req.body;

//       // ✅ MIN 3 CHARACTER SEARCH RULE
//       if (!search || search.length < 3) {
//         return res.json({
//           message: "Please enter at least 3 characters to search",
//           success: false,
//           status: "error",
//         });
//       }

//       // ✅ DEFAULT LIMIT = 15
//       limit = limit ? Number(limit) : 15;

//       const result = await invtDB.query(
//         "SELECT components.component_key, components.c_name, components.c_part_no, components.manufacturing_code, components.attribute_code, components.pia_status, components.c_new_part_no, units.units_name AS units FROM components LEFT JOIN units ON components.c_uom = units.units_id WHERE ( c_name LIKE :name OR c_part_no LIKE :name OR manufacturing_code LIKE :name ) AND c_is_enabled = 'Y' ORDER BY c_name LIMIT :limit",
//         {
//           replacements: { name: `%${search}%`, limit },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );

//       if (!result.length) {
//         return res.json({
//           message: "No Data Found",
//           success: false,
//           status: "error",
//         });
//       }

//       let promisses = result.map(async (item) => {
//         return {
//           id: item.component_key,
//           text: "(" + decode(item.c_name) + ") " + item.c_part_no,
//           part_code: item.c_part_no,
//           units: item.units,
//           uID: item.attribute_code,
//           newPart: item.c_new_part_no,
//           piaStatus: item.pia_status,
//           mfgCode: item.manufacturing_code,
//           rate: await require("../../../helper/utils/avgRate").getWeightedPurchaseRate(
//             item.component_key,
//             moment(new Date()).format("YYYY-MM-DD HH:mm:ss")
//           ),
//         };
//       });

//       const finalData = await Promise.all(promisses);

//       return res.json({
//         message: "success",
//         success: true,
//         data: finalData,
//       });
//     } catch (err) {
//       console.error(err);
//       return helper.errorResponse(res, err);
//     }
//   }
// );

router.post("/getComponentByNameAndNo",  async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      search: "required",
    });

    let result;
    if (validation.passes()) {
      result = await invtDB.query(
        `SELECT components.*
           FROM components
           WHERE (
             components.c_name LIKE CONCAT('%', :name, '%')
             OR components.c_part_no LIKE CONCAT('%', :name, '%')
             OR components.manufacturing_code LIKE CONCAT('%', :name, '%')
             OR components.component_key = :name
           ) AND components.c_is_enabled = 'Y'
           ORDER BY components.c_name`,
        {
          replacements: { name: req.body.search.trim() },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else {
      result = await invtDB.query(
        `SELECT components.*
           FROM components
           ORDER BY components.c_name
           LIMIT 20`,
        {
          type: invtDB.QueryTypes.SELECT,
        },
      );
    }

    if (result.length <= 0) {
      return res.json({ success: false, status: "error", message: "No Data Found" });
    }

    const finalData = await Promise.all(
      result.map(async (item) => {
        const avgRate = await require("../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(
          item.component_key,
        );

        return {
          id: item.component_key,
          text: item.c_part_no + " - (" + decode(item.c_name) + ")",
          part_code: item.c_part_no,
          uID: item.attribute_code,
          newPart: item.c_new_part_no,
          piaStatus: item.pia_status,
          mfgCode: item.manufacturing_code,
          rate: avgRate ?? "0",
        };
      }),
    );

    return res.json({
      success: true,
      status: "success",
      data: finalData,
    });
  } catch (err) {
    console.log(err)
    return helper.errorResponse(res, err);
  }
});

// GET REFURBISH COMPONENT BY NAME AND NO
// router.post(
//   "/refurbish/getComponentByNameAndNo",
//   [auth.isAuthorized],
//   async (req, res) => {
//     const validation = new Validator(req.body, {
//       search: "required",
//     });

//     if (validation.fails()) {
//       res.json({
//         message: validation.errors.errors[0],
//         status: "error",
//         success: false,
//       });
//       return;
//     }

//     if (validation.passes()) {
//       refbDB
//         .query(
//           "SELECT * FROM `components` WHERE (`c_name` LIKE :name OR `c_part_no` LIKE :name) AND c_is_enabled = 'Y' ORDER BY c_name",
//           {
//             replacements: { name: `%${req.body.search}%` },
//             type: refbDB.QueryTypes.SELECT,
//           }
//         )
//         .then((result) => {
//           if (result.length > 0) {
//             let final = [];

//             result.map((item) => {
//               final.push({
//                 id: item.component_key,
//                 text: "(" + decode(item.c_name) + ") " + item.c_part_no,
//               });
//             });

//             if (result.length == final.length) {
//               return res.json({
//                 data: final,
//                 success: true,
//                 message: "Data Found",
//               });
//             }
//           } else {
//             return res.json({
//               message: "No Data Found",
//               success: false,
//               status: "error",
//             });
//           }
//         })
//         .catch((err) => {
//           return helper.errorResponse(res, err);
//         });
//     }
//   }
// );

//search product UOM
router.post("/getProductUOM", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    search: "required",
  });

  if (validation.fails()) {
    return res.json({
      message: "something you missing in form field to supply",
      data: validation.errors.errors[0],
      status: "error",
      success: false,
    });
  }

  try {
    let result = await invtDB.query(
      "SELECT `units`.`units_name` FROM `products`LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` WHERE `products`.`product_key` = :productkey",
      {
        replacements: {
          productkey: req.body.search,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (result.length > 0) {
      return res.json({
        status: "success",
        success: true,
        data: { uom: result[0].units_name },
      });
    } else {
      return res.json({
        message: "No Data Found",
        status: "error",
        success: false,
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Search Product and Component both
// Shiv Kumar [15-07-2024]
router.post("/getFGRMByNameAndNo", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    search: "required",
  });

  if (validation.fails()) {
    return res.json({
      message: "something you missing in form field to supply",
      data: validation.errors.errors[0],
      success: false,
      status: "error",
    });
  }

  try {
    let result = await invtDB.query(
      "SELECT p.p_sku AS code, p.product_key AS `key`, p.p_name AS name, 'FG' AS type FROM products p WHERE p.p_sku LIKE :search OR p.p_name LIKE :search UNION SELECT c.c_part_no AS code, c.component_key AS `key`, c.c_name AS name, 'RM' AS type FROM components c WHERE c.c_name LIKE :search OR c.c_part_no LIKE :search ORDER BY code ASC LIMIT 20",
      {
        replacements: {
          search: `%${req.body.search}%`,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (result.length > 0) {
      let final = [];

      result.map((item) => {
        final.push({
          id: item.key,
          text: "(" + item.code + ") " + decode(item.name),
          type: item.type,
        });
      });

      if (result.length == final.length) {
        return res.json({ success: true, data: final, status: "success" });
      }
    } else {
      return res.json({
        success: false,
        message: "No Data Found",
        status: "error",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// search Product
router.post("/getProductByNameAndNo", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    search: "required",
  });

  if (validation.fails()) {
    return res.json({
      message: "something you missing in form field to supply",
      data: validation.errors.errors[0],
      success: false, status: "error",
    });
  }

  try {
    let result = await invtDB.query(
      "SELECT * FROM `products` WHERE p_name LIKE :search OR p_sku LIKE :search AND is_enabled = 'Y' ORDER BY `p_name` ASC",
      {
        replacements: {
          search: `%${req.body.search}%`,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (result.length > 0) {
      let final = [];

      result.map((item) => {
        final.push({
          id: item.product_key,
          text: "(" + item.p_sku + ") " + decode(item.p_name),
        });
      });

      if (result.length == final.length) {
        return res.json({ success: true, data: final, status: "success" });
      }
    } else {
      return res.json({
        success: false,
        message: "No Data Found",
        status: "error",
      });
    }
    return;
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//only semi product
router.post(
  "/getSemiProductByNameAndNo",
  [auth.isAuthorized],
  async (req, res) => {
    const validation = new Validator(req.body, {
      search: "required",
    });

    if (validation.fails()) {
      return res.json({
        message: "Something you missing in form field to supply",
        data: validation.errors.errors[0],
        success: false, status: "error",
      });
    }

    try {
      let result = await invtDB.query(
        "SELECT * FROM `products` WHERE (p_name LIKE :search OR p_sku LIKE :search) AND products_type = 'semi' AND is_enabled = 'Y' ORDER BY `products`.`products_type` DESC",
        {
          replacements: {
            search: `%${req.body.search}%`,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (result.length > 0) {
        let final = [];

        result.map((item) => {
          final.push({
            id: item.product_key,
            text: "(" + item.p_sku + ") " + decode(item.p_name),
          });
        });

        if (result.length === final.length) {
          return res.json({ success: true, data: final, status: "success" });
        }
      } else {
        return res
          .status(500)
          .json({ success: false, message: "No Data Found", status: "error" });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// search po by po no
router.post("/searchPoByPoNo", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    search: "required",
  });

  if (validation.fails()) {
    res.json({
      message: validation.errors.errors[0],
      status: "error",
      success: false,
    });
    return;
  }

  if (validation.passes()) {
    invtDB
      .query(
        "SELECT po_transaction FROM `po_purchase_req` WHERE `po_transaction` LIKE CONCAT('%', :ponumber, '%') GROUP BY `po_transaction` ORDER BY `po_transaction` DESC",
        {
          replacements: { ponumber: req.body.search },
          type: invtDB.QueryTypes.SELECT,
        }
      )
      .then((result) => {
        if (result.length > 0) {
          let final = [];

          result.map((item) => {
            final.push({ id: item.po_transaction, text: item.po_transaction });
          });

          if (result.length == final.length) {
            return res.json({ data: final, status: "success", success: true });
          }
        } else {
          return res.json({
            message: "No Data Found",
            status: "error",
            success: false,
          });
        }
      })
      .catch((err) => {
        return helper.errorResponse(res, err);
      });
  }
});

// fetch branches
router.get("/fetchBranches", [auth.isAuthorized], (req, res) => {
  invtDB
    .query(
      "SELECT branch_code,branch_name FROM `branches` ORDER BY branch_name ",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    )
    .then((result) => {
      return res.json({
        message: "success",
        data: result,
        status: "success",
        success: true,
      });
    })
    .catch((err) => {
      return helper.errorResponse(res, err);
    });
});
// search branch by name and no
router.post("/fetchBranches", [auth.isAuthorized], (req, res) => {
  let validation = new Validator(req.body, {
    search: "required",
  });

  if (validation.fails()) {
    return res.json({
      message: validation.errors.errors[0],
      status: "error",
      success: false,
    });
  }
  invtDB
    .query(
      "SELECT * FROM `branches` WHERE (`branch_name` like :name OR `branch_code` LIKE :name)",
      {
        replacements: { name: `%${req.body.search}%` },
        type: invtDB.QueryTypes.SELECT,
      }
    )
    .then((result) => {
      return res.json({
        message: "success",
        data: result,
        status: "success",
        success: true,
      });
    })
    .catch((err) => {
      return helper.errorResponse(res, err);
    });
});

// fetch user searchUserForAppTransStatus
router.post(
  "/searchUserForAppTransStatus",
  [auth.isAuthorized],
  async (req, res) => {
    const validation = new Validator(req.body, {
      user: "required",
    });

    if (validation.fails()) {
      return res.json({
        message: "something you missing in form field to supply",
        data: validation.errors.errors[0],
        status: "error",
        success: false,
      });
    }

    invtDB
      .query(
        "SELECT CustID,user_name FROM `admin_login` WHERE (`Mobile_No` LIKE :name OR `Email_ID` LIKE :name OR `CustID` = :name) GROUP BY `CustID` ORDER BY `ID` DESC ",
        {
          replacements: { name: `%${req.body.user}%` },
          type: invtDB.QueryTypes.SELECT,
        }
      )
      .then((result) => {
        return res.json({
          message: "success",
          data: result,
          status: "success",
          success: true,
        });
      })
      .catch((err) => {
        return helper.errorResponse(res, err);
      });
  }
);

// fetch All product
router.post("/fetchAllProduct", [auth.isAuthorized], async (req, res) => {
  try {
    let result;

    if (req.body.searchTerm == "") {
      result = await invtDB.query(
        "SELECT * FROM `products` WHERE is_enabled = 'Y' ORDER BY `p_name` ASC",
        {
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      result = await invtDB.query(
        "SELECT * FROM `products` WHERE p_name LIKE :search OR p_sku LIKE :search AND is_enabled = 'Y' ORDER BY `p_name` ASC",
        {
          replacements: {
            search: `%${req.body.searchTerm}%`,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    if (result.length > 0) {
      let final = [];

      result.map((item) => {
        final.push({
          id: item.product_key,
          text: decode(item.p_name) + "(" + item.p_sku + ")",
        });
      });

      if (result.length == final.length) {
        return res.json({ data: final, status: "success", success: true });
      }
    }
    return res.json({
      message: "No Data Found",
      status: "error",
      success: false,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// search Product
router.post("/fetchProduct", [auth.isAuthorized], async (req, res) => {
  try {
    const limit = 10;
    let stmt;
    if (req.body.searchTerm) {
      stmt = await invtDB.query(
        "SELECT * FROM `products` WHERE (`p_name` LIKE :search OR `p_sku` LIKE :search) AND is_enabled = 'Y' ORDER BY `p_name` ASC LIMIT :limit",
        {
          replacements: { search: `%${req.body.searchTerm}%`, limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT * FROM `products` WHERE is_enabled = 'Y' ORDER BY `p_name` ASC LIMIT :limit",
        { replacements: { limit: limit }, type: invtDB.QueryTypes.SELECT }
      );
    }

    let final = [];

    stmt.map((item) => {
      final.push({
        id: item.p_sku,
        text: "(" + item.p_sku + ") " + decode(item.p_name),
      });

      if (stmt.length == final.length) {
        return res.json({ success: true, data: final, status: "success" });
      }
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// get bom(s) for product by sku code
router.post("/fetchBomForProduct", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    search: "required",
  });

  if (validation.fails()) {
    return res.json({
      message: "something you missing in form field to supply",
      status: "error",
      success: false,
    });
  }

  try {
    let stmt1count = 0;
    let stmt1 = await invtDB.query(
      "SELECT * FROM products LEFT JOIN units ON products.p_uom = units.units_id WHERE p_sku = :sku OR m_sku = :sku",
      {
        replacements: { sku: req.body.search },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let data = [];
    if (stmt1.length > 0) {
      stmt1.map(async (val) => {
        let stmt2 = await invtDB.query(
          "SELECT * FROM bom_recipe WHERE (bom_product_sku = :product1 OR bom_product_sku = :product2) AND bom_status = 'ENABLE'",
          {
            replacements: { product1: val.p_sku, product2: val.m_sku },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        stmt2.map((item) => {
          data.push({ bomid: item.subject_id, bomname: item.subject_name });

          if (stmt2.length == data.length) {
            return res.json({
              status: "success",
              success: true,
              data: data,
              other: { uom: stmt1[0].units_name },
            });
          }
        });
      });
    } else {
      return res.json({
        message: "no data found",
        status: "error",
        success: false,
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

router.post("/fetchLocation", [auth.isAuthorized], async (req, res) => {
  try {
    let result;

    if (req.body.searchTerm == "" || req.body.searchTerm == undefined) {
      result = await invtDB.query(
        "SELECT location_key,loc_name FROM `location_main` WHERE (`loc_type` = '1' AND `loc_status` = 'ACTIVE') AND `company_branch` = :branch LIMIT :limit",
        {
          replacements: {
            limit: 10,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      result = await invtDB.query(
        "SELECT location_key,loc_name FROM `location_main` WHERE (`loc_type` = '1' AND `loc_name` LIKE :search AND `loc_status` = 'ACTIVE') AND `company_branch` = :branch",
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

      for (let i = 0; i < result.length; i++) {
        final.push({ id: result[i].location_key, text: result[i].loc_name });
      }

      return res.json({ status: "success", success: true, data: final });
    } else {
      res.json({ massage: "No Data Found", status: "error", success: false });
    }
    return;
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH REFURBISH LOCATION
// router.post(
//   "/refurbish/fetchLocation",
//   [auth.isAuthorized],
//   async (req, res) => {
//     try {
//       let result;

//       if (req.body.searchTerm == "" || req.body.searchTerm == undefined) {
//         result = await refbDB.query(
//           "SELECT location_key,loc_name FROM `location_main` WHERE (`loc_type` = '1' AND `loc_status` = 'ACTIVE') AND `company_branch` = :branch LIMIT :limit",
//           {
//             replacements: {
//               limit: 10,
//               branch: req.branch,
//             },
//             type: refbDB.QueryTypes.SELECT,
//           }
//         );
//       } else {
//         result = await refbDB.query(
//           "SELECT location_key,loc_name FROM `location_main` WHERE (`loc_type` = '1' AND `loc_name` LIKE :search AND `loc_status` = 'ACTIVE') AND `company_branch` = :branch",
//           {
//             replacements: {
//               search: `%${req.body.searchTerm}%`,
//               branch: req.branch,
//             },
//             type: refbDB.QueryTypes.SELECT,
//           }
//         );
//       }
//       if (result.length > 0) {
//         let final = [];

//         result.map((item) => {
//           final.push({ id: item.location_key, text: item.loc_name });
//         });

//         if (result.length == final.length) {
//           res.json(final);
//           return;
//         }
//       } else {
//         res.json({ massage: "No Data Found", status: "error", success: false });
//       }
//       return;
//     } catch (err) {
//       return helper.errorResponse(res, err);
//     }
//   }
// );

//Fetch Vendor Jw Location Mapped with Vendor
router.get("/fetchVendorJWLocation", [auth.isAuthorized], async (req, res) => {

  const { vendor } = req.query;

  if (!vendor) {
    return res.json({ success: false, message: "No Data Found", status: "error" });
  }
  let stmt1 = await invtDB.query(
    "SELECT * FROM `ven_basic_detail` WHERE  `ven_register_id` = :vendor",
    {
      replacements: { vendor: vendor },
      type: invtDB.QueryTypes.SELECT,
    }
  );

  if (stmt1.length > 0) {
    let arr = stmt1[0].ven_location.split(",");
    let locs = [];
    let stmt2;
    arr.forEach(async (item, inx) => {
      stmt2 = await invtDB.query(
        "SELECT `location_key`, `loc_name` FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
        {
          replacements: { location_defined: item },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      stmt2.forEach((chitem, inx) => {
        locs.push({ id: chitem.location_key, text: chitem.loc_name });
      });
      if (inx == arr.length - 1) {
        res.json({ success: true, data: locs, status: "success" });
        return;
      }
    });
  }
});

// search hsn
router.post("/searchHsn", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    searchTerm: "required",
  });

  if (validation.fails()) {
    return res.status(400).json({
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.errors[0],
      status: "error",
      success: false,
    });
  }

  try {
    let result = await invtDB.query(
      "SELECT * FROM `ims_hsncode` WHERE (`hscsac_code` like :name OR `hsn_description` LIKE :name)",
      {
        replacements: {
          name: `%${req.body.searchTerm}%`,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (result.length > 0) {
      let final = [];

      result.map((item) => {
        final.push({
          id: item.hscsac_code,
          text: "(" + item.hscsac_code + ") " + item.hsn_description,
        });
      });

      if (result.length == final.length) {
        return res.json({ success: true, data: final });
      }
    } else {
      return res.json({ massage: "No Data Found", success: false });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// MAP HSN TO COMPONENT
router.post("/mapHsn", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    component: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      message: "something you missing in form field to supply",
      success: false,
    });
  }

  let tx1, tx2;

  try {
    [tx1, tx2] = await Promise.all([
      invtDB.transaction(),
      invtOakterDB.transaction(),
    ]);

    let stmt_check = await invtDB.query(
      "SELECT 1 FROM tbl_rm_hsn WHERE component_key = :component_key LIMIT 1",
      {
        replacements: { component_key: req.body.component },
        type: invtDB.QueryTypes.SELECT,
        transaction: tx1,
      }
    );

    if (stmt_check.length > 0) {
      await Promise.all([
        invtDB.query(
          "DELETE FROM tbl_rm_hsn WHERE component_key = :component_key",
          {
            replacements: { component_key: req.body.component },
            type: invtDB.QueryTypes.DELETE,
            transaction: tx1,
          }
        ),
        invtOakterDB.query(
          "DELETE FROM tbl_rm_hsn WHERE component_key = :component_key",
          {
            replacements: { component_key: req.body.component },
            type: invtOakterDB.QueryTypes.DELETE,
            transaction: tx2,
          }
        ),
      ]);
    }

    const insertSQL = `
      INSERT INTO tbl_rm_hsn 
      (component_key, hsn_code, tax_percent, insert_date, insert_by)
      VALUES (:component_key, :hsn_code, :tax, :insertdate, :by)
    `;

    for (let i = 0; i < req.body.hsn.length; i++) {
      const payload = {
        component_key: req.body.component,
        hsn_code: req.body.hsn[i],
        tax: req.body.tax[i],
        insertdate: moment().format("YYYY-MM-DD HH:mm:ss"),
        by: req.logedINUser,
      };

      await Promise.all([
        invtDB.query(insertSQL, {
          replacements: payload,
          type: invtDB.QueryTypes.INSERT,
          transaction: tx1,
        }),
        invtOakterDB.query(insertSQL, {
          replacements: payload,
          type: invtOakterDB.QueryTypes.INSERT,
          transaction: tx2,
        }),
      ]);
    }

    await Promise.all([tx1.commit(), tx2.commit()]);

    return res.json({
      status: "success",
      message: "HSN Mapped Successfully",
      success: true,
    });
  } catch (err) {
    if (tx1) await tx1.rollback();
    if (tx2) await tx2.rollback();

    return helper.errorResponse(res, err);
  }
});

// FETCH HSN FOR UPDATE
router.post("/fetchHsn", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query(
      "SELECT * FROM `tbl_rm_hsn` LEFT JOIN `ims_hsncode` ON `tbl_rm_hsn`.`hsn_code` = `ims_hsncode`.`hscsac_code` WHERE `tbl_rm_hsn`.`component_key` = :key GROUP BY `tbl_rm_hsn`.`hsn_code`",
      {
        replacements: {
          key: req.body.component,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length > 0) {
      let data = [];
      let count = 0;
      stmt.map(async (item) => {
        data.push({
          serial_no: count + 1,
          hsncode: item.hsn_code,
          hsnlabel: item.hsn_description,
          hsntax: item.tax_percent,
        });
        count++;

        if (count == stmt.length) {
          return res.json({ success: true, data: data });
        }
      });
    } else {
      return res.json({ success: false, message: "No data found" });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// fetch All Currency
router.get("/fetchAllCurrecy", [auth.isAuthorized], async (req, res) => {
  try {
    let result = await invtDB.query(
      "SELECT currency_symbol,currency_id, currency_notes FROM ims_currency ",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (result.length > 0) {
      return res.json({ status: "success", success: true, data: result });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// fetch HSN by component name
router.post("/fetchHsnDb", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    comp_key: "required",
  });

  if (validation.fails()) {
    return res.json({
      message: "something you missing in form field to supply",
      data: validation.errors.errors[0],
      status: "error",
      success: false,
    });
  }

  try {
    let result = await invtDB.query(
      "SELECT hsn_code,tax_percent FROM `tbl_rm_hsn` where `component_key`=:key",
      {
        replacements: { key: req.body.comp_key },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (result.length > 0) {
      return res.json({ status: "success", success: true, data: result });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No data found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET COST CENTER
router.post("/costCenter", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    let limit = 10;
    if (req.body.search == "") {
      stmt = await invtDB.query(
        "SELECT * FROM `cost_center` WHERE `cost_center_status` = 'Y' ORDER BY `cost_center_name` ASC LIMIT :limit",
        {
          replacements: { limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT * FROM `cost_center` WHERE `cost_center_status` = 'Y' AND (`cost_center_short_name` LIKE :name OR `cost_center_name` LIKE :name OR `cost_center_key` LIKE :name) ORDER BY `cost_center_name` LIMIT :limit",
        {
          replacements: { name: `%${req.body.search}%`, limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];
    if (stmt.length > 0) {
      stmt.map((item) => {
        final.push({
          id: item.cost_center_key,
          text:
            item.cost_center_name + " (" + item.cost_center_short_name + ")",
        });

        if (stmt.length == final.length) {
          return res.json({ data: final, status: "success", success: true });
        }
      });
    } else {
      res.json([{ id: "0", text: "No Data Found" }]);
      return;
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

router.post("/bomRecipe", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    let limit = 10;
    if (req.body.search == "") {
      stmt = await invtDB.query(
        "SELECT * FROM `bom_recipe` WHERE `bom_status` = 'ENABLE' ORDER BY `subject_name` ASC LIMIT :limit",
        {
          replacements: { limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT * FROM `bom_recipe` WHERE `bom_status` = 'ENABLE' AND (`subject_id` LIKE :search OR `subject_name` LIKE :search OR `bom_product_sku` LIKE :search) ORDER BY `subject_name` ASC LIMIT :limit",
        {
          replacements: { search: `%${req.body.search}%`, limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];
    if (stmt.length > 0) {
      stmt.map((item) => {
        final.push({
          id: item.subject_id,
          text: item.subject_name + " (" + item.bom_product_sku + ")",
        });

        if (stmt.length == final.length) {
          res.json({ success: true, data: final, status: "success" });
          return;
        }
      });
    } else {
      res.json([{ id: "0", text: "No Data Found" }]);
      return;
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET PO PROJECT NAME
router.post("/poProjectName", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    let limit = 10;
    if (req.body.search == "") {
      stmt = await invtDB.query(
        "SELECT `project_name` FROM `project_master` WHERE (`project_name` != '' OR `project_name` != '--') GROUP BY `project_name` ORDER BY `ID` ASC LIMIT :limit",
        {
          replacements: { limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT `project_name` FROM `project_master` WHERE (`project_name` != '' OR `project_name` != '--') AND (`project_name` LIKE :name) GROUP BY `project_name` ORDER BY `ID` LIMIT :limit",
        {
          replacements: { name: `%${req.body.search}%`, limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];
    if (stmt.length > 0) {
      stmt.map((item) => {
        final.push({ id: item.project_name, text: item.project_name });

        if (stmt.length == final.length) {
          return res.json({ data: final, status: "success", success: true });
        }
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET PROJECT DESCRIPTION
router.post("/projectDescription", [auth.isAuthorized], async (req, res) => {
  try {
    const stmt = await invtDB.query(
      "SELECT project_description FROM project_master WHERE project_name = :project_name",
      {
        replacements: {
          project_name: req.body.project_name,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length > 0) {
      return res.json({
        data: { description: stmt[0].project_description },

        status: "success",
        success: true,
      });
    } else {
      return res.json({
        message: "project name not found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//  GET VENDOR TERMS
router.post("/vendorTerms", [auth.isAuthorized], async (req, res) => {
  try {
    const stmt = await invtDB.query(
      "SELECT * FROM ven_basic_detail WHERE ven_register_id = :vendor",
      {
        replacements: {
          vendor: req.body.vendorcode,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let po_payment_terms = "";
    let msme_data = "";

    if (stmt.length > 0) {
      if (stmt[0].ven_msme_status == "Y") {
        msme_data = {
          msme_id: stmt[0].ven_msme_id,
          msme_type: stmt[0].ven_msme_type,
        };

        if (
          stmt[0].ven_msme_type == "Micro" ||
          stmt[0].ven_msme_type == "Small"
        ) {
          po_payment_terms = 45;
        }
      }

      return res.json({
        data: {
          paymentterms: stmt[0].ven_terms_day,
          msme_data: msme_data,
          po_payment_terms: po_payment_terms,
        },
        status: "success",
        success: true,
      });
    } else {
      return res.json({
        message: "vendor records not found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// SAVE PROJECT NAME
router.post("/projectSave", [auth.isAuthorized], async (req, res) => {
  const t1 = await invtDB.transaction();
  const t2 = await invtOakterDB.transaction();

  try {
    // Validation
    const validation = new Validator(req.body, {
      project_name: "required",
      project_id: "required",
    });
    if (validation.fails()) {
      return res.json({
        message: validation.errors.errors[0],
        status: "error",
        success: false,
      });
    }

    const { project_name, project_id } = helper.trimObjectValueStartEnd(
      req.body
    );

    // Check if project name or ID already exists
    const stmt = await invtDB.query(
      "SELECT project_name FROM project_master WHERE project_name = :project_name OR project_name = :project_id",
      {
        replacements: { project_name, project_id },
        type: invtDB.QueryTypes.SELECT,
        transaction: t1,
      }
    );
    if (stmt.length > 0) {
      await Promise.all([t1.rollback(), t2.rollback()]);
      return res.json({
        message:
          "Another project with the same name OR project ID already exists. Please choose a different name or project ID",
        status: "error",
        success: false,
      });
    }

    const insertPayload = {
      project_name: project_id,
      project_description: project_name,
      insert_date: helper.getCurrentDate(),
      insert_time: helper.getCurrentTime(),
      insert_by: req.logedINUser,
    };

    const insertSQL = `
      INSERT INTO project_master (project_name, project_description, insert_date, insert_time, insert_by)
      VALUES (:project_name, :project_description, :insert_date, :insert_time, :insert_by)
    `;

    // Insert into both DBs
    await Promise.all([
      invtDB.query(insertSQL, {
        replacements: insertPayload,
        type: invtDB.QueryTypes.INSERT,
        transaction: t1,
      }),
      invtOakterDB.query(insertSQL, {
        replacements: insertPayload,
        type: invtOakterDB.QueryTypes.INSERT,
        transaction: t2,
      }),
    ]);

    await Promise.all([t1.commit(), t2.commit()]);

    return res.json({
      message: `New project with name "${project_name}" has been created successfully`,
      status: "success",
      success: true,
    });
  } catch (err) {
    await Promise.all([t1.rollback(), t2.rollback()]);
    console.log(err);
    return helper.errorResponse(res, err);
  }
});

// UPDATE PROJECT STATUS
router.put(
  "/project/status/:project",
  [auth.isAuthorized],
  async (req, res) => {
    const t1 = await invtDB.transaction();
    const t2 = await invtOakterDB.transaction();
    try {
      const { status } = req.body;
      const projectName = helper.trimString(req.params.project);

      if (![0, 1].includes(Number(status))) {
        return res.json({
          message: "Invalid status",
          status: "error",
          success: false,
        });
      }

      const [exists1, exists2] = await Promise.all([
        invtDB.query(
          "SELECT 1 FROM project_master WHERE project_name = :project LIMIT 1",
          {
            replacements: { project: projectName },
            type: invtDB.QueryTypes.SELECT,
            transaction: t1,
          }
        ),
        invtOakterDB.query(
          "SELECT 1 FROM project_master WHERE project_name = :project LIMIT 1",
          {
            replacements: { project: projectName },
            type: invtOakterDB.QueryTypes.SELECT,
            transaction: t2,
          }
        ),
      ]);

      if (exists1.length === 0 && exists2.length === 0) {
        await Promise.all([t1.rollback(), t2.rollback()]);
        return res.json({
          message: "Project not found",
          status: "error",
          success: false,
        });
      }

      await Promise.all([
        invtDB.query(
          "UPDATE project_master SET project_status = :status WHERE project_name = :project",
          {
            replacements: { status, project: projectName },
            type: invtDB.QueryTypes.UPDATE,
            transaction: t1,
          }
        ),
        invtOakterDB.query(
          "UPDATE project_master SET project_status = :status WHERE project_name = :project",
          {
            replacements: { status, project: projectName },
            type: invtOakterDB.QueryTypes.UPDATE,
            transaction: t2,
          }
        ),
      ]);

      await Promise.all([t1.commit(), t2.commit()]);
      return res.json({
        message: "Project status updated successfully",
        status: "success",
        success: true,
      });
    } catch (err) {
      await Promise.all([t1.rollback(), t2.rollback()]);
      return helper.errorResponse(res, err);
    }
  }
);

// GET PROJECT IN DATE LIST
router.post("/fetchProjectData", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    search: "required",
  });

  if (validation.fails()) {
    return res.json({
      message: "something you missing in form field to supply",
      data: validation.errors.errors[0],
      status: "error",
      success: false,
    });
  }

  try {
    let stmt1 = await otherDB.query(
      "SELECT `project_name`, `project_insert_dt`, `project_description` FROM `invt_projects` WHERE `project_name` = :project GROUP BY DATE_FORMAT(`project_insert_dt`,'%Y-%m-%d')",
      {
        replacements: { project: req.body.search },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    let data = [];
    if (stmt1.length > 0) {
      const stmt_project_des = await invtDB.query(
        "SELECT project_description FROM project_master WHERE project_name = :project",
        {
          replacements: { project: req.body.search },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let project_desc =
        stmt_project_des.length > 0
          ? stmt_project_des[0].project_description
          : "--";

      for (let i = 0; i < stmt1.length; i++) {
        data.push({
          id: moment(stmt1[i].project_insert_dt, "YYYY-MM-DD HH:mm:ss").format(
            "DD-MM-YYYY"
          ),
          label: moment(
            stmt1[i].project_insert_dt,
            "YYYY-MM-DD HH:mm:ss"
          ).format("DD-MM-YYYY"),
        });
      }
      return res.json({
        data: data,
        other: { detail: project_desc },
      });
    } else {
      return res.json({
        message: "no data found",
        status: "error",
        success: false,
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET PPR PROJECT NAME
router.post("/pprProjectName", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    let limit = 10;
    if (req.body.search == "") {
      stmt = await invtDB.query(
        "SELECT `prod_project` FROM `mfg_production_1` WHERE (`prod_project` != '' OR `prod_project` != '--') AND `prod_branch` = :branch GROUP BY `prod_project` ORDER BY `ID` ASC LIMIT :limit",
        {
          replacements: { limit: limit, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT `prod_project` FROM `mfg_production_1` WHERE (`prod_project` != '' OR `prod_project` != '--') AND (`prod_project` LIKE :name)  AND `prod_branch` = :branch GROUP BY `prod_project` ORDER BY `ID` LIMIT :limit",
        {
          replacements: {
            name: `%${req.body.search}%`,
            limit: limit,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];
    if (stmt.length > 0) {
      stmt.map((item) => {
        final.push({
          id: Buffer.from(item.prod_project).toString("base64"),
          text: item.prod_project,
        });

        if (stmt.length == final.length) {
          res.json(final);
          return;
        }
      });
    } else {
      res.json([{ id: "0", text: "No Data Found" }]);
      return;
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET MIN TRANSACTION By No
router.post("/getMinTransactionByNo", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    let limit = 10;
    if (req.body.search == "") {
      stmt = await invtDB.query(
        "SELECT in_transaction_id FROM `rm_location` GROUP BY `in_transaction_id` ORDER BY `insert_date` DESC LIMIT :limit",
        {
          replacements: { limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT in_transaction_id FROM `rm_location` WHERE `in_transaction_id` like :name GROUP BY `in_transaction_id` ORDER BY `in_transaction_id` LIMIT :limit",
        {
          replacements: { name: `%${req.body.search}%`, limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];
    if (stmt.length > 0) {
      stmt.map((item) => {
        final.push({
          id: item.in_transaction_id,
          text: item.in_transaction_id,
        });

        if (stmt.length == final.length) {
          res.json(final);
          return;
        }
      });
    } else {
      res.json([{ id: "0", text: "No Data Found" }]);
      return;
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET STATE NAME
// get vendor list by name or code
router.post("/stateList", [auth.isAuthorized], (req, res) => {
  const data = req.body.search;
  const validation = new Validator(req.body, {
    search: "required",
  });

  if (validation.fails()) {
    res.json({
      message: "something you missing in form field to supply",
      data: validation.errors.errors[0],
      status: "error",
      success: false,
    });
  }

  if (validation.passes()) {
    invtDB
      .query(
        "SELECT * FROM `state_code` WHERE `state_name` like :name OR `state_code` LIKE :name ORDER BY `state_code`",
        {
          replacements: { name: `%${data}%` },
          type: invtDB.QueryTypes.SELECT,
        }
      )
      .then((result) => {
        let final = [];

        result.map((item) => {
          final.push({
            id: item.state_code,
            text: item.state_name + " (" + item.state_code + ")",
          });
        });

        if (result.length == final.length) {
          return res.json({
            data: final,
            success: true,
            message: "Data Found",
          });
        }
      })
      .catch((err) => {
        return helper.errorResponse(res, err);
      });
  }
});

// FETCH ALL USER
router.post("/fetchAllUser", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.search == "") {
      stmt = await invtDB.query(
        "SELECT `user_name`,`CustID` FROM `admin_login` WHERE `login_status` = '1' AND `type` != 'jobwork' ORDER BY `ID` ASC",
        { type: invtDB.QueryTypes.SELECT }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT `user_name`,`CustID` FROM `admin_login` WHERE (`user_name` LIKE :name OR `Mobile_No` LIKE :name OR `Email_ID` LIKE :name OR `CustID` LIKE :name) AND `login_status` = '1' AND `type` != 'jobwork' ORDER BY `ID` ASC",
        {
          replacements: { name: `%${req.body.search}%` },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }
    let final = [];
    if (stmt.length > 0) {
      stmt.map((item) => {
        final.push({ id: item.CustID, text: item.user_name });

        if (stmt.length == final.length) {
          return res.json({
            data: final,
            status: "success",
            success: true,
          });
        }
      });
    } else {
      res.json({
        success: false,
        status: "error",
        message: "No User Found",
      });
      return;
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Fetch Pages For Select2
router.post("/pages", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (
      (req.body.searchTerm == undefined || req.body.searchTerm == "",
        req.body.searchTerm == null)
    ) {
      stmt = await otherDB.query(
        "SELECT `page_name`,`page_id` FROM `page_list` ORDER BY `ID` ASC",
        {
          type: otherDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt = await otherDB.query(
        "SELECT `page_name`,`page_id` FROM `page_list` WHERE `page_name` LIKE :name  ORDER BY `ID` ASC",
        {
          replacements: { name: `%${req.body.searchTerm}%` },
          type: otherDB.QueryTypes.SELECT,
        }
      );
    }

    if (stmt.length > 0) {
      let final = [];
      stmt.map((item) => {
        final.push({ id: item.page_id, text: item.page_name });
      });

      return res.json({ data: final, success: true, message: "Data Found" });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "no data found",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//FETCH ALL PAGES
router.get("/viewPages", [auth.isAuthorized], async (req, res) => {
  try {
    stmt = await otherDB.query(
      "SELECT `page_name`,`page_id`,`parent_page`,`need_permission`,`react_page_url` FROM `page_list` ORDER BY `ID` ASC",
      {
        type: otherDB.QueryTypes.SELECT,
      }
    );

    let final = [];
    if (stmt.length > 0) {
      stmt.map((item) => {
        final.push({
          page_id: item.page_id,
          page_name: item.page_name,
          parent_page: item.parent_page,
          need_permission: item.need_permission,
          react_page_url: item.react_page_url,
        });

        if (stmt.length == final.length) {
          // Tree
          tree = (function (data, root) {
            var t = {};
            data.forEach(
              ({
                page_id,
                page_name,
                parent_page,
                need_permission,
                react_page_url,
              }) => {
                Object.assign((t[page_id] = t[page_id] || {}), {
                  key: page_id,
                  title: page_name,
                  folder: need_permission == "N" ? true : false,
                  purl: react_page_url,
                });
                t[parent_page] = t[parent_page] || {};
                t[parent_page].children = t[parent_page].children || [];
                t[parent_page].children.push(t[page_id]);
              }
            );
            return t[root].children;
          })(final, "--");
          // Tree

          return res.json({ data: tree, success: true, message: "Data Found" });
        }
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
// EDIT PAGE
router.post("/editPage", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await otherDB.query(
      "SELECT `page_list`.`page_name`,`page_list`.`page_id`,`page_list`.`parent_page`,`parent_table`.`page_name` as parent_name,`page_list`.`need_permission`,`page_list`.`react_page_url`,`page_list`.`html_page_url` FROM `page_list` LEFT JOIN `page_list` parent_table ON `page_list`.`parent_page`=`parent_table`.`page_id`  WHERE `page_list`.`page_id` = :id",
      {
        replacements: { id: req.body.page_id },
        type: otherDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length > 0) {
      let data = {
        name: stmt[0].page_name,
        id: stmt[0].page_id,
        parent: stmt[0].parent_page,
        parent_name: stmt[0].parent_name,
        permission: stmt[0].need_permission,
        url: stmt[0].html_page_url,
        react: stmt[0].react_page_url,
      };

      return res.json({ data: data, status: "success", success: true });
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

// UPDATE PAGE
router.post("/updatePage", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      page_id: "required",
      page_name: "required",
      react_page_url: "required",
      page_url: "required",
      parent: "required",
      permission: "required",
    });

    if (validation.fails()) {
      return res.json({
        message: "something you missing in form field to supply",
        data: validation.errors.errors[0],
        status: "error",
        success: false,
      });
    }

    let stmt = await otherDB.query(
      "UPDATE `page_list` SET `page_name` = :name, `parent_page` = :parent, `need_permission` = :permission, `react_page_url` = :url, `html_page_url` = :html_url WHERE `page_id` = :id",
      {
        replacements: {
          name: req.body.page_name,
          parent: req.body.parent,
          permission: req.body.permission,
          html_url: req.body.page_url,
          url: req.body.react_page_url,
          id: req.body.page_id,
        },
        type: otherDB.QueryTypes.UPDATE,
      }
    );

    if (stmt.length > 0) {
      return res.json({
        message: "Page Updated",
        success: true,
        status: "success",
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

// MODULE NAME LIST FOR DIRECT JUMP
router.get("/fetch_jumpModule", async (req, res) => {
  invtDB
    .query("SELECT * FROM `modules_code`", {
      type: invtDB.QueryTypes.SELECT,
    })
    .then((result) => {
      let data = [];

      result.map((item) => {
        data.push({ name: item.module_id });
      });
      return res.json({ data: data, success: true, message: "Data Found" });
    })
    .catch((err) => {
      return helper.errorResponse(res, err);
    });
  return;
});

router.post("/jump_jumpModule", [auth.isAuthorized], (req, res) => {
  const validation = new Validator(req.body, {
    modulecode: "required",
  });

  if (validation.fails()) {
    res.json({
      message: validation.errors.errors[0],
      status: "error",
      success: false,
    });
    return;
  }

  if (validation.passes()) {
    invtDB
      .query("SELECT * FROM `modules_code` WHERE `module_id` = :code", {
        replacements: { code: req.body.modulecode },
        type: invtDB.QueryTypes.SELECT,
      })
      .then((result) => {
        return res.json({
          status: "success",
          success: true,
          data: { url: result[0].module_url },
        });
      })
      .catch((err) => {
        return helper.errorResponse(res, err);
      });
  }
});

// DELETE FILE ON CRON RUN [files/excel/]
router.post("/deleteautoGenFiles", async (req, res) => {
  try {
    fs.readdir("./files/excel/", async (err, files) => {
      if (err) {
        console.log("Excel : ", err);
      }

      const extensions = [
        ".pdf",
        ".doc",
        ".jpeg",
        ".png",
        ".xlsx",
        ".pdf",
        ".gif",
        ".txt",
      ];

      files.forEach(async (file) => {
        const fileDir = path.join("./files/excel/", file);
        if (extensions.includes(path.extname(file).toLowerCase())) {
          fs.unlinkSync(fileDir);
        }
      });
    });

    fs.readdir("./files/pdf/", async (err, files) => {
      if (err) {
        console.log("PDF : ", err);
      }

      const extensions = [
        ".pdf",
        ".doc",
        ".jpeg",
        ".png",
        ".xlsx",
        ".pdf",
        ".gif",
        ".txt",
      ];

      files.forEach(async (file) => {
        const fileDir = path.join("./files/pdf/", file);
        if (extensions.includes(path.extname(file).toLowerCase())) {
          fs.unlinkSync(fileDir);
        }
      });
    });

    let stmt = await otherDB.query("TRUNCATE TABLE `user_files_req`", {
      type: otherDB.QueryTypes.DELETE,
    });
    return;
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// all billing address list
router.post("/companyList", [auth.isAuthorized], async (req, res) => {
  try {
    const limit = 10;
    let stmt;
    if (req.body.search) {
      stmt = await otherDB.query(
        "SELECT * FROM `ims_company` WHERE `company_status` = 'A' AND (`company_id` LIKE :name OR `company_name` LIKE :name OR `company_pan_no` LIKE :name) ORDER BY `company_name` LIMIT :limit",
        {
          replacements: { name: `%${req.body.search}%`, limit: limit },
          type: otherDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT * FROM `ims_company` WHERE `company_status` = 'A' ORDER BY `company_name` ASC LIMIT :limit",
        {
          replacements: { limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];

    stmt.map((item) => {
      final.push({
        id: item.company_id,
        text: item.company_name + " (" + item.company_id + ")",
      });

      if (stmt.length == final.length) {
        return res.json({ data: final, success: true, message: "Data Found" });
      }
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// BUG REPORT
router.post("/submitBug", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      comment: "required",
      user_select: "required",
    });

    if (validation.fails()) {
      return res.json({
        message: validation.errors.errors[0],
        status: "error",
        success: false,
      });
    }

    // let stmt = await otherDB.query("INSERT INTO `user_bug_report` (`user_id`, `bug_comment`, `bug_status`, `bug_date`) VALUES (:user_id, :comment, 'P', :date)", {
    // 	replacements: { user_id: req.body.user_select, comment: req.body.comment, date: moment().format("YYYY-MM-DD HH:mm:ss") },
    // });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FAVOURITE PAGES
// router.post("/favouritePages", [auth.isAuthorized], async (req, res) => {
// 	try {
// 		let validation = new Validator(req.body, {
// 			page_id: "required",
// 		});

// 		if (validation.fails()) {
// 			res.json({ message: "something you missing in form field to supply", data: validation.errors.errors[0], status: "error", success: false });
// 		}

// 		let stmt = await otherDB.query("SELECT * FROM `user_fav_page` WHERE `user_id` = :user_id AND `page_id` = :page_id", {
// 			replacements: { user_id: req.logedINUser, page_id: req.body.page_id },
// 			type: otherDB.QueryTypes.SELECT,
// 		});

// 		if (stmt.length > 0) {
// 			return res.json({ status: "error", success: false, message: "Page Already Added" });
// 		} else {
// 			let stmt2 = await otherDB.query("INSERT INTO `user_fav_page` (`user_id`, `page_id`) VALUES (:user_id, :page_id)", {
// 				replacements: { user_id: req.logedINUser, page_id: req.body.page_id },
// 				type: otherDB.QueryTypes.INSERT,
// 			});
// 			if (stmt2.length > 0) {
// 				let stmt_fav_pages = await otherDB.query(
// 					"SELECT `user_fav_page`.`page_id`,`page_list`.`page_name`, `page_list`.`page_url` FROM `user_fav_page` LEFT JOIN `page_list` ON `page_list`.`page_id`=`user_fav_page`.`page_id` WHERE `user_id` = :user_id",
// 					{
// 						replacements: { user_id: req.logedINUser },
// 						type: otherDB.QueryTypes.SELECT,
// 					}
// 				);

// 				let fav_pages = [];
// 				if (stmt_fav_pages.length > 0) {
// 					for (let i = 0; i < stmt_fav_pages.length; i++) {
// 						fav_pages.push({
// 							page_id: stmt_fav_pages[i].page_id,
// 							page_name: stmt_fav_pages[i].page_name,
// 							url: stmt_fav_pages[i].page_url,
// 						});
// 					}
// 				}

// 				return res.json({ status: "success", success: true, message: "module marked as favorite", data: JSON.stringify(fav_pages) });
// 			} else {
// 				return res.json({ status: "error", success: false, message: "module not makreked as favorite" });
// 			}
// 		}
// 	} catch (err) {
// 		return res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator"});
// 	}
// });
router.post("/favouritePages", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      pageUrl: "required",
    });
    // getting page id
    let stmt0 = await otherDB.query(
      "SELECT * FROM `page_list` WHERE `react_page_url` = :react_page_url",
      {
        replacements: { react_page_url: req.body.pageUrl },
        type: otherDB.QueryTypes.SELECT,
      }
    );
    if (!stmt0[0]) {
      return res.json({
        status: "error",
        success: false,
        message: "page does not exist",
      });
    }
    const { page_name, page_id } = stmt0[0];
    // fav pages from here

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: validation.errors.errors[0],
      });
    }

    let stmt = await otherDB.query(
      "SELECT * FROM `user_fav_page` WHERE `user_id` = :user_id AND `page_id` = :page_id",
      {
        replacements: { user_id: req.logedINUser, page_id: page_id },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Page already added",
      });
    } else {
      let stmt2 = await otherDB.query(
        "INSERT INTO `user_fav_page` (`user_id`, `page_id`) VALUES (:user_id, :page_id)",
        {
          replacements: {
            user_id: req.logedINUser,
            page_id: page_id,
          },
          type: otherDB.QueryTypes.INSERT,
        }
      );
      if (stmt2.length > 0) {
        let stmt_fav_pages = await otherDB.query(
          "SELECT `user_fav_page`.`page_id`,`page_list`.`page_name`, `page_list`.`react_page_url` FROM `user_fav_page` LEFT JOIN `page_list` ON `page_list`.`page_id`=`user_fav_page`.`page_id` WHERE `user_id` = :user_id",
          {
            replacements: { user_id: req.logedINUser },
            type: otherDB.QueryTypes.SELECT,
          }
        );

        let fav_pages = [];
        if (stmt_fav_pages.length > 0) {
          for (let i = 0; i < stmt_fav_pages.length; i++) {
            fav_pages.push({
              page_id: stmt_fav_pages[i].page_id,
              page_name: stmt_fav_pages[i].page_name,
              url: stmt_fav_pages[i].react_page_url,
            });
          }
        }

        return res.json({
          status: "success",
          success: true,
          message: "module marked as favorite",
          data: JSON.stringify(fav_pages),
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "module not makreked as favorite",
        });
      }
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});
router.post("/removeFavouritePages", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      page_id: "required",
    });

    if (validation.fails()) {
      res.json({
        message: "something you missing in form field to supply",
        data: validation.errors.errors[0],
        status: "error",
        success: false,
      });
    }

    let stmt = await otherDB.query(
      "DELETE FROM `user_fav_page` WHERE `user_id` = :user_id AND `page_id` = :page_id",
      {
        replacements: { user_id: req.logedINUser, page_id: req.body.page_id },
        type: otherDB.QueryTypes.DELETE,
      }
    );

    let stmt_fav_pages = await otherDB.query(
      "SELECT `user_fav_page`.`page_id`,`page_list`.`page_name`, `page_list`.`react_page_url` FROM `user_fav_page` LEFT JOIN `page_list` ON `page_list`.`page_id`=`user_fav_page`.`page_id` WHERE `user_id` = :user_id",
      {
        replacements: { user_id: req.logedINUser },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    let fav_pages = [];
    if (stmt_fav_pages.length > 0) {
      for (let i = 0; i < stmt_fav_pages.length; i++) {
        fav_pages.push({
          page_id: stmt_fav_pages[i].page_id,
          page_name: stmt_fav_pages[i].page_name,
          url: stmt_fav_pages[i].react_page_url,
        });
      }
    }

    return res.json({
      status: "success",
      success: true,
      message: "Page Removed Successfully",
      data: JSON.stringify(fav_pages),
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET MFG LOCATIONS
router.post("/jw_sf_inward_location", [auth.isAuthorized], async (req, res) => {
  try {
    let str_arr = [];

    const check_min_type = await otherDB.query(
      "SELECT * FROM erp_setting WHERE setting_code = '65432' ",
      {
        type: otherDB.QueryTypes.SELECT,
      }
    );
    if (check_min_type.length <= 0) {
      return res
        .status(404)
        .json({ status: false, message: "Setup not found for location !!!" });
    }

    if (check_min_type[0].setting_value == "cost_center") {
      let valid = new Validator(req.body, { cost_center: "required" });
      if (valid.fails()) {
        return res.status(400).json({
          status: false,
          message: helper.firstErrorValidatorjs(valid),
        });
      }

      const cost_center_loc = await invtDB.query(
        "SELECT * FROM location_main WHERE loc_costcenter = :cost_center",
        {
          replacements: {
            cost_center: req.body.cost_center,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (cost_center_loc.length == 0) {
        res.status(404).json({
          message: "Location not found for this cost center",
          status: false,
        });
        return;
      }

      for (let i = 0; i < cost_center_loc.length; i++) {
        str_arr.push(cost_center_loc[i].location_key);
      }

      // END COST CENTER
    } else if (check_min_type[0].setting_value == "standard") {
      let stmt1 = await invtDB.query(
        "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
        {
          replacements: { location_key: "20220212163440" },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      // string to array
      str_arr = stmt1[0].locations.split(",");
    } else {
      return res
        .status(404)
        .json({ status: false, message: "Setup not found for location !!!" });
    }

    let loc_options = [];
    for (let i = 0; i < str_arr.length; i++) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
        {
          replacements: { location_defined: str_arr[i] },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      for (let j = 0; j < stmt2.length; j++) {
        loc_options.push({
          id: stmt2[j].location_key,
          text: stmt2[j].loc_name,
        });
      }
    }

    return res.json({ data: loc_options, status: "success", success: true });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// router.get("/jw/warehouse/location", [auth.isAuthorized], async (req, res) => {
//   let validation = new Validator(req.query, {
//     vendor: "required",
//     jw: "required",
//   });

//   if (validation.fails()) {
//     return res.json({
//       success: false,
//       status: "error",
//       message: validation.errors.errors[0],
//     });
//   }

//   try {
//     // 1️⃣ Get vendor location config from JW
//     const result = await invtDB.query(
//       `SELECT location
//        FROM jw_purchase_req
//        WHERE jw_jw_transaction = :jw
//          AND jw_po_vendor_reg_id = :vendor
//        LIMIT 1`,
//       {
//         replacements: {
//           vendor: req.query.vendor,
//           jw: req.query.jw,
//         },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );

//     if (!result.length || !result[0].location || result[0].location === "--") {
//       return res.json({
//         success: false,
//         status: "error",
//         message: "Location not configured, Please contact to your administrator",
//       });
//     }

//     const locationKeys = result[0].location; // comma-separated keys

//     // 2️⃣ Get locations using FIND_IN_SET
//     const locations = await invtDB.query(
//       `SELECT
//          l.location_key AS \`key\`,
//          l.loc_name AS \`name\`
//        FROM location_main l
//        WHERE FIND_IN_SET(l.location_key, :keys)`,
//       {
//         replacements: { keys: locationKeys },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );

//     return res.json({
//       success: true,
//       status: "success",
//       data: locations,
//     });

//   } catch (err) {
//     return helper.errorResponse(res, err);
//   }
// });


router.get("/jw/warehouse/location", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.query, {
    vendor: "required",
    jw: "required",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      status: "error",
      message: validation.errors.errors[0],
    });
  }

  try {
    const costcenter = req.query.cc || null;

    const result = await invtDB.query(
      `SELECT location
       FROM jw_purchase_req
       WHERE jw_jw_transaction = :jw
         AND jw_po_vendor_reg_id = :vendor
       LIMIT 1`,
      {
        replacements: {
          vendor: req.query.vendor,
          jw: req.query.jw,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (!result.length || !result[0].location || result[0].location === "--") {
      return res.json({
       success: false,
       status: "error",
       message: "Location not configured, Please contact to your administrator",
      });
    }

    const locationKeys = result[0].location; 

    const locations = await invtDB.query(
      `
      SELECT DISTINCT
        l.location_key AS \`key\`,
        CASE
          WHEN :costcenter IS NOT NULL
               AND FIND_IN_SET(:costcenter, l.loc_costcenter)
          THEN CONCAT(l.loc_name, ' [ CC ]')
          ELSE l.loc_name
        END AS \`name\`
      FROM location_main l
      WHERE 
            FIND_IN_SET(l.location_key, :keys)
         OR (:costcenter IS NOT NULL 
             AND FIND_IN_SET(:costcenter, l.loc_costcenter))
      ORDER BY 
        FIND_IN_SET(:costcenter, l.loc_costcenter) DESC
      `,
      {
        replacements: {
          keys: locationKeys,
          costcenter: costcenter,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    return res.json({
      success: true,
      status: "success",
      data: locations,
    });

  } catch (err) {
    console.error(err);
    return res.json({
      success: false,
      status: "error",
      message: "Something went wrong. Please try again.",
    });
  }
});

// CHECK COMP STOCK LOCATION
router.post("/compStockLoc", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      location: "required",
      component: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: validation.errors.fails(),
      });
    }

    let stmt = await invtDB.query(
      "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE' ",
      {
        replacements: {
          location: req.body.location,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `components` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `component_key` = :component",
        {
          replacements: { component: req.body.component },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt2.length > 0) {
        //SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` != 'CANCELLED') AND `loc_in` = :location
        let stmt_inward = await invtDB.query(
          "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_in` = :location",
          {
            replacements: {
              component: req.body.component,
              location: req.body.location,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let inward_all_qty = 0;
        if (stmt_inward.length > 0) {
          inward_all_qty = stmt_inward[0].Inward;
        }

        //SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` != 'CANCELLED') AND `loc_out` = :location
        let stmt_outward = await invtDB.query(
          "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_out` = :location",
          {
            replacements: {
              component: req.body.component,
              location: req.body.location,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let outward_all_qty = 0;
        if (stmt_outward.length > 0) {
          outward_all_qty = stmt_outward[0].Outward;
        }

        let closingBal =
          inward_all_qty - outward_all_qty > 0
            ? inward_all_qty - outward_all_qty
            : 0;

        return res.json({
          status: "success",
          success: true,
          data: { closingStock: closingBal, uom: stmt2[0].units_name },
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "component not valid or not used for any transaction yet...",
        });
      }
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "location not valid..",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// SELECT USERS
router.post("/fetchUsers", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (
      req.body.search == "" ||
      req.body.search == undefined ||
      req.body.search == null
    ) {
      stmt = await invtDB.query(
        "SELECT CustID,user_name FROM admin_login ORDER BY user_name ASC LIMIT :limit",
        { replacements: { limit: 5 }, type: invtDB.QueryTypes.SELECT }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT CustID,user_name FROM admin_login WHERE (user_name LIKE :name)  ORDER BY user_name LIMIT :limit",
        {
          replacements: { name: `%${req.body.search}%`, limit: 30 },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    if (stmt.length > 0) {
      let result = [];

      for (let i = 0; i < stmt.length; i++) {
        result.push({ id: stmt[i].CustID, text: stmt[i].user_name });
      }

      return res.json({ status: "success", success: true, data: result });
    } else {
      return res.json({
        message: "User not found",
        status: "error",
        success: false,
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// CHECK INVOICE BEFOR MIN
router.post("/checkInvoice", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      invoice: "required|array",
    });

    if (validation.fails()) {
      return res.status(403).json({
        status: "error",
        success: false,
        message: validation.errors.errors[0],
      });
    }

    const Invlenth = req.body.invoice.length;

    // Define set
    let set = new Set();

    for (let i = 0; i < Invlenth; i++) {
      let stmt = await invtDB.query(
        "SELECT (CASE WHEN in_invoice_id != '--' THEN in_invoice_id WHEN in_po_invoice_id != '--' THEN in_po_invoice_id ELSE '--' END) as invoice_id FROM rm_location WHERE in_invoice_id = :invoice OR in_po_invoice_id = :invoice",
        {
          replacements: { invoice: req.body.invoice[i] },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        set.add(stmt[0].invoice_id);
      }
    }

    if (set.size > 0) {
      // Invoice Found
      return res.json({
        status: "success",
        success: true,
        message: "Invoice ID exist in some previous transaction",
        data: {
          invoicesFound: Array.from(set),
        },
      });
    } else {
      // Invoice not Found
      return res.json({
        status: "success",
        success: true,
        message: "Invoice ID not exist in any previous transaction",
        data: {
          invoicesFound: false,
        }
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Download Invoice, Documents
router.post("/documents", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    id: "required",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      status: "error",
      message: "something you missing in form field to supply",
      errors: validation.errors.errors[0],
    });
  }

  let checkStmt = await invtDB.query(
    "SELECT admin_login.user_name, ims_min_invoices.* FROM ims_min_invoices LEFT JOIN admin_login ON admin_login.CustID = ims_min_invoices.min_inv_by WHERE ims_min_invoices.min_min_id = :id",
    {
      replacements: { id: req.body.id },
      type: invtDB.QueryTypes.SELECT,
    }
  );
  if (checkStmt.length == 0) {
    return res.json({
      success: false,
      message: "Invoice not found",
      status: "error",
      success: false,
    });
    return;
  }

  let final = [];
  for (let i = 0; i < checkStmt.length; i++) {
    final.push({
      name: checkStmt[i].doc_file_name,
      document:
        "https://ims.mscapi.live/uploads/minInvoices/" +
        checkStmt[i].min_inv_file,
      by: checkStmt[i].user_name,
      date: checkStmt[i].min_inv_dt,
      txnID: checkStmt[i].min_min_id,
    });
  }

  return res.json({ data: final, status: "success", success: true });
});

router.post("/fetchallsfgForProduct", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    search: "required",
  });

  if (validation.fails()) {
    return res.json({
      message: "something you missing in the form field to supply",
      errors: validation.errors.errors[0],
      status: "error",
      success: false,
    });
  }

  try {
    const sku = req.body.search;

    async function getChildBOMs(sku) {
      let child_comps = [];
      let stmt_child = await invtDB.query(
        "SELECT bom_quantity.* , components.c_name, components.c_part_no , components.c_specification , units.units_name , ven_basic_detail.ven_name  FROM bom_quantity LEFT JOIN components ON bom_quantity.component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = bom_quantity.bom_comp_vendor WHERE bom_quantity.product_sku = :product_sku AND components.c_type = 'R' AND components.c_is_enabled = 'Y'",
        {
          replacements: { product_sku: sku },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt_child.length > 0) {
        for (let i = 0; i < stmt_child.length; i++) {
          const cPartNo = stmt_child[i].c_part_no;

          const stmt_bom = await invtDB.query(
            "SELECT bom_product_sku FROM bom_recipe WHERE bom_product_sku = :cPartNo",
            {
              replacements: { cPartNo },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (stmt_bom.length > 0) {
            data.push({
              sfgid: stmt_bom[0].bom_product_sku,
              sfgsku: stmt_bom[0].bom_product_sku,
            });
          }

          child_comps.push(cPartNo);

          if (stmt_child.length - 1 == i) {
            for (let j = 0; j < child_comps.length; j++) {
              await getChildBOMs(child_comps[j]);
            }
          }
        }
      }
    }

    const parentBOMs = await invtDB.query(
      "SELECT bom_product_sku FROM bom_recipe WHERE bom_product_sku = :sku",
      {
        replacements: { sku },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    const data = [];

    if (parentBOMs.length > 0) {
      for (const parentBOM of parentBOMs) {
        data.push({
          sfgid: parentBOM.bom_product_sku,
          sfgsku: parentBOM.bom_product_sku,
        });

        await getChildBOMs(sku);
      }

      return res.json({ data });
    } else {
      return res.json({
        message: "no data found",
        status: "error",
        success: false,
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//get client
router.post("/getClient", [auth.isAuthorized], async (req, res) => {
  try {
    if (req.body.searchTerm) {
      let fetchClient = await tallyDB.query(
        "SELECT code , name FROM client_basic_detail WHERE name LIKE :name",
        {
          replacements: { name: `%${req.body.searchTerm}%` },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      if (fetchClient.length <= 0) {
        return res.json({
          status: "error",
          success: false,
          message: "client not found",
        });
      }

      return res.json({ status: "success", success: true, data: fetchClient });
    } else {
      let fetchClients = await tallyDB.query(
        "SELECT * FROM client_basic_detail",
        {
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      if (fetchClients.length < 0) {
        return res.json({
          status: "error",
          success: false,
          message: "no client found",
        });
      }

      let arr = [];

      for (let i = 0; i < fetchClients.length; i++) {
        arr.push({
          name: fetchClients[i].name,
          code: fetchClients[i].code,
          panNo: fetchClients[i].panNo,
          mobile: fetchClients[i].mobile,
          email: fetchClients[i].email,
          salesperson: fetchClients[i].salesperson,
          status: fetchClients[i].status,
        });
      }
      return res.json({ status: "success", success: true, data: arr });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// get client detail
router.post("/fetchClientDetail", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      code: "required",
    });

    if (validation.fails()) {
      return res.json({
        message: "something you missing in form field to supply",
        data: validation.errors.errors[0],
        status: "error",
        success: false,
      });
    }

    let fetchClient = await tallyDB.query(
      "SELECT client_basic_detail.*, client_address_detail.* FROM client_basic_detail LEFT JOIN client_address_detail ON client_basic_detail.code = client_address_detail.clientCode WHERE code = :code",
      {
        replacements: {
          code: req.body.code,
        },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (fetchClient.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "wrong client code",
      });
    }
    let arr = [];
    for (let i = 0; i < fetchClient.length; i++) {
      arr.push({
        id: fetchClient[i].addressID,
        text: fetchClient[i].city,
        address: fetchClient[i].address,
        gst: fetchClient[i].gst,
        pincode: fetchClient[i].pinCode,
        phoneNo: fetchClient[i].phoneNo,
        state: fetchClient[i].state,
      });
    }
    return res.json({
      status: "success",
      success: true,
      data: {
        client: {
          clientCode: fetchClient[0].code,
          name: fetchClient[0].name,
          pan_no: fetchClient[0].panNo,
        },
        branchList: arr,
      },
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// get client address/branch
router.post("/fetchClientAddress", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      addressID: "required",
      code: "required",
    });

    if (validation.fails()) {
      return res.json({
        message: "something you missing in form field to supply",
        data: validation.errors.errors[0],
        status: "error",
        success: false,
      });
    }

    let fetchAddress = await tallyDB.query(
      "SELECT * FROM client_address_detail WHERE addressID = :addressID AND clientCode = :code ",
      {
        replacements: {
          addressID: req.body.addressID,
          code: req.body.code,
        },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (fetchAddress.length <= 0) {
      return res.json({
        code: "500",
        status: "error",
        success: false,
        message: "No data found",
      });
    }

    return res.json({
      status: "success",
      success: true,
      data: {
        address: fetchAddress[0].address,
        gst: fetchAddress[0].gst,
        pinCode: fetchAddress[0].pinCode,
        phoneNo: fetchAddress[0].phoneNo,
        city: fetchAddress[0].city,
      },
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// get bom(s) for product by sku code
router.post("/fetchBomProduct", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    search: "required",
  });

  if (validation.fails()) {
    return res.json({
      message: "something you missing in form field to supply",
      status: "error",
      success: false,
    });
  }

  try {
    let stmt1 = await invtDB.query(
      "SELECT * FROM products LEFT JOIN units ON products.p_uom = units.units_id WHERE p_sku = :sku OR m_sku = :sku",
      {
        replacements: { sku: req.body.search },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let data = [];
    if (stmt1.length > 0) {
      for (let i = 0; i < stmt1.length; i++) {
        let stmt2 = await invtDB.query(
          "SELECT * FROM bom_recipe WHERE (bom_product_sku = :product1 OR bom_product_sku = :product2)",
          {
            replacements: {
              product1: stmt1[i].p_sku,
              product2: stmt1[i].m_sku,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        for (let j = 0; j < stmt2.length; j++) {
          data.push({
            bomid: stmt2[j].subject_id,
            bomname: stmt2[j].subject_name,
          });
        }
      }

      return res.json({
        status: "success",
        success: true,
        data: { uom: stmt1[0].units_name, data },
      });
    } else {
      return res.json({
        message: "no data found",
        status: "error",
        success: false,
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Get Work Order Details and Components List
router.post("/workOrderdetails", [auth.isAuthorized], async (req, res) => {
  const subject_id = req.body.subject_id;
  const wo_id = req.body.wo_id;
  const getComponents = req.body.getComponents;

  try {
    const result = await invtDB.query(
      "SELECT bom_quantity.qty,components.c_part_no,components.c_name,components.component_key FROM bom_quantity LEFT JOIN components ON components.component_key = bom_quantity.component_id WHERE bom_quantity.subject_under = :subject_id",
      {
        replacements: { subject_id: subject_id },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    const stmt = await invtDB.query(
      "SELECT * FROM wo_purchase_req LEFT JOIN products ON wo_purchase_req.wo_sku = products.product_key LEFT JOIN units ON products.p_uom = units.units_id LEFT JOIN bom_recipe ON wo_purchase_req.wo_subject_id = bom_recipe.subject_id LEFT JOIN admin_login ON wo_purchase_req.wo_insert_by = admin_login.CustID LEFT JOIN " +
      tally_db_name +
      ".client_basic_detail ON wo_purchase_req.wo_client_id = client_basic_detail.code WHERE wo_purchase_req.wo_transaction LIKE CONCAT('%', :wo_id, '%') ORDER BY wo_purchase_req.wo_insert_date DESC",
      {
        replacements: { wo_id: wo_id },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let arr = [];

    if (result.length > 0) {
      arr = result;
    }

    return res.json({
      status: "success",
      success: true,
      data: {
        details: {
          date: moment(stmt[0].wo_insert_date, "YYYY-MM-DD").format(
            "DD-MM-YYYY"
          ),
          woid: stmt[0].wo_transaction,
          wo_sku_transaction: stmt[0].wo_sku_transaction,
          client: stmt[0].name,
          clientcode: stmt[0].wo_client_id,
          skucode: stmt[0].p_sku,
          skuname: stmt[0].p_name,
          sku: stmt[0].wo_sku,
          bom_id: stmt[0].wo_subject_id,
          bom_name: stmt[0].subject_name,
          requiredqty: stmt[0].wo_order_qty + " / " + stmt[0].wo_issue_qty,
          bom_recipe: stmt[0].wo_bom_recipe,
          wo_status: stmt[0].wo_status,
          created_by: stmt[0].user_name,
        },
        components: arr,
      },
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// CHECK COMP STOCK LOCATION WORK ORDER
router.post("/WOcompStockLoc", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      location: "required",
      component: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.errors[0],
      });
    }

    let stmt = await invtDB.query(
      "SELECT * FROM location_main WHERE location_key = :location",
      {
        replacements: {
          location: req.body.location,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `components` WHERE `component_key` = :component",
        {
          replacements: { component: req.body.component },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt2.length > 0) {
        let stmt_inward = await invtDB.query(
          "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'WORKORDER' , 'REJECTION' , 'TRANSFER') AND `loc_in` = :location",
          {
            replacements: {
              component: req.body.component,
              location: req.body.location,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let inward_all_qty = 0;
        if (stmt_inward.length > 0) {
          inward_all_qty = stmt_inward[0].Inward;
        }

        let stmt_outward = await invtDB.query(
          "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'WORKORDER' , 'REJECTION' , 'TRANSFER') AND `loc_out` = :location",
          {
            replacements: {
              component: req.body.component,
              location: req.body.location,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let outward_all_qty = 0;
        if (stmt_outward.length > 0) {
          outward_all_qty = stmt_outward[0].Outward;
        }

        let closingBal =
          inward_all_qty - outward_all_qty > 0
            ? inward_all_qty - outward_all_qty
            : 0;

        return res.json({
          status: "success",
          success: true,
          data: { closingStock: closingBal },
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "component not valid or not used for any transaction yet...",
        });
      }
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "location not valid..",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// CHECK PRODUCT STOCK LOCATION WORK ORDER
router.post("/WOproductStockLoc", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      location: "required",
      product: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.errors[0],
      });
    }

    let stmt = await invtDB.query(
      "SELECT * FROM `location_main` WHERE `location_key` = :location",
      {
        replacements: {
          location: req.body.location,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `products` WHERE `product_key` = :product",
        {
          replacements: { product: req.body.product },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt2.length > 0) {
        //TOTAL IN YET
        let stmt4 = await invtDB.query(
          "SELECT `mfg_pro_apr_sku`,`type`, COALESCE(SUM(`mfg_approve_in_qty`),0) AS `totalYetInstock` FROM `mfg_production_3` WHERE `mfg_pro_apr_sku`= :sku AND `mfg_pro_location_in`= :location AND `type` = 'IN' AND `company_branch` = :branch",
          {
            replacements: {
              sku: stmt2[0].p_sku,
              location: req.body.location,
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let totalYetInstock;
        if (stmt4.length > 0) {
          totalYetInstock = helper.number(stmt4[0].totalYetInstock);
        } else {
          totalYetInstock = 0;
        }

        //TOTAL OUT YET
        let stmt5 = await invtDB.query(
          "SELECT COALESCE(SUM(`fgout_approve_out_qty`),0) AS `totalYetOutstock` FROM `mfg_production_3` WHERE `fgout_pro_apr_sku` = :sku AND `mfg_pro_location_out`= :location AND `type` = 'OUT' AND `company_branch` = :branch",
          {
            replacements: {
              sku: stmt2[0].product_key,
              location: req.body.location,
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let totalYetOutstock;
        if (stmt5.length > 0) {
          totalYetOutstock = helper.number(stmt5[0].totalYetOutstock);
        } else {
          totalYetOutstock = 0;
        }

        let closingBal =
          totalYetInstock - totalYetOutstock > 0
            ? totalYetInstock - totalYetOutstock
            : 0;

        return res.json({
          status: "success",
          success: true,
          data: { closingStock: closingBal },
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "component not valid or not used for any transaction yet...",
        });
      }
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "location not valid..",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// SELECT JW ID
router.post("/fetchJWid", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (
      req.body.search == "" ||
      req.body.search == undefined ||
      req.body.search == null
    ) {
      stmt = await invtDB.query(
        "SELECT jw_jw_transaction FROM jw_purchase_req ORDER BY jw_jw_transaction ASC LIMIT :limit",
        { replacements: { limit: 5 }, type: invtDB.QueryTypes.SELECT }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT jw_jw_transaction FROM jw_purchase_req WHERE (jw_jw_transaction LIKE :jwid) ORDER BY jw_jw_transaction LIMIT :limit",
        {
          replacements: { jwid: `%${req.body.search}%`, limit: 30 },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    if (stmt.length > 0) {
      let result = [];

      for (let i = 0; i < stmt.length; i++) {
        result.push({ jw_id: stmt[i].jw_jw_transaction });
      }

      return res.json({ status: "success", success: true, data: result });
    } else {
      return res.json({
        message: "Jobwork not found",
        status: "error",
        success: false,
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//check mpn and compo category
router.post("/checkMPN", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      search: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: helper.firstErrorValidatorjs(validation),
        status: "error",
      });
    }

    let searchParam = req.body.search;

    const fetchComp = await invtDB.query(
      "SELECT manufacturing_code AS manufacturingCode , rm_cat_name AS category , component_key AS componentKey from components LEFT JOIN rm_categories ON components.c_attr_category = rm_categories.rm_cat_key WHERE component_key IN (:key)",
      {
        replacements: { key: searchParam },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (fetchComp.length <= 0) {
      return res.json({
        success: false,
        message: "No Data Found",
        status: "error",
      });
    }

    return res.json({
      success: true,
      status: "success",
      data: fetchComp,
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// Get Sub-Group List
router.get("/sub-group/:group", [auth.isAuthorized], async (req, res) => {
  const { group } = req.params;
  if (!group) {
    return res.status(400).json({
      success: false,
      message:
        "something is missing in the request.\nPlease contact to your system administrator.",
      status: "error",
    });
  } else {
    const result = await invtDB.query(
      "SELECT sub_group_id, sub_group_name FROM all_sub_groups WHERE group_id = :group ORDER BY ID DESC",
      {
        replacements: { group: group },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (result.length > 0) {
      const response = [];
      for (let i = 0; i < result.length; i++) {
        response.push({
          key: result[i].sub_group_id,
          name: result[i].sub_group_name,
          desc: result[i].sub_group_desc,
        });
      }
      return res.json({ success: true, status: "success", data: response });
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "no Sub-Group found associated with the selected Group",
      });
    }
  }
});




router.get('/fetch-skuOpening-rate', [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query(
      `SELECT p.p_name AS productName, p.product_key,p.p_sku, s.total_value, s.average_rate, s.closing_qty, s.insert_dt AS date FROM products p INNER JOIN tbl_sku_average_rate s ON p.product_key COLLATE utf8mb3_general_ci = s.sku_key`,
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length > 0) {
      res.json({
        success: true,
        status: "success",
        data: stmt
      })
    } else {
      res.json({
        code: 404,
        message: "No sku Opening rate available"
      })
    }
  } catch (error) {
    res.json({
      success: false,
      status: "error",
      message: "Error while fetching sku details",

    })
  }
})

router.get("/costcenter", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query(
      "SELECT cost_center_key as uID, cost_center_short_name AS code, cost_center_name AS name, cost_center_indt AS timestamp FROM cost_center ORDER BY cost_center_indt DESC",
      { type: invtDB.QueryTypes.SELECT }
    );

    if (stmt.length > 0) {
      return res.json({
        success: true,
        status: "success",
        data: stmt,
      });
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "no cost centers found in our records",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});


router.post('/add-skuOpening-detail', [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      product: "required",
      closing_qty: "required",
      average_rate: "required",
      total_value: "required"
    });

    if (validation.fails()) {
      return res.status(403).json({
        success: false,
        message: helper.firstErrorValidatorjs(validation),
        data: null,
      });
    }



    // Check if SKU already exists
    const existingSku = await invtDB.query(
      `SELECT sku_key
       FROM tbl_sku_average_rate
       WHERE sku_key = :product`,
      {
        replacements: { product: req.body.product },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (existingSku.length > 0) {
      return res.status(409).json({
        success: false,
        message: "SKU already exists for this product"
      });
    }

    // Insert SKU opening data
    await invtDB.query(
      `INSERT INTO tbl_sku_average_rate
       (sku_key, closing_qty, average_rate, total_value)
       VALUES (:product, :closing_qty, :average_rate, :total_value)`,
      {
        replacements: {
          product: req.body.product,
          closing_qty: req.body.closing_qty,
          average_rate: req.body.average_rate,
          total_value: req.body.total_value
        },
        type: invtDB.QueryTypes.INSERT,
      }
    );

    return res.status(201).json({
      success: true,
      message: "SKU weighted rate added successfully",
    });

  } catch (error) {
    return helper.errorResponse(res, error);
  }
});



module.exports = router;
