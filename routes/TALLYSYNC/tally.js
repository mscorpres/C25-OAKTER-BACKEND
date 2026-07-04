const express = require("express");
const router = express.Router();

let { invtDB, otherDB } = require("../../config/db/connection");

const auth = require("../../middleware/auth");

checkIfZero = (value) => {
  value = value > 0 ? value : 0;
  return value;
};

const getVendorGodown = async (vendor_id) => {
  try {
    const result = await otherDB.query("SELECT * FROM tbl_vendor_godown WHERE vendor = :vendor_id", {
      replacements: { vendor_id: vendor_id },
      type: otherDB.QueryTypes.SELECT,
    });

    if (result.length > 0) {
      return result[0].wh_name;
    }

    return "Godown Not Set For Vendor " + vendor_id;
  } catch (error) {
    return "Godown Not Set For Vendor " + vendor_id;
  }
};

router.get("/getJobworkChallanForTally", [auth.isAuthorized], async (req, res) => {
  try {
    let challan_no = req.query.challan_no;
    
    if (!challan_no) {
      return res.json({ 
        success: false,
        message: "Challan Number is required", 
      });
    }

    let stmt = await invtDB.query(
      "SELECT `jw_material_challan`.*, `jw_material_challan`.`ID` AS `row_id`, `components`.`component_key`, `components`.`c_name`, `components`.`c_part_no`, `units`.`units_name`, `ven_basic_detail`.`ven_name` FROM `jw_material_challan` LEFT JOIN `ven_basic_detail` ON `ven_basic_detail`.`ven_register_id` = `jw_material_challan`.`jw_vendor_id` LEFT JOIN `components` ON `jw_material_challan`.`jw_component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `jw_material_challan`.`jw_challan_txn_id` = :transaction AND `jw_material_challan`.`company_branch` = :branch ORDER BY `components`.`c_part_no`",
      {
        replacements: { transaction: challan_no, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      // Get dispatch godown details
      let dispatch_addr = await invtDB.query(
        "SELECT * FROM `dispatch_address` WHERE `dispatch_code` = :dispatchcode", 
        {
          replacements: { dispatchcode: stmt[0].jw_dispatch_to_id },
          type: invtDB.QueryTypes.SELECT,
        }
      );

    //   let source_godown = dispatch_addr.length > 0 ? dispatch_addr[0].dispatch_label : "N/A";
    let source_godown = "GDRM0021-A-21 Noida";

      // Get vendor godown using the function
      let destination_godown = await getVendorGodown(stmt[0].jw_vendor_id);

      // Build materials array
      let materials = [];
      let total_quantity = 0;
      let total_amount = 0;

      for (let i = 0; i < stmt.length; i++) {
        let amount = parseFloat(stmt[i].jw_order_qty) * parseFloat(stmt[i].jw_order_rate);
        total_quantity += parseFloat(stmt[i].jw_order_qty);
        total_amount += amount;

        materials.push({
          stock_item_name: stmt[i].c_part_no,
          quantity: parseFloat(stmt[i].jw_order_qty),
          uom: stmt[i].units_name.toUpperCase(),
          rate: parseFloat(stmt[i].jw_order_rate),
          amount: parseFloat(amount.toFixed(2))
        });
      }

      // Format date from insert_dt
      let challan_date = moment(stmt[0].jw_insert_dt).format("YYYYMMDD");

      return res.json({
        success: true,
        data: {
          voucher_header: {
            voucher_number: stmt[0].jw_challan_txn_id,
            voucher_date: challan_date,
            voucher_type: "InterGodownTrfr",
            company_name: "Riot Labz Private Limited - (from 1-Apr-2023)",
            narration: "Material sent for jobwork process - Manufacturing as per PO",
            reason: stmt[0].jw_remark || "Jobwork - Manufacturing Process",
            entered_by: "Hariom Kumar"
          },
          godown_transfer: {
            source_godown: source_godown,
            destination_godown: destination_godown
          },
          materials: materials,
          summary: {
            total_quantity: parseFloat(total_quantity.toFixed(2)),
            total_amount: parseFloat(total_amount.toFixed(2))
          }
        }
      });
    } else {
      return res.json({ 
        success: false,
        message:"Challan not found",
      });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});


module.exports = router;