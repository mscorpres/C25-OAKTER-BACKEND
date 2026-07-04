let { tallyDB, otherDB, invtDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();

const Validator = require("validatorjs");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const multer = require("multer");
const xlsx = require("xlsx");
const path = require("path");
const fs = require("fs");

var storage = multer.diskStorage({
    destination: (req, file, callBack) => {
        callBack(null, "./files/components/");
    },
    filename: (req, file, callBack) => {
        callBack(null, file.fieldname + "-" + Date.now() + path.extname(file.originalname));
    },
});
var upload = multer({ storage: storage });

router.get("/", [auth.isAuthorized], async (req, res) => {
    try {
        let fetchR20 = await otherDB.query(`SELECT r20.component_key , r20.total_balance , r20.part , r20.in_date AS closingDate , components.c_name , components.c_category , groups.group_name FROM ${global.other_db_name}.invt_r20 AS r20 LEFT JOIN ${global.ims_db_name}.components AS components ON r20.component_key = components.component_key LEFT JOIN ${global.ims_db_name}.all_groups AS groups ON components.c_group = groups.group_id`, {
            type: otherDB.QueryTypes.SELECT,
        });

        if (fetchR20.length <= 0) {
            return res.json({ status: "error", success: false, message: "no data found" })
        }

        let result = [];

        for (let i = 0; i < fetchR20.length; i++) {
            let findQty = await tallyDB.query(`SELECT ${global.tally_db_name}.tally_vbt.vbt_inqty , ${global.tally_db_name}.tally_vbt.vbt_inrate , ${global.tally_db_name}.tally_vbt.cifPrice FROM ${global.tally_db_name}.tally_vbt WHERE ${global.tally_db_name}.tally_vbt.part_code = :partCode AND vbt_status != 'DE' ORDER BY ${global.tally_db_name}.tally_vbt.effective_date DESC`, {
                replacements: {
                    partCode: fetchR20[i].component_key
                },
                type: tallyDB.QueryTypes.SELECT
            });

            let totalQty = fetchR20[i].total_balance;
            let totalForAverage = totalQty;
            let totalPrice = 0;
            let fifoAveragePrice = 0;
            let vbtRecord = 0;

            if (findQty.length <= 0 || totalQty <= 0) {
                result.push({
                    partCode: fetchR20[i].part,
                    component: fetchR20[i].c_name,
                    fifoAveragePrice: Number(fifoAveragePrice).toLocaleString("en-IN"),
                    closingStock: Number(fetchR20[i].total_balance).toLocaleString("en-IN"),
                    totalValue: Number(Number(fifoAveragePrice) * Number(fetchR20[i].total_balance)).toLocaleString("en-IN"),
                    category: fetchR20[i].c_category ? fetchR20[i].c_category : "--",
                    group: fetchR20[i].group_name ? fetchR20[i].group_name : "--",
                    vbtRecord: vbtRecord
                })
            }
            else {

                let vbtInQuantity = 0
                let vbtInRate = 0
                let vbtCifRate = 0
                let vbtTotalQty = 0

                for (let j = 0; j < findQty.length; j++) {
                    vbtInQuantity = findQty[j].vbt_inqty;
                    vbtInRate = findQty[j].vbt_inrate;
                    vbtCifRate = findQty[j].cifPrice;
                    vbtTotalQty = Math.min(vbtInQuantity, totalQty);
                    totalPrice += vbtTotalQty * (vbtCifRate > 0 ? vbtCifRate : vbtInRate);
                    totalQty -= vbtTotalQty;
                    vbtRecord += Number(vbtInQuantity);
                }

                fifoAveragePrice += totalPrice / totalForAverage;

                result.push({
                    partCode: fetchR20[i].part,
                    component: fetchR20[i].c_name,
                    fifoAveragePrice: Number(fifoAveragePrice.toFixed(2)).toLocaleString("en-IN"),
                    closingStock: Number(fetchR20[i].total_balance).toLocaleString("en-IN"),
                    totalValue: Number(Number(fifoAveragePrice.toFixed(2)) * Math.min(fetchR20[i].total_balance, vbtRecord)).toLocaleString("en-IN"),
                    category: fetchR20[i].c_category ? fetchR20[i].c_category : "--",
                    group: fetchR20[i].group_name ? fetchR20[i].group_name : "--",
                    vbtRecord: vbtRecord,
                    vbtInQuantity: vbtInQuantity,
                    vbtInRate: vbtInRate,
                    vbtCifRate: vbtCifRate,
                    vbtTotalQty: vbtTotalQty
                })
            }
        }
        return res.json({
            status: "success",
            success: true,
            data: result,
            closingDate: moment(fetchR20[0].closingDate).format("DD-MM-YYYY")
        });
    } catch (error) {
        return helper.errorResponse(res, error);
    }
});

router.get("/generateR20", [auth.isAuthorized], async (req, res) => {
    try {
        let stmt_all_comp = await invtDB.query("SELECT `c_part_no`, `component_key` FROM `components` WHERE `c_type` != 'S' AND `c_is_enabled` = 'Y'", {
            type: invtDB.QueryTypes.SELECT,
        });

        let locations = await invtDB.query("SELECT `locations` FROM `location_allotted` WHERE `loc_all_key` = '2023628133553545'", {
            type: invtDB.QueryTypes.SELECT,
        });

        let locations_arr = locations[0].locations.split(",");

        const comp_length = stmt_all_comp.length;
        const loc_length = locations_arr.length;
        const report_date = moment().subtract(1, "day").format("YYYY-MM-DD");
        const already_saved_data = await otherDB.query("SELECT `part`, `in_date` FROM `invt_r20`", {
            type: otherDB.QueryTypes.SELECT
        });

        last_saved_data_length = already_saved_data.length;

        //now we want date of last entry
        let j = 0;
        if (last_saved_data_length > 0) {
            const last_date = already_saved_data[last_saved_data_length - 1].in_date;
            //if last date and current date doesn't matches then we truncate all the previous data
            if (last_date != report_date) {
                let stmt_trunc_table = await otherDB.query("TRUNCATE TABLE `invt_r20`", {
                    type: invtDB.QueryTypes.TRUNCATE,
                });
            }
        }
        else {
            j = already_saved_data.length > 0 ? already_saved_data.length : 0;
        }

        for (; j < comp_length; j++) {
            let row = stmt_all_comp[j];
            let close_data = {};
            let totalBalance = 0;

            for (let i = 0; i < loc_length; i++) {
                let stmt_loc_name = await invtDB.query("SELECT `loc_name`,`assigned_to` FROM `location_main` WHERE `location_key` = '" + locations_arr[i] + "' ", {
                    type: invtDB.QueryTypes.SELECT,
                });

                // INWARD AND OUTWARD
                let stmt6 = await invtDB.query(
                    "SELECT COALESCE(SUM(CASE WHEN trans_type IN ( 'INWARD','TRANSFER','ISSUE','JOBWORK', 'REJECTION' ) AND `loc_in` = :location THEN qty ELSE 0 END ), 0) AS inward, COALESCE(SUM(CASE WHEN trans_type IN ( 'CONSUMPTION','ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER' ) AND `loc_out` = :location THEN qty ELSE 0 END ), 0) AS outward FROM rm_location WHERE (DATE_FORMAT(`insert_date`,'%Y-%m-%d') <= :date1) AND components_id = :component",
                    {
                        replacements: {
                            component: row.component_key,
                            location: locations_arr[i],
                            date1: report_date,
                        },
                        type: invtDB.QueryTypes.SELECT,
                    }
                );

                let inward_all_qty, outward_all_qty;
                if (stmt6.length > 0) {
                    inward_all_qty = helper.number(stmt6[0].inward);
                    outward_all_qty = helper.number(stmt6[0].outward);
                } else {
                    inward_all_qty = 0, outward_all_qty = 0;
                }

                let closingBal = helper.number(inward_all_qty - outward_all_qty);
                close_data[stmt_loc_name[0].loc_name + "\n" + stmt_loc_name[0].assigned_to] = closingBal;

                totalBalance += closingBal;
            }

            let stmt_insert = await otherDB.query("INSERT INTO `invt_r20` (`part`, `locations`, `in_date`, `component_key`, `total_balance`) VALUES (:part, :locations, :date, :component_key, :totalbalance)", {
                replacements: {
                    part: row.c_part_no,
                    locations: JSON.stringify(close_data),
                    date: report_date,
                    component_key: row.component_key,
                    totalbalance: totalBalance.toFixed(2),
                },
                type: invtDB.QueryTypes.INSERT,
            });
        }
    } catch (error) {
        return helper.errorResponse(res, error);
    }
});

//visualise standard price through excel file
router.post("/standardPrice", [auth.isAuthorized], upload.single("file"), async (req, res) => {

    try {
        const workbook = xlsx.readFile("./files/components/" + req.file.filename);
        const jsonData = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        const data = jsonData.filter((item) => {
            return item.standardPrice > 0;
        })

        return res.json({ status: "success", success: true, data: data });
    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

//standard price of components in an array
router.post("/StandardPrice/update", [auth.isAuthorized], async (req, res) => {
    const transaction = await invtDB.transaction();

    try {
        let validation = new Validator(req.body, {
            componentKey: "required",
            standardPrice: "required"
        });

        if (validation.fails()) {
            await transaction.rollback();
            return res.json({ status: "error", success: false, message: Object.values(validation.errors.all())[0].join() });
        }

        for (let i = 0; i < req.body.componentKey.length; i++) {
            const updateComponent = await invtDB.query("UPDATE components SET standardPrice = :standardPrice WHERE component_key = :component_key", {
                replacements: {
                    standardPrice: req.body.standardPrice[i] ?? 0,
                    component_key: req.body.componentKey[i]
                },
                type: invtDB.QueryTypes.UPDATE,
                transaction: transaction
            });

            if (updateComponent.length <= 0) {
                await transaction.rollback();
                return res.json({ status: "error", success: false, message: "error while updating price" });
            }
        }

        await transaction.commit();
        return res.json({ status: "success", success: true, message: "successfully updated" });
    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

//component list from database
router.get("/componentList", [auth.isAuthorized], async (req, res) => {
    try {
        const result = await invtDB.query("SELECT ID AS SNO , c_part_no AS partCode, c_name AS componentName , component_key AS componentKey , standardPrice From components", {
            type: invtDB.QueryTypes.SELECT
        });

        if (result.length > 0) {
            const filename = "components" + helper.getUniqueNumber() + ".xlsx";
            const worksheet = xlsx.utils.json_to_sheet([{ A: "Note : ", B: "Please don't make any changes in Part Code No and component key. These are only for your reference." }], { header: ["A", "B"], skipHeader: true });

            xlsx.utils.sheet_add_json(worksheet, [{ A: "SNO", B: "partCode", C: "componentName", D: "componentKey", E: "standardPrice" }], { skipHeader: true, origin: "A1" });

            xlsx.utils.sheet_add_json(worksheet, result, { skipHeader: true, origin: "A2" });

            const workbook = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(workbook, worksheet, "Sheet1");
            xlsx.write(workbook, { bookType: "xlsx", type: "buffer" });
            xlsx.writeFile(workbook, "./files/components/downloads/" + filename);;

            let data = fs.readFileSync("./files/components/downloads/" + filename);

            return res.json({ status: "success", success: true, message: "Component list exported", data: data, fileName: filename });

        } else {
            return res.json({ status: "error", success: false, message: "no data found" });
        }
    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

module.exports = router;