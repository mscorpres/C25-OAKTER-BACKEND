const router = require("express").Router();

let { tallyDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

const Validator = require("validatorjs");
const { encode, decode } = require("html-entities");

async function sumClosingByQuarter(data) {
    const sumByQuarter = {};

    data.forEach(entry => {
        if (!sumByQuarter[entry.quarter]) {
            sumByQuarter[entry.quarter] = 0;
        }
        sumByQuarter[entry.quarter] += entry.closing;
    });

    return sumByQuarter;
}

router.get("/generate", [auth.isAuthorized], async (req, res) => {
    try {

        let validation = new Validator(req.query, {
            date: "required",
        });

        if (validation.fails()) {
            return res.status(403).send(Object.values(validation.errors.all())[0].join());
        }

        const date = req.query.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
        const fromdt = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
        const todt = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

        const months = [];
        let currentMonth = moment(fromdt).clone();

        while (currentMonth.isSameOrBefore(moment(todt), 'month')) {
            months.push(currentMonth.format('MMMM'));
            currentMonth.add(1, 'month');
        }

        let stmt_expenses = await tallyDB.query("SELECT `tally_pl_report`.* ,`tally_group`.*  FROM `tally_pl_report`  `tally_pl_report` LEFT JOIN `tally_group` ON `tally_group`.`group_key` =`tally_pl_report`.`pl_mgroup` WHERE `parent_id` = '--' AND `pl_mgroup`= :key", {
            replacements: { key: "TP20220215211029" },
            type: tallyDB.QueryTypes.SELECT,
        });

        let expenses_master = [];

        for (let m = 0; m < stmt_expenses.length; m++) {
            let stmt_sub = await tallyDB.query("SELECT `tally_pl_report`.* ,`tally_group`.*  FROM `tally_pl_report` LEFT JOIN `tally_group` ON `tally_group`.`group_key` =`tally_pl_report`.`pl_mgroup`  WHERE `parent_id` = :parent", {
                replacements: { parent: stmt_expenses[m].pl_mgroup_key },
                type: tallyDB.QueryTypes.SELECT,
            });

            let sub_group = [];
            let total_m_credit = 0;
            let total_m_debit = 0;
            let total_m_opening = 0;
            let total_m_closing = 0;
            if (stmt_sub.length > 0) {
                // MASTER SUB GROUPS
                for (let m_subi = 0; m_subi < stmt_sub.length; m_subi++) {
                    let sub_sub_group = [];
                    let total_sub_credit = 0;
                    let total_sub_debit = 0;
                    let total_sub_opening = 0;
                    let total_sub_closing = 0;
                    if (stmt_sub[m_subi].pl_subgroups) {
                        let sub_sub_group_key = stmt_sub[m_subi].pl_subgroups.split(",");


                        for (let j = 0; j < sub_sub_group_key.length; j++) {
                            let stmt_sub_sub = await tallyDB.query("SELECT `code` , `group_name` , `group_key` , `parent` FROM `tally_group` WHERE `group_key` = :key ", {
                                replacements: { key: sub_sub_group_key[j] },
                                type: tallyDB.QueryTypes.SELECT,
                            });

                            let stmt_ledgers = await tallyDB.query("SELECT `code` , `ledger_key`, `ladger_name`, `sub_group_key` FROM `tally_ledger` WHERE `sub_group_key` = :key ", {
                                replacements: { key: sub_sub_group_key[j] },
                                type: tallyDB.QueryTypes.SELECT,
                            });
                            let legers = [];
                            let total_ledger_credit = 0;
                            let total_ledger_debit = 0;
                            let total_ledger_opening = 0;
                            let total_ledger_closing = 0;
                            for (let l = 0; l < stmt_ledgers.length; l++) {

                                let cal_stmt = await tallyDB.query("SELECT CASE WHEN MONTH(tally_ledger_data.ref_date) BETWEEN 4 AND 6 THEN 'Q1' WHEN MONTH(tally_ledger_data.ref_date) BETWEEN 7 AND 9 THEN 'Q2' WHEN MONTH(tally_ledger_data.ref_date) BETWEEN 10 AND 12 THEN 'Q3' ELSE 'Q4' END AS quarter, MONTHNAME(tally_ledger_data.ref_date) AS month, COALESCE(SUM(debit), 0) AS sum_debit, COALESCE(SUM(credit), 0) AS sum_credit, COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) AS closing FROM `tally_ledger_data` WHERE (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND `ladger_key` = :ladger_key GROUP BY quarter, MONTHNAME(tally_ledger_data.ref_date) ORDER BY quarter, MONTH(tally_ledger_data.ref_date)", {
                                    replacements: {
                                        date1: fromdt,
                                        date2: todt,
                                        ladger_key: stmt_ledgers[l].ledger_key,
                                    },
                                    type: tallyDB.QueryTypes.SELECT,
                                });

                                let monthObject = {};

                                let closing = 0;

                                if (cal_stmt.length > 0) {
                                    for (let i = 0; i < cal_stmt.length; i++) {
                                        closing += Number(Number(cal_stmt[i].sum_debit ?? 0) - Number(cal_stmt[i].sum_credit ?? 0));
                                        monthObject[cal_stmt[i].month] = Number(Number(cal_stmt[i].closing).toFixed(2)).toLocaleString("en-IN");
                                    }
                                    total_ledger_debit += Number(cal_stmt[0].sum_debit ?? 0);
                                    total_ledger_credit += Number(cal_stmt[0].sum_credit ?? 0);
                                    total_ledger_closing += Number(closing);
                                }

                                let stmt_op_debit_credit = await tallyDB.query("SELECT COALESCE(SUM(`tally_ledger_data`.`debit`),0) AS total_debit, COALESCE(SUM(`tally_ledger_data`.`credit`),0) AS total_credit FROM `tally_ledger_data` WHERE (`tally_ledger_data`.`ladger_key`= :ladger_key) AND (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') < :date1 )", {
                                    replacements: {
                                        date1: fromdt,
                                        date2: todt,
                                        ladger_key: stmt_ledgers[l].ledger_key,
                                    },
                                    type: tallyDB.QueryTypes.SELECT,
                                });

                                let opening_ledger = 0;
                                if (stmt_op_debit_credit.length > 0) {
                                    opening_ledger = Number(stmt_op_debit_credit[0].total_debit) - Number(stmt_op_debit_credit[0].total_credit);
                                }
                                legers.push({
                                    code: stmt_ledgers[l].code,
                                    name: decode(stmt_ledgers[l].ladger_name),
                                    type: "ledger",
                                    months: monthObject,
                                    quarters: await sumClosingByQuarter(cal_stmt),
                                    ytd: Number(closing.toFixed(2)).toLocaleString("en-IN")
                                });

                                total_ledger_opening += Number(Number(opening_ledger).toFixed(2)) ?? 0;
                            } // LEDGER LOOP

                            sub_sub_group.push({
                                name: stmt_sub_sub[0].group_name,
                                type: "Sub Group",
                                ytd: total_ledger_closing.toLocaleString("en-IN"),
                                children: legers,
                            });

                            total_sub_credit += total_ledger_opening;
                            total_sub_debit += total_ledger_debit;
                            total_sub_opening += total_ledger_credit;
                            total_sub_closing += total_ledger_closing;
                        } // SUB SUB GROUP
                    }

                    sub_group.push({
                        name: stmt_sub[m_subi].group_name,
                        type: "Group",
                        ytd: total_sub_closing.toLocaleString("en-IN"),
                        children: sub_sub_group,
                    });
                    total_m_opening += Number(total_sub_opening);
                    total_m_debit += Number(total_sub_debit);
                    total_m_credit += Number(total_sub_credit);
                    total_m_closing += Number(total_sub_closing);
                } //Master Sub Group
            }
            expenses_master.push({
                name: stmt_expenses[m].group_name,
                type: "Master",
                ytd: total_m_closing.toLocaleString("en-IN"),
                closingBalanceFigure: total_m_closing,
                children: sub_group,
            });
        } // EXPENSES Master

        // Income MASTER
        let stmt_income = await tallyDB.query("SELECT `tally_pl_report`.* ,`tally_group`.*  FROM `tally_pl_report`  `tally_pl_report` LEFT JOIN `tally_group` ON `tally_group`.`group_key` =`tally_pl_report`.`pl_mgroup` WHERE `parent_id` = '--'  AND `pl_mgroup`= :key", {
            replacements: { key: "TP20220215211016" },
            type: tallyDB.QueryTypes.SELECT,
        });
        let income_master = [];
        for (let m = 0; m < stmt_income.length; m++) {
            let stmt_sub = await tallyDB.query("SELECT `tally_pl_report`.* ,`tally_group`.*  FROM `tally_pl_report` LEFT JOIN `tally_group` ON `tally_group`.`group_key` =`tally_pl_report`.`pl_mgroup`  WHERE `parent_id` = :parent", {
                replacements: { parent: stmt_income[m].pl_mgroup_key },
                type: tallyDB.QueryTypes.SELECT,
            });

            let sub_group = [];
            let total_m_credit = 0;
            let total_m_debit = 0;
            let total_m_opening = 0;
            let total_m_closing = 0;
            if (stmt_sub.length > 0) {
                // MASTER SUB GROUPS
                for (let m_subi = 0; m_subi < stmt_sub.length; m_subi++) {
                    let sub_sub_group = [];
                    let total_sub_credit = 0;
                    let total_sub_debit = 0;
                    let total_sub_opening = 0;
                    let total_sub_closing = 0;
                    if (stmt_sub[m_subi].pl_subgroups) {
                        let sub_sub_group_key = stmt_sub[m_subi].pl_subgroups.split(",");

                        for (let j = 0; j < sub_sub_group_key.length; j++) {
                            let stmt_sub_sub = await tallyDB.query("SELECT `code` , `group_name` , `group_key` , `parent` FROM `tally_group` WHERE `group_key` = :key ", {
                                replacements: { key: sub_sub_group_key[j] },
                                type: tallyDB.QueryTypes.SELECT,
                            });

                            let stmt_ledgers = await tallyDB.query("SELECT `code` , `ledger_key`, `ladger_name`, `sub_group_key` FROM `tally_ledger` WHERE `sub_group_key` = :key ", {
                                replacements: { key: sub_sub_group_key[j] },
                                type: tallyDB.QueryTypes.SELECT,
                            });
                            let legers = [];
                            let total_ledger_credit = 0;
                            let total_ledger_debit = 0;
                            let total_ledger_opening = 0;
                            let total_ledger_closing = 0;
                            for (let l = 0; l < stmt_ledgers.length; l++) {
                                let cal_stmt = await tallyDB.query("SELECT CASE WHEN MONTH(tally_ledger_data.ref_date) BETWEEN 4 AND 6 THEN 'Q1' WHEN MONTH(tally_ledger_data.ref_date) BETWEEN 7 AND 9 THEN 'Q2' WHEN MONTH(tally_ledger_data.ref_date) BETWEEN 10 AND 12 THEN 'Q3' ELSE 'Q4' END AS quarter, MONTHNAME(tally_ledger_data.ref_date) AS month, COALESCE(SUM(debit), 0) AS sum_debit, COALESCE(SUM(credit), 0) AS sum_credit, COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) AS closing FROM `tally_ledger_data` WHERE (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND `ladger_key` = :ladger_key GROUP BY quarter, MONTHNAME(tally_ledger_data.ref_date) ORDER BY quarter, MONTH(tally_ledger_data.ref_date)", {
                                    replacements: {
                                        date1: fromdt,
                                        date2: todt,
                                        ladger_key: stmt_ledgers[l].ledger_key,
                                    },
                                    type: tallyDB.QueryTypes.SELECT,
                                });

                                let monthObject = {};

                                let closing = 0;

                                if (cal_stmt.length > 0) {
                                    for (let i = 0; i < cal_stmt.length; i++) {
                                        closing += Number(Number(cal_stmt[i].sum_debit ?? 0) - Number(cal_stmt[i].sum_credit ?? 0));
                                        monthObject[cal_stmt[i].month] = Number(Number(cal_stmt[i].closing).toFixed(2)).toLocaleString("en-IN");
                                    }
                                    total_ledger_debit += Number(cal_stmt[0].sum_debit ?? 0);
                                    total_ledger_credit += Number(cal_stmt[0].sum_credit ?? 0);
                                    total_ledger_closing += Number(closing);
                                }

                                let stmt_op_debit_credit = await tallyDB.query("SELECT COALESCE(SUM(`tally_ledger_data`.`debit`),0) AS total_debit, COALESCE(SUM(`tally_ledger_data`.`credit`),0) AS total_credit FROM `tally_ledger_data` WHERE (`tally_ledger_data`.`ladger_key`= :ladger_key) AND (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') < :date1 )", {
                                    replacements: {
                                        date1: fromdt,
                                        date2: todt,
                                        ladger_key: stmt_ledgers[l].ledger_key,
                                    },
                                    type: tallyDB.QueryTypes.SELECT,
                                });

                                let opening_ledger = 0;
                                if (stmt_op_debit_credit.length > 0) {
                                    opening_ledger = Number(stmt_op_debit_credit[0].total_debit) - Number(stmt_op_debit_credit[0].total_credit);
                                }


                                legers.push({
                                    code: stmt_ledgers[l].code,
                                    name: decode(stmt_ledgers[l].ladger_name),
                                    type: "ledger",
                                    months: monthObject,
                                    quarters: await sumClosingByQuarter(cal_stmt),
                                    ytd: Number(closing.toFixed(2)).toLocaleString("en-IN")
                                });
                                total_ledger_opening += Number(Number(opening_ledger).toFixed(2)) ?? 0;
                            } // LEDGER LOOP


                            sub_sub_group.push({
                                name: stmt_sub_sub[0].group_name,
                                type: "Sub Group",
                                ytd: total_ledger_closing.toLocaleString("en-IN"),
                                children: legers,
                            });
                            total_sub_credit += total_ledger_opening;
                            total_sub_debit += total_ledger_debit;
                            total_sub_opening += total_ledger_credit;
                            total_sub_closing += total_ledger_closing;
                        } // SUB SUB GROUP
                    }

                    sub_group.push({
                        name: stmt_sub[m_subi].group_name,
                        type: "Group",
                        ytd: total_sub_closing.toLocaleString("en-IN"),
                        children: sub_sub_group,
                    });
                    total_m_opening += Number(total_sub_opening);
                    total_m_debit += Number(total_sub_debit);
                    total_m_credit += Number(total_sub_credit);
                    total_m_closing += Number(total_sub_closing);
                } //Master Sub Group
            }

            income_master.push({
                name: stmt_income[m].group_name,
                type: "Master",
                ytd: total_m_closing.toLocaleString("en-IN"),
                closingIncomeFigure: total_m_closing,
                children: sub_group,
            });
        } // Income Master Loop

        const data = {
            expenses_master: expenses_master,
            income_master: income_master,
            balanace_fig: (income_master[0].closingIncomeFigure - expenses_master[0].closingBalanceFigure).toLocaleString("en-IN"),
            totalMonths: months
        };

        return res.json(data);


    } catch (error) {
        return helper.errorResponse(res, error);
    }
});

module.exports = router;