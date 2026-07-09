const express = require("express");
const router = express.Router();

const auth = require("../../middleware/auth");
let { otherDB } = require("../../config/db/connection");
const helper = require("../../helper/helper");

const Validator = require("validatorjs");

// CREATE TEAM AND ADD MEMEBER
// router.post("/add_team_in_po", [auth.isAuthorized], async (req, res) => {
//   try {
//     let validation = new Validator(req.body, {
//       team_leader: "required",
//       team_member: "required",
//       cost_center: "required",
//     });

//     if (validation.fails()) {
//       return res.json({ success: false, message: validation.errors.all(), status: "error" });
//     }

//     let stmt = await otherDB.query("SELECT * FROM ims_po_team WHERE ims_po_team_leader = :team_leader AND ims_po_team_member = :team_member AND po_cost_center = :costCenter ", {
//       replacements: { 
//         team_leader: req.body.team_leader,
//         team_member: req.body.team_member,
//         costCenter: req.body.cost_center,
//        },
//       type: otherDB.QueryTypes.SELECT,
//     });

//     if (stmt.length > 0) {
//       return res.json({ success: false, status: "error", message:"Team member already exists" });
//     } else {
//       let stmt_add = await otherDB.query("INSERT INTO ims_po_team (ims_po_team_leader,ims_po_team_member , po_cost_center) VALUES (:team_leader,:team_member , :costCenter )", {
//         replacements: { 
//           team_leader: req.body.team_leader,
//           team_member: req.body.team_member,
//           costCenter: req.body.cost_center,
//          },
//         type: otherDB.QueryTypes.INSERT,
//       });

//       return res.json({ success: true, status: "success", message: "Team member added" });
//     }
//   } catch (err) {
//     return helper.errorResponse(res, err);
//   }
// });

router.post("/add_team_in_po", async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      team_leader: "required",
      team_member: "required",
      cost_center: "required",
    });

    if (validation.fails()) {
      return res.json({ code: 500, success: false, message: validation.errors.all(), status: "error" });
    }

    const inserted = [];
    const skipped = [];
    const { team_leader, team_member, cost_center } = req.body
    for (let cc of cost_center) {
      let stmt = await otherDB.query("SELECT * FROM ims_po_team WHERE ims_po_team_leader = :team_leader AND ims_po_team_member = :team_member AND po_cost_center = :costCenter ", {
        replacements: {
          team_leader: team_leader,
          team_member: team_member,
          costCenter: cc,
        },
        type: otherDB.QueryTypes.SELECT,
      });

      if (stmt.length > 0) {
        skipped.push(cc);
      } else {
        inserted.push(cc);
      }
    }

    for (let cc of inserted) {
      var new_key = new Date().getTime();
      let stmt_add = await otherDB.query("INSERT INTO ims_po_team (map_key,ims_po_team_leader,ims_po_team_member , po_cost_center, status_map_po_cc) VALUES (:map_key,:team_leader,:team_member , :costCenter, :reqMapStatus )", {
        replacements: {
          map_key: new_key,
          team_leader: team_leader,
          team_member: team_member,
          costCenter: cc,
          reqMapStatus: "PENDING"
        },
        type: otherDB.QueryTypes.INSERT,
      });

      await invtDB.query(
        `INSERT INTO ims_po_team_log (map_key, action, insert_by, insert_dt, comment) VALUES (:map_key, :action, :insert_by, :insert_dt, :comment)`,
        {
          replacements: {
            map_key: new_key,
            action: "ADD",
            insert_by: req.logedINUser,
            insert_dt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
            comment: `po team mapped by ${req.logedINUser}`,
          },
          type: invtDB.QueryTypes.INSERT,
        }
      )
    }
    return res.json({ code: 200, success: true, status: "success", message: { msg: inserted.length > 0 ? "Team members added" : "Team members already exists" } });

  } catch (err) {
    console.log(err);
    // helper.errorMAil(err);
    return res.json({ code: 500, success: false, status: "error", message: "Internal Error!!", err: err.stack });
  }
});



// FETCH PO TEAM LEADERS
router.get("/fetch_po_team_leader", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await otherDB.query(`SELECT leader.user_name AS leader_name , ims_po_team_leader AS leader_id  FROM ims_po_team LEFT JOIN ${global.ims_db_name}.admin_login leader ON leader.CustID = ims_po_team.ims_po_team_leader WHERE ims_po_team.status_map_po_cc = 'PENDING' GROUP BY ims_po_team_leader`, {
      type: otherDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      let data = [];

      for (let i = 0; i < stmt.length; i++) {
        data.push({
          id: stmt[i].leader_id,
          text: stmt[i].leader_name,
        });
      }
      return res.json({ code: 200, status: "success", data: data });
    } else {
      return res.json({ code: 500, status: "error", message: { msg: "No Team found!!!" } });
    }
  } catch (err) {
    helper.errorMAil(err);
    return res.json({ code: 500, status: "error", message: { msg: "Internal Error!!" } });
  }
});

// FETCH MEMEBER LIST
router.post("/fetch_po_team_member", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      search: "required",
    });

    let stmt;
    if (valid.passes()) {
      stmt = await otherDB.query(`SELECT member.user_name AS member_name , ims_po_team_member AS member_id FROM ims_po_team LEFT JOIN ${global.ims_db_name}.admin_login member ON member.CustID = ims_po_team.ims_po_team_member WHERE ims_po_team_member LIKE :search LIMIT 40`, {
        replacements: {
          search: `%${req.body.search}%`,
        },
        type: otherDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await otherDB.query(`SELECT member.user_name AS member_name , ims_po_team_member AS member_id FROM ims_po_team LEFT JOIN ${global.ims_db_name}.admin_login member ON member.CustID = ims_po_team.ims_po_team_member LIMIT 40`, {
        type: otherDB.QueryTypes.SELECT,
      });
    }

    if (stmt.length > 0) {
      let data = [];

      for (let i = 0; i < stmt.length; i++) {
        data.push({
          id: stmt[i].member_id,
          text: stmt[i].member_name,
        });
      }

      return res.json({ success: true, status: "success", data: data });
    } else {
      return res.json({ success: false, status: "error", message:"No Team found!!!" });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH MEMEBER LIST
router.get("/fetch_po_team_memeber", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await otherDB.query(`SELECT leader.user_name AS leader_name , member.user_name AS member_name, leader.CustID AS leader_id, member.CustID AS member_id , cost.cost_center_key AS cost_center , cost.cost_center_name , cost.cost_center_short_name FROM ims_po_team LEFT JOIN ${global.ims_db_name}.admin_login leader ON leader.CustID = ims_po_team.ims_po_team_leader LEFT JOIN ${global.ims_db_name}.admin_login member ON member.CustID = ims_po_team.ims_po_team_member LEFT JOIN ${global.ims_db_name}.cost_center cost ON cost.cost_center_key = ims_po_team.po_cost_center `, {
      type: otherDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      return res.json({ success: true, status: "success", data: stmt });
    } else {
      return res.json({ success: false, status: "error", message: "No Team found!!!" });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

router.get("/fetch_requested_team_costcenter", async (req, res) => {
  let validation = new Validator(req.query, {
    map_key: "required",
  });

  if (validation.fails()) {
    return res.json({
      code: 500,
      status: "error",
      message: { msg: "something you missing" },
      data: validation.errors.all(),
    });
  }

  try {
    const stmt = await otherDB.query(
      `SELECT
          ims_po_team.map_key,
          ims_po_team.ims_po_team_leader,
          ims_po_team.ims_po_team_member,
          leader.user_name AS leader_name,
          member.user_name AS member_name,
          cost.cost_center_key AS cost_center,
          cost.cost_center_name,
          cost.cost_center_short_name
       FROM ims_po_team
       LEFT JOIN ${global.ims_db_name}.admin_login leader
         ON leader.CustID = ims_po_team.ims_po_team_leader
       LEFT JOIN ${global.ims_db_name}.admin_login member
         ON member.CustID = ims_po_team.ims_po_team_member
       LEFT JOIN ${global.ims_db_name}.cost_center cost
         ON cost.cost_center_key = ims_po_team.po_cost_center
       WHERE ims_po_team.status_map_po_cc = 'PENDING'
       AND ims_po_team.map_key = :map_key`,
      {
        replacements: {
          map_key: req.query.map_key,
        },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length === 0) {
      return res.json({
        code: 500,
        status: "error",
        message: "No Team found!!!",
      });
    }

    const result = {
      map_key: stmt[0].map_key,
      leader_id: stmt[0].ims_po_team_leader,
      leader_name: stmt[0].leader_name,
      member_id: stmt[0].ims_po_team_member,
      member_name: stmt[0].member_name,
      po_cost_center: [],
    };

    stmt.forEach((row) => {
      result.po_cost_center.push({
        cost_center: row.cost_center,
        cost_center_name: row.cost_center_name,
        cost_center_short_name: row.cost_center_short_name,
      });
    });

    return res.json({
      code: 200,
      status: "success",
      data: result,
    });

  } catch (error) {
    console.log(error);
    return res.json({
      code: 500,
      status: "error",
      message: "Internal Error!! Contact Admin",
      err: error.stack,
    });
  }
});

router.post("/approved_pending_po_team", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    map_key: "required"
  })

  if (validation.fails()) {
    return res.json({ code: 500, success: false, message: validation.errors.all(), status: "error" });
  }
  const transaction = await otherDB.transaction();
  try {
    let stmt_check = await invtDB.query(
      `SELECT * FROM admin_login WHERE CustID = :CustID`,
      {
        replacements: { CustID: req.logedINUser },
        type: invtDB.QueryTypes.SELECT
      }
    )

    if (stmt_check[0].type === 'admin') {
      let stmt = await otherDB.query(
        `UPDATE ims_po_team SET status_map_po_cc = 'APPROVED' WHERE map_key = :map_key`,
        {
          replacements: { map_key: req.body.map_key },
          type: otherDB.QueryTypes.UPDATE
        }
      )

      await invtDB.query(
        `INSERT INTO ims_po_team_log (map_key, action, insert_by, insert_dt, comment) VALUES (:map_key, :action, :insert_by, :insert_dt, :comment)`,
        {
          replacements: {
            map_key: req.body.map_key,
            action: "APPROVED",
            insert_by: req.logedINUser,
            insert_dt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
            comment: `po team mapped by ${req.logedINUser} approved`,
          },
          type: invtDB.QueryTypes.INSERT,
        }
      )

      await transaction.commit();
      return res.json({ code: 200, success: true, message: "Team member approved", status: "success" });
    } else {
      await transaction.rollback();
      return res.json({ code: 500, success: false, message: "You are not admin", status: "error" });
    }
  } catch (error) {
    console.log(error)
  }
})


//Delete Member
router.post("/delete_Member", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    team_leader: "required",
    team_member: "required",
    cost_center: "required",
  });

  if (validation.fails()) {
    return res.json({ success: false, message: "something you missing" , data: validation.errors.all(), status: "error" });
  }

  const transactionOt = await otherDB.transaction();

  try {

    const { team_leader, team_member, cost_center } = req.body;

    let pagestsmt = await otherDB.query("SELECT ims_po_team_leader, ims_po_team_member FROM `ims_po_team` WHERE `ims_po_team_leader` = :team_leader AND `ims_po_team_member` = :team_member AND `po_cost_center` = :cost_center ", {
      replacements: { team_leader, team_member, cost_center },
      type: otherDB.QueryTypes.SELECT,
    });
    if (pagestsmt.length > 0) {
      let stmt1 = await otherDB.query("DELETE FROM `ims_po_team` WHERE `ims_po_team_leader` = :team_leader AND `ims_po_team_member` = :team_member AND `po_cost_center` = :cost_center ", {
        replacements: { team_leader, team_member, cost_center },
        type: otherDB.QueryTypes.DELETE,
        transaction: transactionOt,
      });
      await transactionOt.commit();
      return res.json({ success: true, message: "Member deleted successfully", status: "success" });
    } else {
      transactionOt.rollback();
      return res.json({ success: false, message: "No Member found", status: "error" });
    }
  } catch (err) {
    transactionOt.rollback();
    return helper.errorResponse(res, err);
  }
});

module.exports = router;
