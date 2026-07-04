const express = require("express");
const router = express.Router();

const auth = require("../../../../middleware/ven_auth");
const permission = require("../../../../middleware/permission");
let { invtDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");
const XLSX = require("xlsx");

// 01/12/2023
// PART HAS PO OR MIN
// CREATE DATE

router.get("/partPoMin", [auth.isAuthorized], async (req, res) => {
  try {
    const stmt = await invtDB.query(
      "SELECT c_part_no as PART_CODE , c_name as PART_NAME , component_key , DATE_FORMAT(insert_date , '%Y-%m-%d') AS CREATE_DATE , (CASE WHEN po_count > 0 THEN 'Y' ELSE 'N' END) as PO , (CASE WHEN min_count > 0 THEN 'Y' ELSE 'N' END) as MIN FROM (SELECT c_part_no , c_name , component_key , components.insert_date , (SELECT COUNT(ID) FROM po_purchase_req WHERE po_part_no = component_key LIMIT 1 ) AS po_count , (SELECT COUNT(ID) FROM rm_location WHERE components_id = component_key AND trans_type = 'INWARD' LIMIT 1 ) AS min_count  FROM components WHERE DATE_FORMAT(components.insert_date , '%Y-%m-%d') >= '2023-12-01') t",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      const data = [];

      for (let i = 0; i < stmt.length; i++) {
        let lastMInDate = "";
        let costCenter = "";
        if (stmt[i].MIN == "Y") {
          const stmt_min = await invtDB.query(
            "SELECT insert_date ,cost_center_name , cost_center_short_name FROM rm_location LEFT JOIN cost_center ON cost_center.cost_center_key = rm_location.rm_loc_cost_center WHERE components_id = :component_key AND trans_type = 'INWARD' ORDER BY rm_location.ID DESC LIMIT 1",
            {
              replacements: {
                component_key: stmt[i].component_key,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          lastMInDate = moment(
            stmt_min[0].insert_date,
            "YYYY-MM-DD HH:mm:ss"
          ).format("DD-MM-YYYY HH:mm");
          costCenter = `${stmt_min[0].cost_center_name} (${stmt_min[0].cost_center_short_name})`;
        }

        let poProjectName = "";
        if (stmt[i].PO == "Y") {
          const stmt_po = await invtDB.query(
            "SELECT 	po_project_name FROM po_purchase_req WHERE po_part_no = :component_key LIMIT 1",
            {
              replacements: {
                component_key: stmt[i].component_key,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          poProjectName = stmt_po[0].po_project_name;
        }

        data.push({
          PART_CODE: stmt[i].PART_CODE,
          CREATE_DATE: moment(stmt[i].CREATE_DATE, "YYYY-MM-DD").format(
            "DD-MM-YYYY"
          ),
          PART_NAME: stmt[i].PART_NAME,
          LAST_MIN_DATE: lastMInDate,
          PO: stmt[i].PO,
          PO_PROJECT_NAME: poProjectName,
          MIN: stmt[i].MIN,
          COST_CENTER: costCenter,
        });
      }

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, worksheet, "PARTCODE_PO_MIN");

      const fileName = "PARTCODE_PO_MIN.xlsx";
      const filePath = "./files/excel/";

      XLSX.writeFile(workbook, filePath + fileName);

      // let to = "somendra.yadav@mscorpres.in";
      let to = "vishul@oakter.com";

      const attachment = [
        {
          filename: fileName,
          path: filePath + fileName,
        },
      ];

      helper.sendMail(
        to,
        null,
        "Part code has PO or MIN ",
        "Please find the attachment, as report of partcode created after 01/12/2023 ",
        attachment
      );

      return res.json({
        message: "Report generated successfully",
        status: "success",
        success: true,
      });
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

module.exports = router;
