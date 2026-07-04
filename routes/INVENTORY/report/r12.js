let { invtDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const fs = require("fs");
const xlsx = require("xlsx");

checkNegativeValue = (value) => {
  return value < 0 ? 0 : value;
};

router.post("/", [auth.isAuthorized], async (req, res) => {
  try {
    if (req.body.skucode == "") {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Please supply product",
      });
    } else if (req.body.subjectcode == "") {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Please supply product BOM [Bill of Material]",
      });
    } else if (req.body.product_fg_qty == "") {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Please supply product FG Qty",
      });
    } else if (req.body.action !== "search_r12") {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Please supply valid report type",
      });
    } else {
      let stmt1 = await invtDB.query("SELECT * FROM bom_recipe WHERE bom_product_sku = :skucode AND subject_id = :subjectcode", {
        replacements: {
          skucode: req.body.skucode,
          subjectcode: req.body.subjectcode,
        },
        type: invtDB.QueryTypes.SELECT,
      });
      if (stmt1.length > 0) {
        let stmt2 = await invtDB.query(
          "SELECT * FROM bom_quantity LEFT JOIN components ON bom_quantity.component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE bom_quantity.product_sku = :skucode AND bom_quantity.subject_under = :subject_id AND (bom_quantity.bom_status = 'A' OR bom_quantity.bom_status = 'ALT')",
          {
            replacements: {
              skucode: req.body.skucode,
              subject_id: req.body.subjectcode,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt2.length > 0) {
          const data = [];

          //
          const getLocations = await invtDB.query("SELECT * FROM location_allotted WHERE loc_all_key IN ('2023112717950595')", {
            type: invtDB.QueryTypes.SELECT,
          });

          if (getLocations.length == 0) {
            return res.json({ status: "error", success: false, message: "RM location not found" });
          }

          let rmLocations = [];
          for (let i = 0; i < getLocations.length; i++) {
            const tempArr = getLocations[i].locations.split(",");
            rmLocations = rmLocations.concat(tempArr);
          }
          //

          count = 0;
          srno = 0;
          stmt2.map(async (item) => {
            //ALL INWARD
            let stmt6 = await invtDB.query(
              "SELECT COALESCE(SUM(qty+other_qty), 0) AS Inward FROM rm_location WHERE components_id = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in IN (:location)",
              {
                replacements: {
                  component: item.component_key,
                  location: rmLocations,
                },
                type: invtDB.QueryTypes.SELECT,
              }
            );

            let inward_all_qty = 0;
            if (stmt6.length > 0) {
              inward_all_qty = helper.number(stmt6[0].Inward);
            }

            // ALL OUTWARD
            let stmt7 = await invtDB.query(
              "SELECT COALESCE(SUM(qty+other_qty), 0) AS Outward FROM rm_location WHERE components_id = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out IN (:location)",
              {
                replacements: {
                  component: item.component_key,
                  location: rmLocations,
                },
                type: invtDB.QueryTypes.SELECT,
              }
            );

            let outward_all_qty = 0;
            if (stmt7.length > 0) {
              outward_all_qty = helper.number(stmt7[0].Outward);
            }

            if (item.qty * req.body.product_fg_qty > inward_all_qty - outward_all_qty) {
              data.push({
                serial_no: srno + 1,
                partno: item.c_part_no,
                new_partno: item.c_new_part_no,
                components: item.c_name,
                currentStock: inward_all_qty - outward_all_qty,
                reqStock: item.qty * req.body.product_fg_qty,
                uom: item.units_name,
                bomqty: item.qty,
              });
              srno++;
            }
            count++;

            if (stmt2.length == count) {
              return res.json({
                status: "success", success: true,
                success: true,
                message: "Report fetched successfully",
                data: data,
              });
            }
          });
        } else {
          return res.json({
            status: "error", success: false,
            success: false,
            message: "product BOM doesn't mapped any components",
          });
        }
      } else {
        return res.json({
          status: "error", success: false,
          success: false,
          message: "product BOM doesn't exists",
        });
      }
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

router.post("/sendmail_1", [auth.isAuthorized], async (req, res) => {
  try {
    const sku_code = "15705";
    const bom = "2022115145430103";
    const qty = 100000;

    let stmt1 = await invtDB.query("SELECT * FROM `bom_recipe` WHERE `bom_product_sku` = :skucode AND `subject_id` = :subjectcode", {
      replacements: {
        skucode: sku_code,
        subjectcode: bom,
      },
      type: invtDB.QueryTypes.SELECT,
    });
    if (stmt1.length > 0) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `bom_quantity` LEFT JOIN `components` ON `bom_quantity`.`component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `bom_quantity`.`product_sku` = :skucode AND `bom_quantity`.`subject_under` = :subject_id AND (`bom_quantity`.`bom_status` = 'A' OR `bom_quantity`.`bom_status` = 'ALT')",
        {
          replacements: {
            skucode: sku_code,
            subject_id: bom,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt2.length > 0) {
        const shortdata = [],
          accessdata = [];
        for (let i = 0; i < stmt2.length; i++) {
          // ALL INWARD
          let stmt3 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD' OR `trans_type` = 'TRANSFER')", {
            replacements: {
              component: stmt2[i].component_key,
            },
            type: invtDB.QueryTypes.SELECT,
          });
          let inward_all_qty;
          if (stmt3.length > 0) {
            inward_all_qty = stmt3[0].Inward;
          } else {
            inward_all_qty = 0;
          }

          // ALL OUTWARD
          let outward_all_qty;
          let stmt4 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` != 'INWARD' AND `trans_type` != 'CONSUMPTION' AND `trans_type` != 'CANCELLED') AND `company_branch` = :branch", {
            replacements: {
              component: stmt2[i].component_key,
            },
            type: invtDB.QueryTypes.SELECT,
          });
          if (stmt4.length > 0) {
            outward_all_qty = stmt4[0].Outward;
          } else {
            outward_all_qty = 0;
          }

          let calculateQty = stmt2[i].qty * qty - (inward_all_qty - outward_all_qty);
          let availableQty = inward_all_qty - outward_all_qty;
          let requiredQty = stmt2[i].qty * qty;

          if (availableQty - requiredQty < 0 || availableQty - requiredQty > availableQty - requiredQty) {
            shortdata.push({
              "Part Code": stmt2[i].c_part_no,
              "Part Name": stmt2[i].c_name,
              Category: stmt2[i].bom_catergory == "P" ? "PART" : stmt2[i].bom_catergory == "PCK" ? "PACKING" : stmt2[i].bom_catergory == "O" ? "OTHER" : stmt2[i].bom_catergory == "PCB" ? "PCB" : "N/A",
              UOM: stmt2[i].units_name,
              "BOM Qty": helper.number(stmt2[i].qty),
              "Required Qty": helper.number(stmt2[i].qty * qty),
              "Available Stock": helper.number(inward_all_qty - outward_all_qty),
              Short: Math.abs(calculateQty),
            });
          } else {
            accessdata.push({
              "Part Code": stmt2[i].c_part_no,
              "Part Name": stmt2[i].c_name,
              Category: stmt2[i].bom_catergory == "P" ? "PART" : stmt2[i].bom_catergory == "PCK" ? "PACKING" : stmt2[i].bom_catergory == "O" ? "OTHER" : stmt2[i].bom_catergory == "PCB" ? "PCB" : "N/A",
              UOM: stmt2[i].units_name,
              "BOM Qty": helper.number(stmt2[i].qty),
              "Required Qty": helper.number(stmt2[i].qty * qty),
              "Available Stock": helper.number(inward_all_qty - outward_all_qty),
              Excess: Math.abs(calculateQty),
            });
          }
        }
        const workSheetShort = xlsx.utils.json_to_sheet(shortdata);
        const workSheetAccess = xlsx.utils.json_to_sheet(accessdata);
        const workBook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workBook, workSheetShort, "Short");
        xlsx.utils.book_append_sheet(workBook, workSheetAccess, "Excess");
        let fileName = "stock15705_1.xlsx";
        xlsx.writeFile(workBook, "./files/excel/stock15705_1.xlsx");
        await helper.sendMail(
          "ashishjames@oakter.com, siddhant@oakter.com, varun@oakter.com, sangeeta@oakter.com",
          null,
          // "postmanreply@gmail.com",
          // null,
          "Auto Stock for SKU 15705 Report",
          "Stock Report for SKU 15705 | BOM Name: BOM WEF 23082022 | QTY: 1 Lakh",
          [
            {
              filename: "stock15705_1.xlsx",
              path: "./files/excel/stock15705_1.xlsx",
            },
          ]
        );
        fs.unlinkSync("./files/excel/stock15705_1.xlsx");
        return res.json({
          status: "success", success: true,
          success: true,
          message: "Mail sent successfully",
        });
      }
    } else {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "product BOM doesn't mapped any components",
      });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

router.post("/sendmail_2", [auth.isAuthorized], async (req, res) => {
  try {
    const sku_code = "15705";
    const bom = "2023327104926235";
    const qty = 100000;
    const reportDate = moment(new Date()).format("DD-MM-YYYY");

    let stmt1 = await invtDB.query("SELECT * FROM `bom_recipe` WHERE `bom_product_sku` = :skucode AND `subject_id` = :subjectcode", {
      replacements: {
        skucode: sku_code,
        subjectcode: bom,
      },
      type: invtDB.QueryTypes.SELECT,
    });
    if (stmt1.length > 0) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `bom_quantity` LEFT JOIN `components` ON `bom_quantity`.`component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `bom_quantity`.`product_sku` = :skucode AND `bom_quantity`.`subject_under` = :subject_id AND (`bom_quantity`.`bom_status` = 'A' OR `bom_quantity`.`bom_status` = 'ALT')",
        {
          replacements: {
            skucode: sku_code,
            subject_id: bom,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt2.length > 0) {
        const shortdata = [],
          accessdata = [];
        for (let i = 0; i < stmt2.length; i++) {
          // ALL INWARD
          let stmt3 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD' OR `trans_type` = 'TRANSFER')", {
            replacements: {
              component: stmt2[i].component_key,
            },
            type: invtDB.QueryTypes.SELECT,
          });
          let inward_all_qty;
          if (stmt3.length > 0) {
            inward_all_qty = stmt3[0].Inward;
          } else {
            inward_all_qty = 0;
          }

          // ALL OUTWARD
          let outward_all_qty;
          let stmt4 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` != 'INWARD' AND `trans_type` != 'CONSUMPTION' AND `trans_type` != 'CANCELLED')", {
            replacements: {
              component: stmt2[i].component_key,
            },
            type: invtDB.QueryTypes.SELECT,
          });
          if (stmt4.length > 0) {
            outward_all_qty = stmt4[0].Outward;
          } else {
            outward_all_qty = 0;
          }

          let calculateQty = stmt2[i].qty * qty - (inward_all_qty - outward_all_qty);
          let availableQty = inward_all_qty - outward_all_qty;
          let requiredQty = stmt2[i].qty * qty;

          if (availableQty - requiredQty < 0 || availableQty - requiredQty > availableQty - requiredQty) {
            shortdata.push({
              "Part Code": stmt2[i].c_part_no,
              "Part Name": stmt2[i].c_name,
              Category: stmt2[i].bom_catergory == "P" ? "PART" : stmt2[i].bom_catergory == "PCK" ? "PACKING" : stmt2[i].bom_catergory == "O" ? "OTHER" : stmt2[i].bom_catergory == "PCB" ? "PCB" : "N/A",
              UOM: stmt2[i].units_name,
              "BOM Qty": helper.number(stmt2[i].qty),
              "Required Qty": helper.number(stmt2[i].qty * qty),
              "Available Stock": helper.number(inward_all_qty - outward_all_qty),
              Short: Math.abs(calculateQty),
            });
          } else {
            accessdata.push({
              "Part Code": stmt2[i].c_part_no,
              "Part Name": stmt2[i].c_name,
              Category: stmt2[i].bom_catergory == "P" ? "PART" : stmt2[i].bom_catergory == "PCK" ? "PACKING" : stmt2[i].bom_catergory == "O" ? "OTHER" : stmt2[i].bom_catergory == "PCB" ? "PCB" : "N/A",
              UOM: stmt2[i].units_name,
              "BOM Qty": helper.number(stmt2[i].qty),
              "Required Qty": helper.number(stmt2[i].qty * qty),
              "Available Stock": helper.number(inward_all_qty - outward_all_qty),
              Excess: Math.abs(calculateQty),
            });
          }
        }

        // INITIAL
        const workSheetShort = xlsx.utils.json_to_sheet([]);
        const workSheetAccess = xlsx.utils.json_to_sheet([]);

        // SET HEADERS STRUCTURE
        if (!workSheetShort["!merges"]) workSheetShort["!merges"] = [];
        if (!workSheetAccess["!merges"]) workSheetAccess["!merges"] = [];

        workSheetShort["!merges"].push(xlsx.utils.decode_range("A1:H1"), xlsx.utils.decode_range("A2:D2"), xlsx.utils.decode_range("A3:D3"), xlsx.utils.decode_range("E2:H3"));
        workSheetAccess["!merges"].push(xlsx.utils.decode_range("A1:H1"), xlsx.utils.decode_range("A2:D2"), xlsx.utils.decode_range("A3:D3"), xlsx.utils.decode_range("E2:H3"));

        // SET HEADERS
        xlsx.utils.sheet_add_aoa(workSheetShort, [["Riot Labz Private Limited"], ["SKU CODE: " + sku_code], ["SKU NAME: Oak4GQ"]]);
        xlsx.utils.sheet_add_aoa(workSheetShort, [["Report Date : " + reportDate]], { origin: "E2" });

        xlsx.utils.sheet_add_aoa(workSheetAccess, [["Riot Labz Private Limited"], ["SKU CODE: " + sku_code], ["SKU NAME: Oak4GQ"]]);
        xlsx.utils.sheet_add_aoa(workSheetAccess, [["Report Date :" + reportDate]], { origin: "E2" });

        // SET DATA
        xlsx.utils.sheet_add_json(workSheetShort, shortdata, { origin: "A4" });
        xlsx.utils.sheet_add_json(workSheetAccess, accessdata, { origin: "A4" });

        const workBook = xlsx.utils.book_new();

        xlsx.utils.book_append_sheet(workBook, workSheetShort, "Short");
        xlsx.utils.book_append_sheet(workBook, workSheetAccess, "Excess");
        let fileName = "stock15705_2.xlsx";
        xlsx.writeFile(workBook, "./files/excel/stock15705_2.xlsx");
        await helper.sendMail(
          "ashishjames@oakter.com, siddhant@oakter.com, varun@oakter.com, sangeeta@oakter.com",
          null,
          // "postmanreply@gmail.com",
          // null,
          "Auto Stock for SKU 15705 Report",
          "Stock Report for SKU 15705 | BOM Name: BOM WEF 27042023 | QTY: 1 Lakh",
          [
            {
              filename: "stock15705_2.xlsx",
              path: "./files/excel/stock15705_2.xlsx",
            },
          ]
        );
        fs.unlinkSync("./files/excel/stock15705_2.xlsx");
        return res.json({
          status: "success", success: true,
          success: true,
          message: "Mail sent successfully",
        });
      }
    } else {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "product BOM doesn't mapped any components",
      });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

router.post("/sendmail_15802RQ2", [auth.isAuthorized], async (req, res) => {
  try {
    const sku_code = "15802";
    const bom = "2023128143451124";
    const qty = 10000;
    const reportDate = moment(new Date()).format("DD-MM-YYYY");

    let stmt1 = await invtDB.query("SELECT * FROM `bom_recipe` WHERE `bom_product_sku` = :skucode AND `subject_id` = :subjectcode", {
      replacements: {
        skucode: sku_code,
        subjectcode: bom,
      },
      type: invtDB.QueryTypes.SELECT,
    });
    if (stmt1.length > 0) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `bom_quantity` LEFT JOIN `components` ON `bom_quantity`.`component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `bom_quantity`.`product_sku` = :skucode AND `bom_quantity`.`subject_under` = :subject_id AND (`bom_quantity`.`bom_status` = 'A' OR `bom_quantity`.`bom_status` = 'ALT')",
        {
          replacements: {
            skucode: sku_code,
            subject_id: bom,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt2.length > 0) {
        const shortdata = [],
          accessdata = [];
        for (let i = 0; i < stmt2.length; i++) {
          // ALL INWARD
          let stmt3 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND `loc_in` = :location AND (`trans_type` = 'INWARD' OR `trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION' OR `trans_type` = 'TRANSFER')", {
            replacements: {
              component: stmt2[i].component_key,
              location: 1679131898656,
            },
            type: invtDB.QueryTypes.SELECT,
          });

          let inward_all_qty;
          if (stmt3.length > 0) {
            inward_all_qty = stmt3[0].Inward;
          } else {
            inward_all_qty = 0;
          }
          // ALL OUTWARD
          let stmt4 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND `loc_out` = :location AND (`trans_type` = 'CONSUMPTION' OR `trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION' OR `trans_type` = 'TRANSFER')", {
            replacements: {
              component: stmt2[i].component_key,
              location: 1679131898656,
            },
            type: invtDB.QueryTypes.SELECT,
          });

          let outward_all_qty;
          if (stmt4.length > 0) {
            outward_all_qty = stmt4[0].Outward;
          } else {
            outward_all_qty = 0;
          }

          let calculateQty = stmt2[i].qty * qty - (inward_all_qty - outward_all_qty);
          let availableQty = inward_all_qty - outward_all_qty;
          let requiredQty = stmt2[i].qty * qty;

          if (availableQty - requiredQty < 0 || availableQty - requiredQty > availableQty - requiredQty) {
            shortdata.push({
              "Part Code": stmt2[i].c_part_no,
              "Part Name": stmt2[i].c_name,
              Category: stmt2[i].bom_catergory == "P" ? "PART" : stmt2[i].bom_catergory == "PCK" ? "PACKING" : stmt2[i].bom_catergory == "O" ? "OTHER" : stmt2[i].bom_catergory == "PCB" ? "PCB" : "N/A",
              UOM: stmt2[i].units_name,
              "BOM Qty": helper.number(stmt2[i].qty),
              "Required Qty": helper.number(stmt2[i].qty * qty),
              "Available Stock": helper.number(inward_all_qty - outward_all_qty),
              Short: Math.abs(calculateQty),
            });
          } else {
            accessdata.push({
              "Part Code": stmt2[i].c_part_no,
              "Part Name": stmt2[i].c_name,
              Category: stmt2[i].bom_catergory == "P" ? "PART" : stmt2[i].bom_catergory == "PCK" ? "PACKING" : stmt2[i].bom_catergory == "O" ? "OTHER" : stmt2[i].bom_catergory == "PCB" ? "PCB" : "N/A",
              UOM: stmt2[i].units_name,
              "BOM Qty": helper.number(stmt2[i].qty),
              "Required Qty": helper.number(stmt2[i].qty * qty),
              "Available Stock": helper.number(inward_all_qty - outward_all_qty),
              Excess: Math.abs(calculateQty),
            });
          }
        }
        // INITIAL
        const workSheetShort = xlsx.utils.json_to_sheet([]);
        const workSheetAccess = xlsx.utils.json_to_sheet([]);

        // SET HEADERS STRUCTURE
        if (!workSheetShort["!merges"]) workSheetShort["!merges"] = [];
        if (!workSheetAccess["!merges"]) workSheetAccess["!merges"] = [];

        workSheetShort["!merges"].push(xlsx.utils.decode_range("A1:H1"), xlsx.utils.decode_range("A2:D2"), xlsx.utils.decode_range("A3:D3"), xlsx.utils.decode_range("E2:H3"));
        workSheetAccess["!merges"].push(xlsx.utils.decode_range("A1:H1"), xlsx.utils.decode_range("A2:D2"), xlsx.utils.decode_range("A3:D3"), xlsx.utils.decode_range("E2:H3"));

        // SET HEADERS
        xlsx.utils.sheet_add_aoa(workSheetShort, [["Riot Labz Private Limited"], ["SKU CODE: " + sku_code], ["SKU NAME: Refurbish Paytm SB 2.0 Oak2G RQ2"]]);
        xlsx.utils.sheet_add_aoa(workSheetShort, [["Report Date : " + reportDate]], { origin: "E2" });

        xlsx.utils.sheet_add_aoa(workSheetAccess, [["Riot Labz Private Limited"], ["SKU CODE: " + sku_code], ["SKU NAME: Refurbish Paytm SB 2.0 Oak2G RQ2"]]);
        xlsx.utils.sheet_add_aoa(workSheetAccess, [["Report Date :" + reportDate]], { origin: "E2" });

        // SET DATA
        xlsx.utils.sheet_add_json(workSheetShort, shortdata, { origin: "A4" });
        xlsx.utils.sheet_add_json(workSheetAccess, accessdata, { origin: "A4" });

        const workBook = xlsx.utils.book_new();

        xlsx.utils.book_append_sheet(workBook, workSheetShort, "Short");
        xlsx.utils.book_append_sheet(workBook, workSheetAccess, "Excess");

        let fileName = "stock15802.xlsx";
        xlsx.writeFile(workBook, "./files/excel/" + fileName);
        await helper.sendMail(
          "ashishjames@oakter.com, siddhant@oakter.com, varun@oakter.com, sangeeta@oakter.com",
          null,
          // "postmanreply@gmail.com",
          // null,
          "Auto Stock for SKU 15802 Report",
          "Stock Report for SKU 15802 | BOM Name: BOM WEF 28022023 | QTY: 10,000  | Stock Location : RM029",
          [
            {
              filename: fileName,
              path: "./files/excel/" + fileName,
            },
          ]
        );
        fs.unlinkSync("./files/excel/" + fileName);
        return res.json({
          status: "success", success: true,
          success: true,
          message: "Mail sent successfully",
        });
      }
    } else {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "product BOM doesn't mapped any components",
      });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

router.post("/sendmail_15804RQ2", [auth.isAuthorized], async (req, res) => {
  try {
    const sku_code = "15804";
    const bom = "202312814312253";
    const qty = 80000;
    const reportDate = moment(new Date()).format("DD-MM-YYYY");

    let stmt1 = await invtDB.query("SELECT * FROM `bom_recipe` WHERE `bom_product_sku` = :skucode AND `subject_id` = :subjectcode", {
      replacements: {
        skucode: sku_code,
        subjectcode: bom,
      },
      type: invtDB.QueryTypes.SELECT,
    });
    if (stmt1.length > 0) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `bom_quantity` LEFT JOIN `components` ON `bom_quantity`.`component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `bom_quantity`.`product_sku` = :skucode AND `bom_quantity`.`subject_under` = :subject_id AND (`bom_quantity`.`bom_status` = 'A' OR `bom_quantity`.`bom_status` = 'ALT')",
        {
          replacements: {
            skucode: sku_code,
            subject_id: bom,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt2.length > 0) {
        const shortdata = [],
          accessdata = [];
        for (let i = 0; i < stmt2.length; i++) {
          // ALL INWARD
          let stmt3 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND `loc_in` = :location AND (`trans_type` = 'INWARD' OR `trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION' OR `trans_type` = 'TRANSFER')", {
            replacements: {
              component: stmt2[i].component_key,
              location: 1679131898656,
            },
            type: invtDB.QueryTypes.SELECT,
          });

          let inward_all_qty;
          if (stmt3.length > 0) {
            inward_all_qty = stmt3[0].Inward;
          } else {
            inward_all_qty = 0;
          }
          // ALL OUTWARD
          let stmt4 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND `loc_out` = :location AND (`trans_type` = 'CONSUMPTION' OR `trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION' OR `trans_type` = 'TRANSFER')", {
            replacements: {
              component: stmt2[i].component_key,
              location: 1679131898656,
            },
            type: invtDB.QueryTypes.SELECT,
          });

          let outward_all_qty;
          if (stmt4.length > 0) {
            outward_all_qty = stmt4[0].Outward;
          } else {
            outward_all_qty = 0;
          }

          let calculateQty = stmt2[i].qty * qty - (inward_all_qty - outward_all_qty);
          let availableQty = inward_all_qty - outward_all_qty;
          let requiredQty = stmt2[i].qty * qty;

          if (availableQty - requiredQty < 0 || availableQty - requiredQty > availableQty - requiredQty) {
            shortdata.push({
              "Part Code": stmt2[i].c_part_no,
              "Part Name": stmt2[i].c_name,
              Category: stmt2[i].bom_catergory == "P" ? "PART" : stmt2[i].bom_catergory == "PCK" ? "PACKING" : stmt2[i].bom_catergory == "O" ? "OTHER" : stmt2[i].bom_catergory == "PCB" ? "PCB" : "N/A",
              UOM: stmt2[i].units_name,
              "BOM Qty": helper.number(stmt2[i].qty),
              "Required Qty": helper.number(stmt2[i].qty * qty),
              "Available Stock": helper.number(inward_all_qty - outward_all_qty),
              Short: Math.abs(calculateQty),
            });
          } else {
            accessdata.push({
              "Part Code": stmt2[i].c_part_no,
              "Part Name": stmt2[i].c_name,
              Category: stmt2[i].bom_catergory == "P" ? "PART" : stmt2[i].bom_catergory == "PCK" ? "PACKING" : stmt2[i].bom_catergory == "O" ? "OTHER" : stmt2[i].bom_catergory == "PCB" ? "PCB" : "N/A",
              UOM: stmt2[i].units_name,
              "BOM Qty": helper.number(stmt2[i].qty),
              "Required Qty": helper.number(stmt2[i].qty * qty),
              "Available Stock": helper.number(inward_all_qty - outward_all_qty),
              Excess: Math.abs(calculateQty),
            });
          }
        }
        // INITIAL
        const workSheetShort = xlsx.utils.json_to_sheet([]);
        const workSheetAccess = xlsx.utils.json_to_sheet([]);

        // SET HEADERS STRUCTURE
        if (!workSheetShort["!merges"]) workSheetShort["!merges"] = [];
        if (!workSheetAccess["!merges"]) workSheetAccess["!merges"] = [];

        workSheetShort["!merges"].push(xlsx.utils.decode_range("A1:H1"), xlsx.utils.decode_range("A2:D2"), xlsx.utils.decode_range("A3:D3"), xlsx.utils.decode_range("E2:H3"));
        workSheetAccess["!merges"].push(xlsx.utils.decode_range("A1:H1"), xlsx.utils.decode_range("A2:D2"), xlsx.utils.decode_range("A3:D3"), xlsx.utils.decode_range("E2:H3"));

        // SET HEADERS
        xlsx.utils.sheet_add_aoa(workSheetShort, [["Riot Labz Private Limited"], ["SKU CODE: " + sku_code], ["SKU NAME: Refurbish Paytm SB 3.0 Oak2GQ RQ2"]]);
        xlsx.utils.sheet_add_aoa(workSheetShort, [["Report Date : " + reportDate]], { origin: "E2" });

        xlsx.utils.sheet_add_aoa(workSheetAccess, [["Riot Labz Private Limited"], ["SKU CODE: " + sku_code], ["SKU NAME: Refurbish Paytm SB 3.0 Oak2GQ RQ2"]]);
        xlsx.utils.sheet_add_aoa(workSheetAccess, [["Report Date :" + reportDate]], { origin: "E2" });

        // SET DATA
        xlsx.utils.sheet_add_json(workSheetShort, shortdata, { origin: "A4" });
        xlsx.utils.sheet_add_json(workSheetAccess, accessdata, { origin: "A4" });

        const workBook = xlsx.utils.book_new();

        xlsx.utils.book_append_sheet(workBook, workSheetShort, "Short");
        xlsx.utils.book_append_sheet(workBook, workSheetAccess, "Excess");

        let fileName = "stock15804.xlsx";
        xlsx.writeFile(workBook, "./files/excel/" + fileName);
        await helper.sendMail(
          "ashishjames@oakter.com, siddhant@oakter.com, varun@oakter.com, sangeeta@oakter.com",
          null,
          // "postmanreply@gmail.com",
          // null,
          "Auto Stock for SKU 15804 Report",
          "Stock Report for SKU 15804 | BOM Name: BOM WEF 28022023 | QTY: 1,25,000 | Stock Location : RM029",
          [
            {
              filename: fileName,
              path: "./files/excel/" + fileName,
            },
          ]
        );
        fs.unlinkSync("./files/excel/" + fileName);
        return res.json({
          status: "success", success: true,
          success: true,
          message: "Mail sent successfully",
        });
      }
    } else {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "product BOM doesn't mapped any components",
      });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

router.post("/sendmail_15806RQ2", [auth.isAuthorized], async (req, res) => {
  try {
    const sku_code = "15806";
    const bom = "2023128143326962";
    const qty = 10000;
    const reportDate = moment(new Date()).format("DD-MM-YYYY");

    let stmt1 = await invtDB.query("SELECT * FROM `bom_recipe` WHERE `bom_product_sku` = :skucode AND `subject_id` = :subjectcode", {
      replacements: {
        skucode: sku_code,
        subjectcode: bom,
      },
      type: invtDB.QueryTypes.SELECT,
    });
    if (stmt1.length > 0) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `bom_quantity` LEFT JOIN `components` ON `bom_quantity`.`component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `bom_quantity`.`product_sku` = :skucode AND `bom_quantity`.`subject_under` = :subject_id AND (`bom_quantity`.`bom_status` = 'A' OR `bom_quantity`.`bom_status` = 'ALT')",
        {
          replacements: {
            skucode: sku_code,
            subject_id: bom,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt2.length > 0) {
        const shortdata = [],
          accessdata = [];
        for (let i = 0; i < stmt2.length; i++) {
          // ALL INWARD
          let stmt3 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND `loc_in` = :location AND (`trans_type` = 'INWARD' OR `trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION' OR `trans_type` = 'TRANSFER')", {
            replacements: {
              component: stmt2[i].component_key,
              location: 1679131898656,
            },
            type: invtDB.QueryTypes.SELECT,
          });

          let inward_all_qty;
          if (stmt3.length > 0) {
            inward_all_qty = stmt3[0].Inward;
          } else {
            inward_all_qty = 0;
          }
          // ALL OUTWARD
          let stmt4 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND `loc_out` = :location AND (`trans_type` = 'CONSUMPTION' OR `trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION' OR `trans_type` = 'TRANSFER')", {
            replacements: {
              component: stmt2[i].component_key,
              location: 1679131898656,
            },
            type: invtDB.QueryTypes.SELECT,
          });

          let outward_all_qty;
          if (stmt4.length > 0) {
            outward_all_qty = stmt4[0].Outward;
          } else {
            outward_all_qty = 0;
          }

          let calculateQty = stmt2[i].qty * qty - (inward_all_qty - outward_all_qty);
          let availableQty = inward_all_qty - outward_all_qty;
          let requiredQty = stmt2[i].qty * qty;

          if (availableQty - requiredQty < 0 || availableQty - requiredQty > availableQty - requiredQty) {
            shortdata.push({
              "Part Code": stmt2[i].c_part_no,
              "Part Name": stmt2[i].c_name,
              Category: stmt2[i].bom_catergory == "P" ? "PART" : stmt2[i].bom_catergory == "PCK" ? "PACKING" : stmt2[i].bom_catergory == "O" ? "OTHER" : stmt2[i].bom_catergory == "PCB" ? "PCB" : "N/A",
              UOM: stmt2[i].units_name,
              "BOM Qty": helper.number(stmt2[i].qty),
              "Required Qty": helper.number(stmt2[i].qty * qty),
              "Available Stock": helper.number(inward_all_qty - outward_all_qty),
              Short: Math.abs(calculateQty),
            });
          } else {
            accessdata.push({
              "Part Code": stmt2[i].c_part_no,
              "Part Name": stmt2[i].c_name,
              Category: stmt2[i].bom_catergory == "P" ? "PART" : stmt2[i].bom_catergory == "PCK" ? "PACKING" : stmt2[i].bom_catergory == "O" ? "OTHER" : stmt2[i].bom_catergory == "PCB" ? "PCB" : "N/A",
              UOM: stmt2[i].units_name,
              "BOM Qty": helper.number(stmt2[i].qty),
              "Required Qty": helper.number(stmt2[i].qty * qty),
              "Available Stock": helper.number(inward_all_qty - outward_all_qty),
              Excess: Math.abs(calculateQty),
            });
          }
        }
        // INITIAL
        const workSheetShort = xlsx.utils.json_to_sheet([]);
        const workSheetAccess = xlsx.utils.json_to_sheet([]);

        // SET HEADERS STRUCTURE
        if (!workSheetShort["!merges"]) workSheetShort["!merges"] = [];
        if (!workSheetAccess["!merges"]) workSheetAccess["!merges"] = [];

        workSheetShort["!merges"].push(xlsx.utils.decode_range("A1:H1"), xlsx.utils.decode_range("A2:D2"), xlsx.utils.decode_range("A3:D3"), xlsx.utils.decode_range("E2:H3"));
        workSheetAccess["!merges"].push(xlsx.utils.decode_range("A1:H1"), xlsx.utils.decode_range("A2:D2"), xlsx.utils.decode_range("A3:D3"), xlsx.utils.decode_range("E2:H3"));

        // SET HEADERS
        xlsx.utils.sheet_add_aoa(workSheetShort, [["Riot Labz Private Limited"], ["SKU CODE: " + sku_code], ["SKU NAME: Refurbish Paytm SB 3.0 Oak4GQ RQ2"]]);
        xlsx.utils.sheet_add_aoa(workSheetShort, [["Report Date : " + reportDate]], { origin: "E2" });

        xlsx.utils.sheet_add_aoa(workSheetAccess, [["Riot Labz Private Limited"], ["SKU CODE: " + sku_code], ["SKU NAME: Refurbish Paytm SB 3.0 Oak4GQ RQ2"]]);
        xlsx.utils.sheet_add_aoa(workSheetAccess, [["Report Date :" + reportDate]], { origin: "E2" });

        // SET DATA
        xlsx.utils.sheet_add_json(workSheetShort, shortdata, { origin: "A4" });
        xlsx.utils.sheet_add_json(workSheetAccess, accessdata, { origin: "A4" });

        const workBook = xlsx.utils.book_new();

        xlsx.utils.book_append_sheet(workBook, workSheetShort, "Short");
        xlsx.utils.book_append_sheet(workBook, workSheetAccess, "Excess");

        let fileName = "stock15806.xlsx";
        xlsx.writeFile(workBook, "./files/excel/" + fileName);
        await helper.sendMail(
          "ashishjames@oakter.com, siddhant@oakter.com, varun@oakter.com, sangeeta@oakter.com",
          null,
          // "postmanreply@gmail.com",
          // null,
          "Auto Stock for SKU 15806 Report",
          "Stock Report for SKU 15806 | BOM Name: BOM WEF 28022023 | QTY: 10,000 | Stock Location : RM029",
          [
            {
              filename: fileName,
              path: "./files/excel/" + fileName,
            },
          ]
        );
        fs.unlinkSync("./files/excel/" + fileName);
        return res.json({
          status: "success", success: true,
          success: true,
          message: "Mail sent successfully",
        });
      }
    } else {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "product BOM doesn't mapped any components",
      });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

//Daily Rejection Report
router.post("/sendmail_rejectionReport", [auth.isAuthorized], async (req, res) => {
  try {
    const report_date = moment().subtract(1, "day").format("YYYY-MM-DD");

    let stmt1 = await invtDB.query(
      "SELECT *, `rm_location`.`insert_date`, `rm_location`.`insert_by` AS `insertedByPersonName` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `rm_location`.`insert_by` = `admin_login`.`CustID` WHERE `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND `rm_location`.`loc_in` = :location AND DATE_FORMAT(`rm_location`.`insert_date`,'%Y-%m-%d') = :yesterday AND `rm_location`.`trans_type` = 'TRANSFER' ORDER BY `rm_location`.`transfer_transaction_id` DESC",
      {
        replacements: {
          yesterday: report_date,
          location: 20220106105354
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt1.length > 0) {
      var data = [];
      stmt1.map(async (item) => {
        //LAST RATE
        let stmt2 = await invtDB.query(
          "SELECT `rm_location`.`in_po_rate`, `ims_currency`.`currency_symbol` FROM `rm_location` LEFT JOIN `ims_currency` ON `rm_location`.`currency_type` = `ims_currency`.`currency_id` WHERE `rm_location`.`trans_type` = 'INWARD' AND `rm_location`.`components_id` = :component ORDER BY `rm_location`.`ID` DESC LIMIT 1",
          {
            replacements: { component: item.components_id },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let last_in_rate;
        if (stmt2.length > 0) {
          last_in_rate = stmt2[0].currency_symbol + " " + helper.number(stmt2[0].in_po_rate);
        } else {
          last_in_rate = "N/A";
        }

        data.push({
          "Part": item.c_part_no,
          "Name": item.c_name,
          "QTY": helper.number(item.qty) + helper.number(item.other_qty),
          "LPP": last_in_rate,
          "UOM": item.units_name,
          "Remark": item.any_remark
        });

        if (data.length === stmt1.length) {
          // INIT
          const workSheetSheet = xlsx.utils.json_to_sheet([]);
          // SET HEADERS STRUCTURE
          if (!workSheetSheet["!merges"]) workSheetSheet["!merges"] = [];

          workSheetSheet["!merges"].push(xlsx.utils.decode_range("A1:F1"), xlsx.utils.decode_range("A2:C2"), xlsx.utils.decode_range("D2:F2"));

          // SET HEADERS
          xlsx.utils.sheet_add_aoa(workSheetSheet, [["Riot Labz Private Limited"], ["Report Name: Daily Rejection Report"]]);
          xlsx.utils.sheet_add_aoa(workSheetSheet, [["Report Date : " + moment(report_date, "YYYY-MM-DD").format("DD-MM-YYYY")]], { origin: "D2" });
          // SET DATA
          xlsx.utils.sheet_add_json(workSheetSheet, data, { origin: "A4" });

          const workBook = xlsx.utils.book_new();

          xlsx.utils.book_append_sheet(workBook, workSheetSheet, "Rejection Report");

          let fileName = "rejectionReport.xlsx";
          xlsx.writeFile(workBook, "./files/excel/" + fileName);

          await helper.sendMail(
            "ashishjames@oakter.com, siddhant@oakter.com, varun@oakter.com, keshav.sharma@mscorpres.in, vishul@oakter.com , ashishjames@oakter.com , ankitsaini@oakter.com, procurement@oakter.com",
            null,
            // "postmanreply@gmail.com",
            // null,
            "Daily Rejection Report [" + moment(report_date, "YYYY-MM-DD").format("DD-MM-YYYY") + "]",
            "Please find the attachment, as report of daily rejection based on date " + moment(report_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
            [
              {
                filename: "rejectionReport.xlsx",
                path: "./files/excel/rejectionReport.xlsx",
              },
            ]
          );
          fs.unlinkSync("./files/excel/rejectionReport.xlsx");
          return res.json({
            status: "success", success: true,
            success: true,
            message: "Rejection report sent successfully",
          });
        }
      });
    } else {
      return res.json({ status: "error", success: false, message: "No data found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});
module.exports = router;
